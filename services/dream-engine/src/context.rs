//! Self-GC context governance for the nightly evidence pack (ADR-070).
//!
//! Adapts "Self-GC: Self-Governing Context for Long-Horizon LLM Agents"
//! (arXiv 2607.00692) to the dream engine's inverted loop: the long-horizon
//! trace is the *night sequence*, not an in-session transcript. Turns are
//! nights, tool spans are evidence receipts, and the active view is the
//! evidence pack compiled into tonight's prompt.
//!
//! Division of labour follows the paper: the side-channel planner (same
//! LLM tier as the nightly call) supplies semantic judgment about future
//! value; this module enforces the runtime invariants — tonight's receipts
//! are never pruned or folded (last-turn protection), every fold leaves a
//! byte-exact recovery pointer into a sidecar file, and any failure at any
//! stage falls open to the legacy tail-truncation path.
//!
//! Sidecar layout (control-plane side, never shipped to a provider):
//! `<artefact_dir>/<night_id>/receipts/{build,eval-<name>}.txt` + `index.json`.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::llm::{self, LlmConfig};

/// One addressable evidence object. IDs follow the engine's URN habit:
/// `receipt:<night_id>:<name>` where name is `build` or the evaluator key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptObject {
    pub id: String,
    pub night_id: String,
    pub name: String,
    /// Sidecar file holding the full untruncated payload.
    pub path: PathBuf,
    pub chars: usize,
    /// First non-empty line, clipped — the planner's only content signal.
    pub head: String,
    /// True for tonight's receipts (mandatory retention).
    #[serde(default)]
    pub tonight: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GcAction {
    /// Drop the payload from the pack; keep a one-line recovery pointer.
    Fold,
    /// Keep head + tail, elide the middle, keep the recovery pointer.
    Mask,
    /// Remove entirely — no recovery guarantee (prior nights only).
    Prune,
    /// Inline a previously folded prior-night object from its sidecar.
    Restore,
}

impl GcAction {
    fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "fold" => Some(Self::Fold),
            "mask" => Some(Self::Mask),
            "prune" => Some(Self::Prune),
            "restore" => Some(Self::Restore),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PlanEntry {
    pub target: String,
    pub action: GcAction,
    pub reason: String,
}

/// Per-object clip sizes for materialisation. Head/tail asymmetry mirrors
/// evaluator output shape: failures and summaries cluster at the end, but
/// the invocation line and first error usually sit at the top.
const RESTORE_CAP: usize = 8_000;
const MASK_HEAD: usize = 800;
const MASK_TAIL: usize = 2_400;
/// Default whole-pack budget in chars (~7k tokens). Overridable via
/// DREAM_SELF_GC_BUDGET; once exceeded, remaining objects degrade to fold.
const DEFAULT_BUDGET: usize = 30_000;
/// Prior nights the planner may see. The slot rotation is day-modulo over a
/// handful of slots, so 6 nights covers at least one full revisit of a deep.
const PRIOR_NIGHTS: usize = 6;

pub fn enabled() -> bool {
    std::env::var("DREAM_SELF_GC").as_deref() != Ok("0")
}

fn budget() -> usize {
    std::env::var("DREAM_SELF_GC_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_BUDGET)
}

/// Persist tonight's receipts untruncated as sidecars and return their
/// object index. Also writes `receipts/index.json` so future nights can
/// address these objects without re-reading every payload.
pub fn persist_receipts(
    night_dir: &Path,
    night_id: &str,
    build_out: &str,
    eval_outs: &[(String, String)],
) -> std::io::Result<Vec<ReceiptObject>> {
    let dir = night_dir.join("receipts");
    std::fs::create_dir_all(&dir)?;
    let mut objects = Vec::new();
    let mut write_one = |name: &str, file: &str, content: &str| -> std::io::Result<()> {
        let path = dir.join(file);
        std::fs::write(&path, content)?;
        objects.push(ReceiptObject {
            id: format!("receipt:{}:{}", night_id, name),
            night_id: night_id.into(),
            name: name.into(),
            path,
            chars: content.len(),
            head: head_line(content),
            tonight: true,
        });
        Ok(())
    };
    write_one("build", "build.txt", build_out)?;
    for (name, out) in eval_outs {
        write_one(name, &format!("eval-{}.txt", sanitise(name)), out)?;
    }
    let index: Vec<&ReceiptObject> = objects.iter().collect();
    std::fs::write(
        dir.join("index.json"),
        serde_json::to_string_pretty(&index).unwrap_or_default(),
    )?;
    Ok(objects)
}

/// Load prior-night receipt objects for this repo, most recent first,
/// capped at [`PRIOR_NIGHTS`] nights. Missing/unreadable indexes are
/// skipped — early nights simply have no governed history yet.
pub fn load_prior_objects(
    artefact_dir: &Path,
    repo_name: &str,
    tonight_prefix: &str,
) -> Vec<ReceiptObject> {
    let suffix = format!("-{}", repo_name);
    let mut nights: Vec<String> = std::fs::read_dir(artefact_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.ends_with(&suffix) && !n.starts_with(tonight_prefix))
                .collect()
        })
        .unwrap_or_default();
    nights.sort();
    nights.reverse();
    nights.truncate(PRIOR_NIGHTS);

