//! Turning attestations into evidence.
//!
//! A unit's confidence is *derived*, never authored. This module owns the
//! derivation: collapse attestations onto authorising principals, weigh the
//! principals, subtract the doubt, and map the remainder onto `0.0..=1.0`.
//!
//! The curve is `1 - exp(-k · W)`. It is steep where it matters — the first few
//! independent voices move it a lot — and saturates afterwards, which is exactly
//! the shape cq's diversity argument asks for: the eight-hundredth confirmation
//! from a principal already counted is worth nothing, and the third *new*
//! principal is worth a great deal.
//!
//! ```
//! use colloquy_core::{confidence::Ledger, principal::Attestation, time::Timestamp};
//! use colloquy_core::{kind::UnitKind, decay::StalenessPolicy, unit::UnitStatus};
//!
//! let t = Timestamp::from_secs(0);
//! let mut ledger = Ledger::default();
//! for p in ["x", "y", "z"] {
//!     ledger.confirm(Attestation::agent(p, format!("did:nostr:{p}"), t));
//! }
//! let a = ledger.assess(UnitKind::Pitfall, &Default::default(), &StalenessPolicy::default(), t);
//! assert_eq!(a.distinct_principals, 3);
//! assert_eq!(a.status, UnitStatus::Active);
//! assert!(a.confidence > 0.7 && a.confidence < 0.8);
//! ```

use serde::{Deserialize, Serialize};

use crate::decay::StalenessPolicy;
use crate::kind::UnitKind;
use crate::principal::{
    collapse, Attestation, CollapsedPrincipal, ConfirmationPolicy, MemberClass,
};
use crate::time::Timestamp;
use crate::unit::{KnowledgeUnit, UnitStatus};

/// Every attestation made about one unit.
///
/// Confirmations and flags are kept apart rather than signed: they weigh
/// differently, they collapse independently, and a surface needs to show them
/// as two lists.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Ledger {
    /// Attestations that the unit holds.
    #[serde(default)]
    pub confirmations: Vec<Attestation>,
    /// Attestations that the unit is wrong or stale.
    #[serde(default)]
    pub flags: Vec<Attestation>,
}

/// What a ledger says about a unit at a given moment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assessment {
    /// Diversity-weighted confidence in `0.0..=1.0`.
    pub confidence: f64,
    /// Raw attestation count, for display only.
    pub confirmations: u32,
    /// Distinct confirming authorising principals. This is what confidence
    /// follows, and what a surface should show beside it.
    pub distinct_principals: u32,
    /// Distinct flagging authorising principals.
    pub flagging_principals: u32,
    /// Net weight after doubt was subtracted, before the saturation curve.
    pub weight: f64,
    /// Freshness multiplier from [`StalenessPolicy::freshness`].
    pub freshness: f64,
    /// Ranking score: `confidence · freshness`. What a retrieval surface sorts
    /// on, as distinct from confidence, which is what it displays.
    pub score: f64,
    /// The status the ledger implies. Advisory — see [`Ledger::apply`], which
    /// refuses to overwrite a status only a signed decision may set.
    pub status: UnitStatus,
    /// When the most recent confirmation landed, if any.
    pub last_confirmed: Option<Timestamp>,
}

impl Ledger {
    /// Record a confirmation.
    pub fn confirm(&mut self, a: Attestation) {
        self.confirmations.push(a);
    }

    /// Record a flag.
    pub fn flag(&mut self, a: Attestation) {
        self.flags.push(a);
    }

    /// The confirming principals, collapsed.
    pub fn confirming_principals(&self) -> Vec<CollapsedPrincipal> {
        collapse(&self.confirmations)
    }

    /// The flagging principals, collapsed.
    pub fn flagging_principals(&self) -> Vec<CollapsedPrincipal> {
        collapse(&self.flags)
    }

    /// Whether any human principal has confirmed.
    ///
    /// [`crate::graduation`] reads this: promotion to a shared or public tier
    /// wants a person behind it, not only machinery.
    pub fn has_human_confirmation(&self) -> bool {
        self.confirming_principals()
            .iter()
            .any(|p| p.class == MemberClass::Human)
    }

