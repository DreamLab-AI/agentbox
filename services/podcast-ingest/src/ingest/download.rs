//! Phase 1: delta detection + download — port of `download_episode` and
//! `phase_download` from `ingest.py`.

use super::config::{Podcast, DEFAULT_MAX_EPISODES};
use crate::common::episode::{self, EpisodeFetch};
use crate::common::state::{IngestState, VideoRecord};
use crate::common::transcript_md::format_upload_date;
use crate::common::{slugify_default, ytdlp};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Why one episode could not be downloaded.
#[derive(Debug, PartialEq, Eq)]
pub enum EpisodeError {
    /// YouTube returned 429. Stop the batch; do not hammer.
    RateLimited,
    /// Anything else, with the reason.
    Failed(String),
}

/// A downloaded episode: its file, and whether it has a transcript at all.
#[derive(Debug)]
pub struct Episode {
    /// The markdown file.
    pub path: PathBuf,
    /// False for an episode that genuinely has no captions.
    pub has_transcript: bool,
}

/// Port of `download_episode`. A throttled or failed fetch writes nothing and
/// returns an error, so the episode is tried again on the next run; the Python
/// original returned a show-notes stub and recorded it as done.
pub async fn download_episode(
    vid_id: &str,
    title: &str,
    out_dir: &Path,
    in_state: bool,
) -> Result<Episode, EpisodeError> {
    let slug = slugify_default(title);
    let md_path = out_dir.join(format!("{slug}.md"));
    if episode::is_complete_episode(&md_path, in_state) {
        let has_transcript = !std::fs::read_to_string(&md_path)
            .map(|t| t.contains(episode::NO_TRANSCRIPT_MARKER))
            .unwrap_or(false);
        return Ok(Episode {
            path: md_path,
            has_transcript,
        });
    }

    let url = format!("https://www.youtube.com/watch?v={vid_id}");
    let info = ytdlp::fetch_metadata(&url)
        .await
        .ok_or_else(|| EpisodeError::Failed("metadata fetch failed".to_string()))?;

    let upload_date = info
        .get("upload_date")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let formatted_date = format_upload_date(upload_date);
    let duration = info
        .get("duration_string")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let description = info
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let meta = episode::EpisodeMeta {
        title,
        formatted_date: &formatted_date,
        duration,
        description,
    };
    match episode::fetch_and_write(vid_id, &url, out_dir, &md_path, meta).await {
        EpisodeFetch::Written {
            path,
            transcript_chars,
        } => Ok(Episode {
            path,
            has_transcript: transcript_chars > 0,
        }),
        EpisodeFetch::RateLimited => Err(EpisodeError::RateLimited),
        EpisodeFetch::Failed(reason) => Err(EpisodeError::Failed(reason)),
    }
}

/// What one run of [`phase_download`] produced.
#[derive(Debug, Default)]
pub struct DownloadBatch {
    /// Episode files downloaded this run, ready for extraction.
    pub files: Vec<PathBuf>,
    /// YouTube returned 429 and the batch stopped early.
    pub rate_limited: bool,
    /// Titles that failed for another reason, with the reason.
    pub failed: Vec<String>,
}