    let mut objects = Vec::new();
    for night in &nights {
        let index = artefact_dir.join(night).join("receipts").join("index.json");
        let Ok(text) = std::fs::read_to_string(&index) else {
            continue;
        };
        match serde_json::from_str::<Vec<ReceiptObject>>(&text) {
            Ok(objs) => objects.extend(objs.into_iter().map(|mut o| {
                o.tonight = false;
                o
            })),
            Err(e) => warn!(night = %night, error = %e, "receipt index unreadable — skipped"),
        }
    }
    objects
}

/// Build the planner's object-action contract prompt. The planner sees an
/// index (id, age, size, head line), never full payloads — the whole call
/// stays cheap regardless of receipt sizes.
pub fn planner_prompt(objects: &[ReceiptObject], deep: &str, scans: &str) -> String {
    let mut listing = String::new();
    for o in objects {
        listing.push_str(&format!(
            "- `{}` {} {}B — {}\n",
            o.id,
            if o.tonight { "[TONIGHT]" } else { "[prior]" },
            o.chars,
            o.head
        ));
    }
    format!(
        r#"You are the context governor for an overnight research engine. Tonight's deep dive is **{deep}** (scans: {scans}). Below is the index of evidence-receipt objects: tonight's fresh evaluator/build outputs plus receipts retained from prior nights. Full payloads are stored in recoverable sidecars; you see only the index.

Assign each object ONE lifecycle action:
- `restore` — inline the payload (near-full). Use for objects a hypothesis about **{deep}** will need exact anchors from (error signatures, test names, numbers, paths).
- `mask` — keep head + tail, elide the middle. Use for bulky but partially relevant output.
- `fold` — keep only a recovery pointer. Use for receipts irrelevant tonight but plausibly relevant when their topic's slot rotates back.
- `prune` — drop entirely, no recovery. ONLY for obsolete duplicates or dead noise.

Rules: objects marked [TONIGHT] must be `restore` or `mask` — never fold or prune. Prefer fold over prune when in doubt: fold is free insurance. Target keeping the total inlined evidence modest — restore only what tonight's hypothesis genuinely needs.

Objects:
{listing}
Respond with ONLY a JSON object, no prose:
{{"actions":[{{"target":"<id>","action":"restore|mask|fold|prune","reason":"<short>"}}]}}"#
    )
}

