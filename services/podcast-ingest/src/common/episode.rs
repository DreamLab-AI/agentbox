//! Shared by `podcast-ingest` and `podcast-bulk-ingest`: fetching one episode's
//! transcript into a markdown file, and deciding which files already count as
//! downloaded.
//!
//! A file counts only if it holds a real transcript, or the episode is
//! recorded in the state as having none. A show-notes-only stub left by a
//! failed or throttled fetch is not a download, so it is fetched again.

use super::transcript_md::build_episode_markdown;
use super::ytdlp::{self, SubtitleOutcome};
use regex::Regex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The line `build_episode_markdown` writes when there is no transcript.
pub const NO_TRANSCRIPT_MARKER: &str = "_Transcript not available for this episode._";

fn re_watch_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"watch\?v=([A-Za-z0-9_-]+)").unwrap())
}

/// The result of fetching one episode.
#[derive(Debug)]
pub enum EpisodeFetch {
    /// The markdown file was written. `transcript_chars` is 0 for an episode
    /// that genuinely has no captions; the caller records it in the state so
    /// it is not asked for again.
    Written {
        /// The episode markdown file.
        path: PathBuf,
        /// Characters of transcript text in it.
        transcript_chars: usize,
    },
    /// YouTube rate-limited the request. Nothing was written.
    RateLimited,
    /// Any other failure, with the reason. Nothing was written.
    Failed(String),
}

/// The descriptive part of an episode file, from the video metadata.
#[derive(Debug, Clone, Copy)]
pub struct EpisodeMeta<'a> {
    /// Episode title.
    pub title: &'a str,
    /// Upload date, already formatted.
    pub formatted_date: &'a str,
    /// Duration string, e.g. `27:10`.
    pub duration: &'a str,
    /// Show notes.
    pub description: &'a str,
}

/// Fetch the transcript for `vid_id` and write `md_path`. Only a real
/// transcript or a confirmed absence of captions writes a file.
pub async fn fetch_and_write(
    vid_id: &str,
    url: &str,
    out_dir: &Path,
    md_path: &Path,
    meta: EpisodeMeta<'_>,
) -> EpisodeFetch {
    let sub_dir = out_dir.join(".subs_tmp");
    let _ = std::fs::create_dir_all(&sub_dir);
    let transcript_text = match ytdlp::download_subtitles(vid_id, url, &sub_dir).await {
        SubtitleOutcome::RateLimited => return EpisodeFetch::RateLimited,
        SubtitleOutcome::Failed(reason) => return EpisodeFetch::Failed(reason),
        SubtitleOutcome::NoCaptions => String::new(),
        SubtitleOutcome::Fetched => {
            let text = ytdlp::extract_transcript_text(vid_id, &sub_dir);
            if text.is_empty() {
                return EpisodeFetch::Failed("the subtitle file held no text".to_string());
            }
            text
        }
    };
    let md = build_episode_markdown(
        vid_id,
        meta.title,
        meta.formatted_date,
        meta.duration,
        meta.description,
        &transcript_text,
    );
    match std::fs::write(md_path, md) {
        Ok(()) => EpisodeFetch::Written {
            path: md_path.to_path_buf(),
            transcript_chars: transcript_text.chars().count(),
        },
        Err(e) => EpisodeFetch::Failed(format!("could not write {}: {e}", md_path.display())),
    }
}

/// Whether the file at `md_path` is a finished download of `vid_id`.
pub fn is_complete_episode(md_path: &Path, in_state: bool) -> bool {
    match std::fs::read_to_string(md_path) {
        Ok(text) if text.contains(NO_TRANSCRIPT_MARKER) => in_state,
        Ok(text) => text.len() > 500,
        Err(_) => false,
    }
}

/// Video ids that need no download: everything in the state, plus every
/// episode file in `out_dir` that is a finished download. A stub whose id is
/// not in the state is not counted. `head_chars` bounds how much of each file
/// is searched for its `watch?v=` link.
pub fn known_video_ids(
    out_dir: &Path,
    state_ids: &HashSet<String>,
    head_chars: usize,
) -> HashSet<String> {
    let mut known = state_ids.clone();
    let Ok(entries) = std::fs::read_dir(out_dir) else {
        return known;
    };
    for path in entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
    {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let head: String = text.chars().take(head_chars).collect();
        let Some(caps) = re_watch_id().captures(&head) else {
            continue;
        };
        let id = caps[1].to_string();
        if !text.contains(NO_TRANSCRIPT_MARKER) || state_ids.contains(&id) {
            known.insert(id);
        }
    }
    known
}
