//! Working-graph reject page — port of `write_working_page` from
//! `promote.py`. Rejected-from-ontology is not discarded: every terminal
//! reject also writes `<Topic>.md` into the vault working graph
//! (`public: false`, outside the KG gate).

use crate::common::yaml_scalar;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Port of Python's `textwrap.dedent`: strips the longest common leading
/// whitespace shared by every non-blank line; whitespace-only lines are
/// normalised to empty.
fn dedent(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut margin: Option<String> = None;
    for line in &lines {
        if line.trim().is_empty() {
            continue;
        }
        let indent: String = line
            .chars()
            .take_while(|c| *c == ' ' || *c == '\t')
            .collect();
        margin = Some(match margin {
            None => indent,
            Some(m) => common_prefix(&m, &indent),
        });
        if margin.as_deref() == Some("") {
            break;
        }
    }
    let margin = margin.unwrap_or_default();
    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                ""
            } else {
                l.strip_prefix(margin.as_str()).unwrap_or(l)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn common_prefix(a: &str, b: &str) -> String {
    a.chars()
        .zip(b.chars())
        .take_while(|(x, y)| x == y)
        .map(|(x, _)| x)
        .collect()
}

/// Port of `write_working_page`. `data` is the `Value` returned by
/// `write_dossier_json`.
pub fn write_working_page(working_dir: &Path, data: &Value) -> PathBuf {
    let _ = std::fs::create_dir_all(working_dir);
    let topic = data
        .get("topic")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let draft_ok = data
        .get("draft")
        .and_then(|d| d.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let edit_content = data
        .get("draft")
        .and_then(|d| d.get("edit"))
        .and_then(|e| e.get("content"))
        .and_then(|v| v.as_str());
    let draft_content = if draft_ok && edit_content.map(|c| !c.is_empty()).unwrap_or(false) {
        dedent(edit_content.unwrap_or_default()).trim().to_string()
    } else {
        String::new()
    };

    let status = data
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let episodes_count = data
        .get("episodes")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let n_assertions = data
        .get("n_assertions")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let mut lines: Vec<String> = vec![
        "---".to_string(),
        "public: false".to_string(),
        "type: podcast-news".to_string(),
        format!("topic: {}", yaml_scalar(topic)),
        format!(
            "source: {}",
            yaml_scalar("AI Daily Brief (podcast-knowledge-ingest promotion stage)")
        ),
        format!("promotion-status: {}", yaml_scalar(status)),
        format!("episodes: {episodes_count}"),
        format!("assertions: {n_assertions}"),
        "---".to_string(),
        String::new(),
        format!("# {topic} — processed news"),
        String::new(),
    ];

    if !draft_content.is_empty() {
        lines.push(draft_content);
        lines.push(String::new());
    }
    lines.push("## Evidence".to_string());
    if let Some(assertions) = data.get("assertions").and_then(|v| v.as_array()) {
        for a in assertions {
            let claim = a.get("claim").and_then(|v| v.as_str()).unwrap_or_default();
            lines.push(format!("- {claim}"));
            lines.push(format!(
                "  source:: {}",
                a.get("source").and_then(|v| v.as_str()).unwrap_or("")
            ));
            lines.push(format!(
                "  episode:: {}",
                a.get("episode").and_then(|v| v.as_str()).unwrap_or("")
            ));
            lines.push(format!(
                "  confidence:: {}",
                a.get("confidence").and_then(|v| v.as_str()).unwrap_or("")
            ));
            if let Some(cd) = a.get("claim_date").and_then(|v| v.as_str()) {
                if !cd.is_empty() {
                    lines.push(format!("  claim-date:: {cd}"));
                }
            }
        }
    }

    let safe_name = topic.replace('/', "___");
    let path = working_dir.join(format!("{safe_name}.md"));
    let content = lines.join("\n") + "\n";
    let _ = std::fs::write(&path, content);
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn dedent_no_common_indent_is_noop() {
        let text = "- ### Heading\n  - indented line";
        assert_eq!(dedent(text), text);
    }

    #[test]
    fn dedent_strips_common_margin() {
        let text = "    line one\n    line two";
        assert_eq!(dedent(text), "line one\nline two");
    }

    #[test]
    fn working_page_has_public_false_and_evidence() {
        let dir = tempdir().unwrap();
        let data = json!({
            "topic": "Some Topic",
            "status": "candidate_rejected",
            "episodes": ["ep1", "ep2"],
            "n_assertions": 1,
            "draft": {"ok": false, "edit": null},
            "assertions": [
                {"claim": "A claim.", "source": "Host", "episode": "ep1", "confidence": "0.9", "claim_date": "2026-01-01"}
            ]
        });
        let path = write_working_page(dir.path(), &data);
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("---\npublic: false\ntype: podcast-news\n"));
        assert!(content.contains("episodes: 2\n"));
        assert!(content.contains("assertions: 1\n"));
        assert!(content.contains("## Evidence\n- A claim.\n"));
        assert!(content.contains("  claim-date:: 2026-01-01\n"));
    }

    #[test]
    fn working_page_safe_name_replaces_slash() {
        let dir = tempdir().unwrap();
        let data = json!({"topic": "AI/ML", "status": "candidate_rejected", "episodes": [], "n_assertions": 0, "draft": {"ok": false}, "assertions": []});
        let path = write_working_page(dir.path(), &data);
        assert_eq!(path.file_name().unwrap().to_string_lossy(), "AI___ML.md");
    }
}