/// Extract and parse the plan from the planner's reply. Tolerates code
/// fences and surrounding prose by scanning to the first '{'.
pub fn parse_plan(reply: &str) -> Option<Vec<PlanEntry>> {
    #[derive(Deserialize)]
    struct RawPlan {
        actions: Vec<RawEntry>,
    }
    #[derive(Deserialize)]
    struct RawEntry {
        target: String,
        action: String,
        #[serde(default)]
        reason: String,
    }
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    let raw: RawPlan = serde_json::from_str(&reply[start..=end]).ok()?;
    Some(
        raw.actions
            .into_iter()
            .filter_map(|e| {
                GcAction::parse(&e.action).map(|action| PlanEntry {
                    target: e.target,
                    action,
                    reason: e.reason,
                })
            })
            .collect(),
    )
}

/// Enforce the runtime invariants over a raw plan: unknown targets are
/// dropped; tonight's receipts are upgraded to at least `mask` (last-turn
/// protection); objects the planner never mentioned get a default —
/// tonight → mask, prior → fold. The result covers every object exactly once.
pub fn validate(plan: Vec<PlanEntry>, objects: &[ReceiptObject]) -> Vec<PlanEntry> {
    let mut out: Vec<PlanEntry> = Vec::with_capacity(objects.len());
    for o in objects {
        let proposed = plan.iter().find(|p| p.target == o.id);
        let action = match (proposed.map(|p| p.action), o.tonight) {
            (Some(GcAction::Fold) | Some(GcAction::Prune), true) => {
                warn!(target = %o.id, "planner tried to drop a TONIGHT receipt — forced to mask");
                GcAction::Mask
            }
            // Restore on a fresh receipt just means "inline it".
            (Some(a), _) => a,
            (None, true) => GcAction::Mask,
            (None, false) => GcAction::Fold,
        };
        out.push(PlanEntry {
            target: o.id.clone(),
            action,
            reason: proposed.map(|p| p.reason.clone()).unwrap_or_default(),
        });
    }
    out
}

/// Materialise the governed evidence pack. `redact` is applied to every
/// payload slice before it enters the pack (the pack leaves the LAN; the
/// sidecars do not). Once the char budget is exceeded, remaining
/// restore/mask entries degrade to fold — the pointers keep them honest.
pub fn materialise(
    objects: &[ReceiptObject],
    plan: &[PlanEntry],
    budget: usize,
    redact: impl Fn(&str) -> String,
) -> String {
    let mut pack = String::from("\n## Evidence receipts (Self-GC governed — pointers are operator-recoverable sidecars)\n\n");
    let mut spent = 0usize;
    let mut pruned = 0usize;
    for entry in plan {
        let Some(o) = objects.iter().find(|o| o.id == entry.target) else {
            continue;
        };
        let mut action = entry.action;
        if spent >= budget && matches!(action, GcAction::Restore | GcAction::Mask) && !o.tonight {
            action = GcAction::Fold;
        }
        match action {
            GcAction::Prune => pruned += 1,
            GcAction::Fold => {
                pack.push_str(&format!(
                    "- `{}` folded ({}B in sidecar `{}`)\n",
                    o.id,
                    o.chars,
                    o.path.file_name().and_then(|f| f.to_str()).unwrap_or("?")
                ));
            }
            GcAction::Mask | GcAction::Restore => {
                let content = std::fs::read_to_string(&o.path).unwrap_or_default();
                let body = if action == GcAction::Restore {
                    clip_middle(&content, RESTORE_CAP / 2, RESTORE_CAP / 2)
                } else {
                    clip_middle(&content, MASK_HEAD, MASK_TAIL)
                };
                let body = redact(&body);
                spent += body.len();
                pack.push_str(&format!(
                    "### `{}` ({}, {}B full{})\n```\n{}\n```\n\n",
                    o.id,
                    if action == GcAction::Restore { "restored" } else { "masked" },
                    o.chars,
                    if o.tonight { ", tonight" } else { "" },
                    body
                ));
            }
        }
    }
    if pruned > 0 {
        pack.push_str(&format!("\n({} obsolete receipt(s) pruned by the context governor.)\n", pruned));
    }
    pack
}

