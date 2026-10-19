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

/// Why a `yt-dlp` listing could not be trusted.
///
/// The listing call used to swallow all of these and return an empty list, which
/// the callers reported as "No new episodes": a wrong channel handle then looked
/// identical to a quiet week, and the weekly cron went silent for seven runs.
#[derive(Debug, thiserror::Error)]
pub enum YtDlpError {
    /// The `yt-dlp` binary could not be started (not installed, not on `PATH`).
    #[error("could not start {bin}: {reason}")]
    Spawn {
        /// The binary that was invoked.
        bin: String,
        /// The operating-system error text.
        reason: String,
    },
    /// The call outlived its time limit.
    #[error("{bin} timed out after {secs}s")]
    Timeout {
        /// The binary that was invoked.
        bin: String,
        /// The limit, in seconds.
        secs: u64,
    },
    /// `yt-dlp` exited non-zero and produced no usable output.
    #[error("{bin} exited with {code}: {stderr}")]
    Exit {
        /// The binary that was invoked.
        bin: String,
        /// The exit code, or `signal` when it was killed.
        code: String,
        /// The last lines of standard error.
        stderr: String,
    },
}

/// The `yt-dlp` executable to run. `PODCAST_INGEST_YT_DLP` overrides it so a
/// test (or an operator pinning a build) can substitute one without touching
/// `PATH`.
fn yt_dlp_bin() -> String {
    std::env::var("PODCAST_INGEST_YT_DLP")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "yt-dlp".to_string())
}

/// What a finished `yt-dlp` process left behind.
struct YtDlpRun {
    stdout: String,
    stderr: String,
    success: bool,
    code: String,
}

/// Run `bin` with `args`, bounded by `timeout`, reporting how it ended.
async fn spawn_yt_dlp(bin: &str, args: &[&str], timeout: Duration) -> Result<YtDlpRun, YtDlpError> {
    let child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| YtDlpError::Spawn {
            bin: bin.to_string(),
            reason: e.to_string(),
        })?;

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(YtDlpRun {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            success: output.status.success(),
            code: output
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "signal".to_string()),
        }),
        Ok(Err(e)) => Err(YtDlpError::Spawn {
            bin: bin.to_string(),
            reason: e.to_string(),
        }),
        Err(_) => Err(YtDlpError::Timeout {
            bin: bin.to_string(),
            secs: timeout.as_secs(),
        }),
    }
}

/// Run `yt-dlp` with `args`, capturing stdout as text, bounded by `timeout`.
///
/// For the per-episode calls (metadata, subtitles) a timeout or spawn failure
/// degrades to empty output and `false`: one bad episode must not stop the run,
/// and the callers already treat "nothing parsed" as that episode's failure.
/// The channel listing does NOT use this path; see [`get_video_ids`].
async fn run_yt_dlp(args: &[&str], timeout: Duration) -> (String, bool) {
    match spawn_yt_dlp(&yt_dlp_bin(), args, timeout).await {
        Ok(run) => (run.stdout, run.success),
        Err(_) => (String::new(), false),
    }
}

/// The last few lines of `stderr`, for an error message.
fn stderr_tail(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
    let from = lines.len().saturating_sub(3);
    lines[from..].join(" | ")
}

/// List `(video id, title)` pairs for a channel or playlist URL using `bin`.
///
/// A failed listing is an error, never an empty list: a non-zero exit with
/// nothing parsed, a timeout and a missing binary all return [`YtDlpError`].
/// A non-zero exit that still yielded entries (one unavailable video in an
/// otherwise good listing) keeps the entries and warns on standard error.
pub async fn get_video_ids_with(
    bin: &str,
    channel_url: &str,
) -> Result<Vec<(String, String)>, YtDlpError> {
    let run = spawn_yt_dlp(
        bin,
        &[
            "--flat-playlist",
            "--print",
            "%(id)s\t%(title)s",
            channel_url,
        ],
        Duration::from_secs(300),
    )
    .await?;

    let mut videos = Vec::new();
    for line in run.stdout.trim().split('\n') {
        if let Some((vid_id, title)) = line.split_once('\t') {
            videos.push((vid_id.to_string(), title.to_string()));
        }
    }

    if !run.success {
        if videos.is_empty() {
            return Err(YtDlpError::Exit {
                bin: bin.to_string(),
                code: run.code,
                stderr: stderr_tail(&run.stderr),
            });
        }
        eprintln!(
            "warning: {bin} exited with {} but listed {} videos; continuing: {}",
            run.code,
            videos.len(),
            stderr_tail(&run.stderr)
        );
    }
    Ok(videos)
}

