//! Level 2 to level 4: turning recurring workarounds into a build signal.
//!
//! A single workaround is advice. Twenty workarounds from a dozen independent
//! principals, all tagged `retry-semantics`, are not advice — they are a
//! statement that the estate is missing a tool, and their audience is whoever
//! decides what gets built next.
//!
//! The detection here is deliberately *not* semantic. It clusters on the domain
//! taxonomy the units already carry, so the result is deterministic, explicable
//! in one sentence to whoever it lands in front of, and identical on every node
//! that runs it. Embedding-based clustering would find more, and would not be
//! reproducible across a rebuild of the vector index — which is the wrong
//! trade for a signal that has to justify spending engineering time.
//!
//! ```
//! use colloquy_core::{cluster::*, kind::UnitKind, unit::*, time::Timestamp};
//!
//! let t = Timestamp::from_secs(0);
//! let units: Vec<_> = ["alice", "bob", "carol"].iter().enumerate().map(|(i, who)| {
//!     KnowledgeUnit::propose(
//!         // A tag each unit shares, plus one it does not: only the shared tag clusters.
//!         format!("did:nostr:{who}"), UnitKind::Workaround,
//!         ["retry-semantics".to_string(), format!("service-{i}")],
//!         Insight::new(format!("workaround {i}"), "d", "a"), t,
//!     )
//! }).collect();
//!
//! let refs: Vec<_> = units.iter().map(|u| (u, u.provenance.proposer_did.clone())).collect();
//! let gaps = detect_gaps(&refs, &GapPolicy::default());
//! assert_eq!(gaps.len(), 1);
//! assert_eq!(gaps[0].tag, "retry-semantics");
//! assert_eq!(gaps[0].distinct_principals, 3);
//! ```

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::id::UnitId;
use crate::kind::UnitKind;
use crate::principal::PrincipalId;
use crate::unit::KnowledgeUnit;

/// When a pile of workarounds becomes a signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct GapPolicy {
    /// Workarounds that must share a tag.
    pub min_units: usize,
    /// Distinct authorising principals that must be behind them.
    ///
    /// The same collapse rule as confirmation weighting: one operator's five
    /// agents hitting the same wall five times is one operator hitting it, and
    /// is not evidence that the estate needs a new tool.
    pub min_distinct_principals: usize,
    /// Whether superseded and retired workarounds still count towards a gap.
    ///
    /// They do not by default: a workaround that has been superseded is
    /// evidence the gap was *filled*, which is the opposite of the signal.
    pub count_unservable: bool,
}

impl Default for GapPolicy {
    fn default() -> Self {
        Self {
            min_units: 3,
            min_distinct_principals: 3,
            count_unservable: false,
        }
    }
}

/// A detected tooling gap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GapCandidate {
    /// The domain tag the cluster formed around.
    pub tag: String,
    /// Tags shared by *every* unit in the cluster, `tag` included. These become
    /// the domain of the emitted [`UnitKind::ToolGapSignal`].
    pub common_domain: Vec<String>,
    /// The clustered workarounds, in id order.
    pub units: Vec<UnitId>,
    /// Distinct authorising principals behind them.
    pub distinct_principals: usize,
}

impl GapCandidate {
    /// A one-line summary suitable for the emitted gap signal.
    pub fn summary(&self) -> String {
        format!(
            "{} independent principals are working around the same thing in `{}`",
            self.distinct_principals, self.tag
        )
    }
}

/// The accumulator [`detect_gaps`] builds: one entry per domain tag, holding
/// the units carrying it, the principals behind them, and the running
/// intersection of their domains (`None` until the first unit lands).
type TagAccumulator<'a> = BTreeMap<
    &'a str,
    (
        BTreeSet<UnitId>,
        BTreeSet<PrincipalId>,
        Option<BTreeSet<String>>,
    ),
>;

