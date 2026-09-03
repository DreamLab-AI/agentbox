//! The vocabulary a scanner uses to describe what it found.
//!
//! Two axes, kept deliberately orthogonal, following the split Semgrep and
//! clippy's lint groups both make:
//!
//! - [`Severity`] rates **impact**: how strongly the tell signals AI authorship,
//!   and therefore where an editor should spend effort.
//! - [`ConfidenceTier`] rates **whether the pattern is right**, and is the only
//!   thing that may gate an automatic fix.
//!
//! Conflating the two is how a linter ends up "correcting" *a driving licence*
//! or *the gas meter*: a rule can be high-impact and still be a guess.

use crate::fixability::Fixability;
use crate::language::LanguageFilter;

/// How strongly a tell signals AI authorship.
///
/// Severity follows the Tier-1/Tier-2 weighting in the prose-sanitiser skill,
/// so a report says where to spend effort rather than treating every hit alike.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    High,
    Medium,
    Low,
}

impl Severity {
    /// The lowercase wire form used in JSON reports and CLI output.
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::High => "high",
            Severity::Medium => "medium",
            Severity::Low => "low",
        }
    }

    /// Parse the wire form, returning `None` for anything unrecognised.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "high" => Some(Severity::High),
            "medium" => Some(Severity::Medium),
            "low" => Some(Severity::Low),
            _ => None,
        }
    }

    /// The weight used for the slop score.
    pub fn weight(self) -> u32 {
        match self {
            Severity::High => 3,
            Severity::Medium => 2,
            Severity::Low => 1,
        }
    }

    /// Rank, matching the Python `order.index(...)` comparisons.
    pub fn rank(self) -> usize {
        match self {
            Severity::High => 0,
            Severity::Medium => 1,
            Severity::Low => 2,
        }
    }
}

/// Whether a finding is safe to act on without a human reading it.
///
/// This is the auto-fix gate, and it is deliberately conservative: a rule earns
/// [`ConfidenceTier::CertainMechanical`] only when the fix is verifiable by
/// diffing the output, never because the rule is usually right.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ConfidenceTier {
    /// Deterministic codepoint or container-structure classification: invisible
    /// Unicode, embedded metadata, homoglyphs. Always auto-fixable, and the
    /// result is verifiable by diff.
    CertainMechanical,
    /// Unconditional dialect pairs with no sense or proper-noun collision.
    /// Auto-fixable only behind an explicit opt-in such as `--write`.
    HighConfidenceStylistic,
    /// Sense-dependent pairs, slop phrasing, organisation-adjacent tokens.
    /// **Never** auto-fixed; report only.
    LowConfidenceJudgement,
}

impl ConfidenceTier {
    /// The lowercase wire form used in JSON reports.
    pub fn as_str(self) -> &'static str {
        match self {
            ConfidenceTier::CertainMechanical => "certain-mechanical",
            ConfidenceTier::HighConfidenceStylistic => "high-confidence-stylistic",
            ConfidenceTier::LowConfidenceJudgement => "low-confidence-judgement",
        }
    }

    /// Parse the wire form, returning `None` for anything unrecognised.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "certain-mechanical" => Some(ConfidenceTier::CertainMechanical),
            "high-confidence-stylistic" => Some(ConfidenceTier::HighConfidenceStylistic),
            "low-confidence-judgement" => Some(ConfidenceTier::LowConfidenceJudgement),
            _ => None,
        }
    }

    /// Whether a fix for this tier may be applied without an explicit opt-in.
    pub fn auto_fixable(self) -> bool {
        matches!(self, ConfidenceTier::CertainMechanical)
    }

    /// Whether a fix for this tier may be applied at all, opt-in included.
    pub fn fixable_with_opt_in(self) -> bool {
        !matches!(self, ConfidenceTier::LowConfidenceJudgement)
    }
}

/// A half-open byte range into the document a finding came from.
///
/// Byte offsets, not character indices: they address the source exactly and
/// compose with [`Edit`] without a second pass over the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Span {
    /// Inclusive start byte offset.
    pub start: usize,
    /// Exclusive end byte offset.
    pub end: usize,
}

impl Span {
    /// Build a span, panicking if `end` precedes `start`.
    pub fn new(start: usize, end: usize) -> Self {
        assert!(start <= end, "span start must not exceed its end");
        Self { start, end }
    }

    /// Length of the span in bytes.
    pub fn len(&self) -> usize {
        self.end - self.start
    }

    /// Whether the span covers no bytes.
    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    /// Whether this span shares any byte with `other`.
    pub fn overlaps(&self, other: &Span) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// Borrow the covered bytes out of `source`, if the span is in range.
    pub fn slice<'a>(&self, source: &'a str) -> Option<&'a str> {
        source.get(self.start..self.end)
    }
}