/// List `(video id, title)` pairs for a channel or playlist URL.
///
/// Python:
/// ```python
/// def get_video_ids(channel_url: str) -> list[tuple[str, str]]:
///     cmd = [sys.executable, "-m", "yt_dlp", "--flat-playlist",
///            "--print", "%(id)s\t%(title)s", channel_url]
///     result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
///     ...
/// ```
pub async fn get_video_ids(channel_url: &str) -> Result<Vec<(String, String)>, YtDlpError> {
    get_video_ids_with(&yt_dlp_bin(), channel_url).await
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

/// How a subtitle request ended. Only [`Fetched`](SubtitleOutcome::Fetched)
/// and [`NoCaptions`](SubtitleOutcome::NoCaptions) are final answers about the
/// episode; the other two mean "ask again later" and must leave no trace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubtitleOutcome {
    /// A subtitle file was written to the sub directory.
    Fetched,
    /// `yt-dlp` succeeded and the episode has no captions in the language.
    NoCaptions,
    /// YouTube answered 429. Retrying straight away makes it worse.
    RateLimited,
    /// Spawn failure, timeout, or any other non-zero exit.
    Failed(String),
}

/// True when `yt-dlp`'s output reports a YouTube rate limit.
fn mentions_rate_limit(text: &str) -> bool {
    text.contains("HTTP Error 429") || text.contains("Too Many Requests")
}

fn subtitle_file_exists(vid_id: &str, sub_dir: &Path) -> bool {
    [".en.srt", ".en.vtt"]
        .iter()
        .any(|ext| sub_dir.join(format!("{vid_id}{ext}")).exists())
}

/// Auto-generated-subtitle download into `sub_dir/<vid_id>.*`, classified.
/// Python never checked this return code, so a throttled run produced stub
/// episodes that looked finished.
pub async fn download_subtitles(vid_id: &str, url: &str, sub_dir: &Path) -> SubtitleOutcome {
    download_subtitles_with(&yt_dlp_bin(), vid_id, url, sub_dir).await
}

