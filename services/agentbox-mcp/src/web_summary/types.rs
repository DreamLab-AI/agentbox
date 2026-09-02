//! Tool parameter types for the `web-summary` MCP server, mirroring the
//! pydantic models in `skills/web-summary/mcp-server/server.py`.

use schemars::JsonSchema;
use serde::Deserialize;

fn default_length() -> String {
    "medium".to_string()
}

fn default_true() -> bool {
    true
}

fn default_format_markdown() -> String {
    "markdown".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

fn default_max_topics() -> i64 {
    10
}

fn default_format_obsidian() -> String {
    "obsidian".to_string()
}

/// Parameters for URL summarization.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SummarizeUrlParams {
    /// URL to summarize (web page or YouTube video)
    #[serde(deserialize_with = "deserialize_url")]
    pub url: String,
    /// Summary length: short, medium, long
    #[serde(default = "default_length")]
    pub length: String,
    /// Include semantic topic links
    #[serde(default = "default_true")]
    pub include_topics: bool,
    /// Output format: markdown, plain, obsidian (logseq is a legacy synonym of obsidian)
    #[serde(default = "default_format_markdown")]
    pub format: String,
}

impl SummarizeUrlParams {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.length.as_str(), "short" | "medium" | "long") {
            return Err("length must be 'short', 'medium', or 'long'".to_string());
        }
        Ok(())
    }
}

/// Parameters for YouTube transcript extraction.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct YouTubeTranscriptParams {
    /// YouTube video ID or full URL
    #[serde(deserialize_with = "deserialize_video_id")]
    pub video_id: String,
    /// Transcript language code
    #[serde(default = "default_language")]
    pub language: String,
}

/// Parameters for topic generation.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct TopicsParams {
    /// Text to analyze for topics
    pub text: String,
    /// Maximum topics to extract
    #[serde(default = "default_max_topics")]
    pub max_topics: i64,
    /// Output format: obsidian (default), plain; logseq is a legacy synonym of obsidian (ADR-2028 D4)
    #[serde(default = "default_format_obsidian")]
    pub format: String,
}

impl TopicsParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=50).contains(&self.max_topics) {
            return Err(format!(
                "max_topics must be between 1 and 50 (got {})",
                self.max_topics
            ));
        }
        Ok(())
    }
}

/// Reproduces the pydantic `validate_url` field_validator: prefix with
/// `https://` when the value has no URL scheme.
fn deserialize_url<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    Ok(normalize_url(&raw))
}

fn normalize_url(raw: &str) -> String {
    if has_url_scheme(raw) {
        raw.to_string()
    } else {
        format!("https://{raw}")
    }
}

/// Approximates `urllib.parse.urlparse(v).scheme` truthiness: a leading
/// `[a-zA-Z][a-zA-Z0-9+.-]*:` is treated as an existing scheme.
fn has_url_scheme(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    let mut saw_colon = false;
    for c in chars {
        if c == ':' {
            saw_colon = true;
            break;
        }
        if !(c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-') {
            return false;
        }
    }
    saw_colon
}

/// Reproduces the pydantic `extract_video_id` field_validator on
/// `YouTubeTranscriptParams`.
fn deserialize_video_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    Ok(extract_video_id(&raw))
}

pub fn extract_video_id(value: &str) -> String {
    if value.contains("youtube.com") || value.contains("youtu.be") {
        if let Some(idx) = value.find("youtu.be/") {
            let rest = &value[idx + "youtu.be/".len()..];
            return rest.split('?').next().unwrap_or(rest).to_string();
        }
        if let Some(query) = value.split_once('?').map(|(_, q)| q) {
            for pair in query.split('&') {
                if let Some((key, val)) = pair.split_once('=') {
                    if key == "v" {
                        return val.to_string();
                    }
                }
            }
        }
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_prepends_https_when_scheme_missing() {
        assert_eq!(
            normalize_url("example.com/page"),
            "https://example.com/page"
        );
    }

    #[test]
    fn normalize_url_leaves_existing_scheme_alone() {
        assert_eq!(normalize_url("http://example.com"), "http://example.com");
        assert_eq!(normalize_url("https://example.com"), "https://example.com");
    }

    #[test]
    fn extract_video_id_handles_youtu_be_short_links() {
        assert_eq!(extract_video_id("https://youtu.be/abc123?t=30"), "abc123");
        assert_eq!(extract_video_id("https://youtu.be/abc123"), "abc123");
    }

    #[test]
    fn extract_video_id_handles_watch_query_param() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=abc123&list=xyz"),
            "abc123"
        );
    }

    #[test]
    fn extract_video_id_passes_through_bare_ids() {
        assert_eq!(extract_video_id("abc123"), "abc123");
    }

    #[test]
    fn summarize_url_params_rejects_invalid_length() {
        let params = SummarizeUrlParams {
            url: "https://example.com".to_string(),
            length: "extra-long".to_string(),
            include_topics: true,
            format: "markdown".to_string(),
        };
        assert!(params.validate().is_err());
    }

    #[test]
    fn summarize_url_params_accepts_known_lengths() {
        for length in ["short", "medium", "long"] {
            let params = SummarizeUrlParams {
                url: "https://example.com".to_string(),
                length: length.to_string(),
                include_topics: true,
                format: "markdown".to_string(),
            };
            assert!(params.validate().is_ok());
        }
    }

    #[test]
    fn topics_params_validates_max_topics_range() {
        let mut params = TopicsParams {
            text: "hello world".to_string(),
            max_topics: 0,
            format: "obsidian".to_string(),
        };
        assert!(params.validate().is_err());

        params.max_topics = 51;
        assert!(params.validate().is_err());

        params.max_topics = 10;
        assert!(params.validate().is_ok());
    }
}