    /// Assess the unit as of `now`.
    pub fn assess(
        &self,
        kind: UnitKind,
        policy: &ConfirmationPolicy,
        staleness: &StalenessPolicy,
        now: Timestamp,
    ) -> Assessment {
        let confirming = self.confirming_principals();
        let flagging = self.flagging_principals();

        let gross = policy.weigh(&confirming);
        let doubt = flagging.len() as f64 * policy.flag_weight;
        let weight = (gross - doubt).max(0.0);
        let confidence = 1.0 - (-policy.saturation_k * weight).exp();

        let last_confirmed = confirming.iter().map(|p| p.last).max();
        let freshness = last_confirmed.map_or(1.0, |t| staleness.freshness(kind, t, now));
        let stale = last_confirmed.is_some_and(|t| staleness.is_stale(kind, t, now));

        let status = if !flagging.is_empty() {
            UnitStatus::Disputed
        } else if stale {
            UnitStatus::Stale
        } else if confirming.is_empty() {
            UnitStatus::Draft
        } else {
            UnitStatus::Active
        };

        Assessment {
            confidence,
            confirmations: self.confirmations.len() as u32,
            distinct_principals: confirming.len() as u32,
            flagging_principals: flagging.len() as u32,
            weight,
            freshness,
            score: confidence * freshness,
            status,
            last_confirmed,
        }
    }

