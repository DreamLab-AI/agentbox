//! Dream inbox — the engine's working copy of the questions it asks the human.
//!
//! Nights that need a human decision (a "Human action recommended" item in a
//! report, an environment fault, a health anomaly) append an item here. The
//! **forum governance panel is the canonical decision surface**
//! ([`crate::governance`], ADR-2115): each open item is published as a kind-31402
//! ActionRequest on JunkieJarvis's `dream-machine` panel, and the admin's signed
//! kind-31403 decision is ingested back into this file at the start of the next
//! night, where carry-over reads it. The `dream-inbox-surface.cjs` hook only
//! points the operator at the panel; `scripts/dream-inbox.mjs answer` remains a
//! local break-glass path.
//!
//! The file (`~/workspace/.agentbox/dream-inbox.json`) is the engine's state,
//! not the operator's inbox. RuVector gets the *answers*, not the queue.
//! Everything here is fail-open: an inbox failure never taints a night.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    /// Short stable id: first 8 hex chars of a hash of (night_id, text).
    pub id: String,
    /// "question" (report asked for a human decision) or "alert" (engine
    /// detected an anomaly needing attention).
    pub kind: String,
    pub repo: String,
    pub night_id: String,
    pub date: String,
    pub text: String,
    /// "open" | "answered" | "dismissed" — only "open" items are surfaced.
    pub status: String,
    /// Filled in by /dream answer.
    #[serde(default)]
    pub answer: String,
    /// Set by the surfacing hook (epoch seconds) for rate-limiting.
    #[serde(default)]
    pub last_surfaced: u64,
    /// Event id of the kind-31402 ActionRequest this item was published as,
    /// once the relay accepted it. Empty = not yet on the governance panel.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub published_event_id: String,
    /// Event id of the kind-31403 decision that resolved this item, when it
    /// was resolved from the forum rather than locally.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub decision_event_id: String,
    /// Event id of the kind-5 deletion that withdrew the published request
    /// once this item stopped being open. Empty = still on the panel (or never
    /// published). Set once; a withdrawal is never re-sent.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub withdrawn_event_id: String,
}

/// The live inbox file; `DREAM_INBOX_PATH` overrides it (tests, dry runs
/// against a copy).
pub fn inbox_path() -> PathBuf {
    std::env::var("DREAM_INBOX_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/home/devuser/workspace/.agentbox/dream-inbox.json"))
}

fn short_hash(s: &str) -> String {
    // FNV-1a, hex — stable, dependency-free; collision space is fine for an
    // operator inbox of tens of items.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", (h >> 32) as u32 ^ h as u32)
}

fn load() -> Vec<InboxItem> {
    load_from(&inbox_path())
}

fn save(items: &[InboxItem]) -> std::io::Result<()> {
    save_to(&inbox_path(), items)
}

/// Read every item from an inbox file (empty on any error — fail-open).
pub fn load_from(path: &std::path::Path) -> Vec<InboxItem> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Every item in the live inbox.
pub fn load_items() -> Vec<InboxItem> {
    load()
}

/// Open items in the live inbox.
pub fn open_items() -> Vec<InboxItem> {
    load().into_iter().filter(|i| i.status == "open").collect()
}

/// Atomically write `items` to `path` (temp file + rename).
pub fn save_to(path: &std::path::Path, items: &[InboxItem]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(items).unwrap_or_default(),
    )?;
    std::fs::rename(&tmp, path)
}

/// Record that item `id` is now on the governance panel as request `event_id`.
/// Returns whether anything changed.
pub fn mark_published_in(
    path: &std::path::Path,
    id: &str,
    event_id: &str,
) -> std::io::Result<bool> {
    let mut items = load_from(path);
    let Some(item) = items.iter_mut().find(|i| i.id == id) else {
        return Ok(false);
    };
    if item.published_event_id == event_id {
        return Ok(false);
    }
    item.published_event_id = event_id.to_string();
    save_to(path, &items)?;
    Ok(true)
}

/// Record that item `id`'s published request was withdrawn by deletion
/// `event_id`. Only the first withdrawal is recorded; returns whether anything
/// changed.
pub fn mark_withdrawn_in(
    path: &std::path::Path,
    id: &str,
    published_event_id: &str,
    event_id: &str,
) -> std::io::Result<bool> {
    let mut items = load_from(path);
    let Some(item) = items.iter_mut().find(|i| {
        i.id == id && i.published_event_id == published_event_id && i.withdrawn_event_id.is_empty()
    }) else {
        return Ok(false);
    };
    item.withdrawn_event_id = event_id.to_string();
    save_to(path, &items)?;
    Ok(true)
}

