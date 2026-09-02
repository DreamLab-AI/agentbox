//! `docs-detect-ascii` — Rust port of `detect_ascii.py`'s CLI.
//!
//! Same flags, same defaults, same JSON shape. Python's `main()` never calls
//! `sys.exit()` here, so this binary always exits 0 too, regardless of how
//! many diagrams were detected.

use std::path::PathBuf;

use clap::Parser;

use skill_tools::docs_alignment::ascii_diagrams::AsciiDiagramDetector;
use skill_tools::docs_alignment::cli::emit_json;

/// Detect ASCII diagrams.
#[derive(Parser, Debug)]
#[command(name = "docs-detect-ascii", about = "Detect ASCII diagrams")]
struct Args {
    /// Directory to scan
    #[arg(long, default_value = ".")]
    root: String,

    /// Output JSON file
    #[arg(long)]
    output: Option<String>,

    /// Minimum lines for diagram
    #[arg(long = "min-lines", default_value_t = 3)]
    min_lines: usize,
}

fn main() -> std::io::Result<()> {
    let args = Args::parse();

    let detector = AsciiDiagramDetector::new(&PathBuf::from(&args.root), args.min_lines);
    let report = detector.run();
    let total = report.total_detected;
    let high_confidence = report.high_confidence;

    emit_json(&report, args.output.as_deref())?;

    if args.output.is_some() {
        println!("\nSummary: {total} ASCII diagrams detected");
        println!("High confidence (needs conversion): {high_confidence}");
    }

    Ok(())
}
