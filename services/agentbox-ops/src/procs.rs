//! Process discovery shared by `ruflo-daemon-gc` and `token-audit`.
//!
//! Both tools look for leaked `ruflo` / `claude-flow` daemons. The Python
//! originals shelled out to `ps axww`; `sysinfo` gives the same fields
//! (pid, argv, run time) without a subprocess, and without the parsing
//! ambiguity of a space-separated `ps` line.

use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

/// One discovered daemon-shaped process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaemonProc {
    pub pid: u32,
    pub cmdline: String,
    /// Seconds since the process started.
    pub run_time_secs: u64,
    /// Value of `--workspace <path>`, or `?` when absent.
    pub workspace: String,
}

/// The Python predicate: `"daemon start" in cmd and ("cli.js" in cmd or
/// "ruflo" in cmd or "claude-flow" in cmd)`.
pub fn is_daemon_cmdline(cmd: &str) -> bool {
    cmd.contains("daemon start")
        && (cmd.contains("cli.js") || cmd.contains("ruflo") || cmd.contains("claude-flow"))
}

/// Extracts `--workspace <value>`, stopping at the next ` --` flag, matching
/// `args.split("--workspace ", 1)[1].split(" --")[0].strip()`.
pub fn extract_workspace(cmd: &str) -> String {
    match cmd.split_once("--workspace ") {
        Some((_, rest)) => {
            let value = rest.split(" --").next().unwrap_or("").trim();
            if value.is_empty() {
                "?".to_string()
            } else {
                value.to_string()
            }
        }
        None => "?".to_string(),
    }
}

fn snapshot() -> System {
    System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    )
}

/// Sweeps the process table for ruflo/claude-flow daemons.
pub fn sweep() -> Vec<DaemonProc> {
    let sys = snapshot();
    let mut found: Vec<DaemonProc> = sys
        .processes()
        .iter()
        .filter_map(|(pid, proc_)| {
            let cmdline = proc_
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            if !is_daemon_cmdline(&cmdline) {
                return None;
            }
            Some(DaemonProc {
                pid: pid.as_u32(),
                workspace: extract_workspace(&cmdline),
                run_time_secs: proc_.run_time(),
                cmdline,
            })
        })
        .collect();
    found.sort_by_key(|d| d.pid);
    found
}

/// Re-reads one PID's live command line. `None` means the PID could not be
/// confirmed — the caller must then refuse to signal it (PID-reuse guard).
pub fn confirm_daemon(pid: u32) -> Option<bool> {
    let sys = snapshot();
    let proc_ = sys.process(Pid::from_u32(pid))?;
    let cmdline = proc_
        .cmd()
        .iter()
        .map(|s| s.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    Some(is_daemon_cmdline(&cmdline))
}

/// Seconds since the process started, or `None` if it is gone.
pub fn run_time_secs(pid: u32) -> Option<u64> {
    let sys = snapshot();
    sys.process(Pid::from_u32(pid)).map(|p| p.run_time())
}

/// Formats a duration the way `ps -o etime=` does: `[[DD-]HH:]MM:SS`.
pub fn format_etime(secs: u64) -> String {
    let days = secs / 86_400;
    let hours = (secs % 86_400) / 3_600;
    let minutes = (secs % 3_600) / 60;
    let seconds = secs % 60;
    if days > 0 {
        format!("{}-{:02}:{:02}:{:02}", days, hours, minutes, seconds)
    } else if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
    } else {
        format!("{:02}:{:02}", minutes, seconds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_predicate_needs_both_halves() {
        assert!(is_daemon_cmdline("node cli.js daemon start --workspace /a"));
        assert!(is_daemon_cmdline("ruflo daemon start"));
        assert!(is_daemon_cmdline("claude-flow daemon start"));
        // "daemon start" alone is not enough.
        assert!(!is_daemon_cmdline("some-other daemon start"));
        // The tool name alone is not enough either.
        assert!(!is_daemon_cmdline("node cli.js serve"));
    }

    #[test]
    fn workspace_stops_at_the_next_flag() {
        assert_eq!(
            extract_workspace("node cli.js daemon start --workspace /home/a/b --port 9"),
            "/home/a/b"
        );
    }

    #[test]
    fn workspace_reads_to_end_when_it_is_the_last_flag() {
        assert_eq!(
            extract_workspace("node cli.js daemon start --workspace /home/a/b"),
            "/home/a/b"
        );
    }

    #[test]
    fn workspace_absent_is_question_mark() {
        assert_eq!(extract_workspace("node cli.js daemon start"), "?");
    }

    #[test]
    fn etime_matches_ps_shape() {
        assert_eq!(format_etime(45), "00:45");
        assert_eq!(format_etime(3 * 60 + 5), "03:05");
        assert_eq!(format_etime(2 * 3600 + 3 * 60 + 5), "02:03:05");
        assert_eq!(format_etime(86_400 + 2 * 3600 + 3 * 60 + 5), "1-02:03:05");
    }
}
