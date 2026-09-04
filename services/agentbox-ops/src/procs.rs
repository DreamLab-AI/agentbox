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

/// Match a daemon invocation using argv boundaries, never text embedded in a
/// shell command, search query or prompt. Unknown launchers fail closed.
fn is_daemon_argv(args: &[&str]) -> bool {
    let Some(program) = args.first() else {
        return false;
    };
    let basename = |path: &str| {
        std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string()
    };
    let daemon_args = match basename(program).as_str() {
        "ruflo" | "claude-flow" => &args[1..],
        "node" | "nodejs" => {
            let Some(script) = args.get(1) else {
                return false;
            };
            let named_launcher = matches!(basename(script).as_str(), "ruflo" | "claude-flow");
            let package_script = basename(script) == "cli.js"
                && std::path::Path::new(script).components().any(|part| {
                    matches!(
                        part.as_os_str().to_str(),
                        Some("ruflo" | "claude-flow" | "@claude-flow")
                    )
                });
            if !named_launcher && !package_script {
                return false;
            }
            &args[2..]
        }
        _ => return false,
    };
    daemon_args.starts_with(&["daemon", "start"])
}

/// Read the workspace as one argument, preserving spaces and flag-like text
/// within paths. Both common option spellings are supported.
fn workspace_argv(args: &[&str]) -> String {
    for (index, arg) in args.iter().enumerate() {
        let value = if *arg == "--workspace" {
            args.get(index + 1)
                .copied()
                .filter(|s| !s.starts_with("--"))
        } else {
            arg.strip_prefix("--workspace=")
        };
        if let Some(value) = value.filter(|s| !s.is_empty()) {
            return value.to_string();
        }
    }
    "?".to_string()
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
            let args: Vec<_> = proc_.cmd().iter().map(|s| s.to_string_lossy()).collect();
            let argv: Vec<_> = args.iter().map(|s| s.as_ref()).collect();
            if !is_daemon_argv(&argv) {
                return None;
            }
            Some(DaemonProc {
                pid: pid.as_u32(),
                workspace: workspace_argv(&argv),
                run_time_secs: proc_.run_time(),
                cmdline: argv.join(" "),
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
    let args: Vec<_> = proc_.cmd().iter().map(|s| s.to_string_lossy()).collect();
    let argv: Vec<_> = args.iter().map(|s| s.as_ref()).collect();
    Some(is_daemon_argv(&argv))
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
    fn daemon_invocations_require_known_launcher_and_separate_arguments() {
        for argv in [
            vec!["ruflo", "daemon", "start"],
            vec!["/opt/bin/claude-flow", "daemon", "start"],
            vec![
                "node",
                "/opt/node_modules/ruflo/dist/cli.js",
                "daemon",
                "start",
            ],
            vec![
                "node",
                "/opt/node_modules/@claude-flow/cli/dist/cli.js",
                "daemon",
                "start",
            ],
            vec!["node", "/opt/bin/ruflo", "daemon", "start"],
        ] {
            assert!(is_daemon_argv(&argv), "{argv:?}");
        }
        for argv in [
            vec![],
            vec!["sh", "-c", "ruflo daemon start"],
            vec!["rg", "ruflo daemon start"],
            vec!["node", "unrelated/cli.js", "daemon", "start"],
            vec!["node", "/tmp/not-ruflo/cli.js", "daemon", "start"],
            vec!["ruflo", "agent", "--prompt", "daemon start"],
            vec!["ruflo", "daemon start"],
            vec!["node", "-e", "ruflo daemon start"],
        ] {
            assert!(!is_daemon_argv(&argv), "{argv:?}");
        }
    }

    #[test]
    fn workspace_preserves_argument_boundaries() {
        assert_eq!(
            workspace_argv(&[
                "ruflo",
                "daemon",
                "start",
                "--workspace",
                "/home/a -- b",
                "--port",
                "9"
            ]),
            "/home/a -- b"
        );
        assert_eq!(
            workspace_argv(&["ruflo", "daemon", "start", "--workspace=/home/a b"]),
            "/home/a b"
        );
        assert_eq!(workspace_argv(&["ruflo", "daemon", "start"]), "?");
        assert_eq!(workspace_argv(&["--workspace", "--port", "9"]), "?");
        assert_eq!(workspace_argv(&["--workspace="]), "?");
    }

    #[test]
    fn etime_matches_ps_shape() {
        assert_eq!(format_etime(45), "00:45");
        assert_eq!(format_etime(3 * 60 + 5), "03:05");
        assert_eq!(format_etime(2 * 3600 + 3 * 60 + 5), "02:03:05");
        assert_eq!(format_etime(86_400 + 2 * 3600 + 3 * 60 + 5), "1-02:03:05");
    }
}
