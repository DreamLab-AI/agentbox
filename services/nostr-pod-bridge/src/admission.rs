//! Relay-boundary publisher admission and the two-boundary ingress contract
//! (ADR-2012).
//!
//! # Why this module exists
//!
//! ADR-2012 declares relay ingress to be *allowlist-only, with no fallback and
//! no auto-add*. Before this module the declaration was only half-implemented:
//! the embedded relay verified the Schnorr signature, **stored, broadcast and
//! acknowledged** an event, and only then did the pod-inbox consumer apply the
//! allowlist. An unlisted publisher therefore still got a positive NIP-20 `OK`,
//! still landed in the relay's store, and was still fanned out to every live
//! subscriber — it just never reached the pod. That is signed-only admission
//! with an allowlisted *inbox*, not an allowlisted *relay*.
//!
//! [`admit_and_dispatch`] moves the decision in front of all three effects: an
//! unlisted author is refused with an explicit negative `OK` and the event is
//! never handed to [`solid_pod_rs_nostr::Relay`] at all.
//!
//! # The two-boundary contract (relay OK ≠ authorised commit)
//!
//! Admission and authorisation remain **separate boundaries with separate
//! meanings**, and nothing in this module collapses them:
//!
//! | Boundary | Question | Owner | Effect of a pass |
//! |---|---|---|---|
//! | [`IngressBoundary::RelayAdmission`] | may this pubkey publish here at all? | [`PublisherPolicy`] via [`admit_and_dispatch`] | the event is verified, stored, broadcast and `OK`-ed |
//! | [`IngressBoundary::InboxAuthorisation`] | may this event be committed to *this agent's* pod? | `authorize` + `process_event` in [`crate`] | a durable LDN document is written to the pod inbox |
//!
//! A relay `OK` is a *transport* acknowledgement: it means "accepted for
//! broadcast", never "authorised, unwrapped and committed". The inbox consumer
//! re-authorises every event independently; [`AdmissionAudit::record`] leaves a
//! durable trail whenever the two boundaries disagree, which is the only
//! evidence that would show a policy divergence between them.
//!
//! # Empty allowlist is DENY-ALL
//!
//! An empty allowlist is a defined policy, not an accident: every *remote*
//! publisher is refused ([`RejectReason::DenyAllEmptyAllowlist`], counted and
//! logged separately from an ordinary miss so an operator can tell a
//! mis-provisioned list from a genuine rejection). The pod owner's own key is
//! never a remote publisher — the egress path signs locally and persists to the
//! pod directly — so self-authored events stay admissible and the live phone
//! mirror keeps working under a deny-all policy. Both boundaries agree on this:
//! the consumer skips self-authored events before authorising, and `authorize`
//! rejects every non-self author when the allowlist is empty.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, ErrorKind};
use tracing::{debug, warn};

use crate::BridgeConfig;

/// Which of the two ingress boundaries a decision was taken at.
///
/// Exists so a log line, an audit record or a future metric can never be
/// ambiguous about *which* gate spoke — the ambiguity ADR-2012 was reopened for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngressBoundary {
    /// The relay's publisher gate: decided before store, broadcast or `OK`.
    RelayAdmission,
    /// The pod-inbox gate: decided before any gift-wrap peel or pod write.
    InboxAuthorisation,
}

impl IngressBoundary {
    pub fn as_str(self) -> &'static str {
        match self {
            IngressBoundary::RelayAdmission => "relay-admission",
            IngressBoundary::InboxAuthorisation => "inbox-authorisation",
        }
    }
}

/// Why an author was admitted at the relay boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmitReason {
    /// The pod owner's own key: locally authored egress, not a remote publisher.
    SelfAuthored,
    /// The author is on the build-baked allowlist.
    AllowListed,
}

/// Why an author was refused at the relay boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    /// The allowlist is non-empty and this author is not on it.
    NotAllowListed,
    /// The allowlist is empty: the defined policy is deny-all (fail closed).
    DenyAllEmptyAllowlist,
    /// The frame was shaped like an `EVENT` but carried no usable author.
    MalformedEvent,
}

