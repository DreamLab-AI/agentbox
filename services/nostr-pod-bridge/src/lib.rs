//! Embedded Nostr relay + Solid-pod ingress bridge for agentbox.
//!
//! This crate replaces the third-party `nostr-rs-relay` binary **and** the
//! hand-rolled JS crypto in `mcp/nostr-bridge/relay-consumer.js`. It composes
//! two first-party upstream crates:
//!
//! - [`solid_pod_rs_nostr`] supplies the relay substrate: NIP-01/11/16 event
//!   envelope, native BIP-340 verification ([`solid_pod_rs_nostr::Relay::ingest`]
//!   calls `Event::verify` before broadcast), and a WebSocket wire handler
//!   ([`solid_pod_rs_nostr::serve_relay_ws`]).
//! - [`nostr_bbs_core`] supplies the crypto the relay does not: NIP-59
//!   gift-wrap unwrap ([`nostr_bbs_core::unwrap_gift`]) and NIP-26 delegation
//!   validation ([`nostr_bbs_core::validate_delegation_tag`]).
//!
//! ## Flow
//!
//! ```text
//!   phone (Amethyst/Amber)            this bridge                     pod
//!        │  ws kind-1059 DM                │                           │
//!        ├────────────────────────────────▶ Relay::ingest             │
//!        │                                 │   └─ Event::verify (sig)  │
//!        │                                 │   └─ broadcast            │
//!        │                          consumer task (relay.subscribe)    │
//!        │                                 │   1. NIP-26 authz (admin) │
//!        │                                 │   2. unwrap_gift (sk)     │
//!        │                                 │   3. AS2/LDN format       │
//!        │                                 ├──────────── inbox/<id>.json
//! ```
//!
//! Signature verification (authn) always precedes authorization (authz):
//! the relay verifies the signature in `ingest` *before* the event reaches the
//! consumer, and the consumer performs the NIP-26 admin-delegation check before
//! any unwrap or pod write.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use nostr_bbs_core::keys::signing_key_from_bytes;
use nostr_bbs_core::{
    sign_event, unwrap_gift, validate_delegation_tag, DelegationTag, NostrEvent, UnsignedEvent,
};
use solid_pod_rs_nostr::{serve_relay_ws, Event, Relay};

/// NIP-59 gift-wrap (outer envelope for NIP-17 DMs).
pub const KIND_GIFT_WRAP: u64 = 1059;
/// NIP-17 direct-message rumor.
pub const KIND_DM: u64 = 14;
/// NIP-17 file-message rumor.
pub const KIND_DM_FILE: u64 = 15;
/// kind-30840 session-summary addressable event (NIP-33, `d`-tag = session id).
pub const KIND_SESSION_SUMMARY: u64 = 30840;

/// Bridge configuration. Secrets arrive already-decrypted from the agentbox
/// launcher (which owns the AES-256-GCM `nostr.key.enc` format); this crate
/// never touches the key-at-rest format.
#[derive(Clone)]
pub struct BridgeConfig {
    /// Address the embedded relay binds, e.g. `127.0.0.1:7777`.
    pub bind_addr: String,
    /// Filesystem root under which `pods/<npub>/events/inbox/<id>.json` is written.
    pub pod_root: PathBuf,
    /// Hex (x-only, 64-char) pubkey of the agent this bridge serves.
    pub recipient_pubkey: String,
    /// 32-byte secret key of the agent — used solely to unwrap NIP-59 gifts.
    pub recipient_sk: [u8; 32],
    /// Hex pubkey of the admin permitted to issue NIP-26 delegations.
    pub admin_pubkey: String,
    /// Direct allowlist of hex pubkeys permitted without delegation.
    pub allowed_pubkeys: Vec<String>,
}

/// Outcome of the authorization decision for an inbound event.
#[derive(Debug)]
enum Authz {
    /// Author is directly allow-listed.
    Direct,
    /// Author acts under a valid NIP-26 delegation from the admin pubkey.
    Delegated { delegator: String },
}

/// Errors surfaced while processing a single inbound event. Processing is
/// best-effort per event; a rejected event is logged and dropped, never fatal.
#[derive(Debug, thiserror::Error)]
pub enum IngressError {
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("gift-wrap unwrap failed: {0}")]
    Unwrap(String),
    #[error("event not addressed to this agent")]
    NotAddressed,
    #[error("pod write failed: {0}")]
    PodWrite(String),
    #[error("serialization: {0}")]
    Serde(String),
}

