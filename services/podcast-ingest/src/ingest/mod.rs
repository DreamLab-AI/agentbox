//! Port of `ingest.py` — weekly cron: download new podcast episodes,
//! extract evidence-backed assertions via the Ontology Loom, verify, and
//! land them on assertion-ledger pages.

pub mod complete;
pub mod config;
pub mod download;
pub mod extract;
pub mod integrate;
pub mod ledger;
pub mod loom;
pub mod newpage;
pub mod pyval;
pub mod verify;

use crate::common::ingest_status::get_ingest_status;
use crate::common::state::{load_ingest_state, save_ingest_state};
use config::Config;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Naive-local ISO-8601 timestamp with microsecond precision, matching
/// Python's `datetime.now().isoformat()`.
pub fn iso_now() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string()
}

/// Port of `run()`.
pub async fn run(config: &Config, dry_run: bool, target_file: Option<&str>, reprocess: bool) {
    let max_episodes = config.settings.max_episodes_per_run;

    for podcast in &config.podcasts {
        let out_dir = PathBuf::from(&podcast.output_dir);
        let state_path = out_dir.join(".ingest-state.json");
        let mut state = load_ingest_state(&state_path).unwrap_or_default();

        println!("\n{}", "=".repeat(60));
        println!("Processing: {}", podcast.name);
        println!("{}", "=".repeat(60));

        let new_files: Vec<PathBuf> = if let Some(target_file) = target_file {
            let target = out_dir.join(target_file);
            if !target.exists() {
                println!("File not found: {}", target.display());
                continue;
            }
            vec![target]
        } else {
            download::phase_download(podcast, &mut state, max_episodes).await
        };

        let backlog_batch = config.settings.backlog_batch_size;
        let mut unprocessed: Vec<PathBuf> = Vec::new();
        let mut md_files: Vec<PathBuf> = std::fs::read_dir(&out_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                    .collect()
            })
            .unwrap_or_default();
        md_files.sort();

        for f in &md_files {
            let file_name = f
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if let Some(target_file) = target_file {
                if file_name != target_file {
                    continue;
                }
            }
            let content = std::fs::read_to_string(f).unwrap_or_default();
            let status = get_ingest_status(&content);
            let eligible = match &status {
                Some(s) if s == "downloaded" => true,
                Some(s) if reprocess && s.starts_with("processed") => true,
                _ => false,
            };
            if eligible && !new_files.contains(f) {
                unprocessed.push(f.clone());
            }
        }

        if unprocessed.len() > backlog_batch {
            println!(
                "  Backlog: {} files, processing {backlog_batch} this run.",
                unprocessed.len()
            );
            unprocessed.truncate(backlog_batch);
        }

        let mut all_files = new_files.clone();
        all_files.extend(unprocessed.iter().cloned());
        if all_files.is_empty() {
            println!("No files to process.");
            let _ = save_ingest_state(&state_path, &state);
            continue;
        }

        println!(
            "\n{} files to process ({} new, {} backlog).",
            all_files.len(),
            new_files.len(),
            unprocessed.len()
        );

        println!("\n--- Phase 2: Assertion extraction (Loom) ---");
        let assertions_by_file =
            extract::phase_extract(&all_files, &config.settings, &mut state).await;

        if assertions_by_file.is_empty() {
            println!("No assertions extracted.");
            complete::phase_mark_complete(&all_files, &assertions_by_file);
            let _ = save_ingest_state(&state_path, &state);
            continue;
        }

        let total_assertions: usize = assertions_by_file.values().map(|v| v.len()).sum();
        println!(
            "\nTotal assertions: {total_assertions} from {} files.",
            assertions_by_file.len()
        );

        println!("\n--- Phase 3: Verification (Perplexity) ---");
        let verified = verify::phase_verify(&assertions_by_file);
        let total_verified: usize = verified.values().map(|v| v.len()).sum();
        println!("Verified: {total_verified} of {total_assertions}.");

        let ontology_dir = podcast
            .ontology_dir
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);
        let episode_paths: HashMap<String, PathBuf> = all_files
            .iter()
            .map(|f| {
                (
                    f.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    f.clone(),
                )
            })
            .collect();
        println!("\n--- Phase 4: Ontology integration ---");
        integrate::phase_integrate(
            &verified,
            ontology_dir.as_deref(),
            &config.settings,
            &mut state,
            dry_run,
            &episode_paths,
        )
        .await;

        complete::phase_mark_complete(&all_files, &verified);
        let _ = save_ingest_state(&state_path, &state);

        println!("\n[{}] Done.", podcast.name);
    }
}

/// Entry point used by the `podcast-ingest` binary.
pub async fn run_main(
    config_path: &Path,
    dry_run: bool,
    target_file: Option<&str>,
    reprocess: bool,
) -> anyhow::Result<()> {
    let config = config::load_config(config_path)?;
    run(&config, dry_run, target_file, reprocess).await;
    Ok(())
}