/// Port of `phase_download`.
///
/// A failed channel listing is an error. The Python original and the first
/// port both treated it as an empty list and printed "No new episodes", so a
/// wrong handle read as a quiet week for seven runs. A rate-limited subtitle
/// fetch stops the batch (one marker line, then the files already fetched go
/// on to extraction) and `pause_secs` spaces the downloads out.
pub async fn phase_download(
    podcast: &Podcast,
    state: &mut IngestState,
    max_episodes: usize,
    pause_secs: u64,
) -> Result<DownloadBatch, ytdlp::YtDlpError> {
    let out_dir = Path::new(&podcast.output_dir);
    let _ = std::fs::create_dir_all(out_dir);

    let mut channel_url = podcast.channel.clone();
    if channel_url.starts_with('@') {
        channel_url = format!("https://www.youtube.com/{channel_url}/videos");
    } else if !channel_url.contains("/videos") && !channel_url.contains("playlist") {
        channel_url = format!("{}/videos", channel_url.trim_end_matches('/'));
    }

    let state_ids: std::collections::HashSet<String> = state.videos.keys().cloned().collect();
    let known_ids = episode::known_video_ids(out_dir, &state_ids, 600);

    println!("[{}] Fetching video list...", podcast.name);
    let all_videos = ytdlp::get_video_ids(&channel_url).await?;
    let new_videos: Vec<(String, String)> = all_videos
        .into_iter()
        .filter(|(vid, _)| !known_ids.contains(vid))
        .collect();

    if new_videos.is_empty() {
        println!("[{}] No new episodes.", podcast.name);
        return Ok(DownloadBatch::default());
    }

    println!(
        "[{}] {} new episodes to download.",
        podcast.name,
        new_videos.len()
    );
    let max_episodes = if max_episodes == 0 {
        DEFAULT_MAX_EPISODES
    } else {
        max_episodes
    };
    let batch: Vec<&(String, String)> = new_videos.iter().take(max_episodes).collect();
    let total = new_videos.len().min(max_episodes);

    let mut out = DownloadBatch::default();
    for (i, (vid_id, title)) in batch.into_iter().enumerate() {
        if i > 0 && pause_secs > 0 {
            tokio::time::sleep(Duration::from_secs(pause_secs)).await;
        }
        println!("  [{}/{total}] {title}", i + 1);
        let in_state = state.videos.contains_key(vid_id);
        match download_episode(vid_id, title, out_dir, in_state).await {
            Ok(episode) => {
                let file_name = episode
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                state.videos.insert(
                    vid_id.clone(),
                    VideoRecord {
                        status: "downloaded".to_string(),
                        file: file_name,
                        date: super::iso_now(),
                    },
                );
                if !episode.has_transcript {
                    println!("    no captions on YouTube for this episode");
                }
                out.files.push(episode.path);
            }
            Err(EpisodeError::RateLimited) => {
                println!(
                    "RATE-LIMITED: {} downloaded before YouTube returned 429",
                    out.files.len()
                );
                out.rate_limited = true;
                break;
            }
            Err(EpisodeError::Failed(reason)) => {
                eprintln!("    FAILED: {title}: {reason}");
                out.failed.push(format!("{title}: {reason}"));
            }
        }
    }
    Ok(out)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::common::ytdlp::ENV_LOCK;
    use std::os::unix::fs::PermissionsExt;

    /// What the fake `yt-dlp` does when asked for subtitles.
    #[derive(Clone, Copy)]
    enum Subs {
        RateLimited,
        Ok,
        NoCaptions,
        Fail,
        /// The first subtitle request succeeds, every later one gets a 429.
        OkThenRateLimited,
    }

    /// An executable stand-in for `yt-dlp`: it lists two videos, answers
    /// metadata, and answers the subtitle request according to `subs`.
    fn install_fake(dir: &Path, subs: Subs) {
        let subs_body = match subs {
            Subs::RateLimited => {
                "echo \"ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\" >&2; exit 1"
            }
            Subs::Ok => {
                "printf '1\\n00:00:00,000 --> 00:00:02,000\\nHello world from the episode\\n' > \"$out.en.srt\"; exit 0"
            }
            Subs::NoCaptions => "echo '[info] There are no subtitles for the requested languages'; exit 0",
            Subs::Fail => "echo 'ERROR: something else broke' >&2; exit 1",
            Subs::OkThenRateLimited => {
                "if [ -f \"$0.seen\" ]; then echo 'HTTP Error 429: Too Many Requests' >&2; exit 1; fi; touch \"$0.seen\"; printf '1\\n00:00:00,000 --> 00:00:02,000\\nFirst one is fine\\n' > \"$out.en.srt\"; exit 0"
            }
        };
        let script = format!(
            r#"#!/bin/sh
case "$*" in
  *--flat-playlist*) printf 'vid1\tFirst Episode\nvid2\tSecond Episode\n'; exit 0;;
  *--dump-json*) echo '{{"upload_date":"20261010","duration_string":"10:00","description":"A show note."}}'; exit 0;;
  *--write-auto-sub*)
    out=""; prev=""
    for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
    {subs_body};;
