//! Promotion between tiers, and the structural reason no one graduates alone.
//!
//! cq's graduation paths converge on a human approval. This module keeps that
//! and adds the check that makes the confirmation policy safe: eligibility is
//! gated on the **number of distinct authorising principals**, not on weight.
//!
//! That distinction is the whole point. A maximally trusted person draws three
//! times an agent principal's weight, so weight alone would let one person
//! promote a unit by themselves — and a person approving their own agent's
//! proposal is the failure mode the human gate exists to prevent. Counting
//! principals makes it structurally impossible instead of merely unlikely.
//!
//! ```
//! use colloquy_core::{graduation::*, unit::Tier, confidence::Ledger, principal::Attestation, time::Timestamp};
//! use colloquy_core::{kind::UnitKind, unit::*};
//!
//! let t = Timestamp::from_secs(0);
//! let unit = KnowledgeUnit::propose("did:nostr:p", UnitKind::Pitfall, ["api"], Insight::new("s","d","a"), t);
//!
//! // One very trusted person, on their own, cannot promote anything.
//! let mut ledger = Ledger::default();
//! ledger.confirm(Attestation::human("did:nostr:alice", 1.0, t));
//! let refused = eligibility(&unit, &ledger, Tier::Shared, &GraduationPolicy::for_tier(Tier::Shared), &Default::default(), &Default::default(), t);
//! assert!(matches!(refused, Err(ref e) if e.contains(&Ineligible::NotEnoughPrincipals { have: 1, need: 2 })));
//! ```

use serde::{Deserialize, Serialize};

use crate::confidence::Ledger;
use crate::decay::StalenessPolicy;
use crate::principal::ConfirmationPolicy;
use crate::time::Timestamp;
use crate::unit::{Graduation, KnowledgeUnit, Tier};

/// What a unit must satisfy before it may be promoted to a given tier.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GraduationPolicy {
    /// Distinct authorising principals that must have confirmed.
    ///
    /// Counted, never weighed — see the module documentation.
    pub min_distinct_principals: u32,
    /// Minimum derived confidence.
    pub min_confidence: f64,
    /// Whether at least one *human* principal must be among the confirmers.
    pub require_human_confirmation: bool,
    /// Whether the approval must carry the identifier of a signed decision.
    ///
    /// Set for the public tier: once a unit is readable beyond the deployment,
    /// "a human approved this" has to be checkable by whoever reads it, not
    /// merely asserted by whoever published it.
    pub require_signed_approval: bool,
    /// Whether a unit carrying unresolved flags may be promoted.
    pub allow_disputed: bool,
}

impl Default for GraduationPolicy {
    fn default() -> Self {
        Self::for_tier(Tier::Shared)
    }
}

impl GraduationPolicy {
    /// The recommended policy for promoting *to* a tier.
    ///
    /// Shared asks for two principals and a person. Public asks for three — cq's
    /// own "three from three" — plus a signed approval, because at that point
    /// the audience includes readers who cannot ask anyone what happened.
    pub const fn for_tier(to: Tier) -> Self {
        match to {
            Tier::Local => Self {
                min_distinct_principals: 0,
                min_confidence: 0.0,
                require_human_confirmation: false,
                require_signed_approval: false,
                allow_disputed: true,
            },
            Tier::Shared => Self {
                min_distinct_principals: 2,
                min_confidence: 0.5,
                require_human_confirmation: true,
                require_signed_approval: false,
                allow_disputed: false,
            },
            Tier::Public => Self {
                min_distinct_principals: 3,
                min_confidence: 0.7,
                require_human_confirmation: true,
                require_signed_approval: true,
                allow_disputed: false,
            },
        }
    }
}

