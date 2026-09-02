//! Main pipeline — port of `main()`'s `argparse` CLI definition and body
//! from `bulk_ingest.py`.

use super::domain_probe::{generate_ontocast_sample, run_domain_probe};
use super::download::{run_download, DownloadArgs};
use super::enrichment::run_apply_enrichment;
use super::extraction::run_extraction;
use super::mark::run_mark_files;
use crate::common::state::{load_bulk_state, save_bulk_state};
use clap::Parser;
use std::path::PathBuf;

/// Podcast Bulk Ingest
#[derive(Parser, Debug)]
#[command(name = "podcast-bulk-ingest", about = "Podcast Bulk Ingest")]
pub struct Args {
    /// YouTube channel URL, @handle, or playlist URL
    pub channel: String,

    /// Months of history (default: 6)
    #[arg(long, default_value_t = 6)]
    pub months: i64,

    /// Output directory
    #[arg(long, default_value = "./transcripts")]
    pub output_dir: PathBuf,

    /// Override start date (YYYYMMDD)
    #[arg(long)]
    pub date_start: Option<String>,

    /// Override end date (YYYYMMDD)
    #[arg(long)]
    pub date_end: Option<String>,

    /// Run source extraction + enrichment
    #[arg(long)]
    pub enrich: bool,

    /// Download referenced reports (requires agent) — accepted for CLI
    /// parity with `bulk_ingest.py`; unused there too (no asset-download
    /// logic exists in the Python original — the flag is parsed and stored,
    /// never read).
    #[arg(long)]
    pub assets: bool,

    /// Cap number of episodes
    #[arg(long)]
    pub max_episodes: Option<usize>,

    /// Consecutive old episodes before exit
    #[arg(long, default_value_t = 15)]
    pub old_streak: usize,

    /// Ontology pages directory for domain probe
    #[arg(long)]
    pub ontology_dir: Option<PathBuf>,

    /// Probe ontology coverage and suggest OntoCast
    #[arg(long)]
    pub domain_probe: bool,

    /// Generate a sample text file for OntoCast input
    #[arg(long)]
    pub generate_ontocast_sample: bool,
}

/// Port of `main()`'s body.
pub async fn run(args: &Args) {
    let out_dir = &args.output_dir;
    let _ = std::fs::create_dir_all(out_dir);

    let state_path = out_dir.join(".ingest-state.json");
    let mut state = load_bulk_state(&state_path).unwrap_or_default();

    let download_args = DownloadArgs {
        channel: &args.channel,
        months: args.months,
        date_start: args.date_start.as_deref(),
        date_end: args.date_end.as_deref(),
        max_episodes: args.max_episodes,
        old_streak: args.old_streak,
    };
    let _downloaded = run_download(&download_args, out_dir, &mut state).await;
    let _ = save_bulk_state(&state_path, &state);

    if args.enrich {
        run_extraction(out_dir);
        run_apply_enrichment(out_dir);
    }

    run_mark_files(out_dir);

    if args.domain_probe || args.generate_ontocast_sample {
        let probe = run_domain_probe(out_dir, args.ontology_dir.as_deref());
        let coverage = probe
            .get("coverage")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        if args.generate_ontocast_sample && coverage < 0.6 {
            generate_ontocast_sample(out_dir, 5);
        }
    }

    let total = std::fs::read_dir(out_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    println!(
        "\nBulk ingest complete. {total} total episodes in {}",
        out_dir.display()
    );
}

/// Entry point used by the `podcast-bulk-ingest` binary.
pub async fn run_main() {
    let args = Args::parse();
    run(&args).await;
}
