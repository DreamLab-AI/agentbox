//! `ruflo-daemon-gc` — list and reap leaked ruflo/claude-flow daemons.
//!
//! Replaces `scripts/ruflo-daemon-gc.py`. Registry-first discovery with a
//! process-table sweep fallback, staleness = workspace gone OR older than the
//! TTL. Captured argv/start-time identity is rechecked after opening a pidfd;
//! only that pinned process can receive a signal. Unverifiable targets are refused.
//!
//! No ruflo daemon runs under supervisord and the runtime pins
//! `RUFLO_DAEMON_AI_WORKERS=0`, so anything found here was started ad hoc
//! inside a session.

use agentbox_ops::process_identity::{self, ProcFs, ProcessIdentity};
use agentbox_ops::procs;
use agentbox_ops::pyjson;
use clap::Parser;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

const REGISTRY_FILES: [&str; 3] = [
    "ai-jobs.json",
    "workspace-leases.json",
    "repo-supervisors.json",
];

#[derive(Parser)]
#[command(
    name = "ruflo-daemon-gc",
    about = "List/reap leaked ruflo daemons (pid-reuse guarded)"
)]
struct Args {
    /// SIGTERM confirmed-stale daemons.
    #[arg(long)]
    kill: bool,
    /// Staleness age in seconds (default 43200 = 12h).
    #[arg(long, default_value_t = 43_200)]
    ttl: u64,
    /// Machine-readable output.
    #[arg(long)]
    json: bool,
}

/// A daemon-shaped process found in a registry file or the process table.
/// The PID is the map key, so it is not repeated here.
#[derive(Clone)]
struct Discovered {
    workspace: String,
    source: String,
}

/// Reads daemon PIDs recorded in the claude-flow registry files.
fn registry_daemons(cf_home: &Path) -> BTreeMap<u32, Discovered> {
    let mut found = BTreeMap::new();
    for name in REGISTRY_FILES {
        let Ok(text) = std::fs::read_to_string(cf_home.join(name)) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let entries: Vec<&Value> = match &data {
            Value::Object(map) => map.values().collect(),
            Value::Array(list) => list.iter().collect(),
            _ => continue,
        };
        for e in entries {
            let Some(pid) = e.get("pid").and_then(Value::as_u64) else {
                continue;
            };
            // Linux signals accept positive signed PIDs. Never truncate a
            // registry number into another process or a process-group ID.
            let Some(pid) = registry_pid(pid) else {
                continue;
            };
            let workspace = ["workspace", "cwd", "repo"]
                .iter()
                .find_map(|k| e.get(*k).and_then(Value::as_str))
                .unwrap_or("?")
                .to_string();
            found.insert(
                pid,
                Discovered {
                    workspace,
                    source: name.to_string(),
                },
            );
        }
    }
    found
}

fn registry_pid(pid: u64) -> Option<u32> {
    (pid > 0 && pid <= i32::MAX as u64).then_some(pid as u32)
}