/// Convert the relay's `Event` into the crypto crate's `NostrEvent` via the
/// canonical Nostr JSON shape (both are serde-derived with identical fields),
/// avoiding any assumption about cross-crate type identity.
fn to_core_event(ev: &Event) -> Result<NostrEvent, IngressError> {
    let v = serde_json::to_value(ev).map_err(|e| IngressError::Serde(e.to_string()))?;
    serde_json::from_value(v).map_err(|e| IngressError::Serde(e.to_string()))
}

/// Find the first `["delegation", ...]` tag on an event, if present.
fn delegation_tag(ev: &Event) -> Option<&Vec<String>> {
    ev.tags
        .iter()
        .find(|t| t.first().map(String::as_str) == Some("delegation"))
}

/// Decide whether an already-signature-verified event may be ingested.
///
/// Order: direct allowlist first, then NIP-26 delegation. A delegation is only
/// honoured when its delegator equals the configured admin pubkey *and*
/// [`validate_delegation_tag`] accepts it for this event's kind + timestamp.
fn authorize(ev: &Event, cfg: &BridgeConfig) -> Result<Authz, IngressError> {
    if cfg.allowed_pubkeys.iter().any(|p| p == &ev.pubkey) {
        return Ok(Authz::Direct);
    }

    if let Some(tag) = delegation_tag(ev) {
        let delegator = tag.get(1).cloned().unwrap_or_default();
        if delegator != cfg.admin_pubkey {
            return Err(IngressError::Unauthorized(format!(
                "delegation delegator {delegator} is not the admin pubkey"
            )));
        }
        let dtag = DelegationTag(tag.clone());
        validate_delegation_tag(&dtag, &ev.pubkey, ev.kind, ev.created_at)
            .map_err(|e| IngressError::Unauthorized(format!("invalid NIP-26 delegation: {e}")))?;
        return Ok(Authz::Delegated { delegator });
    }

    Err(IngressError::Unauthorized(format!(
        "pubkey {} not allow-listed and no admin delegation present",
        ev.pubkey
    )))
}

/// The message content the agent actually acts on, after any gift-wrap peel.
struct EffectiveMessage {
    /// Real sender pubkey (recovered from the seal for gift-wrapped DMs).
    sender_pubkey: String,
    /// Effective kind (the rumor kind for gift wraps, else the event kind).
    kind: u64,
    /// Effective created_at (the rumor timestamp for gift wraps).
    created_at: u64,
    /// Effective tags.
    tags: Vec<Vec<String>>,
    /// Plaintext content.
    content: String,
    /// Whether this message arrived inside a NIP-59 gift wrap.
    gift_wrapped: bool,
}

/// Peel a NIP-59 gift wrap to the inner rumor; pass non-wrapped events through.
fn effective_message(ev: &Event, cfg: &BridgeConfig) -> Result<EffectiveMessage, IngressError> {
    if ev.kind != KIND_GIFT_WRAP {
        return Ok(EffectiveMessage {
            sender_pubkey: ev.pubkey.clone(),
            kind: ev.kind,
            created_at: ev.created_at,
            tags: ev.tags.clone(),
            content: ev.content.clone(),
            gift_wrapped: false,
        });
    }

    let core = to_core_event(ev)?;
    let unwrapped =
        unwrap_gift(&core, &cfg.recipient_sk).map_err(|e| IngressError::Unwrap(e.to_string()))?;
    let rumor = unwrapped.rumor;
    Ok(EffectiveMessage {
        sender_pubkey: unwrapped.sender_pubkey,
        kind: rumor.kind,
        created_at: rumor.created_at,
        tags: rumor.tags,
        content: rumor.content,
        gift_wrapped: true,
    })
}

/// True if any `p` tag addresses this agent (gift wraps are addressed on the
/// outer event; rumors carry the real recipient on the inner `p` tag).
fn addressed_to(recipient: &str, outer: &Event, inner_tags: &[Vec<String>]) -> bool {
    let hits = |tags: &[Vec<String>]| {
        tags.iter().any(|t| {
            t.first().map(String::as_str) == Some("p")
                && t.get(1).map(String::as_str) == Some(recipient)
        })
    };
    hits(&outer.tags) || hits(inner_tags)
}

