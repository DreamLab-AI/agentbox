//! Ontology Loom facade client for web summarisation.
//!
//! The request itself comes from `loom-client` (ADR-2084), so this path now
//! gets three things the hand-rolled version did not have: a truncation retry
//! on a doubled budget, a refusal when the facade answers from ontology
//! retrieval instead of calling the model, and a transient retry.
//!
//! The token floor was already here and is now the crate's, at the same 1536:
//! reasoning models spend their budget on `reasoning_content` first, so a
//! smaller ask comes back as empty content rather than a short summary.

use std::time::Duration;

use loom_client::{ChatRequest, LoomClient, LoomOptions, Message};
use serde_json::{json, Value};

/// Reasoning models behind the Loom need generous headroom; 400 truncates
/// some of them to empty (see agentbox CLAUDE.md bench note), so every ask is
/// clamped up to at least this regardless of what the caller requested.
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
            .unwrap_or_else(|| "http://loom:8080/v1".to_string());
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

/// Call the Ontology Loom facade, returning the MCP tool's result shape:
/// `{"success": true, "content": …}` or `{"success": false, "error": …}`.
pub async fn call_llm(config: &LlmConfig, prompt: &str, max_tokens: i64) -> Value {
    let max_tokens = max_tokens.max(MIN_MAX_TOKENS);

    let client = LoomClient::builder(&config.url)
        .timeout(config.timeout)
        .build();

    let request = ChatRequest::new(&config.model, vec![Message::user(prompt)])
        .max_tokens(u64::try_from(max_tokens).unwrap_or(u64::MAX))
        // The page being summarised is in the prompt, so a verbatim serve
        // would answer from the ontology and ignore the page entirely. Keep
        // the scaffold — grounding a summary is harmless and sometimes useful,
        // and declining it would fail against a facade predating ADR-139.
        .options(LoomOptions::declining_verbatim());

    match client.chat(request).await {
        Ok(answer) => json!({ "success": true, "content": answer.content }),
        Err(loom_client::Error::Transport { source, .. }) if source.is_connect() => json!({
            "success": false,
            "error": format!(
                "Cannot connect to the Ontology Loom facade at {}. Check the facade's health endpoint, and set LLM_URL if the facade is somewhere else.",
                config.url
            ),
        }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
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
        assert_eq!(config.url, "http://loom:8080/v1");
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

    mod wire {
        use super::super::{call_llm, LlmConfig};
        use serde_json::{json, Value};
        use std::time::Duration;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn config(server: &MockServer) -> LlmConfig {
            LlmConfig {
                url: format!("{}/v1", server.uri()),
                model: "loom".to_string(),
                timeout: Duration::from_secs(5),
            }
        }

        fn completion(content: &str) -> Value {
            json!({
                "choices": [{ "finish_reason": "stop", "message": { "content": content } }]
            })
        }

        #[tokio::test]
        async fn a_summary_declines_the_verbatim_short_circuit() {
            // Without this the facade can answer a page-summary request from
            // the ontology and never look at the page that was supplied.
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/v1/chat/completions"))
                .respond_with(ResponseTemplate::new(200).set_body_json(completion("a summary")))
                .mount(&server)
                .await;

            let out = call_llm(&config(&server), "summarise this page", 500).await;

            assert_eq!(out["success"], true);
            assert_eq!(out["content"], "a summary");
            let sent: Value = server.received_requests().await.unwrap()[0].body_json().unwrap();
            assert_eq!(sent["loom_options"], json!({ "verbatim": false }));
            assert_eq!(sent["max_tokens"], 1536, "a 500-token ask is floored");
        }

        #[tokio::test]
        async fn scaffold_retrieval_is_reported_as_a_failure() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(completion(
                    "Ontology page text; no model generation was performed.",
                )))
                .mount(&server)
                .await;

            let out = call_llm(&config(&server), "summarise", 500).await;

            assert_eq!(out["success"], false);
            assert!(
                out["error"].as_str().unwrap().contains("scaffold retrieval"),
                "error was {}",
                out["error"]
            );
        }

        #[tokio::test]
        async fn a_truncated_summary_is_retried_on_a_doubled_budget() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "choices": [{ "finish_reason": "length", "message": { "content": "" } }]
                })))
                .up_to_n_times(1)
                .with_priority(1)
                .mount(&server)
                .await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(completion("full summary")))
                .with_priority(2)
                .mount(&server)
                .await;

            let out = call_llm(&config(&server), "summarise", 2000).await;

            assert_eq!(out["content"], "full summary");
            let sent = server.received_requests().await.unwrap();
            let budget = |i: usize| sent[i].body_json::<Value>().unwrap()["max_tokens"].as_u64().unwrap();
            assert_eq!(budget(0), 2000);
            assert_eq!(budget(1), 4000);
        }
    }
}
