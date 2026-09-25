//! Tree-read: put the source a hypothesis touches in front of the model.
//!
//! The nightly model is a single chat completion ([`crate::llm`]) with no
//! tools. Until this module it received evaluator receipts but **no source
//! text**, and was then asked for a `git apply`-able diff — against code it had
//! never seen. It answered by narrating an ACCEPT with no ```dream-patch block
//! (gate `CandidateState::NoPatch` → INCONCLUSIVE) or by guessing file
//! contents (`DidNotApply`). Between 2026-09-07 and 2026-09-21 twelve nights
//! ended in the first way and two in the second, and the resulting
//! INCONCLUSIVE streaks parked every repo on standby (ADR-2114).
//!
//! The fix keeps the single-completion design and closes the information gap:
//!
//! 1. **Source plan** — a bounded side-channel call (same tier as the Self-GC
//!    planner, [`crate::context`]) sees tonight's deep, the required evaluator
//!    commands, an excerpt of the evidence pack and an index of tracked paths,
//!    and names at most [`SourceConfig::max_files`] files (optionally line
//!    ranges) it needs. Paths the evidence itself mentions are added
//!    deterministically, so a planner failure still yields useful source.
//! 2. **Validation** — every requested path must be relative, free of `..`,
//!    tracked at the dispatched commit, and outside the secret denylist.
//! 3. **Tree read** — contents come from `git show <commit>:<path>` at the
//!    SAME commit the engine archives to the annexe and builds the candidate
//!    worktree from, so the text the model sees is byte-identical to the
//!    baseline its diff will be applied to.
//! 4. **Section** — rendered as `## Source (from <commit>)` with per-file
//!    headers and explicit elision markers when a file is clipped.
//! 5. **Repair pass** — if the report still declares ACCEPT without a
//!    ```dream-patch block, one follow-up completion is asked for the diff
//!    alone (or an explicit `NO-PATCH: <reason>`). See [`needs_repair`].
//!
//! Every stage is fail-open: an error yields no section and the night runs as
//! before; the gate's `NoPatch` veto is unchanged.

use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::llm::{self, LlmConfig};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Default cap on files inlined per night.
pub const DEFAULT_MAX_FILES: usize = 12;
/// Default total byte budget for the source section (~15k tokens).
pub const DEFAULT_BUDGET_BYTES: usize = 60_000;
/// Default per-file cap; longer files keep head + tail with a marker.
pub const DEFAULT_FILE_CAP_BYTES: usize = 16_000;
/// Default cap on the path index shown to the source planner.
pub const DEFAULT_INDEX_CAP_CHARS: usize = 24_000;
/// Files larger than this are never offered or read (generated/vendored).
const MAX_READABLE_BYTES: u64 = 1_000_000;
/// Evidence excerpt shown to the source planner (tail of the pack).
const PLANNER_EVIDENCE_CHARS: usize = 12_000;

/// Tree-read knobs. Environment overrides mirror the Self-GC convention
/// (`DREAM_SELF_GC*`): `DREAM_SOURCE_READ=0` disables the stage entirely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceConfig {
    pub enabled: bool,
    /// `DREAM_SOURCE_MAX_FILES`.
    pub max_files: usize,
    /// `DREAM_SOURCE_BUDGET` — total bytes of file text in the section.
    pub budget_bytes: usize,
    /// `DREAM_SOURCE_FILE_CAP` — bytes per file before head+tail clipping.
    pub file_cap_bytes: usize,
    /// `DREAM_SOURCE_INDEX_CAP` — chars of path index shown to the planner.
    pub index_cap_chars: usize,
}

impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_files: DEFAULT_MAX_FILES,
            budget_bytes: DEFAULT_BUDGET_BYTES,
            file_cap_bytes: DEFAULT_FILE_CAP_BYTES,
            index_cap_chars: DEFAULT_INDEX_CAP_CHARS,
        }
    }
}

impl SourceConfig {
    /// Read the knobs from the environment, falling back to the defaults.
    pub fn from_env() -> Self {
        fn num(key: &str, default: usize) -> usize {
            std::env::var(key)
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .filter(|n: &usize| *n > 0)
                .unwrap_or(default)
        }
        let d = Self::default();
        Self {
            enabled: std::env::var("DREAM_SOURCE_READ").as_deref() != Ok("0"),
            max_files: num("DREAM_SOURCE_MAX_FILES", d.max_files),
            budget_bytes: num("DREAM_SOURCE_BUDGET", d.budget_bytes),
            file_cap_bytes: num("DREAM_SOURCE_FILE_CAP", d.file_cap_bytes),
            index_cap_chars: num("DREAM_SOURCE_INDEX_CAP", d.index_cap_chars),
        }
    }
}