/// Full governance round: sidecar persist happens in the caller; this runs
/// planner → validate → materialise. Returns `None` on any failure so the
/// engine falls open to the legacy tail path.
pub async fn govern(
    llm_cfg: &LlmConfig,
    fallback: Option<&LlmConfig>,
    objects: &[ReceiptObject],
    deep: &str,
    scans: &str,
    redact: impl Fn(&str) -> String,
) -> Option<String> {
    if objects.is_empty() {
        return None;
    }
    // Planner tier: same provider as the nightly call, bounded output. The
    // floor matters — reasoning models truncated below ~1536 tokens return
    // empty text (Loom bench finding); 4096 leaves room for large indexes.
    let planner_cfg = LlmConfig {
        max_tokens: llm_cfg.max_tokens.clamp(2048, 4096),
        ..llm_cfg.clone()
    };
    let prompt = planner_prompt(objects, deep, scans);
    let reply = match llm::call(&planner_cfg, &prompt).await {
        Ok(r) => r,
        Err(e) => match fallback {
            Some(fb) => {
                warn!(error = %e, "Self-GC planner failed on primary — trying fallback provider");
                let fb_cfg = LlmConfig {
                    max_tokens: fb.max_tokens.clamp(2048, 4096),
                    ..fb.clone()
                };
                llm::call(&fb_cfg, &prompt).await.ok()?
            }
            None => {
                warn!(error = %e, "Self-GC planner failed — falling open to legacy receipts");
                return None;
            }
        },
    };
    let raw = parse_plan(&reply).or_else(|| {
        warn!(reply_chars = reply.len(), "Self-GC plan unparseable — falling open");
        None
    })?;
    let plan = validate(raw, objects);
    let restored = plan.iter().filter(|p| p.action == GcAction::Restore).count();
    let masked = plan.iter().filter(|p| p.action == GcAction::Mask).count();
    let folded = plan.iter().filter(|p| p.action == GcAction::Fold).count();
    let pruned = plan.iter().filter(|p| p.action == GcAction::Prune).count();
    info!(restored, masked, folded, pruned, objects = objects.len(), "Self-GC plan committed");
    Some(materialise(objects, &plan, budget(), redact))
}

fn head_line(s: &str) -> String {
    let line = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut h: String = line.chars().take(150).collect();
    if line.chars().count() > 150 {
        h.push('…');
    }
    h
}

