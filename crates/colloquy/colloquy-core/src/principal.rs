//! Principals, members, and the collapse that makes confirmation counts honest.
//!
//! # Why this module exists
//!
//! cq's trust model says confirmation weight follows the *diversity of
//! independent verifying parties*: "three confirmations from three different
//! organizations outrank 800 confirmations from two". Implemented naively over
//! accounts, that rule is trivially defeated wherever accounts are cheap — and
//! in an agent estate they are cheap, because spawning an agent is a command.
//!
//! So the unit of trust here is the **authorising principal**, not the member
//! account. A human member's authorising principal is themselves. An agent
//! member's authorising principal is whoever registered it — the same value the
//! forum relay already stores as `agent_registry.registered_by` and publishes
//! through its disclosure endpoint. [`collapse`] folds every attestation onto
//! that value before any weighting happens, so *N* agents run by one person
//! count once, not *N* times.
//!
//! ```
//! use colloquy_core::principal::{collapse, Attestation, MemberClass, ConfirmationPolicy};
//! use colloquy_core::time::Timestamp;
//!
//! let t = Timestamp::from_secs(0);
//! // One operator, five agents.
//! let swarm: Vec<_> = (0..5)
//!     .map(|i| Attestation::agent(format!("agent-{i}"), "did:nostr:aaa", t))
//!     .collect();
//! assert_eq!(collapse(&swarm).len(), 1, "a swarm is one principal");
//!
//! // Three independent operators.
//! let independent: Vec<_> = ["aaa", "bbb", "ccc"]
//!     .iter()
//!     .enumerate()
//!     .map(|(i, p)| Attestation::agent(format!("agent-{i}"), format!("did:nostr:{p}"), t))
//!     .collect();
//! assert_eq!(collapse(&independent).len(), 3);
//!
//! let policy = ConfirmationPolicy::default();
//! assert!(policy.weigh(&collapse(&independent)) > policy.weigh(&collapse(&swarm)));
//! ```

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::time::Timestamp;

/// An authorising principal: the party accountable for what a member asserts.
///
/// For a human member this is their own identity. For an agent member it is the
/// identity that registered the agent. In an agentbox/forum deployment both are
/// `did:nostr:<64-hex>`, but nothing here requires that shape — the type is an
/// opaque identifier so a deployment can key on an organisation instead.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PrincipalId(pub String);

impl PrincipalId {
    /// Borrow the underlying identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<T: Into<String>> From<T> for PrincipalId {
    fn from(v: T) -> Self {
        Self(v.into())
    }
}

/// What kind of member made an attestation.
///
/// This is deliberately *not* a trust level. It selects which weight a
/// principal draws, and nothing else; the estate's membership is mixed by
/// design, and agents are members in their own right.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemberClass {
    /// An agent, acting under an authorising principal.
    Agent,
    /// A person, acting as their own principal.
    Human,
}

/// One member's assertion about a unit — a confirmation or a flag.
///
/// Carries the member it came from *and* the principal that authorises the
/// member, because the second is what counts and the first is what audits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attestation {
    /// The member account that signed. Retained for audit, never for weighting.
    pub member: String,
    /// The authorising principal. This is the unit of trust.
    pub principal: PrincipalId,
    /// Whether the signing member is an agent or a person.
    pub class: MemberClass,
    /// The principal's web-of-trust score in `0.0..=1.0`, where available.
    ///
    /// Only consulted for [`MemberClass::Human`] principals; an agent principal
    /// draws the flat agent weight regardless. Deployments without a WoT score
    /// leave this at `0.0` and every human principal draws the base weight.
    #[serde(default)]
    pub wot: f64,
    /// When the attestation was made.
    pub at: Timestamp,
}

impl Attestation {
    /// An agent's attestation under an authorising principal.
    pub fn agent(
        member: impl Into<String>,
        principal: impl Into<PrincipalId>,
        at: Timestamp,
    ) -> Self {
        Self {
            member: member.into(),
            principal: principal.into(),
            class: MemberClass::Agent,
            wot: 0.0,
            at,
        }
    }

    /// A person's attestation. A human is their own authorising principal, so
    /// the member id doubles as the principal id.
    pub fn human(member: impl Into<String>, wot: f64, at: Timestamp) -> Self {
        let member = member.into();
        Self {
            principal: PrincipalId(member.clone()),
            member,
            class: MemberClass::Human,
            wot,
            at,
        }
    }
}

