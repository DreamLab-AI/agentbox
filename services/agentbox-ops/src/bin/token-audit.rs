//! `token-audit` — comprehensive audit of local Claude Code usage.
//!
//! Replaces `skills/token-audit/scripts/token-audit.py`. Same flags, same
//! sections, same `--json` shape.

use agentbox_ops::token_audit::{collect, report};
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "token-audit",
    about = "Audit local Claude Code usage across sessions"
)]
struct Args {
    /// Lookback window in days.
    #[arg(long, default_value_t = 7)]
    days: i64,
    /// Top-N rows per section.
    #[arg(long, default_value_t = 15)]
    top: usize,
    /// Machine-readable JSON output.
    #[arg(long)]
    json: bool,
    /// Skip the running-daemon cross-reference.
    #[arg(long = "no-daemons")]
    no_daemons: bool,
    /// Transcript root.
    #[arg(long = "projects-root")]
    projects_root: Option<PathBuf>,
}

fn main() {
    let a = Args::parse();
    let root = a.projects_root.unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
        PathBuf::from(home).join(".claude").join("projects")
    });

    if !root.is_dir() {
        eprintln!("error: no transcript dir at {}", root.display());
        std::process::exit(2);
    }
    if a.days < 1 {
        eprintln!("error: --days must be >= 1");
        std::process::exit(2);
    }

    let audit = collect(&root, a.days);
    let show_daemons = !a.no_daemons;
    if a.json {
        println!("{}", report::json_report(&audit, a.top, show_daemons));
    } else {
        println!("{}", report::human(&audit, a.top, show_daemons));
    }
}
