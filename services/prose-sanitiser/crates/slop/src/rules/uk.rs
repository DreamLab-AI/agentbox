//! The bridge to `prose-sanitiser-uk`.
//!
//! The UK-English rules appear in the slop report under the ids `us-spelling`
//! and `uk-sense`, but this crate implements neither. Both are owned by
//! `prose-sanitiser-uk`, whose [`UkEnglish`](prose_sanitiser_uk::UkEnglish)
//! checker holds the VarCon table, the sense disambiguation, the organisation
//! gazetteer and the span exclusions. The scanners here call it; they do not
//! reimplement it, and they carry no spelling list of their own.
//!
//! That delegation is what stops the scanner "correcting" *the gas meter*, *a
//! driving licence*, *the computer program* or *World Health Organization*. A
//! flat alternation cannot see which sense is meant; the UK crate can, and it is
//! the only place in the workspace that tries.
//!
//! # Ordering
//!
//! The slop table keeps a positional entry for `us-spelling` so the report lists
//! rules in the order it always has. When the scanner reaches that entry it
//! consults the UK checker's findings for the line rather than matching a
//! pattern, which is why the entry carries no patterns at all.

use prose_sanitiser_core::{ConfidenceTier, Severity};

/// Stable machine identifier for the sense-dependent rule.
pub use prose_sanitiser_uk::UK_SENSE_ID;
/// Stable machine identifier for the unconditional dialect rule.
pub use prose_sanitiser_uk::US_SPELLING_ID;
/// One-line human label for it.
pub use prose_sanitiser_uk::US_SPELLING_LABEL;

/// Editorial advice attached to a UK-spelling finding.
pub const US_SPELLING_FIX: &str =
    "Use UK spelling: -ize->-ise, -or->-our, -er->-re, etc. See SKILL.md B12.";

/// How strongly a US-spelling hit signals AI authorship.
pub const US_SPELLING_SEVERITY: Severity = prose_sanitiser_uk::UK_SPELLING_SEVERITY;

/// Whether a hit may be acted on without a human reading it, as reported here.
///
/// The UK crate rates an unconditional VarCon pair
/// [`HighConfidenceStylistic`](ConfidenceTier::HighConfidenceStylistic), and it
/// is right to: it has the gazetteer and the exclusions to back that. The slop
/// table's own entry stays report-only, because the slop report carries no
/// replacement and offers no way to act on one.
pub const US_SPELLING_CONFIDENCE: ConfidenceTier = ConfidenceTier::LowConfidenceJudgement;

/// The UK checker every scanner in this crate delegates to.
pub fn checker() -> &'static prose_sanitiser_uk::UkEnglish {
    use std::sync::OnceLock;
    static CHECKER: OnceLock<prose_sanitiser_uk::UkEnglish> = OnceLock::new();
    CHECKER.get_or_init(prose_sanitiser_uk::UkEnglish::new)
}

/// The UK rules, as SARIF rule metadata, for the shared driver table.
pub fn rule_meta() -> &'static [prose_sanitiser_core::RuleMeta] {
    prose_sanitiser_uk::checker::RULES
}

#[cfg(test)]
mod tests {
    use super::*;
    use prose_sanitiser_core::{Check, Config};

    #[test]
    fn the_sense_dependent_traps_no_longer_auto_correct() {
        // The defect the old single regex had: every one of these was flagged
        // as a plain misspelling with a replacement attached.
        for phrase in [
            "the gas meter read 12 metres",
            "a driving licence issued to license a doctor",
            "the computer program ran",
            "sulfur dioxide is a gas",
            "the dialog box appeared",
        ] {
            for finding in checker().check(phrase, &Config::new()) {
                assert!(
                    finding.replacement.is_none(),
                    "{phrase:?} produced a mechanical replacement for {}",
                    finding.rule_id
                );
            }
        }
    }

    #[test]
    fn an_unconditional_pair_is_still_caught() {
        let findings = checker().check("The color of the center panel.", &Config::new());
        assert!(findings.iter().any(|f| f.rule_id == US_SPELLING_ID));
    }

    #[test]
    fn the_rule_table_covers_both_ids() {
        let ids: Vec<&str> = rule_meta().iter().map(|meta| meta.id).collect();
        assert!(ids.contains(&US_SPELLING_ID));
        assert!(ids.contains(&UK_SENSE_ID));
    }

    #[test]
    fn the_checker_is_built_once() {
        assert!(std::ptr::eq(checker(), checker()));
    }
}
