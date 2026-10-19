//! Phase 1: download — port of `download_single` and `run_download` from
//! `bulk_ingest.py`.

use crate::common::episode::{self, EpisodeFetch};
use crate::common::state::{BulkState, VideoRecord};
use crate::common::transcript_md::format_upload_date;
use crate::common::{slugify_default, ytdlp};
use chrono::{Duration, Local};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadOutcome {
    Ok,
    Skip,
    Fail,
    Newer,
    Old,
    /// YouTube returned 429: nothing was written, the caller stops the run.
    RateLimited,
}

/// Port of `download_single`. Returns `(outcome, path)`.
#[allow(clippy::too_many_arguments)]
pub async fn download_single(
    vid_id: &str,
    title: &str,
    out_dir: &Path,
    cutoff_start: &str,
    cutoff_end: &str,
    idx: usize,
    total: usize,
    in_state: bool,
) -> (DownloadOutcome, Option<PathBuf>) {
    let slug = slugify_default(title);
    let md_path = out_dir.join(format!("{slug}.md"));
    if episode::is_complete_episode(&md_path, in_state) {
        return (DownloadOutcome::Skip, Some(md_path));
    }

    let url = format!("https://www.youtube.com/watch?v={vid_id}");
    let info = match ytdlp::fetch_metadata(&url).await {
        Some(i) => i,
        None => {
            println!("[{idx}/{total}] FAIL metadata: {title}");
            return (DownloadOutcome::Fail, None);
        }
    };

    let upload_date = info
        .get("upload_date")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    if upload_date != "unknown" {
        if !cutoff_end.is_empty() && upload_date > cutoff_end {
            return (DownloadOutcome::Newer, None);
        }
        if !cutoff_start.is_empty() && upload_date < cutoff_start {
            return (DownloadOutcome::Old, None);
        }
    }

    let formatted_date = format_upload_date(upload_date);
    let duration = info
        .get("duration_string")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let description = info
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    println!("[{idx}/{total}] {title} ({formatted_date})");

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
        } => {
            println!(
                "  -> {} ({transcript_chars} chars)",
                path.file_name().unwrap().to_string_lossy(),
            );
            (DownloadOutcome::Ok, Some(path))
        }
        EpisodeFetch::RateLimited => (DownloadOutcome::RateLimited, None),
        EpisodeFetch::Failed(reason) => {
            println!("  FAIL {title}: {reason}");
            (DownloadOutcome::Fail, None)
        }
    }
}

pub struct DownloadArgs<'a> {
    pub channel: &'a str,
    pub months: i64,
    pub date_start: Option<&'a str>,
    pub date_end: Option<&'a str>,
    pub max_episodes: Option<usize>,
    pub old_streak: usize,
    /// Seconds to wait between episode downloads; 0 disables the pause.
    pub pause_secs: u64,
}

/// What [`run_download`] did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DownloadSummary {
    /// Newly downloaded episodes.
    pub done: usize,
    /// YouTube returned 429 and the run stopped early.
    pub rate_limited: bool,
}

/// Port of `run_download`. Returns what was downloaded, or the reason the
/// channel listing failed (never a silent zero). A rate-limited fetch stops the
/// run after one marker line.
pub async fn run_download(
    args: &DownloadArgs<'_>,
    out_dir: &Path,
    state: &mut BulkState,
) -> Result<DownloadSummary, crate::common::ytdlp::YtDlpError> {
    let mut channel_url = args.channel.to_string();
    if channel_url.starts_with('@') {
        channel_url = format!("https://www.youtube.com/{channel_url}/videos");
    } else if !channel_url.contains("/videos") && !channel_url.contains("playlist") {
        channel_url = format!("{}/videos", channel_url.trim_end_matches('/'));
    }

    let now = Local::now();
    let cutoff_start = args.date_start.map(|s| s.to_string()).unwrap_or_else(|| {
        (now - Duration::days(args.months * 30))
            .format("%Y%m%d")
            .to_string()
    });
    let cutoff_end = args
        .date_end
        .map(|s| s.to_string())
        .unwrap_or_else(|| now.format("%Y%m%d").to_string());

    println!("Channel: {channel_url}");
    println!("Date window: {cutoff_start} to {cutoff_end}");
    println!("Output: {}\n", out_dir.display());

    let state_ids: std::collections::HashSet<String> = state.keys().cloned().collect();
    let existing_ids = episode::known_video_ids(out_dir, &state_ids, 500);

    println!("Already have {} episodes.", existing_ids.len());
    println!("Fetching video list...");
    let all_videos = ytdlp::get_video_ids(&channel_url).await?;
    println!("Found {} total videos.\n", all_videos.len());

    let videos: Vec<(String, String)> = all_videos
        .into_iter()
        .filter(|(vid, _)| !existing_ids.contains(vid))
        .collect();
    let mut done = 0usize;
    let mut rate_limited = false;
    let mut fetched_any = false;
    let mut old_streak = 0usize;
    let max_eps = args.max_episodes.unwrap_or(videos.len());

    for (i, (vid_id, title)) in videos.iter().enumerate() {
        if done >= max_eps {
            println!("Reached max-episodes cap ({max_eps}).");
            break;
        }
        if fetched_any && args.pause_secs > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(args.pause_secs)).await;
        }
        let (result, md_path) = download_single(
            vid_id,
            title,
            out_dir,
            &cutoff_start,
            &cutoff_end,
            i + 1,
            videos.len(),
            state.contains_key(vid_id),
        )
        .await;
        fetched_any = matches!(result, DownloadOutcome::Ok | DownloadOutcome::Fail);
        match result {
            DownloadOutcome::Ok => {
                done += 1;
                old_streak = 0;
                if let Some(path) = md_path {
                    state.insert(
                        vid_id.clone(),
                        VideoRecord {
                            status: "downloaded".to_string(),
                            file: path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default(),
                            date: crate::bulk::iso_now(),
                        },
                    );
                }
            }
            DownloadOutcome::Old => {
                old_streak += 1;
                if old_streak >= args.old_streak {
                    println!(
                        "{} consecutive old episodes — past target window.",
                        args.old_streak
                    );
                    break;
                }
            }
            DownloadOutcome::Newer | DownloadOutcome::Skip => {
                old_streak = 0;
                if result == DownloadOutcome::Skip && !state.contains_key(vid_id) {
                    state.insert(
                        vid_id.clone(),
                        VideoRecord {
                            status: "downloaded".to_string(),
                            file: format!("{}.md", slugify_default(title)),
                            date: crate::bulk::iso_now(),
                        },
                    );
                }
            }
            DownloadOutcome::Fail => {}
            DownloadOutcome::RateLimited => {
                println!("RATE-LIMITED: {done} downloaded before YouTube returned 429");
                rate_limited = true;
                break;
            }
        }
    }

    let total_files = std::fs::read_dir(out_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    println!("\nDownload done! {done} new episodes. Total: {total_files}");
    Ok(DownloadSummary { done, rate_limited })
}
