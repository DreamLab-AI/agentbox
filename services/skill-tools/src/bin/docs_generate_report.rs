//! `docs-generate-report` — Rust port of `generate_report.py`'s CLI.
//!
//! Same flags, same defaults. Python's `main()` never calls `sys.exit()`
//! here either, so this binary always exits 0.

use clap::Parser;

use skill_tools::docs_alignment::report::ReportGenerator;

/// Generate documentation issues report.
#[derive(Parser, Debug)]
#[command(
    name = "docs-generate-report",
    about = "Generate documentation issues report"
)]
struct Args {
    /// Link validation report JSON
    #[arg(long = "link-report")]
    link_report: Option<String>,

    /// Mermaid validation report JSON
    #[arg(long = "mermaid-report")]
    mermaid_report: Option<String>,

    /// ASCII detection report JSON
    #[arg(long = "ascii-report")]
    ascii_report: Option<String>,

    /// Archive report JSON
    #[arg(long = "archive-report")]
    archive_report: Option<String>,

    /// Stubs scan report JSON
    #[arg(long = "stubs-report")]
    stubs_report: Option<String>,

    /// Project name
    #[arg(long = "project-name", default_value = "Project")]
    project_name: String,

    /// Output markdown file
    #[arg(long, default_value = "DOCUMENTATION_ISSUES.md")]
    output: String,
}

fn main() -> std::io::Result<()> {
    let args = Args::parse();

    let mut generator = ReportGenerator::new(args.project_name);
    generator.load_report("links", args.link_report.as_deref());
    generator.load_report("mermaid", args.mermaid_report.as_deref());
    generator.load_report("ascii", args.ascii_report.as_deref());
    generator.load_report("archive", args.archive_report.as_deref());
    generator.load_report("stubs", args.stubs_report.as_deref());

    let report = generator.generate();
    std::fs::write(&args.output, report)?;
    println!("Report written to {}", args.output);

    Ok(())
}
