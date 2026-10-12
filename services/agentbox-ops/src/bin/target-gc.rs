//! `target-gc` — remove idle Cargo `target/` directories.
//!
//! Read-only unless `--delete` is passed: without it the tool lists what it
//! would remove and the space that would free. A directory is removed only if
//! it is verifiably a Cargo target, no build holds its lock, and nothing in it
//! has changed for `max_age_days` (see `agentbox_ops::target_gc`).
//!
//! Policy comes from `[resources.target_gc]` in the manifest (`AGENTBOX_CONFIG`,
//! default `/etc/agentbox.toml`); flags override it for one run.

use agentbox_ops::target_gc::{sweep, Policy, Report, Verdict};
use clap::Parser;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

#[derive(Parser)]
#[command(
    name = "target-gc",
    about = "List/remove idle Cargo target directories (read-only without --delete)"
)]
struct Args {
    /// Remove idle target directories. Without this the run only reports.
    #[arg(long)]
    delete: bool,
    /// Manifest to read `[resources.target_gc]` from (default `$AGENTBOX_CONFIG`,
    /// then `/etc/agentbox.toml`).
    #[arg(long)]
    manifest: Option<PathBuf>,
    /// Search this directory instead of the manifest roots (repeatable).
    #[arg(long = "root")]
    roots: Vec<PathBuf>,
    /// Never touch this path, in addition to the manifest list (repeatable).
    #[arg(long = "exclude")]
    exclude: Vec<PathBuf>,
    /// Override the idle threshold, in days.
    #[arg(long)]
    max_age_days: Option<u64>,
    /// Keep running, one pass every `interval_secs` from the manifest.
    #[arg(long = "loop")]
    looping: bool,
    /// Machine-readable output.
    #[arg(long)]
    json: bool,
}

fn gib(bytes: u64) -> f64 {
    bytes as f64 / (1u64 << 30) as f64
}

fn policy(args: &Args) -> Policy {
    let manifest = args
        .manifest
        .clone()
        .or_else(|| std::env::var_os("AGENTBOX_CONFIG").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/etc/agentbox.toml"));
    let mut p = std::fs::read_to_string(&manifest)
        .map(|t| Policy::from_manifest(&t))
        .unwrap_or_default();
    if !args.roots.is_empty() {
        p.roots = args.roots.clone();
    }
    p.exclude.extend(args.exclude.iter().cloned());
    if let Some(days) = args.max_age_days {
        p.max_age = Duration::from_secs(days * 86_400);
    }
    p
}

fn print(report: &Report, delete: bool, json: bool) {
    if json {
        match serde_json::to_string(report) {
            Ok(s) => println!("{s}"),
            Err(e) => eprintln!("target-gc: cannot encode report: {e}"),
        }
        return;
    }
    for e in &report.entries {
        let action = match (e.verdict, e.removed, delete) {
            (Verdict::Delete, true, _) => "removed",
            (Verdict::Delete, false, true) => "failed",
            (Verdict::Delete, false, false) => "would-remove",
            (Verdict::KeepRecent, _, _) => "keep-recent",
            (Verdict::KeepBusy, _, _) => "keep-busy",
        };
        println!(
            "target-gc: {action:<12} {:>7.1} GiB idle {:>3}d {}",
            gib(e.bytes),
            e.idle_days,
            e.path.display()
        );
    }
    for err in &report.errors {
        eprintln!("target-gc: error {err}");
    }
    if delete {
        println!("target-gc: reclaimed {:.1} GiB", gib(report.reclaimed_bytes));
    } else {
        println!("target-gc: {:.1} GiB reclaimable (pass --delete to remove)", gib(report.reclaimable_bytes));
    }
}

fn main() -> ExitCode {
    let args = Args::parse();
    loop {
        let policy = policy(&args);
        let report = sweep(&policy, args.delete, SystemTime::now());
        print(&report, args.delete, args.json);
        if !args.looping {
            return if report.errors.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE };
        }
        std::thread::sleep(Duration::from_secs(policy.interval_secs));
    }
}