/// Render an inbound event as an ActivityStreams 2.0 `Create`/`Note` with
/// `x:nostrEvent` provenance, suitable for an LDN pod inbox.
fn format_as_ldn(outer: &Event, msg: &EffectiveMessage) -> Value {
    json!({
        "@context": [
            "https://www.w3.org/ns/activitystreams",
            { "x": "https://dreamlab.ai/ns/nostr#" }
        ],
        "type": "Create",
        "id": format!("urn:nostr:{}", outer.id),
        "published": rfc3339(msg.created_at),
        "actor": format!("did:nostr:{}", msg.sender_pubkey),
        "object": {
            "type": if msg.kind == KIND_SESSION_SUMMARY { "Document" } else { "Note" },
            "content": msg.content,
            "x:kind": msg.kind,
            "x:tags": msg.tags,
        },
        "x:nostrEvent": {
            "id": outer.id,
            "pubkey": outer.pubkey,
            "kind": outer.kind,
            "sig": outer.sig,
            "created_at": outer.created_at,
            "giftWrapped": msg.gift_wrapped,
        }
    })
}

/// Inbox path: `<pod_root>/pods/<recipient>/events/inbox/<event_id>.json`.
fn inbox_path(pod_root: &Path, recipient: &str, event_id: &str) -> PathBuf {
    pod_root
        .join("pods")
        .join(recipient)
        .join("events")
        .join("inbox")
        .join(format!("{event_id}.json"))
}

/// Sessions path: `<pod_root>/pods/<recipient>/sessions/<event_id>.jsonld`.
fn session_path(pod_root: &Path, recipient: &str, event_id: &str) -> PathBuf {
    pod_root
        .join("pods")
        .join(recipient)
        .join("sessions")
        .join(format!("{event_id}.jsonld"))
}

async fn write_json(path: &Path, doc: &Value) -> Result<(), IngressError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| IngressError::PodWrite(e.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(doc).map_err(|e| IngressError::Serde(e.to_string()))?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|e| IngressError::PodWrite(e.to_string()))
}

/// Process a single already-verified event: authorize, peel, address-check,
/// write to the pod. Idempotent on event id (the inbox filename is the id).
pub async fn process_event(ev: &Event, cfg: &BridgeConfig) -> Result<(), IngressError> {
    let authz = authorize(ev, cfg)?;
    if let Authz::Delegated { delegator } = &authz {
        debug!(event_id = %ev.id, %delegator, "authorized via admin delegation");
    }
    let msg = effective_message(ev, cfg)?;

    if !addressed_to(&cfg.recipient_pubkey, ev, &msg.tags) {
        return Err(IngressError::NotAddressed);
    }

    let doc = format_as_ldn(ev, &msg);
    write_json(&inbox_path(&cfg.pod_root, &cfg.recipient_pubkey, &ev.id), &doc).await?;

    if msg.kind == KIND_SESSION_SUMMARY {
        write_json(
            &session_path(&cfg.pod_root, &cfg.recipient_pubkey, &ev.id),
            &doc,
        )
        .await?;
    }

    debug!(event_id = %ev.id, kind = msg.kind, "ingested to pod");
    Ok(())
}

// ── Session-summary egress (kind-30840) ─────────────────────────────────────
//
// The phone mirror is the inverse of ingress: instead of unwrapping an inbound
// gift wrap, the agent *authors* a curated digest at SessionEnd. The curation
// (summary + actions + actionable questions) is done upstream by the Z.AI
// consultant; this crate only owns the crypto — sign the kind-30840, persist it
// to the pod, and push it to the relay for the live phone view.

/// A curated session digest produced by the Z.AI consultant at SessionEnd —
/// summaries, actions, and actionable questions, *not* a full transcript. The
/// `summarise` subcommand reads this as JSON on stdin.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionSummary {
    /// Stable session id; becomes the kind-30840 `d` tag (NIP-33 addressable),
    /// so re-summarising the same session replaces the prior digest.
    pub session_id: String,
    /// One-paragraph narrative summary.
    pub summary: String,
    /// Concrete actions taken or pending.
    #[serde(default)]
    pub actions: Vec<String>,
    /// Open questions that need an operator decision.
    #[serde(default)]
    pub actionable_questions: Vec<String>,
}

