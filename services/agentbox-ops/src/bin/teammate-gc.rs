//! `teammate-gc` — list and reap idle Claude Code agent-team teammates
//! (ADR-2034 session hygiene).
//!
//! Read-only by default: prints every teammate with its measured idle time.
//! `--kill` sends SIGTERM to teammates whose CPU counter has not advanced for
//! `--idle-secs` (default 1800), re-verifying `(pid, starttime, argv)`
//! immediately before signalling (ADR-2032 pid-reuse guard). `--loop` runs
//! under supervisord and persists its observations across ticks in
//! `--state` so idleness accrues correctly between passes.

use std::path::PathBuf;
use std::process::ExitCode;

use agentbox_ops::process_identity::{parse_argv, parse_starttime, ProcFs, ProcSource};
use agentbox_ops::teammates as tm;
use clap::Parser;
use serde_json::json;

#[derive(Parser)]
#[command(name = "teammate-gc", about = "List/reap idle Claude Code teammates (pid-reuse guarded)", version)]
struct Args {
    /// SIGTERM teammates idle for at least --idle-secs.
    #[arg(long)]
    kill: bool,
    /// Idle window in seconds (0 disables idleness entirely).
    #[arg(long, default_value_t = 1800)]
    idle_secs: u64,
    /// Keep running, scanning every --interval seconds.
    #[arg(long = "loop")]
    keep_running: bool,
    #[arg(long, default_value_t = 60)]
    interval: u64,
    /// Observation state file.
    #[arg(long, default_value = "/run/agentbox/teammate-gc.json")]
    state: PathBuf,
    /// procfs root (tests point this at a fixture tree).
    #[arg(long, default_value = "/proc")]
    proc_root: PathBuf,
    /// Machine-readable output.
    #[arg(long)]
    json: bool,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Re-reads the process immediately before signalling: same starttime, still
/// a teammate, same agent id. Anything else is refused.
fn still_same(proc_fs: &ProcFs, a: &tm::Assessment) -> bool {
    let Ok(raw) = proc_fs.cmdline(a.pid) else { return false };
    let argv = parse_argv(&raw);
    let args: Vec<&str> = argv.iter().map(String::as_str).collect();
    if tm::teammate_agent_id(&args).as_deref() != Some(a.agent_id.as_str()) {
        return false;
    }
    let Ok(stat) = proc_fs.stat(a.pid) else { return false };
    parse_starttime(&stat).ok() == Some(a.starttime)
}

fn pass(args: &Args) -> ExitCode {
    let proc_fs = ProcFs::new(args.proc_root.clone());
    let seen = tm::scan(&proc_fs, tm::list_pids(&args.proc_root));
    let mut state = tm::load_state(&args.state);
    let now = unix_now();
    let rows = tm::assess(&mut state, &seen, now, args.idle_secs);
    if let Err(e) = tm::save_state(&args.state, &state) {
        eprintln!("[teammate-gc] state {} not written: {e}", args.state.display());
    }

    let mut killed = Vec::new();
    let mut refused = Vec::new();
    if args.kill {
        for a in rows.iter().filter(|a| a.idle) {
            if !still_same(&proc_fs, a) {
                refused.push(a.pid);
                continue;
            }
            let Some(raw) = rustix::process::Pid::from_raw(a.pid as i32) else { continue };
            match rustix::process::kill_process(raw, rustix::process::Signal::Term) {
                Ok(()) => killed.push(a.pid),
                Err(e) => eprintln!("[teammate-gc] pid={} kill failed ({e})", a.pid),
            }
        }
    }

    if args.json {
        println!(
            "{}",
            json!({"ts": now, "idle_secs": args.idle_secs, "teammates": rows, "killed": killed, "refused": refused})
        );
        return ExitCode::SUCCESS;
    }
    if rows.is_empty() {
        if !args.keep_running {
            println!("✓ no Claude Code teammates running");
        }
        return ExitCode::SUCCESS;
    }
    let idle_count = rows.iter().filter(|r| r.idle).count();
    if !args.keep_running || idle_count > 0 || !killed.is_empty() {
        for r in &rows {
            println!(
                "  {} pid={:<8} idle={:<7} seen={:<7} {}",
                if r.idle { "IDLE" } else { "live" },
                r.pid,
                format!("{}s", r.idle_secs),
                format!("{}s", r.observed_secs),
                r.agent_id
            );
        }
        println!(
            "[teammate-gc] {} teammate(s), {} idle ≥{}s{}{}",
            rows.len(),
            idle_count,
            args.idle_secs,
            if args.kill { format!(", {} signalled", killed.len()) } else { String::new() },
            if refused.is_empty() { String::new() } else { format!(", {} refused (identity changed)", refused.len()) }
        );
    }
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let args = Args::parse();
    loop {
        let code = pass(&args);
        if !args.keep_running {
            return code;
        }
        std::thread::sleep(std::time::Duration::from_secs(args.interval.max(10)));
    }
}
