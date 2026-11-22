//! Working-vault page for a rejected candidate. Rejected-from-ontology is not
//! discarded: every terminal reject also writes `<Topic>.md` into the working
//! vault (`public: false`, never in the reasoner's input).
//!
//! The page is a vault page: YAML frontmatter with a declared `type`, a
//! `generated` stamp and a `sources` list, then the body. Per-bullet detail is
//! `**key:** value` prose. The Python original and the first port wrote
//! `type: podcast-news` and `key:: value` lines; both fail `ontomark validate`,
//! and each weekly run re-broke pages the 2026-09 migration had repaired.

use crate::common::yaml_scalar;
use crate::ingest::ledger::LEDGER_SUBDIR;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The free-text `source` every page of this stage carries.
pub const STAGE_SOURCE: &str = "AI Daily Brief (podcast-knowledge-ingest promotion stage)";

/// What [`write_working_page`] did.
#[derive(Debug, PartialEq, Eq)]
pub enum WorkingPage {
    /// The page was written.
    Written(PathBuf),
    /// A page of that name exists and was not written by this stage, so it
    /// was left alone. The working vault also holds hand-written notes.
    Foreign(PathBuf),
    /// The write failed, with the reason.
    Failed(PathBuf, String),
}

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

/// Was the page at `path` written by this stage? True for a page whose
/// frontmatter carries `promotion-status`, in either the current or the
/// retired `podcast-news` shape.
fn is_stage_page(text: &str) -> bool {
    let (head, _) = super::splice::split_frontmatter(text);
    head.lines().any(|l| l.starts_with("promotion-status:"))
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default()
}

