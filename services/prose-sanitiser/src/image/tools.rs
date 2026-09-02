//! The optional external inspectors, `c2patool` and `exiftool`.
//!
//! Both are advisory: absent tools report `available: false` and the parsers
//! still produce a verdict on their own.

use std::path::Path;
use std::time::Duration;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::common::proc::{run_capture, Rlimits};
use crate::common::{safe_arg, which};

const TOOL_TIMEOUT: Duration = Duration::from_secs(30);

/// Decide whether c2patool's output reports a real manifest.
///
/// Negative markers must veto every positive branch: c2patool reports a missing
/// manifest as "Error: No claim found", which contains the substring "claim"
/// and would otherwise read as a hit.
pub fn c2patool_reports_manifest(output: &str) -> bool {
    let low = output.to_lowercase();
    let no_manifest = low.contains("no claim") || low.contains("no jumbf");
    (low.contains("claim") || low.contains("c2pa") || low.contains("manifest")) && !no_manifest
}

/// Lines from exiftool worth surfacing.
fn interesting_line_regex() -> Regex {
    Regex::new(r"(?i)c2pa|content.?credential|AIGC|digitalSource|XMP|EXIF|IPTC|jumb")
        .expect("static regex compiles")
}

/// Run whichever of `c2patool` and `exiftool` are installed.
pub fn run_optional_tools(path: &Path) -> Value {
    let mut tools = Map::new();
    let target = safe_arg(&path.display().to_string());

    match which("c2patool") {
        Some(binary) => {
            let entry = match run_capture(
                &binary,
                &[target.clone()],
                Rlimits::default_child(),
                TOOL_TIMEOUT,
                None,
            ) {
                Ok(output) => {
                    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
                    combined.push_str(&String::from_utf8_lossy(&output.stderr));
                    json!({
                        "available": true,
                        "returncode": output.status.code().unwrap_or(-1),
                        "snippet": truncate(&combined, 2000),
                        "has_manifest": c2patool_reports_manifest(&combined),
                    })
                }
                Err(error) => json!({"available": true, "error": error.to_string()}),
            };
            tools.insert("c2patool".into(), entry);
        }
        None => {
            tools.insert("c2patool".into(), json!({"available": false}));
        }
    }

    match which("exiftool") {
        Some(binary) => {
            let args = vec![
                "-G1".to_string(),
                "-a".to_string(),
                "-s".to_string(),
                target,
            ];
            let entry = match run_capture(
                &binary,
                &args,
                Rlimits::default_child(),
                TOOL_TIMEOUT,
                None,
            ) {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let pattern = interesting_line_regex();
                    let interesting: Vec<&str> = stdout
                        .lines()
                        .filter(|line| pattern.is_match(line))
                        .take(50)
                        .collect();
                    json!({"available": true, "interesting_lines": interesting})
                }
                Err(error) => json!({"available": true, "error": error.to_string()}),
            };
            tools.insert("exiftool".into(), entry);
        }
        None => {
            tools.insert("exiftool".into(), json!({"available": false}));
        }
    }

    Value::Object(tools)
}

/// Truncate to `limit` characters, matching Python's `out[:limit]` on a `str`.
fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_claim_is_not_a_manifest() {
        assert!(!c2patool_reports_manifest("Error: No claim found"));
        assert!(!c2patool_reports_manifest("no JUMBF data found"));
    }

    #[test]
    fn a_real_manifest_is_recognised() {
        assert!(c2patool_reports_manifest("{\"manifests\": {\"urn:c2pa:...\"}}"));
        assert!(c2patool_reports_manifest("active_manifest: urn:uuid:1"));
    }

    #[test]
    fn output_without_any_provenance_word_is_not_a_manifest() {
        assert!(!c2patool_reports_manifest("command not found"));
        assert!(!c2patool_reports_manifest(""));
    }

    #[test]
    fn the_substring_test_is_deliberately_broad() {
        // Any mention of "c2pa" counts, so c2patool's own usage banner reads as
        // a hit. Kept as-is: the finding it raises is classified `confirmed`
        // but only ever *adds* a signal a human reviews, and narrowing it here
        // would diverge from the Python the audit trail was built against.
        assert!(c2patool_reports_manifest("usage: c2patool [OPTIONS]"));
    }

    #[test]
    fn tools_always_report_availability_for_both_binaries() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.png");
        std::fs::write(&file, b"\x89PNG\r\n\x1a\n").unwrap();
        let tools = run_optional_tools(&file);
        assert!(tools["c2patool"]["available"].is_boolean());
        assert!(tools["exiftool"]["available"].is_boolean());
    }

    #[test]
    fn the_interesting_line_filter_is_case_insensitive() {
        let pattern = interesting_line_regex();
        assert!(pattern.is_match("[XMP-dc]  Creator  : x"));
        assert!(pattern.is_match("digitalsourcetype"));
        assert!(!pattern.is_match("[File] File Size : 12 kB"));
    }
}
