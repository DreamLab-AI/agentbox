//! Phase 1: delta detection + download — port of `download_episode` and
//! `phase_download` from `ingest.py`.

use super::config::{Podcast, DEFAULT_MAX_EPISODES};
use crate::common::state::{IngestState, VideoRecord};
use crate::common::transcript_md::{build_episode_markdown, format_upload_date};
use crate::common::{slugify_default, ytdlp};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn re_watch_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"watch\?v=([A-Za-z0-9_-]+)").unwrap())
}

/// Port of `download_episode`. Returns `None` on any failure, matching the
/// Python `-> Path | None` contract.
pub async fn download_episode(vid_id: &str, title: &str, out_dir: &Path) -> Option<PathBuf> {
    let slug = slugify_default(title);
    let md_path = out_dir.join(format!("{slug}.md"));
    if let Ok(meta) = std::fs::metadata(&md_path) {
        if meta.len() > 500 {
            return Some(md_path);
        }
    }

    let url = format!("https://www.youtube.com/watch?v={vid_id}");
    let info = ytdlp::fetch_metadata(&url).await?;

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
    std::fs::write(&md_path, md).ok()?;
    Some(md_path)
}

/// Port of `phase_download`.
pub async fn phase_download(
    podcast: &Podcast,
    state: &mut IngestState,
    max_episodes: usize,
) -> Vec<PathBuf> {
    let out_dir = Path::new(&podcast.output_dir);
    let _ = std::fs::create_dir_all(out_dir);

    let mut channel_url = podcast.channel.clone();
    if channel_url.starts_with('@') {
        channel_url = format!("https://www.youtube.com/{channel_url}/videos");
    } else if !channel_url.contains("/videos") && !channel_url.contains("playlist") {
        channel_url = format!("{}/videos", channel_url.trim_end_matches('/'));
    }

    let mut known_ids: std::collections::HashSet<String> = state.videos.keys().cloned().collect();
    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    let head: String = text.chars().take(600).collect();
                    if let Some(caps) = re_watch_id().captures(&head) {
                        known_ids.insert(caps[1].to_string());
                    }
                }
            }
        }
    }

    println!("[{}] Fetching video list...", podcast.name);
    let all_videos = ytdlp::get_video_ids(&channel_url).await;
    let new_videos: Vec<(String, String)> = all_videos
        .into_iter()
        .filter(|(vid, _)| !known_ids.contains(vid))
        .collect();

    if new_videos.is_empty() {
        println!("[{}] No new episodes.", podcast.name);
        return Vec::new();
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

    let mut downloaded = Vec::new();
    for (i, (vid_id, title)) in batch.into_iter().enumerate() {
        println!("  [{}/{total}] {title}", i + 1);
        if let Some(path) = download_episode(vid_id, title, out_dir).await {
            let file_name = path
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
            downloaded.push(path);
        }
    }

    println!(
        "[{}] Downloaded {} episodes.",
        podcast.name,
        downloaded.len()
    );
    downloaded
}
