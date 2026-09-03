//! Ontology Loom facade client, ported from `call_llm()` (formerly
//! `call_zai`) in the Python source.

use std::time::Duration;

use serde_json::{json, Value};

/// Reasoning models behind the Loom need generous headroom; 400 truncates
/// some of them to empty (see agentbox CLAUDE.md bench note) — the Python
/// source always clamps up to at least 1536, regardless of the caller's
/// requested `max_tokens`.
const MIN_MAX_TOKENS: i64 = 1536;

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub url: String,
    pub model: String,
    pub timeout: Duration,
}

impl LlmConfig {
    pub fn from_env() -> Self {
        // LLM_URL is canonical; ZAI_URL is the legacy fallback still read by
        // the mcp.json registration. Neither set: the Ontology Loom facade.
        let url = std::env::var("LLM_URL")
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| std::env::var("ZAI_URL").ok().filter(|v| !v.is_empty()))
            .unwrap_or_else(|| "http://192.168.2.132:8084/v1".to_string());
        let url = url.trim_end_matches('/').to_string();

        let model = crate::common::env_or("LLM_MODEL", "loom");

        let timeout_secs = std::env::var("LLM_TIMEOUT")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or_else(|| {
                std::env::var("ZAI_TIMEOUT")
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(120)
            });

        Self {
            url,
            model,
            timeout: Duration::from_secs(timeout_secs),
        }
    }
}

/// Call the Ontology Loom facade (OpenAI-compatible chat/completions).
pub async fn call_llm(config: &LlmConfig, prompt: &str, max_tokens: i64) -> Value {
    let max_tokens = max_tokens.max(MIN_MAX_TOKENS);

    let client = match reqwest::Client::builder().timeout(config.timeout).build() {
        Ok(client) => client,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let endpoint = format!("{}/chat/completions", config.url);
    let body = json!({
        "model": config.model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    });

    let response = match client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            if e.is_connect() {
                return json!({
                    "success": false,
                    "error": format!(
                        "Cannot connect to the Ontology Loom facade at {}. Check the facade health: curl -s http://192.168.2.132:8084/health (override with LLM_URL). Do not target the dead HP address 192.168.2.48.",
                        config.url
                    ),
                });
            }
            return json!({"success": false, "error": e.to_string()});
        }
    };

    let status = response.status();
    if status.as_u16() != 200 {
        return json!({"success": false, "error": format!("Loom facade returned {}", status.as_u16())});
    }

    let data: Value = match response.json().await {
        Ok(data) => data,
        Err(e) => return json!({"success": false, "error": e.to_string()}),
    };

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            data.get("content")
                .and_then(|c| c.as_str())
                .or_else(|| data.get("response").and_then(|c| c.as_str()))
                .unwrap_or("")
                .to_string()
        });

    json!({"success": true, "content": content})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// `LlmConfig::from_env()` reads process-global env vars, so tests that
    /// exercise it must not run concurrently with each other.
    static ENV_LOCK: Mutex<()> = Mutex::new(());
    const ENV_KEYS: [&str; 4] = ["LLM_URL", "ZAI_URL", "LLM_TIMEOUT", "ZAI_TIMEOUT"];

    fn clear_env() {
        for key in ENV_KEYS {
            unsafe {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn defaults_to_ontology_loom_facade_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        let config = LlmConfig::from_env();
        assert_eq!(config.url, "http://192.168.2.132:8084/v1");
        assert_eq!(config.timeout, Duration::from_secs(120));
        clear_env();
    }

    #[test]
    fn zai_url_and_timeout_are_read_as_legacy_fallbacks() {
        // Matches the literal registration in skills/mcp.json / mcp/mcp.json.
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        unsafe {
            std::env::set_var("ZAI_URL", "http://localhost:9600/chat");
            std::env::set_var("ZAI_TIMEOUT", "60");
        }
        let config = LlmConfig::from_env();
        assert_eq!(config.url, "http://localhost:9600/chat");
        assert_eq!(config.timeout, Duration::from_secs(60));
        clear_env();
    }

    #[test]
    fn llm_url_and_timeout_take_precedence_over_zai_fallbacks() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_env();
        unsafe {
            std::env::set_var("LLM_URL", "https://loom.example/v1/");
            std::env::set_var("ZAI_URL", "http://localhost:9600/chat");
            std::env::set_var("LLM_TIMEOUT", "45");
            std::env::set_var("ZAI_TIMEOUT", "60");
        }
        let config = LlmConfig::from_env();
        // Trailing slash is stripped, matching the Python `.rstrip("/")`.
        assert_eq!(config.url, "https://loom.example/v1");
        assert_eq!(config.timeout, Duration::from_secs(45));
        clear_env();
    }

    #[test]
    fn max_tokens_is_always_clamped_to_at_least_1536() {
        assert_eq!(10i64.max(MIN_MAX_TOKENS), 1536);
        assert_eq!(2000i64.max(MIN_MAX_TOKENS), 2000);
    }
}
