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
    #[error("patch did not apply")]
    PatchDidNotApply,
    #[error("no candidate patch in report")]
    NoPatch,
}

#[derive(Debug, Clone)]
pub struct PrOutcome {
    pub branch: String,
    pub pr_url: Option<String>,
    pub pushed: bool,
}

/// Pull the candidate patch out of the first ```dream-patch fenced block.
/// Returns None when absent or empty (a finding with no code change).
pub fn extract_patch(report: &str) -> Option<String> {
    const TAG: &str = "```dream-patch";
    let start = report.find(TAG)? + TAG.len();
    let rest = &report[start..];
    let end = rest.find("```")?;
    // Drop the newline immediately after the opening fence, keep the diff body.
    let body = rest[..end].strip_prefix('\r').unwrap_or(&rest[..end]);
    let body = body.strip_prefix('\n').unwrap_or(body);
    if body.trim().is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

/// `dream/<slug(deep)>-<date>` — the namespaced branch for tonight's candidate.
pub fn branch_name(deep: &str, date: &str) -> String {
    let slug: String = deep
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c.to_ascii_lowercase() } else { '-' })
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
    let wt = std::env::temp_dir().join(format!("dream-wt-{}", branch.replace('/', "_")));
    let _ = std::fs::remove_dir_all(&wt); // stale worktree dir, if any
    // Isolated checkout at HEAD on a fresh branch — the operator's working tree
    // (uncommitted ledger/report edits) is never touched.
    git(repo, &["worktree", "add", "-b", branch, &wt.display().to_string(), "HEAD"])?;

    let cleanup = |repo: &Path, wt: &Path| {
        let _ = git(repo, &["worktree", "remove", "--force", &wt.display().to_string()]);
        let _ = git(repo, &["branch", "-D", branch]);
    };

    let patch_file = std::env::temp_dir().join(format!("dream-{}.patch", branch.replace('/', "_")));
    if let Err(e) = std::fs::write(&patch_file, patch) {
        cleanup(repo, &wt);
        return Err(e.into());
    }
    // Apply against the worktree. `--3way` recovers when context has drifted.
    if git(&wt, &["apply", "--3way", &patch_file.display().to_string()]).is_err() {
        let _ = std::fs::remove_file(&patch_file);
        cleanup(repo, &wt);
        return Err(PersistError::PatchDidNotApply);
    }
    let _ = std::fs::remove_file(&patch_file);

    if let Err(e) = git(&wt, &["add", "-A"]).and_then(|_| git(&wt, &["commit", "-m", commit_msg])) {
        cleanup(repo, &wt);
        return Err(e);
    }
    Ok(wt)
}

/// Remove the worktree created by `build_branch_worktree` (keeps the branch).
pub fn remove_worktree(repo: &Path, wt: &Path) {
    let _ = git(repo, &["worktree", "remove", "--force", &wt.display().to_string()]);
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
    let push_ok = git(&wt, &["push", "-u", "origin", branch]).is_ok();
    let mut pr_url = None;
    if push_ok {
        let out = Command::new("gh")
            .args(["pr", "create", "--repo", repo_slug, "--head", branch, "--draft", "--title", title, "--body", body])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                pr_url = Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
            }
        }
    }
    remove_worktree(repo, &wt);
    Ok(PrOutcome { branch: branch.to_string(), pr_url, pushed: push_ok })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(branch_name("sovereign-mesh", "2026-08-27"), "dream/sovereign-mesh-2026-08-27");
        assert_eq!(branch_name("Ledger Signals!", "2026-08-27"), "dream/ledger-signals-2026-08-27");
        assert_eq!(branch_name("", "2026-08-27"), "dream/cycle-2026-08-27");
    }

    #[test]
    fn build_branch_worktree_applies_patch_in_isolation() {
        // A scratch git repo with one committed file + an UNCOMMITTED change that
        // must survive untouched (the operator's working tree).
        let dir = std::env::temp_dir().join(format!("dream-persist-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |a: &[&str]| Command::new("git").arg("-C").arg(&dir).args(a).output().unwrap();
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(dir.join("f.txt"), "one\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "init"]);
        std::fs::write(dir.join("dirty.txt"), "operator wip\n").unwrap(); // uncommitted

        let patch = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,2 @@\n one\n+two\n";
        let wt = build_branch_worktree(&dir, "dream/x-2026-08-27", patch, "dream: add two").unwrap();

        // The branch commit contains the patched file...
        let show = Command::new("git").arg("-C").arg(&wt).args(["show", "HEAD:f.txt"]).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "one\ntwo\n");
        // ...and the operator's uncommitted file in the MAIN tree is untouched.
        assert_eq!(std::fs::read_to_string(dir.join("dirty.txt")).unwrap(), "operator wip\n");

        remove_worktree(&dir, &wt);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
