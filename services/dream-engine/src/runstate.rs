//! Restart-safe run identity and the phase journal.
//!
//! The estate review found the engine's identity to be non-durable: branch and
//! worktree names are `topic + date`, and the nightly loop keeps "last run
//! date" in process memory, so "restarting inside the window can repeat a
//! night" and "repeated runs can overwrite artefacts even while ledger rows
//! accumulate".
//!
//! A run journal fixes both halves. The identity is the manifest's deterministic
//! [`crate::manifest::run_id`], and this module writes a small durable record
//! beside it after every phase transition. On restart the engine reads it and
//! learns, without guessing, whether this night already finished (skip it),
//! died part-way (resume, with the attempt counted) or has burned through its
//! attempt budget (abandon it loudly rather than looping).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::manifest::write_atomic;

pub const RUNSTATE_SCHEMA: u32 = 1;

/// Default number of attempts a single night gets before it is abandoned.
/// Two: one clean try plus one recovery from a crash or a reboot.
pub const DEFAULT_MAX_ATTEMPTS: u32 = 2;

/// Where a run got to. Ordered by progress, so `>=` comparisons are meaningful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Initialised,
    ManifestFrozen,
    BaselineEvaluated,
    ModelCalled,
    CandidateEvaluated,
    Gated,
    Persisted,
    Complete,
    /// Out of attempts. Terminal, and never silently retried.
    Abandoned,
}

impl Phase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Phase::Initialised => "initialised",
            Phase::ManifestFrozen => "manifest-frozen",
            Phase::BaselineEvaluated => "baseline-evaluated",
            Phase::ModelCalled => "model-called",
            Phase::CandidateEvaluated => "candidate-evaluated",
            Phase::Gated => "gated",
            Phase::Persisted => "persisted",
            Phase::Complete => "complete",
            Phase::Abandoned => "abandoned",
        }
    }
}

/// The durable record of one run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub schema: u32,
    pub run_id: String,
    pub night_id: String,
    pub repo: String,
    pub date: String,
    pub phase: Phase,
    /// How many times this run has been started, including the current one.
    pub attempts: u32,
    pub max_attempts: u32,
    /// The phase the most recent restart resumed from, if it was a restart.
    pub resumed_from: Option<Phase>,
    pub first_seen: String,
    pub updated_at: String,
    pub last_error: Option<String>,
    pub verdict: Option<String>,
}

/// What [`begin`] found on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resume {
    /// No prior record — a first attempt.
    Fresh(RunState),
    /// A prior attempt died part-way; this attempt continues it.
    Resumed(RunState),
    /// The run already finished. The caller must NOT re-run it.
    AlreadyComplete(RunState),
    /// The attempt budget is exhausted. The caller must record the abandonment
    /// and move on rather than looping.
    Abandoned(RunState),
}

impl Resume {
    pub fn state(&self) -> &RunState {
        match self {
            Resume::Fresh(s) | Resume::Resumed(s) | Resume::AlreadyComplete(s) | Resume::Abandoned(s) => s,
        }
    }

    /// True when the caller should proceed with the night.
    pub fn should_run(&self) -> bool {
        matches!(self, Resume::Fresh(_) | Resume::Resumed(_))
    }
}

fn path(dir: &Path) -> PathBuf {
    dir.join("run-state.json")
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn save(dir: &Path, state: &RunState) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    write_atomic(&path(dir), &bytes)
}

/// Read the journal for `dir`, if one exists and parses.
pub fn load(dir: &Path) -> Option<RunState> {
    serde_json::from_str(&std::fs::read_to_string(path(dir)).ok()?).ok()
}

/// Open (or reopen) the journal for a run, deciding what this attempt is.
///
/// Writes the updated record before returning, so a crash immediately after
/// this call still leaves the attempt counted — an interrupted run can never
/// masquerade as a fresh one.
pub fn begin(
    dir: &Path,
    run_id: &str,
    night_id: &str,
    repo: &str,
    date: &str,
    max_attempts: u32,
) -> std::io::Result<Resume> {
    std::fs::create_dir_all(dir)?;
    match load(dir) {
        Some(prior) if prior.run_id == run_id => {
            if prior.phase == Phase::Complete {
                return Ok(Resume::AlreadyComplete(prior));
            }
            if prior.phase == Phase::Abandoned || prior.attempts >= max_attempts {
                let mut s = prior;
                s.phase = Phase::Abandoned;
                s.updated_at = now();
                save(dir, &s)?;
                return Ok(Resume::Abandoned(s));
            }
            let mut s = prior;
            s.resumed_from = Some(s.phase);
            s.attempts += 1;
            s.updated_at = now();
            s.last_error = None;
            save(dir, &s)?;
            Ok(Resume::Resumed(s))
        }
        // No record, or a record for a different experiment (the baseline or
        // the config moved). Either way this is a fresh run; the manifest
        // freeze has already archived the superseded document.
        _ => {
            let s = RunState {
                schema: RUNSTATE_SCHEMA,
                run_id: run_id.into(),
                night_id: night_id.into(),
                repo: repo.into(),
                date: date.into(),
                phase: Phase::Initialised,
                attempts: 1,
                max_attempts,
                resumed_from: None,
                first_seen: now(),
                updated_at: now(),
                last_error: None,
                verdict: None,
            };
            save(dir, &s)?;
            Ok(Resume::Fresh(s))
        }
    }
}

