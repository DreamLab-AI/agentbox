//! The checker itself: exclusion, then lookup, then sense, then a finding.
//!
//! The order is the whole design. Nothing is looked up until the exclusion pass
//! has ruled out code, links, front matter, quotations, names and non-English
//! paragraphs; nothing is suggested until the table says the word is genuinely
//! American; and nothing is offered as an applyable replacement unless VarCon
//! records exactly one answer regardless of sense.

use prose_sanitiser_core::{
    Check, ConfidenceTier, Config, Finding, Fix, Fixability, RuleMeta, Severity, Span, Suppressions,
};

use crate::exclude::{word_re, Exclusions};
use crate::options::UkOptions;
use crate::sense::{self, Verdict};
use crate::table::{self, Dialect, Entry};
use crate::{overrides, US_SPELLING_ID, US_SPELLING_LABEL};

/// Rule identifier for spellings whose British form depends on sense.
pub const UK_SENSE_ID: &str = "us-spelling-sense";

/// One-line human label for the sense-dependent rule.
pub const UK_SENSE_LABEL: &str = "Sense-dependent spelling (UK)";

/// Severity of a sense-dependent finding.
///
/// Lower than the unconditional rule on purpose: these are prompts to read a
/// sentence, not defects, so `--min-severity medium` silences them as a set.
pub const UK_SENSE_SEVERITY: Severity = Severity::Low;

/// Severity of an unconditional dialect finding.
pub const UK_SPELLING_SEVERITY: Severity = Severity::Medium;

/// Catalogue entry for the unconditional dialect rule.
///
/// Exposed so a SARIF exporter can build `runs[].tool.driver.rules[]` without
/// hard-coding this crate's rules, per the report shape in
/// [`prose_sanitiser_core::report`].
pub const US_SPELLING: RuleMeta = RuleMeta {
    id: US_SPELLING_ID,
    name: US_SPELLING_LABEL,
    description: "An American spelling with exactly one British form, whatever the sense. \
                  Derived from VarCon's A/B/Z dialect categories, so the Oxford -ize mode \
                  is the data's own distinction rather than a second word list.",
    severity: UK_SPELLING_SEVERITY,
    confidence: ConfidenceTier::HighConfidenceStylistic,
    since: "2026-09-03",
    reviewed: "2026-09-03",
    help_uri: None,
    sources: &[
        "VarCon 2020.12.07 (Kevin Atkinson, Benjamin Titze; SCOWL), vendored at data/varcon.txt",
        "https://wordlist.aspell.net/varcon-readme/",
        "Oxford spelling (en-GB-oxendict): Hart's Rules",
    ],
};

/// Catalogue entry for the sense-dependent rule.
pub const UK_SENSE: RuleMeta = RuleMeta {
    id: UK_SENSE_ID,
    name: UK_SENSE_LABEL,
    description: "A word whose British spelling depends on meaning rather than dialect: \
                  licence/license, practice/practise, program/programme, meter/metre, \
                  check/cheque, tyre/tire, storey/story, kerb/curb. Reported for a human \
                  and never given a replacement.",
    severity: UK_SENSE_SEVERITY,
    confidence: ConfidenceTier::LowConfidenceJudgement,
    since: "2026-09-03",
    reviewed: "2026-09-03",
    help_uri: None,
    sources: &[
        "VarCon 2020.12.07 cluster groups: <N>/<V> part-of-speech tags and usage glosses",
        "https://wordlist.aspell.net/varcon-readme/",
    ],
};

/// Every rule this crate can emit, for a report's driver table.
pub const RULES: &[RuleMeta] = &[US_SPELLING, UK_SENSE];

/// Rules whose repairability does not follow from their confidence tier.
///
/// Empty, and audited to be empty on 2026-09-03 rather than merely left so.
/// The rule is that a rule a caller may act on must be able to hand them
/// something to act with, and both rules here satisfy it in the direction their
/// tier implies. [`US_SPELLING`] is high-confidence stylistic and every finding
/// carries the British form as a replacement, so opt-in is a promise the crate
/// keeps. [`UK_SENSE`] is a judgement call and never carries one, so
/// report-only is what the default already gives it.
pub const FIXABILITY: &[(&str, Fixability)] = &[];

/// The UK-English checker.
///
/// Construct with [`UkEnglish::new`] for the defaults, or
/// [`UkEnglish::with_options`] to extend the organisation gazetteer or relax an
/// exclusion.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::{Check, Config};
/// use prose_sanitiser_uk::UkEnglish;
///
/// let checker = UkEnglish::new();
///
/// // An unconditional pair: reported, and fixable behind an opt-in.
/// let findings = checker.check("The color of the center panel.", &Config::new());
/// assert_eq!(findings.len(), 2);
/// assert_eq!(findings[0].replacement.as_deref(), Some("colour"));
///
/// // A sense that resolves to correct British English: silence.
/// assert!(checker.check("The gas meter was replaced.", &Config::new()).is_empty());
/// ```
#[derive(Debug, Clone, Default)]
pub struct UkEnglish {
    options: UkOptions,
}

impl UkEnglish {
    /// A checker with default options.
    pub fn new() -> Self {
        Self::default()
    }

