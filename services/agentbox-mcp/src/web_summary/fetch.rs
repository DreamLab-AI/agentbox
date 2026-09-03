//! Web page fetching + basic HTML text extraction, ported from
//! `fetch_url_content()` in the Python source.

use std::time::Duration;

use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

pub const USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONTENT_CHARS: usize = 50_000;

static SCRIPT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<script[^>]*>.*?</script>").expect("valid regex"));
static STYLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<style[^>]*>.*?</style>").expect("valid regex"));
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("valid regex"));
static WHITESPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("valid regex"));

fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Strip `<script>`/`<style>` blocks and remaining tags, then collapse
/// whitespace — matching the Python regex pipeline exactly.
pub fn strip_html(html: &str) -> String {
    let no_script = SCRIPT_RE.replace_all(html, "");
    let no_style = STYLE_RE.replace_all(&no_script, "");
    let no_tags = TAG_RE.replace_all(&no_style, " ");
    WHITESPACE_RE.replace_all(&no_tags, " ").trim().to_string()
}

/// Fetch a URL and return the same JSON shape as the Python
/// `fetch_url_content()` coroutine.
pub async fn fetch_url_content(url: &str) -> Value {
    let client = match reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
    {
        Ok(client) => client,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let response = match client.get(url).send().await {
        Ok(response) => response,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    if !response.status().is_success() {
        return json!({"success": false, "error": format!("HTTP {}", response.status().as_u16())});
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let final_url = response.url().to_string();

    let body = match response.text().await {
        Ok(body) => body,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    if content_type.contains("text/html") {
        let text = strip_html(&body);
        json!({
            "success": true,
            "content": truncate_chars(&text, MAX_CONTENT_CHARS),
            "content_type": "html",
            "url": final_url,
        })
    } else {
        json!({
            "success": true,
            "content": truncate_chars(&body, MAX_CONTENT_CHARS),
            "content_type": "text",
            "url": final_url,
        })
    }
}

/// Matches `is_youtube_url()` in the Python source.
pub fn is_youtube_url(url: &str) -> bool {
    url.contains("youtube.com") || url.contains("youtu.be")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_removes_script_and_style_blocks() {
        let html = "<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><p>Hello <b>world</b></p></body></html>";
        assert_eq!(strip_html(html), "Hello world");
    }

    #[test]
    fn strip_html_collapses_whitespace() {
        let html = "<p>Line one</p>\n\n<p>Line   two</p>";
        assert_eq!(strip_html(html), "Line one Line two");
    }

    #[test]
    fn is_youtube_url_matches_both_domains() {
        assert!(is_youtube_url("https://www.youtube.com/watch?v=abc"));
        assert!(is_youtube_url("https://youtu.be/abc"));
        assert!(!is_youtube_url("https://example.com"));
    }
}
