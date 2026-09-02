//! `docs-alignment` — Rust port of `docs_alignment.py`'s orchestrator CLI.
//!
//! Same `--project-root` / `--output-dir` flags and defaults as Python, plus
//! an additional `--scripts-dir` override (undocumented in the Python
//! original, since it had no equivalent need — see
//! [`skill_tools::docs_alignment::orchestrator`] for why this port needs
//! one) for locating the two scripts that remain Python
//! (`archive_working_docs.py`, `scan_stubs.py`).
//!
//! Exit code is 1 iff any step returned `false`, exactly as
//! `docs_alignment.py::main()`'s `if not all(results.values()): sys.exit(1)`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use skill_tools::docs_alignment::orchestrator::DocumentationAligner;

/// Documentation Alignment - Full Scan.
#[derive(Parser, Debug)]
#[command(name = "docs-alignment", about = "Documentation Alignment - Full Scan")]
struct Args {
    /// Project root directory (default: current directory)
    #[arg(long = "project-root", default_value = ".")]
    project_root: String,

    /// Directory for intermediate reports (default: .doc-alignment-reports)
    #[arg(long = "output-dir")]
    output_dir: Option<String>,

    /// Directory containing the still-Python archive_working_docs.py /
    /// scan_stubs.py scripts (default: searched upward from the current
    /// directory for skills/docs-alignment/scripts/)
    #[arg(long = "scripts-dir")]
    scripts_dir: Option<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();

    let mut aligner = DocumentationAligner::new(
        &PathBuf::from(&args.project_root),
        args.output_dir.map(PathBuf::from),
        args.scripts_dir.map(PathBuf::from),
    );

    let results = aligner.run_all().await;

    if results.iter().all(|(_, ok)| *ok) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
