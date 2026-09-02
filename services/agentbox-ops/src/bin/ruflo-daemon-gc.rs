//! `ruflo-daemon-gc` — list and reap leaked ruflo/claude-flow daemons.
//!
//! Replaces `scripts/ruflo-daemon-gc.py`. Registry-first discovery with a
//! process-table sweep fallback, staleness = workspace gone OR older than the
//! TTL, and a PID-REUSE GUARD: a PID is signalled only after re-probing its
//! live command line; unconfirmable PIDs are refused, never killed.
//!
//! No ruflo daemon runs under supervisord and the runtime pins
//! `RUFLO_DAEMON_AI_WORKERS=0`, so anything found here was started ad hoc
//! inside a session.

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
            let workspace = ["workspace", "cwd", "repo"]
                .iter()
                .find_map(|k| e.get(*k).and_then(Value::as_str))
                .unwrap_or("?")
                .to_string();
            found.insert(
                pid as u32,
                Discovered {
                    workspace,
                    source: name.to_string(),
                },
            );
        }
    }
    found
}

fn main() {
    let args = Args::parse();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
    let cf_home = Path::new(&home).join(".claude-flow");

    let mut daemons = registry_daemons(&cf_home);
    for d in procs::sweep() {
        daemons.entry(d.pid).or_insert(Discovered {
            workspace: d.workspace,
            source: "ps".to_string(),
        });
    }

    let mut rows: Vec<Value> = Vec::new();
    let mut stale_confirmed: Vec<u32> = Vec::new();
    let mut stale_unconfirmed: Vec<u32> = Vec::new();

    for (pid, d) in &daemons {
        let confirmed = match procs::confirm_daemon(*pid) {
            // A registry entry whose PID now belongs to something else.
            Some(false) => continue,
            Some(true) => true,
            None => false,
        };
        let age = procs::run_time_secs(*pid);
        let workspace_gone =
            d.workspace != "?" && !d.workspace.is_empty() && !Path::new(&d.workspace).is_dir();
        let stale = workspace_gone || age.map(|a| a > args.ttl).unwrap_or(false);

        if stale {
            if confirmed {
                stale_confirmed.push(*pid);
            } else {
                stale_unconfirmed.push(*pid);
            }
        }

        rows.push(json!({
            "pid": pid,
            "workspace": d.workspace,
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
        for pid in &stale_confirmed {
            // Re-probe immediately before signalling — the guard, not a formality.
            if procs::confirm_daemon(*pid) != Some(true) {
                eprintln!("  refuse pid={pid}: cmdline unconfirmable (pid reuse guard)");
                continue;
            }
            let Some(raw) = rustix::process::Pid::from_raw(*pid as i32) else {
                continue;
            };
            match rustix::process::kill_process(raw, rustix::process::Signal::Term) {
                Ok(()) => killed.push(*pid),
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