/// Current wall-clock seconds since the Unix epoch.
fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Render a [`SessionSummary`] as the text the phone (Amethyst) displays in the
/// kind-30840 `content` field. Layout mirrors the retired Telegram digest:
/// summary, then actions, then actionable questions.
fn render_summary_content(s: &SessionSummary) -> String {
    let mut out = format!("Session {}\n\nSUMMARY\n{}\n", s.session_id, s.summary.trim());
    if !s.actions.is_empty() {
        out.push_str("\nACTIONS\n");
        for a in &s.actions {
            out.push_str(&format!("- {}\n", a.trim()));
        }
    }
    if !s.actionable_questions.is_empty() {
        out.push_str("\nACTIONABLE QUESTIONS\n");
        for q in &s.actionable_questions {
            out.push_str(&format!("- {}\n", q.trim()));
        }
    }
    out
}

/// Sign a kind-30840 session-summary as the agent itself, dual-write it to the
/// pod (inbox + sessions), and publish it to the running relay for the live
/// phone mirror.
///
/// The agent is the *author* here (not a gift-wrap recipient), so this path
/// signs with the agent key and writes the pod record directly — the ingress
/// consumer deliberately skips self-authored events and would never persist
/// this one. The relay publish is best-effort: the durable record is the pod
/// write; the relay frame is only the live mirror.
pub async fn publish_session_summary(
    cfg: &BridgeConfig,
    summary: &SessionSummary,
) -> anyhow::Result<()> {
    let signing_key = signing_key_from_bytes(&cfg.recipient_sk)
        .map_err(|e| anyhow::anyhow!("invalid agent secret key: {e}"))?;

    let unsigned = UnsignedEvent {
        pubkey: cfg.recipient_pubkey.clone(),
        created_at: now_unix(),
        kind: KIND_SESSION_SUMMARY,
        tags: vec![
            vec!["d".to_string(), summary.session_id.clone()],
            vec!["p".to_string(), cfg.recipient_pubkey.clone()],
        ],
        content: render_summary_content(summary),
    };
    let signed = sign_event(unsigned, &signing_key)
        .map_err(|e| anyhow::anyhow!("session-summary signing failed: {e}"))?;

    // Render via the same LDN path inbound summaries use, so self-published and
    // phone-relayed summaries are byte-identical in the pod.
    let relay_event: Event = serde_json::from_value(serde_json::to_value(&signed)?)?;
    let msg = EffectiveMessage {
        sender_pubkey: signed.pubkey.clone(),
        kind: signed.kind,
        created_at: signed.created_at,
        tags: signed.tags.clone(),
        content: signed.content.clone(),
        gift_wrapped: false,
    };
    let doc = format_as_ldn(&relay_event, &msg);

    write_json(
        &inbox_path(&cfg.pod_root, &cfg.recipient_pubkey, &signed.id),
        &doc,
    )
    .await?;
    write_json(
        &session_path(&cfg.pod_root, &cfg.recipient_pubkey, &signed.id),
        &doc,
    )
    .await?;

    if let Err(e) = publish_to_relay(&cfg.bind_addr, &signed).await {
        warn!(error = %e, "live relay publish failed; pod record persisted");
    }

    info!(event_id = %signed.id, session = %summary.session_id, "session summary dual-written to pod");
    Ok(())
}

/// Open a short-lived WebSocket to the embedded relay and publish a single
/// `["EVENT", …]` frame. Waits briefly for the relay's `OK`/`NOTICE` ack so the
/// frame is flushed and processed before the socket closes.
async fn publish_to_relay(bind_addr: &str, signed: &NostrEvent) -> anyhow::Result<()> {
    let url = format!("ws://{bind_addr}/");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await?;
    let frame = serde_json::to_string(&json!(["EVENT", signed]))?;
    ws.send(Message::Text(frame)).await?;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await;
    ws.close(None).await.ok();
    Ok(())
}

