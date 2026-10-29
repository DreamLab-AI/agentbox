//! Worktrees for the sessions that want their own checkout.
//!
//! Two different questions get two different answers, on purpose:
//!
//! * *May I recreate the session that runs here?* Recreating a tmux session
//!   deletes no files, so only work in progress matters: tracked changes and
//!   untracked files ([`dirty`]). Build output that `.gitignore` hides
//!   (`node_modules`, `coverage`, `target`) must not block a restart, or a
//!   built worktree would hold its session out of reconcile for ever.
//! * *May I delete this worktree?* `git worktree remove` deletes ignored files
//!   without a warning, so removal additionally refuses unless every ignored
//!   path is known to be regenerable ([`unrecoverable_ignored`]).

use anyhow::{bail, Context, Result};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().context("git")?;
    if !out.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Tracked changes and untracked files, one line each. Ignored files and
/// submodule state are excluded.
pub fn dirty(dir: &Path) -> Result<Vec<String>> {
    Ok(git(dir, &["status", "--porcelain", "--ignore-submodules=all"])?.lines().map(str::to_owned).collect())
}

/// Path segments that are always rebuilt from source.
const REGENERABLE: [&str; 9] = ["node_modules", "target", ".next", "dist", "coverage", "build", "__pycache__", ".turbo", ".cache"];

fn regenerable(path: &str) -> bool {
    let trimmed = path.trim_end_matches('/');
    trimmed.split('/').any(|seg| REGENERABLE.contains(&seg)) || trimmed.ends_with(".tsbuildinfo")
}

/// Ignored paths that are not regenerable build output: evidence logs, local
/// settings, anything a person or a tool wrote that `git` cannot restore.
pub fn unrecoverable_ignored(dir: &Path) -> Result<Vec<String>> {
    Ok(git(dir, &["status", "--porcelain", "--ignored", "--ignore-submodules=all"])?
        .lines()
        .filter_map(|l| l.strip_prefix("!! "))
        .filter(|p| !regenerable(p))
        .map(str::to_owned)
        .collect())
}

/// Registered worktrees of `project`, as path → branch.
pub fn registered(project: &Path) -> Result<Vec<(PathBuf, Option<String>)>> {
    let text = git(project, &["worktree", "list", "--porcelain"])?;
    let mut out = Vec::new();
    let mut cur: Option<(PathBuf, Option<String>)> = None;
    for line in text.lines().chain(std::iter::once("")) {
        if let Some(p) = line.strip_prefix("worktree ") {
            cur = Some((PathBuf::from(p), None));
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            if let Some(c) = cur.as_mut() {
                c.1 = Some(b.to_string());
            }
        } else if line.is_empty() {
            if let Some(c) = cur.take() {
                out.push(c);
            }
        }
    }
    Ok(out)
}

pub fn branch_for(slug: &str) -> String {
    format!("session-plane/{slug}")
}

/// Make sure `dir` is a worktree of `project`. A directory that exists but is
/// not a registered worktree is moved aside, not deleted. Returns whether a new
/// worktree was cut.
pub fn ensure(project: &Path, dir: &Path, slug: &str) -> Result<bool> {
    let reg = registered(project)?;
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if reg.iter().any(|(p, _)| canon(p) == canon(dir)) && dir.exists() {
        return Ok(false);
    }
    if dir.exists() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let aside = PathBuf::from(format!("{}.orphan-{stamp}", dir.display()));
        std::fs::rename(dir, &aside).with_context(|| format!("move {} aside", dir.display()))?;
    }
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // A registration whose directory is gone would make `worktree add` refuse.
    let _ = git(project, &["worktree", "prune"]);
    let branch = branch_for(slug);
    let have_branch = git(project, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok();
    let d = dir.display().to_string();
    if have_branch {
        git(project, &["worktree", "add", &d, &branch])?;
    } else {
        git(project, &["worktree", "add", "-b", &branch, &d, "HEAD"])?;
    }
    Ok(true)
}

