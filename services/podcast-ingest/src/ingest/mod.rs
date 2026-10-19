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
///
/// Returns one message per podcast whose episode list could not be fetched.
/// Those podcasts are skipped, the rest still run, and the caller turns a
/// non-empty list into a non-zero exit so the cron cannot mistake a failed
/// listing for a quiet week.
pub async fn run(
    config: &Config,
    dry_run: bool,
    target_file: Option<&str>,
    reprocess: bool,
) -> Vec<String> {
    let mut failures: Vec<String> = Vec::new();
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
            match download::phase_download(podcast, &mut state, max_episodes).await {
                Ok(files) => files,
                Err(e) => {
                    let message = format!("{}: episode listing failed: {e}", podcast.name);
                    eprintln!("ERROR {message}");
                    failures.push(message);
                    continue;
                }
            }
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

        let pages_dir = podcast
            .pages_dir
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);
        let working_dir = podcast
            .working_dir
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
            pages_dir.as_deref(),
            working_dir.as_deref(),
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
    failures
}

/// Entry point used by the `podcast-ingest` binary.
pub async fn run_main(
    config_path: &Path,
    dry_run: bool,
    target_file: Option<&str>,
    reprocess: bool,
) -> anyhow::Result<()> {
    let config = config::load_config(config_path)?;
    let failures = run(&config, dry_run, target_file, reprocess).await;
    if failures.is_empty() {
        Ok(())
    } else {
        anyhow::bail!(
            "{} podcast(s) could not be listed: {}",
            failures.len(),
            failures.join("; ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::state::IngestState;
    use config::{Podcast, Settings};

    /// A fetch that fails must be reported as a failure, not as "No new
    /// episodes". The weekly cron ran seven times on a dead channel handle and
    /// logged a quiet week each time.
    ///
    /// One test owns `PODCAST_INGEST_YT_DLP`, because the variable is process
    /// global and a second test setting it would race this one.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_failed_listing_is_a_failure_not_a_quiet_week() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake-yt-dlp");
        std::fs::write(
            &fake,
            "#!/bin/sh\necho 'ERROR: [youtube:tab] @Nope: This channel does not have a videos tab' >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PODCAST_INGEST_YT_DLP", &fake);

        let out_dir = dir.path().join("transcripts");
        let podcast = Podcast {
            channel: "@Nope".to_string(),
            name: "Dead Channel".to_string(),
            focus: None,
            output_dir: out_dir.to_string_lossy().to_string(),
            ontology_dir: None,
            pages_dir: None,
            working_dir: None,
        };

        // The phase itself returns the error...
        let mut state = IngestState::default();
        let err = download::phase_download(&podcast, &mut state, 15)
            .await
            .expect_err("a failed listing must not return an empty episode list");
        assert!(err.to_string().contains("videos tab"), "{err}");

        // ...and the run reports it, so run_main can exit non-zero.
        let config = Config {
            podcasts: vec![podcast],
            settings: Settings::default(),
        };
        let failures = run(&config, false, None, false).await;
        assert_eq!(failures.len(), 1, "{failures:?}");
        assert!(failures[0].contains("Dead Channel"), "{failures:?}");
        assert!(failures[0].contains("listing failed"), "{failures:?}");

        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }
}