/// Spawn the consumer task: subscribe to the relay broadcast and process every
/// verified event. Returns the join handle.
pub fn spawn_consumer(relay: Arc<Relay>, cfg: BridgeConfig) -> tokio::task::JoinHandle<()> {
    let mut rx = relay.subscribe();
    tokio::spawn(async move {
        info!(recipient = %cfg.recipient_pubkey, "pod-ingress consumer started");
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    // Skip events the agent authored itself (e.g. kind-30840
                    // session summaries published via `publish_session_summary`).
                    // Those are pod-written directly at the egress path; the
                    // agent pubkey is not in its own allowlist, so re-ingesting
                    // would log a spurious rejection and double-write.
                    if ev.pubkey == cfg.recipient_pubkey {
                        debug!(event_id = %ev.id, "self-authored event; egress already persisted");
                        continue;
                    }
                    match process_event(&ev, &cfg).await {
                        Ok(()) => {}
                        Err(IngressError::Unauthorized(r)) => {
                            warn!(event_id = %ev.id, pubkey = %ev.pubkey, reason = %r, "rejected")
                        }
                        Err(IngressError::NotAddressed) => {
                            debug!(event_id = %ev.id, "not addressed to this agent; skipped")
                        }
                        Err(e) => error!(event_id = %ev.id, error = %e, "ingress error"),
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "consumer lagged; dropped events")
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    info!("relay broadcast closed; consumer exiting");
                    break;
                }
            }
        }
    })
}

/// Bind the embedded relay and serve WebSocket connections forever. Each
/// connection is handed to [`solid_pod_rs_nostr::serve_relay_ws`], which
/// performs the WS upgrade and runs the NIP-01 protocol against `relay`.
pub async fn serve(relay: Arc<Relay>, bind_addr: &str) -> anyhow::Result<()> {
    let listener = TcpListener::bind(bind_addr).await?;
    info!(addr = %bind_addr, "embedded nostr relay listening");
    loop {
        let (stream, peer) = listener.accept().await?;
        let relay = relay.clone();
        tokio::spawn(async move {
            debug!(%peer, "ws connection accepted");
            serve_relay_ws(relay, stream).await;
            debug!(%peer, "ws connection closed");
        });
    }
}