    /// Write an assessment onto a unit's evidence and status.
    ///
    /// Status is only ever moved between the states a ledger governs. A unit
    /// that has been superseded or retired keeps that status: those are set by
    /// a signed decision, and no amount of confirming or flagging may undo one.
    /// This is the structural half of "a flag suppresses nothing".
    pub fn apply(
        &self,
        unit: &mut KnowledgeUnit,
        policy: &ConfirmationPolicy,
        staleness: &StalenessPolicy,
        now: Timestamp,
    ) -> Assessment {
        let a = self.assess(unit.lifecycle.kind, policy, staleness, now);
        unit.evidence.confidence = a.confidence;
        unit.evidence.confirmations = a.confirmations;
        unit.evidence.contributing_orgs = a.distinct_principals;
        if let Some(t) = a.last_confirmed {
            unit.evidence.last_confirmed = t;
        }
        if unit.lifecycle.status.is_servable() {
            unit.lifecycle.status = a.status;
        }
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::UnitKind;
    use crate::unit::Insight;

    const DAY: i64 = 86_400;

    fn t(d: i64) -> Timestamp {
        Timestamp::from_secs(d * DAY)
    }

    fn ledger_of(principals: &[&str], at: Timestamp) -> Ledger {
        let mut l = Ledger::default();
        for (i, p) in principals.iter().enumerate() {
            l.confirm(Attestation::agent(
                format!("m{i}"),
                format!("did:nostr:{p}"),
                at,
            ));
        }
        l
    }

    fn unit(kind: UnitKind) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:proposer",
            kind,
            ["api"],
            Insight::new("s", "d", "a"),
            t(0),
        )
    }

    #[test]
    fn confidence_follows_principals_not_attestation_count() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();

        let mut concentrated = Ledger::default();
        for i in 0..800 {
            let who = if i % 2 == 0 { "a" } else { "b" };
            concentrated.confirm(Attestation::agent(
                format!("m{i}"),
                format!("did:nostr:{who}"),
                t(0),
            ));
        }
        let diverse = ledger_of(&["x", "y", "z"], t(0));

        let c = concentrated.assess(UnitKind::Pitfall, &p, &s, t(0));
        let d = diverse.assess(UnitKind::Pitfall, &p, &s, t(0));

        assert_eq!((c.confirmations, c.distinct_principals), (800, 2));
        assert_eq!((d.confirmations, d.distinct_principals), (3, 3));
        assert!(
            d.confidence > c.confidence,
            "{} vs {}",
            d.confidence,
            c.confidence
        );
    }

    #[test]
    fn the_curve_hits_its_documented_landmarks() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let read = |n: usize| {
            let names: Vec<String> = (0..n).map(|i| format!("p{i}")).collect();
            let refs: Vec<&str> = names.iter().map(String::as_str).collect();
            ledger_of(&refs, t(0))
                .assess(UnitKind::Pitfall, &p, &s, t(0))
                .confidence
        };
        assert!((read(1) - 0.37).abs() < 0.01, "one principal: {}", read(1));
        assert!(
            (read(3) - 0.75).abs() < 0.01,
            "three principals: {}",
            read(3)
        );
        assert!((read(6) - 0.94).abs() < 0.01, "six principals: {}", read(6));
    }

    #[test]
    fn a_flag_disputes_but_never_suppresses() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let mut l = ledger_of(&["x", "y", "z"], t(0));
        l.flag(Attestation::agent("critic", "did:nostr:crit", t(1)));

        let a = l.assess(UnitKind::Pitfall, &p, &s, t(1));
        assert_eq!(a.status, UnitStatus::Disputed);
        assert!(a.status.is_servable(), "a disputed unit is still served");
        assert_eq!(a.weight, 2.0, "one doubt cancels one principal");
        assert!(a.confidence > 0.0);
    }

    #[test]
    fn doubt_cannot_drive_weight_negative() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let mut l = ledger_of(&["x"], t(0));
        for i in 0..20 {
            l.flag(Attestation::agent(
                format!("c{i}"),
                format!("did:nostr:c{i}"),
                t(0),
            ));
        }
        let a = l.assess(UnitKind::Pitfall, &p, &s, t(0));
        assert_eq!(a.weight, 0.0);
        assert_eq!(a.confidence, 0.0);
    }

    #[test]
    fn staleness_reads_the_latest_confirmation_and_one_more_revives_it() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let mut l = ledger_of(&["x"], t(0));
        assert_eq!(
            l.assess(UnitKind::Workaround, &p, &s, t(100)).status,
            UnitStatus::Stale
        );
        l.confirm(Attestation::agent("m9", "did:nostr:y", t(100)));
        let a = l.assess(UnitKind::Workaround, &p, &s, t(100));
        assert_eq!(a.status, UnitStatus::Active);
        assert_eq!(a.freshness, 1.0);
    }

    #[test]
    fn apply_will_not_resurrect_a_retired_unit() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let mut u = unit(UnitKind::Pitfall);
        u.lifecycle.status = UnitStatus::Retired;

        ledger_of(&["x", "y", "z"], t(0)).apply(&mut u, &p, &s, t(0));
        assert_eq!(u.lifecycle.status, UnitStatus::Retired);
        // Evidence is still refreshed — the numbers stay honest even for a unit
        // nobody will be served.
        assert_eq!(u.evidence.contributing_orgs, 3);
    }

    #[test]
    fn apply_writes_principals_into_contributing_orgs() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let mut u = unit(UnitKind::Pitfall);
        let mut l = Ledger::default();
        for i in 0..40 {
            l.confirm(Attestation::agent(format!("a{i}"), "did:nostr:one", t(0)));
        }
        l.apply(&mut u, &p, &s, t(0));
        assert_eq!(u.evidence.confirmations, 40);
        assert_eq!(
            u.evidence.contributing_orgs, 1,
            "a swarm is one contributor"
        );
        assert_eq!(u.lifecycle.status, UnitStatus::Active);
    }

    #[test]
    fn score_ranks_below_confidence_once_a_unit_ages() {
        let p = ConfirmationPolicy::default();
        let s = StalenessPolicy::default();
        let l = ledger_of(&["x", "y", "z"], t(0));
        let fresh = l.assess(UnitKind::Workaround, &p, &s, t(0));
        let aged = l.assess(UnitKind::Workaround, &p, &s, t(60));
        assert_eq!(fresh.score, fresh.confidence);
        assert!((aged.score - aged.confidence * 0.5).abs() < 1e-9);
        assert!(aged.score < fresh.score);
    }
}