    /// A checker with the given options.
    pub fn with_options(options: UkOptions) -> Self {
        Self { options }
    }

    /// The options in force.
    pub fn options(&self) -> &UkOptions {
        &self.options
    }

    /// The regions this checker will refuse to look at in `document`.
    ///
    /// Exposed because it is the part worth inspecting when a finding is
    /// missing: almost always the word sat inside something excluded.
    pub fn exclusions(&self, document: &str) -> Exclusions {
        Exclusions::compute(document, &self.options)
    }
}

impl Check for UkEnglish {
    fn rule_ids(&self) -> &[&str] {
        &[US_SPELLING_ID, UK_SENSE_ID]
    }

    fn check(&self, document: &str, config: &Config) -> Vec<Finding> {
        let spelling_on =
            config.rule_enabled(US_SPELLING_ID) && config.severity_reportable(UK_SPELLING_SEVERITY);
        let sense_on =
            config.rule_enabled(UK_SENSE_ID) && config.severity_reportable(UK_SENSE_SEVERITY);
        if !spelling_on && !sense_on {
            return Vec::new();
        }

        let dialect = Dialect::from_config(config);
        let exclusions = Exclusions::compute(document, &self.options);
        // Shared with every other crate in the workspace, so a document is
        // judged English once and identically. The filter fails open: short,
        // unreliable or undetectable text counts as English.
        let english = config.language.english_spans(document);
        let mut findings = Vec::new();

        for hit in word_re().find_iter(document) {
            let span = Span::new(hit.start(), hit.end());
            if exclusions.blocks(span) || !config.language.offset_is_english(&english, span.start) {
                continue;
            }
            let word = hit.as_str();
            if overrides::is_protected(word) || self.options.allows(word) {
                continue;
            }
            let normalised = word.replace('\u{2019}', "'");
            let Some(entry) = table::lookup(&normalised) else {
                continue;
            };

            if entry.is_unconditional() {
                if !spelling_on {
                    continue;
                }
                if let Some(target) = entry.target(dialect) {
                    findings.push(unconditional_finding(span, word, target, dialect));
                }
            } else if sense_on {
                if let Some(finding) = sense_finding(document, span, word, entry, dialect) {
                    findings.push(finding);
                }
            }
        }

        // Vale-style HTML-comment directives, honoured the same way every other
        // checker in the workspace honours them.
        if config.suppressions {
            return Suppressions::parse(document).filter(findings);
        }
        findings
    }
}

impl Fix for UkEnglish {}

/// Build the finding for an unconditional dialect pair.
fn unconditional_finding(span: Span, word: &str, target: &str, dialect: Dialect) -> Finding {
    Finding {
        rule_id: US_SPELLING_ID.to_string(),
        label: US_SPELLING_LABEL.to_string(),
        span,
        matched: word.to_string(),
        severity: UK_SPELLING_SEVERITY,
        confidence: ConfidenceTier::HighConfidenceStylistic,
        advice: format!(
            "US spelling. {} English uses \"{}\".",
            dialect.label(),
            target
        ),
        replacement: Some(match_case(word, target)),
    }
}

/// Build the finding for a sense-dependent word, or nothing if it is correct.
fn sense_finding(
    document: &str,
    span: Span,
    word: &str,
    entry: &Entry,
    dialect: Dialect,
) -> Option<Finding> {
    let advice = match sense::resolve(document, span, entry, dialect) {
        Verdict::CorrectAsWritten => return None,
        Verdict::Suggest { target, sense } => format!(
            "Reads {sense}, where {} English uses \"{target}\". Confirm the sense before changing it.",
            dialect.label()
        ),
        Verdict::Unresolved => format!(
            "Spelling depends on sense: {}. Left as written.",
            describe_senses(entry, dialect)
        ),
    };
    Some(Finding {
        rule_id: UK_SENSE_ID.to_string(),
        label: UK_SENSE_LABEL.to_string(),
        span,
        matched: word.to_string(),
        severity: UK_SENSE_SEVERITY,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        advice,
        // Never a replacement. A sense-dependent pair is a meaning question,
        // and the cost of guessing wrong is a changed meaning.
        replacement: None,
    })
}

/// Summarise every sense VarCon records for `entry`, for the advice line.
fn describe_senses(entry: &Entry, dialect: Dialect) -> String {
    entry
        .senses()
        .iter()
        .map(|sense| match sense.target(dialect) {
            Some(target) => format!("{} it is \"{target}\"", sense.describe()),
            None => format!("{} it is already correct", sense.describe()),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Re-case `target` to match how `source` was written.
///
/// Handles the three cases that occur in prose: all capitals, initial capital,
/// and lower case. Anything else keeps the target's own casing.
fn match_case(source: &str, target: &str) -> String {
    let letters: Vec<char> = source.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
        return target.to_uppercase();
    }
    if source.chars().next().is_some_and(char::is_uppercase) {
        let mut chars = target.chars();
        return match chars.next() {
            Some(first) => first.to_uppercase().chain(chars).collect(),
            None => String::new(),
        };
    }
    target.to_string()
}
