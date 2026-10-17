//! Dream-machine decisions on the forum governance panel (ADR-2115).
//!
//! The engine's human decisions used to live only in a local JSON inbox and a
//! session hook; nobody saw them. They now surface through the forum's Agent
//! Control Surface Protocol (`nostr-bbs-core::governance`):
//!
//! | Event | Kind  | Signer        | `d` tag             | Purpose                                  |
//! |-------|-------|---------------|---------------------|------------------------------------------|
//! | panel | 31400 | JunkieJarvis  | `dream-machine`     | the "Dream machine decisions" panel      |
//! | case  | 31402 | JunkieJarvis  | `dream-<item id>`   | one per open inbox item                  |
//! | reply | 31403 | forum admin   | same as the case    | Approve / Reject / Amend on the case row |
//!
//! Each case carries `a` = `31400:<jarvis>:dream-machine` and `panel` =
//! `dream-machine`, the two references the relay's broker projection and the
//! forum's panel registry both resolve. Case identity is the inbox item id, so
//! republishing an item replaces (NIP-33) rather than duplicates it.
//!
//! **Answers.** At the start of each night [`ingest`] reads the 31403 decisions
//! for the published cases (the relay already admits 31403 only from admins;
//! the signature is re-verified here and a decision signed by the publishing
//! agent itself is ignored), takes the newest per case, and resolves the inbox
//! item — see [`resolution_for`] for the exact mapping. The per-case controls
//! are the forum's fixed Approve / Reject / Amend / Delegate; Amend is the
//! free-text answer. The one panel-level action, `acknowledge-alerts`,
//! dismisses every open alert published before it was pressed.
//!
//! **Withdrawals.** Once an inbox item stops being open — resolved by
//! [`ingest`], by `scripts/dream-inbox.mjs`, or by hand — the engine withdraws
//! its own case with a NIP-09 kind-5 deletion signed by the same agent key
//! ([`withdrawal_event`]). The relay hard-deletes an author's own events on a
//! kind-5, and the forum reads cases by subscription, so the card leaves the
//! panel. The deletion id is recorded as `withdrawn_event_id`, so a
//! withdrawal is sent at most once. [`ingest`] withdraws what it just
//! resolved; [`publish`] sweeps everything else ([`plan_withdrawals`]).
//!
//! Everything is fail-open: an unreachable relay or a missing key is logged
//! and the night carries on.
//!
//! All wire types, kinds and tag names are `nostr-bbs-core::governance`'s — the
//! same code the relay and the forum client run — so the engine cannot drift
//! from the forum's wire format.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use nostr_bbs_core::governance::{
    broker::DecisionOutcome, ActionDef, ActionPriority, ActionRequest, ActionStyle, FieldDef,
    FieldType, LayoutHint, PanelCapability, PanelDefinition, PanelPolicy, PanelSchema,
    Reversibility, RiskTier, Stakes, TaskProperties, Verifiability, KIND_ACTION_REQUEST,
    KIND_ACTION_RESPONSE, KIND_PANEL_DEFINITION,
};
use serde_json::json;
use tracing::{info, warn};

use crate::inbox::{self, InboxItem};
use crate::relay::{self, NostrEvent, RelaySession, SigningKey, UnsignedEvent};

/// `d` tag of the dream-machine panel.
pub const PANEL_D: &str = "dream-machine";
/// Panel-level action that dismisses every open alert published before it.
pub const ACK_ALERTS_ACTION: &str = "acknowledge-alerts";
/// Env var holding the publishing agent's secret key (JunkieJarvis).
pub const KEY_VAR: &str = "JUNKIEJARVIS_PRIVKEY_HEX";
/// Hours before an undecided case is escalated on the forum.
pub const MAX_PENDING_HOURS: u32 = 168;
/// Longest title the forum renders comfortably.
const TITLE_MAX: usize = 120;
/// NIP-09 deletion kind.
pub const KIND_DELETION: u64 = 5;
/// How much of the recorded answer a withdrawal reason quotes.
const REASON_ANSWER_MAX: usize = 80;

/// Where the agent key is read from when the env var is unset.
pub fn env_file() -> PathBuf {
    std::env::var("AGENTBOX_ENV_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/home/devuser/workspace/project/agentbox/.env"))
}

/// Whether forum governance I/O is enabled (`DREAM_GOVERNANCE=0` opts out).
pub fn enabled() -> bool {
    std::env::var("DREAM_GOVERNANCE").as_deref() != Ok("0")
}

/// The `d` tag of the case for inbox item `id`.
pub fn case_d(id: &str) -> String {
    format!("dream-{id}")
}

/// The inbox id a case `d` tag refers to.
pub fn item_id_of(d: &str) -> Option<&str> {
    d.strip_prefix("dream-")
        .filter(|s| !s.is_empty() && *s != "machine")
}

fn task_properties() -> TaskProperties {
    // Answers only steer the next night's hypothesis; nothing is applied
    // automatically, so every case is inspectable, reversible and bounded.
    TaskProperties::new(
        Verifiability::Inspectable,
        Reversibility::Reversible,
        Stakes::Bounded,
    )
}

/// The panel definition (content of the 31400).
pub fn panel_definition() -> PanelDefinition {
    PanelDefinition {
        title: "Dream machine decisions".into(),
        description: "Questions and alerts from the nightly dream machine. Approve, Reject \
                      (say why) or Amend (write your own instruction) on each case; the \
                      engine reads your decision at the start of the next night."
            .into(),
        version: "1.1.0".into(),
        schema: PanelSchema::ActionInbox,
        fields: vec![
            field("repo", FieldType::String, "Repository"),
            field("night", FieldType::String, "Night"),
            field("kind", FieldType::Enum, "Kind"),
            field("question", FieldType::String, "Question"),
            field("outcome", FieldType::String, "What the night produced"),
            field("pr", FieldType::String, "Pull request"),
            field("evidence", FieldType::String, "Evidence"),
        ],
        actions: vec![ActionDef {
            id: ACK_ALERTS_ACTION.into(),
            label: "Acknowledge all alerts".into(),
            style: ActionStyle::Secondary,
        }],
        layout: LayoutHint::InboxTable,
        capabilities: vec![PanelCapability::Filter, PanelCapability::Sort],
        refresh_secs: 300,
        task_properties: Some(task_properties()),
        calibration_sample_rate: None,
        max_pending_hours: Some(MAX_PENDING_HOURS),
        probe_agent: None,
    }
}

fn field(name: &str, field_type: FieldType, label: &str) -> FieldDef {
    FieldDef {
        name: name.into(),
        field_type,
        label: label.into(),
    }
}

/// Unsigned 31400 for the panel.
pub fn panel_event(pubkey: &str, created_at: u64) -> UnsignedEvent {
    let def = panel_definition();
    let mut tags = vec![vec!["d".to_string(), PANEL_D.to_string()]];
    tags.extend(task_properties().to_tags());
    tags.extend(
        PanelPolicy {
            max_pending_hours: MAX_PENDING_HOURS,
            ..PanelPolicy::default()
        }
        .to_tags(),
    );
    tags.push(vec!["t".into(), "dream-cycle".into()]);
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at,
        kind: KIND_PANEL_DEFINITION,
        tags,
        content: serde_json::to_string(&def).unwrap_or_default(),
    }
}

/// First `http(s)://` URL in `text`, if any — the case's context link.
fn first_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|w| w.starts_with("https://") || w.starts_with("http://"))
        .map(|w| {
            w.trim_end_matches(|c: char| ",.;:)]|*`'\"".contains(c))
                .to_string()
        })
}

/// The item text without the `| … |` table fence a ledger-derived ask carries.
fn clean_text(text: &str) -> String {
    text.trim_matches(|c: char| c == '|' || c.is_whitespace())
        .to_string()
}

