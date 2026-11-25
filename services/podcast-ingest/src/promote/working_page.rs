//! Working-vault page for a rejected candidate. Rejected-from-ontology is not
//! discarded: every terminal reject also writes `<Topic>.md` into the working
//! vault (never in the reasoner's input).
//!
//! The page is a vault page: YAML frontmatter with a declared `type`, a
//! `generated` stamp and a `sources` list, then the body. Per-bullet detail is
//! `**key:** value` prose. The Python original and the first port wrote
//! `type: podcast-news` and `key:: value` lines; both fail `ontomark validate`,
//! and each weekly run re-broke pages the 2026-09 migration had repaired.
//!
//! # Which shape
//!
//! The target vault decides, by the `version` in its
//! `ontology/vocabulary.yaml` ([`VaultShape`]). At 3 or higher the page is a
//! `Brief` (ADR-VG-010 §6): `scope: topic`, `visibility: shared`, a
//! content-independent `page_resource`, `derived-from` sources that pin the
//! ledgers they summarised, and stamps whose `by` is the operator's principal
//! and whose `via` is this process (ADR-VG-011 §1, ADR-VG-012 §6). Below 3,
//! the vocabulary-2 `Note` this writer has always produced.
//!
//! # What a write does
//!
//! * **A new page** gets the header this stage owns, with `generated` naming
//!   this writer and the time, and one `contributors` entry in vocabulary 3.
//! * **A refresh is a merge, not a rebuild.** Only the keys this stage owns
//!   are rewritten, in place. Every other key is kept as its raw text, so the
//!   page's first `generated` stamp, its `type`, `status`, `page_resource` and
//!   any key a later vocabulary added survive. The retired free-text `source:`
//!   (and, in vocabulary 3, `public`, `episodes`, `assertions`) is dropped.
//!   The writer is appended to `contributors:`; a refresh that would change
//!   nothing writes nothing and records nothing.
//! * **The body is normalised** by `ontomark repair bodies` (the vault's own
//!   converter, run on a scratch copy) so what lands passes
//!   `ontomark repair bodies --check`. If that cannot be done the page is left
//!   as it was and the write is reported as failed.
//!
//! # Human edits (a refresh never destroys them)
//!
//! The body this stage generates ends with a marker line,
//! `<!-- podcast-promote: body sha256:<hex> -->`, holding the SHA-256 of
//! everything above it. On a refresh:
//!
//! * the text **below** the marker is the reader's and is kept verbatim;
//! * the text **above** it is regenerated only while it still hashes to the
//!   recorded value. If it does not, a person has edited the generated text
//!   and the page is left untouched ([`WorkingPage::Edited`]); the caller logs
//!   why, and nothing is written into the page;
//! * a page with no marker (every page this stage wrote before the marker
//!   existed) cannot be proved unedited, so it is left untouched
//!   ([`WorkingPage::Unmarked`]) unless the operator opted in with
//!   [`Tools::adopt_unmarked`], which regenerates it once and adds the marker.

use crate::common::frontmatter::{join_page, push_contributor, split_page, Block};
use crate::common::vault_shape::{page_resource, VaultShape, V3};
use crate::common::yaml_scalar;
use crate::ingest::ledger::LEDGER_SUBDIR;
use serde_json::Value;
use sha2::{Digest, Sha256};
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
    /// The text this stage generated has been edited since it was written
    /// (it no longer hashes to the marker's value), so the page was left
    /// untouched rather than overwrite the edit.
    Edited(PathBuf),
    /// The page carries no body marker, so it cannot be proved unedited and
    /// was left untouched. [`Tools::adopt_unmarked`] regenerates it once.
    Unmarked(PathBuf),
    /// The write failed, with the reason. The page, if any, is untouched.
    Failed(PathBuf, String),
}

/// The outside-world seams of a write, so tests need no `ontomark` binary.
pub struct Tools<'a> {
    /// Normalises a body to Obsidian markdown ([`ontomark_normalise`]).
    pub normalise: &'a dyn Fn(&str) -> Result<String, String>,
    /// The `sha256-v1:` content digest of a ledger page ([`ontomark_pin`]).
    pub pin: &'a dyn Fn(&Path) -> Result<String, String>,
    /// Regenerate a page that has no body marker (see the module docs).
    pub adopt_unmarked: bool,
}

