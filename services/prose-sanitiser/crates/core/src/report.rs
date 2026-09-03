//! Machine-readable reporting: SARIF 2.1.0 and JSON Lines.
//!
//! A [`Finding`] says what a rule saw; a [`Report`] says where, in which file,
//! under which tool, against which version of which rule table. That extra
//! framing is what a CI system needs, and it is the whole of the difference
//! between the two layers.
//!
//! Two serialisations, chosen for what already consumes them:
//!
//! - **SARIF 2.1.0** ([`Report::to_sarif`]) is what GitHub code scanning
//!   ingests, and it accepts *only* 2.1.0. The rule table lives in
//!   `runs[].tool.driver.rules[]` separately from `runs[].results[]`, and every
//!   result carries `partialFingerprints` so re-running the tool on an
//!   unchanged file does not re-open closed alerts.
//! - **JSON Lines** ([`Report::to_jsonl`]) is the ripgrep and `typos`
//!   convention: one self-contained JSON object per line, streamable, and
//!   trivially greppable with `jq`.
//!
//! Both carry the confidence tier and the ruleset version, because a consumer
//! that cannot see the tier cannot tell a mechanical certainty from a
//! judgement call, and would be right to distrust the lot.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{
//!     ConfidenceTier, Finding, ReportEntry, Report, RuleMeta, Severity, Span, ToolMeta,
//! };
//!
//! const RULES: &[RuleMeta] = &[RuleMeta {
//!     id: "tier1-vocab",
//!     name: "Tier-1 banned vocabulary",
//!     description: "Vocabulary with a measured excess frequency in LLM output.",
//!     severity: Severity::High,
//!     confidence: ConfidenceTier::LowConfidenceJudgement,
//!     since: "2026-01-14",
//!     reviewed: "2026-09-03",
//!     help_uri: None,
//!     sources: &["https://doi.org/10.1126/sciadv.adt3813"],
//! }];
//!
//! let finding = Finding {
//!     rule_id: "tier1-vocab".to_string(),
//!     label: "Tier-1 banned vocabulary".to_string(),
//!     span: Span::new(2, 7),
//!     matched: "delve".to_string(),
//!     severity: Severity::High,
//!     confidence: ConfidenceTier::LowConfidenceJudgement,
//!     advice: "Use a plain word.".to_string(),
//!     replacement: None,
//! };
//!
//! let report = Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES)
//!     .with_ruleset_version("2026.09.03")
//!     .with_entries(vec![ReportEntry::new("post.md", 4, 3, finding)]);
//!
//! let sarif = report.to_sarif();
//! assert_eq!(sarif["version"], "2.1.0");
//! assert_eq!(sarif["runs"][0]["results"][0]["level"], "error");
//! assert!(report.to_jsonl().lines().count() == 1);
//! ```

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::finding::{ConfidenceTier, Finding, Severity};

/// The SARIF version GitHub code scanning accepts. It accepts no other.
pub const SARIF_VERSION: &str = "2.1.0";

/// The `$schema` URI for SARIF 2.1.0.
pub const SARIF_SCHEMA: &str =
    "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0.json";

/// Static documentation for one rule, as a SARIF `reportingDescriptor` needs it.
///
/// The two dates are the point of the struct. `since` records when the rule
/// entered the table; `reviewed` records when it was last re-checked against
/// its sources. A lexical marker whose `reviewed` date is two years stale is a
/// rule nobody has confirmed still holds, and the report should say so rather
/// than present it with the same authority as a codepoint classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuleMeta {
    /// Stable machine identifier, matching [`Finding::rule_id`].
    pub id: &'static str,
    /// Short human name.
    pub name: &'static str,
    /// What the rule looks for and why, in one or two sentences.
    pub description: &'static str,
    /// Default impact rating.
    pub severity: Severity,
    /// Whether a finding may be acted on without a human reading it.
    pub confidence: ConfidenceTier,
    /// ISO-8601 date the rule entered the table.
    pub since: &'static str,
    /// ISO-8601 date the rule was last re-checked against its sources.
    pub reviewed: &'static str,
    /// Documentation URI, if there is one.
    pub help_uri: Option<&'static str>,
    /// Evidence the rule rests on: papers, corpora, standards.
    pub sources: &'static [&'static str],
}

