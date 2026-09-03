//! `docs-validate-links` — Rust port of `validate_links.py`'s CLI.
//!
//! Same flags, same defaults, same JSON shape, same exit-code convention
//! (exit 1 iff any broken links were found).

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use skill_tools::docs_alignment::cli::emit_json;
use skill_tools::docs_alignment::links::LinkValidator;
use skill_tools::docs_alignment::links_external::validate_external_links;

/// Validate documentation links.
#[derive(Parser, Debug)]
#[command(name = "docs-validate-links", about = "Validate documentation links")]
struct Args {
    /// Project root directory
    #[arg(long, default_value = ".")]
    root: String,

    /// Documentation directory
    #[arg(long = "docs-dir", default_value = "docs")]
    docs_dir: String,

    /// Output JSON file (default: stdout)
    #[arg(long)]
    output: Option<String>,

    /// Validate external URLs
    #[arg(long = "check-external", default_value_t = false)]
    check_external: bool,

    /// Patterns to ignore
    #[arg(long, num_args = 0..)]
    ignore: Vec<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();

    let mut validator = LinkValidator::new(
        &PathBuf::from(&args.root),
        &args.docs_dir,
        args.check_external,
        args.ignore,
    );
    validator.validate_local_pass();

    if validator.check_external() {
        validate_external_links(validator.links_mut()).await;
    }

    let report = validator.finalize();
    let has_broken = !report.broken_links.is_empty();

    if emit_json(&report, args.output.as_deref()).is_err() {
        return ExitCode::FAILURE;
    }

    if has_broken {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