/// Every attestation from one authorising principal, folded into one entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollapsedPrincipal {
    /// The authorising principal.
    pub id: PrincipalId,
    /// The strongest class seen under this principal.
    ///
    /// A principal that attested through both a person and that person's agents
    /// counts as [`MemberClass::Human`]: the person stood behind it directly.
    pub class: MemberClass,
    /// The highest WoT score seen for this principal.
    pub wot: f64,
    /// How many distinct member accounts folded into this principal. Reported
    /// so a surface can show "5 agents, 1 operator" without the count ever
    /// reaching the weighting.
    pub members: usize,
    /// The earliest attestation from this principal — when it first verified.
    pub first: Timestamp,
    /// The latest attestation from this principal — what freshness reads.
    pub last: Timestamp,
}

/// Fold attestations onto their authorising principals.
///
/// The returned vector is ordered by principal id, so the result is
/// deterministic and two nodes computing confidence over the same event set
/// agree byte for byte. Repeated attestations from one member collapse with the
/// rest of that member's principal: re-confirming does not accrue weight.
pub fn collapse(attestations: &[Attestation]) -> Vec<CollapsedPrincipal> {
    let mut by_principal: BTreeMap<&PrincipalId, (CollapsedPrincipal, Vec<&str>)> = BTreeMap::new();

    for a in attestations {
        let entry = by_principal.entry(&a.principal).or_insert_with(|| {
            (
                CollapsedPrincipal {
                    id: a.principal.clone(),
                    class: a.class,
                    wot: a.wot,
                    members: 0,
                    first: a.at,
                    last: a.at,
                },
                Vec::new(),
            )
        });
        let (p, seen) = entry;
        // Human presence under a principal upgrades its class; the reverse
        // never downgrades it.
        if a.class == MemberClass::Human {
            p.class = MemberClass::Human;
        }
        p.wot = p.wot.max(a.wot);
        p.first = p.first.min(a.at);
        p.last = p.last.max(a.at);
        if !seen.contains(&a.member.as_str()) {
            seen.push(&a.member);
        }
    }

    by_principal
        .into_values()
        .map(|(mut p, seen)| {
            p.members = seen.len();
            p
        })
        .collect()
}

/// The tunables behind confirmation weighting.
///
/// Every field here is a *number the deployment owes an answer to*, not a
/// principle. The defaults implement the recommendations recorded in the
/// Colloquy scope: a human principal draws a WoT-derived multiplier capped at
/// three times an agent principal, and an agent under a different principal
/// draws full weight because the principal — not the class — is the unit of
/// trust.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfirmationPolicy {
    /// Weight of one agent principal. The unit against which the rest is read.
    pub agent_principal_weight: f64,
    /// Weight of a human principal with no WoT score.
    pub human_base_weight: f64,
    /// Weight of a human principal at the top of the WoT range.
    ///
    /// The multiplier is linear in WoT between [`Self::human_base_weight`] and
    /// this value. Three is the recommended cap: high enough that a trusted
    /// person outweighs a small swarm, low enough that no single principal can
    /// reach the graduation threshold alone — which
    /// [`crate::graduation::GraduationPolicy`] enforces separately and
    /// structurally, rather than relying on this number.
    pub human_max_weight: f64,
    /// Weight subtracted per distinct flagging principal.
    ///
    /// Flags are symmetric with confirmations by default: one principal's doubt
    /// cancels one principal's confidence. A flag never suppresses a unit on its
    /// own — see [`crate::unit::UnitStatus::Disputed`].
    pub flag_weight: f64,
    /// Curve constant mapping accumulated weight to a `0.0..=1.0` confidence.
    ///
    /// Confidence is `1 - exp(-k * W)`. At the default `k`, one agent principal
    /// reads ≈0.37, three independent principals ≈0.75, and six ≈0.94 — so the
    /// curve rewards the first few independent voices steeply and then
    /// saturates, which is the shape cq's diversity argument asks for.
    pub saturation_k: f64,
}

impl Default for ConfirmationPolicy {
    fn default() -> Self {
        Self {
            agent_principal_weight: 1.0,
            human_base_weight: 1.0,
            human_max_weight: 3.0,
            flag_weight: 1.0,
            saturation_k: 0.462_098_12, // ln(2) / 1.5
        }
    }
}

impl ConfirmationPolicy {
    /// The weight one collapsed principal contributes.
    ///
    /// A principal contributes **once**, whatever the number of member accounts
    /// or repeat attestations folded into it.
    pub fn principal_weight(&self, p: &CollapsedPrincipal) -> f64 {
        match p.class {
            MemberClass::Agent => self.agent_principal_weight,
            MemberClass::Human => {
                let wot = p.wot.clamp(0.0, 1.0);
                self.human_base_weight + wot * (self.human_max_weight - self.human_base_weight)
            }
        }
    }