/// Where the evidence for an item lives on the agentbox host.
fn evidence_for(item: &InboxItem) -> String {
    if item.repo == "roster" {
        "engine night-health record: workspace/.agentbox/dream-last-night.json".into()
    } else {
        format!(
            "workspace/.tmp/dream-annexe-artefacts/{}/report.md · {} ledger",
            item.night_id, item.repo
        )
    }
}

/// What the engine recorded about the night a case came from, so the forum
/// can say in plain words what happened and link the pull request if there is
/// one. Every field is optional: a case whose artefacts are gone still renders.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CaseContext {
    /// The area of the repository the night examined (the "deep").
    pub deep: Option<String>,
    /// The ledger's one-line finding for the night.
    pub finding: Option<String>,
    /// Final gate verdict: ACCEPT, REJECT, INCONCLUSIVE or BLOCKED-ENV.
    pub verdict: Option<String>,
    /// The verdict the model claimed before the gate checked it.
    pub model_verdict: Option<String>,
    /// First gate veto, when the gate overruled the model.
    pub veto: Option<String>,
    /// Draft pull request opened for the night, if any.
    pub pr_url: Option<String>,
}

/// Where [`case_context`] reads a night's record from.
#[derive(Debug, Clone)]
pub struct CasePaths {
    /// Workspace root holding the nominated repositories.
    pub workspace: PathBuf,
    /// Night artefact directory (`<night_id>/manifest.json`, `gate.json`).
    pub artefact_dir: PathBuf,
}

/// Split a Markdown table row on unescaped pipes (`\|` stays in its cell).
fn ledger_cells(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = t.strip_suffix('|').unwrap_or(t);
    t.replace("\\|", "\u{0}")
        .split('|')
        .map(|c| c.trim().replace('\u{0}', "|"))
        .collect()
}

/// The ledger row for `date` (and `deep`, when known): `(finding, pr)`.
/// Columns: Date | Deep | Finding | Issue | PR | …; the last matching row wins
/// (a re-run night appends a newer row).
fn ledger_row(ledger: &str, date: &str, deep: Option<&str>) -> Option<(String, String)> {
    ledger
        .lines()
        .filter(|l| l.trim_start().starts_with('|'))
        .map(ledger_cells)
        .rev()
        .find(|c| c.len() >= 5 && c[0] == date && deep.is_none_or(|d| c[1] == d))
        .map(|c| (c[2].clone(), c[4].clone()))
}

/// Gather what the engine recorded about `item`'s night. Missing files leave
/// fields empty; nothing here fails.
pub fn case_context(paths: &CasePaths, item: &InboxItem) -> CaseContext {
    let mut ctx = CaseContext::default();
    if item.repo == "roster" || item.night_id.is_empty() {
        return ctx;
    }
    let night = paths.artefact_dir.join(&item.night_id);
    let read_json = |name: &str| -> Option<serde_json::Value> {
        serde_json::from_slice(&std::fs::read(night.join(name)).ok()?).ok()
    };
    if let Some(m) = read_json("manifest.json") {
        ctx.deep = m["deep"].as_str().map(str::to_string);
    }
    if let Some(g) = read_json("gate.json") {
        ctx.verdict = g["verdict"].as_str().map(str::to_string);
        ctx.model_verdict = g["modelVerdict"].as_str().map(str::to_string);
        ctx.veto = g["vetoes"]
            .as_array()
            .and_then(|v| v.first())
            .and_then(|v| v["reason"].as_str())
            .map(|r| r.split_whitespace().collect::<Vec<_>>().join(" "));
    }
    let ledger = paths
        .workspace
        .join(&item.repo)
        .join("docs/dream-cycle/LEDGER.md");
    if let Ok(text) = std::fs::read_to_string(ledger) {
        if let Some((finding, pr)) = ledger_row(&text, &item.date, ctx.deep.as_deref()) {
            if !finding.is_empty() && finding != "NONE" {
                ctx.finding = Some(finding);
            }
            if pr.starts_with("https://") {
                ctx.pr_url = Some(pr);
            }
        }
    }
    ctx
}

/// `#58` from `https://github.com/o/r/pull/58`.
fn pr_number(url: &str) -> Option<&str> {
    let n = url.trim_end_matches('/').rsplit('/').next()?;
    n.chars().all(|c| c.is_ascii_digit()).then_some(n)
}

/// "Thu 9 Oct 2026" from "2026-10-09"; the input unchanged if it is not a date.
fn long_date(date: &str) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| d.format("%a %-d %b %Y").to_string())
        .unwrap_or_else(|_| date.to_string())
}

/// "9 Oct" from "2026-10-09".
fn short_date(date: &str) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| d.format("%-d %b").to_string())
        .unwrap_or_else(|_| date.to_string())
}

/// Plain-English reading of a gate veto.
fn explain_veto(veto: &str) -> String {
    let v = veto.to_lowercase();
    let why = if v.contains("did not apply") || v.contains("corrupt patch") {
        "its patch could not be applied to the code it was written against".to_string()
    } else if v.contains("no ```dream-patch") || v.contains("no candidate patch") {
        "it claimed a fix but supplied no patch to test".to_string()
    } else if v.contains("did not pass") || v.contains("failed") {
        "the required checks failed when re-run on the change".to_string()
    } else {
        veto.chars().take(160).collect()
    };
    why
}

/// One short line for the panel's "What the night produced" column.
pub fn outcome_line(ctx: &CaseContext) -> String {
    if let Some(url) = &ctx.pr_url {
        return match pr_number(url) {
            Some(n) => format!("Draft PR #{n} opened for review"),
            None => "Draft PR opened for review".into(),
        };
    }
    match ctx.verdict.as_deref() {
        Some("ACCEPT") => "Accepted, but no PR was recorded".into(),
        Some("REJECT") if ctx.model_verdict.as_deref() == Some("ACCEPT") => {
            "No PR: the engine overruled the claimed fix".into()
        }
        Some("REJECT") => "No PR: the idea did not hold up".into(),
        Some("BLOCKED-ENV") => "No PR: night lost to an environment fault".into(),
        Some("INCONCLUSIVE") => "No PR: inconclusive".into(),
        _ => String::new(),
    }
}

/// The sentence(s) saying what the night produced, or empty when unknown.
fn outcome_sentence(ctx: &CaseContext) -> String {
    if let Some(url) = &ctx.pr_url {
        let label = pr_number(url)
            .map(|n| format!("draft pull request #{n}"))
            .unwrap_or_else(|| "a draft pull request".into());
        return format!(
            "The engine re-ran the repository's required checks against the change, they \
             passed, and it opened {label} for review:\n{url}\nNothing is merged until a \
             person merges it."
        );
    }
    let overruled =
        ctx.model_verdict.as_deref() == Some("ACCEPT") && ctx.verdict.as_deref() != Some("ACCEPT");
    match (ctx.verdict.as_deref(), overruled) {
        (Some("ACCEPT"), _) => {
            "The engine upheld the change, but no pull request was recorded for it.".into()
        }
        (Some(v), true) => {
            let why = ctx
                .veto
                .as_deref()
                .map(explain_veto)
                .unwrap_or_else(|| "it did not survive the engine's checks".into());
            let env = if v == "BLOCKED-ENV" {
                " The fault is in the engine or its environment, not in the repository."
            } else {
                ""
            };
            format!(
                "The model believed this change was an improvement, but the engine refused \
                 it because {why}. No pull request was opened, so there is nothing \
                 to merge from this night.{env}"
            )
        }
        (Some("REJECT"), false) => {
            "The night tested an idea and it did not hold up, so no pull request was opened.".into()
        }
        (Some("INCONCLUSIVE"), false) => {
            "The night ended inconclusive (not enough evidence either way), so no pull \
             request was opened."
                .into()
        }
        (Some("BLOCKED-ENV"), false) => {
            "The night was lost to a fault in the engine or its environment, not in the \
             repository, so no pull request was opened."
                .into()
        }
        _ => String::new(),
    }
}

