//! Reading signed events back into the core types.
//!
//! The decoder **re-derives** rather than trusts. A unit's content is parsed and
//! then checked against its own content address and against the `d` tag that
//! addressed it; a disagreement is an error, not a preference. Tags are an
//! index, and an index that disagrees with the data it indexes is evidence of
//! tampering or of two writers racing, both of which a consumer should hear
//! about rather than silently resolve.

use crate::event::NostrEvent;
use colloquy_core::time::Timestamp;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::UnitId;

use crate::kinds::*;
use crate::tags::{self, *};

/// Why an event could not be read as colloquy data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    /// The event's kind is not one this crate reads, or not the one expected.
    #[error("expected kind {expected}, found {found}")]
    WrongKind {
        /// Kind required.
        expected: u64,
        /// Kind found.
        found: u64,
    },
    /// The content is not the JSON this kind carries.
    #[error("content is not valid {what} JSON: {detail}")]
    BadContent {
        /// What was expected.
        what: &'static str,
        /// The parser's complaint.
        detail: String,
    },
    /// A tag the grammar requires is absent.
    #[error("missing required tag `{0}`")]
    MissingTag(&'static str),
    /// The `d` tag and the content's own id disagree.
    #[error("the `d` tag says `{tag}` but the content's id is `{content}`")]
    IdentifierMismatch {
        /// What the tag said.
        tag: String,
        /// What the content said.
        content: String,
    },
    /// The content does not hash to the id it claims.
    #[error("the unit's id is not its content address: {0}")]
    NotContentAddressed(String),
    /// A tier token outside `local` / `remote` / `global`.
    #[error("`{0}` is not a tier")]
    BadTier(String),
}

/// Read a knowledge unit from a `38410` event.
///
/// Verifying the event signature is the caller's job and must happen first —
/// `nostr_bbs_core::verify_event_strict` is the function for it. This decoder
/// assumes an event that has already been accepted and checks only that its
/// *payload* is internally consistent.
pub fn unit_from_event(ev: &NostrEvent) -> Result<KnowledgeUnit, DecodeError> {
    if ev.kind != KIND_KNOWLEDGE_UNIT {
        return Err(DecodeError::WrongKind {
            expected: KIND_KNOWLEDGE_UNIT,
            found: ev.kind,
        });
    }
    let unit: KnowledgeUnit =
        serde_json::from_str(&ev.content).map_err(|e| DecodeError::BadContent {
            what: "KnowledgeUnit",
            detail: e.to_string(),
        })?;

    let d = tags::first(&ev.tags, TAG_D).ok_or(DecodeError::MissingTag(TAG_D))?;
    if d != unit.id.hex() {
        return Err(DecodeError::IdentifierMismatch {
            tag: d.to_string(),
            content: unit.id.hex().to_string(),
        });
    }

    let expected = UnitId::mint(
        &unit.provenance.proposer_did,
        &unit.domain,
        &unit.insight.summary,
        &unit.insight.detail,
        &unit.insight.action,
    );
    if expected != unit.id {
        return Err(DecodeError::NotContentAddressed(unit.id.to_string()));
    }

    Ok(unit)
}

/// A confirmation or flag, as read off the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestationRef {
    /// Whether this is doubt rather than support.
    pub is_flag: bool,
    /// Event id of the unit being attested to.
    pub unit_event_id: String,
    /// NIP-33 address of that unit, when the tag was present.
    pub unit_address: Option<String>,
    /// Pubkey of the unit's author.
    pub unit_author: Option<String>,
    /// Pubkey of the member attesting.
    pub author: String,
    /// When.
    pub at: Timestamp,
    /// Free text: a note on a confirmation, a reason on a flag.
    pub note: String,
}

/// Read a `38411` or `38412` event.
pub fn attestation_from_event(ev: &NostrEvent) -> Result<AttestationRef, DecodeError> {
    let is_flag = match ev.kind {
        KIND_CONFIRMATION => false,
        KIND_FLAG => true,
        found => {
            return Err(DecodeError::WrongKind {
                expected: KIND_CONFIRMATION,
                found,
            })
        }
    };
    Ok(AttestationRef {
        is_flag,
        unit_event_id: tags::first(&ev.tags, TAG_E)
            .ok_or(DecodeError::MissingTag(TAG_E))?
            .to_string(),
        unit_address: tags::first(&ev.tags, TAG_A).map(str::to_string),
        unit_author: tags::first(&ev.tags, TAG_P).map(str::to_string),
        author: ev.pubkey.clone(),
        at: Timestamp::from_secs(ev.created_at as i64),
        note: ev.content.clone(),
    })
}