/// Why a promotion was refused.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum Ineligible {
    /// Too few distinct authorising principals have confirmed.
    #[error("{have} distinct principals have confirmed; {need} are required")]
    NotEnoughPrincipals {
        /// Principals found.
        have: u32,
        /// Principals required.
        need: u32,
    },
    /// Derived confidence is below the threshold.
    #[error("confidence {have:.3} is below the required {need:.3}")]
    ConfidenceTooLow {
        /// Confidence found.
        have: f64,
        /// Confidence required.
        need: f64,
    },
    /// No person has confirmed.
    #[error("no human principal has confirmed; agent confirmation alone cannot promote a unit")]
    NoHumanConfirmation,
    /// The approval carries no signed decision identifier.
    #[error("promotion to this tier requires the identifier of a signed approving decision")]
    MissingAuthorisingEvent,
    /// The unit carries unresolved flags.
    #[error("the unit is disputed; resolve the flags before promoting it")]
    Disputed,
    /// The unit is superseded or retired.
    #[error("a unit in this state is not promotable")]
    NotServable,
    /// The unit is already in this tier or a higher one.
    #[error("the unit is already at {current:?}, which is not below {target:?}")]
    NotAPromotion {
        /// Tier the unit is in.
        current: Tier,
        /// Tier requested.
        target: Tier,
    },
}

impl Eq for Ineligible {}

/// A human's approval of a promotion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    /// Identifier of the approving human.
    pub approved_by: String,
    /// When the approval was given.
    pub at: Timestamp,
    /// Identifier of the signed decision that carries it.
    ///
    /// In a Nostr deployment, the event id of the `31403` ActionResponse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorising_event: Option<String>,
}

/// Check whether a unit may be promoted to `to`, collecting every reason it may not.
#[allow(clippy::too_many_arguments)]
pub fn eligibility(
    unit: &KnowledgeUnit,
    ledger: &Ledger,
    to: Tier,
    policy: &GraduationPolicy,
    confirmation: &ConfirmationPolicy,
    staleness: &StalenessPolicy,
    now: Timestamp,
) -> Result<(), Vec<Ineligible>> {
    let mut errs = Vec::new();
    let current = unit.tier();

    if current.rank() >= to.rank() {
        errs.push(Ineligible::NotAPromotion {
            current,
            target: to,
        });
    }
    if !unit.lifecycle.status.is_servable() {
        errs.push(Ineligible::NotServable);
    }

    let a = ledger.assess(unit.lifecycle.kind, confirmation, staleness, now);

    if a.distinct_principals < policy.min_distinct_principals {
        errs.push(Ineligible::NotEnoughPrincipals {
            have: a.distinct_principals,
            need: policy.min_distinct_principals,
        });
    }
    if a.confidence < policy.min_confidence {
        errs.push(Ineligible::ConfidenceTooLow {
            have: a.confidence,
            need: policy.min_confidence,
        });
    }
    if policy.require_human_confirmation && !ledger.has_human_confirmation() {
        errs.push(Ineligible::NoHumanConfirmation);
    }
    if !policy.allow_disputed && a.flagging_principals > 0 {
        errs.push(Ineligible::Disputed);
    }

    if errs.is_empty() {
        Ok(())
    } else {
        Err(errs)
    }
}

