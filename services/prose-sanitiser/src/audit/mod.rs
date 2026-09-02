//! Aggregate AI-provenance audits over a directory tree or a website.
//!
//! Both audits normalise every file/URL into the same per-item shape so a
//! single aggregate summary can be computed and rendered consistently.

pub mod website;

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::common::surrogate;
use crate::common::{classify_finding_confidence, CONFIDENCE_LEVELS};
use crate::container::inspect_container;
use crate::dispatch::{classify, Kind};
use crate::image::inspect_image;
use crate::text::{inspect_text, TextInspectReport};

/// Layer A space homoglyphs are weaker context than invisible carriers.
pub fn text_hit_confidence(kind: &str) -> &'static str {
    if kind == "space" {
        "informational"
    } else {
        "probable"
    }
}

/// Flatten a text report into finding strings plus confidence labels.
pub fn text_findings(report: &TextInspectReport) -> (Vec<String>, Vec<String>, usize) {
    let mut findings = Vec::with_capacity(report.hits.len());
    let mut confidences = Vec::with_capacity(report.hits.len());
    for hit in &report.hits {
        confidences.push(text_hit_confidence(hit.kind).to_string());
        findings.push(format!(
            "layer-a [{}] {} x{}",
            hit.kind, hit.label, hit.count
        ));
    }
    (findings, confidences, report.suspicious_total)
}

fn item(
    path: &str,
    kind: &str,
    has_c2pa: bool,
    has_ai: bool,
    suspicious: usize,
    findings: Vec<String>,
    confidence: Vec<String>,
    notes: Vec<String>,
) -> Value {
    let mut map = Map::new();
    map.insert("path".into(), json!(path));
    map.insert("kind".into(), json!(kind));
    map.insert("has_c2pa".into(), json!(has_c2pa));
    map.insert("has_ai_metadata".into(), json!(has_ai));
    map.insert("suspicious_total".into(), json!(suspicious));
    map.insert("findings".into(), json!(findings));
    map.insert("confidence".into(), json!(confidence));
    map.insert("notes".into(), json!(notes));
    Value::Object(map)
}

/// Inspect one local file and return a normalised audit item.
pub fn scan_file(path: &Path, display_name: Option<&str>) -> Value {
    let name = display_name
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string());
    let kind = match classify(path) {
        Ok(kind) => kind,
        Err(error) => {
            return json!({"path": name, "kind": "text", "error": error.to_string()});
        }
    };

    match kind {
        Kind::Text => {
            let data = match std::fs::read(path) {
                Ok(data) => data,
                Err(error) => {
                    return json!({"path": name, "kind": "text", "error": error.to_string()})
                }
            };
            let report = inspect_text(&surrogate::decode(&data), false, false);
            let (findings, confidence, suspicious) = text_findings(&report);
            item(
                &name, "text", false, false, suspicious, findings, confidence, report.notes,
            )
        }
        Kind::Image => match inspect_image(path, None) {
            Ok(report) => {
                let confidence = report
                    .findings
                    .iter()
                    .map(|finding| classify_finding_confidence(finding).to_string())
                    .collect();
                item(
                    &name,
                    &report.format,
                    report.has_c2pa,
                    report.has_ai_metadata,
                    0,
                    report.findings,
                    confidence,
                    report.notes,
                )
            }
            Err(error) => json!({"path": name, "kind": "image", "error": error.to_string()}),
        },
        Kind::Container => match inspect_container(path) {
            Ok(report) => {
                let mut findings = report.findings.clone();
                let mut confidence: Vec<String> = report
                    .findings
                    .iter()
                    .map(|finding| classify_finding_confidence(finding).to_string())
                    .collect();
                let mut suspicious = 0;

                // Text-bearing containers also get a Layer A scan of their
                // visible text, mirroring the skill's container + Layer A flow.
                if matches!(report.format.as_str(), "html" | "markdown") {
                    let data = std::fs::read(path).unwrap_or_default();
                    if !data.is_empty() {
                        let text_report = inspect_text(&surrogate::decode(&data), false, false);
                        let (extra, extra_confidence, total) = text_findings(&text_report);
                        findings.extend(extra);
                        confidence.extend(extra_confidence);
                        suspicious = total;
                    }
                }
                item(
                    &name,
                    &report.format,
                    report.has_c2pa,
                    report.has_ai_metadata,
                    suspicious,
                    findings,
                    confidence,
                    report.notes,
                )
            }
            Err(error) => json!({"path": name, "kind": "container", "error": error.to_string()}),
        },
    }
}