/// A tier promotion, as read off the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraduationRef {
    /// Event id of the unit promoted.
    pub unit_event_id: String,
    /// Tier promoted from.
    pub from: Tier,
    /// Tier promoted to.
    pub to: Tier,
    /// Pubkey of the approving human.
    pub approver: String,
    /// Event id of the signed `31403` decision, when cited.
    ///
    /// `None` means the promotion is asserted but not checkable, which
    /// `colloquy_core::graduation::GraduationPolicy` refuses for the public tier.
    pub decision_event_id: Option<String>,
    /// When.
    pub at: Timestamp,
}

fn tier_from_token(s: &str) -> Result<Tier, DecodeError> {
    match s {
        "local" => Ok(Tier::Local),
        "remote" => Ok(Tier::Shared),
        "global" => Ok(Tier::Public),
        other => Err(DecodeError::BadTier(other.to_string())),
    }
}

/// Read a `38414` event.
pub fn graduation_from_event(ev: &NostrEvent) -> Result<GraduationRef, DecodeError> {
    if ev.kind != KIND_GRADUATION {
        return Err(DecodeError::WrongKind {
            expected: KIND_GRADUATION,
            found: ev.kind,
        });
    }
    Ok(GraduationRef {
        unit_event_id: tags::first(&ev.tags, TAG_E)
            .ok_or(DecodeError::MissingTag(TAG_E))?
            .to_string(),
        from: tier_from_token(
            tags::first(&ev.tags, TAG_FROM).ok_or(DecodeError::MissingTag(TAG_FROM))?,
        )?,
        to: tier_from_token(tags::first(&ev.tags, TAG_TO).ok_or(DecodeError::MissingTag(TAG_TO))?)?,
        approver: tags::first(&ev.tags, TAG_P)
            .ok_or(DecodeError::MissingTag(TAG_P))?
            .to_string(),
        decision_event_id: tags::first(&ev.tags, TAG_DECISION).map(str::to_string),
        at: Timestamp::from_secs(ev.created_at as i64),
    })
}

/// A supersession, as read off the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupersessionRef {
    /// Event id of the unit being replaced.
    pub superseded: String,
    /// Event id of the unit replacing it.
    pub supersedes: String,
    /// Pubkey of the member declaring it.
    pub author: String,
    /// Why.
    pub rationale: String,
    /// When.
    pub at: Timestamp,
}

