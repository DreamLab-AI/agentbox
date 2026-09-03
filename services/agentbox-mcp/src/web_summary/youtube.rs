//! YouTube transcript extraction, ported from
//! `fetch_youtube_transcript()` (which wrapped the `youtube-transcript-api`
//! Python package). Reimplemented directly against YouTube's public watch
//! page + timedtext endpoint: fetch the watch page, pull the
//! `captionTracks` list out of the embedded player response, pick a track
//! for the requested language, then fetch and parse its timedtext XML.

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use super::fetch::USER_AGENT;

const WATCH_TIMEOUT: Duration = Duration::from_secs(30);

static CAPTION_TRACKS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""captionTracks":(\[.*?\])"#).expect("valid regex"));
static TEXT_ENTRY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<text[^>]*>(.*?)</text>").expect("valid regex"));
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("valid regex"));
static NUMERIC_ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&#(\d+);").expect("valid regex"));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptionTrack {
    base_url: String,
    language_code: String,
}

/// Fetch a transcript for `video_id`, matching the Python
/// `fetch_youtube_transcript()` return shapes.
pub async fn fetch_youtube_transcript(video_id: &str, language: &str) -> Value {
    let client = match reqwest::Client::builder()
        .timeout(WATCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
    {
        Ok(client) => client,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");
    let page = match client.get(&watch_url).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => body,
            Err(e) => return json!({"success": false, "error": e.to_string()}),
        },
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let Some(captures) = CAPTION_TRACKS_RE.captures(&page) else {
        return json!({
            "success": false,
            "error": format!("No captions available for video '{video_id}'"),
        });
    };

    let tracks: Vec<CaptionTrack> = match serde_json::from_str(&captures[1]) {
        Ok(tracks) => tracks,
        Err(e) => {
            return json!({
                "success": false,
                "error": format!("Failed to parse caption track list: {e}"),
            })
        }
    };

    let track = tracks
        .iter()
        .find(|t| t.language_code == language)
        .or_else(|| {
            tracks
                .iter()
                .find(|t| t.language_code.starts_with(language))
        });

    let Some(track) = track else {
        let available: Vec<&str> = tracks.iter().map(|t| t.language_code.as_str()).collect();
        return json!({
            "success": false,
            "error": format!(
                "No transcript found for language '{language}'. Available: {available:?}"
            ),
        });
    };

    let base_url = html_unescape(&track.base_url);
    let timedtext = match client.get(&base_url).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => body,
            Err(e) => return json!({"success": false, "error": e.to_string()}),
        },
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let segments: Vec<String> = TEXT_ENTRY_RE
        .captures_iter(&timedtext)
        .map(|c| clean_caption_text(&c[1]))
        .filter(|t| !t.is_empty())
        .collect();

    if segments.is_empty() {
        return json!({
            "success": false,
            "error": format!("Transcript for '{video_id}' ({language}) was empty"),
        });
    }

    let full_text = segments.join(" ");
    json!({
        "success": true,
        "video_id": video_id,
        "language": language,
        "segments": segments.len(),
        "transcript": full_text,
    })
}

fn clean_caption_text(raw: &str) -> String {
    let no_tags = TAG_RE.replace_all(raw, "");
    html_unescape(&no_tags).trim().to_string()
}

fn html_unescape(input: &str) -> String {
    let replaced = input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    NUMERIC_ENTITY_RE
        .replace_all(&replaced, |caps: &regex::Captures| {
            caps[1]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_else(|| caps[0].to_string())
        })
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_unescape_handles_named_entities() {
        assert_eq!(html_unescape("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(html_unescape("&quot;quoted&quot;"), "\"quoted\"");
        assert_eq!(html_unescape("it&#39;s"), "it's");
    }

    #[test]
    fn html_unescape_handles_numeric_entities() {
        assert_eq!(html_unescape("caf&#233;"), "café");
    }

    #[test]
    fn clean_caption_text_strips_tags_and_unescapes() {
        assert_eq!(
            clean_caption_text("<font>Tom &amp; Jerry</font>  "),
            "Tom & Jerry"
        );
    }

    #[test]
    fn caption_tracks_regex_extracts_array_stopping_at_first_close_bracket() {
        let page =
            r#"blah "captionTracks":[{"baseUrl":"https://x","languageCode":"en"}],"other":1 blah"#;
        let captures = CAPTION_TRACKS_RE.captures(page).expect("match");
        let tracks: Vec<CaptionTrack> = serde_json::from_str(&captures[1]).expect("parse");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].language_code, "en");
        assert_eq!(tracks[0].base_url, "https://x");
    }
}
