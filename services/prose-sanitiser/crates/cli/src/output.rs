//! Output formats shared by the reporting binaries.
//!
//! Four renderings of the same [`Report`], chosen for what already consumes
//! them:
//!
//! | Format | Consumer |
//! |---|---|
//! | `text` | A person reading a terminal. rustc/clippy-style `file:line:col`. |
//! | `json` | The existing per-tool JSON report, unchanged. |
//! | `jsonl` | `jq`, ripgrep-style pipelines, streaming consumers. |
//! | `sarif` | GitHub code scanning, which accepts SARIF 2.1.0 and no other version. |
//!
//! `text` is the default everywhere, because a tool that prints JSON by default
//! is a tool people pipe through `head` and misread.

use clap::ValueEnum;
use prose_sanitiser_core::{to_pretty_json, Report};

/// How a binary should render its findings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum, Default)]
#[value(rename_all = "lower")]
pub enum OutputFormat {
    /// Human-readable, one line per finding.
    #[default]
    Text,
    /// The tool's own JSON report.
    Json,
    /// One JSON object per line.
    Jsonl,
    /// SARIF 2.1.0, for GitHub code scanning.
    Sarif,
}

impl OutputFormat {
    /// The wire form, matching the `--format` value.
    pub fn as_str(self) -> &'static str {
        match self {
            OutputFormat::Text => "text",
            OutputFormat::Json => "json",
            OutputFormat::Jsonl => "jsonl",
            OutputFormat::Sarif => "sarif",
        }
    }

    /// Whether this format writes a machine-readable document to stdout.
    ///
    /// Machine formats must own stdout completely: a progress line or a summary
    /// interleaved with SARIF makes the document unparseable.
    pub fn is_machine(self) -> bool {
        !matches!(self, OutputFormat::Text)
    }
}

/// Render `report` in `format`, or `None` when the binary lays it out itself.
///
/// `text` and `json` return `None`: the human layout differs per tool, and each
/// tool's `json` is its own long-standing report shape, which must not change.
/// Only `jsonl` and `sarif` are generic serialisations of a [`Report`].
pub fn render(report: &Report, format: OutputFormat) -> Option<String> {
    match format {
        OutputFormat::Text | OutputFormat::Json => None,
        OutputFormat::Jsonl => Some(report.to_jsonl().trim_end_matches('\n').to_string()),
        OutputFormat::Sarif => Some(to_pretty_json(&report.to_sarif())),
    }
}

/// A rustc-style `path:line:col: severity[rule]: message` line.
pub fn text_line(entry: &prose_sanitiser_core::ReportEntry) -> String {
    let location = if entry.line > 0 {
        format!("{}:{}:{}", entry.path, entry.line, entry.column.max(1))
    } else {
        entry.path.clone()
    };
    format!(
        "{location}: {}[{}]: {} ({})",
        entry.finding.severity.as_str(),
        entry.finding.rule_id,
        entry.finding.label,
        entry.finding.confidence.as_str()
    )
}

#[cfg(test)]
mod tests;
