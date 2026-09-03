//! Phase 1: download — port of `download_single` and `run_download` from
//! `bulk_ingest.py`.

use crate::common::state::{BulkState, VideoRecord};
use crate::common::transcript_md::{build_episode_markdown, format_upload_date};
use crate::common::{slugify_default, ytdlp};
use chrono::{Duration, Local};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn re_watch_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"watch\?v=([A-Za-z0-9_-]+)").unwrap())
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadOutcome {
    Ok,
    Skip,
    Fail,
    Newer,
    Old,
}

/// Port of `download_single`. Returns `(outcome, path)`.
pub async fn download_single(
    vid_id: &str,
    title: &str,
    out_dir: &Path,
    cutoff_start: &str,
    cutoff_end: &str,
    idx: usize,
    total: usize,
) -> (DownloadOutcome, Option<PathBuf>) {
    let slug = slugify_default(title);
    let md_path = out_dir.join(format!("{slug}.md"));
    if let Ok(meta) = std::fs::metadata(&md_path) {
        if meta.len() > 500 {
            return (DownloadOutcome::Skip, Some(md_path));
        }
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

    let sub_dir = out_dir.join(".subs_tmp");
    let _ = std::fs::create_dir_all(&sub_dir);
    ytdlp::download_subtitles(vid_id, &url, &sub_dir).await;
    let transcript_text = ytdlp::extract_transcript_text(vid_id, &sub_dir);

    let md = build_episode_markdown(
        vid_id,
        title,
        &formatted_date,
        duration,
        description,
        &transcript_text,
    );
    if std::fs::write(&md_path, md).is_err() {
        return (DownloadOutcome::Fail, None);
    }
    println!(
        "  -> {} ({} chars)",
        md_path.file_name().unwrap().to_string_lossy(),
        transcript_text.chars().count()
    );
    (DownloadOutcome::Ok, Some(md_path))
}

pub struct DownloadArgs<'a> {
    pub channel: &'a str,
    pub months: i64,
    pub date_start: Option<&'a str>,
    pub date_end: Option<&'a str>,
    pub max_episodes: Option<usize>,
    pub old_streak: usize,
}

/// Port of `run_download`. Returns the number of newly downloaded episodes.
pub async fn run_download(args: &DownloadArgs<'_>, out_dir: &Path, state: &mut BulkState) -> usize {
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

    let mut existing_ids: std::collections::HashSet<String> = state.keys().cloned().collect();
    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    let head: String = text.chars().take(500).collect();
                    if let Some(caps) = re_watch_id().captures(&head) {
                        existing_ids.insert(caps[1].to_string());
                    }
                }
            }
        }
    }

    println!("Already have {} episodes.", existing_ids.len());
    println!("Fetching video list...");
    let all_videos = ytdlp::get_video_ids(&channel_url).await;
    println!("Found {} total videos.\n", all_videos.len());

    let videos: Vec<(String, String)> = all_videos
        .into_iter()
        .filter(|(vid, _)| !existing_ids.contains(vid))
        .collect();
    let mut done = 0usize;
    let mut old_streak = 0usize;
    let max_eps = args.max_episodes.unwrap_or(videos.len());

    for (i, (vid_id, title)) in videos.iter().enumerate() {
        if done >= max_eps {
            println!("Reached max-episodes cap ({max_eps}).");
            break;
        }
        let (result, md_path) = download_single(
            vid_id,
            title,
            out_dir,
            &cutoff_start,
            &cutoff_end,
            i + 1,
            videos.len(),
        )
        .await;
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
    done
}