fn title_for(item: &InboxItem, ctx: &CaseContext) -> String {
    let text = clean_text(&item.text).replace('\n', " ");
    let text = crate::inbox::decision_fields(&text)
        .map(|f| f.decision)
        .unwrap_or(text);
    let when = short_date(&item.date);
    let mut title = if item.kind == "alert" {
        format!("Alert · {} · {when} · {text}", item.repo)
    } else {
        match ctx.pr_url.as_deref().and_then(pr_number) {
            Some(n) => format!("{} · {when} · PR #{n} · {text}", item.repo),
            None => format!("{} · {when} · {text}", item.repo),
        }
    };
    if title.chars().count() > TITLE_MAX {
        title = title.chars().take(TITLE_MAX - 1).collect::<String>() + "…";
    }
    title
}

/// The case body: what happened, what is asked, how to answer.
fn reasoning_for(item: &InboxItem, ctx: &CaseContext) -> String {
    let when = long_date(&item.date);
    let text = clean_text(&item.text);
    let area = ctx
        .deep
        .as_deref()
        .map(|d| format!(" the \u{201c}{d}\u{201d} area of"))
        .unwrap_or_default();
    // The ledger marks a vetoed night's finding "VETOED: …"; the outcome
    // sentence already says so, in words.
    let finding = ctx
        .finding
        .as_deref()
        .map(|f| match f.strip_prefix("VETOED:") {
            Some(rest) => format!(" It proposed: \u{201c}{}\u{201d}.", rest.trim()),
            None => format!(" Its finding: \u{201c}{f}\u{201d}."),
        })
        .unwrap_or_default();
    let outcome = outcome_sentence(ctx);
    let outcome = if outcome.is_empty() {
        String::new()
    } else {
        format!(" {outcome}")
    };
    if item.kind == "alert" {
        let happened = if outcome.is_empty() {
            format!(" It reported: {text}")
        } else {
            format!("{finding}{outcome}")
        };
        let detail = if outcome.is_empty() {
            String::new()
        } else {
            format!("\n\nEngine detail\n{text}")
        };
        format!(
            "What happened\n\
             On {when} the dream engine flagged a problem with its night on{area} {repo}.{happened}\n\n\
             What you need to do\n\
             Usually nothing beyond acknowledging it: Approve. Reject if you think the alert is \
             wrong (say why); Amend to tell the engine to do something different. Alerts about \
             lost nights point at the engine or its environment, not the repository's code.{detail}",
            repo = item.repo
        )
    } else {
        let asked = match crate::inbox::decision_fields(&text) {
            Some(f) => {
                let mut a = format!("Decision: {}", f.decision);
                if !f.why.is_empty() {
                    a.push_str(&format!("\nWhy: {}", f.why));
                }
                a.push_str(&format!("\nIf you approve: {}", f.if_approved));
                if !f.if_not.is_empty() {
                    a.push_str(&format!("\nIf you do not: {}", f.if_not));
                }
                a
            }
            None => text,
        };
        format!(
            "What happened\n\
             On {when} the dream engine examined{area} {repo}.{finding}{outcome}\n\n\
             What you are being asked\n\
             {asked}\n\n\
             How to answer\n\
             Approve accepts the recommendation as written. Reject declines it (please say \
             why). Amend replaces it with your own instruction. Your answer becomes guidance \
             for this repository's next night; approving does not merge anything.",
            repo = item.repo
        )
    }
}

/// Unsigned 31402 for one inbox item. `ctx` comes from [`case_context`];
/// pass `CaseContext::default()` when the night's record is unavailable.
pub fn request_event(
    pubkey: &str,
    item: &InboxItem,
    ctx: &CaseContext,
    created_at: u64,
) -> UnsignedEvent {
    let is_alert = item.kind == "alert";
    let (tier, priority) = if is_alert {
        (RiskTier::Low, ActionPriority::Low)
    } else {
        (RiskTier::Medium, ActionPriority::Medium)
    };
    let evidence = evidence_for(item);
    let request = ActionRequest {
        fields: json!({
            "repo": item.repo,
            "night": item.night_id,
            "kind": item.kind,
            "question": clean_text(&item.text),
            "outcome": outcome_line(ctx),
            "pr": ctx.pr_url.clone().unwrap_or_default(),
            "evidence": evidence,
        }),
        reasoning: Some(reasoning_for(item, ctx)),
        context_url: ctx.pr_url.clone().or_else(|| first_url(&item.text)),
        risk_tier: Some(tier),
        confidence: None,
        task_properties: None,
        probe: None,
    };
    let priority_label = serde_json::to_value(&priority)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "medium".into());
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at,
        kind: KIND_ACTION_REQUEST,
        tags: vec![
            vec!["d".into(), case_d(&item.id)],
            vec![
                "a".into(),
                format!("{KIND_PANEL_DEFINITION}:{pubkey}:{PANEL_D}"),
            ],
            vec!["panel".into(), PANEL_D.into()],
            vec!["priority".into(), priority_label],
            vec!["risk-tier".into(), tier.as_str().into()],
            vec!["category".into(), "workflow_review".into()],
            vec!["subject-kind".into(), "dream-night".into()],
            vec!["subject-id".into(), item.repo.clone()],
            vec!["title".into(), title_for(item, ctx)],
            vec!["t".into(), "dream-cycle".into()],
        ],
        content: serde_json::to_string(&request).unwrap_or_default(),
    }
}

/// Content of the kind-5 that withdraws `item`'s case:
/// `resolved: <status> <date> — <first 80 chars of the answer>`.
pub fn withdrawal_reason(item: &InboxItem, date: &str) -> String {
    let answer = item.answer.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut reason = format!("resolved: {} {date}", item.status);
    if !answer.is_empty() {
        let quoted: String = answer.chars().take(REASON_ANSWER_MAX).collect();
        reason.push_str(" — ");
        reason.push_str(&quoted);
        if answer.chars().count() > REASON_ANSWER_MAX {
            reason.push('…');
        }
    }
    reason
}

/// Unsigned NIP-09 kind-5 withdrawing the case `item` was published as
/// (`item.published_event_id`).
///
/// Tags: `e` = the request id; `a` = the case's `<kind>:<pubkey>:<d>`
/// coordinate when the request is addressable and `with_coordinate` is set;
/// `k` = the request kind. The kind and `d` tag are read from
/// [`request_event`], so the coordinate cannot drift from what was published.
///
/// The relay deletes every version at a coordinate regardless of age, so the
/// caller clears `with_coordinate` when a newer open item reuses the same id
/// (and therefore the same `d`) — withdrawing the old case must not delete the
/// live one.
pub fn withdrawal_event(
    pubkey: &str,
    item: &InboxItem,
    with_coordinate: bool,
    date: &str,
    created_at: u64,
) -> UnsignedEvent {
    let request = request_event(pubkey, item, &CaseContext::default(), created_at);
    let mut tags = vec![vec!["e".to_string(), item.published_event_id.clone()]];
    if with_coordinate && (30_000..40_000).contains(&request.kind) {
        if let Some(d) = request
            .tags
            .iter()
            .find(|t| t.first().map(String::as_str) == Some("d"))
            .and_then(|t| t.get(1))
        {
            tags.push(vec!["a".into(), format!("{}:{pubkey}:{d}", request.kind)]);
        }
    }
    tags.push(vec!["k".into(), request.kind.to_string()]);
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at,
        kind: KIND_DELETION,
        tags,
        content: withdrawal_reason(item, date),
    }
}

/// A case the engine will withdraw.
#[derive(Debug, Clone)]
pub struct Withdrawal {
    /// The resolved item (its `published_event_id` is the request to delete).
    pub item: InboxItem,
    /// Whether the deletion may also name the case's `a` coordinate.
    pub with_coordinate: bool,
}

