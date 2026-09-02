//! `yt-transcript-archive` — archive a YouTube channel or playlist as markdown.
//!
//! Replaces `skills/youtube-transcript-archiver/archiver.py`. Produces one
//! markdown file per episode with title, date, duration, link, show notes,
//! extracted links, and the full auto-generated transcript. `yt-dlp` stays a
//! subprocess — it is the tool being wrapped.

use chrono::{Duration, Local};
use clap::Parser;
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Parser)]
#[command(name = "yt-transcript-archive", about = "YouTube Transcript Archiver")]
struct Args {
    /// Channel URL, @handle, or playlist URL.
    channel: String,
    /// Months of history to archive.
    #[arg(long, default_value_t = 6)]
    months: i64,
    #[arg(long = "output-dir", default_value = "./transcripts")]
    output_dir: PathBuf,
    /// Override start date (YYYYMMDD).
    #[arg(long = "date-start")]
    date_start: Option<String>,
    /// Override end date (YYYYMMDD).
    #[arg(long = "date-end")]
    date_end: Option<String>,
}

/// Lowercases, strips punctuation, and hyphenates — the Python `slugify`.
fn slugify(title: &str, max_len: usize) -> String {
    let lowered = title.to_lowercase();
    let lowered = lowered.trim();
    let drop_punct = Regex::new(r"[^\w\s-]").unwrap();
    let to_hyphen = Regex::new(r"[\s_]+").unwrap();
    let squeeze = Regex::new(r"-+").unwrap();
    let s = drop_punct.replace_all(lowered, "");
    let s = to_hyphen.replace_all(&s, "-");
    let s = squeeze.replace_all(&s, "-");
    s.trim_matches('-').chars().take(max_len).collect()
}

fn yt_dlp(args: &[&str]) -> Option<String> {
    let out = Command::new("yt-dlp").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Video ids and titles for a channel or playlist, newest first.
fn video_list(channel_url: &str) -> Vec<(String, String)> {
    let Some(stdout) = yt_dlp(&[
        "--flat-playlist",
        "--print",
        "%(id)s\t%(title)s",
        channel_url,
    ]) else {
        return Vec::new();
    };
    stdout
        .trim()
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(id, title)| (id.to_string(), title.to_string()))
        .collect()
}

#[derive(PartialEq)]
enum Outcome {
    Ok,
    Skip,
    Old,
    Newer,
    Fail,
}

/// Strips cue numbers, timestamps, headers and inline tags from a subtitle file.
fn parse_subtitles(raw: &str) -> String {
    let cue_number = Regex::new(r"^\d+$").unwrap();
    let timestamp = Regex::new(r"\d{2}:\d{2}:\d{2}").unwrap();
    let tag = Regex::new(r"<[^>]+>").unwrap();
    let mut lines: Vec<String> = Vec::new();
    for line in raw.split('\n') {
        let line = line.trim();
        if line.is_empty() || cue_number.is_match(line) || timestamp.is_match(line) {
            continue;
        }
        if line.starts_with("WEBVTT") || line.starts_with("Kind:") || line.starts_with("Language:")
        {
            continue;
        }
        let cleaned = tag.replace_all(line, "").to_string();
        // Collapse the consecutive duplicates auto-captions emit.
        if !cleaned.is_empty() && lines.last().map(|l| l != &cleaned).unwrap_or(true) {
            lines.push(cleaned);
        }
    }
    lines.join(" ")
}

/// Wraps the transcript into 500-word paragraphs.
fn paragraphs(transcript: &str) -> String {
    let mut md = String::new();
    let mut para: Vec<&str> = Vec::new();
    for (i, w) in transcript.split_whitespace().enumerate() {
        para.push(w);
        if (i + 1) % 500 == 0 {
            md.push_str(&para.join(" "));
            md.push_str("\n\n");
            para.clear();
        }
    }
    if !para.is_empty() {
        md.push_str(&para.join(" "));
        md.push('\n');
    }
    md
}