/// One thing a scanner noticed, at one place, with one suggested remedy.
///
/// A finding never carries pre-applied text. The suggested replacement stays
/// data (`replacement`), so the caller decides whether, and in what order, to
/// apply it — the pattern Vale's `Action` uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    /// Stable machine identifier for the rule, e.g. `us-spelling`.
    pub rule_id: String,
    /// One-line human label for the rule.
    pub label: String,
    /// Where in the document the finding sits.
    pub span: Span,
    /// The matched source text.
    pub matched: String,
    /// How strongly this signals AI authorship.
    pub severity: Severity,
    /// Whether it is safe to act on without a human reading it.
    pub confidence: ConfidenceTier,
    /// What an editor should do about it, in prose.
    pub advice: String,
    /// The mechanical replacement, when one is unambiguous. `None` means the
    /// finding is report-only however the caller is configured.
    pub replacement: Option<String>,
}

/// A finding plus its fixability, for the rules that need to say more than the
/// tier implies.
///
/// [`Finding`] keeps its exact field set so every existing struct literal in
/// the workspace still compiles, and fixability is carried alongside rather
/// than inside it. The overwhelming majority of rules never touch this: the
/// tier implies the answer, and [`Finding::fixability`] derives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingFixability {
    /// The rule this override applies to.
    pub rule_id: String,
    /// What the rule says about repairability.
    pub fixability: Fixability,
}

impl Finding {
    /// What this finding says about repairability.
    ///
    /// Derived from the confidence tier unless `config` carries an override for
    /// the rule. Most rules never need one; see [`crate::Fixability`] for the
    /// case that does.
    pub fn fixability(&self, config: &Config) -> Fixability {
        config
            .fixability_for(&self.rule_id)
            .unwrap_or_else(|| Fixability::default_for(self.confidence))
    }

    /// Whether this finding can be turned into an [`Edit`] under `config`.
    ///
    /// Consults fixability, not the tier directly. For every rule that does not
    /// declare one the two agree by construction, so this is the same answer it
    /// has always given; for a rule that declares `NoFixExists` it is the only
    /// answer that is true.
    pub fn is_fixable(&self, config: &Config) -> bool {
        if self.replacement.is_none() {
            return false;
        }
        let fixability = self.fixability(config);
        if fixability.auto_fixable() {
            return true;
        }
        config.write && fixability.fixable_with_opt_in()
    }

    /// The edit this finding implies, if it is fixable under `config`.
    pub fn to_edit(&self, config: &Config) -> Option<Edit> {
        if !self.is_fixable(config) {
            return None;
        }
        self.replacement.as_ref().map(|replacement| Edit {
            span: self.span,
            replacement: replacement.clone(),
            rule_id: self.rule_id.clone(),
        })
    }
}

/// One replacement of a byte range, described rather than applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    /// The range to replace.
    pub span: Span,
    /// What to put there.
    pub replacement: String,
    /// The rule that asked for it, for attribution in a diff.
    pub rule_id: String,
}

/// An ordered, non-overlapping set of [`Edit`]s: the output of a fix pass.
///
/// A patch is applyable but not applied. Building one never mutates the source,
/// which is what lets the same core serve a CLI, an LSP and a SARIF exporter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Patch {
    edits: Vec<Edit>,
}

impl Patch {
    /// An empty patch.
    pub fn new() -> Self {
        Self::default()
    }

    /// Collect `edits`, dropping any that overlap one already accepted.
    ///
    /// Edits are sorted by start offset. Where two rules want the same bytes
    /// the earlier-starting one wins and the other is discarded, so applying a
    /// patch can never interleave two rules into corrupt output.
    pub fn from_edits(edits: impl IntoIterator<Item = Edit>) -> Self {
        let mut candidates: Vec<Edit> = edits.into_iter().collect();
        candidates.sort_by_key(|edit| (edit.span.start, edit.span.end));
        let mut accepted: Vec<Edit> = Vec::with_capacity(candidates.len());
        for edit in candidates {
            let clashes = accepted
                .last()
                .is_some_and(|previous| previous.span.overlaps(&edit.span));
            if !clashes {
                accepted.push(edit);
            }
        }
        Self { edits: accepted }
    }

    /// The accepted edits, in ascending source order.
    pub fn edits(&self) -> &[Edit] {
        &self.edits
    }

    /// Whether the patch would change anything.
    pub fn is_empty(&self) -> bool {
        self.edits.is_empty()
    }

    /// How many edits the patch carries.
    pub fn len(&self) -> usize {
        self.edits.len()
    }

    /// Apply the patch to `source`, returning the rewritten text.
    ///
    /// Returns `None` if any edit's span falls outside `source` or straddles a
    /// UTF-8 boundary, so a stale patch can never produce mojibake.
    pub fn apply(&self, source: &str) -> Option<String> {
        let mut out = String::with_capacity(source.len());
        let mut cursor = 0usize;
        for edit in &self.edits {
            if edit.span.start < cursor {
                return None;
            }
            out.push_str(source.get(cursor..edit.span.start)?);
            // Validate the replaced range is itself a well-formed boundary.
            source.get(edit.span.start..edit.span.end)?;
            out.push_str(&edit.replacement);
            cursor = edit.span.end;
        }
        out.push_str(source.get(cursor..)?);
        Some(out)
    }
}

