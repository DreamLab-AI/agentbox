//! Working-vault page for a rejected candidate. Rejected-from-ontology is not
//! discarded: every terminal reject also writes `<Topic>.md` into the working
//! vault (`public: false`, never in the reasoner's input).
//!
//! The page is a vault page: YAML frontmatter with a declared `type`, a
//! `generated` stamp and a `sources` list, then the body. Per-bullet detail is
//! `**key:** value` prose. The Python original and the first port wrote
//! `type: podcast-news` and `key:: value` lines; both fail `ontomark validate`,
//! and each weekly run re-broke pages the 2026-09 migration had repaired.
//!
//! # What a write does
//!
//! * **A new page** gets the header this stage owns, with `generated` naming
//!   this writer and the time.
//! * **A refresh is a merge, not a rebuild.** Only the keys this stage owns
//!   (`title`, `sources`, `topic`, `episodes`, `assertions`, `promotion-status`)
//!   are rewritten, in place. Every other key is kept as its raw text, so the
//!   page's first `generated` stamp, its `type`, `status` and any key a later
//!   vocabulary added survive. The retired free-text `source:` is dropped. The
//!   writer is recorded as a later contributor (`contributors:`), and a refresh
//!   that would change nothing writes nothing and records nothing.
//! * **The body is normalised** by `ontomark repair bodies` (the vault's own
//!   converter, run on a scratch copy) so what lands passes
//!   `ontomark repair bodies --check`. If that cannot be done the page is left
//!   as it was and the write is reported as failed.
//!
//! # Header shape
//!
//! Everything header-shaped lives in [`HeaderShape`], so a later vocabulary is
//! a change to that one place.

use crate::common::yaml_scalar;
use crate::ingest::ledger::LEDGER_SUBDIR;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// What [`write_working_page`] did.
#[derive(Debug, PartialEq, Eq)]
pub enum WorkingPage {
    /// The page was written.
    Written(PathBuf),
    /// The page already says exactly what a fresh write would, so nothing was
    /// written and no contributor was recorded.
    Unchanged(PathBuf),
    /// A page of that name exists and was not written by this stage, so it
    /// was left alone. The working vault also holds hand-written notes.
    Foreign(PathBuf),
    /// The write failed, with the reason. The page, if any, is untouched.
    Failed(PathBuf, String),
}

/// Everything about the frontmatter that depends on the vocabulary version.
///
/// This is the vocabulary-2 shape (ontomark 0.9.0, `vocabulary.yaml`): a
/// single `generated: {by, at}` stamp that is never rewritten, free-form
/// `sources: [{id, resource}]`, and later writers recorded under
/// `contributors:` (an unknown key a working page tolerates; it is the same
/// key and entry shape ADR-VG-012 §6 gives vocabulary 3). Moving to
/// vocabulary 3 is a change to this struct's constants and to
/// [`HeaderShape::source_entry`]; see the follow-up list in the delivery
/// report.
struct HeaderShape;