/// Pure sweep planner: every item that is no longer open, was published, and
/// has not been withdrawn yet. The coordinate is withheld when an open item
/// shares the id (see [`withdrawal_event`]).
pub fn plan_withdrawals(items: &[InboxItem]) -> Vec<Withdrawal> {
    items
        .iter()
        .filter(|i| {
            i.status != "open"
                && !i.published_event_id.is_empty()
                && i.withdrawn_event_id.is_empty()
        })
        .map(|i| Withdrawal {
            item: i.clone(),
            with_coordinate: !items.iter().any(|o| o.status == "open" && o.id == i.id),
        })
        .collect()
}

fn today_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Print the unsigned deletions for `plan` (dry run); returns how many.
fn print_withdrawals(pubkey: &str, plan: &[Withdrawal]) -> usize {
    let (date, now) = (today_utc(), relay::now_secs());
    for w in plan {
        println!(
            "{}",
            serde_json::to_string_pretty(&withdrawal_event(
                pubkey,
                &w.item,
                w.with_coordinate,
                &date,
                now
            ))
            .unwrap_or_default()
        );
    }
    plan.len()
}

/// Sign and send the deletions for `plan` over `session`, recording each
/// accepted one in the inbox. A rejection is logged and left unrecorded (the
/// next sweep retries it); a transport error stops the run (fail-open).
async fn send_withdrawals(
    session: &mut RelaySession,
    key: &SigningKey,
    inbox_path: &Path,
    plan: &[Withdrawal],
    report: &mut Report,
) {
    let pubkey = relay::pubkey_hex(key);
    let date = today_utc();
    for w in plan {
        let unsigned = withdrawal_event(
            &pubkey,
            &w.item,
            w.with_coordinate,
            &date,
            relay::now_secs(),
        );
        let ev = match relay::sign(unsigned, key) {
            Ok(ev) => ev,
            Err(e) => {
                warn!(item = %w.item.id, error = %e, "governance: withdrawal signing failed");
                continue;
            }
        };
        match session.publish(&ev).await {
            Ok(r) if r.accepted => {
                report.withdrawn += 1;
                if let Err(e) = inbox::mark_withdrawn_in(
                    inbox_path,
                    &w.item.id,
                    &w.item.published_event_id,
                    &ev.id,
                ) {
                    warn!(item = %w.item.id, error = %e, "governance: could not record withdrawal");
                }
            }
            Ok(r) => {
                report.rejected += 1;
                warn!(item = %w.item.id, message = %r.message, "governance: withdrawal rejected by relay");
            }
            Err(e) => {
                warn!(item = %w.item.id, error = %e, "governance: withdrawal failed — stopping this run");
                break;
            }
        }
    }
}

/// Withdraw every resolved, published, not-yet-withdrawn case (the sweep on
/// its own). `dry_run` prints the unsigned deletions and sends nothing.
pub async fn withdraw(inbox_path: &Path, dry_run: bool) -> Report {
    let mut report = Report::default();
    let plan = plan_withdrawals(&inbox::load_from(inbox_path));
    if dry_run {
        let pubkey = load_key()
            .map(|k| relay::pubkey_hex(&k))
            .unwrap_or_else(|| "<agent pubkey>".into());
        report.skipped = print_withdrawals(&pubkey, &plan);
        return report;
    }
    if plan.is_empty() {
        return report;
    }
    let Some(key) = load_key() else { return report };
    let mut session = match RelaySession::connect(&relay::relay_url(), &key).await {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "governance: relay unreachable — withdraw skipped (fail-open)");
            return report;
        }
    };
    send_withdrawals(&mut session, &key, inbox_path, &plan, &mut report).await;
    session.close().await;
    info!(
        withdrawn = report.withdrawn,
        rejected = report.rejected,
        "governance: withdraw done"
    );
    report
}

/// What a decision does to an inbox item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    /// `answered` or `dismissed`.
    pub status: &'static str,
    /// Recorded answer text (carry-over input).
    pub answer: String,
}