impl RuleMeta {
    /// Render as a SARIF `reportingDescriptor`.
    pub fn to_sarif(&self) -> Value {
        let mut descriptor = Map::new();
        descriptor.insert("id".into(), json!(self.id));
        descriptor.insert("name".into(), json!(self.name));
        descriptor.insert("shortDescription".into(), json!({ "text": self.name }));
        descriptor.insert(
            "fullDescription".into(),
            json!({ "text": self.description }),
        );
        descriptor.insert(
            "defaultConfiguration".into(),
            json!({ "level": sarif_level(self.severity) }),
        );
        if let Some(uri) = self.help_uri {
            descriptor.insert("helpUri".into(), json!(uri));
        }
        descriptor.insert(
            "properties".into(),
            json!({
                "confidence": self.confidence.as_str(),
                "severity": self.severity.as_str(),
                "since": self.since,
                "reviewed": self.reviewed,
                "sources": self.sources,
                "tags": ["prose", self.confidence.as_str()],
            }),
        );
        Value::Object(descriptor)
    }
}

/// The tool that produced a report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolMeta {
    /// Binary name, e.g. `slop-scan`.
    pub name: String,
    /// Semantic version of the binary.
    pub version: String,
    /// Project home page.
    pub information_uri: String,
}

impl ToolMeta {
    /// A tool descriptor pointing at the workspace repository.
    pub fn new(name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
            information_uri: "https://github.com/DreamLab-AI/agentbox".to_string(),
        }
    }

    /// Override the project home page.
    pub fn with_information_uri(mut self, uri: impl Into<String>) -> Self {
        self.information_uri = uri.into();
        self
    }
}

/// One finding, located in a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportEntry {
    /// Path as the tool was asked for it, used verbatim as the SARIF artifact URI.
    pub path: String,
    /// 1-based line. Zero means a whole-file aggregate with no line.
    pub line: usize,
    /// 1-based column.
    pub column: usize,
    /// The finding itself.
    pub finding: Finding,
    /// The source line, when the caller has it: SARIF snippets and the
    /// `primaryLocationLineHash` fingerprint both want it.
    pub snippet: Option<String>,
}

impl ReportEntry {
    /// Locate `finding` at `path:line:column`.
    pub fn new(path: impl Into<String>, line: usize, column: usize, finding: Finding) -> Self {
        Self {
            path: path.into(),
            line,
            column,
            finding,
            snippet: None,
        }
    }

    /// Attach the source line.
    pub fn with_snippet(mut self, snippet: impl Into<String>) -> Self {
        self.snippet = Some(snippet.into());
        self
    }

    /// A stable identity for this finding, independent of its byte offsets.
    ///
    /// Offsets shift whenever anything above them is edited, so fingerprinting
    /// them would re-open every alert below a one-word change. Hashing the rule,
    /// the path and the matched text instead keeps an alert stable across
    /// unrelated edits, which is what SARIF `partialFingerprints` is for.
    pub fn fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.finding.rule_id.as_bytes());
        hasher.update([0u8]);
        hasher.update(self.path.as_bytes());
        hasher.update([0u8]);
        hasher.update(self.finding.matched.as_bytes());
        let digest = hasher.finalize();
        digest[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Render as a SARIF `result`.
    fn to_sarif(&self, ruleset_version: &str) -> Value {
        let mut region = Map::new();
        if self.line > 0 {
            region.insert("startLine".into(), json!(self.line));
            region.insert("startColumn".into(), json!(self.column.max(1)));
        }
        if let Some(snippet) = &self.snippet {
            region.insert("snippet".into(), json!({ "text": snippet }));
        }

        let mut location = Map::new();
        location.insert(
            "artifactLocation".into(),
            json!({ "uri": self.path, "uriBaseId": "%SRCROOT%" }),
        );
        if !region.is_empty() {
            location.insert("region".into(), Value::Object(region));
        }

        let mut properties = Map::new();
        properties.insert("confidence".into(), json!(self.finding.confidence.as_str()));
        properties.insert("severity".into(), json!(self.finding.severity.as_str()));
        properties.insert("rulesetVersion".into(), json!(ruleset_version));
        properties.insert("advice".into(), json!(self.finding.advice));
        properties.insert(
            "autoFixable".into(),
            json!(self.finding.confidence.auto_fixable()),
        );
        if let Some(replacement) = &self.finding.replacement {
            properties.insert("replacement".into(), json!(replacement));
        }

        let mut result = Map::new();
        result.insert("ruleId".into(), json!(self.finding.rule_id));
        result.insert("level".into(), json!(sarif_level(self.finding.severity)));
        result.insert(
            "message".into(),
            json!({ "text": format!("{}: {}", self.finding.label, self.finding.advice) }),
        );
        result.insert(
            "locations".into(),
            json!([{ "physicalLocation": Value::Object(location) }]),
        );
        result.insert(
            "partialFingerprints".into(),
            json!({ "proseSanitiser/v1": self.fingerprint() }),
        );
        result.insert("properties".into(), Value::Object(properties));

        // A replacement is a SARIF fix only when the tier permits applying it.
        if let Some(replacement) = &self.finding.replacement {
            if self.finding.confidence.fixable_with_opt_in() {
                result.insert(
                    "fixes".into(),
                    json!([{
                        "description": { "text": self.finding.advice },
                        "artifactChanges": [{
                            "artifactLocation": { "uri": self.path },
                            "replacements": [{
                                "deletedRegion": {
                                    "byteOffset": self.finding.span.start,
                                    "byteLength": self.finding.span.len(),
                                },
                                "insertedContent": { "text": replacement },
                            }],
                        }],
                    }]),
                );
            }
        }

        Value::Object(result)
    }

    /// Render as one JSON Lines record.
    fn to_jsonl_value(&self, ruleset_version: &str) -> Value {
        json!({
            "path": self.path,
            "line": self.line,
            "column": self.column,
            "byte_start": self.finding.span.start,
            "byte_end": self.finding.span.end,
            "rule": self.finding.rule_id,
            "label": self.finding.label,
            "severity": self.finding.severity.as_str(),
            "confidence": self.finding.confidence.as_str(),
            "auto_fixable": self.finding.confidence.auto_fixable(),
            "matched": self.finding.matched,
            "advice": self.finding.advice,
            "replacement": self.finding.replacement,
            "ruleset_version": ruleset_version,
            "fingerprint": self.fingerprint(),
        })
    }
}

