//! Building the unsigned events. Signing is the caller's — this crate never
//! touches key material, and every function here returns a template for
//! whoever holds the key to sign.
//!
//! ```
//! use colloquy_core::{kind::UnitKind, unit::{Insight, KnowledgeUnit}, time::Timestamp};
//! use colloquy_nostr::{encode::unit_event, kinds::KIND_KNOWLEDGE_UNIT, tags};
//!
//! let t = Timestamp::from_secs(1_767_225_600);
//! let unit = KnowledgeUnit::propose(
//!     "did:nostr:abc", UnitKind::Workaround, ["http", "retry"],
//!     Insight::new("s", "d", "a"), t,
//! );
//! let ev = unit_event(&unit, &"ab".repeat(32), t);
//!
//! assert_eq!(ev.kind, KIND_KNOWLEDGE_UNIT);
//! assert_eq!(tags::first(&ev.tags, tags::TAG_D), Some(unit.id.hex()));
//! assert_eq!(tags::all(&ev.tags, tags::TAG_T), vec!["http", "retry"]);
//! ```

use colloquy_core::cluster::GapCandidate;
use colloquy_core::time::Timestamp;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::UnitId;
use crate::event::UnsignedEvent;

use crate::kinds::*;
use crate::tags::{self, *};

/// Serialise a tier to its cq wire token without going through a whole unit.
fn tier_token(t: Tier) -> &'static str {
    match t {
        Tier::Local => "local",
        Tier::Shared => "remote",
        Tier::Public => "global",
    }
}

/// The NIP-33 address of a unit published by `pubkey`.
pub fn unit_address(pubkey: &str, id: &UnitId) -> String {
    tags::address(KIND_KNOWLEDGE_UNIT, pubkey, id.hex())
}

/// Build the addressable event carrying a knowledge unit.
///
/// The content is the unit's own JSON — the same document a cq implementation
/// would hold — so a reader that knows nothing about this crate still gets a
/// valid unit out of the event body.
pub fn unit_event(unit: &KnowledgeUnit, pubkey: &str, created_at: Timestamp) -> UnsignedEvent {
    let mut tags = vec![vec![TAG_D.to_string(), unit.id.hex().to_string()]];
    for d in &unit.domain {
        tags.push(vec![TAG_T.to_string(), d.clone()]);
    }
    tags.push(vec![TAG_LADDER.to_string(), unit.lifecycle.kind.to_string()]);
    tags.push(vec![TAG_TIER.to_string(), tier_token(unit.tier()).to_string()]);
    tags.push(vec![TAG_VERSION.to_string(), unit.version.clone()]);

    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at: created_at.as_secs().max(0) as u64,
        kind: KIND_KNOWLEDGE_UNIT,
        tags,
        content: serde_json::to_string(unit).expect("a KnowledgeUnit always serialises"),
    }
}

/// Build a confirmation or a flag against a unit.
///
/// Both carry the same references — the event, the address, and the unit's
/// author — and differ only in kind, because a surface that renders one renders
/// the other and the two have to thread identically.
fn attestation_event(
    kind: u64,
    unit_event_id: &str,
    unit_author: &str,
    unit_id: &UnitId,
    pubkey: &str,
    created_at: Timestamp,
    note: &str,
) -> UnsignedEvent {
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at: created_at.as_secs().max(0) as u64,
        kind,
        tags: vec![
            vec![TAG_E.to_string(), unit_event_id.to_string()],
            vec![TAG_A.to_string(), unit_address(unit_author, unit_id)],
            vec![TAG_P.to_string(), unit_author.to_string()],
        ],
        content: note.to_string(),
    }
}

/// An independent confirmation. `note` may be empty.
pub fn confirmation_event(
    unit_event_id: &str,
    unit_author: &str,
    unit_id: &UnitId,
    pubkey: &str,
    created_at: Timestamp,
    note: &str,
) -> UnsignedEvent {
    attestation_event(
        KIND_CONFIRMATION,
        unit_event_id,
        unit_author,
        unit_id,
        pubkey,
        created_at,
        note,
    )
}

/// A flag. The reason goes in the content and is expected to be non-empty: a
/// flag without a reason is unanswerable, and the whole design of flagging here
/// is that it opens a conversation rather than closing one.
pub fn flag_event(
    unit_event_id: &str,
    unit_author: &str,
    unit_id: &UnitId,
    pubkey: &str,
    created_at: Timestamp,
    reason: &str,
) -> UnsignedEvent {
    attestation_event(
        KIND_FLAG,
        unit_event_id,
        unit_author,
        unit_id,
        pubkey,
        created_at,
        reason,
    )
}

/// A supersession: `new_id` replaces `old_id`.
///
/// Both units are referenced by event id *and* by address, with NIP-10 markers
/// distinguishing the two `e` tags, so a client can render the pair without
/// resolving anything first.
#[allow(clippy::too_many_arguments)]
pub fn supersession_event(
    old_event_id: &str,
    old_author: &str,
    old_id: &UnitId,
    new_event_id: &str,
    new_author: &str,
    new_id: &UnitId,
    pubkey: &str,
    created_at: Timestamp,
    rationale: &str,
) -> UnsignedEvent {
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at: created_at.as_secs().max(0) as u64,
        kind: KIND_SUPERSESSION,
        tags: vec![
            vec![
                TAG_E.to_string(),
                old_event_id.to_string(),
                String::new(),
                MARKER_SUPERSEDED.to_string(),
            ],
            vec![
                TAG_E.to_string(),
                new_event_id.to_string(),
                String::new(),
                MARKER_SUPERSEDES.to_string(),
            ],
            vec![TAG_A.to_string(), unit_address(old_author, old_id)],
            vec![TAG_A.to_string(), unit_address(new_author, new_id)],
        ],
        content: rationale.to_string(),
    }
}