// ---------------------------------------------------------------------------
// Tracked paths at the dispatched commit
// ---------------------------------------------------------------------------

/// One tracked blob at the dispatched commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedFile {
    pub path: String,
    pub size: u64,
}

/// Every blob tracked at `rev` (`git ls-tree -r -l`). Gitignored files are
/// absent by construction — the same set `git archive` ships to the annexe.
pub fn tracked_files(repo: &Path, rev: &str) -> Option<Vec<TrackedFile>> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-tree", "-r", "-l", "--full-tree", rev])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(parse_ls_tree(&String::from_utf8_lossy(&out.stdout)))
}

/// Parse `git ls-tree -r -l` output: `<mode> <type> <object> <size>\t<path>`.
/// Submodule (`commit`) entries and unparseable lines are skipped.
pub fn parse_ls_tree(text: &str) -> Vec<TrackedFile> {
    text.lines()
        .filter_map(|line| {
            let (meta, path) = line.split_once('\t')?;
            let mut parts = meta.split_whitespace();
            let _mode = parts.next()?;
            if parts.next()? != "blob" {
                return None;
            }
            let _obj = parts.next()?;
            let size = parts.next()?.parse().ok()?;
            Some(TrackedFile {
                path: path.to_string(),
                size,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/// Why a requested path was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathRejection {
    Empty,
    Absolute,
    Traversal,
    Denied,
    NotInTree,
}

/// Secret-bearing or credential-looking files are never sent to a provider,
/// whatever the planner asks for.
pub fn is_denied(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let base = lower.rsplit('/').next().unwrap_or(&lower);
    base.starts_with(".env")
        || lower.contains("secret")
        || lower.contains("credential")
        || lower.contains("private_key")
        || lower.contains("privkey")
        || [
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            ".jks",
            ".keystore",
            ".kdbx",
            ".age",
        ]
        .iter()
        .any(|ext| base.ends_with(ext))
        || [
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
            ".npmrc",
            ".netrc",
            ".pypirc",
            ".git-credentials",
            "mirror-key.txt",
        ]
        .contains(&base)
}

/// Binary or bulky-generated extensions are not worth inlining as text.
fn is_binary_ext(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".bmp",
        ".svgz",
        ".pdf",
        ".zip",
        ".gz",
        ".tgz",
        ".xz",
        ".bz2",
        ".7z",
        ".tar",
        ".wasm",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".eot",
        ".mp3",
        ".mp4",
        ".mov",
        ".webm",
        ".ogg",
        ".wav",
        ".glb",
        ".gltf",
        ".blend",
        ".bin",
        ".so",
        ".dylib",
        ".dll",
        ".exe",
        ".o",
        ".a",
        ".rlib",
        ".sqlite",
        ".db",
        ".parquet",
        ".onnx",
        ".safetensors",
        ".gguf",
        ".npy",
        ".pt",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// Normalise and validate one requested path against the tracked set.
pub fn validate_path(raw: &str, tracked: &HashSet<&str>) -> Result<String, PathRejection> {
    let p = raw.trim().trim_matches('`').trim();
    let p = p.strip_prefix("./").unwrap_or(p);
    if p.is_empty() {
        return Err(PathRejection::Empty);
    }
    let bytes = p.as_bytes();
    if p.starts_with('/')
        || p.starts_with('\\')
        || p.starts_with('~')
        || (bytes.len() >= 2 && bytes[1] == b':')
    {
        return Err(PathRejection::Absolute);
    }
    if p.split(['/', '\\']).any(|c| c == "..") {
        return Err(PathRejection::Traversal);
    }
    if is_denied(p) {
        return Err(PathRejection::Denied);
    }
    if !tracked.contains(p) {
        return Err(PathRejection::NotInTree);
    }
    Ok(p.to_string())
}

// ---------------------------------------------------------------------------
// Planner request / reply
// ---------------------------------------------------------------------------

/// A 1-based inclusive line range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
}

impl LineRange {
    /// Parse `"10-80"`, `"10:80"` or `"42"`; `None` when malformed or empty.
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim();
        let (a, b) = match s.split_once(['-', ':']) {
            Some((a, b)) => (a.trim().parse().ok()?, b.trim().parse().ok()?),
            None => {
                let n: usize = s.parse().ok()?;
                (n, n)
            }
        };
        (a >= 1 && b >= a).then_some(Self { start: a, end: b })
    }
}

/// One file the planner asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRequest {
    pub path: String,
    pub lines: Option<LineRange>,
}

/// Parse the source planner's reply. Accepts `{"files":[{"path":..,
/// "lines":"a-b"}]}` or `{"files":["path", ..]}`, tolerating fences and prose
/// around the JSON object.
pub fn parse_source_plan(reply: &str) -> Option<Vec<SourceRequest>> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Entry {
        Bare(String),
        Full {
            path: String,
            #[serde(default)]
            lines: Option<String>,
        },
    }
    #[derive(Deserialize)]
    struct Plan {
        files: Vec<Entry>,
    }
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    if end < start {
        return None;
    }
    let plan: Plan = serde_json::from_str(&reply[start..=end]).ok()?;
    Some(
        plan.files
            .into_iter()
            .map(|e| match e {
                Entry::Bare(path) => SourceRequest { path, lines: None },
                Entry::Full { path, lines } => SourceRequest {
                    path,
                    lines: lines.as_deref().and_then(LineRange::parse),
                },
            })
            .collect(),
    )
}

/// Tracked paths the evidence text mentions verbatim (compiler errors, test
/// names, evaluator commands), in first-mention order. Tokens may carry a
/// `:line[:col]` suffix, quotes, or trailing punctuation.
pub fn mentioned_paths(text: &str, tracked: &HashSet<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in text.split(|c: char| c.is_whitespace() || "\"'`()[]{}<>,;=|".contains(c)) {
        let mut tok = raw.trim_end_matches(['.', ':']);
        tok = tok.strip_prefix("./").unwrap_or(tok);
        // Drop a trailing `:12` / `:12:5` location suffix.
        while let Some((head, tail)) = tok.rsplit_once(':') {
            if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) {
                tok = head;
            } else {
                break;
            }
        }
        if tok.len() < 3 || !tok.contains(['/', '.']) {
            continue;
        }
        if tracked.contains(tok) && !is_denied(tok) && seen.insert(tok.to_string()) {
            out.push(tok.to_string());
        }
    }
    out
}

