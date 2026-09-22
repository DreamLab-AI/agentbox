//! The knowledge unit: cq's interoperable record, in Rust.
//!
//! The field layout below is cq's `knowledge_unit.json` verbatim, so a unit
//! written here parses there and vice versa. Two things are ours and both are
//! purely additive, which is what keeps interoperability intact:
//!
//! - [`Graduation::authorising_event`] records the identifier of the *signed*
//!   approval behind a tier promotion. cq records the approver as a string
//!   (`"human:alice@acme.dev"`); an additional event id makes the same claim
//!   checkable. A cq consumer that does not know the field ignores it.
//! - [`UnitStatus::Disputed`] separates "someone flagged this" from "this is
//!   retired". A flag must be able to lower a unit's standing without any one
//!   member being able to suppress it.
//!
//! ```
//! use colloquy_core::{unit::*, kind::UnitKind, id::UnitId, time::Timestamp};
//!
//! let now = Timestamp::parse_rfc3339("2026-01-01T00:00:00Z").unwrap();
//! let unit = KnowledgeUnit::propose(
//!     "did:nostr:abc",
//!     UnitKind::Workaround,
//!     ["api", "payments"],
//!     Insight::new(
//!         "Retried charges double-post when the idempotency key is regenerated",
//!         "The client regenerates the key on retry, so the provider sees two distinct charges.",
//!         "Derive the idempotency key from the order id, never from the attempt.",
//!     ),
//!     now,
//! );
//! assert_eq!(unit.lifecycle.status, UnitStatus::Draft);
//! assert_eq!(unit.evidence.confirmations, 0);
//! assert_eq!(unit.id, UnitId::mint(
//!     "did:nostr:abc",
//!     &["api", "payments"],
//!     "Retried charges double-post when the idempotency key is regenerated",
//!     "The client regenerates the key on retry, so the provider sees two distinct charges.",
//!     "Derive the idempotency key from the order id, never from the attempt.",
//! ));
//! ```

use serde::{Deserialize, Serialize};

use crate::decay::StalenessPolicy;
use crate::id::UnitId;
use crate::kind::UnitKind;
use crate::time::Timestamp;

/// The schema version this crate reads and writes.
pub const SCHEMA_VERSION: &str = "1.0.0";

/// A unit of shared agent learning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KnowledgeUnit {
    /// Content-addressed identity. See [`crate::id`].
    pub id: UnitId,
    /// Schema version, `"1.0.0"` for everything this crate emits.
    pub version: String,
    /// Free-form domain taxonomy, e.g. `["api", "payments", "error-handling"]`.
    /// Sorted and deduplicated on construction so identity and search agree.
    pub domain: Vec<String>,
    /// The learning itself, in three parts.
    pub insight: Insight,
    /// Where the learning applies.
    pub context: UnitContext,
    /// What is known about how well it holds.
    pub evidence: Evidence,
    /// Who proposed it and who approved each promotion.
    pub provenance: Provenance,
    /// Where it sits in its life.
    pub lifecycle: Lifecycle,
}

/// The learning, split the way an agent consumes it.
///
/// The tripartition is load-bearing, not stylistic: an agent scans
/// [`Insight::summary`] across many candidates, reads [`Insight::detail`] on the
/// one it picked, and executes [`Insight::action`]. A unit whose action field
/// restates the summary has not been written yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Insight {
    /// Short description for fast scanning.
    pub summary: String,
    /// Fuller explanation of the issue.
    pub detail: String,
    /// What the agent should do about it.
    pub action: String,
}

impl Insight {
    /// Assemble an insight, trimming surrounding whitespace on each part.
    pub fn new(
        summary: impl Into<String>,
        detail: impl Into<String>,
        action: impl Into<String>,
    ) -> Self {
        Self {
            summary: summary.into().trim().to_string(),
            detail: detail.into().trim().to_string(),
            action: action.into().trim().to_string(),
        }
    }