impl RejectReason {
    /// NIP-20 machine-readable prefix + reason for the negative `OK` frame.
    ///
    /// `blocked:` is the NIP-20 prefix for "this relay refuses to accept this
    /// event from you", as distinct from `invalid:` (bad signature/structure).
    pub fn ok_message(self) -> &'static str {
        match self {
            RejectReason::NotAllowListed => {
                "blocked: author not on this relay's publisher allowlist (ADR-2012 allowlist-only ingress)"
            }
            RejectReason::DenyAllEmptyAllowlist => {
                "blocked: relay publisher allowlist is empty — deny-all policy (ADR-2012, fail closed)"
            }
            RejectReason::MalformedEvent => "invalid: EVENT frame carries no author pubkey",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RejectReason::NotAllowListed => "not-allow-listed",
            RejectReason::DenyAllEmptyAllowlist => "deny-all-empty-allowlist",
            RejectReason::MalformedEvent => "malformed-event",
        }
    }
}

/// The relay-boundary decision for one author.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionDecision {
    Admit(AdmitReason),
    Reject(RejectReason),
}

impl AdmissionDecision {
    pub fn is_admitted(self) -> bool {
        matches!(self, AdmissionDecision::Admit(_))
    }
}

/// Who may publish to this relay.
///
/// Built once from [`BridgeConfig`] at daemon start; the allowlist is a
/// build-baked artefact (`AGENTBOX_ALLOWED_PUBKEYS`), so there is deliberately
/// no runtime mutation path — no auto-add, no fallback (ADR-2012).
#[derive(Debug, Clone)]
pub struct PublisherPolicy {
    allowed: BTreeSet<String>,
    self_pubkey: String,
}

impl PublisherPolicy {
    pub fn new<I: IntoIterator<Item = String>>(allowed: I, self_pubkey: String) -> Self {
        Self {
            allowed: allowed
                .into_iter()
                .map(|p| p.trim().to_lowercase())
                .filter(|p| !p.is_empty())
                .collect(),
            self_pubkey: self_pubkey.trim().to_lowercase(),
        }
    }

    pub fn from_config(cfg: &BridgeConfig) -> Self {
        Self::new(
            cfg.allowed_pubkeys.iter().cloned(),
            cfg.recipient_pubkey.clone(),
        )
    }

    /// True when the allowlist is empty — the deny-all policy is in force.
    pub fn is_deny_all(&self) -> bool {
        self.allowed.is_empty()
    }

    pub fn allowed_count(&self) -> usize {
        self.allowed.len()
    }

    /// Decide whether `author` may publish. Comparison is a plain lowercase-hex
    /// match (ADR-2011: hex-canonical identity), so a differently-cased pubkey
    /// is the same identity rather than a second one.
    pub fn admit(&self, author: &str) -> AdmissionDecision {
        let author = author.trim().to_lowercase();
        if author.is_empty() {
            return AdmissionDecision::Reject(RejectReason::MalformedEvent);
        }
        if author == self.self_pubkey {
            return AdmissionDecision::Admit(AdmitReason::SelfAuthored);
        }
        if self.allowed.contains(&author) {
            return AdmissionDecision::Admit(AdmitReason::AllowListed);
        }
        AdmissionDecision::Reject(if self.is_deny_all() {
            RejectReason::DenyAllEmptyAllowlist
        } else {
            RejectReason::NotAllowListed
        })
    }
}

/// Counters for the relay boundary. Distinct counters for an ordinary miss and
/// for the deny-all policy, so an empty (mis-provisioned) allowlist is
/// diagnosable without reading the config.
#[derive(Debug, Default)]
pub struct AdmissionCounters {
    pub admitted: AtomicU64,
    pub rejected_not_listed: AtomicU64,
    pub rejected_deny_all: AtomicU64,
    pub rejected_malformed: AtomicU64,
    /// Events the relay admitted that the inbox consumer then refused: the
    /// measurable divergence between the two boundaries.
    pub inbox_rejected_after_relay_ok: AtomicU64,
}