/// Write the working-vault page for a rejected candidate. `data` is the
/// `Value` returned by `write_dossier_json`; `generated_at` is an RFC 3339 UTC
/// timestamp.
pub fn write_working_page(working_dir: &Path, data: &Value, generated_at: &str) -> WorkingPage {
    let topic = str_field(data, "topic");
    // `a___b.md` is a rejected namespace filename; use the same rule as the
    // curated target page name.
    let path = working_dir.join(super::candidate::target_page_name(topic));
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return WorkingPage::Failed(path, "refusing a symbolic-link working page".to_string());
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return WorkingPage::Failed(path, e.to_string());
        }
        _ => {}
    }
    match std::fs::read_to_string(&path) {
        Ok(existing) if !is_stage_page(&existing) => return WorkingPage::Foreign(path),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return WorkingPage::Failed(path, e.to_string());
        }
        _ => {}
    }

    let draft_ok = data
        .get("draft")
        .and_then(|d| d.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let draft_content = data
        .get("draft")
        .and_then(|d| d.get("edit"))
        .and_then(|e| e.get("content"))
        .and_then(|v| v.as_str())
        .filter(|c| draft_ok && !c.is_empty())
        .map(|c| dedent(c).trim().to_string())
        .unwrap_or_default();

    let episodes: Vec<&str> = data
        .get("episodes")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|e| e.as_str()).collect())
        .unwrap_or_default();
    let n_assertions = data
        .get("n_assertions")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let mut lines: Vec<String> = vec![
        "---".to_string(),
        "type: Note".to_string(),
        format!("title: {}", yaml_scalar(topic)),
        "public: false".to_string(),
        "status: draft".to_string(),
        "generated:".to_string(),
        format!(
            "  by: process:podcast-promote/{}",
            env!("CARGO_PKG_VERSION")
        ),
        format!("  at: {generated_at}"),
        format!("source: {}", yaml_scalar(STAGE_SOURCE)),
    ];
    if !episodes.is_empty() {
        lines.push("sources:".to_string());
        for ep in &episodes {
            lines.push(format!("- id: {}", yaml_scalar(ep)));
            lines.push(format!("  resource: '[[{LEDGER_SUBDIR}/{ep}]]'"));
        }
    }
    lines.extend([
        format!("topic: {}", yaml_scalar(topic)),
        format!("episodes: {}", episodes.len()),
        format!("assertions: {n_assertions}"),
        format!(
            "promotion-status: {}",
            yaml_scalar(str_field(data, "status"))
        ),
        "---".to_string(),
        format!("# {topic} — processed news"),
        String::new(),
    ]);

    if !draft_content.is_empty() {
        lines.push(draft_content);
        lines.push(String::new());
    }
    lines.push("## Evidence".to_string());
    lines.push(String::new());
    if let Some(assertions) = data.get("assertions").and_then(|v| v.as_array()) {
        for a in assertions {
            lines.push(format!("- {}", str_field(a, "claim")));
            for (label, key) in [("source", "source"), ("confidence", "confidence")] {
                let value = str_field(a, key);
                if !value.is_empty() {
                    lines.push(format!("  **{label}:** {value}"));
                }
            }
            let episode = str_field(a, "episode");
            if !episode.is_empty() {
                lines.push(format!("  **episode:** [[{LEDGER_SUBDIR}/{episode}]]"));
            }
            let claim_date = str_field(a, "claim_date");
            if !claim_date.is_empty() {
                lines.push(format!("  **claim-date:** {claim_date}"));
            }
        }
    }

    let content = lines.join("\n") + "\n";
    if let Err(e) =
        std::fs::create_dir_all(working_dir).and_then(|_| std::fs::write(&path, content))
    {
        return WorkingPage::Failed(path, e.to_string());
    }
    WorkingPage::Written(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    const AT: &str = "2026-11-21T10:00:00Z";

    fn sample() -> Value {
        json!({
            "topic": "Some Topic",
            "status": "candidate_rejected",
            "episodes": ["ep1", "ep2"],
            "n_assertions": 1,
            "draft": {"ok": true, "edit": {"content": "## Recent Developments\nNews."}},
            "assertions": [
                {"claim": "A claim.", "source": "Host", "episode": "ep1", "confidence": "0.9", "claim_date": "2026-01-01"}
            ]
        })
    }

    fn written(dir: &Path, data: &Value) -> String {
        match write_working_page(dir, data, AT) {
            WorkingPage::Written(p) => std::fs::read_to_string(p).unwrap(),
            other => panic!("expected a written page, got {other:?}"),
        }
    }

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
    fn the_page_is_a_typed_stamped_vault_page() {
        let dir = tempdir().unwrap();
        let content = written(dir.path(), &sample());
        let expected_head = format!(
            "---\ntype: Note\ntitle: Some Topic\npublic: false\nstatus: draft\ngenerated:\n  by: process:podcast-promote/{}\n  at: {AT}\n",
            env!("CARGO_PKG_VERSION")
        );
        assert!(content.starts_with(&expected_head), "{content}");
        assert!(content
            .contains("sources:\n- id: ep1\n  resource: '[[podcast-evidence/ep1]]'\n- id: ep2\n"));
        assert!(content
            .contains("episodes: 2\nassertions: 1\npromotion-status: candidate_rejected\n---\n"));
        assert!(content.contains("## Recent Developments\nNews.\n\n## Evidence\n\n- A claim.\n  **source:** Host\n  **confidence:** 0.9\n  **episode:** [[podcast-evidence/ep1]]\n  **claim-date:** 2026-01-01\n"));
    }

    /// `ontomark validate` rejects both: an undeclared type and a Logseq
    /// `key:: value` property line.
    #[test]
    fn the_page_has_no_undeclared_type_and_no_logseq_property() {
        let dir = tempdir().unwrap();
        let content = written(dir.path(), &sample());
        assert!(!content.contains("podcast-news"));
        assert!(!content.lines().any(|l| l.contains(":: ")), "{content}");
    }

    #[test]
    fn a_page_this_stage_wrote_is_refreshed() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("Some Topic.md"),
            "---\npublic: false\ntype: podcast-news\npromotion-status: candidate_rejected\n---\nold\n",
        )
        .unwrap();
        let content = written(dir.path(), &sample());
        assert!(content.contains("type: Note"));
        assert!(!content.contains("old"));
    }

    #[test]
    fn a_hand_written_note_of_the_same_name_is_left_alone() {
        let dir = tempdir().unwrap();
        let note = "---\ntype: Note\ntitle: Some Topic\n---\nMy own notes.\n";
        let path = dir.path().join("Some Topic.md");
        std::fs::write(&path, note).unwrap();
        assert_eq!(
            write_working_page(dir.path(), &sample(), AT),
            WorkingPage::Foreign(path.clone())
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), note);
    }

    #[cfg(unix)]
    #[test]
    fn a_symbolic_link_is_refused_without_touching_its_target() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("owner.md");
        let original = "---\ntype: Note\npromotion-status: candidate_rejected\n---\nOwner data.\n";
        std::fs::write(&target, original).unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("Some Topic.md")).unwrap();
        assert!(matches!(
            write_working_page(dir.path(), &sample(), AT),
            WorkingPage::Failed(_, _)
        ));
        assert_eq!(std::fs::read_to_string(target).unwrap(), original);
    }

    #[test]
    fn an_unreadable_format_is_not_treated_as_an_absent_page() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Some Topic.md");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(matches!(
            write_working_page(dir.path(), &sample(), AT),
            WorkingPage::Failed(_, _)
        ));
        assert_eq!(std::fs::read(path).unwrap(), vec![0xff, 0xfe]);
    }

    #[test]
    fn working_page_safe_name_replaces_slash() {
        let dir = tempdir().unwrap();
        let data = json!({"topic": "AI/ML", "status": "candidate_rejected", "episodes": [], "n_assertions": 0, "draft": {"ok": false}, "assertions": []});
        match write_working_page(dir.path(), &data, AT) {
            WorkingPage::Written(p) => {
                assert_eq!(p.file_name().unwrap().to_string_lossy(), "AI_ML.md")
            }
            other => panic!("{other:?}"),
        }
    }
}
