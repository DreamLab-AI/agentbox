//! The store contract, shared by all three tiers.
//!
//! One trait, three implementations, and the same five verbs on each. The
//! retrieval underneath differs — keywords locally, vectors on the shared tier,
//! tag filters on the relay — but nothing above the trait knows that, which is
//! what lets a deployment move a namespace between tiers by changing
//! configuration.

use async_trait::async_trait;

use colloquy_core::confidence::{Assessment, Ledger};
use colloquy_core::principal::Attestation;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::{ConfirmationPolicy, StalenessPolicy, Timestamp, UnitId};

use crate::query::{Hit, Query, Stats};

/// Why a store operation failed.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The unit is not held here.
    #[error("no unit `{0}` in this store")]
    NotFound(String),
    /// The unit failed validation and was not written.
    #[error("the unit is not valid: {0}")]
    Invalid(String),
    /// The backing store could not be reached or answered badly.
    #[error("backend failure: {0}")]
    Backend(String),
    /// The data read back could not be parsed.
    #[error("corrupt record: {0}")]
    Corrupt(String),
}

/// A unit together with everything said about it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StoredUnit {
    /// The unit.
    pub unit: KnowledgeUnit,
    /// Its attestations.
    pub ledger: Ledger,
}

impl StoredUnit {
    /// Assess the unit as of `now` without mutating it.
    pub fn assess(
        &self,
        confirmation: &ConfirmationPolicy,
        staleness: &StalenessPolicy,
        now: Timestamp,
    ) -> Assessment {
        self.ledger
            .assess(self.unit.lifecycle.kind, confirmation, staleness, now)
    }

    /// Fold the ledger into the unit's evidence and return the assessment.
    pub fn materialise(
        &mut self,
        confirmation: &ConfirmationPolicy,
        staleness: &StalenessPolicy,
        now: Timestamp,
    ) -> Assessment {
        self.ledger
            .apply(&mut self.unit, confirmation, staleness, now)
    }
}

/// The policies a store applies when it assesses what it holds.
#[derive(Debug, Clone, Copy, Default)]
pub struct StorePolicies {
    /// How confirmations are weighed.
    pub confirmation: ConfirmationPolicy,
    /// How units decay.
    pub staleness: StalenessPolicy,
}

/// A tier of the knowledge store.
///
/// Every method takes `now` for the same reason the core does: a store that
/// reads the clock cannot be tested against a decay boundary.
#[async_trait]
pub trait KnowledgeStore: Send + Sync {
    /// Which tier this is.
    fn tier(&self) -> Tier;

    /// Write a unit. Replaces an existing unit with the same id, preserving its
    /// ledger — a proposer correcting their own wording must not discard the
    /// evidence others have accumulated against it.
    async fn put(&self, unit: &KnowledgeUnit, now: Timestamp) -> Result<(), StoreError>;

    /// Fetch one unit by id, with its ledger.
    async fn get(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError>;

    /// Search.
    async fn query(&self, q: &Query, now: Timestamp) -> Result<Vec<Hit>, StoreError>;

    /// Record a confirmation.
    async fn confirm(&self, id: &UnitId, who: Attestation) -> Result<Assessment, StoreError>;

    /// Record a flag.
    async fn flag(&self, id: &UnitId, who: Attestation, reason: &str) -> Result<Assessment, StoreError>;

    /// Report what is held.
    async fn stats(&self, now: Timestamp) -> Result<Stats, StoreError>;
}

/// Delegate through a boxed store.
///
/// The tier is chosen at run time from configuration, so the binary holds a
/// `Box<dyn KnowledgeStore>`. Without this impl the generic [`crate::store::KnowledgeStore`]
/// bound forces every caller to be monomorphised over a tier it cannot know
/// until it has read its environment.
#[async_trait]
impl KnowledgeStore for Box<dyn KnowledgeStore> {
    fn tier(&self) -> Tier {
        (**self).tier()
    }

    async fn put(&self, unit: &KnowledgeUnit, now: Timestamp) -> Result<(), StoreError> {
        (**self).put(unit, now).await
    }

    async fn get(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        (**self).get(id).await
    }

    async fn query(&self, q: &Query, now: Timestamp) -> Result<Vec<Hit>, StoreError> {
        (**self).query(q, now).await
    }

    async fn confirm(&self, id: &UnitId, who: Attestation) -> Result<Assessment, StoreError> {
        (**self).confirm(id, who).await
    }

    async fn flag(&self, id: &UnitId, who: Attestation, reason: &str) -> Result<Assessment, StoreError> {
        (**self).flag(id, who, reason).await
    }

