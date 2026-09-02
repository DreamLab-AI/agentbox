//! `podcast-ingest` — weekly podcast knowledge ingest cron. Rust port of
//! `ingest.py`; CLI flags mirror the Python `argparse` definition exactly.

use clap::Parser;
use std::path::PathBuf;

/// Podcast Knowledge Ingest
#[derive(Parser, Debug)]
#[command(name = "podcast-ingest", about = "Podcast Knowledge Ingest")]
struct Args {
    #[arg(long, default_value = "podcasts.yaml")]
    config: PathBuf,

    /// Extract and verify but don't write to ontology
    #[arg(long)]
    dry_run: bool,

    /// Process a specific episode file
    #[arg(long)]
    file: Option<String>,

    /// Reprocess already-processed files
    #[arg(long)]
    reprocess: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    podcast_ingest_core::ingest::run_main(
        &args.config,
        args.dry_run,
        args.file.as_deref(),
        args.reprocess,
    )
    .await
}