/// Map a [`Severity`] onto a SARIF `level`.
///
/// SARIF has four levels and this crate has three severities; `none` is
/// deliberately unused, because a finding worth reporting is never level none.
pub fn sarif_level(severity: Severity) -> &'static str {
    match severity {
        Severity::High => "error",
        Severity::Medium => "warning",
        Severity::Low => "note",
    }
}

/// A complete run: the tool, its rule table, and everything it found.
#[derive(Debug, Clone)]
pub struct Report {
    tool: ToolMeta,
    rules: &'static [RuleMeta],
    entries: Vec<ReportEntry>,
    ruleset_version: String,
}

impl Report {
    /// Start a report for `tool` documenting `rules`.
    pub fn new(tool: ToolMeta, rules: &'static [RuleMeta]) -> Self {
        Self {
            tool,
            rules,
            entries: Vec::new(),
            ruleset_version: "unversioned".to_string(),
        }
    }

    /// Record which version of the rule table produced these findings.
    pub fn with_ruleset_version(mut self, version: impl Into<String>) -> Self {
        self.ruleset_version = version.into();
        self
    }

    /// Attach the located findings.
    pub fn with_entries(mut self, entries: Vec<ReportEntry>) -> Self {
        self.entries = entries;
        self
    }

    /// Add one located finding.
    pub fn push(&mut self, entry: ReportEntry) {
        self.entries.push(entry);
    }

    /// The located findings.
    pub fn entries(&self) -> &[ReportEntry] {
        &self.entries
    }

    /// The rule table this run used.
    pub fn rules(&self) -> &[RuleMeta] {
        self.rules
    }

    /// The rule-table version.
    pub fn ruleset_version(&self) -> &str {
        &self.ruleset_version
    }

    /// Render the whole run as a SARIF 2.1.0 log.
    ///
    /// Only the rules that actually fired are emitted in the driver table:
    /// GitHub renders every listed rule, and a table of a hundred silent rules
    /// buries the handful that matter.
    pub fn to_sarif(&self) -> Value {
        let fired: Vec<&RuleMeta> = self
            .rules
            .iter()
            .filter(|rule| {
                self.entries
                    .iter()
                    .any(|entry| entry.finding.rule_id == rule.id)
            })
            .collect();

        json!({
            "$schema": SARIF_SCHEMA,
            "version": SARIF_VERSION,
            "runs": [{
                "tool": {
                    "driver": {
                        "name": self.tool.name,
                        "version": self.tool.version,
                        "informationUri": self.tool.information_uri,
                        "rules": fired.iter().map(|rule| rule.to_sarif()).collect::<Vec<_>>(),
                        "properties": { "rulesetVersion": self.ruleset_version },
                    }
                },
                "results": self
                    .entries
                    .iter()
                    .map(|entry| entry.to_sarif(&self.ruleset_version))
                    .collect::<Vec<_>>(),
            }]
        })
    }

    /// Render the findings as JSON Lines: one object per line, no trailing blank.
    pub fn to_jsonl(&self) -> String {
        let mut out = String::new();
        for entry in &self.entries {
            let value = entry.to_jsonl_value(&self.ruleset_version);
            out.push_str(&serde_json::to_string(&value).expect("serde_json values serialise"));
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests;