fn sanitise(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

/// Head+tail clip on char boundaries with an explicit elision marker, so a
/// later turn can tell content was elided (and recover via the pointer).
fn clip_middle(s: &str, head: usize, tail: usize) -> String {
    if s.len() <= head + tail {
        return s.to_string();
    }
    let mut h_end = head.min(s.len());
    while !s.is_char_boundary(h_end) {
        h_end -= 1;
    }
    let mut t_start = s.len() - tail;
    while !s.is_char_boundary(t_start) {
        t_start += 1;
    }
    format!(
        "{}\n…[{}B elided — full payload in sidecar]…\n{}",
        &s[..h_end],
        t_start - h_end,
        &s[t_start..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(id: &str, tonight: bool) -> ReceiptObject {
        ReceiptObject {
            id: id.into(),
            night_id: "2026-08-28-repo".into(),
            name: "build".into(),
            path: PathBuf::from("/nonexistent"),
            chars: 100,
            head: "line".into(),
            tonight,
        }
    }

    #[test]
    fn parse_plan_tolerates_fences_and_prose() {
        let reply = "Here is my plan:\n```json\n{\"actions\":[{\"target\":\"receipt:a:build\",\"action\":\"fold\",\"reason\":\"old\"}]}\n```";
        let plan = parse_plan(reply).unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].action, GcAction::Fold);
    }

    #[test]
    fn parse_plan_drops_unknown_actions() {
        let reply = r#"{"actions":[{"target":"x","action":"vaporise"},{"target":"y","action":"mask"}]}"#;
        let plan = parse_plan(reply).unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].target, "y");
    }

    #[test]
    fn validate_protects_tonight_receipts() {
        let objects = vec![obj("receipt:t:build", true), obj("receipt:p:build", false)];
        let raw = vec![
            PlanEntry { target: "receipt:t:build".into(), action: GcAction::Prune, reason: String::new() },
            PlanEntry { target: "receipt:p:build".into(), action: GcAction::Prune, reason: String::new() },
        ];
        let plan = validate(raw, &objects);
        assert_eq!(plan[0].action, GcAction::Mask); // tonight upgraded
        assert_eq!(plan[1].action, GcAction::Prune); // prior may be pruned
    }

    #[test]
    fn validate_defaults_cover_unmentioned_objects() {
        let objects = vec![obj("receipt:t:build", true), obj("receipt:p:build", false)];
        let plan = validate(vec![], &objects);
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].action, GcAction::Mask);
        assert_eq!(plan[1].action, GcAction::Fold);
    }

    #[test]
    fn validate_drops_unknown_targets() {
        let objects = vec![obj("receipt:t:build", true)];
        let raw = vec![PlanEntry { target: "receipt:ghost:eval".into(), action: GcAction::Restore, reason: String::new() }];
        let plan = validate(raw, &objects);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].target, "receipt:t:build");
    }

    #[test]
    fn clip_middle_marks_elision_and_respects_boundaries() {
        let s = "héllo".repeat(1000);
        let c = clip_middle(&s, 100, 100);
        assert!(c.contains("elided"));
        assert!(c.len() < s.len());
        let short = "tiny";
        assert_eq!(clip_middle(short, 100, 100), "tiny");
    }

    #[test]
    fn materialise_folds_carry_recovery_pointer() {
        let mut o = obj("receipt:p:build", false);
        o.path = PathBuf::from("/x/receipts/build.txt");
        o.chars = 5000;
        let plan = vec![PlanEntry { target: o.id.clone(), action: GcAction::Fold, reason: String::new() }];
        let pack = materialise(&[o], &plan, 30_000, |s| s.to_string());
        assert!(pack.contains("folded (5000B in sidecar `build.txt`)"));
    }

    #[test]
    fn materialise_budget_degrades_prior_to_fold_but_not_tonight() {
        let dir = std::env::temp_dir().join("selfgc-test");
        std::fs::create_dir_all(&dir).unwrap();
        let payload = "x".repeat(4000);
        let p1 = dir.join("a.txt");
        let p2 = dir.join("b.txt");
        std::fs::write(&p1, &payload).unwrap();
        std::fs::write(&p2, &payload).unwrap();
        let mut tonight = obj("receipt:t:build", true);
        tonight.path = p1;
        let mut prior = obj("receipt:p:build", false);
        prior.path = p2;
        let plan = vec![
            PlanEntry { target: "receipt:t:build".into(), action: GcAction::Restore, reason: String::new() },
            PlanEntry { target: "receipt:p:build".into(), action: GcAction::Restore, reason: String::new() },
        ];
        // Budget exhausted by the first object: prior degrades to fold,
        // tonight would not have (mandatory retention beats budget).
        let pack = materialise(&[tonight, prior], &plan, 1000, |s| s.to_string());
        assert!(pack.contains("receipt:t:build"));
        assert!(pack.contains("restored"));
        assert!(pack.contains("`receipt:p:build` folded"));
    }

    #[test]
    fn persist_and_reload_round_trip() {
        let dir = std::env::temp_dir().join(format!("selfgc-rt-{}", std::process::id()));
        let night = dir.join("2026-08-28-repo");
        std::fs::create_dir_all(&night).unwrap();
        let objs = persist_receipts(
            &night,
            "2026-08-28-repo",
            "build ok",
            &[("bench".into(), "42 passed".into())],
        )
        .unwrap();
        assert_eq!(objs.len(), 2);
        assert!(objs.iter().all(|o| o.tonight));
        let loaded = load_prior_objects(&dir, "repo", "2026-08-29");
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().all(|o| !o.tonight));
        assert_eq!(loaded[0].head, "build ok");
        std::fs::remove_dir_all(&dir).ok();
    }
}
