//! `agentbox-hook` — the resident Claude Code hook shim (ADR-2034 §1).
//!
//! Three subcommands, one binary on PATH:
//!
//! * `event <kind>` — the per-tool-call hook. Reads the Claude Code payload on
//!   stdin, appends one line to the workspace spool and exits. Under 10 ms,
//!   no CLI boot. `pre-command` additionally refuses a short list of
//!   catastrophic commands (exit 2, reason on stderr, which Claude Code
//!   surfaces to the model). Every other failure is fail-open: a spool that
//!   cannot be written never blocks a tool call.
//! * `reconcile` — rewrites `.claude/settings.json` files under the workspace
//!   so the ruflo CLI hook commands become `agentbox-hook event …` and the
//!   per-prompt `route` hook is dropped. Boot runs it; it is idempotent.
//! * `drain` — folds the spools into the events volume. Supervised as
//!   `agentbox-hook drain --loop`.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use agentbox_ops::hookspool as hs;
use clap::{Parser, Subcommand};
use serde_json::json;

const DEFAULT_SPOOL: &str = "/run/agentbox/hooks";
const DEFAULT_EVENTS: &str = "/var/lib/agentbox/events/hooks";
const STDIN_CAP: u64 = 1024 * 1024;

#[derive(Parser)]
#[command(name = "agentbox-hook", about = "Resident Claude Code hook shim", version)]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Record one hook event from the Claude Code payload on stdin.
    Event {
        /// pre-command | post-command | pre-edit | post-edit | pre-task | post-task | notification | session-start | session-end
        kind: String,
        /// Override the derived outcome (the ruflo template passed `--success`).
        #[arg(long)]
        success: Option<bool>,
        /// Spool directory (default $AGENTBOX_HOOK_SPOOL or /run/agentbox/hooks).
        #[arg(long)]
        spool: Option<PathBuf>,
    },
    /// Rewrite project-level settings so hooks use this shim.
    Reconcile {
        /// Root to search (default $WORKSPACE or /home/devuser/workspace).
        #[arg(long)]
        root: Option<PathBuf>,
        /// Directory depth below root to search (default 2).
        #[arg(long, default_value_t = 2)]
        depth: usize,
        /// Extra settings files to reconcile explicitly.
        #[arg(long = "path")]
        paths: Vec<PathBuf>,
        /// Report without writing.
        #[arg(long)]
        dry_run: bool,
        /// Machine-readable output.
        #[arg(long)]
        json: bool,
    },
    /// Fold spooled events into the events volume.
    Drain {
        #[arg(long)]
        spool: Option<PathBuf>,
        /// Output directory (default $AGENTBOX_HOOK_EVENTS_DIR or /var/lib/agentbox/events/hooks).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Keep running, draining every --interval seconds.
        #[arg(long = "loop")]
        keep_running: bool,
        #[arg(long, default_value_t = 30)]
        interval: u64,
        #[arg(long)]
        json: bool,
    },
}

fn spool_dir(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(p) = explicit {
        return p;
    }
    if let Ok(p) = std::env::var("AGENTBOX_HOOK_SPOOL") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    PathBuf::from(DEFAULT_SPOOL)
}

/// Fallback spool when the runtime dir is absent or unwritable (a session
/// outside the container, or a boot where /run was not chowned yet).
fn fallback_spool() -> PathBuf {
    if let Ok(x) = std::env::var("XDG_RUNTIME_DIR") {
        if !x.is_empty() {
            return PathBuf::from(x).join("agentbox-hooks");
        }
    }
    let uid = unsafe { libc_getuid() };
    std::env::temp_dir().join(format!("agentbox-hooks-{uid}"))
}

#[cfg(unix)]
unsafe fn libc_getuid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    getuid()
}

