//! What a `query` asks for, and what it gets back.
//!
//! The shape here is the same across all three tiers even though the retrieval
//! underneath is not: the local tier matches keywords, the shared tier matches
//! vectors, and the relay matches tags. A caller that swaps tiers changes its
//! results, never its code — which is the property cq's tier architecture is
//! for.

use serde::{Deserialize, Serialize};

use colloquy_core::confidence::Assessment;
use colloquy_core::kind::UnitKind;
use colloquy_core::unit::KnowledgeUnit;

/// A retrieval request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Query {
    /// Free text. Matched by keyword locally and by embedding on the shared tier.
    pub text: String,
    /// Restrict to units carrying *any* of these domain tags. Empty means no
    /// restriction.
    pub domain: Vec<String>,
    /// Restrict to these ladder kinds. Empty means every kind *except* gap
    /// signals — see [`Query::include_gap_signals`].
    pub kinds: Vec<UnitKind>,
    /// Floor on derived confidence.
    pub min_confidence: f64,
    /// Maximum hits.
    pub limit: usize,
    /// Whether to include level-4 gap signals.
    ///
    /// Off by default, and deliberately: a gap signal is a message to whoever
    /// decides what to build, not advice an agent can act on. Serving them into
    /// an agent's retrieval is how a store starts answering "how do I do X" with
    /// "several people wish X were easier".
    pub include_gap_signals: bool,
}

impl Default for Query {
    fn default() -> Self {
        Self {
            text: String::new(),
            domain: Vec::new(),
            kinds: Vec::new(),
            min_confidence: 0.0,
            limit: 10,
            include_gap_signals: false,
        }
    }
}

impl Query {
    /// A free-text query.
    pub fn text(s: impl Into<String>) -> Self {
        Self {
            text: s.into(),
            ..Self::default()
        }
    }

    /// Restrict to domain tags.
    pub fn in_domain(mut self, tags: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.domain = tags.into_iter().map(Into::into).collect();
        self
    }

    /// Cap the number of hits.
    pub fn limit(mut self, n: usize) -> Self {
        self.limit = n;
        self
    }

    /// Set the confidence floor.
    pub fn min_confidence(mut self, c: f64) -> Self {
        self.min_confidence = c;
        self
    }

    /// Whether a unit passes the non-textual filters.
    pub fn admits(&self, unit: &KnowledgeUnit, assessment: &Assessment) -> bool {
        if !unit.lifecycle.status.is_servable() {
            return false;
        }
        if !self.include_gap_signals && unit.lifecycle.kind == UnitKind::ToolGapSignal {
            return false;
        }
        if !self.kinds.is_empty() && !self.kinds.contains(&unit.lifecycle.kind) {
            return false;
        }
        if !self.domain.is_empty() && !unit.domain.iter().any(|d| self.domain.contains(d)) {
            return false;
        }
        assessment.confidence >= self.min_confidence
    }
}

/// One retrieval hit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hit {
    /// The unit.
    pub unit: KnowledgeUnit,
    /// Its evidence as of the moment of the query.
    pub assessment: Assessment,
    /// Relevance from the tier's own matcher, in `0.0..=1.0`.
    pub relevance: f64,
    /// Final ordering key: `relevance · assessment.score`.
    ///
    /// Both halves matter. Relevance alone serves confident nonsense that
    /// happens to share words with the question; evidence alone serves the
    /// store's best-established unit regardless of what was asked.
    pub rank: f64,
}

impl Hit {
    /// Build a hit, computing its rank.
    pub fn new(unit: KnowledgeUnit, assessment: Assessment, relevance: f64) -> Self {
        let rank = relevance * assessment.score;
        Self {
            unit,
            assessment,
            relevance,
            rank,
        }
    }
}

/// Store statistics, as the `status` verb reports them.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    /// Units held.
    pub units: usize,
    /// Units by ladder kind, as `(kind, count)` in ladder order.
    pub by_kind: Vec<(UnitKind, usize)>,
    /// Units currently servable.
    pub servable: usize,
    /// Units currently disputed.
    pub disputed: usize,
    /// Units currently stale.
    pub stale: usize,
    /// Distinct authorising principals that have ever confirmed anything here.
    pub principals: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::confidence::Ledger;
    use colloquy_core::time::Timestamp;
    use colloquy_core::unit::{Insight, UnitStatus};

    fn unit(kind: UnitKind, domain: &[&str]) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:p",
            kind,
            domain.to_vec(),
            Insight::new("s", "d", "a"),
            Timestamp::from_secs(0),
        )
    }

    fn assessment(confidence: f64) -> Assessment {
        let mut a = Ledger::default().assess(
            UnitKind::Pitfall,
            &Default::default(),
            &Default::default(),
            Timestamp::from_secs(0),
        );
        a.confidence = confidence;
        a.score = confidence;
        a
    }

    #[test]
    fn gap_signals_are_withheld_from_agents_by_default() {
        let q = Query::default();
        let gap = unit(UnitKind::ToolGapSignal, &["api"]);
        assert!(!q.admits(&gap, &assessment(1.0)));

        let opted_in = Query {
            include_gap_signals: true,
            ..Query::default()
        };
        assert!(opted_in.admits(&gap, &assessment(1.0)));
    }

    #[test]
    fn retired_units_are_never_served_whatever_the_filters() {
        let mut u = unit(UnitKind::Pitfall, &["api"]);
        u.lifecycle.status = UnitStatus::Retired;
        let q = Query {
            include_gap_signals: true,
            ..Query::default()
        };
        assert!(!q.admits(&u, &assessment(1.0)));
    }

    #[test]
    fn domain_filtering_is_any_of_not_all_of() {
        let q = Query::default().in_domain(["payments", "absent"]);
        assert!(q.admits(
            &unit(UnitKind::Pitfall, &["api", "payments"]),
            &assessment(1.0)
        ));
        assert!(!q.admits(&unit(UnitKind::Pitfall, &["api"]), &assessment(1.0)));
    }

    #[test]
    fn the_confidence_floor_is_inclusive() {
        let q = Query::default().min_confidence(0.5);
        let u = unit(UnitKind::Pitfall, &["api"]);
        assert!(q.admits(&u, &assessment(0.5)));
        assert!(!q.admits(&u, &assessment(0.499)));
    }

    #[test]
    fn rank_needs_both_halves() {
        let u = unit(UnitKind::Pitfall, &["api"]);
        let relevant_but_unevidenced = Hit::new(u.clone(), assessment(0.05), 1.0);
        let evidenced_but_irrelevant = Hit::new(u.clone(), assessment(1.0), 0.05);
        let both = Hit::new(u, assessment(0.8), 0.8);
        assert!(both.rank > relevant_but_unevidenced.rank);
        assert!(both.rank > evidenced_but_irrelevant.rank);
    }
}
