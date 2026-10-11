//! ADR-061: materialise an ACCEPT night's candidate as a **draft PR**.
//!
//! The audit (2026-08-26) found the promotion loop broken upstream of the human
//! merge: the engine validated candidates but never persisted them, so wins
//! evaporated as reports. This closes that gap. On ACCEPT the LLM emits its
//! candidate change as a unified diff in a ```dream-patch fenced block; the
//! engine extracts it, applies it on an isolated **git worktree** at HEAD
//! (never touching the operator's working tree), pushes a namespaced
//! `dream/<deep>-<date>` branch, and opens a **DRAFT** PR. The merge stays human
//! — evaluation is not promotion; this only turns the win into a reviewable
//! artifact the cockpit pending-merge queue (ADR-056) can surface.

use std::path::Path;
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("git {0} failed: {1}")]
    Git(String, String),
    /// Every apply strategy in [`apply_attempts`] failed; carries the last
    /// attempt's stderr so the gate's `DidNotApply` detail says why.
    #[error("patch did not apply: {0}")]
    PatchDidNotApply(String),
    #[error("no candidate patch in report")]
    NoPatch,
}

#[derive(Debug, Clone)]
pub struct PrOutcome {
    pub branch: String,
    pub pr_url: Option<String>,
    pub pushed: bool,
}

/// Whether a unified diff deletes a binary file. Candidates may not: a
/// deleted binary cannot be reviewed from the diff, and git records only
/// "Binary files … differ" for it, so the loss is invisible in review.
pub fn deletes_binary(patch: &str) -> bool {
    patch.split("diff --git ").skip(1).any(|file| {
        file.contains("deleted file mode")
            && (file.contains("Binary files") || file.contains("GIT binary patch"))
    })
}

/// Pull the candidate patch out of the first ```dream-patch fenced block.
/// Returns None when absent or empty (a finding with no code change).
///
/// The block ends at the first line that is *only* a fence (trailing
/// whitespace allowed). A bare "```" anywhere else is diff content: every diff
/// line carries a one-character prefix, so a Rust doc-test fence (`/// ````)
/// or a Markdown code fence edited by the patch appears as ` /// ```` or
/// `+```` and never as a fence line. Ending at the first "```" substring cut
/// such patches mid-hunk ("corrupt patch at :14", factrail 2026-10-08/10).
pub fn extract_patch(report: &str) -> Option<String> {
    const TAG: &str = "```dream-patch";
    let start = report.find(TAG)? + TAG.len();
    let rest = &report[start..];
    // Skip the remainder of the opening fence line.
    let body_start = rest.find('\n').map(|i| i + 1)?;
    let rest = &rest[body_start..];
    let mut end = None;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "```" {
            end = Some(offset);
            break;
        }
        offset += line.len();
    }
    let body = &rest[..end?];
    if body.trim().is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