fn reasoning_of(content: &str) -> String {
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| {
            v.get("reasoning")
                .and_then(|r| r.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn with_reason(verb: &str, reason: &str) -> String {
    if reason.is_empty() {
        format!("{verb} (no rationale given)")
    } else {
        format!("{verb}: {reason}")
    }
}

/// Map a case decision to an inbox resolution.
///
/// | Decision | Question item                  | Alert item                        |
/// |----------|--------------------------------|-----------------------------------|
/// | approve  | answered `approve: <why>`      | dismissed `acknowledged: <why>`   |
/// | reject   | answered `reject: <why>`       | answered `reject: <why>`          |
/// | amend    | answered `amend: <text> — <why>` | same                            |
/// | delegate / other | stays open             | stays open                        |
///
/// The content is the forum's internally tagged `DecisionOutcome` JSON plus
/// `reasoning`, parsed with core's own `DecisionOutcome`.
pub fn resolution_for(item_kind: &str, content: &str) -> Option<Resolution> {
    let reason = reasoning_of(content);
    match DecisionOutcome::from_response_content(content)? {
        DecisionOutcome::Approve if item_kind == "alert" => Some(Resolution {
            status: "dismissed",
            answer: with_reason("acknowledged", &reason),
        }),
        DecisionOutcome::Approve => Some(Resolution {
            status: "answered",
            answer: with_reason("approve", &reason),
        }),
        DecisionOutcome::Reject => Some(Resolution {
            status: "answered",
            answer: with_reason("reject", &reason),
        }),
        DecisionOutcome::Amend { diff } => {
            let diff = diff.trim();
            if diff.is_empty() {
                return None; // the forum refuses an empty amendment too
            }
            Some(Resolution {
                status: "answered",
                answer: if reason.is_empty() {
                    format!("amend: {diff}")
                } else {
                    format!("amend: {diff} — {reason}")
                },
            })
        }
        _ => None,
    }
}

/// Plain `e` tag (no marker): the request a decision is bound to.
fn bound_request(ev: &NostrEvent) -> Option<&str> {
    ev.tags
        .iter()
        .find(|t| {
            t.first().map(String::as_str) == Some("e") && t.get(3).is_none_or(|m| m.is_empty())
        })
        .and_then(|t| t.get(1))
        .map(String::as_str)
}

fn d_of(ev: &NostrEvent) -> Option<&str> {
    ev.tags
        .iter()
        .find(|t| t.first().map(String::as_str) == Some("d"))
        .and_then(|t| t.get(1))
        .map(String::as_str)
}

/// A decision the engine will apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub item_id: String,
    pub resolution: Resolution,
    pub decision_event_id: String,
}

/// Pure decision planner: given the inbox and the fetched 31403 events,
/// return what to apply. Rules:
/// - only valid signatures, never signed by `agent_pubkey` (no self-review);
/// - a case decision must name the item's published request when one is
///   recorded (a decision on an older version of the case does not count);
/// - newest decision per case wins (supersession);
/// - the panel-level `acknowledge-alerts` dismisses open alerts published
///   before it was signed.
pub fn plan_decisions(
    items: &[InboxItem],
    decisions: &[NostrEvent],
    agent_pubkey: &str,
    published_at: &HashMap<String, u64>,
) -> Vec<Applied> {
    let valid: Vec<&NostrEvent> = decisions
        .iter()
        .filter(|e| e.kind == KIND_ACTION_RESPONSE)
        .filter(|e| !e.pubkey.eq_ignore_ascii_case(agent_pubkey))
        .filter(|e| relay::verify(e))
        .collect();

    let mut newest: HashMap<&str, &NostrEvent> = HashMap::new();
    for ev in &valid {
        let Some(d) = d_of(ev) else { continue };
        let keep = newest
            .get(d)
            .is_none_or(|held| (ev.created_at, &ev.id) > (held.created_at, &held.id));
        if keep {
            newest.insert(d, ev);
        }
    }

    let mut out = Vec::new();
    for item in items.iter().filter(|i| i.status == "open") {
        let d = case_d(&item.id);
        if let Some(ev) = newest.get(d.as_str()) {
            let bound_ok = item.published_event_id.is_empty()
                || bound_request(ev).is_none_or(|r| r == item.published_event_id);
            if bound_ok {
                if let Some(resolution) = resolution_for(&item.kind, &ev.content) {
                    out.push(Applied {
                        item_id: item.id.clone(),
                        resolution,
                        decision_event_id: ev.id.clone(),
                    });
                    continue;
                }
            }
        }
        if item.kind == "alert" {
            if let Some(ack) = newest.get(PANEL_D) {
                let action = serde_json::from_str::<serde_json::Value>(&ack.content)
                    .ok()
                    .and_then(|v| v.get("action").and_then(|a| a.as_str()).map(str::to_string));
                let published = published_at.get(&item.id).copied().unwrap_or(0);
                if action.as_deref() == Some(ACK_ALERTS_ACTION)
                    && published > 0
                    && published <= ack.created_at
                {
                    out.push(Applied {
                        item_id: item.id.clone(),
                        resolution: Resolution {
                            status: "dismissed",
                            answer: with_reason(
                                "acknowledged (panel)",
                                &reasoning_of(&ack.content),
                            ),
                        },
                        decision_event_id: ack.id.clone(),
                    });
                }
            }
        }
    }
    out
}

fn load_key() -> Option<SigningKey> {
    match relay::load_signing_key(KEY_VAR, &env_file()) {
        Ok(k) => Some(k),
        Err(e) => {
            warn!(error = %e, "governance: agent key unavailable — skipped (fail-open)");
            None
        }
    }
}

/// Outcome counts for logs and the CLI.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Report {
    pub published: usize,
    pub rejected: usize,
    pub resolved: usize,
    /// Cases withdrawn from the panel by a kind-5 deletion.
    pub withdrawn: usize,
    pub skipped: usize,
}

/// Publish the panel, withdraw every resolved case still on it (the nightly
/// sweep, which also catches items resolved by hand), then publish every
/// open, not-yet-published inbox item. `dry_run` prints the unsigned events
/// and sends nothing.
pub async fn publish(inbox_path: &Path, paths: &CasePaths, dry_run: bool) -> Report {
    let mut report = Report::default();
    let all = inbox::load_from(inbox_path);
    let withdrawals = plan_withdrawals(&all);
    let items: Vec<InboxItem> = all.into_iter().filter(|i| i.status == "open").collect();
    let now = relay::now_secs();

    if dry_run {
        let pubkey = load_key()
            .map(|k| relay::pubkey_hex(&k))
            .unwrap_or_else(|| "<agent pubkey>".into());
        println!(
            "{}",
            serde_json::to_string_pretty(&panel_event(&pubkey, now)).unwrap_or_default()
        );
        report.skipped += print_withdrawals(&pubkey, &withdrawals);
        for item in items.iter().filter(|i| i.published_event_id.is_empty()) {
            println!(
                "{}",
                serde_json::to_string_pretty(&request_event(
                    &pubkey,
                    item,
                    &case_context(paths, item),
                    now
                ))
                .unwrap_or_default()
            );
            report.skipped += 1;
        }
        return report;
    }

    let Some(key) = load_key() else { return report };
    let pubkey = relay::pubkey_hex(&key);
    let url = relay::relay_url();
    let mut session = match RelaySession::connect(&url, &key).await {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "governance: relay unreachable — publish skipped (fail-open)");
            return report;
        }
    };

    // The panel: republish only when the relay's copy differs from ours.
    let current = session
        .query(
            json!({"kinds": [KIND_PANEL_DEFINITION], "authors": [pubkey], "#d": [PANEL_D], "limit": 1}),
            Duration::from_secs(8),
        )
        .await
        .unwrap_or_default();
    let want = panel_event(&pubkey, now);
    let same = current
        .iter()
        .any(|e| e.content == want.content && e.tags == want.tags);
    if !same {
        match relay::sign(want, &key) {
            Ok(ev) => match session.publish(&ev).await {
                Ok(r) if r.accepted => info!(id = %r.event_id, "governance: panel published"),
                Ok(r) => {
                    warn!(message = %r.message, "governance: panel rejected — requests would not render; stopping");
                    session.close().await;
                    return report;
                }
                Err(e) => warn!(error = %e, "governance: panel publish failed"),
            },
            Err(e) => warn!(error = %e, "governance: panel signing failed"),
        }
    }

    // Sweep before publishing: a resolved case leaves the panel even when it
    // was resolved outside `ingest`.
    send_withdrawals(&mut session, &key, inbox_path, &withdrawals, &mut report).await;

    for item in items.iter().filter(|i| i.published_event_id.is_empty()) {
        let ctx = case_context(paths, item);
        let ev = match relay::sign(request_event(&pubkey, item, &ctx, now), &key) {
            Ok(ev) => ev,
            Err(e) => {
                warn!(item = %item.id, error = %e, "governance: signing failed");
                continue;
            }
        };
        match session.publish(&ev).await {
            Ok(r) if r.accepted => {
                report.published += 1;
                if let Err(e) = inbox::mark_published_in(inbox_path, &item.id, &ev.id) {
                    warn!(item = %item.id, error = %e, "governance: could not record publish");
                }
            }
            Ok(r) => {
                report.rejected += 1;
                warn!(item = %item.id, message = %r.message, "governance: case rejected by relay");
            }
            Err(e) => {
                warn!(item = %item.id, error = %e, "governance: publish failed — stopping this run");
                break;
            }
        }
    }
    session.close().await;
    info!(
        published = report.published,
        withdrawn = report.withdrawn,
        rejected = report.rejected,
        "governance: publish done"
    );
    report
}