/// Network-free submodule init for a new worktree, referencing the
/// superproject's module store (`--dissociate` so the worktree owns its
/// objects). Fail-open at the caller: a worktree without submodule content is
/// still usable.
pub fn init_submodules(project: &Path, dir: &Path) -> Result<()> {
    if !dir.join(".gitmodules").exists() {
        return Ok(());
    }
    let listing = git(dir, &["config", "-f", ".gitmodules", "--get-regexp", r"^submodule\..*\.path$"])?;
    for line in listing.lines() {
        let Some(rest) = line.strip_prefix("submodule.") else { continue };
        let Some((name_path, sub_path)) = rest.split_once(".path ") else { continue };
        let reference = project.join(".git").join("modules").join(name_path);
        let mut args = vec!["submodule", "update", "--init"];
        let r = reference.display().to_string();
        if reference.exists() {
            args.extend(["--reference", &r, "--dissociate"]);
        }
        args.extend(["--", sub_path]);
        git(dir, &args)?;
    }
    Ok(())
}

/// What the legacy reaper did or would do.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Reaped {
    pub removed: Vec<PathBuf>,
    pub aside: Vec<PathBuf>,
    pub left: Vec<(PathBuf, String)>,
}

/// Reap worktrees Agent of Empires left under `<project>-worktrees`. Identity
/// is exact, never fuzzy: a directory is a candidate only when its basename is
/// `<slug>` or `<slug>-<digits>` for a worktree seed and no live session runs
/// there. A registered worktree goes only when it is clean, holds no commit
/// beyond the main branch, and every ignored path in it is regenerable.
pub fn reap_legacy(project: &Path, root: &Path, slugs: &[String], live: &HashSet<PathBuf>, dry_run: bool) -> Result<Reaped> {
    let mut rep = Reaped::default();
    if !root.exists() || slugs.is_empty() {
        return Ok(rep);
    }
    let reg = registered(project)?;
    let main_branch = git(project, &["symbolic-ref", "--short", "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_else(|_| "main".into());
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_candidate = slugs.iter().any(|s| name == *s || name.strip_prefix(&format!("{s}-")).is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())));
        if !is_candidate {
            continue;
        }
        let dir = std::fs::canonicalize(entry.path())?;
        if live.contains(&dir) {
            continue;
        }
        let branch = reg.iter().find(|(p, _)| std::fs::canonicalize(p).map(|c| c == dir).unwrap_or(false)).map(|(_, b)| b.clone());
        let Some(branch) = branch else {
            let aside = PathBuf::from(format!("{}.orphan-{}", dir.display(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)));
            if !dry_run {
                std::fs::rename(&dir, &aside)?;
            }
            rep.aside.push(aside);
            continue;
        };
        let dirty_files = dirty(&dir)?;
        if !dirty_files.is_empty() {
            rep.left.push((dir, "uncommitted changes".into()));
            continue;
        }
        let ahead = git(&dir, &["rev-list", "--count", &format!("{main_branch}..HEAD")])?.trim().to_string();
        if ahead != "0" {
            rep.left.push((dir, format!("{ahead} commit(s) beyond {main_branch}")));
            continue;
        }
        let keep = unrecoverable_ignored(&dir)?;
        if !keep.is_empty() {
            rep.left.push((dir, format!("ignored files that cannot be regenerated: {}", keep.join(", "))));
            continue;
        }
        if !dry_run {
            let d = dir.display().to_string();
            let _ = git(project, &["worktree", "unlock", &d]);
            git(project, &["worktree", "remove", "--force", "--force", &d])?;
            if let Some(b) = &branch {
                if *b == name {
                    let _ = git(project, &["branch", "-D", b]);
                }
            }
        }
        rep.removed.push(dir);
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let st = Command::new("git").arg("-C").arg(dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").status().unwrap();
        assert!(st.success(), "git {args:?}");
    }

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["init", "-q", "-b", "main"]);
        std::fs::write(d.path().join(".gitignore"), "node_modules/\ncoverage/\nnotes.local\n").unwrap();
        std::fs::write(d.path().join("a.txt"), "a").unwrap();
        run(d.path(), &["add", "."]);
        run(d.path(), &["commit", "-q", "-m", "init"]);
        d
    }

    #[test]
    fn regenerable_paths_are_recognised() {
        for p in ["node_modules/", "foreman/coverage/", "web/.next/", "tsconfig.tsbuildinfo", "a/target/"] {
            assert!(regenerable(p), "{p}");
        }
        for p in ["notes.local", ".env", "evidence/log.txt", "control-plane/.env"] {
            assert!(!regenerable(p), "{p}");
        }
    }

    #[test]
    fn ensure_cuts_then_reuses_a_worktree() {
        let p = repo();
        let wt = tempfile::tempdir().unwrap();
        let dir = wt.path().join("aoe-codex");
        assert!(ensure(p.path(), &dir, "codex").unwrap());
        assert!(dir.join("a.txt").exists());
        assert!(!ensure(p.path(), &dir, "codex").unwrap(), "second call reuses it");
    }

    #[test]
    fn a_dead_directory_is_moved_aside_not_deleted() {
        let p = repo();
        let wt = tempfile::tempdir().unwrap();
        let dir = wt.path().join("aoe-codex");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("precious"), "x").unwrap();
        assert!(ensure(p.path(), &dir, "codex").unwrap());
        let aside: Vec<_> = std::fs::read_dir(wt.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().contains(".orphan-")).collect();
        assert_eq!(aside.len(), 1);
        assert!(aside[0].path().join("precious").exists());
    }

    /// The case that would hold a built worktree out of reconcile for ever.
    #[test]
    fn build_output_does_not_make_a_worktree_dirty_but_work_does() {
        let p = repo();
        let wt = tempfile::tempdir().unwrap();
        let dir = wt.path().join("aoe-x");
        ensure(p.path(), &dir, "x").unwrap();
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(dir.join("coverage")).unwrap();
        std::fs::write(dir.join("coverage/lcov"), "x").unwrap();
        assert!(dirty(&dir).unwrap().is_empty(), "ignored build output is not work in progress");
        std::fs::write(dir.join("new.txt"), "wip").unwrap();
        assert_eq!(dirty(&dir).unwrap().len(), 1);
        std::fs::remove_file(dir.join("new.txt")).unwrap();
        std::fs::write(dir.join("a.txt"), "changed").unwrap();
        assert_eq!(dirty(&dir).unwrap().len(), 1, "a tracked edit counts");
    }

    #[test]
    fn removal_is_stricter_than_recreation() {
        let p = repo();
        let wt = tempfile::tempdir().unwrap();
        let dir = wt.path().join("aoe-y");
        ensure(p.path(), &dir, "y").unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules/f"), "x").unwrap();
        assert!(unrecoverable_ignored(&dir).unwrap().is_empty());
        std::fs::write(dir.join("notes.local"), "evidence").unwrap();
        assert_eq!(unrecoverable_ignored(&dir).unwrap(), vec!["notes.local".to_string()]);
    }

    #[test]
    fn legacy_reaper_removes_only_clean_unreferenced_exact_matches() {
        let p = repo();
        let root = tempfile::tempdir().unwrap();
        let slugs = vec!["codex".to_string()];
        let clean = root.path().join("codex-2");
        let busy = root.path().join("codex");
        let other = root.path().join("unrelated");
        for (d, b) in [(&clean, "codex-2"), (&busy, "codex")] {
            run(p.path(), &["worktree", "add", "-q", "-b", b, &d.display().to_string(), "HEAD"]);
        }
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(busy.join("wip.txt"), "x").unwrap();
        let rep = reap_legacy(p.path(), root.path(), &slugs, &HashSet::new(), false).unwrap();
        assert_eq!(rep.removed.len(), 1);
        assert!(rep.removed[0].ends_with("codex-2"));
        assert!(!clean.exists());
        assert!(busy.exists() && other.exists());
        assert_eq!(rep.left.len(), 1);
        assert!(rep.left[0].1.contains("uncommitted"));
    }

    #[test]
    fn a_live_session_path_is_never_reaped() {
        let p = repo();
        let root = tempfile::tempdir().unwrap();
        let d = root.path().join("codex");
        run(p.path(), &["worktree", "add", "-q", "-b", "codex", &d.display().to_string(), "HEAD"]);
        let live: HashSet<PathBuf> = [std::fs::canonicalize(&d).unwrap()].into();
        let rep = reap_legacy(p.path(), root.path(), &["codex".into()], &live, false).unwrap();
        assert!(rep.removed.is_empty() && d.exists());
    }
}
