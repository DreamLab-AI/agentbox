//! The reconcile decision (ADR-2153 §4), kept free of tmux and git so the
//! policy can be tested on its own.
//!
//! A seed whose session is missing, dead, blocked on something recreating can
//! fix, or drifted from the manifest is started again. Three things stop that:
//!
//! * the name is held by a session we do not own (a conflict, never touched);
//! * the session's worktree holds work in progress;
//! * the seed has already been restarted too often in the window, so a command
//!   that dies on launch cannot spin the daemon.

use crate::status::fixable_by_recreate;
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_RESTARTS: u32 = 3;
pub const RESTART_WINDOW: Duration = Duration::from_secs(3600);

pub struct Wanted<'a> {
    pub fingerprint: &'a str,
    pub worktree: bool,
}

pub struct Seen<'a> {
    pub owned: bool,
    pub dead: bool,
    pub fingerprint: &'a str,
    /// The blocker pattern found on the pane, if any.
    pub blocked: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Dead,
    Drifted,
    Blocked(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Hold {
    /// A session we did not create already has the name.
    Conflict,
    /// The worktree has uncommitted or untracked work (that many entries).
    DirtyWorktree(usize),
    /// Blocked on something only a person can clear, such as a sign-in.
    Blocked(String),
    /// Restarted too often in the window.
    Backoff(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", content = "why", rename_all = "snake_case")]
pub enum Decision {
    Create,
    Recreate(Reason),
    Keep,
    Hold(Hold),
}

/// `dirty` is only called when a restart is actually on the table, so a healthy
/// session never costs a `git status`.
pub fn decide(want: &Wanted<'_>, seen: Option<&Seen<'_>>, dirty: impl FnOnce() -> usize, restarts: u32) -> Decision {
    let Some(s) = seen else { return Decision::Create };
    if !s.owned {
        return Decision::Hold(Hold::Conflict);
    }
    let reason = if s.fingerprint != want.fingerprint {
        Reason::Drifted
    } else if s.dead {
        Reason::Dead
    } else if let Some(b) = s.blocked {
        if !fixable_by_recreate(b) {
            return Decision::Hold(Hold::Blocked(b.to_string()));
        }
        Reason::Blocked(b.to_string())
    } else {
        return Decision::Keep;
    };
    if want.worktree {
        let n = dirty();
        if n > 0 {
            return Decision::Hold(Hold::DirtyWorktree(n));
        }
    }
    if restarts >= MAX_RESTARTS {
        return Decision::Hold(Hold::Backoff(restarts));
    }
    Decision::Recreate(reason)
}

/// Restarts per slug inside a sliding window.
#[derive(Debug, Default)]
pub struct Restarts {
    map: HashMap<String, Vec<Instant>>,
}

impl Restarts {
    pub fn count(&mut self, slug: &str) -> u32 {
        let now = Instant::now();
        let v = self.map.entry(slug.to_string()).or_default();
        v.retain(|t| now.duration_since(*t) < RESTART_WINDOW);
        v.len() as u32
    }

    pub fn record(&mut self, slug: &str) {
        self.map.entry(slug.to_string()).or_default().push(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: Wanted<'static> = Wanted { fingerprint: "fp1", worktree: true };

    fn seen<'a>(dead: bool, fp: &'a str, blocked: Option<&'a str>) -> Seen<'a> {
        Seen { owned: true, dead, fingerprint: fp, blocked }
    }

    #[test]
    fn missing_is_created() {
        assert_eq!(decide(&W, None, || 0, 0), Decision::Create);
    }

    #[test]
    fn healthy_is_kept_and_costs_no_git_status() {
        let s = seen(false, "fp1", None);
        assert_eq!(decide(&W, Some(&s), || panic!("git status must not run for a healthy session"), 0), Decision::Keep);
    }

    #[test]
    fn dead_blocked_on_trust_and_drifted_are_recreated() {
        assert_eq!(decide(&W, Some(&seen(true, "fp1", None)), || 0, 0), Decision::Recreate(Reason::Dead));
        assert_eq!(decide(&W, Some(&seen(false, "fp1", Some("Yes, I trust this folder"))), || 0, 0), Decision::Recreate(Reason::Blocked("Yes, I trust this folder".into())));
        assert_eq!(decide(&W, Some(&seen(false, "old", None)), || 0, 0), Decision::Recreate(Reason::Drifted));
    }

    /// deepseek's `deepseek-chat` -> `deepseek-flash` drift: a live session on a
    /// stale model is recreated, not skipped as "already exists".
    #[test]
    fn drift_is_recreated_even_when_the_pane_is_alive() {
        assert_eq!(decide(&W, Some(&seen(false, "stale-model", None)), || 0, 0), Decision::Recreate(Reason::Drifted));
    }

    #[test]
    fn a_sign_in_blocker_is_reported_and_never_looped_on() {
        let d = decide(&W, Some(&seen(false, "fp1", Some("You are currently not signed in"))), || 0, 0);
        assert_eq!(d, Decision::Hold(Hold::Blocked("You are currently not signed in".into())));
    }

    #[test]
    fn a_dirty_worktree_stops_the_restart_but_a_worktreeless_seed_ignores_the_gate() {
        let dead = seen(true, "fp1", None);
        assert_eq!(decide(&W, Some(&dead), || 4, 0), Decision::Hold(Hold::DirtyWorktree(4)));
        let shared = Wanted { fingerprint: "fp1", worktree: false };
        assert_eq!(decide(&shared, Some(&dead), || panic!("no worktree, no gate"), 0), Decision::Recreate(Reason::Dead));
    }

    #[test]
    fn a_foreign_session_with_our_name_is_never_touched() {
        let s = Seen { owned: false, dead: true, fingerprint: "", blocked: None };
        assert_eq!(decide(&W, Some(&s), || 0, 0), Decision::Hold(Hold::Conflict));
    }

    #[test]
    fn restart_storms_stop_after_the_cap() {
        let dead = seen(true, "fp1", None);
        assert_eq!(decide(&W, Some(&dead), || 0, MAX_RESTARTS - 1), Decision::Recreate(Reason::Dead));
        assert_eq!(decide(&W, Some(&dead), || 0, MAX_RESTARTS), Decision::Hold(Hold::Backoff(MAX_RESTARTS)));
    }

    #[test]
    fn restarts_are_counted_per_slug() {
        let mut r = Restarts::default();
        r.record("a");
        r.record("a");
        r.record("b");
        assert_eq!((r.count("a"), r.count("b"), r.count("c")), (2, 1, 0));
    }
}
