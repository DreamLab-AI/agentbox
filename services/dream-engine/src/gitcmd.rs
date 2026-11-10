//! Bounded, non-interactive `git` invocations shared by the archive step and
//! the ledger writer.
//!
//! Every call runs `git -C <dir> …` with standard input closed and terminal
//! prompts off, and is killed once its timeout passes, so a hung git (a stale
//! `index.lock` wait, an unreachable remote, a credential prompt) can never
//! stall a night or hold a ledger lock indefinitely.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How often a running git command is polled for completion.
const POLL: Duration = Duration::from_millis(50);

/// The result of one git invocation.
#[derive(Debug)]
pub(crate) struct GitRun {
    pub(crate) success: bool,
    pub(crate) code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

impl GitRun {
    /// git's own message (stderr, else stdout), or how it ended.
    pub(crate) fn message(&self) -> String {
        let text = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        match (text.trim().is_empty(), self.code) {
            (false, _) => text.trim().to_string(),
            (true, Some(c)) => format!("git exited {c}"),
            (true, None) => "git was killed".to_string(),
        }
    }
}

/// Run `git -C dir <args>` non-interactively, killing it after `timeout`.
pub(crate) fn git(dir: &Path, args: &[&str], timeout: Duration) -> Result<GitRun, String> {
    git_env(dir, args, timeout, &[])
}

/// As [`git`], with extra environment variables for this invocation only.
pub(crate) fn git_env(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    env: &[(&str, &str)],
) -> Result<GitRun, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| format!("cannot run git: {e}"))?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut buf);
            }
            buf
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "git {} timed out after {}s",
                    args.iter()
                        .find(|a| !a.starts_with('-') && !a.contains('='))
                        .copied()
                        .unwrap_or(""),
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(e) => return Err(format!("waiting for git: {e}")),
        }
    };
    Ok(GitRun {
        success: status.success(),
        code: status.code(),
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

/// The effective value of a git config key in `dir` (repository, account and
/// system layers resolved by git), trimmed; `None` when unset, blank, or git
/// cannot answer.
pub(crate) fn config_value(dir: &Path, key: &str, timeout: Duration) -> Option<String> {
    git(dir, &["config", "--get", key], timeout)
        .ok()
        .filter(|r| r.success)
        .map(|r| r.stdout.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_git_is_killed_and_named() {
        let dir = tempfile::tempdir().expect("tempdir");
        // `git -c alias.slow='!sleep 5' slow` stands in for any hung step.
        let err = git(
            dir.path(),
            &["-c", "alias.slow=!sleep 5", "slow"],
            Duration::from_millis(200),
        )
        .expect_err("times out");
        assert!(err.contains("timed out"), "{err}");
        assert!(err.contains("slow"), "{err}");
    }
}
