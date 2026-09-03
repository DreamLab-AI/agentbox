//! Aggregate AI-provenance audit over a directory tree.
//!
//! Recursively inspects supported text/image/container files and emits one
//! summary plus a per-file finding list with confidence classifications.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::audit::{aggregate, human_report, scan_file, walk_files, DEFAULT_SKIP_DIRS};
use prose_sanitiser::common::io::max_input_bytes;
use prose_sanitiser::common::{emit_json, run_cli, CliError};
use prose_sanitiser::exit;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(about = "Aggregate AI-provenance audit over a directory tree.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// Directory to audit recursively
    path: PathBuf,
    /// Emit a JSON report
    #[arg(long)]
    json: bool,
    /// Comma-separated extra directory names to skip
    #[arg(long, default_value = "")]
    skip: String,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if !args.path.is_dir() {
        return Err(CliError::new(
            2,
            format!("not a directory: {}", args.path.display()),
        ));
    }

    let mut skip_dirs: Vec<String> = DEFAULT_SKIP_DIRS.iter().map(|s| s.to_string()).collect();
    for name in args.skip.split(',') {
        let name = name.trim();
        if !name.is_empty() && !skip_dirs.iter().any(|existing| existing == name) {
            skip_dirs.push(name.to_string());
        }
    }

    let cap = max_input_bytes();
    let mut files: Vec<Value> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    for path in walk_files(&args.path, &skip_dirs) {
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() > cap => {
                skipped.push(json!({"path": path.display().to_string(), "reason": "too large"}));
            }
            Ok(_) => files.push(scan_file(&path, None)),
            // Keep the audit going on one unreadable file.
            Err(error) => skipped
                .push(json!({"path": path.display().to_string(), "reason": error.to_string()})),
        }
    }

    let summary = aggregate(&files);
    let actionable = summary["actionable_files"].as_u64().unwrap_or(0);

    if args.json {
        emit_json(&json!({
            "root": args.path.display().to_string(),
            "files_scanned": files.len(),
            "files_skipped": skipped,
            "summary": summary,
            "files": files,
        }));
    } else {
        println!(
            "{}",
            human_report(
                &files,
                &summary,
                &[
                    ("Root".into(), args.path.display().to_string()),
                    ("Files skipped".into(), skipped.len().to_string()),
                ],
            )
        );
    }

    Ok(exit::from_flag(actionable > 0))
}
