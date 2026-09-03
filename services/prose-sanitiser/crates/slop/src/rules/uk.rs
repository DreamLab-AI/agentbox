//! The bridge to `prose-sanitiser-uk`.
//!
//! The UK-English rule appears in the slop report under the id `us-spelling`,
//! but the crate holds no word list of its own: the alternation is built at
//! first use from the VarCon table `prose-sanitiser-uk` ships, so the two can
//! never drift.
//!
//! Only [`prose_sanitiser_uk::table::Entry::is_unconditional`] entries go into the
//! pattern. VarCon marks a spelling sense-dependent when British English keeps
//! the American form in some reading — *meter* the instrument, *licence* the
//! verb, *program* the
//! computing sense, *dialog* the UI element — and a flat alternation cannot see
//! which reading is meant. Excluding them is what stops the scanner
//! "correcting" *the gas meter*.
//!
//! This is a data-level integration, not a duplicated implementation. When the
//! UK crate exposes its own [`prose_sanitiser_core::Check`], this module should
//! delegate to it rather than build a pattern.

use std::sync::OnceLock;

use prose_sanitiser_core::{ConfidenceTier, Severity};

/// Stable machine identifier for the UK-spelling rule.
pub const US_SPELLING_ID: &str = "us-spelling";

/// One-line human label.
pub const US_SPELLING_LABEL: &str = "US spelling (enforce UK)";

/// Editorial advice attached to a UK-spelling finding.
pub const US_SPELLING_FIX: &str =
    "Use UK spelling: -ize->-ise, -or->-our, -er->-re, etc. See SKILL.md B12.";

/// How strongly a US-spelling hit signals AI authorship.
pub const US_SPELLING_SEVERITY: Severity = Severity::Medium;

/// Whether a hit may be acted on without a human reading it.
///
/// Never, from the slop scanner. The scanner sees one line at a time with no
/// gazetteer and no quotation detection, so even an unconditional VarCon pair
/// can be a proper noun (*World Health Organization*) or someone else's words.
/// The UK crate's own checker, which has that context, may rate the same word
/// higher.
pub const US_SPELLING_CONFIDENCE: ConfidenceTier = ConfidenceTier::LowConfidenceJudgement;

/// The `us-spelling` alternation, built once from the VarCon table.
///
/// Returned as a single-element slice because [`super::Rule`] holds its
/// patterns as a slice, and the whole table is one alternation.
pub fn us_spelling_patterns() -> &'static [String] {
    static PATTERNS: OnceLock<Vec<String>> = OnceLock::new();
    PATTERNS
        .get_or_init(|| {
            let mut words: Vec<&'static str> = prose_sanitiser_uk::table::entries()
                .iter()
                .filter(|entry| entry.is_unconditional())
                .map(|entry| entry.american())
                .collect();
            // Longest first, so the alternation prefers `organizations` over
            // `organization` and reports the whole word.
            words.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
            if words.is_empty() {
                // An empty alternation would match everywhere. A pattern that
                // cannot match is the only safe degenerate case.
                return vec![r"(?!)".to_string()];
            }
            vec![format!(r"\b(?:{})\b", words.join("|"))]
        })
        .as_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pattern_is_built_from_the_varcon_table() {
        let patterns = us_spelling_patterns();
        assert_eq!(patterns.len(), 1);
        let pattern = regex::Regex::new(&format!("(?i){}", patterns[0])).unwrap();
        for word in ["color", "organize", "behavior", "center"] {
            assert!(pattern.is_match(word), "{word} should match");
        }
    }

    #[test]
    fn the_sense_dependent_traps_are_excluded() {
        let pattern = regex::Regex::new(&format!("(?i){}", us_spelling_patterns()[0])).unwrap();
        // The defect the old single regex had: every one of these matched.
        for phrase in [
            "the gas meter read 12 metres",
            "a driving licence issued to license a doctor",
            "the computer program",
            "sulfur dioxide",
            "the dialog box",
            "the fetus",
        ] {
            assert!(
                !pattern.is_match(phrase),
                "{phrase:?} should not match the unconditional alternation"
            );
        }
    }

    #[test]
    fn the_pattern_is_built_once() {
        assert_eq!(
            us_spelling_patterns().as_ptr(),
            us_spelling_patterns().as_ptr()
        );
    }
}