#[cfg(not(unix))]
unsafe fn libc_getuid() -> u32 {
    0
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn run_event(kind: &str, success: Option<bool>, spool: Option<PathBuf>) -> ExitCode {
    if !hs::is_kind(kind) {
        eprintln!("agentbox-hook: unknown event kind {kind:?} (expected one of {})", hs::KINDS.join(", "));
        return ExitCode::SUCCESS; // fail-open: never block a tool call over a wiring typo
    }
    let mut raw = String::new();
    let _ = std::io::stdin().take(STDIN_CAP).read_to_string(&mut raw);
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let event = hs::capture(kind, &raw, &cwd, success, &now());

    if kind == "pre-command" {
        if let Some(reason) = hs::check_command_safety(&event.summary) {
            eprintln!("agentbox-hook: blocked — {reason}: {}", event.summary);
            let _ = hs::append_event(&spool_dir(spool.clone()), &hs::HookEvent {
                kind: "pre-command-blocked".into(),
                ..event
            });
            return ExitCode::from(2);
        }
    }

    let primary = spool_dir(spool);
    if hs::append_event(&primary, &event).is_err() {
        let _ = hs::append_event(&fallback_spool(), &event);
    }
    ExitCode::SUCCESS
}

fn run_reconcile(root: Option<PathBuf>, depth: usize, paths: Vec<PathBuf>, dry: bool, as_json: bool) -> ExitCode {
    let root = root.unwrap_or_else(|| {
        PathBuf::from(std::env::var("WORKSPACE").unwrap_or_else(|_| "/home/devuser/workspace".into()))
    });
    let mut files = hs::discover_settings(&root, depth);
    for p in paths {
        if p.is_file() && !files.contains(&p) {
            files.push(p);
        }
    }
    let mut rows = Vec::new();
    let (mut replaced, mut removed, mut changed_files) = (0, 0, 0);
    for f in &files {
        match hs::reconcile_file(f, dry) {
            Ok(r) => {
                if r.changed() {
                    changed_files += 1;
                    replaced += r.replaced;
                    removed += r.removed;
                }
                rows.push(json!({"file": f, "replaced": r.replaced, "removed": r.removed}));
            }
            Err(e) => rows.push(json!({"file": f, "error": e})),
        }
    }
    if as_json {
        println!(
            "{}",
            json!({"dry_run": dry, "root": root, "files": rows, "changed_files": changed_files, "replaced": replaced, "removed": removed})
        );
    } else {
        for r in &rows {
            if let Some(e) = r.get("error") {
                println!("  ! {} — {}", r["file"].as_str().unwrap_or("?"), e.as_str().unwrap_or("?"));
            } else if r["replaced"].as_u64().unwrap_or(0) + r["removed"].as_u64().unwrap_or(0) > 0 {
                println!(
                    "  {} {} (rewrote {}, dropped {})",
                    if dry { "would fix" } else { "fixed" },
                    r["file"].as_str().unwrap_or("?"),
                    r["replaced"],
                    r["removed"]
                );
            }
        }
        println!(
            "[hook-shim] {} settings file(s) under {}: {} changed, {} hook(s) rewritten, {} dropped{}",
            files.len(),
            root.display(),
            changed_files,
            replaced,
            removed,
            if dry { " (dry run)" } else { "" }
        );
    }
    ExitCode::SUCCESS
}

fn run_drain(spool: Option<PathBuf>, out: Option<PathBuf>, keep_running: bool, interval: u64, as_json: bool) -> ExitCode {
    let spool = spool_dir(spool);
    let out = out.unwrap_or_else(|| {
        PathBuf::from(std::env::var("AGENTBOX_HOOK_EVENTS_DIR").unwrap_or_else(|_| DEFAULT_EVENTS.into()))
    });
    let interval = std::time::Duration::from_secs(interval.max(5));
    loop {
        let mut total = hs::DrainReport::default();
        for dir in [spool.clone(), fallback_spool()] {
            match hs::drain_once(&dir, &out) {
                Ok(r) => {
                    total.files += r.files;
                    total.events += r.events;
                    total.malformed += r.malformed;
                }
                Err(e) => {
                    if dir == spool {
                        eprintln!("[hook-drain] {}: {e}", dir.display());
                    }
                }
            }
        }
        if as_json {
            println!("{}", json!({"ts": now(), "spool": spool, "out": out, "files": total.files, "events": total.events, "malformed": total.malformed}));
        } else if total.events > 0 || total.malformed > 0 || !keep_running {
            println!(
                "[hook-drain] {} event(s) from {} spool(s) → {}{}",
                total.events,
                total.files,
                out.display(),
                if total.malformed > 0 { format!(" ({} malformed)", total.malformed) } else { String::new() }
            );
        }
        if !keep_running {
            return ExitCode::SUCCESS;
        }
        std::thread::sleep(interval);
    }
}

fn main() -> ExitCode {
    match Args::parse().cmd {
        Cmd::Event { kind, success, spool } => run_event(&kind, success, spool),
        Cmd::Reconcile { root, depth, paths, dry_run, json } => run_reconcile(root, depth, paths, dry_run, json),
        Cmd::Drain { spool, out, keep_running, interval, json } => run_drain(spool, out, keep_running, interval, json),
    }
}

#[allow(dead_code)]
fn _path_type_check(_: &Path) {}
