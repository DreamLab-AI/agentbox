//! The published rule table, for the SARIF driver and `--explain` output.
//!
//! Every rule Layer A can emit appears here exactly once, with the evidence it
//! rests on. All but one are [`ConfidenceTier::CertainMechanical`]: each is a
//! deterministic classification of a codepoint and its context, verifiable by
//! diffing the output, which is what earns them a SARIF `fixes[]` entry.
//!
//! The exception is `unicode-soft-hyphen`, which is
//! [`ConfidenceTier::LowConfidenceJudgement`] and therefore report-only. A soft
//! hyphen is a legitimate hyphenation hint as often as it is a carrier, and
//! nothing in the codepoint tells you which, so it never carries a fix.
//!
//! `since` and `reviewed` are honest dates, not decoration. A rule whose
//! `reviewed` date has gone stale is a rule whose sources nobody has re-checked.

use prose_sanitiser_core::{ConfidenceTier, RuleMeta, Severity};

const TR39: &str = "https://www.unicode.org/reports/tr39/";
const TR55: &str = "https://www.unicode.org/reports/tr55/";
const BUTLER: &str = "https://paulbutler.org/2025/smuggling-arbitrary-data-through-an-emoji/";
const TROJAN: &str = "https://arxiv.org/abs/2111.00169";
const TR51: &str = "https://www.unicode.org/reports/tr51/";

/// Every rule this crate emits, in report order.
///
/// ```
/// use prose_sanitiser_core::ConfidenceTier;
/// use prose_sanitiser_unicode::RULES;
///
/// // Every rule is mechanical except the soft hyphen, which is a judgement.
/// for rule in RULES {
///     let expected = if rule.id == "unicode-soft-hyphen" {
///         ConfidenceTier::LowConfidenceJudgement
///     } else {
///         ConfidenceTier::CertainMechanical
///     };
///     assert_eq!(rule.confidence, expected, "{}", rule.id);
/// }
/// ```
pub const RULES: &[RuleMeta] = &[
    RuleMeta {
        id: "unicode-invisible",
        name: "Invisible or format-class carrier",
        description: "A Cf-class or default-ignorable character carrying no visible content: the \
             zero-width family, exotic whitespace, soft hyphen, Hangul fillers, private-use \
             codepoints. Load-bearing invisibles — emoji ZWJ glue, Indic and Persian joiners, \
             a BOM at offset 0, same-script fillers — are excluded by context rules.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(TR51),
        sources: &[
            "Unicode 17.0 core specification, chapter 23 (Special Areas and Format Characters)",
            TR51,
        ],
    },
    RuleMeta {
        id: "unicode-homoglyph",
        name: "Homoglyph or mixed-script substitution",
        description:
            "A character confusable with an ASCII alphanumeric, judged by the UTS #39 skeleton \
             algorithm together with Identifier_Status and mixed-script detection. Honest \
             single-script prose in Cyrillic, Greek, Hebrew, Arabic, Devanagari or CJK is \
             excluded by the run- and document-level context rules.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(TR39),
        sources: &[
            TR39,
            "SilverSpeak: homoglyph substitution collapses seven detectors to near-zero MCC \
             (ACL 2025 GenAI-Detect workshop)",
        ],
    },
    RuleMeta {
        id: "unicode-vs-payload",
        name: "Variation-selector smuggled payload",
        description:
            "Two or more stacked variation selectors, decoded as bytes under the Butler map \
             (U+FE00+n for n<16, U+E0100+n-16 above). Legitimate use is exactly one selector \
             per base, so a stack of two or more is mechanically certain contraband. Used in \
             the os-info-checker-es6 npm supply-chain attack.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(BUTLER),
        sources: &[BUTLER, TR51],
    },
    RuleMeta {
        id: "unicode-tag-payload",
        name: "Tag-block smuggled payload",
        description:
            "Tag-block characters (U+E0020..=U+E007E carry ASCII; U+E0001 is the deprecated \
             LANGUAGE TAG) outside a well-formed RGI subdivision-flag sequence. The England, \
             Scotland and Wales flags are U+1F3F4 plus a recognised subdivision code plus \
             U+E007F, and are preserved.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(TR51),
        sources: &[TR51, "Unicode tag block chart, U+E0000..U+E007F"],
    },
    RuleMeta {
        id: "unicode-zw-payload",
        name: "Zero-width binary payload",
        description:
            "A run of eight or more zero-width characters used as a bit string. The presence \
             of such a run is certain — no orthography stacks eight joiners — though the bit \
             mapping (ZWSP and word joiner as 0, ZWNJ and ZWJ as 1) is a convention rather \
             than a standard, so the recovered bytes are a best-effort reading.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &["Unicode 17.0 core specification, chapter 23"],
    },
    RuleMeta {
        id: "unicode-soft-hyphen",
        name: "Soft hyphen",
        description:
            "U+00AD SOFT HYPHEN, which is invisible unless a line break falls on it. That is \
             exactly what makes it useful to a typesetter and to an attacker, so it is \
             reported but never fixed automatically: whether a given one is a hyphenation \
             hint or a carrier is a judgement only the author can make. Removing it is \
             opt-in through CleanOptions::strip_soft_hyphen.",
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[
            "Unicode 17.0 core specification, chapter 23 (reclassified Pd to Cf in Unicode 4.0)",
        ],
    },
    RuleMeta {
        id: "unicode-bidi",
        name: "Bidi control rejected by the context policy",
        description:
            "A bidirectional control the context policy rejects. In source code every control \
             is contraband (the Trojan Source attack, CVE-2021-42574, per UTS #55). In prose \
             balanced controls are preserved where the text genuinely contains right-to-left \
             script; unbalanced, nested-unbalanced and no-RTL-context cases are reported.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(TR55),
        sources: &[
            TROJAN,
            TR55,
            "https://unicode.org/reports/tr9/ (UAX #9, the bidirectional algorithm)",
        ],
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_soft_hyphen_is_a_judgement_call() {
        // The tier is the auto-fix gate, so a rule drifting into
        // CertainMechanical silently earns the right to rewrite someone's text.
        for rule in RULES {
            let expected = if rule.id == "unicode-soft-hyphen" {
                ConfidenceTier::LowConfidenceJudgement
            } else {
                ConfidenceTier::CertainMechanical
            };
            assert_eq!(rule.confidence, expected, "{}", rule.id);
        }
    }

    #[test]
    fn rule_ids_are_unique_and_namespaced() {
        let mut ids: Vec<&str> = RULES.iter().map(|rule| rule.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate rule id");
        assert!(RULES.iter().all(|rule| rule.id.starts_with("unicode-")));
    }

    #[test]
    fn every_rule_cites_its_evidence() {
        assert!(RULES.iter().all(|rule| !rule.sources.is_empty()));
        assert!(RULES.iter().all(|rule| !rule.description.is_empty()));
    }

    #[test]
    fn review_dates_are_iso_8601() {
        for rule in RULES {
            assert_eq!(rule.since.len(), 10, "{}", rule.id);
            assert_eq!(rule.reviewed.len(), 10, "{}", rule.id);
            assert!(rule.reviewed >= rule.since, "{}", rule.id);
        }
    }

    #[test]
    fn the_table_renders_as_sarif_reporting_descriptors() {
        for rule in RULES {
            let sarif = rule.to_sarif();
            assert_eq!(sarif["id"], rule.id);
            assert_eq!(sarif["properties"]["confidence"], rule.confidence.as_str());
        }
    }
}
