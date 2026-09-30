//! Branch sweep: the seven-day rule for `dream/*` branches (planning cycle
//! 2026-09-21, Track A item 5).
//!
//! The engine merges by squash or by hand-integration, so a finished dream
//! branch is never an ancestor of the default branch and `git branch --merged`
//! never sees it. The sweep therefore keys on the branch's pull-request state
//! and its age, not on git ancestry:
//!
//! - PR merged or closed → the work landed or was declined: delete the branch.
//! - PR still open and the tip older than [`MAX_AGE_DAYS`] → close the PR with a
//!   comment and delete the branch (a candidate nobody reviewed in a week is
//!   not going to be).
//! - no PR and older than [`MAX_AGE_DAYS`] → delete (a local-only candidate, or
//!   one whose push failed).
//! - otherwise keep.
//!
//! The currently checked-out branch is never touched. Every deletion is a side
//! effect, so each one is journalled by the caller.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

/// The seven-day rule.
pub const MAX_AGE_DAYS: i64 = 7;

/// State of the pull request whose head is the branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrState {
    Open(u64),
    Merged,
    Closed,
    None,
}

/// What the sweep does to one branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum SweepAction {
    Keep,
    /// Delete the local branch and, when present, the remote one.
    Delete { reason: String },
    /// Close the open PR (deleting its branch) with an explanatory comment.
    ClosePr { number: u64, reason: String },
}

/// Pure decision for one branch. `age_days` is the tip commit's age.
pub fn decide(pr: PrState, age_days: i64, checked_out: bool) -> SweepAction {
    if checked_out {
        return SweepAction::Keep;
    }
    let stale = age_days > MAX_AGE_DAYS;
    match pr {
        PrState::Merged => SweepAction::Delete { reason: "pr-merged".into() },
        PrState::Closed => SweepAction::Delete { reason: "pr-closed".into() },
        PrState::Open(number) if stale => SweepAction::ClosePr {
            number,
            reason: format!("open-over-{MAX_AGE_DAYS}-days"),
        },
        PrState::None if stale => SweepAction::Delete { reason: format!("no-pr-over-{MAX_AGE_DAYS}-days") },
        _ => SweepAction::Keep,
    }
}

/// One `dream/*` branch as found in a repo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub name: String,
    pub tip_unix: i64,
    pub local: bool,
    pub remote: bool,
}