esac
exit 0
"#
        );
        let path = dir.join("fake-yt-dlp");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PODCAST_INGEST_YT_DLP", &path);
    }

    fn podcast(out_dir: &Path) -> Podcast {
        Podcast {
            channel: "@Test".to_string(),
            name: "Test Cast".to_string(),
            focus: None,
            output_dir: out_dir.to_string_lossy().to_string(),
            ontology_dir: None,
            pages_dir: None,
            working_dir: None,
        }
    }

    fn md_files(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.ends_with(".md"))
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }

    /// 2026-10-19: YouTube answered subtitle requests with 429, and the ingest
    /// wrote a show-notes-only stub and recorded the episode as downloaded, so
    /// it would never be retried.
    #[tokio::test]
    async fn a_rate_limited_subtitle_fetch_writes_no_stub_and_no_state() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::RateLimited);
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        assert!(md_files(&out).is_empty(), "{:?}", md_files(&out));
        assert!(state.videos.is_empty(), "{:?}", state.videos.keys());
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn another_subtitle_failure_also_writes_nothing() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::Fail);
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        assert!(md_files(&out).is_empty());
        assert!(state.videos.is_empty());
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn the_episodes_download_once_the_fake_stops_returning_429() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        install_fake(dir.path(), Subs::RateLimited);
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        install_fake(dir.path(), Subs::Ok);
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        assert_eq!(md_files(&out).len(), 2, "{:?}", md_files(&out));
        assert_eq!(state.videos.len(), 2);
        let text = std::fs::read_to_string(out.join("first-episode.md")).unwrap();
        assert!(text.contains("Hello world from the episode"), "{text}");
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn a_stub_without_a_state_record_is_fetched_again() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::Ok);
        let out = dir.path().join("t");
        std::fs::create_dir_all(&out).unwrap();
        let stub = format!(
            "ingest-status:: skipped\n# First Episode\n\n- **YouTube**: https://www.youtube.com/watch?v=vid1\n\n## Show Notes\n\n{}\n\n## Transcript\n\n_Transcript not available for this episode._\n",
            "A show note. ".repeat(60)
        );
        std::fs::write(out.join("first-episode.md"), stub).unwrap();
        let mut state = IngestState::default();
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        let text = std::fs::read_to_string(out.join("first-episode.md")).unwrap();
        assert!(text.contains("Hello world from the episode"), "{text}");
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn an_episode_with_no_captions_is_recorded_and_not_retried() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::NoCaptions);
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        let _ = phase_download(&podcast(&out), &mut state, 15, 0).await;
        assert_eq!(state.videos.len(), 2);
        let again = phase_download(&podcast(&out), &mut state, 15, 0)
            .await
            .unwrap();
        assert!(again.files.is_empty(), "{again:?}");
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn a_429_stops_the_batch_keeps_what_was_fetched_and_flags_it() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::OkThenRateLimited);
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        let batch = phase_download(&podcast(&out), &mut state, 15, 0)
            .await
            .unwrap();
        assert!(batch.rate_limited);
        assert_eq!(batch.files.len(), 1, "{batch:?}");
        assert!(batch.failed.is_empty(), "{batch:?}");
        assert_eq!(state.videos.len(), 1);
        assert_eq!(md_files(&out), vec!["first-episode.md".to_string()]);
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn a_rate_limited_run_exits_non_zero_without_losing_the_state() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::RateLimited);
        let out = dir.path().join("t");
        std::fs::create_dir_all(&out).unwrap();
        let legacy = r#"{"old1": {"status": "downloaded", "file": "o.md", "date": "d"}, "assertions": {"fp": {"claim": "c"}}}"#;
        std::fs::write(out.join(".ingest-state.json"), legacy).unwrap();
        let config = crate::ingest::config::Config {
            podcasts: vec![podcast(&out)],
            settings: crate::ingest::config::Settings {
                download_pause_secs: 0,
                ..Default::default()
            },
        };
        let failures = crate::ingest::run(&config, false, None, false).await;
        assert_eq!(failures.len(), 1, "{failures:?}");
        assert!(failures[0].contains("rate-limited"), "{failures:?}");
        let saved =
            crate::common::state::load_ingest_state(&out.join(".ingest-state.json")).unwrap();
        assert_eq!(saved.videos.len(), 1, "history kept");
        assert_eq!(saved.assertions.len(), 1);
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }

    #[tokio::test]
    async fn the_pause_separates_downloads_and_is_not_taken_before_the_first() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempfile::tempdir().unwrap();
        install_fake(dir.path(), Subs::Ok);
        let out = dir.path().join("t");
        let mut state = IngestState::default();
        let t0 = std::time::Instant::now();
        let batch = phase_download(&podcast(&out), &mut state, 15, 1)
            .await
            .unwrap();
        let took = t0.elapsed();
        assert_eq!(batch.files.len(), 2);
        assert!(
            took >= Duration::from_millis(950),
            "one pause expected: {took:?}"
        );
        assert!(
            took < Duration::from_millis(1900),
            "only one pause: {took:?}"
        );
        std::env::remove_var("PODCAST_INGEST_YT_DLP");
    }
}
