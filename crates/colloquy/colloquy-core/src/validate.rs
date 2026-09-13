//! Validation, and the one limit that is not a matter of taste.
//!
//! Most of what this module checks is ordinary: a unit needs a summary, an
//! action, and at least one domain tag. One check is different.
//!
//! # The embedding window
//!
//! Retrieval embeds the concatenated insight, and the embedding model sees only
//! a bounded prefix of what it is given — roughly 512 tokens for the
//! `bge-small-en-v1.5` model this estate uses on both the agent side and the
//! edge. Text past that point is *silently* invisible to search: it is stored,
//! it is returned when the unit is fetched by id, and it can never be the
//! reason the unit was found.
//!
//! A convention ("keep it short") does not survive an agent writing units
//! unattended. So the budget is enforced here, at construction, with an error
//! that names the remedy: front-load the searchable facts, and carry the
//! overflow in a second unit linked with [`crate::unit::RelationKind::Continues`].
//!
//! ```
//! use colloquy_core::{validate::{validate, Limits, Invalid}, unit::*, kind::UnitKind, time::Timestamp};
//!
//! let unit = KnowledgeUnit::propose(
//!     "did:nostr:a", UnitKind::Pitfall, ["api"],
//!     Insight::new("summary", "x".repeat(5000), "action"),
//!     Timestamp::from_secs(0),
//! );
//! let errs = validate(&unit, &Limits::default()).unwrap_err();
//! assert!(matches!(errs[0], Invalid::InsightExceedsEmbeddingWindow { .. }));
//! ```

use serde::{Deserialize, Serialize};

use crate::unit::{Insight, KnowledgeUnit, SCHEMA_VERSION};

/// Characters of insight that reach the embedding model.
///
/// `bge-small-en-v1.5` truncates at roughly 512 tokens, which is about 2,500
/// characters of English prose. The budget is set below that, not at it: token
/// density varies with the text, and code fragments — which units are full of —
/// tokenise far worse than prose.
pub const EMBED_CHAR_BUDGET: usize = 2_000;

/// Characters of summary, which has to survive being read in a list.
pub const SUMMARY_CHAR_MAX: usize = 200;

/// The limits a unit is held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Limits {
    /// Combined characters across summary, detail and action.
    pub embed_char_budget: usize,
    /// Characters of summary.
    pub summary_char_max: usize,
    /// Domain tags a unit must carry at least this many of.
    pub min_domain_tags: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            embed_char_budget: EMBED_CHAR_BUDGET,
            summary_char_max: SUMMARY_CHAR_MAX,
            min_domain_tags: 1,
        }
    }
}

/// Why a unit was refused.
///
/// `Eq` is implemented by hand rather than derived: one variant carries an
/// `f64`, and `f64` is not `Eq`. Comparing two refusals for equality — which the
/// tests and any de-duplicating caller do — is well defined here because the
/// float in question is a validated confidence, never `NaN` by the time it is
/// reported alongside a range error.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum Invalid {
    /// A unit with no summary cannot be scanned, so it cannot be used.
    #[error("the summary is empty")]
    EmptySummary,
    /// A unit with no action is an observation, not a learning.
    #[error("the action is empty: a unit must say what to do, not only what happened")]
    EmptyAction,
    /// The summary is too long to read in a list.
    #[error("the summary is {chars} characters; the limit is {max}")]
    SummaryTooLong {
        /// Characters found.
        chars: usize,
        /// Characters allowed.
        max: usize,
    },
    /// The insight runs past what the embedding model will read.
    #[error(
        "the insight is {chars} characters and only the first {budget} reach the embedding model; \
         front-load the searchable facts and carry the remaining {overflow} characters in a linked \
         continuation unit"
    )]
    InsightExceedsEmbeddingWindow {
        /// Characters found.
        chars: usize,
        /// Characters that will be embedded.
        budget: usize,
        /// Characters that would be invisible to search.
        overflow: usize,
    },
    /// A unit with no domain tag cannot be routed to anyone.
    #[error("the unit carries {have} domain tags; at least {need} is required")]
    NotEnoughDomainTags {
        /// Tags found.
        have: usize,
        /// Tags required.
        need: usize,
    },
    /// The id does not match the unit's own substance.
    #[error("the id does not match the unit's content: expected {expected}, found {found}")]
    IdNotContentAddressed {
        /// The id the content mints.
        expected: String,
        /// The id the unit carries.
        found: String,
    },
    /// An unreadable schema version.
    #[error("unsupported schema version {found}; this build reads {supported}")]
    UnsupportedVersion {
        /// Version found.
        found: String,
        /// Version supported.
        supported: &'static str,
    },
    /// Confidence outside `0.0..=1.0`, or not a number.
    #[error("confidence {0} is not in 0.0..=1.0")]
    ConfidenceOutOfRange(f64),
}

impl Eq for Invalid {}