/// A file is actionable when it has a confirmed/probable finding or C2PA.
pub fn is_actionable(item: &Value) -> bool {
    if item
        .get("has_c2pa")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    item.get("confidence")
        .and_then(Value::as_array)
        .map(|levels| {
            levels.iter().any(|level| {
                matches!(level.as_str(), Some("confirmed") | Some("probable"))
            })
        })
        .unwrap_or(false)
}

/// Build the summary block shared by the directory and website audits.
pub fn aggregate(files: &[Value]) -> Value {
    let mut by_kind = Map::new();
    let mut with_c2pa = 0u64;
    let mut with_ai = 0u64;
    let mut with_suspicious_text = 0u64;
    let mut actionable = 0u64;
    let mut by_confidence: Vec<(&str, u64)> =
        CONFIDENCE_LEVELS.iter().map(|level| (*level, 0)).collect();

    for entry in files {
        let kind = entry
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("error")
            .to_string();
        let count = by_kind
            .get(&kind)
            .and_then(Value::as_u64)
            .unwrap_or(0);
        by_kind.insert(kind, json!(count + 1));

        if entry.get("has_c2pa").and_then(Value::as_bool).unwrap_or(false) {
            with_c2pa += 1;
        }
        if entry
            .get("has_ai_metadata")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            with_ai += 1;
        }
        if entry
            .get("suspicious_total")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0
        {
            with_suspicious_text += 1;
        }
        if let Some(levels) = entry.get("confidence").and_then(Value::as_array) {
            for level in levels {
                if let Some(name) = level.as_str() {
                    if let Some(slot) = by_confidence.iter_mut().find(|(key, _)| *key == name) {
                        slot.1 += 1;
                    }
                }
            }
        }
        if is_actionable(entry) {
            actionable += 1;
        }
    }

    let mut confidence_map = Map::new();
    for (level, count) in by_confidence {
        confidence_map.insert(level.to_string(), json!(count));
    }

    json!({
        "total": files.len(),
        "by_kind": Value::Object(by_kind),
        "with_c2pa": with_c2pa,
        "with_ai_metadata": with_ai,
        "with_suspicious_text": with_suspicious_text,
        "actionable_files": actionable,
        "findings_by_confidence": Value::Object(confidence_map),
    })
}

/// Render a JSON object the way Python renders a `dict` in an f-string.
fn python_dict(value: &Value) -> String {
    let Some(map) = value.as_object() else {
        return value.to_string();
    };
    let body: Vec<String> = map
        .iter()
        .map(|(key, value)| format!("'{key}': {value}"))
        .collect();
    format!("{{{}}}", body.join(", "))
}

/// The shared plain-text rendering for the audit binaries.
pub fn human_report(files: &[Value], summary: &Value, extra_header: &[(String, String)]) -> String {
    let mut lines: Vec<String> = extra_header
        .iter()
        .map(|(key, value)| format!("{key}: {value}"))
        .collect();
    lines.push(format!("Files scanned: {}", summary["total"]));
    lines.push(format!("By kind: {}", python_dict(&summary["by_kind"])));
    lines.push(format!("With C2PA: {}", summary["with_c2pa"]));
    lines.push(format!("With AI metadata: {}", summary["with_ai_metadata"]));
    lines.push(format!(
        "With suspicious text: {}",
        summary["with_suspicious_text"]
    ));
    lines.push(format!("Actionable files: {}", summary["actionable_files"]));
    lines.push(format!(
        "Findings by confidence: {}",
        python_dict(&summary["findings_by_confidence"])
    ));
    for entry in files {
        let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
        let empty = Vec::new();
        let findings = entry
            .get("findings")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let confidence = entry
            .get("confidence")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        for (finding, level) in findings.iter().zip(confidence.iter()) {
            let finding = finding.as_str().unwrap_or("");
            let level = level.as_str().unwrap_or("");
            lines.push(format!("  [{level}] {path}: {finding}"));
        }
    }
    lines.join("\n")
}

/// Directory names skipped by default when walking a tree.
pub const DEFAULT_SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
];

/// Walk `root` depth-first, yielding files in sorted order.
///
/// Hidden directories are skipped alongside the explicit list, matching the
/// Python's `not d.startswith(".")` filter.
pub fn walk_files(root: &Path, skip_dirs: &[String]) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if skip_dirs.iter().any(|skip| *skip == name) || name.starts_with('.') {
                    continue;
                }
                dirs.push(path);
            } else if path.is_file() {
                files.push((name, path));
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        out.extend(files.into_iter().map(|(_, path)| path));
        dirs.sort();
        // Reversed, so the sorted order comes back off the stack.
        for dir in dirs.into_iter().rev() {
            stack.push(dir);
        }
    }
    out
}

#[cfg(test)]
mod tests;