/// How a check or fix pass should behave.
///
/// The defaults are the safe ones: report everything, rewrite nothing. A caller
/// opts into mutation explicitly, and even then only the tiers
/// [`ConfidenceTier::fixable_with_opt_in`] allows are touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Permit fixes for [`ConfidenceTier::HighConfidenceStylistic`] findings.
    /// Mechanical fixes do not need it; judgement calls are never enabled by it.
    pub write: bool,
    /// Findings below this severity are dropped from the report.
    pub min_severity: Severity,
    /// Use Oxford `-ize` spelling rather than the `-ise` default. The always-ise
    /// and always-yse sets are unaffected either way.
    pub oxford: bool,
    /// Rule identifiers to skip entirely.
    pub disabled_rules: Vec<String>,
    /// Whether English-only rules should be held back on non-English spans.
    ///
    /// Enabled by default, and safe by construction: the filter treats anything
    /// it cannot classify confidently as English, so it never silently disables
    /// a rule. See [`crate::LanguageFilter`].
    pub language: LanguageFilter,
    /// Whether the HTML-comment suppression directives are honoured.
    ///
    /// On by default. Turning it off is how a CI job audits what a repository
    /// has been suppressing. See [`crate::Suppressions`].
    pub suppressions: bool,
    /// Per-rule fixability overrides, for rules whose repairability does not
    /// follow from their confidence tier.
    ///
    /// Populated from the rule tables rather than by a user: it is a property
    /// of the rule, not a preference. See [`crate::Fixability`].
    pub fixability_overrides: Vec<FindingFixability>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            write: false,
            min_severity: Severity::Low,
            oxford: false,
            disabled_rules: Vec::new(),
            language: LanguageFilter::default(),
            suppressions: true,
            fixability_overrides: Vec::new(),
        }
    }
}

impl Config {
    /// A default configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Enable opt-in stylistic fixes.
    pub fn with_write(mut self, write: bool) -> Self {
        self.write = write;
        self
    }

    /// Drop findings below `severity`.
    pub fn with_min_severity(mut self, severity: Severity) -> Self {
        self.min_severity = severity;
        self
    }

    /// Select Oxford `-ize` spelling.
    pub fn with_oxford(mut self, oxford: bool) -> Self {
        self.oxford = oxford;
        self
    }

    /// Disable one rule by identifier.
    pub fn without_rule(mut self, rule_id: impl Into<String>) -> Self {
        self.disabled_rules.push(rule_id.into());
        self
    }

    /// Set the language pre-filter.
    pub fn with_language(mut self, language: LanguageFilter) -> Self {
        self.language = language;
        self
    }

    /// Scan every span, whatever language it reads as.
    pub fn without_language_filter(mut self) -> Self {
        self.language = LanguageFilter::disabled();
        self
    }

    /// Choose whether the HTML-comment suppression directives are honoured.
    pub fn with_suppressions(mut self, suppressions: bool) -> Self {
        self.suppressions = suppressions;
        self
    }

    /// Declare that `rule_id`'s repairability does not follow from its tier.
    pub fn with_fixability(mut self, rule_id: impl Into<String>, fixability: Fixability) -> Self {
        let rule_id = rule_id.into();
        self.fixability_overrides
            .retain(|entry| entry.rule_id != rule_id);
        self.fixability_overrides.push(FindingFixability {
            rule_id,
            fixability,
        });
        self
    }

    /// Load a table of declared overrides.
    ///
    /// Called once with the rules whose repairability does not follow from
    /// their tier, so no individual caller has to know which those are.
    ///
    /// `RuleMeta` deliberately does not carry the field itself. It is built as
    /// a `const` array literal in four separate crates, and Rust has no default
    /// field values, so adding one would break every one of those literals —
    /// the opposite of an additive change. A side table costs one indirection
    /// and breaks nothing.
    pub fn with_fixability_table(mut self, overrides: &[(&str, Fixability)]) -> Self {
        for (rule_id, fixability) in overrides {
            self = self.with_fixability(*rule_id, *fixability);
        }
        self
    }

    /// The declared fixability for `rule_id`, if it differs from its tier's.
    pub fn fixability_for(&self, rule_id: &str) -> Option<Fixability> {
        self.fixability_overrides
            .iter()
            .find(|entry| entry.rule_id == rule_id)
            .map(|entry| entry.fixability)
    }

    /// Whether `rule_id` should run at all.
    pub fn rule_enabled(&self, rule_id: &str) -> bool {
        !self.disabled_rules.iter().any(|id| id == rule_id)
    }

    /// Whether a finding of `severity` survives the report threshold.
    pub fn severity_reportable(&self, severity: Severity) -> bool {
        severity.rank() <= self.min_severity.rank()
    }
}

#[cfg(test)]
mod tests;
