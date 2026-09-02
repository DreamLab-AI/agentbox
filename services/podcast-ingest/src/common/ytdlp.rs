//! `yt-dlp` subprocess wrapper — shared by `ingest::download` and
//! `bulk::download`.
//!
//! The Python originals invoked `sys.executable -m yt_dlp ...` (there is no
//! Python interpreter to mirror that indirection through here); this shells
//! out to the `yt-dlp` console-script binary directly with the same flags —
//! the standard entry point yt-dlp itself installs, byte-identical CLI
//! behaviour. Per the porting brief, yt-dlp itself is never reimplemented.

use regex::Regex;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::process::Command;

fn re_digits_only() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d+$").unwrap())
}

fn re_timestamp() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\d{2}:\d{2}:\d{2}").unwrap())
}

fn re_html_tag() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

/// Run `yt-dlp` with `args`, capturing stdout as text, bounded by `timeout`.
/// Mirrors `subprocess.run(cmd, capture_output=True, text=True, timeout=N)`:
/// a timeout or spawn failure yields empty output rather than propagating —
/// callers already treat "nothing parsed" as the failure signal, matching
/// the Python call sites (which never catch `TimeoutExpired` explicitly and
/// would otherwise crash the whole run; the pragmatic port degrades to "no
/// videos found this call" instead of aborting the process).
async fn run_yt_dlp(args: &[&str], timeout: Duration) -> (String, bool) {
    let child = Command::new("yt-dlp")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(_) => return (String::new(), false),
    };

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => (
            String::from_utf8_lossy(&output.stdout).to_string(),
            output.status.success(),
        ),
        _ => (String::new(), false),
    }
}

/// Python:
/// ```python
/// def get_video_ids(channel_url: str) -> list[tuple[str, str]]:
///     cmd = [sys.executable, "-m", "yt_dlp", "--flat-playlist",
///            "--print", "%(id)s\t%(title)s", channel_url]
///     result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
///     ...
/// ```
pub async fn get_video_ids(channel_url: &str) -> Vec<(String, String)> {
    let (stdout, _ok) = run_yt_dlp(
        &[
            "--flat-playlist",
            "--print",
            "%(id)s\t%(title)s",
            channel_url,
        ],
        Duration::from_secs(300),
    )
    .await;

    let mut videos = Vec::new();
    for line in stdout.trim().split('\n') {
        if let Some((vid_id, title)) = line.split_once('\t') {
            videos.push((vid_id.to_string(), title.to_string()));
        }
    }
    videos
}

/// Fetch full episode metadata (`--dump-json`) for one video URL. Returns
/// `None` on a non-zero exit or malformed JSON, mirroring the Python
/// `if meta_result.returncode != 0: return None` / `except
/// json.JSONDecodeError: return None` guards.
pub async fn fetch_metadata(url: &str) -> Option<serde_json::Value> {
    let (stdout, ok) = run_yt_dlp(
        &["--skip-download", "--dump-json", url],
        Duration::from_secs(90),
    )
    .await;
    if !ok {
        return None;
    }
    serde_json::from_str(&stdout).ok()
}

/// Best-effort auto-generated-subtitle download into `sub_dir/<vid_id>.*`.
/// Failures are swallowed, matching the Python call sites which never check
/// the subtitle-download subprocess's return code.
pub async fn download_subtitles(vid_id: &str, url: &str, sub_dir: &Path) {
    let out_template = sub_dir.join(vid_id);
    let out_template = out_template.to_string_lossy().to_string();
    let _ = run_yt_dlp(
        &[
            "--skip-download",
            "--write-auto-sub",
            "--sub-lang",
            "en",
            "--sub-format",
            "vtt",
            "--convert-subs",
            "srt",
            "-o",
            &out_template,
            url,
        ],
        Duration::from_secs(120),
    )
    .await;
}

/// Parse whichever of `<vid_id>.en.srt` / `<vid_id>.en.vtt` exists in
/// `sub_dir` into flattened transcript text, deleting the subtitle file
/// afterwards. Ported line-for-line from the identical loops in `ingest.py`
/// and `bulk_ingest.py`.
pub fn extract_transcript_text(vid_id: &str, sub_dir: &Path) -> String {
    for ext in [".en.srt", ".en.vtt"] {
        let sub_file: PathBuf = sub_dir.join(format!("{vid_id}{ext}"));
        if sub_file.exists() {
            let raw = std::fs::read_to_string(&sub_file).unwrap_or_default();
            let mut lines: Vec<String> = Vec::new();
            for raw_line in raw.split('\n') {
                let line = raw_line.trim();
                if line.is_empty()
                    || re_digits_only().is_match(line)
                    || re_timestamp().is_match(line)
                {
                    continue;
                }
                if line.starts_with("WEBVTT")
                    || line.starts_with("Kind:")
                    || line.starts_with("Language:")
                {
                    continue;
                }
                let cleaned = re_html_tag().replace_all(line, "").to_string();
                if !cleaned.is_empty() && lines.last().map(|l| l != &cleaned).unwrap_or(true) {
                    lines.push(cleaned);
                }
            }
            let _ = std::fs::remove_file(&sub_file);
            return lines.join(" ");
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn extract_transcript_from_srt() {
        let dir = tempdir().unwrap();
        let srt = "1\n00:00:00,000 --> 00:00:02,000\nHello <b>world</b>\n\n2\n00:00:02,000 --> 00:00:04,000\nHello world\nSecond line\n";
        std::fs::write(dir.path().join("abc.en.srt"), srt).unwrap();
        let text = extract_transcript_text("abc", dir.path());
        assert_eq!(text, "Hello world Second line");
        assert!(!dir.path().join("abc.en.srt").exists());
    }

    #[test]
    fn extract_transcript_skips_webvtt_header() {
        let dir = tempdir().unwrap();
        let vtt =
            "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.000 --> 00:00:02.000\nFirst line\n";
        std::fs::write(dir.path().join("xyz.en.vtt"), vtt).unwrap();
        let text = extract_transcript_text("xyz", dir.path());
        assert_eq!(text, "First line");
    }

    #[test]
    fn extract_transcript_returns_empty_when_no_subs() {
        let dir = tempdir().unwrap();
        assert_eq!(extract_transcript_text("missing", dir.path()), "");
    }
}