/// Pin the kernel process before rechecking identity, closing the verify/kill race.
fn terminate(recorded: &ProcessIdentity) -> Result<(), String> {
    let raw = i32::try_from(recorded.pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
        .ok_or_else(|| "invalid process id".to_string())?;
    let fd = rustix::process::pidfd_open(raw, rustix::process::PidfdFlags::empty())
        .map_err(|e| format!("cannot pin process identity: {e}"))?;
    let verdict = process_identity::verify(&ProcFs::default(), recorded);
    if !verdict.is_match() {
        return Err(format!("process identity refused: {verdict:?}"));
    }
    rustix::process::pidfd_send_signal(&fd, rustix::process::Signal::TERM)
        .map_err(|e| format!("signal failed: {e}"))
}

fn main() {
    let args = Args::parse();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
    let cf_home = Path::new(&home).join(".claude-flow");

    let mut daemons = registry_daemons(&cf_home);
    for d in procs::sweep() {
        daemons.insert(
            d.pid,
            Discovered {
                workspace: d.workspace,
                source: "ps".to_string(),
            },
        );
    }

    let mut rows: Vec<Value> = Vec::new();
    let mut stale_confirmed: Vec<ProcessIdentity> = Vec::new();
    let mut stale_unconfirmed: Vec<u32> = Vec::new();

    for (pid, d) in &daemons {
        let captured = process_identity::capture(&ProcFs::default(), *pid).ok();
        if captured
            .as_ref()
            .is_some_and(|p| !process_identity::is_ruflo_daemon_argv(&p.argv_refs()))
        {
            continue;
        }
        let confirmed = captured.is_some();
        // A stale registry row must not supply the workspace of a replacement process.
        let workspace = match &captured {
            Some(p) => procs::workspace_argv(&p.argv_refs()),
            None => d.workspace.clone(),
        };
        let age = procs::run_time_secs(*pid);
        let workspace_gone =
            workspace != "?" && !workspace.is_empty() && !Path::new(&workspace).is_dir();
        let stale = workspace_gone || age.map(|a| a > args.ttl).unwrap_or(false);

        if stale {
            if let Some(identity) = captured {
                stale_confirmed.push(identity);
            } else {
                stale_unconfirmed.push(*pid);
            }
        }

        rows.push(json!({
            "pid": pid,
            "workspace": workspace,
            "source": d.source,
            "age_s": age,
            "confirmed": confirmed,
            "workspace_gone": workspace_gone,
            "stale": stale,
        }));
    }

    let mut killed: Vec<u32> = Vec::new();
    if args.kill {
        for pid in &stale_unconfirmed {
            eprintln!("  refuse pid={pid}: cmdline unconfirmable (pid reuse guard)");
        }
        for identity in &stale_confirmed {
            let pid = identity.pid;
            let workspace = procs::workspace_argv(&identity.argv_refs());
            let gone = workspace != "?" && !workspace.is_empty() && !Path::new(&workspace).is_dir();
            if !gone && !procs::run_time_secs(pid).is_some_and(|age| age > args.ttl) {
                eprintln!("  refuse pid={pid}: no longer stale");
                continue;
            }
            match terminate(identity) {
                Ok(()) => killed.push(pid),
                Err(e) => eprintln!("  pid={pid}: kill failed ({e})"),
            }
        }
    }

    if args.json {
        println!(
            "{}",
            pyjson::dumps_indent(&json!({"daemons": rows, "killed": killed}), 2)
        );
        return;
    }

    if rows.is_empty() {
        println!("✓ no ruflo/claude-flow daemons running");
        return;
    }
    for r in &rows {
        let mark = if r["stale"].as_bool().unwrap_or(false) {
            "STALE"
        } else {
            "live "
        };
        let age = match r["age_s"].as_u64() {
            Some(a) => format!("{a}s"),
            None => "?".to_string(),
        };
        let gone = if r["workspace_gone"].as_bool().unwrap_or(false) {
            " (workspace gone)"
        } else {
            ""
        };
        println!(
            "  [{mark}] pid={:>7} age={age:>9} src={:<22} {}{gone}",
            r["pid"].as_u64().unwrap_or(0),
            r["source"].as_str().unwrap_or(""),
            r["workspace"].as_str().unwrap_or("")
        );
    }
    if !killed.is_empty() {
        println!(
            "\nSIGTERM sent to {} stale daemon(s): {killed:?}",
            killed.len()
        );
    } else if rows.iter().any(|r| r["stale"].as_bool().unwrap_or(false)) && !args.kill {
        println!("\nStale daemons found — re-run with --kill to reap them.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reused_identity_is_refused_and_a_matching_child_is_signalled_by_pidfd() {
        use std::io::BufRead;
        let mut child = std::process::Command::new("bash")
            .args(["-c", "printf 'ready\\n'; read -r reaper_fixture_wait"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut ready = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready, "ready\n");
        let recorded = process_identity::capture(&ProcFs::default(), child.id()).unwrap();
        let mut reused = recorded.clone();
        reused.starttime = reused.starttime.wrapping_add(1);
        let refused = terminate(&reused);
        let still_running = child.try_wait().unwrap().is_none();
        let delivered = terminate(&recorded);
        if delivered.is_err() {
            let _ = child.kill();
        }
        let status = child.wait().unwrap();
        assert!(refused.is_err(), "a replacement identity must be refused");
        assert!(still_running, "refusal must not signal the process");
        assert!(delivered.is_ok(), "{delivered:?}");
        assert!(!status.success());
    }

    #[test]
    fn registry_pid_rejects_zero_negative_casts_and_truncation() {
        assert_eq!(registry_pid(42), Some(42));
        assert_eq!(registry_pid(i32::MAX as u64), Some(i32::MAX as u32));
        for pid in [0, i32::MAX as u64 + 1, u32::MAX as u64 + 42, u64::MAX] {
            assert_eq!(registry_pid(pid), None);
        }
    }
}