/// Mechanical repairs for model-written diffs that `git apply` refuses even
/// though every hunk's text is in the base tree. Each repair was found by
/// replaying vetoed nights (2026-10-08..10) against their frozen commits:
///
/// * **Missing `diff --git` headers.** Without them `git apply --recount`
///   reads the next file's `--- a/…` header as a deleted line of the previous
///   hunk (project2 2026-10-09). A header is synthesised for every
///   `---`/`+++` pair that lacks one.
/// * **Trailing blank separator lines** at the end of a hunk are dropped:
///   in `--recount` mode git counts them as context the file may not have.
/// * **Asymmetric context.** A hunk with leading context but none trailing
///   is anchored by git to end-of-file, so it fails anywhere mid-file
///   (dream-machine 2026-10-09). When the hunk's old lines occur exactly once
///   in the base file and not at its end, up to three following lines of the
///   real file are appended as trailing context.
///
/// Only headers and context lines change: every `+`/`-` line is kept
/// byte-for-byte, so the normalised diff makes exactly the model's change.
/// A path that appears in more than one section is left alone (its second
/// section would be anchored against a file the first already changed).
/// `read` returns the base-revision text of a path. Returns the normalised
/// patch and a note per repair made; no notes means nothing changed.
pub fn normalise_patch(
    patch: &str,
    read: impl Fn(&str) -> Option<String>,
) -> (String, Vec<String>) {
    let lines: Vec<&str> = patch.lines().collect();
    let mut notes: Vec<String> = Vec::new();
    let header_path = |l: &str, prefix: &str| -> Option<String> {
        let raw = l.strip_prefix(prefix)?;
        // GNU diff appends a tab and a timestamp.
        let raw = raw.split('\t').next().unwrap_or(raw).trim();
        if raw == "/dev/null" {
            return Some("/dev/null".into());
        }
        let raw = raw
            .strip_prefix("a/")
            .or_else(|| raw.strip_prefix("b/"))
            .unwrap_or(raw);
        Some(raw.to_string())
    };
    // Paths per section, to refuse normalising a path touched twice.
    let mut seen: Vec<String> = Vec::new();
    let mut repeated = false;
    for (i, l) in lines.iter().enumerate() {
        if l.starts_with("--- ") && lines.get(i + 1).is_some_and(|n| n.starts_with("+++ ")) {
            let a = header_path(l, "--- ").unwrap_or_default();
            let b = header_path(lines[i + 1], "+++ ").unwrap_or_default();
            let name = if b == "/dev/null" { a } else { b };
            if seen.contains(&name) {
                repeated = true;
            }
            seen.push(name);
        }
    }
    if repeated {
        return (patch.to_string(), Vec::new());
    }

    let is_file_header = |i: usize| {
        lines[i].starts_with("--- ") && lines.get(i + 1).is_some_and(|n| n.starts_with("+++ "))
    };
    let mut out: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    let mut base: Option<Vec<String>> = None;
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i];
        if is_file_header(i) {
            let a = header_path(l, "--- ").unwrap_or_default();
            let b = header_path(lines[i + 1], "+++ ").unwrap_or_default();
            let name = if b == "/dev/null" {
                a.clone()
            } else {
                b.clone()
            };
            let has_git_header = out
                .iter()
                .rev()
                .take(4)
                .any(|p| p.starts_with("diff --git "));
            if !has_git_header {
                out.push(format!("diff --git a/{name} b/{name}"));
                if a == "/dev/null" {
                    out.push("new file mode 100644".into());
                }
                if b == "/dev/null" {
                    out.push("deleted file mode 100644".into());
                }
                notes.push(format!("header synthesised for {name}"));
            }
            base = if a == "/dev/null" {
                None
            } else {
                read(&name).map(|t| t.lines().map(str::to_string).collect())
            };
            current = Some(name);
            out.push(l.to_string());
            out.push(lines[i + 1].to_string());
            i += 2;
            continue;
        }
        if l.starts_with("@@") {
            let mut body: Vec<String> = Vec::new();
            let mut j = i + 1;
            while j < lines.len()
                && !lines[j].starts_with("@@")
                && !lines[j].starts_with("diff --git ")
                && !is_file_header(j)
            {
                body.push(lines[j].to_string());
                j += 1;
            }
            let mut dropped = 0;
            while body.last().is_some_and(|b| b.is_empty()) {
                body.pop();
                dropped += 1;
            }
            if dropped > 0 {
                notes.push(format!(
                    "{} trailing blank line(s) dropped from a hunk in {}",
                    dropped,
                    current.as_deref().unwrap_or("?")
                ));
            }
            if let Some(file) = base.as_ref() {
                if let Some(extra) = trailing_context(&body, file) {
                    notes.push(format!(
                        "{} line(s) of trailing context added to a hunk in {}",
                        extra.len(),
                        current.as_deref().unwrap_or("?")
                    ));
                    body.extend(extra.into_iter().map(|x| format!(" {x}")));
                }
            }
            out.push(l.to_string());
            out.extend(body);
            i = j;
            continue;
        }
        out.push(l.to_string());
        i += 1;
    }
    let mut text = out.join("\n");
    text.push('\n');
    (text, notes)
}

