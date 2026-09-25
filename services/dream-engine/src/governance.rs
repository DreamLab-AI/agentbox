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
        version: "1.0.0".into(),
        schema: PanelSchema::ActionInbox,
        fields: vec![
            field("repo", FieldType::String, "Repository"),
            field("night", FieldType::String, "Night"),
            field("kind", FieldType::Enum, "Kind"),
            field("question", FieldType::String, "Question"),
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

fn title_for(item: &InboxItem) -> String {
    let prefix = if item.kind == "alert" {
        "Alert"
    } else {
        "Decision"
    };
    let text = clean_text(&item.text).replace('\n', " ");
    let mut title = format!("{prefix} · {} · {}", item.repo, text);
    if title.chars().count() > TITLE_MAX {
        title = title.chars().take(TITLE_MAX - 1).collect::<String>() + "…";
    }
    title
}

/// Unsigned 31402 for one inbox item.
pub fn request_event(pubkey: &str, item: &InboxItem, created_at: u64) -> UnsignedEvent {
    let is_alert = item.kind == "alert";
    let (tier, priority) = if is_alert {
        (RiskTier::Low, ActionPriority::Low)
    } else {
        (RiskTier::Medium, ActionPriority::Medium)
    };
    let evidence = evidence_for(item);
    let reasoning = if is_alert {
        format!(
            "The dream engine raised this alert on {} ({}). Approve to acknowledge it; \
             Reject if you think it is wrong (say why); Amend to tell the engine what to do.",
            item.date, item.repo
        )
    } else {
        format!(
            "The {} dream night on {} asked for a human decision. Approve to accept the \
             recommendation as written; Reject to decline it (say why); Amend to give your \
             own instruction. Your answer feeds the next night's carry-over.",
            item.date, item.repo
        )
    };
    let request = ActionRequest {
        fields: json!({
            "repo": item.repo,
            "night": item.night_id,
            "kind": item.kind,
            "question": clean_text(&item.text),
            "evidence": evidence,
        }),
        reasoning: Some(reasoning),
        context_url: first_url(&item.text),
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
            vec!["title".into(), title_for(item)],
            vec!["t".into(), "dream-cycle".into()],
        ],
        content: serde_json::to_string(&request).unwrap_or_default(),
    }
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
    pub skipped: usize,
}

/// Publish the panel and every open, not-yet-published inbox item.
/// `dry_run` prints the unsigned events and sends nothing.
pub async fn publish(inbox_path: &Path, dry_run: bool) -> Report {
    let mut report = Report::default();
    let items: Vec<InboxItem> = inbox::load_from(inbox_path)
        .into_iter()
        .filter(|i| i.status == "open")
        .collect();
    let now = relay::now_secs();

    if dry_run {
        let pubkey = load_key()
            .map(|k| relay::pubkey_hex(&k))
            .unwrap_or_else(|| "<agent pubkey>".into());
        println!(
            "{}",
            serde_json::to_string_pretty(&panel_event(&pubkey, now)).unwrap_or_default()
        );
        for item in items.iter().filter(|i| i.published_event_id.is_empty()) {
            println!(
                "{}",
                serde_json::to_string_pretty(&request_event(&pubkey, item, now))
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

    for item in items.iter().filter(|i| i.published_event_id.is_empty()) {
        let ev = match relay::sign(request_event(&pubkey, item, now), &key) {
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
        rejected = report.rejected,
        "governance: publish done"
    );
    report
}

/// Fetch decisions for published cases and resolve their inbox items.
/// `dry_run` prints what would change and writes nothing.
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
    session.close().await;

    for applied in plan_decisions(&items, &decisions, &pubkey, &published_at) {
        if dry_run {
            println!(
                "{} → {} ({}) [decision {}]",
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
            Ok(true) => report.resolved += 1,
            Ok(false) => {}
            Err(e) => warn!(item = %applied.item_id, error = %e, "governance: inbox write failed"),
        }
    }
    info!(resolved = report.resolved, "governance: ingest done");
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
        let ev = request_event(&pk, &it, 20);
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
            serde_json::from_str(&request_event("ab", &it, 1).content).unwrap();
        assert_eq!(req.fields["question"], "merge the branch");
        it.repo = "roster".into();
        let req: ActionRequest =
            serde_json::from_str(&request_event("ab", &it, 1).content).unwrap();
        assert!(req.fields["evidence"]
            .as_str()
            .unwrap()
            .contains("dream-last-night.json"));
    }

    #[test]
    fn alerts_are_low_tier_and_low_priority() {
        let ev = request_event("ab", &item("a1", "alert", "harness broke"), 1);
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
}