impl AdmissionCounters {
    fn note(&self, decision: AdmissionDecision) {
        let c = match decision {
            AdmissionDecision::Admit(_) => &self.admitted,
            AdmissionDecision::Reject(RejectReason::NotAllowListed) => &self.rejected_not_listed,
            AdmissionDecision::Reject(RejectReason::DenyAllEmptyAllowlist) => {
                &self.rejected_deny_all
            }
            AdmissionDecision::Reject(RejectReason::MalformedEvent) => &self.rejected_malformed,
        };
        c.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> [(&'static str, u64); 5] {
        [
            ("admitted", self.admitted.load(Ordering::Relaxed)),
            (
                "rejected_not_listed",
                self.rejected_not_listed.load(Ordering::Relaxed),
            ),
            (
                "rejected_deny_all",
                self.rejected_deny_all.load(Ordering::Relaxed),
            ),
            (
                "rejected_malformed",
                self.rejected_malformed.load(Ordering::Relaxed),
            ),
            (
                "inbox_rejected_after_relay_ok",
                self.inbox_rejected_after_relay_ok.load(Ordering::Relaxed),
            ),
        ]
    }
}

/// Append-only audit sink for admission decisions that were refused at either
/// boundary.
///
/// The file is the durable evidence the ADR-2012 closeout asks for: it makes a
/// relay-accepted-but-inbox-rejected event (the two boundaries disagreeing)
/// visible after the fact, and records every publisher the relay turned away.
/// Best-effort by construction — an unwritable pod must never stop the relay
/// enforcing its policy, so a failed append is logged and dropped.
#[derive(Debug, Clone)]
pub struct AdmissionAudit {
    path: PathBuf,
}

impl AdmissionAudit {
    /// `<pod_root>/pods/<recipient>/events/audit/relay-admission.jsonl`
    pub fn for_config(cfg: &BridgeConfig) -> Self {
        Self {
            path: audit_path(&cfg.pod_root, &cfg.recipient_pubkey),
        }
    }

    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one JSON line. `boundary` says which gate refused, so a reader can
    /// tell "never entered the relay" from "relayed but not committed".
    pub async fn record(
        &self,
        boundary: IngressBoundary,
        event_id: &str,
        author: &str,
        kind: Option<u64>,
        reason: &str,
    ) {
        let line = json!({
            "ts": unix_now(),
            "boundary": boundary.as_str(),
            "event_id": event_id,
            "author": author,
            "kind": kind,
            "reason": reason,
        });
        if let Err(e) = self.append(&line).await {
            warn!(error = %e, path = %self.path.display(), "admission audit append failed");
        }
    }

    async fn append(&self, line: &Value) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            match tokio::fs::create_dir_all(parent).await {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
        }
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        let mut buf = serde_json::to_vec(line)?;
        buf.push(b'\n');
        f.write_all(&buf).await?;
        f.flush().await
    }
}

fn audit_path(pod_root: &Path, recipient: &str) -> PathBuf {
    pod_root
        .join("pods")
        .join(recipient)
        .join("events")
        .join("audit")
        .join("relay-admission.jsonl")
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// What [`inspect_frame`] made of one client frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameAdmission {
    /// Not an `EVENT` publish (a `REQ`, `CLOSE`, or unparseable frame):
    /// publisher admission does not apply and the frame goes to the relay's own
    /// dispatcher, which owns those semantics.
    NotAPublish,
    /// An `EVENT` frame whose author may publish here.
    Admitted {
        event_id: String,
        author: String,
        kind: Option<u64>,
        reason: AdmitReason,
    },
    /// An `EVENT` frame refused at the relay boundary. The event must not be
    /// verified-and-stored, broadcast, or positively acknowledged.
    Rejected {
        event_id: String,
        author: String,
        kind: Option<u64>,
        reason: RejectReason,
    },
}

/// Classify one raw client frame against the publisher policy.
///
/// Pure: no relay contact, no I/O. Unparseable or non-`EVENT` frames are
/// [`FrameAdmission::NotAPublish`] — this gate refuses publishers, it does not
/// duplicate the relay's wire-protocol validation.
pub fn inspect_frame(policy: &PublisherPolicy, text: &str) -> FrameAdmission {
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return FrameAdmission::NotAPublish;
    };
    let Some(arr) = parsed.as_array() else {
        return FrameAdmission::NotAPublish;
    };
    if arr.first().and_then(|v| v.as_str()) != Some("EVENT") {
        return FrameAdmission::NotAPublish;
    }
    let Some(ev) = arr.get(1) else {
        return FrameAdmission::NotAPublish;
    };
    let event_id = ev
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let author = ev
        .get("pubkey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let kind = ev.get("kind").and_then(|v| v.as_u64());
    match policy.admit(&author) {
        AdmissionDecision::Admit(reason) => FrameAdmission::Admitted {
            event_id,
            author,
            kind,
            reason,
        },
        AdmissionDecision::Reject(reason) => FrameAdmission::Rejected {
            event_id,
            author,
            kind,
            reason,
        },
    }
}

/// The NIP-20 acknowledgement frame for a refused publish.
pub fn reject_frame(event_id: &str, reason: RejectReason) -> String {
    json!(["OK", event_id, false, reason.ok_message()]).to_string()
}

/// Everything the relay boundary needs at runtime: the policy, its counters and
/// the audit sink.
#[derive(Debug)]
pub struct RelayAdmission {
    pub policy: PublisherPolicy,
    pub counters: AdmissionCounters,
    pub audit: AdmissionAudit,
}

impl RelayAdmission {
    pub fn from_config(cfg: &BridgeConfig) -> Self {
        Self {
            policy: PublisherPolicy::from_config(cfg),
            counters: AdmissionCounters::default(),
            audit: AdmissionAudit::for_config(cfg),
        }
    }

