//! Tool parameter types for the `gemini-url-context` MCP server, mirroring
//! the pydantic models in
//! `skills/gemini-url-context/mcp-server/server.py`.

use schemars::JsonSchema;
use serde::Deserialize;

fn default_expand_prompt() -> String {
    "Summarize the main content and key points from this URL".to_string()
}

fn default_expand_urls_prompt() -> String {
    "Summarize the content from each URL".to_string()
}

fn default_true() -> bool {
    true
}

fn default_compare_aspects() -> Vec<String> {
    vec!["features".into(), "content".into(), "differences".into()]
}

fn default_markdown() -> String {
    "markdown".to_string()
}

fn default_json_format() -> String {
    "json".to_string()
}

/// Prepend `https://` when a URL has no scheme, matching the pydantic
/// `validate_url` field_validator.
fn normalize_url(v: &str) -> String {
    if v.starts_with("http://") || v.starts_with("https://") {
        v.to_string()
    } else {
        format!("https://{v}")
    }
}

fn deserialize_url<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    Ok(normalize_url(&raw))
}

fn deserialize_urls<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw: Vec<String> = Vec::deserialize(deserializer)?;
    Ok(raw.iter().map(|v| normalize_url(v)).collect())
}

/// Parameters for single URL expansion.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExpandUrlParams {
    /// URL to expand and analyze
    #[serde(deserialize_with = "deserialize_url")]
    pub url: String,
    /// What to extract or analyze from the URL
    #[serde(default = "default_expand_prompt")]
    pub prompt: String,
    /// Include grounding metadata in response
    #[serde(default = "default_true")]
    pub include_metadata: bool,
}

/// Parameters for batch URL expansion.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExpandUrlsParams {
    /// List of URLs to expand (max 20)
    #[serde(deserialize_with = "deserialize_urls")]
    pub urls: Vec<String>,
    /// What to extract or analyze from the URLs
    #[serde(default = "default_expand_urls_prompt")]
    pub prompt: String,
    /// Include grounding metadata
    #[serde(default = "default_true")]
    pub include_metadata: bool,
}

impl ExpandUrlsParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.urls.len() > 20 {
            return Err("Maximum 20 URLs per request".to_string());
        }
        Ok(())
    }
}

/// Parameters for URL comparison.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompareUrlsParams {
    /// URLs to compare (2-20)
    #[serde(deserialize_with = "deserialize_urls")]
    pub urls: Vec<String>,
    /// Aspects to compare
    #[serde(default = "default_compare_aspects")]
    pub aspects: Vec<String>,
    /// Output format: markdown, json, plain
    #[serde(default = "default_markdown")]
    pub format: String,
}

impl CompareUrlsParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.urls.len() < 2 {
            return Err("Need at least 2 URLs to compare".to_string());
        }
        if self.urls.len() > 20 {
            return Err("Maximum 20 URLs per request".to_string());
        }
        Ok(())
    }
}

/// Parameters for structured data extraction.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExtractFromUrlParams {
    /// URL to extract data from
    #[serde(deserialize_with = "deserialize_url")]
    pub url: String,
    /// Schema defining what to extract: {field_name: description}
    ///
    /// Kept as an ordered `Vec<(String, String)>` rather than a `Map` so the
    /// prompt built from it preserves client-supplied field order, matching
    /// Python's order-preserving `dict`. The external tool schema still
    /// advertises a plain string-to-string object.
    #[schemars(with = "std::collections::BTreeMap<String, String>")]
    #[serde(deserialize_with = "deserialize_ordered_schema")]
    pub schema: Vec<(String, String)>,
    /// Output format: json, yaml, markdown
    #[serde(default = "default_json_format")]
    pub format: String,
}

fn deserialize_ordered_schema<'de, D>(deserializer: D) -> Result<Vec<(String, String)>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct OrderedSchemaVisitor;

    impl<'de> serde::de::Visitor<'de> for OrderedSchemaVisitor {
        type Value = Vec<(String, String)>;

        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "a JSON object mapping field name to description")
        }

        fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::MapAccess<'de>,
        {
            let mut entries = Vec::with_capacity(map.size_hint().unwrap_or(0));
            while let Some((key, value)) = map.next_entry::<String, String>()? {
                entries.push((key, value));
            }
            Ok(entries)
        }
    }

    deserializer.deserialize_map(OrderedSchemaVisitor)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn expand_url_params_prepends_https_when_scheme_missing() {
        let params: ExpandUrlParams =
            serde_json::from_value(json!({"url": "example.com"})).unwrap();
        assert_eq!(params.url, "https://example.com");
        assert!(params.include_metadata);
        assert_eq!(params.prompt, default_expand_prompt());
    }

    #[test]
    fn expand_url_params_leaves_existing_scheme_alone() {
        let params: ExpandUrlParams =
            serde_json::from_value(json!({"url": "http://example.com"})).unwrap();
        assert_eq!(params.url, "http://example.com");
    }

    #[test]
    fn expand_urls_params_rejects_more_than_twenty_urls() {
        let urls: Vec<String> = (0..21)
            .map(|i| format!("https://example.com/{i}"))
            .collect();
        let params = ExpandUrlsParams {
            urls,
            prompt: default_expand_urls_prompt(),
            include_metadata: true,
        };
        assert!(params.validate().is_err());
    }

    #[test]
    fn compare_urls_params_requires_at_least_two_urls() {
        let params = CompareUrlsParams {
            urls: vec!["https://a.com".to_string()],
            aspects: default_compare_aspects(),
            format: default_markdown(),
        };
        assert!(params.validate().is_err());

        let params = CompareUrlsParams {
            urls: vec!["https://a.com".to_string(), "https://b.com".to_string()],
            aspects: default_compare_aspects(),
            format: default_markdown(),
        };
        assert!(params.validate().is_ok());
    }

    #[test]
    fn extract_from_url_params_preserves_schema_field_order() {
        let params: ExtractFromUrlParams = serde_json::from_value(json!({
            "url": "https://example.com",
            "schema": {"zeta": "last field", "alpha": "first field", "mid": "middle field"}
        }))
        .unwrap();
        let keys: Vec<&str> = params.schema.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["zeta", "alpha", "mid"]);
    }
}
