//! `docs-check-mermaid` — Rust port of `check_mermaid.py`'s CLI.
//!
//! Same flags, same defaults, same JSON shape, same exit-code convention
//! (exit 1 iff any invalid diagrams were found). Async (`tokio`) because the
//! `mmdc` availability probe and full-syntax validation both shell out with
//! the same timeouts the Python used (`subprocess.run(..., timeout=5|10)`).

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use skill_tools::docs_alignment::cli::emit_json;
use skill_tools::docs_alignment::mermaid::MermaidValidator;

/// Validate mermaid diagrams.
#[derive(Parser, Debug)]
#[command(name = "docs-check-mermaid", about = "Validate mermaid diagrams")]
struct Args {
    /// Directory to scan
    #[arg(long, default_value = ".")]
    root: String,

    /// Output JSON file
    #[arg(long)]
    output: Option<String>,

    /// Treat warnings as errors
    #[arg(long, default_value_t = false)]
    strict: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();

    let validator = MermaidValidator::new(&PathBuf::from(&args.root), args.strict).await;
    let report = validator.run().await;
    let invalid = report.invalid_diagrams;
    let total = report.total_diagrams;
    let valid = report.valid_diagrams;

    if emit_json(&report, args.output.as_deref()).is_err() {
        return ExitCode::FAILURE;
    }

    if args.output.is_some() {
        println!("\nSummary: {valid}/{total} valid diagrams");
    }

    if invalid > 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