/// Resolve an OPEN item from a forum decision. `status` is `answered` or
/// `dismissed`. Items already resolved (locally or by an earlier decision)
/// are left alone, so re-ingesting the same decisions is a no-op.
pub fn resolve_in(
    path: &std::path::Path,
    id: &str,
    status: &str,
    answer: &str,
    decision_event_id: &str,
) -> std::io::Result<bool> {
    let mut items = load_from(path);
    let Some(item) = items.iter_mut().find(|i| i.id == id && i.status == "open") else {
        return Ok(false);
    };
    item.status = status.to_string();
    item.answer = answer.to_string();
    item.decision_event_id = decision_event_id.to_string();
    save_to(path, &items)?;
    Ok(true)
}

/// Append an item unless an open item with the same id already exists.
/// Returns the item id. Errors are the caller's to log (fail-open).
pub fn add(
    kind: &str,
    repo: &str,
    night_id: &str,
    date: &str,
    text: &str,
) -> std::io::Result<String> {
    let id = short_hash(&format!("{}:{}", night_id, text));
    let mut items = load();
    if items.iter().any(|i| i.id == id && i.status == "open") {
        return Ok(id); // already queued — idempotent across retries
    }
    items.push(InboxItem {
        id: id.clone(),
        kind: kind.into(),
        repo: repo.into(),
        night_id: night_id.into(),
        date: date.into(),
        text: text.trim().into(),
        status: "open".into(),
        answer: String::new(),
        last_surfaced: 0,
        published_event_id: String::new(),
        decision_event_id: String::new(),
        withdrawn_event_id: String::new(),
    });
    // Keep the file bounded: drop resolved items older than the newest 200.
    if items.len() > 200 {
        let excess = items.len() - 200;
        let mut dropped = 0;
        items.retain(|i| {
            if dropped < excess && i.status != "open" {
                dropped += 1;
                false
            } else {
                true
            }
        });
    }
    save(&items)?;
    Ok(id)
}

/// The four labelled fields the prompt asks for in every operator item:
/// `Decision:`, `Why:`, `If approved:`, `If not:`. Any separator between
/// them (` · `, ` — `, `;`, a newline) is accepted; labels are matched
/// case-insensitively. `None` when the text does not carry a `Decision:`
/// and an `If approved:` field.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DecisionFields {
    pub decision: String,
    pub why: String,
    pub if_approved: String,
    pub if_not: String,
}

const LABELS: [(&str, usize); 4] = [
    ("decision:", 0),
    ("why:", 1),
    ("if approved:", 2),
    ("if not:", 3),
];

pub fn decision_fields(text: &str) -> Option<DecisionFields> {
    // ASCII lowering keeps every byte offset valid in `text`; Unicode
    // lowering can change byte lengths (K, İ) and a slice at a drifted
    // offset panics — and this runs on model output, inside a night.
    let lower = text.to_ascii_lowercase();
    let mut marks: Vec<(usize, usize, usize)> = Vec::new(); // (start, end, field)
    for (label, field) in LABELS {
        let mut from = 0;
        while let Some(i) = lower[from..].find(label) {
            let at = from + i;
            // A label starts a field only at the start of the text or after a
            // non-word character, so "indecision:" does not count.
            let ok_before = at == 0 || !lower.as_bytes()[at - 1].is_ascii_alphanumeric();
            if ok_before {
                marks.push((at, at + label.len(), field));
            }
            from = at + label.len();
        }
    }
    if marks.is_empty() {
        return None;
    }
    marks.sort();
    let mut f = DecisionFields::default();
    for (n, (_, end, field)) in marks.iter().enumerate() {
        let stop = marks.get(n + 1).map(|m| m.0).unwrap_or(text.len());
        let val = text[*end..stop]
            .trim()
            .trim_end_matches(['·', '—', '-', ';', '|', '*', ' '])
            .trim_start_matches(['*', ' '])
            .trim();
        let slot = match field {
            0 => &mut f.decision,
            1 => &mut f.why,
            2 => &mut f.if_approved,
            _ => &mut f.if_not,
        };
        if slot.is_empty() {
            *slot = val.to_string();
        }
    }
    if f.decision.is_empty() || f.if_approved.is_empty() {
        return None;
    }
    Some(f)
}

