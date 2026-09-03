//! UK-English spelling enforcement.
//!
//! Today this crate is one rule: the `us-spelling` alternation that the prose
//! slop scanner has always shipped. It lives here so there is a single source
//! of truth for the pattern, and so the UK layer can grow a real subsystem
//! (VarCon data, span exclusion, sense disambiguation, an `--oxford` flag)
//! without disturbing the slop rule tables around it.
//!
//! `prose-sanitiser-slop` re-uses the constants below for its own table entry,
//! so the scanner and the [`check`] API here can never drift apart.
//!
//! # Honest scope
//!
//! From the capability matrix (section B of the design brief), UK spelling sits
//! in **can detect and report, but must not claim to strip**:
//!
//! | Capability | Why |
//! |---|---|
//! | AI stylistic tells (lexical, structural, narrative) | Heuristic, not forensic. Population-level evidence only |
//!
//! and its findings fall under **must never touch**:
//!
//! | Never modify | Rule |
//! |---|---|
//! | US spelling in proper nouns, organisation names, and direct quotations | Gazetteer plus quotation detection |
//! | `program` (computing), `meter` (instrument), `disk` (hard), `sulfur` (chemistry), `fetus` (medical), `dialog box` (UI) | Sense-dependent; report-only at most |
//!
//! ## Known limitations of the current rule
//!
//! The pattern is a single flat alternation. It has no sense disambiguation, no
//! proper-noun protection and no code-span exclusion, so it matches
//! sense-dependent tokens (`meter` in *gas meter*, `license` as the British
//! verb, `catalog`, `fulfill`) and organisation names (*World Health
//! Organization*) as readily as genuine Americanisms. Every finding it produces
//! is therefore [`ConfidenceTier::LowConfidenceJudgement`]: reported for a human
//! to weigh, never mechanically applied. [`check`] emits no `replacement`, so
//! nothing here can auto-fix regardless of configuration.

use std::sync::OnceLock;

use prose_sanitiser_core::{Check, ConfidenceTier, Config, Finding, Severity, Span};
use regex::Regex;

/// Stable machine identifier for the UK-spelling rule.
pub const US_SPELLING_ID: &str = "us-spelling";

/// One-line human label for the UK-spelling rule.
pub const US_SPELLING_LABEL: &str = "US spelling (enforce UK)";

/// Editorial advice attached to a UK-spelling finding.
pub const US_SPELLING_FIX: &str =
    "Use UK spelling: -ize->-ise, -or->-our, -er->-re, etc. See SKILL.md B12.";

/// How strongly a US-spelling hit signals AI authorship.
pub const US_SPELLING_SEVERITY: Severity = Severity::Medium;

/// Whether a hit may be acted on without a human reading it: never.
pub const US_SPELLING_CONFIDENCE: ConfidenceTier = ConfidenceTier::LowConfidenceJudgement;

/// The US-spelling alternation, matched case-insensitively.
///
/// This is the single source of truth: `prose-sanitiser-slop` embeds this exact
/// string in its rule table rather than keeping a second copy.
pub const US_SPELLING_PATTERN: &str = r"\b(optimiz(e|es|ed|ing|ation)|organiz(e|es|ed|ing|ation)|recogniz(e|es|ed|ing)|analyz(e|es|ed|ing)|categoriz(e|es|ed|ing|ation)|customiz(e|es|ed|ing|ation)|prioritiz(e|es|ed|ing|ation)|emphasiz(e|es|ed|ing)|realiz(e|es|ed|ing)|color|colors|behavior|behaviors|favor|favors|honor|honors|labor|center|centers|fiber|fibers|liter|meter|theater|defense|offense|license[ds]?|catalog|catalogs|fulfill(s|ed|ing)?|traveler|traveled|traveling|canceled|canceling|modeling|modeled)\b";

fn us_spelling_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(&format!("(?i){US_SPELLING_PATTERN}")).expect("static regex compiles")
    })
}

/// The UK-English checker.
///
/// Zero-sized; construct it with [`UkEnglish::new`] or `UkEnglish::default()`.
#[derive(Debug, Clone, Copy, Default)]
pub struct UkEnglish;

impl UkEnglish {
    /// A UK-English checker.
    pub fn new() -> Self {
        Self
    }
}

impl Check for UkEnglish {
    fn rule_ids(&self) -> &[&str] {
        &[US_SPELLING_ID]
    }

    fn check(&self, document: &str, config: &Config) -> Vec<Finding> {
        check_with(document, config)
    }
}

/// Report every US spelling in `document`, using the default configuration.
///
/// Findings are report-only: none carries a `replacement`, so no caller can
/// mechanically apply them.
///
/// # Examples
///
/// ```
/// let findings = prose_sanitiser_uk::check("We optimize the color scheme.");
/// let matched: Vec<&str> = findings.iter().map(|f| f.matched.as_str()).collect();
/// assert_eq!(matched, ["optimize", "color"]);
/// assert!(findings.iter().all(|f| f.replacement.is_none()));
/// ```
pub fn check(document: &str) -> Vec<Finding> {
    check_with(document, &Config::new())
}

/// Report every US spelling in `document` under `config`.
///
/// Honours [`Config::rule_enabled`] and [`Config::severity_reportable`]. The
/// `oxford` flag does not affect this rule: the alternation contains no
/// `-ise`/`-ize` decision that Oxford spelling would reverse.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::Config;
///
/// let config = Config::new().without_rule("us-spelling");
/// assert!(prose_sanitiser_uk::check_with("We optimize it.", &config).is_empty());
/// ```
pub fn check_with(document: &str, config: &Config) -> Vec<Finding> {
    if !config.rule_enabled(US_SPELLING_ID) || !config.severity_reportable(US_SPELLING_SEVERITY) {
        return Vec::new();
    }
    us_spelling_re()
        .find_iter(document)
        .map(|hit| Finding {
            rule_id: US_SPELLING_ID.to_string(),
            label: US_SPELLING_LABEL.to_string(),
            span: Span::new(hit.start(), hit.end()),
            matched: hit.as_str().to_string(),
            severity: US_SPELLING_SEVERITY,
            confidence: US_SPELLING_CONFIDENCE,
            advice: US_SPELLING_FIX.to_string(),
            // Report-only: the alternation has no sense disambiguation, so no
            // replacement it could offer would be safe to apply.
            replacement: None,
        })
        .collect()
}

#[cfg(test)]
mod tests;