    /// Characters that reach the embedding model.
    ///
    /// Retrieval embeds the concatenated insight, and the model this estate uses
    /// sees only a bounded prefix of it — so this is the number
    /// [`mod@crate::validate`] holds a unit to.
    pub fn embedded_len(&self) -> usize {
        self.summary.chars().count() + self.detail.chars().count() + self.action.chars().count()
    }
}

/// Where a learning applies.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnitContext {
    /// Programming languages the learning is specific to, if any.
    #[serde(default)]
    pub language: Vec<String>,
    /// Frameworks or libraries the learning is specific to, if any.
    #[serde(default)]
    pub frameworks: Vec<String>,
    /// Deployment environment, e.g. `"server-side"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    /// The shape of work this arises in, e.g. `"api-integration"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

/// How badly a unit's subject bites when it is not known.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Cosmetic or easily noticed.
    Low,
    /// Costs time.
    #[default]
    Medium,
    /// Costs a debugging session, or ships a defect.
    High,
    /// Data loss, security, or money.
    Critical,
}

/// What is known about how well a unit holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    /// How badly the subject bites.
    pub severity: Severity,
    /// Diversity-weighted confidence in `0.0..=1.0`.
    ///
    /// Derived, never authored: recomputed by [`crate::confidence`] from the
    /// attestation set every time that set changes. A unit arriving from a peer
    /// carries the peer's number, which is a claim to be recomputed locally, not
    /// a value to be trusted.
    pub confidence: f64,
    /// How many independent attestations exist. Reported for the reader; it is
    /// *not* what confidence is computed from.
    pub confirmations: u32,
    /// How many distinct authorising principals are behind those attestations.
    ///
    /// cq names this field for organisations; here it carries distinct
    /// authorising principals, which is the same idea at the granularity this
    /// estate can actually verify. **This** is what confidence follows.
    pub contributing_orgs: u32,
    /// When the subject was first seen.
    pub first_observed: Timestamp,
    /// When the unit was last confirmed. Decay reads this.
    pub last_confirmed: Timestamp,
    /// When the unit was last returned by a query, where the store tracks it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_queried_at: Option<Timestamp>,
}

/// Which store a unit lives in.
///
/// The Rust names say what each tier *is* in this estate; the wire tokens are
/// cq's (`local` / `remote` / `global`) so graduation histories cross between
/// implementations unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Private to one agent profile; offline-capable.
    Local,
    /// Shared across the deployment's members. Wire token: `remote`.
    #[serde(rename = "remote")]
    Shared,
    /// Readable by everyone the deployment federates with. Wire token: `global`.
    #[serde(rename = "global")]
    Public,
}

impl Tier {
    /// Tiers in promotion order.
    pub const ALL: [Tier; 3] = [Tier::Local, Tier::Shared, Tier::Public];

    /// Promotion rank: a unit only ever moves up.
    pub const fn rank(self) -> u8 {
        match self {
            Tier::Local => 0,
            Tier::Shared => 1,
            Tier::Public => 2,
        }
    }
}

/// Who proposed a unit, and who approved each promotion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provenance {
    /// The decentralised identifier of the proposing member. In this estate a
    /// `did:nostr:<hex>`; cq's own example is a `did:keri:` value, and the field
    /// is an opaque string either way.
    pub proposer_did: String,
    /// One entry per tier promotion, oldest first.
    #[serde(default)]
    pub graduation_history: Vec<Graduation>,
}

/// One tier promotion, and the human accountable for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Graduation {
    /// Tier promoted from.
    pub from: Tier,
    /// Tier promoted to.
    pub to: Tier,
    /// The approving human, as an identifier.
    pub approved_by: String,
    /// When the approval was given.
    pub timestamp: Timestamp,
    /// Identifier of the signed decision that authorised this promotion.
    ///
    /// **Additive to cq.** In a Nostr deployment this is the event id of the
    /// `31403` ActionResponse the approver signed, which turns `approved_by`
    /// from an assertion into something a third party can verify against the
    /// relay. Absent for units graduated by an implementation that has no
    /// signed-decision substrate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorising_event: Option<String>,
}