impl HeaderShape {
    /// The actor prefix this stage stamps with.
    const ACTOR_PREFIX: &'static str = "process:podcast-promote/";
    /// Keys this stage owns and rewrites on every write.
    const OWNED: [&'static str; 6] = [
        "title",
        "sources",
        "topic",
        "episodes",
        "assertions",
        "promotion-status",
    ];
    /// Keys the stage drops from a page it owns (retired forms).
    const RETIRED: [&'static str; 1] = ["source"];

    fn actor() -> String {
        format!("{}{}", Self::ACTOR_PREFIX, env!("CARGO_PKG_VERSION"))
    }

    fn generated(at: &str) -> String {
        format!("generated:\n  by: {}\n  at: {at}\n", Self::actor())
    }

    fn contributor(at: &str) -> String {
        format!("- by: {}\n  at: {at}\n", Self::actor())
    }

    /// One `sources` entry for a ledger slug.
    fn source_entry(ep: &str) -> String {
        format!(
            "- id: {}\n  resource: '[[{LEDGER_SUBDIR}/{ep}]]'\n",
            yaml_scalar(ep)
        )
    }
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

/// One top-level frontmatter key and its raw text (the key line plus every
/// continuation line), each line newline-terminated.
struct Block {
    key: String,
    text: String,
}

/// Split the frontmatter's inner text into top-level blocks. A line starting
/// with a space, tab, `-` or `#` belongs to the block before it.
fn parse_blocks(inner: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for line in inner.split_inclusive('\n') {
        let continuation = line.starts_with([' ', '\t', '-', '#']) || line.trim().is_empty();
        match blocks.last_mut() {
            Some(b) if continuation => b.text.push_str(line),
            _ => blocks.push(Block {
                key: line
                    .split(':')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                text: line.to_string(),
            }),
        }
    }
    for b in &mut blocks {
        if !b.text.ends_with('\n') {
            b.text.push('\n');
        }
    }
    blocks
}

/// `(frontmatter blocks, body)` of a page; no frontmatter gives no blocks.
fn split_page(text: &str) -> (Vec<Block>, &str) {
    let (head, body) = super::splice::split_frontmatter(text);
    let inner = head
        .strip_prefix("---\n")
        .or_else(|| head.strip_prefix("---\r\n"))
        .unwrap_or("");
    let inner = inner
        .trim_end_matches(['\n', '\r'])
        .strip_suffix("---")
        .unwrap_or("");
    (parse_blocks(inner), body)
}

/// Was this page written by this stage?
///
/// A page is this stage's when it carries `promotion-status` **and** one of:
/// its `generated` stamp or a `contributors` entry names this writer
/// (`process:podcast-promote/…`); or its first body heading is the one this
/// stage writes, `# <topic> — processed news`. The heading is what survives
/// the 2026-09 migration, which re-stamped 106 of this stage's pages as
/// `process:vault-migrate/1.0` and retyped them `Episode`; a hand-written note
/// that merely copies `promotion-status` has neither.
fn is_stage_page(text: &str) -> bool {
    let (blocks, body) = split_page(text);
    if !blocks.iter().any(|b| b.key == "promotion-status") {
        return false;
    }
    let stamped = blocks
        .iter()
        .filter(|b| b.key == "generated" || b.key == "contributors")
        .any(|b| {
            b.text
                .contains(&format!("by: {}", HeaderShape::ACTOR_PREFIX))
        });
    let heading = body
        .lines()
        .find(|l| !l.trim().is_empty())
        .is_some_and(|l| l.starts_with("# ") && l.ends_with(" — processed news"));
    stamped || heading
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default()
}

/// Make a model draft safe to place under this stage's own heading: strip any
/// frontmatter or `json-ld` fence the model added, and its leading `# ` title
/// (the writer adds its own).
fn clean_draft(draft: &str) -> String {
    let text = dedent(draft);
    let (head, rest) = super::splice::split_frontmatter(text.trim());
    let text = if head.is_empty() { text.trim() } else { rest };
    let mut out: Vec<&str> = Vec::new();
    let mut in_fence = false;
    for line in text.lines() {
        let t = line.trim_start();
        if in_fence {
            in_fence = !t.starts_with("```");
            continue;
        }
        if t.starts_with("```json-ld") {
            in_fence = true;
            continue;
        }
        out.push(line);
    }
    let mut lines = out.as_slice();
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines = &lines[1..];
    }
    if lines.first().is_some_and(|l| l.starts_with("# ")) {
        lines = &lines[1..];
    }
    lines.join("\n").trim().to_string()
}

/// Normalise a page body with the vault's own converter, `ontomark repair
/// bodies`, run on a scratch single-file vault (never on the real vault), then
/// confirm with `--check`. The binary is `$ONTOMARK_BIN` or `ontomark` on
/// `PATH`.
pub fn ontomark_normalise(body: &str) -> Result<String, String> {
    use std::process::Command;
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let dir = Scratch(std::env::temp_dir().join(format!(
        "podcast-promote-body-{}-{stamp}",
        std::process::id()
    )));
    std::fs::create_dir_all(&dir.0).map_err(|e| e.to_string())?;
    let page = dir.0.join("page.md");
    std::fs::write(&page, body).map_err(|e| e.to_string())?;
    let bin = std::env::var("ONTOMARK_BIN").unwrap_or_else(|_| "ontomark".to_string());
    for check in [false, true] {
        let mut cmd = Command::new(&bin);
        cmd.args([
            "repair",
            "bodies",
            "--profile",
            "generic",
            "--vault",
            "knowledge",
            "--repo",
        ])
        .arg(&dir.0);
        if check {
            cmd.arg("--check");
        }
        let out = cmd
            .output()
            .map_err(|e| format!("cannot run `{bin} repair bodies`: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "`{bin} repair bodies{}` failed: {}",
                if check { " --check" } else { "" },
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    std::fs::read_to_string(&page).map_err(|e| e.to_string())
}

/// Write the working-vault page for a rejected candidate. `data` is the
/// `Value` returned by `write_dossier_json`; `generated_at` is an RFC 3339 UTC
/// timestamp. The body is normalised with [`ontomark_normalise`].
pub fn write_working_page(working_dir: &Path, data: &Value, generated_at: &str) -> WorkingPage {
    write_working_page_with(working_dir, data, generated_at, &ontomark_normalise)
}

/// [`write_working_page`] with the body normaliser supplied by the caller.
pub fn write_working_page_with(
    working_dir: &Path,
    data: &Value,
    generated_at: &str,
    normalise: &dyn Fn(&str) -> Result<String, String>,
) -> WorkingPage {
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
    let existing = match std::fs::read_to_string(&path) {
        Ok(text) if !is_stage_page(&text) => return WorkingPage::Foreign(path),
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return WorkingPage::Failed(path, e.to_string()),
    };

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
        .map(clean_draft)
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

    let mut body: Vec<String> = vec![format!("# {topic} — processed news"), String::new()];
    if !draft_content.is_empty() {
        body.push(draft_content);
        body.push(String::new());
    }
    body.push("## Evidence".to_string());
    body.push(String::new());
    if let Some(assertions) = data.get("assertions").and_then(|v| v.as_array()) {
        for a in assertions {
            body.push(format!("- {}", str_field(a, "claim")));
            for (label, key) in [("source", "source"), ("confidence", "confidence")] {
                let value = str_field(a, key);
                if !value.is_empty() {
                    body.push(format!("  **{label}:** {value}"));
                }
            }
            let episode = str_field(a, "episode");
            if !episode.is_empty() {
                body.push(format!("  **episode:** [[{LEDGER_SUBDIR}/{episode}]]"));
            }
            let claim_date = str_field(a, "claim_date");
            if !claim_date.is_empty() {
                body.push(format!("  **claim-date:** {claim_date}"));
            }
        }
    }
    let body = match normalise(&(body.join("\n") + "\n")) {
        Ok(b) => b.trim_end().to_string() + "\n",
        Err(e) => return WorkingPage::Failed(path, format!("body not normalised: {e}")),
    };

    // The keys this stage owns, as raw text.
    let mut owned: Vec<Block> = vec![Block {
        key: "title".into(),
        text: format!("title: {}\n", yaml_scalar(topic)),
    }];
    if !episodes.is_empty() {
        let text: String = episodes
            .iter()
            .map(|e| HeaderShape::source_entry(e))
            .collect();
        owned.push(Block {
            key: "sources".into(),
            text: format!("sources:\n{text}"),
        });
    }
    owned.extend([
        Block {
            key: "topic".into(),
            text: format!("topic: {}\n", yaml_scalar(topic)),
        },
        Block {
            key: "episodes".into(),
            text: format!("episodes: {}\n", episodes.len()),
        },
        Block {
            key: "assertions".into(),
            text: format!("assertions: {n_assertions}\n"),
        },
        Block {
            key: "promotion-status".into(),
            text: format!(
                "promotion-status: {}\n",
                yaml_scalar(str_field(data, "status"))
            ),
        },
    ]);

    let existing_blocks = existing.as_deref().map(|t| split_page(t).0);
    let render = |contribute: bool| -> Result<String, String> {
        let mut head = String::from("---\n");
        match &existing_blocks {
            None => {
                for (key, raw) in [
                    ("type", "type: Note\n"),
                    ("title", ""),
                    ("public", "public: false\n"),
                    ("status", "status: draft\n"),
                    ("generated", ""),
                ] {
                    match key {
                        "title" => head.push_str(&owned[0].text),
                        "generated" => head.push_str(&HeaderShape::generated(generated_at)),
                        _ => head.push_str(raw),
                    }
                }
                for b in owned.iter().skip(1) {
                    head.push_str(&b.text);
                }
            }
            Some(blocks) => {
                let mut seen: Vec<&str> = Vec::new();
                let mut contributed = false;
                for b in blocks {
                    if HeaderShape::RETIRED.contains(&b.key.as_str()) {
                        continue;
                    }
                    if let Some(new) = owned.iter().find(|o| o.key == b.key) {
                        head.push_str(&new.text);
                        seen.push(&new.key);
                    } else if HeaderShape::OWNED.contains(&b.key.as_str()) {
                        // an owned key this write no longer produces (`sources`)
                    } else if b.key == "contributors" && contribute {
                        let first = b.text.lines().next().unwrap_or_default().trim_end();
                        if first != "contributors:" && first != "contributors: []" {
                            return Err("contributors is not a block list".to_string());
                        }
                        let rest = b.text.split_once('\n').map(|(_, r)| r).unwrap_or("");
                        head.push_str("contributors:\n");
                        head.push_str(rest);
                        head.push_str(&HeaderShape::contributor(generated_at));
                        contributed = true;
                    } else {
                        head.push_str(&b.text);
                    }
                }
                if !blocks.iter().any(|b| b.key == "generated") {
                    head.push_str(&HeaderShape::generated(generated_at));
                } else if contribute && !contributed {
                    head.push_str("contributors:\n");
                    head.push_str(&HeaderShape::contributor(generated_at));
                }
                for o in &owned {
                    if !seen.contains(&o.key.as_str()) {
                        head.push_str(&o.text);
                    }
                }
            }
        }
        head.push_str("---\n");
        Ok(head + &body)
    };

    let content = match &existing {
        None => render(false),
        Some(old) => match render(false) {
            Ok(same) if same == *old => return WorkingPage::Unchanged(path),
            Ok(_) => render(true),
            Err(e) => Err(e),
        },
    };
    let content = match content {
        Ok(c) => c,
        Err(e) => return WorkingPage::Failed(path, e),
    };
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
            "---\npublic: false\ntype: podcast-news\npromotion-status: candidate_rejected\ngenerated:\n  by: process:podcast-promote/0.1.0\n  at: 2026-11-20T00:00:00Z\n---\nold\n",
        )
        .unwrap();
        let content = written(dir.path(), &sample());
        assert!(content.contains("promotion-status: candidate_rejected"));
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

    /// A fake of `ontomark repair bodies`: turns `- ## H` into `## H`.
    fn fake_ontomark(body: &str) -> Result<String, String> {
        Ok(body
            .lines()
            .map(|l| match l.strip_prefix("- ") {
                Some(rest) if rest.starts_with('#') => rest.to_string(),
                _ => l.to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n")
    }

    fn write_with(dir: &Path, data: &Value, at: &str) -> String {
        match write_working_page_with(dir, data, at, &fake_ontomark) {
            WorkingPage::Written(p) => std::fs::read_to_string(p).unwrap(),
            other => panic!("expected a written page, got {other:?}"),
        }
    }

    const MIGRATED: &str = "---\ntype: Episode\ntitle: Some Topic\npublic: false\nstatus: stable\ngenerated:\n  by: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58.55607396Z\nsources:\n- id: source\n  resource: AI Daily Brief (podcast-knowledge-ingest promotion stage)\ntopic: Some Topic\nepisodes: 7\nassertions: 14\npromotion-status: candidate_rejected\n---\n# Some Topic — processed news\n\nold body\n";

    #[test]
    fn a_refreshed_page_keeps_its_original_generated_stamp() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Some Topic.md"), MIGRATED).unwrap();
        let content = write_with(dir.path(), &sample(), AT);
        assert!(
            content.contains("generated:\n  by: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58.55607396Z\n"),
            "{content}"
        );
        assert!(
            !content.contains(&format!("at: {AT}\nsources")),
            "{content}"
        );
    }

    #[test]
    fn a_refresh_records_the_writer_as_a_later_contributor() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Some Topic.md"), MIGRATED).unwrap();
        let content = write_with(dir.path(), &sample(), AT);
        let entry = format!(
            "contributors:\n- by: process:podcast-promote/{}\n  at: {AT}\n",
            env!("CARGO_PKG_VERSION")
        );
        assert!(content.contains(&entry), "{content}");
        // a second refresh at a later time appends, never replaces
        let later = "2026-11-28T10:00:00Z";
        let again = write_with(
            dir.path(),
            &json!({
            "topic": "Some Topic", "status": "candidate_rejected", "episodes": ["ep1"],
            "n_assertions": 2, "draft": {"ok": false}, "assertions": []}),
            later,
        );
        assert!(again.contains(&entry), "{again}");
        assert!(again.contains(&format!("  at: {later}\n")), "{again}");
    }

    #[test]
    fn a_refresh_that_changes_nothing_writes_nothing() {
        let dir = tempdir().unwrap();
        let first = write_with(dir.path(), &sample(), AT);
        let path = dir.path().join("Some Topic.md");
        assert_eq!(
            write_working_page_with(
                dir.path(),
                &sample(),
                "2026-12-01T00:00:00Z",
                &fake_ontomark
            ),
            WorkingPage::Unchanged(path.clone())
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), first);
    }

    #[test]
    fn a_refresh_keeps_keys_the_writer_does_not_own() {
        let dir = tempdir().unwrap();
        let page = MIGRATED.replace(
            "status: stable\n",
            "status: stable\nvisibility: shared\nscope: topic\n",
        );
        std::fs::write(dir.path().join("Some Topic.md"), page).unwrap();
        let content = write_with(dir.path(), &sample(), AT);
        assert!(content.starts_with("---\ntype: Episode\ntitle: Some Topic\npublic: false\nstatus: stable\nvisibility: shared\nscope: topic\n"), "{content}");
    }

    #[test]
    fn no_top_level_source_line() {
        let dir = tempdir().unwrap();
        let fresh = write_with(dir.path(), &sample(), AT);
        assert!(!fresh.lines().any(|l| l.starts_with("source:")), "{fresh}");
        let old = "---\ntype: Note\ntitle: Some Topic\npublic: false\nstatus: draft\ngenerated:\n  by: process:podcast-promote/0.1.0\n  at: 2026-11-21T16:27:43Z\nsource: AI Daily Brief (podcast-knowledge-ingest promotion stage)\nsources:\n- id: ep1\n  resource: '[[podcast-evidence/ep1]]'\ntopic: Some Topic\nepisodes: 1\nassertions: 1\npromotion-status: candidate_rejected\n---\n# Some Topic — processed news\n\nx\n";
        std::fs::write(dir.path().join("Some Topic.md"), old).unwrap();
        let refreshed = write_with(
            dir.path(),
            &json!({
            "topic": "Some Topic", "status": "candidate_rejected", "episodes": ["ep1", "ep9"],
            "n_assertions": 3, "draft": {"ok": false}, "assertions": []}),
            AT,
        );
        assert!(
            !refreshed.lines().any(|l| l.starts_with("source:")),
            "{refreshed}"
        );
        assert!(refreshed.contains("sources:\n- id: ep1\n"), "{refreshed}");
    }

    #[test]
    fn an_outline_draft_is_written_as_markdown() {
        let dir = tempdir().unwrap();
        let mut data = sample();
        data["draft"]["edit"]["content"] =
            json!("# Some Topic\n\n- ## Recent Developments\n- ### Detail\nNews.");
        let content = write_with(dir.path(), &data, AT);
        assert!(
            !content.lines().any(|l| l.trim_start().starts_with("- #")),
            "{content}"
        );
        assert!(content.contains("\n## Recent Developments\n"), "{content}");
        assert_eq!(
            content.matches("\n# Some Topic").count(),
            1,
            "one H1 only: {content}"
        );
    }

    #[test]
    fn a_failed_normalisation_leaves_the_page_untouched() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Some Topic.md");
        std::fs::write(&path, MIGRATED).unwrap();
        let fail = |_: &str| -> Result<String, String> { Err("ontomark missing".into()) };
        assert!(matches!(
            write_working_page_with(dir.path(), &sample(), AT, &fail),
            WorkingPage::Failed(_, _)
        ));
        assert_eq!(std::fs::read_to_string(path).unwrap(), MIGRATED);
    }

    #[test]
    fn a_migrated_stage_page_is_still_this_stages_page() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Some Topic.md"), MIGRATED).unwrap();
        assert!(matches!(
            write_working_page_with(dir.path(), &sample(), AT, &fake_ontomark),
            WorkingPage::Written(_)
        ));
    }

    #[test]
    fn a_page_with_only_a_promotion_status_line_is_not_this_stages_page() {
        let dir = tempdir().unwrap();
        let note = "---\ntype: Note\ntitle: Some Topic\npromotion-status: candidate_rejected\n---\nMy own notes.\n";
        let path = dir.path().join("Some Topic.md");
        std::fs::write(&path, note).unwrap();
        assert_eq!(
            write_working_page_with(dir.path(), &sample(), AT, &fake_ontomark),
            WorkingPage::Foreign(path.clone())
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), note);
    }