    /// Gate one client frame.
    ///
    /// Returns `Some(frames)` when the frame was refused here — those frames are
    /// the complete response and the relay was never touched. Returns `None`
    /// when the frame may proceed to the relay's own dispatcher.
    ///
    /// This is the ordering ADR-2012 requires: reject → respond, with no store,
    /// no broadcast and no positive `OK` anywhere on the path.
    pub async fn gate(&self, text: &str) -> Option<Vec<String>> {
        match inspect_frame(&self.policy, text) {
            FrameAdmission::NotAPublish => None,
            FrameAdmission::Admitted {
                event_id,
                author,
                reason,
                ..
            } => {
                self.counters
                    .note(AdmissionDecision::Admit(reason));
                debug!(
                    event_id = %event_id, author = %author, reason = ?reason,
                    "relay admission: publish accepted for verification"
                );
                None
            }
            FrameAdmission::Rejected {
                event_id,
                author,
                kind,
                reason,
            } => {
                self.counters.note(AdmissionDecision::Reject(reason));
                warn!(
                    event_id = %event_id, author = %author, reason = reason.as_str(),
                    deny_all = self.policy.is_deny_all(),
                    "relay admission: publish REFUSED at the relay boundary (not stored, not broadcast)"
                );
                self.audit
                    .record(
                        IngressBoundary::RelayAdmission,
                        &event_id,
                        &author,
                        kind,
                        reason.as_str(),
                    )
                    .await;
                Some(vec![reject_frame(&event_id, reason)])
            }
        }
    }

