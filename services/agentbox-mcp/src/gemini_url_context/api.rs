//! Gemini URL Context API client, ported from `call_gemini()` and
//! `format_url_metadata()` in the Python source.

use std::time::Duration;

use serde_json::{json, Value};

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Debug, Clone)]
pub struct GeminiConfig {
    pub api_key: String,
    pub model: String,
    pub timeout: Duration,
}

impl GeminiConfig {
    pub fn from_env() -> Self {
        // GOOGLE_API_KEY is canonical; GOOGLE_GEMINI_API_KEY/GEMINI_API_KEY
        // are legacy fallbacks, matching the Python source exactly.
        let api_key = ["GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY"]
            .into_iter()
            .find_map(|key| std::env::var(key).ok().filter(|v| !v.is_empty()))
            .unwrap_or_default();
        let model = crate::common::env_or("GEMINI_MODEL", "gemini-3.8-flash");
        let timeout_secs = crate::common::env_or_u64("GEMINI_TIMEOUT", 60);
        Self {
            api_key,
            model,
            timeout: Duration::from_secs(timeout_secs),
        }
    }

    pub fn api_base(&self) -> &'static str {
        GEMINI_API_BASE
    }
}

/// Call the Gemini API with the `url_context` tool enabled.
pub async fn call_gemini(config: &GeminiConfig, prompt: &str, urls: Option<&[String]>) -> Value {
    if config.api_key.is_empty() {
        return json!({
            "success": false,
            "error": "GOOGLE_API_KEY not set. Export it or add to .env",
        });
    }

    let full_prompt = match urls {
        Some(urls) if !urls.is_empty() => {
            format!("{prompt}\n\nURLs to analyze:\n{}", urls.join("\n"))
        }
        _ => prompt.to_string(),
    };

    let payload = json!({
        "contents": [{"parts": [{"text": full_prompt}]}],
        "tools": [{"url_context": {}}],
    });

    let endpoint = format!(
        "{}/models/{}:generateContent?key={}",
        GEMINI_API_BASE, config.model, config.api_key
    );

    let client = match reqwest::Client::builder().timeout(config.timeout).build() {
        Ok(client) => client,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let response = match client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            if e.is_connect() {
                return json!({"success": false, "error": "Cannot connect to Gemini API"});
            }
            if e.is_timeout() {
                return json!({
                    "success": false,
                    "error": format!("Request timed out after {}s", config.timeout.as_secs()),
                });
            }
            return json!({"success": false, "error": e.to_string()});
        }
    };

    let status = response.status();
    if status.as_u16() == 200 {
        let data: Value = match response.json().await {
            Ok(data) => data,
            Err(e) => return json!({"success": false, "error": e.to_string()}),
        };

        let empty_obj = json!({});
        let candidate = data
            .get("candidates")
            .and_then(|c| c.get(0))
            .unwrap_or(&empty_obj);
        let content = candidate.get("content").cloned().unwrap_or(json!({}));
        let empty_parts = vec![json!({})];
        let parts = content
            .get("parts")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or(empty_parts);
        let text = parts
            .first()
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let grounding = candidate
            .get("groundingMetadata")
            .cloned()
            .unwrap_or(json!({}));
        let url_metadata = candidate
            .get("urlContextMetadata")
            .cloned()
            .unwrap_or(json!({}));
        let usage = data.get("usageMetadata").cloned().unwrap_or(json!({}));

        json!({
            "success": true,
            "content": text,
            "grounding": grounding,
            "url_metadata": url_metadata,
            "usage": {
                "prompt_tokens": usage.get("promptTokenCount").cloned().unwrap_or(json!(0)),
                "completion_tokens": usage.get("candidatesTokenCount").cloned().unwrap_or(json!(0)),
                "url_content_tokens": usage.get("toolUsePromptTokenCount").cloned().unwrap_or(json!(0)),
                "total_tokens": usage.get("totalTokenCount").cloned().unwrap_or(json!(0)),
            },
            "model": data.get("modelVersion").cloned().unwrap_or(json!(config.model)),
        })
    } else {
        let message = match response.json::<Value>().await {
            Ok(error_data) => error_data
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("HTTP {}", status.as_u16())),
            Err(_) => format!("HTTP {}", status.as_u16()),
        };
        json!({"success": false, "error": message})
    }
}

/// Format URL retrieval metadata, matching `format_url_metadata()`.
pub fn format_url_metadata(metadata: &Value) -> Vec<Value> {
    metadata
        .get("urlMetadata")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|item| {
            let status = item
                .get("urlRetrievalStatus")
                .and_then(|s| s.as_str())
                .unwrap_or("UNKNOWN")
                .replace("URL_RETRIEVAL_STATUS_", "");
            json!({
                "url": item.get("retrievedUrl").and_then(|u| u.as_str()).unwrap_or(""),
                "status": status,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    const ENV_KEYS: [&str; 5] = [
        "GOOGLE_API_KEY",
        "GOOGLE_GEMINI_API_KEY",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_TIMEOUT",
    ];

    fn clear_env() {
        for key in ENV_KEYS {
            unsafe {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn from_env_defaults_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        let config = GeminiConfig::from_env();
        assert_eq!(config.api_key, "");
        assert_eq!(config.model, "gemini-3.8-flash");
        assert_eq!(config.timeout, Duration::from_secs(60));
        clear_env();
    }

    #[test]
    fn from_env_prefers_google_api_key_over_legacy_fallbacks() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        unsafe {
            std::env::set_var("GOOGLE_API_KEY", "canonical-key");
            std::env::set_var("GOOGLE_GEMINI_API_KEY", "legacy-key-1");
            std::env::set_var("GEMINI_API_KEY", "legacy-key-2");
        }
        let config = GeminiConfig::from_env();
        assert_eq!(config.api_key, "canonical-key");
        clear_env();
    }

    #[test]
    fn from_env_preserves_model_override() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        unsafe {
            std::env::set_var("GEMINI_MODEL", "gemini-2.5-flash");
        }
        assert_eq!(GeminiConfig::from_env().model, "gemini-2.5-flash");
        clear_env();
    }

    #[test]
    fn from_env_falls_back_through_legacy_key_names_in_order() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        unsafe {
            std::env::set_var("GOOGLE_GEMINI_API_KEY", "legacy-key-1");
            std::env::set_var("GEMINI_API_KEY", "legacy-key-2");
        }
        assert_eq!(GeminiConfig::from_env().api_key, "legacy-key-1");
        clear_env();

        unsafe {
            std::env::set_var("GEMINI_API_KEY", "legacy-key-2");
        }
        assert_eq!(GeminiConfig::from_env().api_key, "legacy-key-2");
        clear_env();
    }

    #[test]
    fn format_url_metadata_strips_status_prefix() {
        let metadata = json!({
            "urlMetadata": [
                {"retrievedUrl": "https://example.com", "urlRetrievalStatus": "URL_RETRIEVAL_STATUS_SUCCESS"}
            ]
        });
        assert_eq!(
            format_url_metadata(&metadata),
            vec![json!({"url": "https://example.com", "status": "SUCCESS"})]
        );
    }

    #[test]
    fn format_url_metadata_defaults_when_absent() {
        assert_eq!(format_url_metadata(&json!({})), Vec::<Value>::new());
    }
}