/// The real lines to append to a hunk with leading context but no trailing
/// context, or None when no padding is needed or it cannot be done safely.
fn trailing_context(body: &[String], file: &[String]) -> Option<Vec<String>> {
    if body.iter().any(|b| b.starts_with('\\')) {
        return None; // "\ No newline at end of file": the hunk is at EOF.
    }
    let ctx = |b: &String| b.starts_with(' ') || b.is_empty();
    let lead = body.iter().take_while(|b| ctx(b)).count();
    let trail = body.iter().rev().take_while(|b| ctx(b)).count();
    if lead == 0 || trail > 0 || lead == body.len() {
        return None;
    }
    let old: Vec<&str> = body
        .iter()
        .filter(|b| ctx(b) || b.starts_with('-'))
        .map(|b| if b.is_empty() { "" } else { &b[1..] })
        .collect();
    if old.is_empty() || old.len() > file.len() {
        return None;
    }
    let hits: Vec<usize> = (0..=file.len() - old.len())
        .filter(|&s| {
            file[s..s + old.len()]
                .iter()
                .map(String::as_str)
                .eq(old.iter().copied())
        })
        .collect();
    let [start] = hits[..] else { return None };
    let end = start + old.len();
    if end >= file.len() {
        return None; // genuinely at end of file: git's anchoring is right.
    }
    let want = lead.min(3);
    Some(file[end..(end + want).min(file.len())].to_vec())
}

/// `dream/<slug(deep)>-<date>` — the namespaced branch for tonight's candidate.
pub fn branch_name(deep: &str, date: &str) -> String {
    let slug: String = deep
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "cycle" } else { slug };
    format!("dream/{}-{}", slug, date)
}

fn git(dir: &Path, args: &[&str]) -> Result<String, PersistError> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output()?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(PersistError::Git(
            args.first().copied().unwrap_or("").to_string(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ))
    }
}

/// The ordered `git apply` strategies tried against the candidate worktree.
///
/// Model-written diffs fail in predictable ways: wrong hunk line counts
/// (`--recount` recomputes them from the hunk body), whitespace drift in
/// context lines (`--ignore-whitespace`), and occasionally a stale base that a
/// three-way merge can still land. `git apply` is atomic without `--reject`,
/// so a failed strategy leaves the tree untouched for the next one. `--3way`
/// only helps when the diff names real blob ids (`index <a>..<b>` lines) that
/// the repo holds, so it is tried last and only then.
pub fn apply_attempts(patch: &str) -> Vec<Vec<&'static str>> {
    let mut v = vec![
        vec!["apply"],
        vec!["apply", "--recount"],
        vec!["apply", "--recount", "--ignore-whitespace"],
    ];
    let names_blobs = patch.lines().any(|l| {
        l.strip_prefix("index ")
            .and_then(|r| r.split_whitespace().next())
            .and_then(|range| range.split_once(".."))
            .is_some_and(|(a, b)| {
                a.len() >= 7
                    && b.len() >= 7
                    && a.bytes().chain(b.bytes()).all(|c| c.is_ascii_hexdigit())
            })
    });
    if names_blobs {
        v.push(vec!["apply", "--3way"]);
    }
    v
}

/// Create the branch + commit in an isolated worktree at HEAD, apply the patch.
/// Returns the worktree path (caller must `remove_worktree`) or an error after
/// cleaning up. Does NOT push — that is a separate, network-touching step so the
/// commit-building logic stays unit-testable offline.
pub fn build_branch_worktree(
    repo: &Path,
    branch: &str,
    patch: &str,
    commit_msg: &str,
) -> Result<std::path::PathBuf, PersistError> {
    build_branch_worktree_at(repo, branch, patch, commit_msg, "HEAD")
}

/// [`build_branch_worktree`] at an explicit base revision. The nightly
/// candidate path passes the dispatched commit, so the diff lands on exactly
/// the tree the model was shown (tree-read, ADR-2114) even if the operator
/// committed while the night ran.
pub fn build_branch_worktree_at(
    repo: &Path,
    branch: &str,
    patch: &str,
    commit_msg: &str,
    base: &str,
) -> Result<std::path::PathBuf, PersistError> {
    build_branch_worktree_via(repo, branch, patch, commit_msg, base).map(|(wt, _)| wt)
}