/// The actor this stage stamps with.
const ACTOR_PREFIX: &str = "process:podcast-promote/";
/// The marker's fixed text around the digest.
const MARKER_PREFIX: &str = "<!-- podcast-promote: body sha256:";
const MARKER_SUFFIX: &str = " -->";

fn actor() -> String {
    format!("{ACTOR_PREFIX}{}", env!("CARGO_PKG_VERSION"))
}

/// Everything about the frontmatter that depends on the vocabulary version.
struct Header<'a> {
    shape: &'a VaultShape,
}

impl Header<'_> {
    /// Keys this stage rewrites on every write.
    fn owned(&self) -> &'static [&'static str] {
        match self.shape {
            VaultShape::V2 => &[
                "title",
                "sources",
                "topic",
                "episodes",
                "assertions",
                "promotion-status",
            ],
            VaultShape::V3(_) => &["title", "sources", "topic", "promotion-status"],
        }
    }

    /// Keys this stage drops from a page it owns (retired forms).
    fn retired(&self) -> &'static [&'static str] {
        match self.shape {
            VaultShape::V2 => &["source"],
            // Vocabulary 3 drops the derivable counts (ADR-VG-010 §6) and the
            // public flag (ADR-VG-012 §5).
            VaultShape::V3(_) => &["source", "episodes", "assertions", "public"],
        }
    }

    fn generated(&self, at: &str) -> String {
        match self.shape {
            VaultShape::V2 => format!("generated:\n  by: {}\n  at: {at}\n", actor()),
            VaultShape::V3(v3) => format!(
                "generated:\n  by: {}\n  via: {}\n  at: {at}\n",
                v3.principal,
                actor()
            ),
        }
    }

    fn contributor(&self, at: &str) -> String {
        match self.shape {
            VaultShape::V2 => format!("- by: {}\n  at: {at}\n", actor()),
            VaultShape::V3(v3) => {
                format!("- by: {}\n  via: {}\n  at: {at}\n", v3.principal, actor())
            }
        }
    }

    /// One `sources` entry for a ledger slug. In vocabulary 3 it is a
    /// `derived-from` citation pinned to the ledger's content digest.
    fn source_entry(&self, ep: &str, pin: Option<&str>) -> String {
        match (self.shape, pin) {
            (VaultShape::V3(_), Some(pin)) => format!(
                "- id: {}\n  resource: '[[{LEDGER_SUBDIR}/{ep}]]'\n  rel: derived-from\n  locator: {pin}\n",
                yaml_scalar(ep)
            ),
            (VaultShape::V3(_), None) => format!(
                "- id: {}\n  resource: '[[{LEDGER_SUBDIR}/{ep}]]'\n  rel: derived-from\n",
                yaml_scalar(ep)
            ),
            (VaultShape::V2, _) => format!(
                "- id: {}\n  resource: '[[{LEDGER_SUBDIR}/{ep}]]'\n",
                yaml_scalar(ep)
            ),
        }
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

/// Was this page written by this stage?
///
/// A page is this stage's when it carries `promotion-status` **and** one of:
/// its `generated` stamp or a `contributors` entry names this writer as `by`
/// (vocabulary 2) or `via` (vocabulary 3); or its first body heading is the one
/// this stage writes, `# <topic> — processed news`. The heading is what
/// survives the 2026-09 migration, which re-stamped 106 of this stage's pages
/// as `process:vault-migrate/1.0` and retyped them `Episode`, and the
/// vocabulary-3 migration, which moved the actor from `by` to `via`; a
/// hand-written note that merely copies `promotion-status` has neither.
fn is_stage_page(text: &str) -> bool {
    let (blocks, body) = split_page(text);
    if !blocks.iter().any(|b| b.key == "promotion-status") {
        return false;
    }
    let stamped = blocks
        .iter()
        .filter(|b| b.key == "generated" || b.key == "contributors")
        .any(|b| {
            b.text.contains(&format!("by: {ACTOR_PREFIX}"))
                || b.text.contains(&format!("via: {ACTOR_PREFIX}"))
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

fn sha256_hex(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// A body's generated text followed by its marker.
fn with_marker(generated: &str) -> String {
    format!(
        "{generated}\n{MARKER_PREFIX}{}{MARKER_SUFFIX}\n",
        sha256_hex(generated)
    )
}

/// How an existing body relates to what this stage last wrote.
enum BodyState<'a> {
    /// A marker whose digest matches the text above it; `tail` is whatever a
    /// reader added below the marker.
    Intact { tail: &'a str },
    /// A marker whose digest does not match the text above it.
    Edited,
    /// No marker.
    Unmarked,
}

fn body_state(body: &str) -> BodyState<'_> {
    let mut offset = 0usize;
    let mut found: Option<(usize, usize, &str)> = None;
    for line in body.split_inclusive('\n') {
        let t = line.trim_end_matches(['\n', '\r']);
        if let Some(d) = t
            .strip_prefix(MARKER_PREFIX)
            .and_then(|r| r.strip_suffix(MARKER_SUFFIX))
        {
            found = Some((offset, offset + line.len(), d));
        }
        offset += line.len();
    }
    let Some((start, end, digest)) = found else {
        return BodyState::Unmarked;
    };
    // `with_marker` puts one blank line between the text and the marker.
    let above = body[..start].strip_suffix('\n').unwrap_or(&body[..start]);
    if sha256_hex(above) == digest {
        BodyState::Intact { tail: &body[end..] }
    } else {
        BodyState::Edited
    }
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

/// A scratch directory holding one `page.md`, removed on drop.
struct Scratch(PathBuf);
impl Scratch {
    fn with_page(text: &str) -> Result<Scratch, String> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let dir = Scratch(std::env::temp_dir().join(format!(
            "podcast-promote-body-{}-{stamp}",
            std::process::id()
        )));
        std::fs::create_dir_all(&dir.0).map_err(|e| e.to_string())?;
        std::fs::write(dir.0.join("page.md"), text).map_err(|e| e.to_string())?;
        Ok(dir)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn ontomark_bin() -> String {
    std::env::var("ONTOMARK_BIN").unwrap_or_else(|_| "ontomark".to_string())
}

/// Normalise a page body with the vault's own converter, `ontomark repair
/// bodies`, run on a scratch single-file vault (never on the real vault), then
/// confirm with `--check`. The binary is `$ONTOMARK_BIN` or `ontomark` on
/// `PATH`.
pub fn ontomark_normalise(body: &str) -> Result<String, String> {
    use std::process::Command;
    let dir = Scratch::with_page(body)?;
    let bin = ontomark_bin();
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
    std::fs::read_to_string(dir.0.join("page.md")).map_err(|e| e.to_string())
}

/// The `sha256-v1:<hex>` content digest ontomark gives a page, which is what a
/// `derived-from` citation pins. Computed by ontomark itself (`review-binding`
/// on a scratch copy of the page as a single-file vault), so the form cannot
/// drift from the validator's. The digest depends only on the page's text.
pub fn ontomark_pin(page: &Path) -> Result<String, String> {
    use std::process::Command;
    let text = std::fs::read_to_string(page).map_err(|e| format!("{}: {e}", page.display()))?;
    let dir = Scratch::with_page(&text)?;
    let bin = ontomark_bin();
    let out = Command::new(&bin)
        .args([
            "review-binding",
            "page",
            "--vault",
            "knowledge",
            "--profile",
            "generic",
            "--json",
            "--repo",
        ])
        .arg(&dir.0)
        .output()
        .map_err(|e| format!("cannot run `{bin} review-binding`: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "`{bin} review-binding` failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    v.get("content_digest")
        .and_then(|d| d.as_str())
        .filter(|d| d.starts_with("sha256-v1:"))
        .map(str::to_string)
        .ok_or_else(|| "review-binding gave no sha256-v1 digest".to_string())
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
    write_working_page_using(
        working_dir,
        data,
        generated_at,
        &Tools {
            normalise,
            pin: &ontomark_pin,
            adopt_unmarked: false,
        },
    )
}

/// The full write, with every seam supplied by the caller.
pub fn write_working_page_using(
    working_dir: &Path,
    data: &Value,
    generated_at: &str,
    tools: &Tools,
) -> WorkingPage {
    let topic = str_field(data, "topic");
    // `a___b.md` is a rejected namespace filename; use the same rule as the
    // curated target page name.
    let file_name = super::candidate::target_page_name(topic);
    let path = working_dir.join(&file_name);
    let stem = file_name.strip_suffix(".md").unwrap_or(&file_name);
    let shape = match VaultShape::detect(working_dir) {
        Ok(s) => s,
        Err(e) => return WorkingPage::Failed(path, e),
    };
    let header = Header { shape: &shape };
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

    // Human edits: decided before any work is done.
    let mut tail = "";
    if let Some(old) = existing.as_deref() {
        match body_state(split_page(old).1) {
            BodyState::Intact { tail: t } => tail = t,
            BodyState::Edited => return WorkingPage::Edited(path),
            BodyState::Unmarked if tools.adopt_unmarked => {}
            BodyState::Unmarked => return WorkingPage::Unmarked(path),
        }
    }
    if let VaultShape::V3(v3) = &shape {
        if let Err(e) = check_v3(v3, data, existing.as_deref()) {
            return WorkingPage::Failed(path, e);
        }
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
    let generated_body = match (tools.normalise)(&(body.join("\n") + "\n")) {
        Ok(b) => b.trim_end().to_string() + "\n",
        Err(e) => return WorkingPage::Failed(path, format!("body not normalised: {e}")),
    };
    let body = format!("{}{tail}", with_marker(&generated_body));

    // The keys this stage owns, as raw text.
    let existing_blocks = existing.as_deref().map(|t| split_page(t).0);
    let mut owned: Vec<Block> = Vec::new();
    let has_title = existing_blocks
        .as_ref()
        .is_some_and(|bs| bs.iter().any(|b| b.key == "title"));
    // Vocabulary 3 omits a title equal to the file name (vault.toml).
    if matches!(shape, VaultShape::V2) || has_title || topic != stem {
        owned.push(Block::new(
            "title",
            format!("title: {}\n", yaml_scalar(topic)),
        ));
    }
    let mut entries = String::new();
    for e in &episodes {
        let pin = match &shape {
            VaultShape::V2 => None,
            VaultShape::V3(_) => {
                let ledger = working_dir.join(LEDGER_SUBDIR).join(format!("{e}.md"));
                if !ledger.is_file() {
                    // A source that names no page would fail the gate.
                    eprintln!("  note: ledger {e} not found; not cited by {topic}");
                    continue;
                }
                match (tools.pin)(&ledger) {
                    Ok(p) => Some(p),
                    Err(err) => {
                        return WorkingPage::Failed(path, format!("cannot pin ledger {e}: {err}"))
                    }
                }
            }
        };
        entries.push_str(&header.source_entry(e, pin.as_deref()));
    }
    if !entries.is_empty() {
        owned.push(Block::new("sources", format!("sources:\n{entries}")));
    }
    owned.push(Block::new(
        "topic",
        format!("topic: {}\n", yaml_scalar(topic)),
    ));
    if matches!(shape, VaultShape::V2) {
        owned.push(Block::new(
            "episodes",
            format!("episodes: {}\n", episodes.len()),
        ));
        owned.push(Block::new(
            "assertions",
            format!("assertions: {n_assertions}\n"),
        ));
    }
    owned.push(Block::new(
        "promotion-status",
        format!(
            "promotion-status: {}\n",
            yaml_scalar(str_field(data, "status"))
        ),
    ));

    let render = |contribute: bool| -> Result<String, String> {
        let mut blocks: Vec<Block> = Vec::new();
        match &existing_blocks {
            None => {
                match &shape {
                    VaultShape::V2 => {
                        blocks.push(Block::new("type", "type: Note\n".into()));
                        blocks.extend(owned.iter().filter(|o| o.key == "title").cloned());
                        blocks.push(Block::new("public", "public: false\n".into()));
                        blocks.push(Block::new("status", "status: draft\n".into()));
                        blocks.push(Block::new("generated", header.generated(generated_at)));
                    }
                    VaultShape::V3(_) => {
                        blocks.push(Block::new("type", "type: Brief\n".into()));
                        blocks.extend(owned.iter().filter(|o| o.key == "title").cloned());
                        blocks.push(Block::new("status", "status: draft\n".into()));
                        blocks.push(Block::new(
                            "page_resource",
                            format!("page_resource: {}\n", page_resource(stem)),
                        ));
                        blocks.push(Block::new("visibility", "visibility: shared\n".into()));
                        blocks.push(Block::new("generated", header.generated(generated_at)));
                        blocks.push(Block::new(
                            "contributors",
                            format!("contributors:\n{}", header.contributor(generated_at)),
                        ));
                        blocks.push(Block::new("scope", "scope: topic\n".into()));
                    }
                }
                blocks.extend(owned.iter().filter(|o| o.key != "title").cloned());
            }
            Some(old) => {
                let mut seen: Vec<&str> = Vec::new();
                for b in old {
                    if header.retired().contains(&b.key.as_str()) {
                        continue;
                    }
                    if let Some(new) = owned.iter().find(|o| o.key == b.key) {
                        blocks.push(new.clone());
                        seen.push(&new.key);
                    } else if header.owned().contains(&b.key.as_str()) {
                        // an owned key this write no longer produces (`sources`)
                    } else {
                        blocks.push(b.clone());
                    }
                }
                if !old.iter().any(|b| b.key == "generated") {
                    blocks.push(Block::new("generated", header.generated(generated_at)));
                } else if contribute {
                    push_contributor(&mut blocks, &header.contributor(generated_at))?;
                }
                for o in &owned {
                    if !seen.contains(&o.key.as_str()) {
                        blocks.push(o.clone());
                    }
                }
            }
        }
        Ok(join_page(&blocks, &body))
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

/// Vocabulary-3 preconditions: the verdict is in the vocabulary's enum, and an
/// existing page is already a v3 `Brief` (a page the migration has not reached
/// is left for the migration, not half-converted here).
fn check_v3(v3: &V3, data: &Value, existing: Option<&str>) -> Result<(), String> {
    let status = str_field(data, "status");
    if let Some(allowed) = &v3.promotion_statuses {
        if !allowed.iter().any(|a| a == status) {
            return Err(format!(
                "promotion-status `{status}` is not in the vocabulary's enum ({})",
                allowed.join(", ")
            ));
        }
    }
    if let Some(old) = existing {
        let (blocks, _) = split_page(old);
        let scalar = |k: &str| blocks.iter().find(|b| b.key == k).map(|b| b.scalar());
        if scalar("type") != Some("Brief")
            || scalar("page_resource").is_none()
            || scalar("visibility").is_none()
        {
            return Err(
                "the page predates vocabulary 3 (it is not a Brief with page_resource and visibility); run the vault's page migration first"
                    .to_string(),
            );
        }
    }
    Ok(())
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
        match write_working_page_using(dir, data, AT, &tools(false)) {
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
        let content = write_with(dir.path(), &sample(), AT);
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
            write_working_page_using(dir.path(), &sample(), AT, &tools(false)),
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

    fn fake_pin(_: &Path) -> Result<String, String> {
        Ok(format!("sha256-v1:{}", "ab".repeat(32)))
    }

    fn tools(adopt: bool) -> Tools<'static> {
        Tools {
            normalise: &fake_ontomark,
            pin: &fake_pin,
            adopt_unmarked: adopt,
        }
    }

    fn write_with(dir: &Path, data: &Value, at: &str) -> String {
        match write_working_page_using(dir, data, at, &tools(true)) {
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
            write_working_page_using(
                dir.path(),
                &sample(),
                AT,
                &Tools {
                    normalise: &fail,
                    pin: &fake_pin,
                    adopt_unmarked: true
                }
            ),
            WorkingPage::Failed(_, _)
        ));
        assert_eq!(std::fs::read_to_string(path).unwrap(), MIGRATED);
    }

    #[test]
    fn a_migrated_stage_page_is_still_this_stages_page() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Some Topic.md"), MIGRATED).unwrap();
        assert!(matches!(
            write_working_page_using(dir.path(), &sample(), AT, &tools(true)),
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
            write_working_page_using(dir.path(), &sample(), AT, &tools(false)),
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
        match write_working_page_using(dir.path(), &data, AT, &tools(false)) {
            WorkingPage::Written(p) => {
                assert_eq!(p.file_name().unwrap().to_string_lossy(), "AI_ML.md")
            }
            other => panic!("{other:?}"),
        }
    }

    // ---- human edits (A2) -------------------------------------------------

    #[test]
    fn a_generated_body_ends_with_a_marker_holding_its_digest() {
        let dir = tempdir().unwrap();
        let content = written(dir.path(), &sample());
        let (_, body) = split_page(&content);
        let marker = body.lines().last().unwrap();
        let above = body.strip_suffix(&format!("{marker}\n")).unwrap();
        let above = above.strip_suffix('\n').unwrap();
        assert_eq!(
            marker,
            format!("{MARKER_PREFIX}{}{MARKER_SUFFIX}", sha256_hex(above))
        );
    }

    #[test]
    fn an_unedited_page_is_regenerated_and_text_below_the_marker_survives() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Some Topic.md");
        written(dir.path(), &sample());
        let mut page = std::fs::read_to_string(&path).unwrap();
        page.push_str("\nMy own note, added below the generated text.\n");
        std::fs::write(&path, &page).unwrap();
        let mut data = sample();
        data["assertions"][0]["claim"] = json!("A newer claim.");
        let content = write_with(dir.path(), &data, "2026-12-01T00:00:00Z");
        assert!(content.contains("A newer claim."), "{content}");
        assert!(!content.contains("- A claim."), "{content}");
        assert!(
            content.ends_with("\nMy own note, added below the generated text.\n"),
            "{content}"
        );
        // and a second identical refresh is a no-op, the tail included
        assert!(matches!(
            write_working_page_using(dir.path(), &data, "2026-12-02T00:00:00Z", &tools(false)),
            WorkingPage::Unchanged(_)
        ));
    }

    #[test]
    fn an_edit_inside_the_generated_text_is_never_overwritten() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Some Topic.md");
        written(dir.path(), &sample());
        let edited = std::fs::read_to_string(&path)
            .unwrap()
            .replace("- A claim.", "- A claim, which I corrected.");
        std::fs::write(&path, &edited).unwrap();
        let mut data = sample();
        data["assertions"][0]["claim"] = json!("A newer claim.");
        assert_eq!(
            write_working_page_using(dir.path(), &data, AT, &tools(true)),
            WorkingPage::Edited(path.clone()),
            "adoption does not override a proven edit"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), edited);
    }

    #[test]
    fn an_unmarked_page_is_refused_unless_adopted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Some Topic.md");
        std::fs::write(&path, MIGRATED).unwrap();
        assert_eq!(
            write_working_page_using(dir.path(), &sample(), AT, &tools(false)),
            WorkingPage::Unmarked(path.clone())
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), MIGRATED);
        let adopted = write_with(dir.path(), &sample(), AT);
        assert!(adopted.contains(MARKER_PREFIX), "{adopted}");
        assert!(!adopted.contains("old body"), "{adopted}");
    }

    // ---- vocabulary 3 -----------------------------------------------------

    const PRINCIPAL: &str =
        "did:nostr:b41654017f6850b13857d19d8ae0e3f88f1365600cab0321e8101c9e92682f7a";
    const SWARM: &str =
        "did:nostr:94773a699927da1ef879b90843890b1fe0e671ae898163f4337dcbe5f96992c0";

    /// A vault root with `ontology/` at `version`, and its `working/`.
    fn vault(version: u32) -> (tempfile::TempDir, PathBuf) {
        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("ontology")).unwrap();
        std::fs::write(
            root.path().join("ontology/vocabulary.yaml"),
            format!("version: {version}\nworking_extensions:\n  promotion-status: {{ type: text, enum: [candidate, candidate_deferred, candidate_rejected, elevated] }}\n"),
        )
        .unwrap();
        std::fs::write(
            root.path().join("ontology/attribution.yaml"),
            format!("generators:\n  - did: {SWARM}\n    kind: process\n    principal: {PRINCIPAL}\nprincipals:\n  - did: {PRINCIPAL}\n    kind: human\n"),
        )
        .unwrap();
        let working = root.path().join("working");
        std::fs::create_dir_all(working.join(LEDGER_SUBDIR)).unwrap();
        for ep in ["ep1", "ep2"] {
            std::fs::write(
                working.join(LEDGER_SUBDIR).join(format!("{ep}.md")),
                "ledger\n",
            )
            .unwrap();
        }
        (root, working)
    }

    fn v3_write(working: &Path, data: &Value, at: &str) -> String {
        match write_working_page_using(working, data, at, &tools(false)) {
            WorkingPage::Written(p) => std::fs::read_to_string(p).unwrap(),
            other => panic!("expected a written page, got {other:?}"),
        }
    }

    #[test]
    fn a_v3_vault_gets_a_brief_with_a_principal_stamp_and_pinned_sources() {
        let (_root, working) = vault(3);
        let content = v3_write(&working, &sample(), AT);
        let version = env!("CARGO_PKG_VERSION");
        let pin = format!("sha256-v1:{}", "ab".repeat(32));
        let expected = format!(
            "---\ntype: Brief\nstatus: draft\npage_resource: {}\nvisibility: shared\ngenerated:\n  by: {PRINCIPAL}\n  via: process:podcast-promote/{version}\n  at: {AT}\ncontributors:\n- by: {PRINCIPAL}\n  via: process:podcast-promote/{version}\n  at: {AT}\nscope: topic\nsources:\n- id: ep1\n  resource: '[[podcast-evidence/ep1]]'\n  rel: derived-from\n  locator: {pin}\n- id: ep2\n  resource: '[[podcast-evidence/ep2]]'\n  rel: derived-from\n  locator: {pin}\ntopic: Some Topic\npromotion-status: candidate_rejected\n---\n",
            page_resource("Some Topic")
        );
        assert!(content.starts_with(&expected), "{content}");
        for retired in [
            "public:",
            "episodes:",
            "assertions:",
            "source:",
            "type: Note",
        ] {
            assert!(
                !content.lines().any(|l| l.starts_with(retired)),
                "{content}"
            );
        }
    }

    #[test]
    fn a_v3_stamp_never_names_a_swarm_key_and_never_claims_review() {
        let (_root, working) = vault(3);
        let content = v3_write(&working, &sample(), AT);
        assert!(!content.contains(SWARM), "{content}");
        for word in ["verified", "approved", "last-reviewed", "receipt"] {
            assert!(!content.contains(word), "{word}: {content}");
        }
        assert!(!content.contains("by: process:"), "{content}");
    }

    #[test]
    fn the_v3_page_identity_is_stable_across_reruns_and_never_a_slug() {
        let (_root, working) = vault(3);
        let first = v3_write(&working, &sample(), AT);
        let resource = format!("page_resource: {}\n", page_resource("Some Topic"));
        assert!(first.contains(&resource), "{first}");
        let again = v3_write(
            &working,
            &json!({
            "topic": "Some Topic", "status": "candidate_rejected", "episodes": ["ep1"],
            "n_assertions": 1, "draft": {"ok": false}, "assertions": []}),
            "2026-11-28T10:00:00Z",
        );
        assert_eq!(again.matches("page_resource:").count(), 1, "{again}");
        assert!(again.contains(&resource), "{again}");
        // the first stamp is kept; one contributor per write
        assert!(
            again.contains(&format!(
                "generated:\n  by: {PRINCIPAL}\n  via: process:podcast-promote/{}\n  at: {AT}\n",
                env!("CARGO_PKG_VERSION")
            )),
            "{again}"
        );
        assert_eq!(again.matches("  at: ").count(), 3, "{again}");
        assert!(!first.contains("some-topic"));
    }

    #[test]
    fn a_migrated_v3_brief_is_refreshed_keeping_its_stamp_and_identity() {
        let (_root, working) = vault(3);
        let migrated = format!(
            "---\ntype: Brief\ntitle: Some Topic\nvisibility: shared\nstatus: stable\nscope: topic\ngenerated:\n  by: {PRINCIPAL}\n  via: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58.55607396Z\nsources:\n- id: ep1\n  resource: '[[podcast-evidence/ep1]]'\n  rel: derived-from\n  locator: sha256-v1:{}\ntopic: Some Topic\npromotion-status: candidate_rejected\npage_resource: urn:visionflow:page:{}\n---\n# Some Topic — processed news\n\nold body\n",
            "00".repeat(32),
            "11".repeat(32)
        );
        std::fs::write(working.join("Some Topic.md"), &migrated).unwrap();
        let content = match write_working_page_using(&working, &sample(), AT, &tools(true)) {
            WorkingPage::Written(p) => std::fs::read_to_string(p).unwrap(),
            other => panic!("{other:?}"),
        };
        assert!(
            content
                .contains("via: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58.55607396Z\n"),
            "{content}"
        );
        assert!(
            content.contains(&format!(
                "page_resource: urn:visionflow:page:{}\n",
                "11".repeat(32)
            )),
            "{content}"
        );
        assert!(content.contains("status: stable\n"), "{content}");
        assert!(
            content.contains(&format!(
                "contributors:\n- by: {PRINCIPAL}\n  via: process:podcast-promote/{}\n  at: {AT}\n",
                env!("CARGO_PKG_VERSION")
            )),
            "{content}"
        );
        assert!(
            content.contains(&format!("locator: sha256-v1:{}\n", "ab".repeat(32))),
            "{content}"
        );
        assert!(
            !content.contains(&"00".repeat(32)),
            "stale pin replaced: {content}"
        );
    }

    #[test]
    fn a_v3_page_stamped_via_this_stage_is_this_stages_page() {
        let note = format!("---\ntype: Brief\npromotion-status: candidate\ngenerated:\n  by: {PRINCIPAL}\n  via: process:podcast-promote/0.1.0\n  at: x\n---\nbody\n");
        assert!(is_stage_page(&note));
        let other = note.replace("podcast-promote", "someone-else");
        assert!(!is_stage_page(&other));
    }

    #[test]
    fn a_ledger_that_does_not_exist_is_not_cited() {
        let (_root, working) = vault(3);
        std::fs::remove_file(working.join(LEDGER_SUBDIR).join("ep2.md")).unwrap();
        let content = v3_write(&working, &sample(), AT);
        assert!(content.contains("- id: ep1\n"), "{content}");
        assert!(!content.contains("ep2"), "{content}");
    }

    #[test]
    fn a_failed_pin_fails_the_write_and_leaves_the_page_alone() {
        let (_root, working) = vault(3);
        let bad = |_: &Path| -> Result<String, String> { Err("no ontomark".into()) };
        let r = write_working_page_using(
            &working,
            &sample(),
            AT,
            &Tools {
                normalise: &fake_ontomark,
                pin: &bad,
                adopt_unmarked: false,
            },
        );
        assert!(matches!(r, WorkingPage::Failed(_, _)), "{r:?}");
        assert!(!working.join("Some Topic.md").exists());
    }

    #[test]
    fn a_verdict_outside_the_vocabulary_enum_is_refused() {
        let (_root, working) = vault(3);
        let mut data = sample();
        data["status"] = json!("candidate_survivor");
        let r = write_working_page_using(&working, &data, AT, &tools(false));
        assert!(matches!(r, WorkingPage::Failed(_, _)), "{r:?}");
    }

    #[test]
    fn a_page_the_v3_migration_has_not_reached_is_left_for_the_migration() {
        let (_root, working) = vault(3);
        let path = working.join("Some Topic.md");
        std::fs::write(&path, MIGRATED).unwrap();
        let r = write_working_page_using(&working, &sample(), AT, &tools(true));
        assert!(matches!(r, WorkingPage::Failed(_, _)), "{r:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), MIGRATED);
    }

    #[test]
    fn a_v2_vault_keeps_the_v2_shape() {
        let (_root, working) = vault(2);
        let content = v3_write(&working, &sample(), AT);
        assert!(
            content
                .starts_with("---\ntype: Note\ntitle: Some Topic\npublic: false\nstatus: draft\n"),
            "{content}"
        );
        assert!(
            !content.contains("via:") && !content.contains("page_resource"),
            "{content}"
        );
    }

    #[test]
    fn a_vault_whose_vocabulary_cannot_be_read_is_not_guessed_at() {
        let (root, working) = vault(3);
        std::fs::write(root.path().join("ontology/vocabulary.yaml"), "version: [\n").unwrap();
        let r = write_working_page_using(&working, &sample(), AT, &tools(false));
        assert!(matches!(r, WorkingPage::Failed(_, _)), "{r:?}");
    }
}