    /// Record that an event the relay admitted was refused by the *inbox*
    /// boundary. This is the contract's evidence that a relay `OK` is not an
    /// authorised commit.
    pub async fn note_inbox_rejection(&self, event_id: &str, author: &str, reason: &str) {
        self.counters
            .inbox_rejected_after_relay_ok
            .fetch_add(1, Ordering::Relaxed);
        self.audit
            .record(
                IngressBoundary::InboxAuthorisation,
                event_id,
                author,
                None,
                reason,
            )
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(allowed: &[&str]) -> PublisherPolicy {
        PublisherPolicy::new(
            allowed.iter().map(|s| s.to_string()),
            "a".repeat(64), // the pod owner's own key
        )
    }

    fn event_frame(pubkey: &str) -> String {
        json!(["EVENT", {
            "id": "ff".repeat(32),
            "pubkey": pubkey,
            "created_at": 1_700_000_000u64,
            "kind": 1059,
            "tags": [],
            "content": "",
            "sig": "00".repeat(64),
        }])
        .to_string()
    }

    #[test]
    fn listed_author_is_admitted() {
        let p = policy(&[&"c".repeat(64)]);
        assert_eq!(
            p.admit(&"c".repeat(64)),
            AdmissionDecision::Admit(AdmitReason::AllowListed)
        );
    }

    #[test]
    fn unlisted_author_is_rejected() {
        let p = policy(&[&"c".repeat(64)]);
        assert_eq!(
            p.admit(&"f".repeat(64)),
            AdmissionDecision::Reject(RejectReason::NotAllowListed)
        );
    }

    #[test]
    fn empty_allowlist_denies_every_remote_author() {
        let p = policy(&[]);
        assert!(p.is_deny_all());
        for author in [&"c".repeat(64), &"f".repeat(64)] {
            assert_eq!(
                p.admit(author),
                AdmissionDecision::Reject(RejectReason::DenyAllEmptyAllowlist),
                "empty allowlist must deny {author}"
            );
        }
    }

    #[test]
    fn self_author_is_admitted_even_under_deny_all() {
        // The egress path signs locally and persists to the pod directly; the
        // live phone mirror must keep working when the allowlist is empty.
        let p = policy(&[]);
        assert_eq!(
            p.admit(&"a".repeat(64)),
            AdmissionDecision::Admit(AdmitReason::SelfAuthored)
        );
    }

    #[test]
    fn author_match_is_case_insensitive_and_canonical() {
        let p = policy(&[&"C".repeat(64)]);
        assert!(p.admit(&"c".repeat(64)).is_admitted());
        assert!(p.admit(&"C".repeat(64)).is_admitted());
    }

    #[test]
    fn missing_author_is_malformed_not_admitted() {
        let p = policy(&[&"c".repeat(64)]);
        assert_eq!(
            p.admit(""),
            AdmissionDecision::Reject(RejectReason::MalformedEvent)
        );
    }

    #[test]
    fn inspect_frame_ignores_non_publish_frames() {
        let p = policy(&[&"c".repeat(64)]);
        assert_eq!(
            inspect_frame(&p, r#"["REQ","sub",{"kinds":[1]}]"#),
            FrameAdmission::NotAPublish
        );
        assert_eq!(
            inspect_frame(&p, r#"["CLOSE","sub"]"#),
            FrameAdmission::NotAPublish
        );
        assert_eq!(inspect_frame(&p, "not json"), FrameAdmission::NotAPublish);
    }

    #[test]
    fn inspect_frame_classifies_publishes() {
        let p = policy(&[&"c".repeat(64)]);
        match inspect_frame(&p, &event_frame(&"c".repeat(64))) {
            FrameAdmission::Admitted { reason, kind, .. } => {
                assert_eq!(reason, AdmitReason::AllowListed);
                assert_eq!(kind, Some(1059));
            }
            other => panic!("expected admitted, got {other:?}"),
        }
        match inspect_frame(&p, &event_frame(&"f".repeat(64))) {
            FrameAdmission::Rejected { reason, .. } => {
                assert_eq!(reason, RejectReason::NotAllowListed)
            }
            other => panic!("expected rejected, got {other:?}"),
        }
    }

    #[test]
    fn reject_frame_is_a_nip20_negative_ok() {
        let frame = reject_frame(&"ff".repeat(32), RejectReason::NotAllowListed);
        let v: Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v[0], "OK");
        assert_eq!(v[1], "ff".repeat(32));
        assert_eq!(v[2], false);
        assert!(v[3].as_str().unwrap().starts_with("blocked:"));
    }

    #[test]
    fn deny_all_reject_message_is_distinct_from_a_plain_miss() {
        assert_ne!(
            RejectReason::DenyAllEmptyAllowlist.ok_message(),
            RejectReason::NotAllowListed.ok_message()
        );
        assert!(RejectReason::DenyAllEmptyAllowlist
            .ok_message()
            .contains("deny-all"));
    }
}
