//! How an evaluator command is actually executed, and the seam that makes the
//! acceptance path testable without an annexe.
//!
//! Production runs evaluators over SSH on the connected node annexe ([`SshRunner`]).
//! Tests — and any future local-mode dry run — use [`LocalRunner`] against a
//! real directory, or [`ScriptedRunner`] to replay a fixed set of outcomes.
//! Everything downstream (receipts, the required-check gate, the verdict)
//! consumes [`ExecOutcome`] and never knows which one ran.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use crate::dispatch::shell_quote;

/// A raw execution: both streams, the exit status, how long it took, and
/// whether the transport itself failed (which is not the same as the command
/// failing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    /// Set when the command could not be delivered or started at all.
    pub transport_error: Option<String>,
    pub timed_out: bool,
    pub started_at: String,
}

impl ExecOutcome {
    pub fn blocked(detail: impl Into<String>) -> Self {
        Self {
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            transport_error: Some(detail.into()),
            timed_out: false,
            started_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Runs one evaluator command in a working directory under a wall-clock budget.
pub trait EvaluatorRunner: Send + Sync {
    fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome;
    /// Short description for logs and receipts provenance.
    fn describe(&self) -> String;
}

/// Wrap `command` so the remote shell enforces the timeout and reports 124 on
/// expiry. `--kill-after` guarantees a hung child is reaped rather than
/// inherited by the next night.
///
/// `-o pipefail` is load-bearing (2026-09-06 dream night, agentbox
/// sovereign-mesh): every declared evaluator tails its output (`cargo build
/// 2>&1 | tail -12`), and without pipefail the pipeline's status is `tail`'s
/// 0, so a cargo abort was recorded `outcome=PASSED exit=0` — a pipe-masked
/// false positive that made a REQUIRED gate vacuous. With pipefail the
/// receipt carries the failing stage's exit code and the gate can veto.
fn timeout_wrapped(work_dir: &str, command: &str, timeout_secs: u64) -> String {
    format!(
        "cd {} && timeout --signal=TERM --kill-after=30s {}s bash -o pipefail -c {}",
        shell_quote(work_dir),
        timeout_secs,
        shell_quote(command)
    )
}

/// The production runner: evaluators execute on the connected node annexe over SSH.
pub struct SshRunner {
    pub host: String,
}

impl EvaluatorRunner for SshRunner {
    fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome {
        crate::dispatch::ssh_capture(&self.host, &timeout_wrapped(work_dir, command, timeout_secs))
    }

    fn describe(&self) -> String {
        format!("ssh:{}", self.host)
    }
}

/// Runs the command locally with `bash -c` in `work_dir`. Used by the candidate
/// rerun tests (a git worktree is a real tree; no annexe needed) and available
/// for local-mode operation.
pub struct LocalRunner;

impl EvaluatorRunner for LocalRunner {
    fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome {
        let started_at = chrono::Utc::now().to_rfc3339();
        let t0 = Instant::now();
        // Same timeout semantics as the SSH path, so a receipt means the same
        // thing whichever runner produced it.
        let wrapped = format!(
            "timeout --signal=TERM --kill-after=30s {}s bash -o pipefail -c {}",
            timeout_secs,
            shell_quote(command)
        );
        let out = Command::new("bash")
            .arg("-c")
            .arg(&wrapped)
            .current_dir(PathBuf::from(work_dir))
            .output();
        match out {
            Ok(o) => ExecOutcome {
                exit_code: o.status.code(),
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
                duration_ms: t0.elapsed().as_millis(),
                transport_error: None,
                timed_out: false,
                started_at,
            },
            Err(e) => ExecOutcome::blocked(format!("spawning bash in {work_dir}: {e}")),
        }
    }

    fn describe(&self) -> String {
        "local".into()
    }
}

/// A runner that replays pre-set outcomes, keyed by the exact command string.
/// An unknown command is [`ExecOutcome::blocked`] — a test that forgets to
/// script an evaluator sees a harness fault, never an accidental pass.
pub struct ScriptedRunner {
    outcomes: HashMap<String, ExecOutcome>,
}

impl ScriptedRunner {
    pub fn new() -> Self {
        Self {
            outcomes: HashMap::new(),
        }
    }

    pub fn with(mut self, command: &str, outcome: ExecOutcome) -> Self {
        self.outcomes.insert(command.to_string(), outcome);
        self
    }

    /// Convenience: a clean pass.
    pub fn passing(self, command: &str, stdout: &str) -> Self {
        self.with(
            command,
            ExecOutcome {
                exit_code: Some(0),
                stdout: stdout.into(),
                stderr: String::new(),
                duration_ms: 5,
                transport_error: None,
                timed_out: false,
                started_at: "2026-09-05T01:00:00Z".into(),
            },
        )
    }

    /// Convenience: a non-zero exit.
    pub fn failing(self, command: &str, code: i32, stderr: &str) -> Self {
        self.with(
            command,
            ExecOutcome {
                exit_code: Some(code),
                stdout: String::new(),
                stderr: stderr.into(),
                duration_ms: 5,
                transport_error: None,
                timed_out: false,
                started_at: "2026-09-05T01:00:00Z".into(),
            },
        )
    }
}

impl Default for ScriptedRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl EvaluatorRunner for ScriptedRunner {
    fn run(&self, _work_dir: &str, command: &str, _timeout_secs: u64) -> ExecOutcome {
        self.outcomes
            .get(command)
            .cloned()
            .unwrap_or_else(|| ExecOutcome::blocked(format!("no scripted outcome for {command:?}")))
    }

    fn describe(&self) -> String {
        "scripted".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_wrapper_quotes_the_command_and_the_directory() {
        let w = timeout_wrapped("/tmp/it's here", "cargo test --all", 900);
        assert!(w.starts_with("cd '/tmp/it'\\''s here' && timeout"), "got {w}");
        assert!(
            w.contains("--kill-after=30s 900s bash -o pipefail -c 'cargo test --all'"),
            "got {w}"
        );
    }

    /// The 2026-09-06 pipe-masked false positive: a failing producer piped
    /// through `tail` must surface its own exit code, not tail's 0.
    #[test]
    fn local_runner_does_not_let_a_tail_pipe_mask_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let out = LocalRunner.run(
            dir.path().to_str().unwrap(),
            "sh -c 'echo error: manifest missing; exit 101' 2>&1 | tail -3",
            30,
        );
        assert_eq!(
            out.exit_code,
            Some(101),
            "pipefail must propagate the producer's exit: {out:?}"
        );
        assert!(out.stdout.contains("manifest missing"));
    }

    #[test]
    fn local_runner_captures_streams_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let r = LocalRunner;
        let o = r.run(dir.path().to_str().unwrap(), "echo out; echo err >&2; exit 3", 30);
        assert_eq!(o.exit_code, Some(3));
        assert_eq!(o.stdout.trim(), "out");
        assert_eq!(o.stderr.trim(), "err");
        assert!(o.transport_error.is_none());
    }

    #[test]
    fn local_runner_runs_in_the_given_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "hi").unwrap();
        let o = LocalRunner.run(dir.path().to_str().unwrap(), "cat marker.txt", 30);
        assert_eq!(o.stdout, "hi");
    }

    #[test]
    fn local_runner_enforces_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let o = LocalRunner.run(dir.path().to_str().unwrap(), "sleep 5", 1);
        assert_eq!(o.exit_code, Some(124), "GNU timeout signals expiry as 124");
    }

    #[test]
    fn scripted_runner_blocks_on_unscripted_commands() {
        let r = ScriptedRunner::new().passing("cargo test", "ok");
        assert_eq!(r.run("/x", "cargo test", 60).exit_code, Some(0));
        let unknown = r.run("/x", "cargo clippy", 60);
        assert!(unknown.transport_error.is_some(), "an unscripted command must not pass");
    }
}
