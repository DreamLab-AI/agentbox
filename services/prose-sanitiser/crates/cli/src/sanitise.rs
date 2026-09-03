//! The umbrella pass: every layer over one tree, with the tier deciding.
//!
//! The individual binaries each own one layer, which means a writer who wants
//! their document checked has to know which four to run and in which order.
//! `sanitise` is the single entry point: it classifies each file, runs the
//! layers that apply to it, and reports everything on one confidence scale.
//!
//! # The tier policy
//!
//! One rule, applied everywhere:
//!
//! | Tier | What `sanitise` does |
//! |---|---|
//! | `certain-mechanical` | Auto-fixed under `--fix`. Invisible Unicode, smuggled payloads, homoglyphs; the change is verifiable by diff |
//! | `high-confidence-stylistic` | Fixed only under `--fix --write`. Unconditional dialect pairs |
//! | `low-confidence-judgement` | **Never** fixed. Slop phrasing, sense-dependent spelling, organisation-adjacent tokens |
//!
//! Report-only is the default. Nothing is rewritten unless `--fix` is passed,
//! and even then the tier decides, not the flag.
//!
//! # What it cannot do
//!
//! Image and container provenance is reported, never rewritten here: stripping
//! a JUMBF manifest is byte surgery on a specific format, and `clean-image` and
//! `clean-file` own it. `sanitise` says what it found and which tool to run.
//!
//! Statistical sampling watermarks are out of scope for every layer. Nothing in
//! this crate can detect or remove one.

use std::path::{Path, PathBuf};

use prose_sanitiser_core::{
    classify_finding_confidence, ConfidenceTier, Config, Finding, Fixability, Patch, ReportEntry,
    RuleMeta, Severity, Span,
};

use crate::dispatch::{classify, Kind};
use crate::exit;

/// Rule identifier for provenance metadata found in an image or container.
pub const RULE_MEDIA_PROVENANCE: &str = "media-provenance";

/// Rules whose repairability does not follow from their confidence tier.
///
/// Exactly one so far. `media-c2pa-soft-binding` detects a C2PA soft-binding
/// assertion, and the detection is as certain as any in the workspace: the
/// assertion is in the manifest or it is not. But **no repair exists** — the
/// watermark it points at lives in the pixels, out of reach of the container
/// surgery this tool does, and stripping the manifest does not remove a durable
/// Content Credential because the cloud repository still resolves it.
///
/// Before [`Fixability`] existed, the only way to stop that being auto-fixed
/// was to file it as a low-confidence judgement call, which made the crate's
/// most reliable detection wear its least reliable label. This is the table
/// that lets the tier tell the truth and the fix still never happen.
pub const FIXABILITY_OVERRIDES: &[(&str, Fixability)] =
    &[("media-c2pa-soft-binding", Fixability::NoFixExists)];

/// A configuration with every declared fixability override applied.
///
/// Every entry point that builds findings from more than one crate should start
/// here, so a rule that says no repair exists is honoured wherever it surfaces.
pub fn configure(base: Config) -> Config {
    base.with_fixability_table(FIXABILITY_OVERRIDES)
}

/// File extensions the text layers read, beyond what `dispatch` calls text.
///
/// Markdown and HTML classify as containers because they can carry front-matter
/// and generator metadata, but their bodies are prose and the prose layers
/// belong on them.
pub const PROSE_CONTAINER_EXTS: &[&str] = &["md", "markdown", "mdx", "html", "htm"];

/// What one file's pass produced.
pub struct FileOutcome {
    /// The file, as the caller named it.
    pub path: PathBuf,
    /// Which pipeline claimed it.
    pub kind: Kind,
    /// Everything every applicable layer reported.
    pub findings: Vec<Finding>,
    /// The text as read, when a text layer ran. `None` for binary formats.
    pub text: Option<String>,
}

impl FileOutcome {
    /// Findings at or above `floor`.
    pub fn reportable(&self, config: &Config) -> Vec<&Finding> {
        self.findings
            .iter()
            .filter(|finding| config.severity_reportable(finding.severity))
            .collect()
    }

    /// The located findings a SARIF or JSON Lines report needs.
    pub fn entries(&self, config: &Config) -> Vec<ReportEntry> {
        let label = self.path.display().to_string();
        self.reportable(config)
            .into_iter()
            .map(|finding| {
                let (line, column) = match &self.text {
                    Some(text) => line_and_column(text, finding.span.start),
                    None => (0, 0),
                };
                ReportEntry::new(label.clone(), line, column, finding.clone()).with_config(config)
            })
            .collect()
    }

    /// The patch the tier policy permits under `config`.
    ///
    /// Empty for a binary format: this pass never rewrites image or container
    /// bytes, whatever the tier says.
    pub fn patch(&self, config: &Config) -> Patch {
        if self.text.is_none() {
            return Patch::new();
        }
        Patch::from_edits(
            self.findings
                .iter()
                .filter(|finding| finding.rule_id != RULE_MEDIA_PROVENANCE)
                .filter_map(|finding| finding.to_edit(config)),
        )
    }

    /// How many findings sit in each tier, for the summary line.
    pub fn tier_counts(&self, config: &Config) -> [usize; 3] {
        let mut counts = [0usize; 3];
        for finding in self.reportable(config) {
            let slot = match finding.confidence {
                ConfidenceTier::CertainMechanical => 0,
                ConfidenceTier::HighConfidenceStylistic => 1,
                ConfidenceTier::LowConfidenceJudgement => 2,
            };
            counts[slot] += 1;
        }
        counts
    }
}