/// A tier promotion, citing the signed decision that authorised it.
///
/// `decision_event_id` is the `31403` ActionResponse the approver signed. It is
/// the reason this design improves on recording an approver's name: a reader can
/// fetch that event from the relay and check the signature themselves.
#[allow(clippy::too_many_arguments)]
pub fn graduation_event(
    unit_event_id: &str,
    unit_author: &str,
    unit_id: &UnitId,
    from: Tier,
    to: Tier,
    approver_pubkey: &str,
    decision_event_id: Option<&str>,
    pubkey: &str,
    created_at: Timestamp,
) -> UnsignedEvent {
    let mut tags = vec![
        vec![TAG_E.to_string(), unit_event_id.to_string()],
        vec![TAG_A.to_string(), unit_address(unit_author, unit_id)],
        vec![TAG_P.to_string(), approver_pubkey.to_string()],
        vec![TAG_FROM.to_string(), tier_token(from).to_string()],
        vec![TAG_TO.to_string(), tier_token(to).to_string()],
    ];
    if let Some(d) = decision_event_id {
        tags.push(vec![TAG_DECISION.to_string(), d.to_string()]);
    }
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at: created_at.as_secs().max(0) as u64,
        kind: KIND_GRADUATION,
        tags,
        content: String::new(),
    }
}

/// An emergent tooling-gap signal.
///
/// Addressable on the tag the cluster formed around, so republishing a growing
/// gap replaces the previous statement of it rather than accumulating copies.
pub fn gap_signal_event(
    gap: &GapCandidate,
    member_event_ids: &[String],
    pubkey: &str,
    created_at: Timestamp,
) -> UnsignedEvent {
    let mut tags = vec![vec![TAG_D.to_string(), gap.tag.clone()]];
    for t in &gap.common_domain {
        tags.push(vec![TAG_T.to_string(), t.clone()]);
    }
    for e in member_event_ids {
        tags.push(vec![TAG_E.to_string(), e.clone()]);
    }
    UnsignedEvent {
        pubkey: pubkey.to_string(),
        created_at: created_at.as_secs().max(0) as u64,
        kind: KIND_TOOL_GAP_SIGNAL,
        tags,
        content: serde_json::to_string(gap).expect("a GapCandidate always serialises"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::Insight;

    fn pk(seed: &str) -> String {
        seed.repeat(64 / seed.len())
    }

    fn unit() -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:p",
            UnitKind::Workaround,
            ["http", "retry"],
            Insight::new("s", "d", "a"),
            Timestamp::from_secs(0),
        )
    }

    #[test]
    fn the_unit_event_carries_the_whole_unit_in_its_content() {
        let u = unit();
        let ev = unit_event(&u, &pk("ab"), Timestamp::from_secs(10));
        let parsed: KnowledgeUnit = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(parsed, u, "content must be the unit, not a summary of it");
    }

    #[test]
    fn domain_tags_are_relay_indexable_singles() {
        let ev = unit_event(&unit(), &pk("ab"), Timestamp::from_secs(0));
        let t: Vec<&Vec<String>> = ev.tags.iter().filter(|t| t[0] == "t").collect();
        assert_eq!(t.len(), 2);
        assert!(t.iter().all(|t| t[0].len() == 1), "t must stay single-letter");
    }

    #[test]
    fn a_flag_and_a_confirmation_thread_identically() {
        let u = unit();
        let c = confirmation_event("ev1", &pk("ab"), &u.id, &pk("cd"), Timestamp::from_secs(1), "");
        let f = flag_event("ev1", &pk("ab"), &u.id, &pk("cd"), Timestamp::from_secs(1), "wrong");
        assert_eq!(c.tags, f.tags, "same references, different kind");
        assert_ne!(c.kind, f.kind);
        assert_eq!(f.content, "wrong");
    }

    #[test]
    fn a_graduation_without_a_signed_decision_omits_the_tag() {
        let u = unit();
        let signed = graduation_event(
            "ev1", &pk("ab"), &u.id, Tier::Local, Tier::Shared, &pk("cd"),
            Some("decision-id"), &pk("ef"), Timestamp::from_secs(0),
        );
        let unsigned = graduation_event(
            "ev1", &pk("ab"), &u.id, Tier::Local, Tier::Shared, &pk("cd"),
            None, &pk("ef"), Timestamp::from_secs(0),
        );
        assert_eq!(tags::first(&signed.tags, TAG_DECISION), Some("decision-id"));
        assert_eq!(tags::first(&unsigned.tags, TAG_DECISION), None);
        assert_eq!(tags::first(&signed.tags, TAG_TO), Some("remote"));
    }

    #[test]
    fn a_supersession_marks_which_way_round_it_goes() {
        let u = unit();
        let ev = supersession_event(
            "old", &pk("ab"), &u.id, "new", &pk("ab"), &u.id, &pk("ab"),
            Timestamp::from_secs(0), "tooling landed",
        );
        assert_eq!(tags::e_with_marker(&ev.tags, MARKER_SUPERSEDED), Some("old"));
        assert_eq!(tags::e_with_marker(&ev.tags, MARKER_SUPERSEDES), Some("new"));
    }
}