fn download_single(
    vid_id: &str,
    title: &str,
    out_dir: &Path,
    cutoff_start: &str,
    cutoff_end: &str,
    idx: usize,
    total: usize,
) -> Outcome {
    let md_path = out_dir.join(format!("{}.md", slugify(title, 80)));
    if md_path.metadata().map(|m| m.len() > 500).unwrap_or(false) {
        return Outcome::Skip;
    }

    let url = format!("https://www.youtube.com/watch?v={vid_id}");
    let Some(meta) = yt_dlp(&["--skip-download", "--dump-json", &url]) else {
        println!("[{idx}/{total}] FAIL metadata: {title}");
        return Outcome::Fail;
    };
    let Ok(info) = serde_json::from_str::<Value>(&meta) else {
        println!("[{idx}/{total}] FAIL JSON: {title}");
        return Outcome::Fail;
    };

    let upload_date = info
        .get("upload_date")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    if upload_date != "unknown" {
        if !cutoff_end.is_empty() && upload_date > cutoff_end {
            return Outcome::Newer;
        }
        if !cutoff_start.is_empty() && upload_date < cutoff_start {
            return Outcome::Old;
        }
    }

    let formatted_date = if upload_date.len() == 8 {
        format!(
            "{}-{}-{}",
            &upload_date[..4],
            &upload_date[4..6],
            &upload_date[6..]
        )
    } else {
        upload_date.to_string()
    };
    let duration = info
        .get("duration_string")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let description = info
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");

    println!("[{idx}/{total}] {title} ({formatted_date})");

    let link_re = Regex::new("https?://[^\\s<>\"']+").unwrap();
    let links: Vec<String> = link_re
        .find_iter(description)
        .map(|m| m.as_str().to_string())
        .collect();

    // Fetch the auto-generated English subtitles.
    let sub_dir = out_dir.join(".subs_tmp");
    let _ = std::fs::create_dir_all(&sub_dir);
    let sub_out = sub_dir.join(vid_id);
    let _ = yt_dlp(&[
        "--skip-download",
        "--write-auto-sub",
        "--sub-lang",
        "en",
        "--sub-format",
        "vtt",
        "--convert-subs",
        "srt",
        "-o",
        &sub_out.to_string_lossy(),
        &url,
    ]);

    let mut transcript = String::new();
    for ext in [".en.srt", ".en.vtt"] {
        let sub_file = sub_dir.join(format!("{vid_id}{ext}"));
        if sub_file.exists() {
            if let Ok(raw) = std::fs::read_to_string(&sub_file) {
                transcript = parse_subtitles(&raw);
            }
            let _ = std::fs::remove_file(&sub_file);
            break;
        }
    }

    let mut md = format!("# {title}\n\n");
    md.push_str(&format!("- **Date**: {formatted_date}\n"));
    md.push_str(&format!("- **Duration**: {duration}\n"));
    md.push_str(&format!(
        "- **YouTube**: https://www.youtube.com/watch?v={vid_id}\n\n"
    ));
    md.push_str(&format!("## Show Notes\n\n{description}\n\n## Links\n\n"));

    let redirect_q = Regex::new(r"q=(https?[^&]+)").unwrap();
    for link in &links {
        let mut link = link.clone();
        if link.contains("redirect") && link.contains("q=") {
            if let Some(c) = redirect_q.captures(&link) {
                link = urlencoding::decode(&c[1])
                    .map(|s| s.into_owned())
                    .unwrap_or(link);
            }
        }
        md.push_str(&format!("- {link}\n"));
    }
    if links.is_empty() {
        md.push_str("_No links found in show notes._\n");
    }

    md.push_str("\n## Transcript\n\n");
    if transcript.is_empty() {
        md.push_str("_Transcript not available for this episode._\n");
    } else {
        md.push_str(&paragraphs(&transcript));
    }

    if std::fs::write(&md_path, &md).is_err() {
        return Outcome::Fail;
    }
    println!(
        "  -> {} ({} chars)",
        md_path.file_name().unwrap_or_default().to_string_lossy(),
        transcript.chars().count()
    );
    Outcome::Ok
}

fn main() {
    let a = Args::parse();
    if std::fs::create_dir_all(&a.output_dir).is_err() {
        eprintln!("Cannot create output directory {}", a.output_dir.display());
        std::process::exit(1);
    }

    let now = Local::now();
    let cutoff_start = a.date_start.unwrap_or_else(|| {
        (now - Duration::days(a.months * 30))
            .format("%Y%m%d")
            .to_string()
    });
    let cutoff_end = a
        .date_end
        .unwrap_or_else(|| now.format("%Y%m%d").to_string());

    // Normalise the channel URL, as the Python original did.
    let mut channel_url = a.channel.clone();
    if let Some(handle) = channel_url.strip_prefix('@') {
        channel_url = format!("https://www.youtube.com/@{handle}/videos");
    } else if !channel_url.contains("/videos") && !channel_url.contains("playlist") {
        channel_url = format!("{}/videos", channel_url.trim_end_matches('/'));
    }

    println!("Channel: {channel_url}");
    println!("Date window: {cutoff_start} to {cutoff_end}");
    println!("Output: {}\n", a.output_dir.display());

    // Recover already-archived ids from each file's YouTube link.
    let id_re = Regex::new(r"watch\?v=([A-Za-z0-9_-]+)").unwrap();
    let md_files = || -> Vec<PathBuf> {
        std::fs::read_dir(&a.output_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "md"))
            .collect()
    };
    let mut existing: Vec<String> = Vec::new();
    for f in md_files() {
        let text = std::fs::read_to_string(&f).unwrap_or_default();
        let head: String = text.chars().take(500).collect();
        if let Some(c) = id_re.captures(&head) {
            existing.push(c[1].to_string());
        }
    }
    println!("Already have {} episodes.\n", existing.len());

    println!("Fetching video list...");
    let all_videos = video_list(&channel_url);
    println!("Found {} total videos.\n", all_videos.len());

    let videos: Vec<_> = all_videos
        .into_iter()
        .filter(|(id, _)| !existing.contains(id))
        .collect();

    let mut done = 0usize;
    let mut old_streak = 0usize;
    let total = videos.len();
    for (i, (vid_id, title)) in videos.iter().enumerate() {
        match download_single(
            vid_id,
            title,
            &a.output_dir,
            &cutoff_start,
            &cutoff_end,
            i + 1,
            total,
        ) {
            Outcome::Ok => {
                done += 1;
                old_streak = 0;
            }
            Outcome::Old => {
                old_streak += 1;
                if old_streak >= 15 {
                    println!("15 consecutive old episodes — past target window.");
                    break;
                }
            }
            Outcome::Newer | Outcome::Skip => old_streak = 0,
            Outcome::Fail => {}
        }
    }

    println!(
        "\nDone! Downloaded {done} new episodes. Total: {}",
        md_files().len()
    );
}