/// Where a unit sits in its life.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitStatus {
    /// Proposed, not yet confirmed by anyone.
    #[default]
    Draft,
    /// Live and being served to queries.
    Active,
    /// Past its staleness period. Still served, ranked down, revived by one
    /// confirmation.
    Stale,
    /// Flagged by at least one principal and not yet resolved.
    ///
    /// **Additive to cq.** A flag lowers standing and opens a conversation; it
    /// does not suppress. Only a signed decision moves a unit to
    /// [`UnitStatus::Retired`], so no single member can remove knowledge from
    /// the store by objecting to it.
    Disputed,
    /// Replaced by the unit named in [`Lifecycle::superseded_by`].
    Superseded,
    /// Withdrawn by a signed decision. Retained for audit, never served.
    Retired,
}

impl UnitStatus {
    /// Whether a query should return units in this state.
    ///
    /// Retired and superseded units are not served — the superseding unit is.
    /// Disputed and stale units *are* served, ranked down: hiding contested
    /// knowledge is how a store silently loses the thing an agent needed most.
    pub const fn is_servable(self) -> bool {
        matches!(
            self,
            UnitStatus::Draft | UnitStatus::Active | UnitStatus::Stale | UnitStatus::Disputed
        )
    }
}

/// How a unit relates to another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelationKind {
    /// Adds to the other unit without replacing it.
    Extends,
    /// Carries the overflow of an insight too long to embed in one unit.
    Continues,
    /// Contradicts the other unit; both stay readable.
    Contradicts,
    /// Was aggregated into the other unit, which is a gap signal.
    AggregatedInto,
}

/// A typed link between units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Related {
    /// The other unit.
    pub id: UnitId,
    /// How it relates.
    #[serde(rename = "type")]
    pub kind: RelationKind,
}

/// Lifecycle classification and links.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lifecycle {
    /// Current state.
    pub status: UnitStatus,
    /// Ladder classification.
    pub kind: UnitKind,
    /// cq-style decay token, e.g. `confirm_or_decay_after_60d`. Informational:
    /// the authority is the deployment's [`StalenessPolicy`], which this string
    /// is rendered from so a peer can read the intent.
    pub staleness_policy: String,
    /// The unit that replaced this one, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<UnitId>,
    /// Typed links to other units.
    #[serde(default)]
    pub related: Vec<Related>,
}

impl KnowledgeUnit {
    /// Build a freshly proposed unit.
    ///
    /// The result is a [`UnitStatus::Draft`] with no confirmations: proposing is
    /// not confirming, and an agent cannot bootstrap its own unit's confidence
    /// by proposing it. `first_observed` and `last_confirmed` both start at
    /// `now` so decay has a defined origin.
    pub fn propose(
        proposer_did: impl Into<String>,
        kind: UnitKind,
        domain: impl IntoIterator<Item = impl Into<String>>,
        insight: Insight,
        now: Timestamp,
    ) -> Self {
        Self::propose_with_policy(
            proposer_did,
            kind,
            domain,
            insight,
            now,
            &StalenessPolicy::default(),
        )
    }