/// [`download_subtitles`] against an explicit `yt-dlp` binary.
pub async fn download_subtitles_with(
    bin: &str,
    vid_id: &str,
    url: &str,
    sub_dir: &Path,
) -> SubtitleOutcome {
    let out_template = sub_dir.join(vid_id);
    let out_template = out_template.to_string_lossy().to_string();
    let run = spawn_yt_dlp(
        bin,
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
    let run = match run {
        Ok(run) => run,
        Err(e) => return SubtitleOutcome::Failed(e.to_string()),
    };
    if mentions_rate_limit(&run.stderr) || mentions_rate_limit(&run.stdout) {
        return SubtitleOutcome::RateLimited;
    }
    if !run.success {
        return SubtitleOutcome::Failed(format!(
            "{bin} exited with {}: {}",
            run.code,
            stderr_tail(&run.stderr)
        ));
    }
    if subtitle_file_exists(vid_id, sub_dir) {
        SubtitleOutcome::Fetched
    } else {
        SubtitleOutcome::NoCaptions
    }
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

/// Serialises the tests that point `PODCAST_INGEST_YT_DLP` at a fake: the
/// variable is process-global, so two such tests running at once would race.
#[cfg(test)]
pub(crate) static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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

    /// Write an executable stand-in for `yt-dlp` and return its path.
    #[cfg(unix)]
    fn fake_yt_dlp(dir: &Path, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-yt-dlp");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().to_string()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn listing_failure_is_an_error_not_an_empty_list() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempdir().unwrap();
        let bin = fake_yt_dlp(
            dir.path(),
            "echo 'ERROR: [youtube:tab] @Nope: This channel does not have a videos tab' >&2; exit 1",
        );
        let err = get_video_ids_with(&bin, "https://example.invalid/@Nope/videos")
            .await
            .expect_err("a failing yt-dlp must not look like an empty channel");
        let text = err.to_string();
        assert!(text.contains("exited with 1"), "{text}");
        assert!(text.contains("does not have a videos tab"), "{text}");
    }

    #[tokio::test]
    async fn missing_binary_is_an_error() {
        let err = get_video_ids_with("/nonexistent/yt-dlp-for-test", "https://example.invalid/")
            .await
            .expect_err("a binary that cannot start must be reported");
        assert!(matches!(err, YtDlpError::Spawn { .. }), "{err}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_listing_parses_ids_and_titles() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempdir().unwrap();
        let bin = fake_yt_dlp(dir.path(), "printf 'aaa\\tFirst\\nbbb\\tSecond\\n'");
        let videos = get_video_ids_with(&bin, "https://example.invalid/")
            .await
            .unwrap();
        assert_eq!(
            videos,
            vec![
                ("aaa".to_string(), "First".to_string()),
                ("bbb".to_string(), "Second".to_string())
            ]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn partial_listing_with_nonzero_exit_keeps_the_entries() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempdir().unwrap();
        let bin = fake_yt_dlp(
            dir.path(),
            "printf 'aaa\\tFirst\\n'; echo 'ERROR: one video unavailable' >&2; exit 1",
        );
        let videos = get_video_ids_with(&bin, "https://example.invalid/")
            .await
            .unwrap();
        assert_eq!(videos.len(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_empty_listing_is_ok_and_empty() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempdir().unwrap();
        let bin = fake_yt_dlp(dir.path(), "exit 0");
        let videos = get_video_ids_with(&bin, "https://example.invalid/")
            .await
            .unwrap();
        assert!(videos.is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn subtitle_outcomes_are_classified() {
        let _env = ENV_LOCK.lock().await;
        let dir = tempdir().unwrap();
        let sub = dir.path().join("subs");
        std::fs::create_dir_all(&sub).unwrap();
        let url = "https://example.invalid/watch?v=abc";

        let bin = fake_yt_dlp(
            dir.path(),
            "echo \"ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\" >&2; exit 1",
        );
        assert_eq!(
            download_subtitles_with(&bin, "abc", url, &sub).await,
            SubtitleOutcome::RateLimited
        );

        let bin = fake_yt_dlp(dir.path(), "echo 'ERROR: boom' >&2; exit 1");
        let outcome = download_subtitles_with(&bin, "abc", url, &sub).await;
        assert!(
            matches!(&outcome, SubtitleOutcome::Failed(m) if m.contains("boom")),
            "{outcome:?}"
        );

        let bin = fake_yt_dlp(
            dir.path(),
            "echo '[info] There are no subtitles for the requested languages'; exit 0",
        );
        assert_eq!(
            download_subtitles_with(&bin, "abc", url, &sub).await,
            SubtitleOutcome::NoCaptions
        );

        let bin = fake_yt_dlp(
            dir.path(),
            &format!(
                "printf '1\\n00:00:00,000 --> 00:00:01,000\\nHi\\n' > '{}/abc.en.srt'; exit 0",
                sub.display()
            ),
        );
        assert_eq!(
            download_subtitles_with(&bin, "abc", url, &sub).await,
            SubtitleOutcome::Fetched
        );

        let outcome =
            download_subtitles_with("/nonexistent/yt-dlp-for-test", "abc", url, &sub).await;
        assert!(matches!(outcome, SubtitleOutcome::Failed(_)), "{outcome:?}");
    }
}