/// Find tooling gaps among a set of units.
///
/// Each element pairs a unit with the authorising principal of its proposer —
/// which the caller resolves, because core has no registry. Only
/// [`UnitKind::Workaround`] units participate; the ladder says gaps are emergent
/// from level 2, and admitting other kinds would let a pitfall nobody can fix
/// masquerade as a missing tool.
///
/// Results are ordered by descending principal count, then by tag, so the most
/// strongly evidenced gap leads and the ordering is stable.
pub fn detect_gaps(
    units: &[(&KnowledgeUnit, impl AsRef<str>)],
    policy: &GapPolicy,
) -> Vec<GapCandidate> {
    // tag -> (unit ids, principals, domain-set intersection)
    let mut by_tag: TagAccumulator<'_> = BTreeMap::new();

    for (unit, principal) in units {
        if unit.lifecycle.kind != UnitKind::Workaround {
            continue;
        }
        if !policy.count_unservable && !unit.lifecycle.status.is_servable() {
            continue;
        }
        let domain: BTreeSet<String> = unit.domain.iter().cloned().collect();
        for tag in &unit.domain {
            let e = by_tag
                .entry(tag.as_str())
                .or_insert_with(|| (BTreeSet::new(), BTreeSet::new(), None));
            e.0.insert(unit.id.clone());
            e.1.insert(PrincipalId(principal.as_ref().to_string()));
            e.2 = Some(match e.2.take() {
                None => domain.clone(),
                Some(acc) => acc.intersection(&domain).cloned().collect(),
            });
        }
    }

    let mut out: Vec<GapCandidate> = by_tag
        .into_iter()
        .filter(|(_, (ids, principals, _))| {
            ids.len() >= policy.min_units && principals.len() >= policy.min_distinct_principals
        })
        .map(|(tag, (ids, principals, common))| GapCandidate {
            tag: tag.to_string(),
            common_domain: common.unwrap_or_default().into_iter().collect(),
            units: ids.into_iter().collect(),
            distinct_principals: principals.len(),
        })
        .collect();

    out.sort_by(|a, b| {
        b.distinct_principals
            .cmp(&a.distinct_principals)
            .then_with(|| a.tag.cmp(&b.tag))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::Timestamp;
    use crate::unit::{Insight, UnitStatus};

    fn work(who: &str, n: usize, domain: &[&str]) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            format!("did:nostr:{who}"),
            UnitKind::Workaround,
            domain.to_vec(),
            Insight::new(format!("w{n}"), "d", "a"),
            Timestamp::from_secs(0),
        )
    }

    fn pairs<'a>(us: &'a [(KnowledgeUnit, &'a str)]) -> Vec<(&'a KnowledgeUnit, &'a str)> {
        us.iter().map(|(u, p)| (u, *p)).collect()
    }

    #[test]
    fn one_operators_swarm_is_not_a_gap() {
        let us: Vec<_> = (0..10)
            .map(|i| (work(&format!("agent{i}"), i, &["retry"]), "did:nostr:one"))
            .collect();
        assert!(detect_gaps(&pairs(&us), &GapPolicy::default()).is_empty());
    }

    #[test]
    fn three_independent_principals_make_a_gap() {
        let us: Vec<_> = ["a", "b", "c"]
            .iter()
            .enumerate()
            .map(|(i, w)| (work(w, i, &["retry", "api"]), *w))
            .collect();
        let gaps = detect_gaps(&pairs(&us), &GapPolicy::default());
        assert_eq!(gaps.len(), 2, "both shared tags cluster");
        assert_eq!(gaps[0].distinct_principals, 3);
        assert_eq!(gaps[0].common_domain, vec!["api", "retry"]);
        assert!(gaps[0].summary().contains("3 independent principals"));
    }

    #[test]
    fn only_workarounds_participate() {
        let mut us: Vec<(KnowledgeUnit, &str)> = Vec::new();
        for (i, w) in ["a", "b", "c"].iter().enumerate() {
            let mut u = work(w, i, &["retry"]);
            u.lifecycle.kind = UnitKind::Pitfall;
            us.push((u, w));
        }
        assert!(detect_gaps(&pairs(&us), &GapPolicy::default()).is_empty());
    }

    #[test]
    fn superseded_workarounds_are_evidence_the_gap_closed() {
        let mut us: Vec<(KnowledgeUnit, &str)> = ["a", "b", "c"]
            .iter()
            .enumerate()
            .map(|(i, w)| (work(w, i, &["retry"]), *w))
            .collect();
        us[0].0.lifecycle.status = UnitStatus::Superseded;
        assert!(
            detect_gaps(&pairs(&us), &GapPolicy::default()).is_empty(),
            "the cluster drops below the threshold once one is superseded"
        );
        let counting = GapPolicy {
            count_unservable: true,
            ..GapPolicy::default()
        };
        assert_eq!(detect_gaps(&pairs(&us), &counting).len(), 1);
    }

    #[test]
    fn ordering_is_stable_and_strongest_first() {
        let mut us: Vec<(KnowledgeUnit, &str)> = Vec::new();
        for (i, w) in ["a", "b", "c"].iter().enumerate() {
            us.push((work(w, i, &["weak"]), *w));
        }
        for (i, w) in ["a", "b", "c", "d", "e"].iter().enumerate() {
            us.push((work(w, 100 + i, &["strong"]), *w));
        }
        let gaps = detect_gaps(&pairs(&us), &GapPolicy::default());
        assert_eq!(
            gaps.iter().map(|g| g.tag.as_str()).collect::<Vec<_>>(),
            vec!["strong", "weak"]
        );
    }
}
