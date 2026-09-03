//! The library API: [`SlopChecker`], a [`Check`] over a document in memory.
//!
//! The `slop-scan` binary walks a directory and prints a report; this is the
//! same rules reached from a library, over a `&str`, returning [`Finding`]s with
//! real byte spans. One implementation serving both is what lets an editor, a
//! SARIF exporter and the CLI agree on what the rules say.
//!
//! Checking never mutates and never touches the filesystem. There is
//! deliberately no [`prose_sanitiser_core::Fix`] implementation: no slop rule
//! emits a `replacement`, because a stylistic tell is a prompt for an editor,
//! not a substitution a machine can make.
//!
//! # What the checker skips
//!
//! In order: fenced code blocks and blockquotes (never prose), lines carrying
//! the legacy `slop-ignore` marker, spans the HTML-comment directives suppress,
//! paragraphs the language filter does not read as English, rules the
//! configuration disables, and findings below the severity floor.
//!
//! # Delegation
//!
//! The UK-English rules (`us-spelling` and `uk-sense`) are not implemented here.
//! They come from `prose-sanitiser-uk`, which runs over the whole document
//! because sense disambiguation and the organisation gazetteer both need more
//! context than one line. See [`crate::rules::uk`].
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{Check, Config};
//! use prose_sanitiser_slop::SlopChecker;
//!
//! let findings = SlopChecker::new().check("We delve into the tapestry.", &Config::new());
//! assert_eq!(findings[0].rule_id, "tier1-vocab");
//! assert_eq!(findings[0].matched, "We delve into the tapestry.");
//!
//! // A suppression directive silences it.
//! let suppressed = SlopChecker::new().check(
//!     "<!-- prose-sanitiser-disable tier1-vocab -->\nWe delve into the tapestry.",
//!     &Config::new(),
//! );
//! assert!(suppressed.is_empty());
//! ```

use prose_sanitiser_core::{Check, Config, Finding, Span, Suppressions};
use regex::Regex;

use crate::rules::{uk, Rule, IGNORE_MARK, RULES};
use crate::structural::StructuralMetrics;

/// Every rule in the table, compiled once.
pub struct SlopChecker {
    compiled: Vec<(&'static Rule, Vec<Regex>)>,
    ids: Vec<&'static str>,
    structural: bool,
}

impl Default for SlopChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl SlopChecker {
    /// Compile the per-line rules. Structural measures are off by default.
    pub fn new() -> Self {
        let compiled = RULES
            .iter()
            .map(|rule| {
                let patterns = rule
                    .pattern_sources()
                    .iter()
                    .map(|pattern| {
                        let source = if rule.cased {
                            (*pattern).to_string()
                        } else {
                            format!("(?i){pattern}")
                        };
                        Regex::new(&source).expect("rule patterns are validated by a unit test")
                    })
                    .collect();
                (rule, patterns)
            })
            .collect();
        let mut ids: Vec<&'static str> = RULES.iter().map(|rule| rule.id).collect();
        for meta in uk::rule_meta() {
            if !ids.contains(&meta.id) {
                ids.push(meta.id);
            }
        }
        ids.push("agg");
        Self {
            compiled,
            ids,
            structural: false,
        }
    }

    /// Also report the whole-document structural measures.
    pub fn with_structural(mut self, structural: bool) -> Self {
        self.structural = structural;
        if structural {
            for meta in crate::structural::STRUCTURAL_RULES {
                if !self.ids.contains(&meta.id) {
                    self.ids.push(meta.id);
                }
            }
        }
        self
    }

    /// Whether the structural measures are on.
    pub fn structural_enabled(&self) -> bool {
        self.structural
    }
}

impl Check for SlopChecker {
    fn rule_ids(&self) -> &[&str] {
        &self.ids
    }

    fn check(&self, document: &str, config: &Config) -> Vec<Finding> {
        let suppressions = if config.suppressions {
            Suppressions::parse(document)
        } else {
            Suppressions::new()
        };
        let english = config.language.english_spans(document);

        let mut findings = Vec::new();
        let mut offset = 0usize;
        let mut in_fence = false;

        for raw_line in document.split_inclusive('\n') {
            let line = raw_line.trim_end_matches(['\n', '\r']);
            let line_start = offset;
            offset += raw_line.len();

            let stripped = line.trim();
            if stripped.starts_with("```") || stripped.starts_with("~~~") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence || stripped.starts_with('>') || line.to_lowercase().contains(IGNORE_MARK) {
                continue;
            }
            if !config.language.offset_is_english(&english, line_start) {
                continue;
            }

            for (rule, patterns) in &self.compiled {
                if !config.rule_enabled(rule.id) || !config.severity_reportable(rule.severity) {
                    continue;
                }
                // A delegated rule has no pattern of its own; the whole-document
                // pass below reports it.
                if rule.is_delegated() {
                    continue;
                }
                // The first matching pattern in a rule reports once, matching
                // the scanner's long-standing behaviour.
                let Some(matched) = patterns.iter().find_map(|pattern| pattern.find(line)) else {
                    continue;
                };
                let span = Span::new(line_start + matched.start(), line_start + matched.end());
                if suppressions.suppresses(rule.id, span) {
                    continue;
                }
                findings.push(Finding {
                    rule_id: rule.id.to_string(),
                    label: rule.label.to_string(),
                    span,
                    matched: stripped.to_string(),
                    severity: rule.severity,
                    confidence: rule.confidence,
                    advice: rule.fix.to_string(),
                    replacement: None,
                });
            }
        }

        // The UK-English rules are owned by `prose-sanitiser-uk` and run over
        // the whole document, because sense disambiguation and the gazetteer
        // both need more context than one line.
        if RULES.iter().any(|rule| rule.is_delegated()) {
            for finding in uk::checker().check(document, config) {
                if !suppressions.suppresses(&finding.rule_id, finding.span)
                    && config
                        .language
                        .offset_is_english(&english, finding.span.start)
                {
                    findings.push(finding);
                }
            }
        }

        if self.structural {
            for finding in StructuralMetrics::measure(document).findings() {
                if config.rule_enabled(&finding.rule_id)
                    && config.severity_reportable(finding.severity)
                    && !suppressions.suppresses(&finding.rule_id, finding.span)
                {
                    findings.push(finding);
                }
            }
        }

        findings
    }
}

#[cfg(test)]
mod tests;
