//! Rebuilding evidence from a signed event set — and the join that makes it safe.
//!
//! Confidence follows *authorising principals*, and an event carries only a
//! pubkey. Turning one into the other is a registry lookup, and it is the point
//! at which the whole trust model can be quietly defeated.
//!
//! # The unregistered-pubkey rule
//!
//! A pubkey the registry does not know is **dropped**, not treated as its own
//! principal. The tempting default — "if we don't know who authorises them,
//! they authorise themselves" — hands an attacker exactly what the collapse
//! exists to prevent: unlimited distinct principals for the cost of generating
//! keys. Dropping is the conservative direction: an unregistered confirmation
//! is invisible rather than infinitely cheap.
//!
//! Dropped attestations are reported rather than swallowed, so a caller can
//! tell "nobody confirmed this" apart from "three people confirmed this and the
//! registry was stale".
//!
//! ```
//! use colloquy_nostr::ledger::{StaticRegistry, PrincipalResolver};
//! use colloquy_core::principal::MemberClass;
//!
//! let mut reg = StaticRegistry::default();
//! reg.register_agent("aa".repeat(32), "did:nostr:operator");
//! assert!(reg.resolve(&"aa".repeat(32)).is_some());
//! assert!(reg.resolve(&"bb".repeat(32)).is_none(), "unknown keys do not self-authorise");
//! ```

use std::collections::{BTreeMap, HashMap};

use colloquy_core::confidence::Ledger;
use colloquy_core::principal::{Attestation, MemberClass, PrincipalId};
use crate::event::NostrEvent;

use crate::decode::{attestation_from_event, unit_from_event};
use crate::kinds::*;

/// What the registry knows about one member pubkey.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedMember {
    /// The authorising principal. For a human this is usually their own key;
    /// for an agent it is whoever registered it — the forum relay stores this
    /// as `agent_registry.registered_by`.
    pub principal: PrincipalId,
    /// Whether the member is an agent or a person.
    pub class: MemberClass,
    /// Web-of-trust score in `0.0..=1.0`, consulted only for human principals.
    pub wot: f64,
}

/// Resolve a member pubkey to its authorising principal.
///
/// Implemented against the relay's disclosure endpoint in a deployment, and
/// against [`StaticRegistry`] in tests and single-node setups.
pub trait PrincipalResolver {
    /// Look a pubkey up. `None` means "not a known member", which is treated as
    /// grounds to drop the attestation entirely.
    fn resolve(&self, pubkey: &str) -> Option<ResolvedMember>;
}

/// An in-memory registry.
#[derive(Debug, Clone, Default)]
pub struct StaticRegistry {
    members: HashMap<String, ResolvedMember>,
}

impl StaticRegistry {
    /// Register an agent under an authorising principal.
    pub fn register_agent(&mut self, pubkey: impl Into<String>, principal: impl Into<String>) {
        self.members.insert(
            pubkey.into(),
            ResolvedMember {
                principal: PrincipalId(principal.into()),
                class: MemberClass::Agent,
                wot: 0.0,
            },
        );
    }

    /// Register a person. A person is their own authorising principal.
    pub fn register_human(&mut self, pubkey: impl Into<String>, wot: f64) {
        let pubkey = pubkey.into();
        self.members.insert(
            pubkey.clone(),
            ResolvedMember {
                principal: PrincipalId(pubkey),
                class: MemberClass::Human,
                wot,
            },
        );
    }

    /// Revoke a member. Their past attestations stop counting on the next
    /// reconstruction, which is what a revoked agent should mean.
    pub fn revoke(&mut self, pubkey: &str) {
        self.members.remove(pubkey);
    }
}

impl PrincipalResolver for StaticRegistry {
    fn resolve(&self, pubkey: &str) -> Option<ResolvedMember> {
        self.members.get(pubkey).cloned()
    }
}

