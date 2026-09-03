//! The two shapes every detector in the workspace presents.
//!
//! Splitting inspection from mutation is what lets one implementation serve the
//! CLI, an editor language server and a SARIF exporter without any of them
//! reimplementing the rule:
//!
//! - [`Check`] reads a document and reports. It takes `&self` and `&str`, so it
//!   cannot mutate anything, and that is enforced by the signature rather than
//!   by convention.
//! - [`Fix`] turns findings into a [`Patch`] — an applyable description of the
//!   change, not the changed text. The caller decides whether to apply it.
//!
//! The blanket [`Fix::fix`] default derives the patch from each finding's own
//! [`Finding::to_edit`], so a checker that already sets `replacement` and an
//! honest [`crate::ConfidenceTier`] gets a correct fixer for free.

use crate::finding::{Config, Finding, Patch};

/// A rule, or a group of rules, that inspects text and reports findings.
///
/// Implementors must not mutate anything, perform I/O, or spawn processes:
/// checking is pure so it can run in an editor's hot path.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::{Check, ConfidenceTier, Config, Finding, Severity, Span};
///
/// struct TodoCheck;
///
/// impl Check for TodoCheck {
///     fn rule_ids(&self) -> &[&str] {
///         &["todo-marker"]
///     }
///
///     fn check(&self, document: &str, _config: &Config) -> Vec<Finding> {
///         document
///             .match_indices("TODO")
///             .map(|(start, matched)| Finding {
///                 rule_id: "todo-marker".to_string(),
///                 label: "Unresolved TODO".to_string(),
///                 span: Span::new(start, start + matched.len()),
///                 matched: matched.to_string(),
///                 severity: Severity::Low,
///                 confidence: ConfidenceTier::LowConfidenceJudgement,
///                 advice: "Resolve it or delete it.".to_string(),
///                 replacement: None,
///             })
///             .collect()
///     }
/// }
///
/// let findings = TodoCheck.check("a TODO here", &Config::new());
/// assert_eq!(findings.len(), 1);
/// assert_eq!(findings[0].span, Span::new(2, 6));
/// ```
pub trait Check {
    /// Every rule identifier this checker can emit.
    ///
    /// Used to honour [`Config::rule_enabled`] and to build the
    /// `runs[].tool.driver.rules[]` table a SARIF report needs.
    fn rule_ids(&self) -> &[&str];

    /// Inspect `document` and report what is there. Never mutates.
    fn check(&self, document: &str, config: &Config) -> Vec<Finding>;

    /// Inspect `document` with the default configuration.
    fn check_default(&self, document: &str) -> Vec<Finding> {
        self.check(document, &Config::new())
    }
}

/// A checker that can also describe how to repair what it found.
///
/// Implementing [`Fix`] does not make a rule auto-fixing: the per-finding
/// [`crate::ConfidenceTier`] still decides, so a report-only rule stays
/// report-only even here.
pub trait Fix: Check {
    /// Build an applyable patch from `findings`.
    ///
    /// The default derives it from each finding's own suggested replacement,
    /// dropping the ones the confidence tier and `config` forbid, and discarding
    /// overlaps so the result always applies cleanly.
    fn fix(&self, _document: &str, findings: &[Finding], config: &Config) -> Patch {
        Patch::from_edits(
            findings
                .iter()
                .filter_map(|finding| finding.to_edit(config)),
        )
    }

    /// Check `document` and return the patch, discarding the findings.
    ///
    /// The one-call shape for a caller that only wants the repair. It is a
    /// convenience over [`Fix::check_and_fix`], not a second implementation, so
    /// a rule cannot behave differently depending on which entry point is used.
    ///
    /// # Examples
    ///
    /// ```
    /// use prose_sanitiser_core::{
    ///     Check, ConfidenceTier, Config, Finding, Fix, Severity, Span,
    /// };
    ///
    /// struct StripTabs;
    ///
    /// impl Check for StripTabs {
    ///     fn rule_ids(&self) -> &[&str] {
    ///         &["tab"]
    ///     }
    ///
    ///     fn check(&self, document: &str, _config: &Config) -> Vec<Finding> {
    ///         document
    ///             .match_indices('\t')
    ///             .map(|(start, _)| Finding {
    ///                 rule_id: "tab".to_string(),
    ///                 label: "Tab character".to_string(),
    ///                 span: Span::new(start, start + 1),
    ///                 matched: "\t".to_string(),
    ///                 severity: Severity::Low,
    ///                 confidence: ConfidenceTier::CertainMechanical,
    ///                 advice: "Use spaces.".to_string(),
    ///                 replacement: Some("    ".to_string()),
    ///             })
    ///             .collect()
    ///     }
    /// }
    ///
    /// impl Fix for StripTabs {}
    ///
    /// let patch = StripTabs.fix_document("a\tb", &Config::new());
    /// assert_eq!(patch.apply("a\tb").unwrap(), "a    b");
    /// // The source is untouched: a patch is applyable, not applied.
    /// ```
    fn fix_document(&self, document: &str, config: &Config) -> Patch {
        self.check_and_fix(document, config).1
    }

    /// Check and fix in one pass, returning both halves.
    fn check_and_fix(&self, document: &str, config: &Config) -> (Vec<Finding>, Patch) {
        let findings = self.check(document, config);
        let patch = self.fix(document, &findings, config);
        (findings, patch)
    }
}