/// Fetch decisions for published cases, resolve their inbox items, and
/// withdraw the cases just resolved from the panel. `dry_run` prints what
/// would change and writes or sends nothing.
pub async fn ingest(inbox_path: &Path, dry_run: bool) -> Report {
    let mut report = Report::default();
    let items = inbox::load_from(inbox_path);
    let published: Vec<&InboxItem> = items
        .iter()
        .filter(|i| i.status == "open" && !i.published_event_id.is_empty())
        .collect();
    if published.is_empty() {
        return report;
    }
    let Some(key) = load_key() else { return report };
    let pubkey = relay::pubkey_hex(&key);
    let mut session = match RelaySession::connect(&relay::relay_url(), &key).await {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "governance: relay unreachable — ingest skipped (fail-open)");
            return report;
        }
    };

    // Publish times of the cases, read back from the relay, so the panel-level
    // acknowledgement only covers alerts that existed when it was pressed.
    let request_ids: Vec<String> = published
        .iter()
        .map(|i| i.published_event_id.clone())
        .collect();
    let mut published_at: HashMap<String, u64> = HashMap::new();
    let mut decisions = Vec::new();
    for chunk in request_ids.chunks(100) {
        let reqs = session
            .query(json!({"ids": chunk}), Duration::from_secs(10))
            .await
            .unwrap_or_default();
        for r in reqs {
            if let Some(item) = published.iter().find(|i| i.published_event_id == r.id) {
                published_at.insert(item.id.clone(), r.created_at);
            }
        }
    }
    let mut ds: Vec<String> = published.iter().map(|i| case_d(&i.id)).collect();
    ds.push(PANEL_D.to_string());
    for chunk in ds.chunks(100) {
        decisions.extend(
            session
                .query(
                    json!({"kinds": [KIND_ACTION_RESPONSE], "#d": chunk, "limit": 500}),
                    Duration::from_secs(10),
                )
                .await
                .unwrap_or_default(),
        );
    }

    let mut just_resolved: Vec<String> = Vec::new();
    for applied in plan_decisions(&items, &decisions, &pubkey, &published_at) {
        if dry_run {
            println!(
                "{} → {} ({}) [decision {}] — case would be withdrawn",
                applied.item_id,
                applied.resolution.status,
                applied.resolution.answer,
                applied.decision_event_id
            );
            report.skipped += 1;
            continue;
        }
        match inbox::resolve_in(
            inbox_path,
            &applied.item_id,
            applied.resolution.status,
            &applied.resolution.answer,
            &applied.decision_event_id,
        ) {
            Ok(true) => {
                report.resolved += 1;
                just_resolved.push(applied.item_id);
            }
            Ok(false) => {}
            Err(e) => warn!(item = %applied.item_id, error = %e, "governance: inbox write failed"),
        }
    }

    if !just_resolved.is_empty() {
        let plan: Vec<Withdrawal> = plan_withdrawals(&inbox::load_from(inbox_path))
            .into_iter()
            .filter(|w| just_resolved.contains(&w.item.id))
            .collect();
        send_withdrawals(&mut session, &key, inbox_path, &plan, &mut report).await;
    }
    session.close().await;
    info!(
        resolved = report.resolved,
        withdrawn = report.withdrawn,
        "governance: ingest done"
    );
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{pubkey_hex, sign};

    const AGENT_SK: &str = "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
    const ADMIN_SK: &str = "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

    fn key(hex_sk: &str) -> SigningKey {
        let bytes: [u8; 32] = hex::decode(hex_sk).unwrap().try_into().unwrap();
        nostr_bbs_core::keys::signing_key_from_bytes(&bytes).unwrap()
    }

    fn item(id: &str, kind: &str, text: &str) -> InboxItem {
        InboxItem {
            id: id.into(),
            kind: kind.into(),
            repo: "dreamlab-ai-website".into(),
            night_id: "2026-09-09-dreamlab-ai-website".into(),
            date: "2026-09-09".into(),
            text: text.into(),
            status: "open".into(),
            answer: String::new(),
            last_surfaced: 0,
            published_event_id: String::new(),
            decision_event_id: String::new(),
            withdrawn_event_id: String::new(),
        }
    }

    fn tag<'a>(tags: &'a [Vec<String>], k: &str) -> Option<&'a str> {
        tags.iter().find(|t| t[0] == k).map(|t| t[1].as_str())
    }

    fn decision(
        sk: &str,
        d: &str,
        request: Option<&str>,
        content: serde_json::Value,
        at: u64,
    ) -> NostrEvent {
        let k = key(sk);
        let mut tags = vec![vec!["d".to_string(), d.to_string()]];
        if let Some(r) = request {
            tags.push(vec!["e".into(), r.into()]);
        }
        sign(
            UnsignedEvent {
                pubkey: pubkey_hex(&k),
                created_at: at,
                kind: KIND_ACTION_RESPONSE,
                tags,
                content: content.to_string(),
            },
            &k,
        )
        .unwrap()
    }

    #[test]
    fn panel_round_trips_through_core_and_carries_policy_tags() {
        let ev = panel_event("ab", 10);
        assert_eq!(ev.kind, 31400);
        assert_eq!(tag(&ev.tags, "d"), Some(PANEL_D));
        // Round-trip through the forum's own type, as the relay reads it.
        let def: PanelDefinition = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(def, panel_definition());
        assert_eq!(def.policy().max_pending_hours, MAX_PENDING_HOURS);
        // The tag-declared policy and task properties agree with the content,
        // so the relay's tag-based boundary equals the panel's declaration.
        assert_eq!(
            PanelPolicy::from_tags(&ev.tags).max_pending_hours,
            MAX_PENDING_HOURS
        );
        assert_eq!(TaskProperties::from_tags(&ev.tags), def.task_properties);
        // Wire enums are kebab-case, as the forum and relay parse them.
        let raw: serde_json::Value = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(raw["schema"], "action-inbox");
        assert_eq!(raw["layout"], "inbox-table");
        assert_eq!(raw["fields"][0]["field_type"], "string");
    }

    #[test]
    fn request_addresses_the_panel_and_round_trips() {
        let pk = pubkey_hex(&key(AGENT_SK));
        let it = item(
            "15a655c8",
            "question",
            "Review + merge the branch; see https://github.com/x/y/pull/3.",
        );
        let ev = request_event(&pk, &it, &CaseContext::default(), 20);
        assert_eq!(ev.kind, 31402);
        assert_eq!(tag(&ev.tags, "d"), Some("dream-15a655c8"));
        assert_eq!(
            tag(&ev.tags, "a").unwrap(),
            format!("31400:{pk}:dream-machine")
        );
        assert_eq!(tag(&ev.tags, "panel"), Some(PANEL_D));
        assert_eq!(tag(&ev.tags, "priority"), Some("medium"));
        assert_eq!(tag(&ev.tags, "risk-tier"), Some("medium"));
        assert!(tag(&ev.tags, "title").unwrap().chars().count() <= TITLE_MAX);
        let req: ActionRequest = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(req.fields["question"], it.text.as_str());
        assert_eq!(req.fields["kind"], "question");
        assert_eq!(req.risk_tier, Some(RiskTier::Medium));
        assert_eq!(
            req.context_url.as_deref(),
            Some("https://github.com/x/y/pull/3")
        );
        // The declared tier tag and content agree (the relay reads the tag
        // when content omits it; the forum reads content first).
        assert_eq!(
            RiskTier::parse(tag(&ev.tags, "risk-tier").unwrap()),
            req.risk_tier.unwrap()
        );
        let signed = sign(ev, &key(AGENT_SK)).unwrap();
        assert!(relay::verify(&signed));
        assert!(nostr_bbs_core::verify_event(&signed));
    }

    #[test]
    fn table_fences_are_stripped_and_roster_evidence_is_real() {
        let mut it = item("t1", "question", "| merge the branch |");
        let req: ActionRequest =
            serde_json::from_str(&request_event("ab", &it, &CaseContext::default(), 1).content)
                .unwrap();
        assert_eq!(req.fields["question"], "merge the branch");
        it.repo = "roster".into();
        let req: ActionRequest =
            serde_json::from_str(&request_event("ab", &it, &CaseContext::default(), 1).content)
                .unwrap();
        assert!(req.fields["evidence"]
            .as_str()
            .unwrap()
            .contains("dream-last-night.json"));
    }

    /// A night directory and ledger as the engine writes them.
    fn night_fixture(
        gate: serde_json::Value,
        ledger_rows: &[&str],
    ) -> (tempfile::TempDir, CasePaths) {
        let d = tempfile::tempdir().unwrap();
        let paths = CasePaths {
            workspace: d.path().join("ws"),
            artefact_dir: d.path().join("art"),
        };
        let night = paths.artefact_dir.join("2026-10-09-site");
        std::fs::create_dir_all(&night).unwrap();
        std::fs::write(
            night.join("manifest.json"),
            json!({"deep": "build-content"}).to_string(),
        )
        .unwrap();
        std::fs::write(night.join("gate.json"), gate.to_string()).unwrap();
        let ledger = paths.workspace.join("site/docs/dream-cycle");
        std::fs::create_dir_all(&ledger).unwrap();
        let mut text = String::from("| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict |\n|---|---|---|---|---|---|---|\n");
        for r in ledger_rows {
            text.push_str(r);
            text.push('\n');
        }
        std::fs::write(ledger.join("LEDGER.md"), text).unwrap();
        (d, paths)
    }

    fn night_item(kind: &str, text: &str) -> InboxItem {
        let mut it = item("c1", kind, text);
        it.repo = "site".into();
        it.night_id = "2026-10-09-site".into();
        it.date = "2026-10-09".into();
        it
    }

    #[test]
    fn a_case_with_a_pr_links_it_and_says_nothing_is_merged() {
        let (_d, paths) = night_fixture(
            json!({"verdict": "ACCEPT", "modelVerdict": "ACCEPT", "accepted": true, "vetoes": []}),
            &[
                "| 2026-10-08 | build-content | older | NONE | https://github.com/o/r/pull/57 | yes | ACCEPT |",
                "| 2026-10-09 | build-content | generator parity a \\| b check | NONE | https://github.com/o/r/pull/58 | yes | ACCEPT |",
            ],
        );
        let it = night_item("question", "Merge the parity check if the re-run upholds.");
        let ctx = case_context(&paths, &it);
        assert_eq!(ctx.deep.as_deref(), Some("build-content"));
        assert_eq!(
            ctx.pr_url.as_deref(),
            Some("https://github.com/o/r/pull/58")
        );
        // An escaped pipe in the finding does not shift the PR column.
        assert_eq!(ctx.finding.as_deref(), Some("generator parity a | b check"));
        let ev = request_event("ab", &it, &ctx, 1);
        let req: ActionRequest = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(
            req.context_url.as_deref(),
            Some("https://github.com/o/r/pull/58")
        );
        assert_eq!(req.fields["pr"], "https://github.com/o/r/pull/58");
        assert_eq!(req.fields["outcome"], "Draft PR #58 opened for review");
        let body = req.reasoning.unwrap();
        assert!(body.contains("On Fri 9 Oct 2026 the dream engine examined the \u{201c}build-content\u{201d} area of site."), "{body}");
        assert!(body.contains("draft pull request #58"), "{body}");
        assert!(body.contains("approving does not merge anything"), "{body}");
        assert!(tag(&ev.tags, "title")
            .unwrap()
            .starts_with("site · 9 Oct · PR #58 · Merge"));
    }

    #[test]
    fn a_vetoed_night_says_there_is_nothing_to_merge() {
        let (_d, paths) = night_fixture(
            json!({"verdict": "BLOCKED-ENV", "modelVerdict": "ACCEPT", "accepted": false,
                   "vetoes": [{"class": "harness", "reason": "candidate patch did not apply to the baseline tree: corrupt patch at :14"}]}),
            &["| 2026-10-09 | build-content | VETOED: x | NONE | NONE | yes | BLOCKED-ENV |"],
        );
        let it = night_item("question", "Merge the branch if the re-run upholds.");
        let ctx = case_context(&paths, &it);
        assert_eq!(ctx.pr_url, None);
        let req: ActionRequest =
            serde_json::from_str(&request_event("ab", &it, &ctx, 1).content).unwrap();
        let body = req.reasoning.unwrap();
        assert!(
            body.contains("could not be applied to the code it was written against"),
            "{body}"
        );
        assert!(body.contains("nothing to merge from this night"), "{body}");
        assert!(body.contains("not in the repository"), "{body}");
        assert_eq!(
            req.fields["outcome"],
            "No PR: night lost to an environment fault"
        );
        assert_eq!(req.context_url, None);
    }

    #[test]
    fn a_case_without_artefacts_still_renders() {
        let paths = CasePaths {
            workspace: "/nonexistent".into(),
            artefact_dir: "/nonexistent".into(),
        };
        let it = night_item("alert", "night lost: harness broke");
        let ctx = case_context(&paths, &it);
        assert_eq!(ctx, CaseContext::default());
        let req: ActionRequest =
            serde_json::from_str(&request_event("ab", &it, &ctx, 1).content).unwrap();
        let body = req.reasoning.unwrap();
        assert!(body.starts_with("What happened\nOn Fri 9 Oct 2026 the dream engine flagged a problem with its night on site. It reported: night lost: harness broke"), "{body}");
        assert!(body.contains("What you need to do"));
        assert_eq!(req.fields["outcome"], "");
    }

    #[test]
    fn alerts_are_low_tier_and_low_priority() {
        let ev = request_event(
            "ab",
            &item("a1", "alert", "harness broke"),
            &CaseContext::default(),
            1,
        );
        assert_eq!(tag(&ev.tags, "risk-tier"), Some("low"));
        assert_eq!(tag(&ev.tags, "priority"), Some("low"));
        assert!(item_id_of(tag(&ev.tags, "d").unwrap()) == Some("a1"));
        assert_eq!(item_id_of(PANEL_D), None);
    }

    #[test]
    fn decisions_serialised_by_the_forum_resolve() {
        // Exactly what the forum's decision card publishes
        // (governance_view::decision_content): the core outcome plus reasoning.
        let with_reasoning = |o: DecisionOutcome, r: &str| {
            let mut v = serde_json::to_value(&o).unwrap();
            v["reasoning"] = serde_json::Value::String(r.into());
            v.to_string()
        };
        let approve = with_reasoning(DecisionOutcome::Approve, "fine");
        assert_eq!(
            resolution_for("question", &approve).unwrap().answer,
            "approve: fine"
        );
        let amend = with_reasoning(
            DecisionOutcome::Amend {
                diff: "use path B".into(),
            },
            "",
        );
        assert_eq!(
            resolution_for("question", &amend).unwrap().answer,
            "amend: use path B"
        );
        let reject = with_reasoning(DecisionOutcome::Reject, "stale");
        assert_eq!(resolution_for("alert", &reject).unwrap().status, "answered");
    }

    #[test]
    fn resolution_mapping() {
        let r = |kind: &str, c: serde_json::Value| resolution_for(kind, &c.to_string());
        assert_eq!(
            r(
                "question",
                json!({"action":"approve","reasoning":"go ahead"})
            )
            .unwrap(),
            Resolution {
                status: "answered",
                answer: "approve: go ahead".into()
            }
        );
        assert_eq!(
            r("question", json!({"action":"reject","reasoning":""}))
                .unwrap()
                .answer,
            "reject (no rationale given)"
        );
        assert_eq!(
            r("alert", json!({"action":"approve","reasoning":"seen"}))
                .unwrap()
                .status,
            "dismissed"
        );
        assert_eq!(
            r("alert", json!({"action":"reject","reasoning":"not real"}))
                .unwrap()
                .status,
            "answered"
        );
        assert_eq!(
            r(
                "question",
                json!({"action":"amend","diff":"do X instead","reasoning":"cheaper"})
            )
            .unwrap()
            .answer,
            "amend: do X instead — cheaper"
        );
        assert!(r(
            "question",
            json!({"action":"delegate","delegate_to":"ab","reasoning":""})
        )
        .is_none());
        assert!(resolution_for("question", "not json").is_none());
    }

    #[test]
    fn planner_applies_newest_valid_admin_decision_bound_to_the_request() {
        let agent = pubkey_hex(&key(AGENT_SK));
        let mut q = item("q1", "question", "decide");
        q.published_event_id = "req-q1".into();
        let items = vec![q];
        let older = decision(
            ADMIN_SK,
            "dream-q1",
            Some("req-q1"),
            json!({"action":"reject","reasoning":"no"}),
            10,
        );
        let newer = decision(
            ADMIN_SK,
            "dream-q1",
            Some("req-q1"),
            json!({"action":"approve","reasoning":"yes"}),
            20,
        );
        let plan = plan_decisions(&items, &[older, newer.clone()], &agent, &HashMap::new());
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].resolution.answer, "approve: yes");
        assert_eq!(plan[0].decision_event_id, newer.id);
    }

    #[test]
    fn planner_rejects_self_review_forgery_and_stale_request_binding() {
        let agent = pubkey_hex(&key(AGENT_SK));
        let mut q = item("q1", "question", "decide");
        q.published_event_id = "req-current".into();
        let items = vec![q];
        let self_signed = decision(
            AGENT_SK,
            "dream-q1",
            Some("req-current"),
            json!({"action":"approve","reasoning":""}),
            10,
        );
        let mut forged = decision(
            ADMIN_SK,
            "dream-q1",
            Some("req-current"),
            json!({"action":"approve","reasoning":""}),
            11,
        );
        forged.content = json!({"action":"reject","reasoning":"tampered"}).to_string();
        let stale = decision(
            ADMIN_SK,
            "dream-q1",
            Some("req-old"),
            json!({"action":"approve","reasoning":""}),
            12,
        );
        assert!(plan_decisions(
            &items,
            &[self_signed, forged, stale],
            &agent,
            &HashMap::new()
        )
        .is_empty());
    }

    #[test]
    fn panel_acknowledgement_dismisses_only_alerts_published_before_it() {
        let agent = pubkey_hex(&key(AGENT_SK));
        let mut early = item("a1", "alert", "old alert");
        early.published_event_id = "r1".into();
        let mut late = item("a2", "alert", "new alert");
        late.published_event_id = "r2".into();
        let mut question = item("q1", "question", "decide");
        question.published_event_id = "r3".into();
        let items = vec![early, late, question];
        let ack = decision(
            ADMIN_SK,
            PANEL_D,
            None,
            json!({"action": ACK_ALERTS_ACTION, "reasoning":"cleared backlog"}),
            100,
        );
        let published_at = HashMap::from([
            ("a1".to_string(), 50),
            ("a2".to_string(), 150),
            ("q1".to_string(), 10),
        ]);
        let plan = plan_decisions(&items, &[ack], &agent, &published_at);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].item_id, "a1");
        assert_eq!(plan[0].resolution.status, "dismissed");
    }

    #[test]
    fn resolved_items_are_never_replanned() {
        let agent = pubkey_hex(&key(AGENT_SK));
        let mut q = item("q1", "question", "decide");
        q.status = "answered".into();
        let d = decision(
            ADMIN_SK,
            "dream-q1",
            None,
            json!({"action":"approve","reasoning":""}),
            10,
        );
        assert!(plan_decisions(&[q], &[d], &agent, &HashMap::new()).is_empty());
    }

    #[test]
    fn withdrawal_names_the_request_its_coordinate_and_kind() {
        let k = key(AGENT_SK);
        let pk = pubkey_hex(&k);
        let mut it = item("15a655c8", "question", "merge the branch");
        it.status = "answered".into();
        it.answer = "approve: looks right".into();
        it.published_event_id = "ab".repeat(32);
        let ev = withdrawal_event(&pk, &it, true, "2026-10-02", 50);
        assert_eq!(ev.kind, 5);
        assert_eq!(ev.pubkey, pk);
        assert_eq!(
            ev.tags,
            vec![
                vec!["e".to_string(), "ab".repeat(32)],
                vec!["a".to_string(), format!("31402:{pk}:dream-15a655c8")],
                vec!["k".to_string(), "31402".to_string()],
            ]
        );
        assert_eq!(
            ev.content,
            "resolved: answered 2026-10-02 — approve: looks right"
        );
        // The coordinate is exactly the published case's kind:pubkey:d.
        let req = request_event(&pk, &it, &CaseContext::default(), 1);
        assert_eq!(
            tag(&ev.tags, "a").unwrap(),
            format!("{}:{pk}:{}", req.kind, tag(&req.tags, "d").unwrap())
        );
        // Signed by the publishing key, so the relay treats it as own-event.
        let signed = sign(ev, &k).unwrap();
        assert!(relay::verify(&signed));
        assert_eq!(signed.pubkey, pk);
        // Without the coordinate only the request id is named.
        let bare = withdrawal_event(&pk, &it, false, "2026-10-02", 50);
        assert!(tag(&bare.tags, "a").is_none());
        assert_eq!(tag(&bare.tags, "e"), Some("ab".repeat(32).as_str()));
        assert_eq!(tag(&bare.tags, "k"), Some("31402"));
    }

    #[test]
    fn withdrawal_reason_quotes_at_most_80_chars_of_a_flattened_answer() {
        let mut it = item("d1", "alert", "harness broke");
        it.status = "dismissed".into();
        assert_eq!(
            withdrawal_reason(&it, "2026-10-02"),
            "resolved: dismissed 2026-10-02"
        );
        it.answer = format!("acknowledged:\n{}", "x".repeat(200));
        let r = withdrawal_reason(&it, "2026-10-02");
        assert!(r.starts_with("resolved: dismissed 2026-10-02 — acknowledged: xxx"));
        assert!(!r.contains('\n'));
        assert!(r.ends_with('…'));
        let quoted = r.split(" — ").nth(1).unwrap();
        assert_eq!(quoted.chars().count(), 81); // 80 + ellipsis
    }

    #[test]
    fn sweep_selects_only_resolved_published_unwithdrawn_items() {
        let mk = |id: &str, status: &str, published: &str, withdrawn: &str| {
            let mut i = item(id, "question", "decide");
            i.status = status.into();
            i.published_event_id = published.into();
            i.withdrawn_event_id = withdrawn.into();
            i
        };
        let items = vec![
            mk("open-pub", "open", "r1", ""),
            mk("open-unpub", "open", "", ""),
            mk("ans-pub", "answered", "r2", ""),
            mk("dis-pub", "dismissed", "r3", ""),
            mk("ans-unpub", "answered", "", ""),
            mk("ans-done", "answered", "r4", "del4"),
        ];
        let plan = plan_withdrawals(&items);
        let ids: Vec<&str> = plan.iter().map(|w| w.item.id.as_str()).collect();
        assert_eq!(ids, vec!["ans-pub", "dis-pub"]);
        assert!(plan.iter().all(|w| w.with_coordinate));
    }

    #[test]
    fn sweep_withholds_the_coordinate_when_a_reopened_item_shares_it() {
        let mut old = item("same", "question", "decide");
        old.status = "answered".into();
        old.published_event_id = "r-old".into();
        let mut reopened = item("same", "question", "decide");
        reopened.published_event_id = "r-new".into();
        let plan = plan_withdrawals(&[old, reopened]);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].item.published_event_id, "r-old");
        assert!(!plan[0].with_coordinate);
    }

    #[tokio::test]
    async fn withdraw_dry_run_sends_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inbox.json");
        let mut a = item("a1", "question", "decide");
        a.status = "answered".into();
        a.published_event_id = "ab".repeat(32);
        let mut b = item("b1", "alert", "noise");
        b.status = "dismissed".into();
        b.published_event_id = "cd".repeat(32);
        inbox::save_to(&path, &[a, b, item("c1", "question", "still open")]).unwrap();
        let before = std::fs::read(&path).unwrap();
        // A dry run that tried to reach a relay would sit in the connect
        // timeout; it must return at once with the count.
        let report = tokio::time::timeout(Duration::from_secs(2), withdraw(&path, true))
            .await
            .expect("dry run must not touch the network");
        assert_eq!(report.skipped, 2);
        assert_eq!(report.withdrawn, 0);
        assert_eq!(report.rejected, 0);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_four_field_question_renders_as_labelled_lines_and_titles_by_its_decision() {
        let item = InboxItem {
            id: "abcd1234".into(),
            kind: "question".into(),
            repo: "VisionFlow".into(),
            night_id: "2026-10-17-VisionFlow".into(),
            date: "2026-10-17".into(),
            text: "Decision: add the exit-code test to the gate runner · Why: it is missing from run-all · If approved: the next night wires it in · If not: a broken gate goes unseen".into(),
            status: "open".into(),
            answer: String::new(),
            last_surfaced: 0,
            published_event_id: String::new(),
            decision_event_id: String::new(),
            withdrawn_event_id: String::new(),
        };
        let ev = request_event("ab".repeat(32).as_str(), &item, &CaseContext::default(), 1);
        let title = ev.tags.iter().find(|t| t[0] == "title").unwrap()[1].clone();
        assert!(
            title.ends_with("add the exit-code test to the gate runner"),
            "{title}"
        );
        let body: serde_json::Value = serde_json::from_str(&ev.content).unwrap();
        let reasoning = body["reasoning"].as_str().unwrap();
        assert!(reasoning.contains("Decision: add the exit-code test to the gate runner\nWhy: it is missing from run-all\nIf you approve: the next night wires it in\nIf you do not: a broken gate goes unseen"), "{reasoning}");
        assert!(reasoning.contains("approving does not merge anything"));
    }
}
