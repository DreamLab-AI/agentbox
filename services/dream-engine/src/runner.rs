//! The production evaluator runner: SSH to the connected node annexe.
//!
//! The runner seam itself ([`EvaluatorRunner`], `LocalRunner`,
//! `ScriptedRunner`, [`ExecOutcome`]) lives in `dream_core::runner`; this
//! module is the estate-specific implementation of that seam. Everything
//! downstream (receipts, the required-check gate, the verdict) consumes
//! [`ExecOutcome`] and never knows which runner produced it.

pub use dream_core::runner::EvaluatorRunner;
pub use dream_gate::outcome::ExecOutcome;

use dream_gate::outcome::shell_quote;

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
    /// `user@host` the commands run on.
    pub host: String,
}

impl EvaluatorRunner for SshRunner {
    fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome {
        crate::dispatch::ssh_capture(
            &self.host,
            &timeout_wrapped(work_dir, command, timeout_secs),
        )
    }

    fn describe(&self) -> String {
        format!("ssh:{}", self.host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_wrapper_quotes_the_command_and_the_directory() {
        let w = timeout_wrapped("/tmp/it's here", "cargo test --all", 900);
        assert!(
            w.starts_with("cd '/tmp/it'\\''s here' && timeout"),
            "got {w}"
        );
        assert!(
            w.contains("--kill-after=30s 900s bash -o pipefail -c 'cargo test --all'"),
            "got {w}"
        );
    }

    /// With no annexe host configured the runner reports a transport fault
    /// (a harness veto at the gate), never a pass.
    #[test]
    fn an_unconfigured_host_is_a_transport_fault_not_a_pass() {
        let r = SshRunner {
            host: String::new(),
        };
        let o = r.run("/x", "true", 5);
        assert!(o.exit_code.is_none());
        assert!(o.transport_error.is_some());
        assert_eq!(r.describe(), "ssh:");
    }
}
