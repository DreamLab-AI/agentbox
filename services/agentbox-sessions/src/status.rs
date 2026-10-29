//! Session status (ADR-2153 §7).
//!
//! `dead` comes from tmux (`pane_dead`). `blocked` is a pane-capture match
//! against the launch contract's blocker patterns. `busy` and `idle` come from
//! an agent hook when one reports, otherwise from the contract's `ready`
//! pattern, otherwise from age against the settle time. A blocked session is
//! never reported idle.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", content = "detail", rename_all = "snake_case")]
pub enum State {
    Dead,
    Blocked(String),
    Busy,
    Idle,
    Starting,
    /// A declared session with no tmux session behind it.
    Missing,
}

impl State {
    pub fn label(&self) -> String {
        match self {
            State::Missing => "missing".into(),
            State::Dead => "dead".into(),
            State::Blocked(why) => format!("blocked: {why}"),
            State::Busy => "busy".into(),
            State::Idle => "idle".into(),
            State::Starting => "starting".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hook {
    Busy,
    Idle,
}

pub struct Inputs<'a> {
    pub dead: bool,
    pub pane: &'a str,
    pub blockers: &'a [String],
    pub ready: Option<&'a str>,
    pub hook: Option<Hook>,
    pub age_secs: u64,
    pub settle_secs: u64,
}

pub fn classify(i: &Inputs<'_>) -> State {
    if i.dead {
        return State::Dead;
    }
    if let Some(p) = i.blockers.iter().find(|p| !p.is_empty() && i.pane.contains(p.as_str())) {
        return State::Blocked(p.clone());
    }
    match i.hook {
        Some(Hook::Busy) => return State::Busy,
        Some(Hook::Idle) => return State::Idle,
        None => {}
    }
    if i.ready.is_some_and(|r| i.pane.contains(r)) {
        return State::Idle;
    }
    if i.age_secs < i.settle_secs {
        State::Starting
    } else {
        State::Idle
    }
}

/// Whether recreating the session can clear this blocker. A trust prompt is
/// cleared by seeding trust and starting again. A sign-in prompt is not:
/// recreating it would loop for ever, so it is reported and left alone.
pub fn fixable_by_recreate(blocker: &str) -> bool {
    blocker.to_lowercase().contains("trust")
}

/// Hook state lives in one small file per slug, written by `agentbox-sessions
/// mark` from an agent's own hook (Claude Stop/Notification, Codex `notify`).
pub fn hook_path(dir: &Path, slug: &str) -> PathBuf {
    dir.join(slug)
}

pub fn read_hook(dir: &Path, slug: &str) -> Option<Hook> {
    match std::fs::read_to_string(hook_path(dir, slug)).ok()?.trim() {
        "busy" => Some(Hook::Busy),
        "idle" => Some(Hook::Idle),
        _ => None,
    }
}

pub fn write_hook(dir: &Path, slug: &str, state: Hook) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(hook_path(dir, slug), if state == Hook::Busy { "busy" } else { "idle" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn i<'a>(pane: &'a str, blockers: &'a [String]) -> Inputs<'a> {
        Inputs { dead: false, pane, blockers, ready: None, hook: None, age_secs: 100, settle_secs: 20 }
    }

    #[test]
    fn dead_wins_over_everything() {
        let b = vec!["Yes, I trust this folder".to_string()];
        let mut x = i("Yes, I trust this folder", &b);
        x.dead = true;
        assert_eq!(classify(&x), State::Dead);
    }

    #[test]
    fn a_blocked_session_is_never_idle_even_when_a_hook_says_idle() {
        let b = vec!["Select login method".to_string()];
        let mut x = i("Select login method\n> ", &b);
        x.hook = Some(Hook::Idle);
        assert_eq!(classify(&x), State::Blocked("Select login method".into()));
    }

    #[test]
    fn hook_beats_the_ready_pattern_and_age() {
        let mut x = i("Ask anything", &[]);
        x.ready = Some("Ask anything");
        x.hook = Some(Hook::Busy);
        assert_eq!(classify(&x), State::Busy);
    }

    #[test]
    fn ready_pattern_means_idle_before_the_settle_time() {
        let mut x = i("Ask anything", &[]);
        x.ready = Some("Ask anything");
        x.age_secs = 1;
        assert_eq!(classify(&x), State::Idle);
    }

    #[test]
    fn without_a_ready_pattern_a_young_pane_is_starting_then_idle() {
        let mut x = i("", &[]);
        x.age_secs = 5;
        assert_eq!(classify(&x), State::Starting);
        x.age_secs = 25;
        assert_eq!(classify(&x), State::Idle);
    }

    #[test]
    fn only_trust_prompts_are_fixable_by_recreating() {
        assert!(fixable_by_recreate("Yes, I trust this folder"));
        assert!(fixable_by_recreate("Trust this folder?"));
        assert!(!fixable_by_recreate("Select login method"));
        assert!(!fixable_by_recreate("You are currently not signed in"));
    }

    #[test]
    fn hook_files_round_trip() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read_hook(d.path(), "codex"), None);
        write_hook(d.path(), "codex", Hook::Busy).unwrap();
        assert_eq!(read_hook(d.path(), "codex"), Some(Hook::Busy));
        write_hook(d.path(), "codex", Hook::Idle).unwrap();
        assert_eq!(read_hook(d.path(), "codex"), Some(Hook::Idle));
    }
}