    #[test]
    fn a_draft_loses_its_frontmatter_title_and_json_ld_fence() {
        let draft =
            "---\ntype: Note\n---\n# Some Topic\n\n```json-ld\n{\"a\": 1}\n```\n## Recent\nNews.";
        assert_eq!(clean_draft(draft), "## Recent\nNews.");
    }

    /// Runs the real `ontomark repair bodies`; needs `ontomark` on PATH (or
    /// `ONTOMARK_BIN`), which the nix build sandbox lacks, so it is opt-in:
    /// `cargo test -- --ignored the_real_ontomark`.
    #[test]
    #[ignore = "needs the ontomark binary"]
    fn the_real_ontomark_normalises_an_outline_body() {
        let dir = tempdir().unwrap();
        let mut data = sample();
        data["draft"]["edit"]["content"] =
            json!("- ## Recent Developments\n\t- item\n- ### Detail\n- ![img](a.png){:height 100}");
        let content = match write_working_page(dir.path(), &data, AT) {
            WorkingPage::Written(p) => std::fs::read_to_string(p).unwrap(),
            other => panic!("{other:?}"),
        };
        assert!(
            !content.lines().any(|l| l.trim_start().starts_with("- #")),
            "{content}"
        );
        assert!(!content.contains("{:height"), "{content}");
        assert!(content.contains("\n## Recent Developments\n"), "{content}");
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