    /// As [`KnowledgeUnit::propose`], with an explicit staleness policy to
    /// render the lifecycle token from.
    pub fn propose_with_policy(
        proposer_did: impl Into<String>,
        kind: UnitKind,
        domain: impl IntoIterator<Item = impl Into<String>>,
        insight: Insight,
        now: Timestamp,
        policy: &StalenessPolicy,
    ) -> Self {
        let proposer_did = proposer_did.into();
        let mut domain: Vec<String> = domain.into_iter().map(Into::into).collect();
        domain.sort();
        domain.dedup();

        let id = UnitId::mint(
            &proposer_did,
            &domain,
            &insight.summary,
            &insight.detail,
            &insight.action,
        );

        Self {
            id,
            version: SCHEMA_VERSION.to_string(),
            domain,
            insight,
            context: UnitContext::default(),
            evidence: Evidence {
                severity: Severity::default(),
                confidence: 0.0,
                confirmations: 0,
                contributing_orgs: 0,
                first_observed: now,
                last_confirmed: now,
                last_queried_at: None,
            },
            provenance: Provenance {
                proposer_did,
                graduation_history: Vec::new(),
            },
            lifecycle: Lifecycle {
                status: UnitStatus::Draft,
                kind,
                staleness_policy: policy.token_for(kind),
                superseded_by: None,
                related: Vec::new(),
            },
        }
    }

    /// Replace the context block, returning the unit for chaining.
    pub fn with_context(mut self, context: UnitContext) -> Self {
        self.context = context;
        self
    }

    /// Set the severity, returning the unit for chaining.
    pub fn with_severity(mut self, severity: Severity) -> Self {
        self.evidence.severity = severity;
        self
    }

    /// The tier this unit currently sits in, read from its graduation history.
    ///
    /// A unit with no history is [`Tier::Local`]: it has never been promoted.
    pub fn tier(&self) -> Tier {
        self.provenance
            .graduation_history
            .last()
            .map_or(Tier::Local, |g| g.to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> Timestamp {
        Timestamp::parse_rfc3339("2026-01-01T00:00:00Z").unwrap()
    }

    fn sample() -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:abc",
            UnitKind::Workaround,
            ["payments", "api", "payments"],
            Insight::new("  summary  ", "detail", "action"),
            now(),
        )
    }

    #[test]
    fn proposing_does_not_confirm() {
        let u = sample();
        assert_eq!(u.lifecycle.status, UnitStatus::Draft);
        assert_eq!(u.evidence.confirmations, 0);
        assert_eq!(u.evidence.contributing_orgs, 0);
        assert_eq!(u.evidence.confidence, 0.0);
    }

    #[test]
    fn domain_is_normalised_and_insight_trimmed() {
        let u = sample();
        assert_eq!(u.domain, vec!["api", "payments"]);
        assert_eq!(u.insight.summary, "summary");
    }

    #[test]
    fn a_fresh_unit_is_local() {
        assert_eq!(sample().tier(), Tier::Local);
    }

    #[test]
    fn tier_wire_tokens_are_cqs() {
        assert_eq!(serde_json::to_string(&Tier::Local).unwrap(), "\"local\"");
        assert_eq!(serde_json::to_string(&Tier::Shared).unwrap(), "\"remote\"");
        assert_eq!(serde_json::to_string(&Tier::Public).unwrap(), "\"global\"");
        assert_eq!(
            serde_json::from_str::<Tier>("\"global\"").unwrap(),
            Tier::Public
        );
    }

    #[test]
    fn disputed_and_stale_units_are_still_served() {
        assert!(UnitStatus::Disputed.is_servable());
        assert!(UnitStatus::Stale.is_servable());
        assert!(!UnitStatus::Retired.is_servable());
        assert!(!UnitStatus::Superseded.is_servable());
    }

    #[test]
    fn the_authorising_event_is_omitted_when_absent() {
        let g = Graduation {
            from: Tier::Local,
            to: Tier::Shared,
            approved_by: "human:alice@acme.dev".into(),
            timestamp: now(),
            authorising_event: None,
        };
        let j = serde_json::to_string(&g).unwrap();
        assert!(!j.contains("authorising_event"), "must stay cq-shaped: {j}");
    }

    #[test]
    fn round_trips_through_json() {
        let u = sample();
        let j = serde_json::to_string(&u).unwrap();
        assert_eq!(serde_json::from_str::<KnowledgeUnit>(&j).unwrap(), u);
    }
}