    /// Total weight across a collapsed principal set.
    pub fn weigh(&self, principals: &[CollapsedPrincipal]) -> f64 {
        principals.iter().map(|p| self.principal_weight(p)).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    #[test]
    fn a_swarm_under_one_principal_collapses_to_one() {
        let swarm: Vec<_> = (0..800)
            .map(|i| Attestation::agent(format!("agent-{i}"), "did:nostr:one", t(i as i64)))
            .collect();
        let c = collapse(&swarm);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].members, 800, "the count is reported, never weighted");
        assert_eq!(ConfirmationPolicy::default().weigh(&c), 1.0);
    }

    #[test]
    fn three_principals_outrank_eight_hundred_accounts_under_two() {
        let policy = ConfirmationPolicy::default();

        let mut concentrated = Vec::new();
        for i in 0..800 {
            let p = if i % 2 == 0 {
                "did:nostr:a"
            } else {
                "did:nostr:b"
            };
            concentrated.push(Attestation::agent(format!("agent-{i}"), p, t(i)));
        }
        let diverse: Vec<_> = ["x", "y", "z"]
            .iter()
            .map(|p| Attestation::agent(format!("agent-{p}"), format!("did:nostr:{p}"), t(0)))
            .collect();

        let (c, d) = (collapse(&concentrated), collapse(&diverse));
        assert_eq!((c.len(), d.len()), (2, 3));
        assert!(
            policy.weigh(&d) > policy.weigh(&c),
            "cq's headline trust rule must hold: {} vs {}",
            policy.weigh(&d),
            policy.weigh(&c)
        );
    }

    #[test]
    fn repeat_attestations_from_one_member_do_not_accrue() {
        let once = vec![Attestation::agent("a", "did:nostr:p", t(0))];
        let many: Vec<_> = (0..50)
            .map(|i| Attestation::agent("a", "did:nostr:p", t(i)))
            .collect();
        let policy = ConfirmationPolicy::default();
        assert_eq!(
            policy.weigh(&collapse(&once)),
            policy.weigh(&collapse(&many))
        );
        assert_eq!(collapse(&many)[0].members, 1);
    }

    #[test]
    fn a_human_under_a_principal_upgrades_that_principals_class() {
        let mixed = vec![
            Attestation::agent("agent-1", "did:nostr:alice", t(0)),
            Attestation::human("did:nostr:alice", 1.0, t(10)),
        ];
        let c = collapse(&mixed);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].class, MemberClass::Human);
        assert_eq!(c[0].members, 2);
        assert_eq!(ConfirmationPolicy::default().principal_weight(&c[0]), 3.0);
    }

    #[test]
    fn the_human_cap_is_worth_exactly_three_agent_operators() {
        let policy = ConfirmationPolicy::default();
        let human = collapse(&[Attestation::human("did:nostr:h", 1.0, t(0))]);
        let swarm: Vec<_> = (0..40)
            .map(|i| Attestation::agent(format!("a{i}"), "did:nostr:one", t(0)))
            .collect();
        let three: Vec<_> = ["p", "q", "r"]
            .iter()
            .map(|p| Attestation::agent(*p, format!("did:nostr:{p}"), t(0)))
            .collect();
        assert!(policy.weigh(&human) > policy.weigh(&collapse(&swarm)));
        assert_eq!(
            policy.weigh(&human),
            policy.weigh(&collapse(&three)),
            "the 3x cap, made concrete: a maximally trusted person equals three independent operators"
        );
    }

    #[test]
    fn cross_principal_agents_draw_full_weight() {
        // Recommendation 2: the principal is the unit of trust, so an agent
        // under its own distinct principal is not discounted a second time.
        let policy = ConfirmationPolicy::default();
        let a = collapse(&[Attestation::agent("a", "did:nostr:1", t(0))]);
        let b = collapse(&[Attestation::agent("b", "did:nostr:2", t(0))]);
        assert_eq!(policy.weigh(&a), policy.weigh(&b));
    }

    #[test]
    fn collapse_is_order_independent() {
        let mut xs = vec![
            Attestation::agent("a", "did:nostr:2", t(5)),
            Attestation::agent("b", "did:nostr:1", t(3)),
            Attestation::human("did:nostr:1", 0.5, t(9)),
        ];
        let first = collapse(&xs);
        xs.reverse();
        assert_eq!(first, collapse(&xs));
    }
}