    async fn stats(&self, now: Timestamp) -> Result<Stats, StoreError> {
        (**self).stats(now).await
    }
}

/// Build [`Stats`] from a set of stored units.
///
/// Shared by every implementation so the `status` verb reports the same shape
/// regardless of tier, and so the counting rules live in exactly one place.
pub fn summarise<'a>(
    units: impl Iterator<Item = &'a StoredUnit>,
    policies: &StorePolicies,
    now: Timestamp,
) -> Stats {
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::UnitStatus;
    use std::collections::BTreeSet;

    let mut stats = Stats::default();
    let mut counts = [0usize; 4];
    let mut principals: BTreeSet<colloquy_core::PrincipalId> = BTreeSet::new();

    for su in units {
        stats.units += 1;
        counts[usize::from(su.unit.lifecycle.kind.level() - 1)] += 1;
        let a = su.assess(&policies.confirmation, &policies.staleness, now);
        if su.unit.lifecycle.status.is_servable() {
            stats.servable += 1;
        }
        match a.status {
            UnitStatus::Disputed => stats.disputed += 1,
            UnitStatus::Stale => stats.stale += 1,
            _ => {}
        }
        for p in su.ledger.confirming_principals() {
            principals.insert(p.id);
        }
    }

    stats.by_kind = UnitKind::ALL
        .iter()
        .map(|k| (*k, counts[usize::from(k.level() - 1)]))
        .collect();
    stats.principals = principals.len();
    stats
}

/// Keyword relevance in `0.0..=1.0`.
///
/// The local tier's matcher, and the fallback everywhere else when no embedding
/// is available. Deliberately simple — proportion of the query's distinct words
/// that appear in the unit's searchable text — because a local store exists to
/// work offline and predictably, not to be clever.
pub fn keyword_relevance(query: &str, unit: &KnowledgeUnit) -> f64 {
    let words: Vec<String> = tokenise(query);
    if words.is_empty() {
        return 1.0;
    }
    let hay: Vec<String> = tokenise(&searchable_text(unit));
    let hit = words.iter().filter(|w| hay.contains(w)).count();
    hit as f64 / words.len() as f64
}

/// The text a unit is matched against: its insight and its domain tags.
///
/// This is also exactly what is handed to an embedding model, and it is bounded
/// by `colloquy_core::validate`'s embedding budget, so what is searchable and
/// what was validated are the same string.
pub fn searchable_text(unit: &KnowledgeUnit) -> String {
    format!(
        "{}\n{}\n{}\n{}",
        unit.insight.summary,
        unit.insight.detail,
        unit.insight.action,
        unit.domain.join(" ")
    )
}

fn tokenise(s: &str) -> Vec<String> {
    let mut v: Vec<String> = s
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .filter(|w| w.len() > 2)
        .map(str::to_lowercase)
        .collect();
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::Insight;

    fn unit() -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:p",
            UnitKind::Workaround,
            ["payments"],
            Insight::new(
                "Retried charges double-post",
                "The idempotency key is regenerated per attempt.",
                "Derive the key from the order id.",
            ),
            Timestamp::from_secs(0),
        )
    }

    #[test]
    fn relevance_is_the_proportion_of_query_words_found() {
        let u = unit();
        assert_eq!(keyword_relevance("idempotency", &u), 1.0);
        assert_eq!(keyword_relevance("idempotency unicorn", &u), 0.5);
        assert_eq!(keyword_relevance("unicorn", &u), 0.0);
    }

    #[test]
    fn an_empty_query_matches_everything_rather_than_nothing() {
        assert_eq!(keyword_relevance("", &unit()), 1.0);
        assert_eq!(keyword_relevance("a an of", &unit()), 1.0, "stopword-length noise only");
    }

    #[test]
    fn domain_tags_are_searchable() {
        assert_eq!(keyword_relevance("payments", &unit()), 1.0);
    }

    #[test]
    fn matching_ignores_case_and_punctuation() {
        assert_eq!(keyword_relevance("IDEMPOTENCY, key!", &unit()), 1.0);
    }

    #[test]
    fn searchable_text_is_what_validation_bounded() {
        let u = unit();
        let text = searchable_text(&u);
        assert!(text.contains(&u.insight.summary));
        assert!(text.contains(&u.insight.detail));
        assert!(text.contains(&u.insight.action));
    }

    #[test]
    fn summarise_counts_by_ladder_level() {
        let policies = StorePolicies::default();
        let stored = StoredUnit {
            unit: unit(),
            ledger: Ledger::default(),
        };
        let s = summarise([&stored].into_iter(), &policies, Timestamp::from_secs(0));
        assert_eq!(s.units, 1);
        assert_eq!(s.servable, 1);
        assert_eq!(
            s.by_kind,
            vec![
                (UnitKind::Pitfall, 0),
                (UnitKind::Workaround, 1),
                (UnitKind::ToolRecommendation, 0),
                (UnitKind::ToolGapSignal, 0),
            ]
        );
    }
}