/// [`build_branch_worktree_at`], also returning how the patch landed: the
/// `git apply` strategy that succeeded, prefixed `normalised(…): ` when it
/// only landed after [`normalise_patch`]. Recorded in `candidate.json` so a
/// reviewer can see when the engine adjusted a diff's headers or context.
pub fn build_branch_worktree_via(
    repo: &Path,
    branch: &str,
    patch: &str,
    commit_msg: &str,
    base: &str,
) -> Result<(std::path::PathBuf, String), PersistError> {
    let wt = std::env::temp_dir().join(format!("dream-wt-{}", branch.replace('/', "_")));
    let _ = std::fs::remove_dir_all(&wt); // stale worktree dir, if any
                                          // Isolated checkout on a fresh branch — the operator's working tree
                                          // (uncommitted ledger/report edits) is never touched.
    git(
        repo,
        &[
            "worktree",
            "add",
            "-b",
            branch,
            &wt.display().to_string(),
            base,
        ],
    )?;

    let cleanup = |repo: &Path, wt: &Path| {
        let _ = git(
            repo,
            &["worktree", "remove", "--force", &wt.display().to_string()],
        );
        let _ = git(repo, &["branch", "-D", branch]);
    };

    let patch_file = std::env::temp_dir().join(format!("dream-{}.patch", branch.replace('/', "_")));
    if let Err(e) = std::fs::write(&patch_file, patch) {
        cleanup(repo, &wt);
        return Err(e.into());
    }
    // Apply against the worktree, strategy by strategy (see apply_attempts).
    let patch_arg = patch_file.display().to_string();
    let mut last_err = String::new();
    let mut applied_via: Option<String> = None;
    for attempt in apply_attempts(patch) {
        let mut args: Vec<&str> = attempt.clone();
        args.push(patch_arg.as_str());
        match git(&wt, &args) {
            Ok(_) => {
                applied_via = Some(attempt.join(" "));
                break;
            }
            Err(e) => {
                last_err = format!("{}: {}", attempt.join(" "), e);
                // A failed --3way can leave conflict state; reset before any
                // further attempt or cleanup.
                let _ = git(&wt, &["reset", "--hard", "-q"]);
            }
        }
    }
    // Last resort: the mechanical repairs in normalise_patch, tried only when
    // the diff as written failed every strategy and the repairs changed it.
    if applied_via.is_none() {
        let (normalised, notes) =
            normalise_patch(patch, |p| crate::source::read_blob(repo, base, p));
        if !notes.is_empty() && std::fs::write(&patch_file, &normalised).is_ok() {
            let as_written = last_err.clone();
            for attempt in [
                vec!["apply", "--recount"],
                vec!["apply", "--recount", "--ignore-whitespace"],
            ] {
                let mut args: Vec<&str> = attempt.clone();
                args.push(patch_arg.as_str());
                match git(&wt, &args) {
                    Ok(_) => {
                        applied_via = Some(format!(
                            "normalised({}): {}",
                            notes.join("; "),
                            attempt.join(" ")
                        ));
                        break;
                    }
                    Err(e) => {
                        // Keep the as-written failure first: it is the one that
                        // describes the model's diff.
                        last_err = format!(
                            "{}; after normalising ({}): {}: {}",
                            as_written.trim(),
                            notes.join("; "),
                            attempt.join(" "),
                            e
                        );
                        let _ = git(&wt, &["reset", "--hard", "-q"]);
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_file(&patch_file);
    let applied = applied_via.is_some();
    if !applied {
        cleanup(repo, &wt);
        return Err(PersistError::PatchDidNotApply(last_err.trim().to_string()));
    }

    if let Err(e) = git(&wt, &["add", "-A"]).and_then(|_| git(&wt, &["commit", "-m", commit_msg])) {
        cleanup(repo, &wt);
        return Err(e);
    }
    Ok((wt, applied_via.unwrap_or_default()))
}

/// Delete a local branch. Used when the required-check gate vetoes a candidate:
/// a diff that failed its rerun must not be left behind as a promotable
/// artefact for a human to find and mistake for a validated win.
pub fn delete_branch(repo: &Path, branch: &str) {
    let _ = git(repo, &["branch", "-D", branch]);
}

/// Remove the worktree created by `build_branch_worktree` (keeps the branch).
pub fn remove_worktree(repo: &Path, wt: &Path) {
    let _ = git(
        repo,
        &["worktree", "remove", "--force", &wt.display().to_string()],
    );
}

/// Full control-plane persist: build the branch in a worktree, push it, open a
/// DRAFT PR. `repo_slug` is `owner/name`. Fail-open by design — a push/PR
/// failure returns the outcome with `pushed:false`/`pr_url:None` so the night
/// still records its verdict; the branch commit is not lost (worktree removed,
/// local branch kept for a manual push).
pub fn persist_accept(
    repo: &Path,
    repo_slug: &str,
    branch: &str,
    patch: &str,
    title: &str,
    body: &str,
) -> Result<PrOutcome, PersistError> {
    let wt = build_branch_worktree(repo, branch, patch, title)?;
    remove_worktree(repo, &wt);
    Ok(push_and_open_pr(repo, repo_slug, branch, title, body))
}

/// Push an existing local branch and open a DRAFT PR for it.
///
/// Split out of [`persist_accept`] because the ADR-2024 acceptance path builds
/// the branch *earlier* — it is the candidate tree the required evaluators were
/// re-run against — and only publishes it once the gate has upheld the ACCEPT.
/// Rebuilding the worktree here would either collide with that branch or, worse,
/// publish a tree nothing verified.
///
/// Fail-open: a push or `gh` failure returns `pushed: false` / `pr_url: None`
/// so the night still records its verdict, with the branch kept locally for a
/// manual push.
pub fn push_and_open_pr(
    repo: &Path,
    repo_slug: &str,
    branch: &str,
    title: &str,
    body: &str,
) -> PrOutcome {
    let push_ok = git(repo, &["push", "-u", "origin", branch]).is_ok();
    let mut pr_url = None;
    if push_ok {
        let out = Command::new("gh")
            .args([
                "pr", "create", "--repo", repo_slug, "--head", branch, "--draft", "--title", title,
                "--body", body,
            ])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                pr_url = Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
            }
        }
    }
    PrOutcome {
        branch: branch.to_string(),
        pr_url,
        pushed: push_ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_deletion_is_detected_per_file() {
        let del_bin = "diff --git a/x.png b/x.png\ndeleted file mode 100644\nindex 1..0\nBinary files a/x.png and /dev/null differ\n";
        let del_text = "diff --git a/x.txt b/x.txt\ndeleted file mode 100644\n--- a/x.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
        let mod_bin = "diff --git a/y.png b/y.png\nindex 1..2 100644\nBinary files a/y.png and b/y.png differ\n";
        assert!(deletes_binary(del_bin));
        assert!(!deletes_binary(del_text));
        assert!(!deletes_binary(mod_bin));
        assert!(deletes_binary(&format!("{del_text}{del_bin}")));
        assert!(!deletes_binary(&format!("{del_text}{mod_bin}")));
    }

    #[test]
    fn extract_patch_pulls_the_fenced_diff() {
        let report = "blah\n\n```dream-patch\ndiff --git a/x b/x\n+new\n```\n\ntail";
        let p = extract_patch(report).unwrap();
        assert!(p.starts_with("diff --git a/x b/x"));
        assert!(p.contains("+new"));
        assert!(!p.contains("```"));
    }

    #[test]
    fn extract_patch_none_when_absent_or_empty() {
        assert!(extract_patch("no patch here").is_none());
        assert!(extract_patch("```dream-patch\n\n```").is_none());
        assert!(extract_patch("```dream-patch\n   \n```").is_none());
    }

    #[test]
    fn branch_name_slugifies_and_dates() {
        assert_eq!(
            branch_name("sovereign-mesh", "2026-08-27"),
            "dream/sovereign-mesh-2026-08-27"
        );
        assert_eq!(
            branch_name("Ledger Signals!", "2026-08-27"),
            "dream/ledger-signals-2026-08-27"
        );
        assert_eq!(branch_name("", "2026-08-27"), "dream/cycle-2026-08-27");
    }

    #[test]
    fn build_branch_worktree_applies_patch_in_isolation() {
        // A scratch git repo with one committed file + an UNCOMMITTED change that
        // must survive untouched (the operator's working tree).
        let dir = std::env::temp_dir().join(format!("dream-persist-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |a: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(a)
                .output()
                .unwrap()
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(dir.join("f.txt"), "one\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "init"]);
        std::fs::write(dir.join("dirty.txt"), "operator wip\n").unwrap(); // uncommitted

        let patch =
            "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,2 @@\n one\n+two\n";
        let wt =
            build_branch_worktree(&dir, "dream/x-2026-08-27", patch, "dream: add two").unwrap();

        // The branch commit contains the patched file...
        let show = Command::new("git")
            .arg("-C")
            .arg(&wt)
            .args(["show", "HEAD:f.txt"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "one\ntwo\n");
        // ...and the operator's uncommitted file in the MAIN tree is untouched.
        assert_eq!(
            std::fs::read_to_string(dir.join("dirty.txt")).unwrap(),
            "operator wip\n"
        );

        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_fence_inside_the_diff_does_not_end_the_block() {
        // factrail 2026-10-08/10: the hunk edits a Rust doc test, so the diff
        // carries ` /// ```` lines. Ending at the first "```" substring cut it
        // at line 14 ("corrupt patch").
        let diff = "--- a/lib.rs\n+++ b/lib.rs\n@@ -1,3 +1,4 @@\n /// ```\n /// x();\n+/// y();\n /// ```\n";
        let report = format!("text\n```dream-patch\n{diff}```\nafter\n```\nother block\n```\n");
        assert_eq!(extract_patch(&report).as_deref(), Some(diff));
        // A closing fence with trailing whitespace or CRLF still closes.
        let crlf = format!("```dream-patch\r\n{diff}```  \r\nrest");
        assert_eq!(extract_patch(&crlf).as_deref(), Some(diff));
        // No closing fence at all: no patch rather than a guess.
        assert!(extract_patch("```dream-patch\n--- a/x\n+++ b/x\n").is_none());
    }

    #[test]
    fn mid_file_hunk_without_trailing_context_lands_after_normalising() {
        // dream-machine 2026-10-09: leading context, none trailing. git anchors
        // such a hunk to end-of-file, so every plain strategy refuses it.
        let dir = scratch("trail", "a\nb\nc\nd\ne\nf\ng\n");
        let patch = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n b\n-c\n+C\n";
        let (wt, via) =
            build_branch_worktree_via(&dir, "dream/trail-2026-10-11", patch, "m", "HEAD").unwrap();
        assert_eq!(
            std::fs::read_to_string(wt.join("f.txt")).unwrap(),
            "a\nb\nC\nd\ne\nf\ng\n"
        );
        assert!(via.starts_with("normalised("), "{via}");
        assert!(via.contains("trailing context"), "{via}");
        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn headerless_two_file_patch_lands_after_normalising() {
        // project2 2026-10-09: no `diff --git` lines. With --recount git read
        // the second file's `--- a/…` header as a deletion in the first hunk.
        let dir = scratch("headers", "one\ntwo\nthree\n");
        std::fs::write(dir.join("g.txt"), "x\ny\nz\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["commit", "-qam", "g"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["add", "g.txt"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["commit", "-qm", "g"])
            .output()
            .unwrap();
        // Miscounted hunks (models rarely count right), so --recount is needed.
        let patch = "--- a/f.txt\n+++ b/f.txt\n@@ -1,9 +1,9 @@\n one\n-two\n+TWO\n three\n\n--- a/g.txt\n+++ b/g.txt\n@@ -1,9 +1,9 @@\n x\n-y\n+Y\n z\n";
        let (wt, via) =
            build_branch_worktree_via(&dir, "dream/headers-2026-10-11", patch, "m", "HEAD")
                .unwrap();
        assert_eq!(
            std::fs::read_to_string(wt.join("f.txt")).unwrap(),
            "one\nTWO\nthree\n"
        );
        assert_eq!(
            std::fs::read_to_string(wt.join("g.txt")).unwrap(),
            "x\nY\nz\n"
        );
        assert!(via.contains("header synthesised"), "{via}");
        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalising_never_changes_an_added_or_removed_line() {
        let base = |_: &str| Some("a\nb\nc\nd\ne\n".to_string());
        let patch = "--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n b\n-c\n+  C with  spaces\t\n\n";
        let (out, notes) = normalise_patch(patch, base);
        assert!(!notes.is_empty());
        let changes = |t: &str| -> Vec<String> {
            t.lines()
                .filter(|l| {
                    (l.starts_with('+') && !l.starts_with("+++"))
                        || (l.starts_with('-') && !l.starts_with("---"))
                })
                .map(str::to_string)
                .collect()
        };
        assert_eq!(changes(&out), changes(patch));
        assert!(out.contains(" d\n"), "{out}");
    }

    #[test]
    fn normalising_leaves_eof_hunks_and_repeated_paths_alone() {
        let base = |_: &str| Some("a\nb\nc\n".to_string());
        // Old block ends at EOF: git's end-anchoring is correct, no padding.
        let at_eof = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n b\n-c\n+C\n";
        assert!(normalise_patch(at_eof, base).1.is_empty());
        // Same path in two sections: untouched.
        let twice =
            "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n--- a/f\n+++ b/f\n@@ -3 +3 @@\n-c\n+C\n";
        let (out, notes) = normalise_patch(twice, base);
        assert!(notes.is_empty());
        assert_eq!(out, twice);
    }

    #[test]
    fn apply_attempts_order_and_three_way_gate() {
        let plain = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n";
        assert_eq!(
            apply_attempts(plain),
            vec![
                vec!["apply"],
                vec!["apply", "--recount"],
                vec!["apply", "--recount", "--ignore-whitespace"],
            ]
        );
        let with_blobs = "diff --git a/f b/f\nindex 1234abc..5678def 100644\n--- a/f\n+++ b/f\n";
        assert_eq!(
            apply_attempts(with_blobs).last().unwrap(),
            &vec!["apply", "--3way"]
        );
        let bogus_index = "index xyz..abc\n";
        assert_eq!(apply_attempts(bogus_index).len(), 3);
    }

    /// Scratch repo with one committed file.
    fn scratch(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dream-persist-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |a: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(a)
                .output()
                .unwrap()
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(dir.join("f.txt"), content).unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "init"]);
        dir
    }

    #[test]
    fn miscounted_hunk_lands_via_recount() {
        // The header claims +1,5 but the body adds one line: plain `git apply`
        // rejects it as corrupt; `--recount` fixes the counts and lands it.
        let dir = scratch("recount", "one\n");
        let patch =
            "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,5 @@\n one\n+two\n";
        let wt = build_branch_worktree(&dir, "dream/recount-2026-09-25", patch, "dream: recount")
            .unwrap();
        let show = Command::new("git")
            .arg("-C")
            .arg(&wt)
            .args(["show", "HEAD:f.txt"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "one\ntwo\n");
        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unappliable_patch_reports_last_strategy_detail() {
        let dir = scratch("noapply", "one\n");
        let patch =
            "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-absent\n+x\n";
        let err = build_branch_worktree(&dir, "dream/noapply-2026-09-25", patch, "m").unwrap_err();
        match err {
            PersistError::PatchDidNotApply(detail) => {
                assert!(
                    detail.starts_with("apply --recount --ignore-whitespace"),
                    "{detail}"
                );
            }
            other => panic!("unexpected {other:?}"),
        }
        // Cleanup ran: the branch does not survive a failed apply.
        let br = Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["branch", "--list", "dream/noapply-2026-09-25"])
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&br.stdout).trim().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_can_be_pinned_to_an_older_base() {
        let dir = scratch("base", "one\n");
        let base = String::from_utf8(
            Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        // HEAD moves on after the night's commit was dispatched.
        std::fs::write(dir.join("f.txt"), "moved\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["commit", "-qam", "later"])
            .output()
            .unwrap();
        let patch =
            "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,2 @@\n one\n+two\n";
        let wt =
            build_branch_worktree_at(&dir, "dream/base-2026-09-25", patch, "m", &base).unwrap();
        assert_eq!(
            std::fs::read_to_string(wt.join("f.txt")).unwrap(),
            "one\ntwo\n"
        );
        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