/// The result of walking an event set.
#[derive(Debug, Clone, Default)]
pub struct Reconstruction {
    /// One ledger per unit, keyed by the unit's **event id** — which is what
    /// attestations reference on the wire.
    pub ledgers: BTreeMap<String, Ledger>,
    /// Units recovered from `38210` events, keyed by event id.
    pub units: BTreeMap<String, colloquy_core::unit::KnowledgeUnit>,
    /// Pubkeys that attested but were not in the registry, with a count each.
    ///
    /// Non-empty here is an operational signal, not a normal condition: it means
    /// either a stale registry or someone attesting from outside the membership.
    pub unresolved: BTreeMap<String, usize>,
    /// Events that were colloquy kinds but did not decode, with the reason.
    pub rejected: Vec<(String, String)>,
}

/// Walk a set of already-signature-verified events into per-unit ledgers.
///
/// Non-colloquy kinds are ignored silently — an event set is usually a mixed
/// subscription. Colloquy kinds that fail to decode are collected in
/// [`Reconstruction::rejected`] rather than dropped, because a malformed unit
/// from a registered member is worth seeing.
pub fn reconstruct(events: &[NostrEvent], registry: &impl PrincipalResolver) -> Reconstruction {
    let mut out = Reconstruction::default();

    for ev in events {
        match ev.kind {
            KIND_KNOWLEDGE_UNIT => match unit_from_event(ev) {
                Ok(u) => {
                    out.units.insert(ev.id.clone(), u);
                    out.ledgers.entry(ev.id.clone()).or_default();
                }
                Err(e) => out.rejected.push((ev.id.clone(), e.to_string())),
            },
            KIND_CONFIRMATION | KIND_FLAG => {
                let a = match attestation_from_event(ev) {
                    Ok(a) => a,
                    Err(e) => {
                        out.rejected.push((ev.id.clone(), e.to_string()));
                        continue;
                    }
                };
                let Some(m) = registry.resolve(&a.author) else {
                    *out.unresolved.entry(a.author.clone()).or_insert(0) += 1;
                    continue;
                };
                let attestation = Attestation {
                    member: a.author.clone(),
                    principal: m.principal,
                    class: m.class,
                    wot: m.wot,
                    at: a.at,
                };
                let ledger = out.ledgers.entry(a.unit_event_id.clone()).or_default();
                if a.is_flag {
                    ledger.flag(attestation);
                } else {
                    ledger.confirm(attestation);
                }
            }
            _ => {}
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::time::Timestamp;
    use colloquy_core::unit::{Insight, KnowledgeUnit};
    use colloquy_core::ConfirmationPolicy;

    /// A distinct 64-char pubkey per seed.
    ///
    /// Left-padded, not right-padded: right-padding collides ("sybil1" and
    /// "sybil10" pad to the same string), which silently halved this test's
    /// sybil count the first time round.
    fn pk(seed: &str) -> String {
        format!("{seed:0>64}")
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
            ["http"],
            Insight::new("s", "d", "a"),
            Timestamp::from_secs(0),
        )
    }

    fn scenario() -> (Vec<NostrEvent>, KnowledgeUnit) {
        let u = unit();
        let author = pk("author");
        let mut evs = vec![signed(unit_event(&u, &author, Timestamp::from_secs(0)), "unit-1")];
        // One operator's three agents.
        for (i, a) in ["swarm1", "swarm2", "swarm3"].iter().enumerate() {
            evs.push(signed(
                confirmation_event("unit-1", &author, &u.id, &pk(a), Timestamp::from_secs(i as i64), ""),
                &format!("c{i}"),
            ));
        }
        // One independent person.
        evs.push(signed(
            confirmation_event("unit-1", &author, &u.id, &pk("alice"), Timestamp::from_secs(9), ""),
            "c9",
        ));
        (evs, u)
    }

    fn registry() -> StaticRegistry {
        let mut r = StaticRegistry::default();
        for a in ["swarm1", "swarm2", "swarm3"] {
            r.register_agent(pk(a), "did:nostr:one-operator");
        }
        r.register_human(pk("alice"), 0.9);
        r
    }

    #[test]
    fn a_swarm_and_a_person_read_as_two_principals() {
        let (evs, u) = scenario();
        let rec = reconstruct(&evs, &registry());
        let ledger = &rec.ledgers["unit-1"];
        let a = ledger.assess(u.lifecycle.kind, &Default::default(), &Default::default(), Timestamp::from_secs(9));
        assert_eq!(a.confirmations, 4);
        assert_eq!(a.distinct_principals, 2, "three agents of one operator collapse");
        assert!(ledger.has_human_confirmation());
        assert_eq!(rec.units.len(), 1);
        assert!(rec.unresolved.is_empty());
    }

    #[test]
    fn unregistered_pubkeys_are_dropped_and_reported_not_self_authorised() {
        let (mut evs, u) = scenario();
        // Fifty freshly generated keys, none of them registered.
        for i in 0..50 {
            evs.push(signed(
                confirmation_event(
                    "unit-1", &pk("author"), &u.id, &pk(&format!("sybil{i}")),
                    Timestamp::from_secs(20), "",
                ),
                &format!("s{i}"),
            ));
        }
        let rec = reconstruct(&evs, &registry());
        let a = rec.ledgers["unit-1"].assess(
            u.lifecycle.kind, &Default::default(), &Default::default(), Timestamp::from_secs(20),
        );
        assert_eq!(a.distinct_principals, 2, "sybils must not buy principals");
        assert_eq!(rec.unresolved.len(), 50, "and must be visible to an operator");
    }

    #[test]
    fn revoking_an_agent_retracts_its_past_confirmations() {
        let (evs, u) = scenario();
        let mut reg = registry();
        reg.revoke(&pk("alice"));
        let rec = reconstruct(&evs, &reg);
        let ledger = &rec.ledgers["unit-1"];
        assert!(!ledger.has_human_confirmation());
        assert_eq!(
            ledger
                .assess(u.lifecycle.kind, &Default::default(), &Default::default(), Timestamp::from_secs(9))
                .distinct_principals,
            1
        );
    }

    #[test]
    fn flags_land_on_the_flag_side_of_the_ledger() {
        let (mut evs, u) = scenario();
        let mut reg = registry();
        reg.register_agent(pk("critic"), "did:nostr:other-operator");
        evs.push(signed(
            flag_event("unit-1", &pk("author"), &u.id, &pk("critic"), Timestamp::from_secs(30), "stale"),
            "f1",
        ));
        let rec = reconstruct(&evs, &reg);
        let a = rec.ledgers["unit-1"].assess(
            u.lifecycle.kind, &ConfirmationPolicy::default(), &Default::default(), Timestamp::from_secs(30),
        );
        assert_eq!(a.flagging_principals, 1);
        assert_eq!(a.status, colloquy_core::unit::UnitStatus::Disputed);
    }

    #[test]
    fn a_malformed_unit_is_rejected_loudly_and_others_still_load() {
        let (mut evs, _) = scenario();
        let mut broken = evs[0].clone();
        broken.id = "unit-broken".into();
        broken.content = "{not json".into();
        evs.push(broken);
        let rec = reconstruct(&evs, &registry());
        assert_eq!(rec.units.len(), 1);
        assert_eq!(rec.rejected.len(), 1);
        assert_eq!(rec.rejected[0].0, "unit-broken");
    }

    #[test]
    fn unrelated_kinds_pass_through_without_comment() {
        let (mut evs, _) = scenario();
        evs.push(NostrEvent {
            id: "chat".into(),
            pubkey: pk("alice"),
            created_at: 1,
            kind: 42,
            tags: vec![],
            content: "hello".into(),
            sig: "0".repeat(128),
        });
        let rec = reconstruct(&evs, &registry());
        assert!(rec.rejected.is_empty());
        assert_eq!(rec.units.len(), 1);
    }
}
