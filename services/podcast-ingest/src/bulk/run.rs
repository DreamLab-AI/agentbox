//! Main pipeline — port of `main()`'s `argparse` CLI definition and body
//! from `bulk_ingest.py`.

use super::domain_probe::{generate_ontocast_sample, run_domain_probe};
use super::download::{run_download, DownloadArgs};
use super::enrichment::run_apply_enrichment;
use super::extraction::run_extraction;
use super::mark::run_mark_files;
use crate::common::state::{load_ingest_state, save_ingest_state};
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

    /// Seconds to wait between episode downloads (0 disables the pause)
    #[arg(long, default_value_t = 15)]
    pub pause_secs: u64,

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
pub async fn run(args: &Args) -> anyhow::Result<()> {
    let out_dir = &args.output_dir;
    let _ = std::fs::create_dir_all(out_dir);

    let state_path = out_dir.join(".ingest-state.json");
    // A state file that cannot be read stops the run: reading it as empty
    // would re-download everything and then overwrite the history.
    let mut ingest_state = match load_ingest_state(&state_path) {
        Ok(state) => state,
        Err(e) => anyhow::bail!("cannot read the ingest state: {e}"),
    };

    let download_args = DownloadArgs {
        channel: &args.channel,
        months: args.months,
        date_start: args.date_start.as_deref(),
        date_end: args.date_end.as_deref(),
        max_episodes: args.max_episodes,
        old_streak: args.old_streak,
        pause_secs: args.pause_secs,
    };
    let summary = run_download(&download_args, out_dir, &mut ingest_state.videos).await?;
    if let Err(e) = save_ingest_state(&state_path, &ingest_state) {
        anyhow::bail!("could not save {}: {e}", state_path.display());
    }
    if summary.rate_limited {
        anyhow::bail!(
            "rate-limited by YouTube after {} download(s); retry later",
            summary.done
        );
    }

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
    Ok(())
}

/// Entry point used by the `podcast-bulk-ingest` binary. Returns the process
/// exit code: non-zero when the channel listing failed.
pub async fn run_main() -> i32 {
    let args = Args::parse();
    match run(&args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("ERROR bulk ingest failed: {e}");
            1
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::common::ytdlp::ENV_LOCK;
    use std::os::unix::fs::PermissionsExt;

    /// A fake `yt-dlp` that lists one video, answers metadata with a date of
    /// today, and returns a subtitle file.
    fn install_fake(dir: &std::path::Path) {
        let today = chrono::Local::now().format("%Y%m%d").to_string();
        let script = format!(
            r#"#!/bin/sh
case "$*" in
  *--flat-playlist*) printf 'newvid\tA New Episode\n'; exit 0;;
  *--dump-json*) echo '{{"upload_date":"{today}","duration_string":"5:00","description":"Notes."}}'; exit 0;;
  *--write-auto-sub*)
    out=""; prev=""
    for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
    printf '1\n00:00:00,000 --> 00:00:02,000\nTranscript text here\n' > "$out.en.srt"; exit 0;;
esac
exit 0
"#
        );
        let path = dir.join("fake-yt-dlp");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PODCAST_INGEST_YT_DLP", &path);
    }

    /// The bulk tool used to save a flat map and the ingest a nested one, each
    /// discarding the other's data. Both go through one `IngestState` now.
    #[tokio::test]
    async fn bulk_adds_videos_and_keeps_assertions_and_created_pages() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path());
        let out = dir.path().join("t");
        std::fs::create_dir_all(&out).unwrap();
        let state_path = out.join(".ingest-state.json");
        std::fs::write(
            &state_path,
            r#"{"old1": {"status": "downloaded", "file": "o.md", "date": "d"},
                "assertions": {"fp": {"claim": "c"}},
                "created_pages": [{"page": "P", "slug": "p", "date": "d", "assertions": 1}]}"#,
        )
        .unwrap();
        let args = Args::parse_from([
            "podcast-bulk-ingest",
            "@Test",
            "--output-dir",
            out.to_str().unwrap(),
            "--pause-secs",
            "0",
        ]);
        run(&args).await.unwrap();
        let state = load_ingest_state(&state_path).unwrap();
        assert!(state.videos.contains_key("old1"));
        assert!(
            state.videos.contains_key("newvid"),
            "{:?}",
            state.videos.keys()
        );
        assert_eq!(state.assertions.len(), 1);
        assert_eq!(state.created_pages.len(), 1);
        assert!(out.join(".ingest-state.json.pre-nested.bak").exists());
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn bulk_refuses_an_unreadable_state_and_leaves_it_alone() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("t");
        std::fs::create_dir_all(&out).unwrap();
        let state_path = out.join(".ingest-state.json");
        std::fs::write(&state_path, "[]").unwrap();
        let args = Args::parse_from([
            "podcast-bulk-ingest",
            "@Test",
            "--output-dir",
            out.to_str().unwrap(),
        ]);
        let err = run(&args).await.expect_err("must stop");
        assert!(
            err.to_string().contains("cannot read the ingest state"),
            "{err}"
        );
        assert_eq!(std::fs::read_to_string(&state_path).unwrap(), "[]");
    }
}