/// Civil date → RFC3339 (UTC) without pulling a date crate. Algorithm from
/// Howard Hinnant's `chrono`-compatible `civil_from_days`.
fn rfc3339(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let secs_of_day = unix_secs % 86_400;
    let (h, m, s) = (secs_of_day / 3600, (secs_of_day % 3600) / 60, secs_of_day % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> BridgeConfig {
        BridgeConfig {
            bind_addr: "127.0.0.1:0".into(),
            pod_root: std::env::temp_dir(),
            recipient_pubkey: "a".repeat(64),
            recipient_sk: [7u8; 32],
            admin_pubkey: "b".repeat(64),
            allowed_pubkeys: vec!["c".repeat(64)],
        }
    }

    fn ev(pubkey: &str, kind: u64, tags: Vec<Vec<String>>) -> Event {
        Event {
            id: "deadbeef".into(),
            pubkey: pubkey.into(),
            created_at: 1_700_000_000,
            kind,
            tags,
            content: "hi".into(),
            sig: "00".repeat(64),
        }
    }

    #[test]
    fn direct_allowlist_authorizes() {
        let c = cfg();
        let e = ev(&"c".repeat(64), 1, vec![]);
        assert!(matches!(authorize(&e, &c), Ok(Authz::Direct)));
    }

    #[test]
    fn unknown_pubkey_without_delegation_rejected() {
        let c = cfg();
        let e = ev(&"f".repeat(64), 1, vec![]);
        assert!(matches!(authorize(&e, &c), Err(IngressError::Unauthorized(_))));
    }

    #[test]
    fn delegation_from_non_admin_rejected() {
        let c = cfg();
        let tag = vec![
            "delegation".into(),
            "d".repeat(64), // delegator != admin ("b"*64)
            "kind=1".into(),
            "00".repeat(64),
        ];
        let e = ev(&"f".repeat(64), 1, vec![tag]);
        assert!(matches!(authorize(&e, &c), Err(IngressError::Unauthorized(_))));
    }

    #[test]
    fn rfc3339_known_epoch() {
        // 2023-11-14T22:13:20Z
        assert_eq!(rfc3339(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn addressed_via_outer_p_tag() {
        let recipient = "a".repeat(64);
        let outer = ev(&"c".repeat(64), 1059, vec![vec!["p".into(), recipient.clone()]]);
        assert!(addressed_to(&recipient, &outer, &[]));
    }

    #[test]
    fn addressed_via_inner_p_tag() {
        let recipient = "a".repeat(64);
        let outer = ev(&"c".repeat(64), 1059, vec![]);
        let inner = vec![vec!["p".into(), recipient.clone()]];
        assert!(addressed_to(&recipient, &outer, &inner));
    }

    #[test]
    fn session_summary_deserializes_with_optional_fields_defaulted() {
        let s: SessionSummary =
            serde_json::from_str(r#"{"session_id":"s1","summary":"did the thing"}"#).unwrap();
        assert_eq!(s.session_id, "s1");
        assert_eq!(s.summary, "did the thing");
        assert!(s.actions.is_empty());
        assert!(s.actionable_questions.is_empty());
    }

    #[test]
    fn render_summary_content_includes_present_sections_only() {
        let s = SessionSummary {
            session_id: "abc".into(),
            summary: "Refactored the relay.".into(),
            actions: vec!["edited lib.rs".into()],
            actionable_questions: vec![],
        };
        let out = render_summary_content(&s);
        assert!(out.starts_with("Session abc"));
        assert!(out.contains("SUMMARY\nRefactored the relay."));
        assert!(out.contains("ACTIONS\n- edited lib.rs"));
        assert!(!out.contains("ACTIONABLE QUESTIONS"));
    }

    #[test]
    fn signed_summary_converts_to_relay_event_and_verifies() {
        use nostr_bbs_core::keys::signing_key_from_bytes;
        use nostr_bbs_core::sign_event;

        // A deterministic non-trivial secret key.
        let sk_bytes = [0x11u8; 32];
        let signing_key = signing_key_from_bytes(&sk_bytes).unwrap();
        let pubkey = hex::encode(signing_key.verifying_key().to_bytes());

        let summary = SessionSummary {
            session_id: "sess-1".into(),
            summary: "hello".into(),
            actions: vec![],
            actionable_questions: vec![],
        };
        let unsigned = UnsignedEvent {
            pubkey: pubkey.clone(),
            created_at: 1_700_000_000,
            kind: KIND_SESSION_SUMMARY,
            tags: vec![
                vec!["d".into(), summary.session_id.clone()],
                vec!["p".into(), pubkey.clone()],
            ],
            content: render_summary_content(&summary),
        };
        let signed = sign_event(unsigned, &signing_key).unwrap();

        // The same serde round-trip publish_session_summary uses must yield a
        // relay Event that passes the relay's own canonical-id + signature check.
        let relay_event: Event =
            serde_json::from_value(serde_json::to_value(&signed).unwrap()).unwrap();
        assert!(relay_event.verify().is_ok());
        assert_eq!(relay_event.d_tag(), Some("sess-1"));
    }

    /// Derive the x-only pubkey hex for a raw secret key.
    fn pk_of(sk: &[u8; 32]) -> String {
        hex::encode(signing_key_from_bytes(sk).unwrap().verifying_key().to_bytes())
    }

    /// Serde-round-trip a crypto-crate `NostrEvent` into a relay `Event` — the
    /// inverse of the `to_core_event` the bridge runs on ingress.
    fn as_relay_event(ev: &NostrEvent) -> Event {
        serde_json::from_value(serde_json::to_value(ev).unwrap()).unwrap()
    }

    // ── Behaviour 1: NIP-59 gift-wrap unwrap (effective_message) ─────────────

    #[test]
    fn gift_wrap_unwraps_through_effective_message() {
        use nostr_bbs_core::gift_wrap;

        let recipient_sk = [9u8; 32];
        let recipient_pk = pk_of(&recipient_sk);
        let sender_sk = [3u8; 32];
        let sender_pk = pk_of(&sender_sk);

        // A real two-layer NIP-59 wrap (rumor → seal → gift) addressed to us.
        let wrap = gift_wrap(&sender_sk, &sender_pk, &recipient_pk, "ping from phone").unwrap();
        let relay_event = as_relay_event(&wrap);

        let c = BridgeConfig {
            recipient_pubkey: recipient_pk,
            recipient_sk,
            ..cfg()
        };
        let msg = effective_message(&relay_event, &c).expect("unwrap should succeed");

        assert!(msg.gift_wrapped);
        assert_eq!(msg.sender_pubkey, sender_pk, "sender recovered from the seal");
        assert_eq!(msg.kind, KIND_DM, "effective kind is the inner rumor kind");
        assert_eq!(msg.content, "ping from phone");
        // The inner rumor carries the real recipient `p` tag, so addressing only
        // passes *after* the unwrap — proving the call-site is exercised.
        assert!(addressed_to(&c.recipient_pubkey, &relay_event, &msg.tags));
    }

    #[test]
    fn gift_wrap_for_other_recipient_fails_unwrap() {
        use nostr_bbs_core::gift_wrap;

        let intended_sk = [9u8; 32];
        let intended_pk = pk_of(&intended_sk);
        let sender_sk = [3u8; 32];
        let sender_pk = pk_of(&sender_sk);
        let wrap = gift_wrap(&sender_sk, &sender_pk, &intended_pk, "secret").unwrap();
        let relay_event = as_relay_event(&wrap);

        // Our bridge holds a different key → NIP-44 decryption must fail.
        let wrong_sk = [4u8; 32];
        let c = BridgeConfig {
            recipient_pubkey: pk_of(&wrong_sk),
            recipient_sk: wrong_sk,
            ..cfg()
        };
        assert!(matches!(
            effective_message(&relay_event, &c),
            Err(IngressError::Unwrap(_))
        ));
    }

    // ── Behaviour 2: NIP-26 delegation validation (authorize) ────────────────

    #[test]
    fn valid_admin_delegation_authorizes() {
        use nostr_bbs_core::{Conditions, DelegationTag, DelegationToken};

        let admin_sk = [5u8; 32];
        let admin_pk = pk_of(&admin_sk);
        let author_pk = pk_of(&[6u8; 32]);

        let conditions = Conditions::from_str("kind=1").unwrap();
        let token = DelegationToken::create(&admin_sk, &author_pk, &conditions).unwrap();
        let tag = DelegationTag::from_token(&token).0;

        let c = BridgeConfig {
            admin_pubkey: admin_pk.clone(),
            ..cfg()
        };
        let e = ev(&author_pk, 1, vec![tag]);
        let authz = authorize(&e, &c).expect("admin-signed delegation must authorize");
        assert!(matches!(authz, Authz::Delegated { delegator } if delegator == admin_pk));
    }

    #[test]
    fn admin_delegation_for_wrong_kind_rejected() {
        use nostr_bbs_core::{Conditions, DelegationTag, DelegationToken};

        let admin_sk = [5u8; 32];
        let admin_pk = pk_of(&admin_sk);
        let author_pk = pk_of(&[6u8; 32]);

        // Delegation only permits kind=1; the event is kind 5.
        let conditions = Conditions::from_str("kind=1").unwrap();
        let token = DelegationToken::create(&admin_sk, &author_pk, &conditions).unwrap();
        let tag = DelegationTag::from_token(&token).0;

        let c = BridgeConfig {
            admin_pubkey: admin_pk,
            ..cfg()
        };
        let e = ev(&author_pk, 5, vec![tag]);
        assert!(matches!(authorize(&e, &c), Err(IngressError::Unauthorized(_))));
    }

    #[test]
    fn admin_delegation_with_expired_window_rejected() {
        use nostr_bbs_core::{Conditions, DelegationTag, DelegationToken};

        let admin_sk = [5u8; 32];
        let admin_pk = pk_of(&admin_sk);
        let author_pk = pk_of(&[6u8; 32]);

        // Permits only events created before t=1000; ev() stamps 1_700_000_000.
        let conditions = Conditions::from_str("kind=1&created_at<1000").unwrap();
        let token = DelegationToken::create(&admin_sk, &author_pk, &conditions).unwrap();
        let tag = DelegationTag::from_token(&token).0;

        let c = BridgeConfig {
            admin_pubkey: admin_pk,
            ..cfg()
        };
        let e = ev(&author_pk, 1, vec![tag]);
        assert!(matches!(authorize(&e, &c), Err(IngressError::Unauthorized(_))));
    }

    #[test]
    fn admin_delegation_with_tampered_signature_rejected() {
        use nostr_bbs_core::{Conditions, DelegationTag, DelegationToken};

        let admin_sk = [5u8; 32];
        let admin_pk = pk_of(&admin_sk);
        let author_pk = pk_of(&[6u8; 32]);

        let conditions = Conditions::from_str("kind=1").unwrap();
        let mut token = DelegationToken::create(&admin_sk, &author_pk, &conditions).unwrap();
        token.sig = "00".repeat(64); // valid delegator, broken Schnorr signature
        let tag = DelegationTag::from_token(&token).0;

        let c = BridgeConfig {
            admin_pubkey: admin_pk,
            ..cfg()
        };
        let e = ev(&author_pk, 1, vec![tag]);
        assert!(matches!(authorize(&e, &c), Err(IngressError::Unauthorized(_))));
    }
}