/// Merge planner picks (first) with evidence-mentioned paths, validating each
/// and stopping at `max_files`. Returns the kept requests and the rejections.
pub fn select(
    planned: &[SourceRequest],
    mentioned: &[String],
    tracked: &HashSet<&str>,
    max_files: usize,
) -> (Vec<SourceRequest>, Vec<(String, PathRejection)>) {
    let mut kept: Vec<SourceRequest> = Vec::new();
    let mut rejected = Vec::new();
    let candidates = planned
        .iter()
        .cloned()
        .chain(mentioned.iter().map(|p| SourceRequest {
            path: p.clone(),
            lines: None,
        }));
    for req in candidates {
        if kept.len() >= max_files {
            break;
        }
        match validate_path(&req.path, tracked) {
            Ok(path) => {
                if kept.iter().any(|k| k.path == path) {
                    continue;
                }
                if is_binary_ext(&path) {
                    rejected.push((path, PathRejection::Denied));
                    continue;
                }
                kept.push(SourceRequest {
                    path,
                    lines: req.lines,
                });
            }
            Err(r) => rejected.push((req.path.clone(), r)),
        }
    }
    (kept, rejected)
}

/// The path index the planner chooses from: readable text files only,
/// shallow paths first, clipped to `cap` chars with an explicit remainder.
pub fn index_listing(files: &[TrackedFile], cap: usize) -> String {
    let mut usable: Vec<&TrackedFile> = files
        .iter()
        .filter(|f| f.size <= MAX_READABLE_BYTES && !is_denied(&f.path) && !is_binary_ext(&f.path))
        .collect();
    usable.sort_by(|a, b| {
        a.path
            .matches('/')
            .count()
            .cmp(&b.path.matches('/').count())
            .then(a.path.cmp(&b.path))
    });
    let mut out = String::new();
    let mut shown = 0usize;
    for f in &usable {
        let line = format!("{} ({}B)\n", f.path, f.size);
        if out.len() + line.len() > cap {
            break;
        }
        out.push_str(&line);
        shown += 1;
    }
    if shown < usable.len() {
        out.push_str(&format!(
            "… {} more tracked paths not listed (you may still name any tracked path)\n",
            usable.len() - shown
        ));
    }
    out
}