/// Promote a unit, appending the graduation record.
///
/// Checks [`eligibility`] first and refuses otherwise, so there is no path that
/// writes a graduation record the policy would not have allowed.
#[allow(clippy::too_many_arguments)]
pub fn graduate(
    unit: &mut KnowledgeUnit,
    ledger: &Ledger,
    to: Tier,
    approval: &Approval,
    policy: &GraduationPolicy,
    confirmation: &ConfirmationPolicy,
    staleness: &StalenessPolicy,
    now: Timestamp,
) -> Result<(), Vec<Ineligible>> {
    let mut errs = match eligibility(unit, ledger, to, policy, confirmation, staleness, now) {
        Ok(()) => Vec::new(),
        Err(e) => e,
    };
    if policy.require_signed_approval && approval.authorising_event.is_none() {
        errs.push(Ineligible::MissingAuthorisingEvent);
    }
    if !errs.is_empty() {
        return Err(errs);
    }

    let from = unit.tier();
    unit.provenance.graduation_history.push(Graduation {
        from,
        to,
        approved_by: approval.approved_by.clone(),
        timestamp: approval.at,
        authorising_event: approval.authorising_event.clone(),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::UnitKind;
    use crate::principal::Attestation;
    use crate::unit::{Insight, UnitStatus};

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn unit() -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:proposer",
            UnitKind::Pitfall,
            ["api"],
            Insight::new("s", "d", "a"),
            t(0),
        )
    }

    fn approval(signed: bool) -> Approval {
        Approval {
            approved_by: "did:nostr:alice".into(),
            at: t(10),
            authorising_event: signed.then(|| "e".repeat(64)),
        }
    }

    fn check(u: &KnowledgeUnit, l: &Ledger, to: Tier) -> Result<(), Vec<Ineligible>> {
        eligibility(
            u,
            l,
            to,
            &GraduationPolicy::for_tier(to),
            &Default::default(),
            &Default::default(),
            t(10),
        )
    }

    #[test]
    fn one_trusted_human_cannot_promote_alone() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 1.0, t(0)));
        let errs = check(&unit(), &l, Tier::Shared).unwrap_err();
        assert!(errs.contains(&Ineligible::NotEnoughPrincipals { have: 1, need: 2 }));
    }

    #[test]
    fn agents_alone_cannot_promote_however_many_principals() {
        let mut l = Ledger::default();
        for p in ["a", "b", "c", "d", "e"] {
            l.confirm(Attestation::agent(p, format!("did:nostr:{p}"), t(0)));
        }
        let errs = check(&unit(), &l, Tier::Shared).unwrap_err();
        assert!(errs.contains(&Ineligible::NoHumanConfirmation));
        assert!(
            !errs
                .iter()
                .any(|e| matches!(e, Ineligible::NotEnoughPrincipals { .. })),
            "five principals is plenty; it is the human gate that refuses"
        );
    }

    #[test]
    fn a_human_plus_an_independent_agent_promotes_to_shared() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 0.8, t(0)));
        l.confirm(Attestation::agent("bot", "did:nostr:bob", t(0)));
        assert!(check(&unit(), &l, Tier::Shared).is_ok());
    }

    #[test]
    fn public_needs_three_principals_and_a_signed_approval() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 1.0, t(0)));
        l.confirm(Attestation::agent("b", "did:nostr:bob", t(0)));
        l.confirm(Attestation::agent("c", "did:nostr:carol", t(0)));

        let mut u = unit();
        u.provenance.graduation_history.push(Graduation {
            from: Tier::Local,
            to: Tier::Shared,
            approved_by: "did:nostr:alice".into(),
            timestamp: t(1),
            authorising_event: None,
        });

        assert!(check(&u, &l, Tier::Public).is_ok(), "eligibility holds");

        let policy = GraduationPolicy::for_tier(Tier::Public);
        let mut unsigned = u.clone();
        let errs = graduate(
            &mut unsigned,
            &l,
            Tier::Public,
            &approval(false),
            &policy,
            &Default::default(),
            &Default::default(),
            t(10),
        )
        .unwrap_err();
        assert_eq!(errs, vec![Ineligible::MissingAuthorisingEvent]);

        graduate(
            &mut u,
            &l,
            Tier::Public,
            &approval(true),
            &policy,
            &Default::default(),
            &Default::default(),
            t(10),
        )
        .unwrap();
        assert_eq!(u.tier(), Tier::Public);
        let last = u.provenance.graduation_history.last().unwrap();
        assert_eq!(last.from, Tier::Shared);
        assert!(last.authorising_event.is_some());
    }

    #[test]
    fn a_disputed_unit_is_not_promoted() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 1.0, t(0)));
        l.confirm(Attestation::agent("b", "did:nostr:bob", t(0)));
        l.flag(Attestation::agent("c", "did:nostr:carol", t(1)));
        let errs = check(&unit(), &l, Tier::Shared).unwrap_err();
        assert!(errs.contains(&Ineligible::Disputed));
    }

    #[test]
    fn promotion_only_moves_up() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 1.0, t(0)));
        l.confirm(Attestation::agent("b", "did:nostr:bob", t(0)));
        let mut u = unit();
        u.provenance.graduation_history.push(Graduation {
            from: Tier::Local,
            to: Tier::Shared,
            approved_by: "x".into(),
            timestamp: t(1),
            authorising_event: None,
        });
        let errs = check(&u, &l, Tier::Shared).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, Ineligible::NotAPromotion { .. })));
    }

    #[test]
    fn a_retired_unit_is_not_promotable() {
        let mut l = Ledger::default();
        l.confirm(Attestation::human("did:nostr:alice", 1.0, t(0)));
        l.confirm(Attestation::agent("b", "did:nostr:bob", t(0)));
        let mut u = unit();
        u.lifecycle.status = UnitStatus::Retired;
        assert!(check(&u, &l, Tier::Shared)
            .unwrap_err()
            .contains(&Ineligible::NotServable));
    }
}