/// Read a `38413` event.
pub fn supersession_from_event(ev: &NostrEvent) -> Result<SupersessionRef, DecodeError> {
    if ev.kind != KIND_SUPERSESSION {
        return Err(DecodeError::WrongKind {
            expected: KIND_SUPERSESSION,
            found: ev.kind,
        });
    }
    Ok(SupersessionRef {
        superseded: tags::e_with_marker(&ev.tags, MARKER_SUPERSEDED)
            .ok_or(DecodeError::MissingTag(MARKER_SUPERSEDED))?
            .to_string(),
        supersedes: tags::e_with_marker(&ev.tags, MARKER_SUPERSEDES)
            .ok_or(DecodeError::MissingTag(MARKER_SUPERSEDES))?
            .to_string(),
        author: ev.pubkey.clone(),
        rationale: ev.content.clone(),
        at: Timestamp::from_secs(ev.created_at as i64),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::Insight;

    fn pk(seed: &str) -> String {
        seed.repeat(64 / seed.len())
    }

    fn signed(u: crate::event::UnsignedEvent, id: &str) -> NostrEvent {
        NostrEvent {
            id: id.to_string(),
            pubkey: u.pubkey,
            created_at: u.created_at,
            kind: u.kind,
            tags: u.tags,
            content: u.content,
            sig: "0".repeat(128),
        }
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
    fn a_unit_survives_the_round_trip() {
        let u = unit();
        let ev = signed(unit_event(&u, &pk("ab"), Timestamp::from_secs(5)), "e1");
        assert_eq!(unit_from_event(&ev).unwrap(), u);
    }

    #[test]
    fn a_tampered_content_is_caught_by_its_own_address() {
        let u = unit();
        let mut ev = signed(unit_event(&u, &pk("ab"), Timestamp::from_secs(5)), "e1");
        let mut tampered: serde_json::Value = serde_json::from_str(&ev.content).unwrap();
        tampered["insight"]["action"] = serde_json::json!("do something else");
        ev.content = tampered.to_string();
        assert!(matches!(
            unit_from_event(&ev),
            Err(DecodeError::NotContentAddressed(_))
        ));
    }

    #[test]
    fn a_d_tag_that_disagrees_with_the_content_is_refused() {
        let u = unit();
        let mut ev = signed(unit_event(&u, &pk("ab"), Timestamp::from_secs(5)), "e1");
        ev.tags[0][1] = "ffffffffffff".into();
        assert!(matches!(
            unit_from_event(&ev),
            Err(DecodeError::IdentifierMismatch { .. })
        ));
    }

    #[test]
    fn the_wrong_kind_is_refused_rather_than_coerced() {
        let u = unit();
        let mut ev = signed(unit_event(&u, &pk("ab"), Timestamp::from_secs(5)), "e1");
        ev.kind = KIND_FLAG;
        assert!(matches!(
            unit_from_event(&ev),
            Err(DecodeError::WrongKind { .. })
        ));
    }

    #[test]
    fn attestations_round_trip_with_their_polarity() {
        let u = unit();
        let c = signed(
            confirmation_event(
                "e1",
                &pk("ab"),
                &u.id,
                &pk("cd"),
                Timestamp::from_secs(7),
                "held",
            ),
            "c1",
        );
        let f = signed(
            flag_event(
                "e1",
                &pk("ab"),
                &u.id,
                &pk("ef"),
                Timestamp::from_secs(8),
                "stale",
            ),
            "f1",
        );
        let c = attestation_from_event(&c).unwrap();
        let f = attestation_from_event(&f).unwrap();

        assert!(!c.is_flag && f.is_flag);
        assert_eq!(c.unit_event_id, "e1");
        assert_eq!(c.at, Timestamp::from_secs(7));
        assert_eq!(f.note, "stale");
        assert_eq!(f.unit_author.as_deref(), Some(pk("ab").as_str()));
    }

    #[test]
    fn a_graduation_reports_whether_it_is_checkable() {
        let u = unit();
        let with = signed(
            graduation_event(
                "e1",
                &pk("ab"),
                &u.id,
                Tier::Local,
                Tier::Shared,
                &pk("cd"),
                Some("d1"),
                &pk("ef"),
                Timestamp::from_secs(9),
            ),
            "g1",
        );
        let without = signed(
            graduation_event(
                "e1",
                &pk("ab"),
                &u.id,
                Tier::Shared,
                Tier::Public,
                &pk("cd"),
                None,
                &pk("ef"),
                Timestamp::from_secs(9),
            ),
            "g2",
        );
        let a = graduation_from_event(&with).unwrap();
        let b = graduation_from_event(&without).unwrap();
        assert_eq!(a.decision_event_id.as_deref(), Some("d1"));
        assert_eq!((a.from, a.to), (Tier::Local, Tier::Shared));
        assert_eq!(b.decision_event_id, None);
        assert_eq!((b.from, b.to), (Tier::Shared, Tier::Public));
    }

    #[test]
    fn a_bad_tier_token_is_named_not_defaulted() {
        let u = unit();
        let mut ev = signed(
            graduation_event(
                "e1",
                &pk("ab"),
                &u.id,
                Tier::Local,
                Tier::Shared,
                &pk("cd"),
                None,
                &pk("ef"),
                Timestamp::from_secs(0),
            ),
            "g1",
        );
        for t in ev.tags.iter_mut() {
            if t[0] == TAG_TO {
                t[1] = "planetary".into();
            }
        }
        assert_eq!(
            graduation_from_event(&ev),
            Err(DecodeError::BadTier("planetary".into()))
        );
    }

    #[test]
    fn a_supersession_reports_both_ends() {
        let u = unit();
        let ev = signed(
            supersession_event(
                "old",
                &pk("ab"),
                &u.id,
                "new",
                &pk("ab"),
                &u.id,
                &pk("ab"),
                Timestamp::from_secs(3),
                "tooling landed",
            ),
            "s1",
        );
        let s = supersession_from_event(&ev).unwrap();
        assert_eq!(
            (s.superseded.as_str(), s.supersedes.as_str()),
            ("old", "new")
        );
        assert_eq!(s.rationale, "tooling landed");
    }
}
