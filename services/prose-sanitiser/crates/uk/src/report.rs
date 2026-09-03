//! Per-rule counts, for measuring the checker rather than trusting it.
//!
//! A linter's only interesting number is how often it is wrong. Run a
//! [`Summary`] over a corpus of known-good British prose and every finding is,
//! by construction, a false positive; the per-rule rate that falls out is the
//! evidence that the rules are safe to ship.
//!
//! The counts are split by rule and by whether a finding could ever be applied,
//! because those are different failure modes: a wrong report costs a reader ten
//! seconds, while a wrong auto-fix costs them a corrupted sentence.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{Check, Config};
//! use prose_sanitiser_uk::{report::Summary, UkEnglish};
//!
//! let checker = UkEnglish::new();
//! let config = Config::new();
//! let mut summary = Summary::new();
//! for document in ["The colour is right.", "The color is wrong."] {
//!     summary.record(document, &checker.check(document, &config), &config);
//! }
//! assert_eq!(summary.documents(), 2);
//! assert_eq!(summary.total(), 1);
//! ```

use std::collections::BTreeMap;

use prose_sanitiser_core::{Config, Finding};

use crate::exclude::word_re;

/// Counts for one rule.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RuleCount {
    /// Findings the rule produced.
    pub findings: usize,
    /// Of those, how many could be applied under the configuration in force.
    pub fixable: usize,
}

/// Accumulated counts across any number of documents.
#[derive(Debug, Clone, Default)]
pub struct Summary {
    documents: usize,
    words: usize,
    rules: BTreeMap<String, RuleCount>,
}

impl Summary {
    /// An empty summary.
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one document's findings in.
    ///
    /// `document` is counted for its word total so rates can be normalised;
    /// `config` decides which findings count as fixable.
    pub fn record(&mut self, document: &str, findings: &[Finding], config: &Config) {
        self.documents += 1;
        self.words += word_re().find_iter(document).count();
        for finding in findings {
            let entry = self.rules.entry(finding.rule_id.clone()).or_default();
            entry.findings += 1;
            if finding.is_fixable(config) {
                entry.fixable += 1;
            }
        }
    }

    /// How many documents have been folded in.
    pub fn documents(&self) -> usize {
        self.documents
    }

    /// How many word tokens those documents held.
    pub fn words(&self) -> usize {
        self.words
    }

    /// Total findings across every rule.
    pub fn total(&self) -> usize {
        self.rules.values().map(|count| count.findings).sum()
    }

    /// Total findings that could be applied.
    pub fn total_fixable(&self) -> usize {
        self.rules.values().map(|count| count.fixable).sum()
    }

    /// Per-rule counts, in rule-identifier order.
    pub fn rules(&self) -> impl Iterator<Item = (&str, RuleCount)> {
        self.rules.iter().map(|(id, count)| (id.as_str(), *count))
    }

    /// Findings per ten thousand words for one rule.
    ///
    /// Ten thousand rather than a percentage because a well-behaved rule fires
    /// a handful of times in a book, and a percentage would read as 0.0 for
    /// everything worth measuring. Returns 0.0 when nothing has been recorded.
    pub fn per_ten_thousand(&self, rule_id: &str) -> f64 {
        if self.words == 0 {
            return 0.0;
        }
        let findings = self.rules.get(rule_id).map_or(0, |count| count.findings);
        findings as f64 * 10_000.0 / self.words as f64
    }

    /// A fixed-width report suitable for a terminal or a CI log.
    ///
    /// When the corpus is known-good British prose, every count is a false
    /// positive and the rightmost column is the false-positive rate.
    pub fn render(&self) -> String {
        let mut out = format!(
            "documents: {}\nwords: {}\nfindings: {} ({} fixable)\n",
            self.documents,
            self.words,
            self.total(),
            self.total_fixable(),
        );
        if self.rules.is_empty() {
            out.push_str("\nno findings\n");
            return out;
        }
        out.push_str("\nrule                      findings  fixable   per 10k words\n");
        for (rule_id, count) in self.rules() {
            out.push_str(&format!(
                "{:<24}  {:>8}  {:>7}  {:>14.2}\n",
                rule_id,
                count.findings,
                count.fixable,
                self.per_ten_thousand(rule_id),
            ));
        }
        out
    }
}