/// How far past the embedding budget an insight runs, in characters.
///
/// Zero when the insight fits. Useful for a composer that wants to warn before
/// the author has finished writing rather than refuse afterwards.
pub fn overflow_chars(insight: &Insight, limits: &Limits) -> usize {
    insight.embedded_len().saturating_sub(limits.embed_char_budget)
}

/// Check a unit, collecting every problem rather than stopping at the first.
///
/// Returning all of them at once matters for an agent caller: a `propose` that
/// fails three times in a row on three different rules burns three round trips
/// and teaches the agent nothing about the shape of a good unit.
pub fn validate(unit: &KnowledgeUnit, limits: &Limits) -> Result<(), Vec<Invalid>> {
    let mut errs = Vec::new();

    if unit.insight.summary.is_empty() {
        errs.push(Invalid::EmptySummary);
    }
    if unit.insight.action.is_empty() {
        errs.push(Invalid::EmptyAction);
    }
    let summary_chars = unit.insight.summary.chars().count();
    if summary_chars > limits.summary_char_max {
        errs.push(Invalid::SummaryTooLong {
            chars: summary_chars,
            max: limits.summary_char_max,
        });
    }
    let overflow = overflow_chars(&unit.insight, limits);
    if overflow > 0 {
        errs.push(Invalid::InsightExceedsEmbeddingWindow {
            chars: unit.insight.embedded_len(),
            budget: limits.embed_char_budget,
            overflow,
        });
    }
    if unit.domain.len() < limits.min_domain_tags {
        errs.push(Invalid::NotEnoughDomainTags {
            have: unit.domain.len(),
            need: limits.min_domain_tags,
        });
    }
    if unit.version != SCHEMA_VERSION {
        errs.push(Invalid::UnsupportedVersion {
            found: unit.version.clone(),
            supported: SCHEMA_VERSION,
        });
    }
    if !(0.0..=1.0).contains(&unit.evidence.confidence) || unit.evidence.confidence.is_nan() {
        errs.push(Invalid::ConfidenceOutOfRange(unit.evidence.confidence));
    }

    let expected = crate::id::UnitId::mint(
        &unit.provenance.proposer_did,
        &unit.domain,
        &unit.insight.summary,
        &unit.insight.detail,
        &unit.insight.action,
    );
    if expected != unit.id {
        errs.push(Invalid::IdNotContentAddressed {
            expected: expected.to_string(),
            found: unit.id.to_string(),
        });
    }

    if errs.is_empty() {
        Ok(())
    } else {
        Err(errs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::UnitKind;
    use crate::time::Timestamp;
    use crate::unit::Insight;

    fn unit(summary: &str, detail: &str, action: &str) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:a",
            UnitKind::Pitfall,
            ["api"],
            Insight::new(summary, detail, action),
            Timestamp::from_secs(0),
        )
    }

    #[test]
    fn a_well_formed_unit_passes() {
        assert!(validate(&unit("s", "d", "a"), &Limits::default()).is_ok());
    }

    #[test]
    fn the_embedding_budget_is_enforced_with_the_remedy_in_the_message() {
        let u = unit("s", &"x".repeat(3_000), "a");
        let errs = validate(&u, &Limits::default()).unwrap_err();
        let msg = errs.iter().map(ToString::to_string).collect::<String>();
        assert!(msg.contains("continuation unit"), "{msg}");
        assert!(msg.contains("1002"), "overflow must be quantified: {msg}");
    }

    #[test]
    fn overflow_is_zero_for_a_unit_that_fits() {
        let i = Insight::new("s", "d", "a");
        assert_eq!(overflow_chars(&i, &Limits::default()), 0);
    }

    #[test]
    fn multibyte_text_is_counted_in_characters_not_bytes() {
        // Three-byte characters must not consume three times the budget.
        let detail = "日".repeat(1_900);
        let u = unit("s", &detail, "a");
        assert!(validate(&u, &Limits::default()).is_ok());
    }

    #[test]
    fn every_problem_is_reported_at_once() {
        let mut u = unit("", "d", "");
        u.domain.clear();
        u.version = "9.9.9".into();
        u.evidence.confidence = 2.0;
        let errs = validate(&u, &Limits::default()).unwrap_err();
        assert!(errs.contains(&Invalid::EmptySummary));
        assert!(errs.contains(&Invalid::EmptyAction));
        assert!(errs.iter().any(|e| matches!(e, Invalid::NotEnoughDomainTags { .. })));
        assert!(errs.iter().any(|e| matches!(e, Invalid::UnsupportedVersion { .. })));
        assert!(errs.contains(&Invalid::ConfidenceOutOfRange(2.0)));
    }

    #[test]
    fn a_tampered_insight_breaks_the_content_address() {
        let mut u = unit("s", "d", "a");
        u.insight.detail = "something else entirely".into();
        let errs = validate(&u, &Limits::default()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, Invalid::IdNotContentAddressed { .. })));
    }
}