/// The source planner's prompt.
pub fn source_plan_prompt(
    deep: &str,
    scans: &str,
    commands: &[String],
    evidence: &str,
    index: &str,
    max_files: usize,
) -> String {
    let cmds = if commands.is_empty() {
        "(none)".to_string()
    } else {
        commands
            .iter()
            .map(|c| format!("- `{c}`"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        r#"You are choosing which source files an overnight research engine should read before proposing ONE small, testable code change for **{deep}** (scans: {scans}).

The engine will run these required evaluator commands against the proposed change:
{cmds}

Tonight's evidence (tail):
```
{evidence}
```

Tracked files at the commit under test:
{index}
Name at most {max_files} files whose exact current text you need in order to write a correct unified diff (the files you would change, plus anything a change must stay consistent with — the evaluator scripts, the test that fails, the config it reads). Prefer a line range for large files.

Respond with ONLY a JSON object, no prose:
{{"files":[{{"path":"<repo-relative path>","lines":"<start-end, optional>"}}]}}"#,
        evidence = evidence
    )
}

// ---------------------------------------------------------------------------
// Tree read + rendering
// ---------------------------------------------------------------------------

/// Read `path` at `rev`. `None` for missing, non-UTF-8 or NUL-bearing blobs.
pub fn read_blob(repo: &Path, rev: &str, path: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["show", &format!("{rev}:{path}")])
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.contains(&0) {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

/// Lines `range` (1-based, inclusive, clamped) of `text`, plus the file's
/// total line count.
pub fn slice_lines(text: &str, range: LineRange) -> (String, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    if total == 0 || range.start > total {
        return (String::new(), total);
    }
    let end = range.end.min(total);
    (lines[range.start - 1..end].join("\n"), total)
}

/// Head + tail clip on char boundaries. The marker tells the model text is
/// missing so it never writes a hunk against content it did not see.
pub fn clip_file(s: &str, cap: usize) -> (String, bool) {
    if s.len() <= cap {
        return (s.to_string(), false);
    }
    let head = cap * 2 / 3;
    let tail = cap - head;
    let mut h = head.min(s.len());
    while !s.is_char_boundary(h) {
        h -= 1;
    }
    let mut t = s.len() - tail;
    while !s.is_char_boundary(t) {
        t += 1;
    }
    let elided_lines = s[h..t].lines().count();
    (
        format!(
            "{}\n…[{} bytes / ~{} lines elided by the engine — do NOT write hunks inside this gap; name a line range tomorrow if you need it]…\n{}",
            &s[..h],
            t - h,
            elided_lines,
            &s[t..]
        ),
        true,
    )
}

/// One file as it entered (or failed to enter) the section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileRecord {
    pub path: String,
    pub bytes: usize,
    pub clipped: bool,
    pub lines: Option<LineRange>,
    /// `inlined` | `unreadable` | `over-budget`.
    pub status: String,
}

/// Receipt of tonight's tree read, persisted as `source.json`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SourceRecord {
    pub commit: String,
    pub planner: String,
    pub files: Vec<FileRecord>,
    pub rejected: Vec<(String, String)>,
    pub section_bytes: usize,
}

/// A file fetched from the tree, ready to render.
#[derive(Debug, Clone)]
pub struct FetchedFile {
    pub path: String,
    pub lines: Option<LineRange>,
    pub text: Option<String>,
}

/// Render `## Source (from <commit>)`. Pure: the caller supplies file text.
pub fn render_section(
    commit: &str,
    files: &[FetchedFile],
    cfg: &SourceConfig,
    redact: &dyn Fn(&str) -> String,
) -> (String, Vec<FileRecord>) {
    let mut out = format!(
        "\n## Source (from `{commit}`)\n\n\
         These files are read by the engine from commit `{commit}` — the exact tree the \
         evaluators ran against and your diff will be applied to. Write hunks only against \
         text shown here; anything marked elided is not visible to you.\n\n"
    );
    let mut records = Vec::new();
    let mut spent = 0usize;
    for f in files {
        let Some(text) = &f.text else {
            records.push(FileRecord {
                path: f.path.clone(),
                bytes: 0,
                clipped: false,
                lines: f.lines,
                status: "unreadable".into(),
            });
            continue;
        };
        if spent >= cfg.budget_bytes {
            records.push(FileRecord {
                path: f.path.clone(),
                bytes: 0,
                clipped: false,
                lines: f.lines,
                status: "over-budget".into(),
            });
            continue;
        }
        let (body, header) = match f.lines {
            Some(r) => {
                let (slice, total) = slice_lines(text, r);
                let end = r.end.min(total);
                (slice, format!("lines {}-{} of {}", r.start, end, total))
            }
            None => (
                text.clone(),
                format!("{} lines, {} bytes", text.lines().count(), text.len()),
            ),
        };
        let cap = cfg.file_cap_bytes.min(cfg.budget_bytes - spent);
        let (body, clipped) = clip_file(&body, cap);
        let body = redact(&body);
        spent += body.len();
        out.push_str(&format!(
            "### `{}` ({})\n```\n{}\n```\n\n",
            f.path, header, body
        ));
        records.push(FileRecord {
            path: f.path.clone(),
            bytes: body.len(),
            clipped,
            lines: f.lines,
            status: "inlined".into(),
        });
    }
    let omitted: Vec<&str> = records
        .iter()
        .filter(|r| r.status == "over-budget")
        .map(|r| r.path.as_str())
        .collect();
    if !omitted.is_empty() {
        out.push_str(&format!(
            "(Not inlined — source budget reached: {})\n",
            omitted.join(", ")
        ));
    }
    (out, records)
}

/// Full tree-read stage: plan → validate → read → render. `None` when
/// disabled, when the tree cannot be listed, or when nothing was readable;
/// the night then runs exactly as before.
#[allow(clippy::too_many_arguments)]
pub async fn gather(
    llm_cfg: &LlmConfig,
    fallback: Option<&LlmConfig>,
    repo: &Path,
    commit: &str,
    deep: &str,
    scans: &str,
    commands: &[String],
    evidence: &str,
    cfg: &SourceConfig,
    redact: &dyn Fn(&str) -> String,
) -> Option<(String, SourceRecord)> {
    if !cfg.enabled {
        return None;
    }
    let files = tracked_files(repo, commit)?;
    let tracked: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let oversize: HashSet<&str> = files
        .iter()
        .filter(|f| f.size > MAX_READABLE_BYTES)
        .map(|f| f.path.as_str())
        .collect();

    let evidence_tail = tail_chars(evidence, PLANNER_EVIDENCE_CHARS);
    let prompt = source_plan_prompt(
        deep,
        scans,
        commands,
        &redact(evidence_tail),
        &index_listing(&files, cfg.index_cap_chars),
        cfg.max_files,
    );
    let planner_cfg = LlmConfig {
        max_tokens: llm_cfg.max_tokens.clamp(2048, 4096),
        ..llm_cfg.clone()
    };
    let (planned, planner_status) = match llm::call(&planner_cfg, &prompt).await {
        Ok(r) => match parse_source_plan(&r) {
            Some(p) => (p, "ok".to_string()),
            None => (Vec::new(), "unparseable".to_string()),
        },
        Err(e) => match fallback {
            Some(fb) => {
                let fb_cfg = LlmConfig {
                    max_tokens: fb.max_tokens.clamp(2048, 4096),
                    ..fb.clone()
                };
                match llm::call(&fb_cfg, &prompt)
                    .await
                    .ok()
                    .and_then(|r| parse_source_plan(&r))
                {
                    Some(p) => (p, "ok-fallback".to_string()),
                    None => (Vec::new(), format!("failed: {e}")),
                }
            }
            None => (Vec::new(), format!("failed: {e}")),
        },
    };
    if planned.is_empty() {
        warn!(status = %planner_status, "source planner gave no files — using evidence-mentioned paths only");
    }
    let mentioned: Vec<String> =
        mentioned_paths(&format!("{}\n{}", commands.join("\n"), evidence), &tracked)
            .into_iter()
            .filter(|p| !oversize.contains(p.as_str()))
            .collect();
    let (selected, rejected) = select(&planned, &mentioned, &tracked, cfg.max_files);
    if selected.is_empty() {
        info!("tree-read selected no files — prompt carries no source section");
        return None;
    }
    let fetched: Vec<FetchedFile> = selected
        .iter()
        .map(|r| FetchedFile {
            path: r.path.clone(),
            lines: r.lines,
            text: if oversize.contains(r.path.as_str()) {
                None
            } else {
                read_blob(repo, commit, &r.path)
            },
        })
        .collect();
    let (section, records) = render_section(commit, &fetched, cfg, redact);
    let inlined = records.iter().filter(|r| r.status == "inlined").count();
    info!(
        planner = %planner_status,
        selected = selected.len(),
        inlined,
        rejected = rejected.len(),
        bytes = section.len(),
        "tree-read source section built"
    );
    if inlined == 0 {
        return None;
    }
    let record = SourceRecord {
        commit: commit.to_string(),
        planner: planner_status,
        files: records,
        rejected: rejected
            .into_iter()
            .map(|(p, r)| (p, format!("{r:?}")))
            .collect(),
        section_bytes: section.len(),
    };
    Some((section, record))
}

fn tail_chars(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut start = s.len() - n;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

// ---------------------------------------------------------------------------
// Repair pass
// ---------------------------------------------------------------------------

/// Whether the one-shot repair pass should run: the model declared ACCEPT
/// (strictly parsed) but emitted no usable ```dream-patch block.
pub fn needs_repair(claimed_accept: bool, patch_present: bool) -> bool {
    claimed_accept && !patch_present
}

/// The repair prompt: the model's own report plus the same source section,
/// asking for nothing but the diff.
pub fn repair_prompt(report: &str, source_section: Option<&str>) -> String {
    format!(
        "Your report below declares VERDICT: ACCEPT but contains no ```dream-patch block, so the \
         engine has nothing to apply and re-evaluate — the ACCEPT will be vetoed.\n\n\
         Reply with EXACTLY ONE of:\n\
         1. the candidate change as one git-apply-able unified diff (paths relative to the repo \
         root, `a/` and `b/` prefixes, context lines copied verbatim from the source shown) inside\n\
         ```dream-patch\n<diff>\n```\n\
         2. a single line `NO-PATCH: <reason>` if the finding needs no code change or you cannot \
         write the diff from the source available.\n\n\
         No other text.\n{}\n\n---\n\n# Your report\n\n{}",
        source_section.unwrap_or("\n(No source section was available tonight.)\n"),
        report
    )
}

/// What the repair pass produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", content = "detail", rename_all = "kebab-case")]
pub enum RepairOutcome {
    /// A non-empty diff was recovered.
    Patch(String),
    /// The model said there is no patch, with its reason.
    NoPatch(String),
    /// Neither a diff nor a NO-PATCH line.
    Absent,
    /// The completion call itself failed.
    LlmError(String),
}

/// Classify a repair reply.
pub fn parse_repair(reply: &str) -> RepairOutcome {
    if let Some(p) = crate::persist::extract_patch(reply) {
        return RepairOutcome::Patch(p);
    }
    for line in reply.lines() {
        if let Some(reason) = line.trim().strip_prefix("NO-PATCH:") {
            return RepairOutcome::NoPatch(reason.trim().to_string());
        }
    }
    RepairOutcome::Absent
}

/// Receipt of the repair pass, persisted as `repair.json`.
#[derive(Debug, Clone, Serialize)]
pub struct RepairRecord {
    pub ran: bool,
    pub outcome: RepairOutcome,
    pub patch_bytes: usize,
    pub model: String,
}

/// Run the repair pass (primary, then fallback provider).
pub async fn repair(
    llm_cfg: &LlmConfig,
    fallback: Option<&LlmConfig>,
    report: &str,
    source_section: Option<&str>,
) -> RepairRecord {
    let prompt = repair_prompt(report, source_section);
    let (outcome, model) = match llm::call(llm_cfg, &prompt).await {
        Ok(r) => (parse_repair(&r), llm_cfg.model.clone()),
        Err(e) => match fallback {
            Some(fb) => match llm::call(fb, &prompt).await {
                Ok(r) => (parse_repair(&r), fb.model.clone()),
                Err(e2) => (
                    RepairOutcome::LlmError(format!("primary: {e}; fallback: {e2}")),
                    fb.model.clone(),
                ),
            },
            None => (
                RepairOutcome::LlmError(e.to_string()),
                llm_cfg.model.clone(),
            ),
        },
    };
    let patch_bytes = match &outcome {
        RepairOutcome::Patch(p) => p.len(),
        _ => 0,
    };
    RepairRecord {
        ran: true,
        outcome,
        patch_bytes,
        model,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tracked<'a>(paths: &'a [&'a str]) -> HashSet<&'a str> {
        paths.iter().copied().collect()
    }

    #[test]
    fn parses_ls_tree_blobs_and_skips_submodules() {
        let text = "100644 blob abc123     120\tsrc/lib.rs\n\
                    160000 commit def456       -\tvendor/sub\n\
                    100755 blob 0a1b2c    9000\tscripts/check.sh\n\
                    garbage line\n";
        let files = parse_ls_tree(text);
        assert_eq!(
            files,
            vec![
                TrackedFile {
                    path: "src/lib.rs".into(),
                    size: 120
                },
                TrackedFile {
                    path: "scripts/check.sh".into(),
                    size: 9000
                },
            ]
        );
    }

    #[test]
    fn validation_refuses_traversal_absolute_denied_and_untracked() {
        let t = tracked(&[
            "src/lib.rs",
            ".env.local",
            "config/secrets.toml",
            "certs/server.pem",
        ]);
        assert_eq!(validate_path("src/lib.rs", &t), Ok("src/lib.rs".into()));
        assert_eq!(validate_path("./src/lib.rs", &t), Ok("src/lib.rs".into()));
        assert_eq!(validate_path("`src/lib.rs`", &t), Ok("src/lib.rs".into()));
        assert_eq!(validate_path("", &t), Err(PathRejection::Empty));
        assert_eq!(
            validate_path("/etc/passwd", &t),
            Err(PathRejection::Absolute)
        );
        assert_eq!(validate_path("~/x", &t), Err(PathRejection::Absolute));
        assert_eq!(validate_path("C:\\x", &t), Err(PathRejection::Absolute));
        assert_eq!(
            validate_path("src/../../etc/passwd", &t),
            Err(PathRejection::Traversal)
        );
        assert_eq!(validate_path("..\\x", &t), Err(PathRejection::Traversal));
        assert_eq!(validate_path(".env.local", &t), Err(PathRejection::Denied));
        assert_eq!(
            validate_path("config/secrets.toml", &t),
            Err(PathRejection::Denied)
        );
        assert_eq!(
            validate_path("certs/server.pem", &t),
            Err(PathRejection::Denied)
        );
        assert_eq!(
            validate_path("src/missing.rs", &t),
            Err(PathRejection::NotInTree)
        );
    }

    #[test]
    fn denylist_covers_key_material() {
        for p in [
            ".env",
            "deploy/.env.production",
            "keys/id_ed25519",
            "a/b/.npmrc",
            "x/credentials.json",
            "tls/server.key",
            "vault.kdbx",
            "nostr-mirror/mirror-key.txt",
        ] {
            assert!(is_denied(p), "{p} must be denied");
        }
        for p in ["src/keyboard.rs", "docs/environment.md", "src/lib.rs"] {
            assert!(!is_denied(p), "{p} must be allowed");
        }
    }

    #[test]
    fn plan_parsing_accepts_both_shapes_and_fences() {
        let reply = "Sure.\n```json\n{\"files\":[{\"path\":\"src/a.rs\",\"lines\":\"10-40\"},\"src/b.rs\",{\"path\":\"src/c.rs\",\"lines\":\"bad\"}]}\n```";
        let plan = parse_source_plan(reply).unwrap();
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].lines, Some(LineRange { start: 10, end: 40 }));
        assert_eq!(
            plan[1],
            SourceRequest {
                path: "src/b.rs".into(),
                lines: None
            }
        );
        assert_eq!(plan[2].lines, None);
        assert!(parse_source_plan("no json here").is_none());
        assert!(parse_source_plan("} {").is_none());
    }

    #[test]
    fn line_ranges_parse_and_reject_nonsense() {
        assert_eq!(
            LineRange::parse("5-9"),
            Some(LineRange { start: 5, end: 9 })
        );
        assert_eq!(
            LineRange::parse("5:9"),
            Some(LineRange { start: 5, end: 9 })
        );
        assert_eq!(
            LineRange::parse("42"),
            Some(LineRange { start: 42, end: 42 })
        );
        assert_eq!(LineRange::parse("0-3"), None);
        assert_eq!(LineRange::parse("9-5"), None);
        assert_eq!(LineRange::parse("x"), None);
    }

    #[test]
    fn mentioned_paths_strip_locations_and_ignore_untracked() {
        let t = tracked(&["src/main.rs", "scripts/check.sh", "package.json", ".env"]);
        let text =
            "error[E0425]: at src/main.rs:12:5\n run `bash scripts/check.sh`; see (package.json). \
                    also src/main.rs again and ./.env and nowhere/else.rs";
        assert_eq!(
            mentioned_paths(text, &t),
            vec![
                "src/main.rs".to_string(),
                "scripts/check.sh".into(),
                "package.json".into()
            ]
        );
    }

    #[test]
    fn select_prefers_planner_dedups_and_caps() {
        let t = tracked(&["a.rs", "b.rs", "c.rs", "d.png", ".env"]);
        let planned = vec![
            SourceRequest {
                path: "b.rs".into(),
                lines: None,
            },
            SourceRequest {
                path: "../x".into(),
                lines: None,
            },
            SourceRequest {
                path: ".env".into(),
                lines: None,
            },
            SourceRequest {
                path: "d.png".into(),
                lines: None,
            },
        ];
        let mentioned = vec!["b.rs".to_string(), "a.rs".into(), "c.rs".into()];
        let (kept, rejected) = select(&planned, &mentioned, &t, 2);
        assert_eq!(
            kept.iter().map(|k| k.path.as_str()).collect::<Vec<_>>(),
            vec!["b.rs", "a.rs"]
        );
        assert!(rejected.contains(&("../x".into(), PathRejection::Traversal)));
        assert!(rejected.contains(&(".env".into(), PathRejection::Denied)));
        assert!(rejected.contains(&("d.png".into(), PathRejection::Denied)));
    }

    #[test]
    fn index_is_shallow_first_filtered_and_capped() {
        let files = vec![
            TrackedFile {
                path: "src/deep/x.rs".into(),
                size: 10,
            },
            TrackedFile {
                path: "README.md".into(),
                size: 10,
            },
            TrackedFile {
                path: "img/logo.png".into(),
                size: 10,
            },
            TrackedFile {
                path: ".env".into(),
                size: 10,
            },
            TrackedFile {
                path: "huge.json".into(),
                size: 5_000_000,
            },
            TrackedFile {
                path: "src/lib.rs".into(),
                size: 10,
            },
        ];
        let full = index_listing(&files, 10_000);
        let order: Vec<&str> = full.lines().map(|l| l.split(' ').next().unwrap()).collect();
        assert_eq!(order, vec!["README.md", "src/lib.rs", "src/deep/x.rs"]);
        let clipped = index_listing(&files, 20);
        assert!(clipped.contains("more tracked paths not listed"));
    }

    #[test]
    fn slicing_and_clipping_mark_what_is_missing() {
        let text = (1..=10)
            .map(|i| format!("line{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            slice_lines(&text, LineRange { start: 3, end: 4 }),
            ("line3\nline4".into(), 10)
        );
        assert_eq!(
            slice_lines(&text, LineRange { start: 9, end: 99 }).0,
            "line9\nline10"
        );
        assert_eq!(slice_lines(&text, LineRange { start: 20, end: 30 }).0, "");
        let big = "é".repeat(5_000);
        let (c, clipped) = clip_file(&big, 1_000);
        assert!(clipped);
        assert!(c.contains("elided by the engine"));
        assert!(c.len() < big.len());
        assert_eq!(clip_file("tiny", 100), ("tiny".into(), false));
    }

    #[test]
    fn section_formatting_budget_and_unreadable() {
        let cfg = SourceConfig {
            budget_bytes: 40,
            file_cap_bytes: 30,
            ..SourceConfig::default()
        };
        let files = vec![
            FetchedFile {
                path: "a.rs".into(),
                lines: None,
                text: Some("fn a() {}\n".into()),
            },
            FetchedFile {
                path: "gone.rs".into(),
                lines: None,
                text: None,
            },
            FetchedFile {
                path: "b.rs".into(),
                lines: Some(LineRange { start: 2, end: 2 }),
                text: Some("x\ny\nz".into()),
            },
            FetchedFile {
                path: "c.rs".into(),
                lines: None,
                text: Some("c".repeat(100)),
            },
            FetchedFile {
                path: "d.rs".into(),
                lines: None,
                text: Some("d".into()),
            },
        ];
        let redact = |s: &str| s.replace("fn", "FN");
        let (section, records) = render_section("abc123", &files, &cfg, &redact);
        assert!(section.starts_with("\n## Source (from `abc123`)"));
        assert!(section.contains("### `a.rs` (1 lines, 10 bytes)\n```\nFN a() {}\n"));
        assert!(section.contains("### `b.rs` (lines 2-2 of 3)\n```\ny\n```"));
        assert_eq!(records[1].status, "unreadable");
        assert_eq!(records[3].status, "inlined");
        assert!(records[3].clipped);
        assert_eq!(records[4].status, "over-budget");
        assert!(section.contains("source budget reached: d.rs"));
    }

    #[test]
    fn repair_runs_only_for_accept_without_patch() {
        assert!(needs_repair(true, false));
        assert!(!needs_repair(true, true));
        assert!(!needs_repair(false, false));
        assert!(!needs_repair(false, true));
    }

    #[test]
    fn repair_reply_classification() {
        let diff = "```dream-patch\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```";
        assert!(matches!(parse_repair(diff), RepairOutcome::Patch(p) if p.contains("+b")));
        assert_eq!(
            parse_repair("NO-PATCH: pure measurement"),
            RepairOutcome::NoPatch("pure measurement".into())
        );
        assert_eq!(parse_repair("I think it works"), RepairOutcome::Absent);
        let prompt = repair_prompt("VERDICT: ACCEPT", Some("## Source (from `r`)"));
        assert!(prompt.contains("```dream-patch"));
        assert!(prompt.contains("NO-PATCH:"));
        assert!(prompt.contains("## Source (from `r`)"));
    }

    #[test]
    fn reads_blobs_at_a_commit_not_the_worktree() {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path();
        let git = |a: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(a)
                .output()
                .unwrap()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(repo.join("f.txt"), "committed\n").unwrap();
        std::fs::write(repo.join("bin.dat"), [0u8, 1, 2]).unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "c"]);
        let rev = String::from_utf8(git(&["rev-parse", "HEAD"]).stdout)
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(repo.join("f.txt"), "dirty worktree\n").unwrap();
        assert_eq!(
            read_blob(repo, &rev, "f.txt").as_deref(),
            Some("committed\n")
        );
        assert_eq!(read_blob(repo, &rev, "bin.dat"), None);
        assert_eq!(read_blob(repo, &rev, "missing"), None);
        let files = tracked_files(repo, &rev).unwrap();
        assert!(files.iter().any(|f| f.path == "f.txt" && f.size == 10));
    }

    #[test]
    fn env_knobs_fall_back_to_defaults() {
        // Only asserts the defaults: env mutation would race other tests.
        let d = SourceConfig::default();
        assert!(d.enabled);
        assert_eq!(d.max_files, 12);
        assert_eq!(d.budget_bytes, 60_000);
        assert_eq!(d.file_cap_bytes, 16_000);
        assert_eq!(d.index_cap_chars, 24_000);
    }
}