/// 1-based line and column for a byte offset.
pub fn line_and_column(text: &str, offset: usize) -> (usize, usize) {
    let clamped = offset.min(text.len());
    let before = &text[..clamped];
    let line = before.matches('\n').count() + 1;
    let column = before
        .rfind('\n')
        .map(|index| before[index + 1..].chars().count())
        .unwrap_or_else(|| before.chars().count())
        + 1;
    (line, column)
}

/// Whether the prose layers should run over a file of this kind and extension.
pub fn is_prose(path: &Path, kind: Kind) -> bool {
    if kind == Kind::Text {
        return true;
    }
    if kind != Kind::Container {
        return false;
    }
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .is_some_and(|ext| PROSE_CONTAINER_EXTS.contains(&ext.as_str()))
}

/// Turn one media inspection string into a finding.
///
/// The media scanners report prose strings rather than typed rules, so a SARIF
/// consumer has no way to key a result to a `reportingDescriptor` on its own.
/// `prose-sanitiser-media` publishes
/// [`rule_for_finding`](prose_sanitiser_media::rule_for_finding) as that bridge:
/// a substring match in specificity order, tested against the strings its
/// scanners actually emit. It returns `None` for structural notes — a malformed
/// container, an unsupported format, a part count — which are observations
/// rather than rules, and those fall back to [`RULE_MEDIA_PROVENANCE`].
///
/// Where the media crate names a rule, its severity and tier are used verbatim.
/// It owns those decisions, and one is worth knowing about:
/// `media-c2pa-soft-binding` is `low-confidence-judgement` not because the
/// detection is weak — the assertion is either in the manifest or it is not —
/// but because **no fix exists**. The watermark is in the pixels, out of reach
/// of container surgery. The tier is being used to mean "never auto-fix", which
/// is the closest the three-tier vocabulary comes to saying so.
pub fn media_finding(note: &str) -> Finding {
    if let Some(meta) = prose_sanitiser_media::rule_for_finding(note) {
        return Finding {
            rule_id: meta.id.to_string(),
            label: meta.name.to_string(),
            span: Span::new(0, 0),
            matched: note.to_string(),
            severity: meta.severity,
            confidence: meta.confidence,
            advice: format!(
                "{} Run clean-image or clean-file to strip it: this pass reports container \
                 metadata and never rewrites image or container bytes.",
                meta.description
            ),
            replacement: None,
        };
    }

    // No named rule: a structural observation about the container. Bucket it
    // with the classifier the inspect binaries print, and keep it report-only.
    let bucket = classify_finding_confidence(note);
    Finding {
        rule_id: RULE_MEDIA_PROVENANCE.to_string(),
        label: format!("provenance metadata ({bucket})"),
        span: Span::new(0, 0),
        matched: note.to_string(),
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        advice: "An observation about the container rather than a named rule. This pass \
             reports container metadata; it never rewrites image or container bytes."
            .to_string(),
        replacement: None,
    }
}

/// Every rule any layer of the umbrella pass can emit.
///
/// Built from the four crates that own rules, so a finding always reaches a
/// SARIF `reportingDescriptor` carrying the tier, dates and sources its own
/// crate documented rather than this crate's paraphrase of them. Leaked once per
/// process, because a driver table is `&'static` by the time it reaches
/// [`prose_sanitiser_core::Report`] and the process needs it until it exits.
pub fn all_rule_meta() -> &'static [RuleMeta] {
    use std::sync::OnceLock;
    static META: OnceLock<Vec<RuleMeta>> = OnceLock::new();
    META.get_or_init(|| {
        let mut meta: Vec<RuleMeta> = prose_sanitiser_slop::rules::rule_meta().to_vec();
        for table in [
            prose_sanitiser_unicode::RULES,
            prose_sanitiser_media::RULES,
            MEDIA_FALLBACK_RULES,
        ] {
            for rule in table {
                if !meta.iter().any(|seen| seen.id == rule.id) {
                    meta.push(*rule);
                }
            }
        }
        meta
    })
}

/// The catalogue entry for a media observation with no named rule.
const MEDIA_FALLBACK_RULES: &[RuleMeta] = &[RuleMeta {
    id: RULE_MEDIA_PROVENANCE,
    name: "Container provenance observation",
    description: "A note from an image or container scanner that maps to no named media rule: a malformed container, an unsupported format, a part count. An observation, not a rule.",
    severity: Severity::Low,
    confidence: ConfidenceTier::LowConfidenceJudgement,
    since: "2026-09-03",
    reviewed: "2026-09-03",
    help_uri: None,
    sources: &[],
}];

/// Read a file as text, or report why not.
pub fn read_text(path: &Path) -> Result<String, crate::common::CliError> {
    let raw = std::fs::read(path).map_err(|error| {
        crate::common::CliError::new(
            exit::ERROR,
            format!("cannot read {}: {error}", path.display()),
        )
    })?;
    Ok(prose_sanitiser_core::surrogate::decode_ignore(&raw))
}

/// Classify `path`, defaulting to text when the bytes cannot be read.
pub fn kind_of(path: &Path) -> Result<Kind, crate::common::CliError> {
    classify(path).map_err(|error| {
        crate::common::CliError::new(
            exit::ERROR,
            format!("cannot read {}: {error}", path.display()),
        )
    })
}

#[cfg(test)]
mod tests;