/// Parse `git for-each-ref --format='%(refname) %(committerdate:unix)'` over
/// `refs/heads/dream` and `refs/remotes/origin/dream`, merging local and remote
/// refs of the same branch (newest tip wins).
pub fn parse_refs(out: &str) -> Vec<Found> {
    let mut found: Vec<Found> = Vec::new();
    for line in out.lines() {
        let mut parts = line.split_whitespace();
        let (Some(refname), Some(ts)) = (parts.next(), parts.next()) else { continue };
        let Ok(ts) = ts.parse::<i64>() else { continue };
        let (name, local) = if let Some(n) = refname.strip_prefix("refs/heads/") {
            (n, true)
        } else if let Some(n) = refname.strip_prefix("refs/remotes/origin/") {
            (n, false)
        } else {
            continue;
        };
        if !name.starts_with("dream/") {
            continue;
        }
        match found.iter_mut().find(|f| f.name == name) {
            Some(f) => {
                f.local |= local;
                f.remote |= !local;
                f.tip_unix = f.tip_unix.max(ts);
            }
            None => found.push(Found { name: name.to_string(), tip_unix: ts, local, remote: !local }),
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// Parse `gh pr list --json number,state` output (most recent PR first).
pub fn parse_pr_state(json: &str) -> PrState {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return PrState::None };
    let Some(first) = v.as_array().and_then(|a| a.first()) else { return PrState::None };
    match first.get("state").and_then(|s| s.as_str()) {
        Some("OPEN") => PrState::Open(first.get("number").and_then(|n| n.as_u64()).unwrap_or(0)),
        Some("MERGED") => PrState::Merged,
        Some("CLOSED") => PrState::Closed,
        _ => PrState::None,
    }
}

/// A branch found in a repo, with its decided action.
#[derive(Debug, Clone, Serialize)]
pub struct Planned {
    pub repo: String,
    pub branch: String,
    pub age_days: i64,
    #[serde(skip)]
    pub local: bool,
    #[serde(skip)]
    pub remote: bool,
    #[serde(flatten)]
    pub action: SweepAction,
}

/// List a repo's `dream/*` branches and decide each one. Read-only: `git
/// fetch --prune` refreshes remote refs; `gh` is asked for PR state.
pub fn plan(repo_name: &str, repo_path: &Path, repo_slug: &str, now_unix: i64) -> Vec<Planned> {
    let _ = git(repo_path, &["fetch", "--quiet", "--prune", "origin"]);
    let Some(refs) = git(
        repo_path,
        &["for-each-ref", "--format=%(refname) %(committerdate:unix)", "refs/heads/dream", "refs/remotes/origin/dream"],
    ) else {
        return Vec::new();
    };
    let head = git(repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    parse_refs(&refs)
        .into_iter()
        .map(|f| {
            let pr = if repo_slug.is_empty() {
                PrState::None
            } else {
                Command::new("gh")
                    .args(["pr", "list", "--repo", repo_slug, "--head", &f.name, "--state", "all", "--json", "number,state"])
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| parse_pr_state(&String::from_utf8_lossy(&o.stdout)))
                    .unwrap_or(PrState::None)
            };
            let age_days = (now_unix - f.tip_unix).max(0) / 86_400;
            Planned {
                repo: repo_name.to_string(),
                branch: f.name.clone(),
                age_days,
                local: f.local,
                remote: f.remote,
                action: decide(pr, age_days, f.name == head),
            }
        })
        .collect()
}

/// What the sweep did to one branch, for the night-health summary.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SweepRecord {
    pub repo: String,
    pub branch: String,
    pub age_days: i64,
    /// `delete` or `close-pr`.
    pub action: String,
    pub reason: String,
    pub ok: bool,
}

impl Planned {
    /// The night-health record of this action once applied.
    pub fn record(&self, ok: bool) -> SweepRecord {
        let (action, reason) = match &self.action {
            SweepAction::Keep => ("keep".to_string(), String::new()),
            SweepAction::Delete { reason } => ("delete".to_string(), reason.clone()),
            SweepAction::ClosePr { number, reason } => (format!("close-pr #{number}"), reason.clone()),
        };
        SweepRecord { repo: self.repo.clone(), branch: self.branch.clone(), age_days: self.age_days, action, reason, ok }
    }
}

/// Carry out one planned action. Returns whether every step succeeded.
pub fn apply(repo_path: &Path, repo_slug: &str, p: &Planned) -> bool {
    match &p.action {
        SweepAction::Keep => true,
        SweepAction::Delete { .. } => {
            let mut ok = true;
            if p.local {
                ok &= git(repo_path, &["branch", "-D", &p.branch]).is_some();
            }
            if p.remote {
                ok &= git(repo_path, &["push", "--quiet", "origin", "--delete", &p.branch]).is_some();
            }
            ok
        }
        SweepAction::ClosePr { number, .. } => {
            let comment = format!(
                "Closed by the dream engine's branch sweep: this candidate has been open for more than \
                 {MAX_AGE_DAYS} days without review. The run's report and receipts stay in the dream \
                 artefacts; reopen and re-push the branch to revive it."
            );
            let closed = Command::new("gh")
                .args(["pr", "close", &number.to_string(), "--repo", repo_slug, "--delete-branch", "--comment", &comment])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            // `--delete-branch` removes the remote and, when run inside the
            // repo, the local branch; make sure of the local one either way.
            if p.local {
                let _ = git(repo_path, &["branch", "-D", &p.branch]);
            }
            closed
        }
    }
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landed_branches_go_whatever_their_age() {
        assert_eq!(decide(PrState::Merged, 0, false), SweepAction::Delete { reason: "pr-merged".into() });
        assert_eq!(decide(PrState::Closed, 1, false), SweepAction::Delete { reason: "pr-closed".into() });
    }

    #[test]
    fn open_prs_get_a_week() {
        assert_eq!(decide(PrState::Open(4), 7, false), SweepAction::Keep);
        assert_eq!(
            decide(PrState::Open(4), 8, false),
            SweepAction::ClosePr { number: 4, reason: "open-over-7-days".into() }
        );
    }

    #[test]
    fn prless_branches_get_a_week() {
        assert_eq!(decide(PrState::None, 3, false), SweepAction::Keep);
        assert_eq!(decide(PrState::None, 30, false), SweepAction::Delete { reason: "no-pr-over-7-days".into() });
    }

    #[test]
    fn the_checked_out_branch_is_never_touched() {
        assert_eq!(decide(PrState::Merged, 90, true), SweepAction::Keep);
    }

    #[test]
    fn refs_merge_local_and_remote() {
        let out = "refs/heads/dream/seo-2026-09-30 100\n\
                   refs/remotes/origin/dream/seo-2026-09-30 120\n\
                   refs/remotes/origin/dream/old-2026-09-01 50\n\
                   refs/heads/main 999\n\
                   garbage\n";
        let f = parse_refs(out);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0], Found { name: "dream/old-2026-09-01".into(), tip_unix: 50, local: false, remote: true });
        assert_eq!(f[1], Found { name: "dream/seo-2026-09-30".into(), tip_unix: 120, local: true, remote: true });
    }

    #[test]
    fn pr_state_parses_gh_json() {
        assert_eq!(parse_pr_state(r#"[{"number":4,"state":"OPEN"}]"#), PrState::Open(4));
        assert_eq!(parse_pr_state(r#"[{"number":3,"state":"MERGED"}]"#), PrState::Merged);
        assert_eq!(parse_pr_state(r#"[{"number":11,"state":"CLOSED"}]"#), PrState::Closed);
        assert_eq!(parse_pr_state("[]"), PrState::None);
        assert_eq!(parse_pr_state("not json"), PrState::None);
    }

    #[test]
    fn plan_and_apply_against_a_scratch_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let g = |args: &[&str]| {
            let o = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
        // An old dream branch (tip dated 30 days back) and a fresh one.
        let old = "2026-08-31T00:00:00Z";
        let o = Command::new("git")
            .arg("-C").arg(repo)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "old"])
            .env("GIT_COMMITTER_DATE", old)
            .env("GIT_AUTHOR_DATE", old)
            .output()
            .unwrap();
        assert!(o.status.success());
        g(&["branch", "dream/old-2026-08-31"]);
        g(&["reset", "-q", "--hard", "HEAD~1"]);
        g(&["branch", "dream/fresh-2026-09-30"]);

        let now = chrono::DateTime::parse_from_rfc3339("2026-09-30T12:00:00Z").unwrap().timestamp();
        // No repo slug → no gh call → PrState::None for both.
        let planned = plan("scratch", repo, "", now);
        let by_name = |n: &str| planned.iter().find(|p| p.branch == n).unwrap().clone();
        assert_eq!(by_name("dream/old-2026-08-31").action, SweepAction::Delete { reason: "no-pr-over-7-days".into() });
        assert_eq!(by_name("dream/fresh-2026-09-30").action, SweepAction::Keep);

        assert!(apply(repo, "", &by_name("dream/old-2026-08-31")));
        let left = plan("scratch", repo, "", now);
        assert_eq!(left.iter().map(|p| p.branch.as_str()).collect::<Vec<_>>(), ["dream/fresh-2026-09-30"]);
    }
}