/// Record forward progress. Never moves the phase backwards, so a resumed run
/// re-walking earlier steps cannot rewrite history.
pub fn advance(dir: &Path, state: &mut RunState, phase: Phase) -> std::io::Result<()> {
    if phase > state.phase {
        state.phase = phase;
    }
    state.updated_at = now();
    save(dir, state)
}

/// Close the run out. `verdict` is the ledger verdict actually written.
pub fn complete(dir: &Path, state: &mut RunState, verdict: &str) -> std::io::Result<()> {
    state.phase = Phase::Complete;
    state.verdict = Some(verdict.to_string());
    state.updated_at = now();
    save(dir, state)
}

/// Record a failure without closing the run, so the next attempt resumes.
pub fn fail(dir: &Path, state: &mut RunState, error: &str) -> std::io::Result<()> {
    state.last_error = Some(error.chars().take(500).collect());
    state.updated_at = now();
    save(dir, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = "0123456789abcdef";

    fn begin_default(dir: &Path) -> Resume {
        begin(dir, RUN, "2026-09-05-agentbox", "agentbox", "2026-09-05", DEFAULT_MAX_ATTEMPTS).unwrap()
    }

    #[test]
    fn a_first_attempt_is_fresh_and_durable() {
        let d = tempfile::tempdir().unwrap();
        let r = begin_default(d.path());
        assert!(matches!(r, Resume::Fresh(_)));
        assert!(r.should_run());
        let on_disk = load(d.path()).unwrap();
        assert_eq!(on_disk.attempts, 1);
        assert_eq!(on_disk.phase, Phase::Initialised);
    }

    /// The interrupted-persistence case the ADR asks to exercise: a run that
    /// died after the model call resumes from exactly where it stopped, and the
    /// attempt is counted rather than lost.
    #[test]
    fn an_interrupted_run_resumes_from_its_last_phase() {
        let d = tempfile::tempdir().unwrap();
        let Resume::Fresh(mut s) = begin_default(d.path()) else { panic!() };
        advance(d.path(), &mut s, Phase::ManifestFrozen).unwrap();
        advance(d.path(), &mut s, Phase::ModelCalled).unwrap();
        fail(d.path(), &mut s, "process killed mid-persist").unwrap();
        drop(s); // the process dies here

        let r = begin_default(d.path());
        let Resume::Resumed(s2) = r.clone() else { panic!("expected a resume, got {r:?}") };
        assert_eq!(s2.resumed_from, Some(Phase::ModelCalled));
        assert_eq!(s2.attempts, 2);
        assert!(r.should_run());
        assert_eq!(s2.last_error, None, "the new attempt clears the stale error");
    }

    #[test]
    fn a_completed_run_is_never_silently_repeated() {
        let d = tempfile::tempdir().unwrap();
        let Resume::Fresh(mut s) = begin_default(d.path()) else { panic!() };
        complete(d.path(), &mut s, "REJECT").unwrap();

        let r = begin_default(d.path());
        assert!(matches!(r, Resume::AlreadyComplete(_)), "got {r:?}");
        assert!(!r.should_run());
        assert_eq!(r.state().verdict.as_deref(), Some("REJECT"));
        assert_eq!(r.state().attempts, 1, "a skipped repeat does not burn an attempt");
    }

    #[test]
    fn attempts_are_bounded_and_exhaustion_is_terminal() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(begin_default(d.path()), Resume::Fresh(_)));
        assert!(matches!(begin_default(d.path()), Resume::Resumed(_))); // attempt 2
        let r = begin_default(d.path());
        assert!(matches!(r, Resume::Abandoned(_)), "got {r:?}");
        assert!(!r.should_run());
        assert_eq!(load(d.path()).unwrap().phase, Phase::Abandoned);
        // Still abandoned on the next look — no accidental revival.
        assert!(matches!(begin_default(d.path()), Resume::Abandoned(_)));
    }

    #[test]
    fn a_different_run_id_starts_a_fresh_journal() {
        let d = tempfile::tempdir().unwrap();
        let Resume::Fresh(mut s) = begin_default(d.path()) else { panic!() };
        complete(d.path(), &mut s, "ACCEPT").unwrap();
        // New baseline ⇒ new run id ⇒ a genuinely new experiment.
        let r = begin(d.path(), "fedcba9876543210", "2026-09-05-agentbox", "agentbox", "2026-09-05", 2)
            .unwrap();
        assert!(matches!(r, Resume::Fresh(_)), "got {r:?}");
        assert_eq!(r.state().attempts, 1);
    }

    #[test]
    fn advance_never_moves_backwards() {
        let d = tempfile::tempdir().unwrap();
        let Resume::Fresh(mut s) = begin_default(d.path()) else { panic!() };
        advance(d.path(), &mut s, Phase::Gated).unwrap();
        advance(d.path(), &mut s, Phase::ManifestFrozen).unwrap();
        assert_eq!(load(d.path()).unwrap().phase, Phase::Gated);
    }

    #[test]
    fn a_corrupt_journal_does_not_wedge_the_night() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(path(d.path()), "{ this is not json").unwrap();
        assert!(matches!(begin_default(d.path()), Resume::Fresh(_)));
    }
}