/// Approval never merges, promotes or ships anything (evaluation is not
/// promotion). An `If approved:` field that says otherwise is rewritten so
/// the panel never promises what the engine cannot do; a question without
/// the four fields is returned unchanged.
pub fn plain_decision(question: &str) -> String {
    let Some(mut f) = decision_fields(question) else {
        return question.to_string();
    };
    let lower = f.if_approved.to_lowercase();
    let promises = ["merge", "promot", "ship", "deploy", "release", "publish"];
    if promises.iter().any(|p| lower.contains(p)) {
        f.if_approved = format!(
            "the next night proceeds on this basis; merging stays a human act ({})",
            f.if_approved
        );
    }
    let mut out = format!("Decision: {} · Why: {}", f.decision, f.why);
    out.push_str(&format!(" · If approved: {}", f.if_approved));
    if !f.if_not.is_empty() {
        out.push_str(&format!(" · If not: {}", f.if_not));
    }
    out
}

/// Extract "human action recommended" items from a report. Matches the bullet
/// or numbered lines directly following a line containing the marker
/// (case-insensitive), stopping at the first non-list line.
pub fn extract_questions(report: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_section = false;
    for line in report.lines() {
        let t = line.trim();
        let lower = t.to_ascii_lowercase(); // byte offsets stay valid in `t`
        if lower.contains("human action recommended") {
            // Inline form: "**Human action recommended:** do X" on one line —
            // the ask is complete, so following bullets are NOT part of it.
            let idx = lower.find("recommended").unwrap_or(0);
            let rest = t[idx + "recommended".len().min(t.len() - idx)..]
                .trim_start_matches([':', '*', ' ']);
            if rest.len() > 8 {
                out.push(rest.to_string());
                in_section = false;
            } else {
                // Heading form: the asks are the list lines that follow.
                in_section = true;
            }
            continue;
        }
        if in_section {
            let is_list = t.starts_with('-')
                || t.starts_with('*')
                || t.chars().next().is_some_and(|c| c.is_ascii_digit());
            if is_list && t.len() > 4 {
                out.push(
                    t.trim_start_matches(['-', '*', ' '])
                        .trim_start_matches(|c: char| {
                            c.is_ascii_digit() || c == '.' || c == ')' || c == '(' || c == ' '
                        })
                        .to_string(),
                );
            } else if !t.is_empty() {
                break;
            }
        }
    }
    out.retain(|q| q.len() > 8);
    out.truncate(5);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_numbered_recommendations() {
        let report = "\
## Summary
- **Human action recommended:** (1) Re-provision the connected node annexe workspace. (2) Re-run pin-parity manually.
- **Next steps:** something else
";
        let qs = extract_questions(report);
        assert_eq!(qs.len(), 1);
        assert!(qs[0].contains("Re-provision"));
    }

    #[test]
    fn extracts_bullet_list_form() {
        let report = "\
**Human action recommended:**
- Re-provision the connected node annexe workspace mount.
- Verify pin parity once readable.

Other text.
";
        let qs = extract_questions(report);
        assert_eq!(qs.len(), 2);
        assert!(qs[1].starts_with("Verify pin parity"));
    }

    #[test]
    fn no_marker_no_questions() {
        assert!(extract_questions("just a report with no asks").is_empty());
    }

    fn item(id: &str, status: &str) -> InboxItem {
        InboxItem {
            id: id.into(),
            kind: "question".into(),
            repo: "r".into(),
            night_id: "n".into(),
            date: "2026-09-25".into(),
            text: "decide something".into(),
            status: status.into(),
            answer: String::new(),
            last_surfaced: 0,
            published_event_id: String::new(),
            decision_event_id: String::new(),
            withdrawn_event_id: String::new(),
        }
    }

    #[test]
    fn mark_published_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        save_to(&path, &[item("a", "open")]).unwrap();
        assert!(mark_published_in(&path, "a", "ev1").unwrap());
        assert!(!mark_published_in(&path, "a", "ev1").unwrap());
        assert!(!mark_published_in(&path, "missing", "ev1").unwrap());
        assert_eq!(load_from(&path)[0].published_event_id, "ev1");
    }

    #[test]
    fn resolve_only_touches_open_items() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        save_to(&path, &[item("a", "open"), item("b", "answered")]).unwrap();
        assert!(resolve_in(&path, "a", "answered", "approve: ok", "dec1").unwrap());
        assert!(!resolve_in(&path, "a", "dismissed", "x", "dec2").unwrap());
        assert!(!resolve_in(&path, "b", "dismissed", "x", "dec3").unwrap());
        let items = load_from(&path);
        assert_eq!(items[0].status, "answered");
        assert_eq!(items[0].answer, "approve: ok");
        assert_eq!(items[0].decision_event_id, "dec1");
        assert_eq!(items[1].status, "answered");
    }

    #[test]
    fn legacy_items_without_new_fields_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        std::fs::write(
            &path,
            r#"[{"id":"x","kind":"alert","repo":"r","night_id":"n","date":"d","text":"t","status":"open","answer":"","last_surfaced":0}]"#,
        )
        .unwrap();
        let items = load_from(&path);
        assert_eq!(items.len(), 1);
        assert!(items[0].published_event_id.is_empty());
        assert!(items[0].withdrawn_event_id.is_empty());
    }

    #[test]
    fn inbox_written_before_withdrawals_still_loads() {
        // The shape of the live file on 2026-10-02: published and resolved,
        // no `withdrawn_event_id` key.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        std::fs::write(
            &path,
            r#"[{"id":"x","kind":"question","repo":"r","night_id":"n","date":"d","text":"t","status":"answered","answer":"approve: ok","last_surfaced":0,"published_event_id":"req1","decision_event_id":"dec1"}]"#,
        )
        .unwrap();
        let items = load_from(&path);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].published_event_id, "req1");
        assert!(items[0].withdrawn_event_id.is_empty());
        // And the unset field is not written back, so the file stays as it was.
        save_to(&path, &items).unwrap();
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("withdrawn_event_id"));
    }

    #[test]
    fn mark_withdrawn_records_once_and_only_for_the_named_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        let mut a = item("a", "answered");
        a.published_event_id = "req1".into();
        save_to(&path, &[a]).unwrap();
        assert!(!mark_withdrawn_in(&path, "a", "req-other", "del0").unwrap());
        assert!(mark_withdrawn_in(&path, "a", "req1", "del1").unwrap());
        assert!(!mark_withdrawn_in(&path, "a", "req1", "del2").unwrap());
        assert_eq!(load_from(&path)[0].withdrawn_event_id, "del1");
    }

    #[test]
    fn short_hash_is_stable() {
        assert_eq!(short_hash("a:b"), short_hash("a:b"));
        assert_ne!(short_hash("a:b"), short_hash("a:c"));
    }

    #[test]
    fn decision_fields_parse_any_separator_and_case() {
        let q = "Decision: add the exit-code test to run-all.sh — Why: it is absent from the suite runner; IF APPROVED: the next night wires it · If not: regressions in that gate go unseen";
        let f = decision_fields(q).unwrap();
        assert_eq!(f.decision, "add the exit-code test to run-all.sh");
        assert_eq!(f.why, "it is absent from the suite runner");
        assert_eq!(f.if_approved, "the next night wires it");
        assert_eq!(f.if_not, "regressions in that gate go unseen");
        assert!(decision_fields("if ACCEPT is upheld, review the draft PR").is_none());
        assert!(
            decision_fields("Decision: x — Why: y").is_none(),
            "needs If approved"
        );
    }

    #[test]
    fn plain_decision_never_promises_a_merge() {
        let q = "Decision: accept the PR · Why: green · If approved: merge the draft PR · If not: it lapses";
        let out = plain_decision(q);
        assert!(
            out.contains("merging stays a human act (merge the draft PR)"),
            "{out}"
        );
        assert!(out.starts_with("Decision: accept the PR · Why: green"));
        let free = "if ACCEPT is upheld, review the draft PR";
        assert_eq!(plain_decision(free), free);
    }

    #[test]
    fn decision_fields_survive_characters_that_grow_when_lowercased() {
        // Kelvin sign and dotted capital I change byte length under
        // to_lowercase(); the parser must not slice at a drifted offset.
        let q = "Decision: cool to 5 \u{212a} · Why: İstanbul · If approved: y";
        let f = decision_fields(q).unwrap();
        assert_eq!(f.decision, "cool to 5 \u{212a}");
        assert_eq!(f.why, "İstanbul");
        let report =
            "Human action recommended\n- \u{212a}eep the İ · Decision: x · If approved: y\n";
        assert_eq!(extract_questions(report).len(), 1);
        assert!(decision_fields("indecision: x if approved: y").is_none());
    }
}
