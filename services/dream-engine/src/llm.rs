use loom_client::{ChatRequest, LoomClient, LoomOptions, Message};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("empty response from LLM")]
    EmptyResponse,
    #[error("missing credentials: {0}")]
    MissingCredentials(String),
    /// A façade call that the client refused to treat as an answer — scaffold
    /// retrieval served instead of generation, exhausted truncation retries, or
    /// grounding applied where passthrough was asked for.
    #[error("Loom: {0}")]
    Loom(#[from] loom_client::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Zai,
    Loom,
}

impl Provider {
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "loom" => Self::Loom,
            _ => Self::Zai,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub provider: Provider,
    pub url: String,
    pub model: String,
    pub max_tokens: u32,
    pub api_key: Option<String>,
}

pub async fn call(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    match cfg.provider {
        // `loom-client` owns the Loom path's retries: three attempts, the same
        // 20s apart, plus a doubling retry on truncation that this wrapper
        // could not have done (it cannot see finish_reason).
        Provider::Loom => call_loom(cfg, prompt).await,
        // One retry after a short backoff on transient failures (gateway 5xx
        // like Cloudflare 524, transport errors, empty bodies). A single retry
        // is cheap; hard API errors (4xx) are not retried.
        Provider::Zai => match call_zai(cfg, prompt).await {
            Err(ref e) if is_transient(e) => {
                tracing::warn!(error = %e, "transient LLM failure — retrying once in 20s");
                tokio::time::sleep(Duration::from_secs(20)).await;
                call_zai(cfg, prompt).await
            }
            other => other,
        },
    }
}

fn is_transient(e: &LlmError) -> bool {
    match e {
        LlmError::Request(_) | LlmError::EmptyResponse => true,
        LlmError::Api(msg) => {
            // HTTP 5xx (incl. Cloudflare 52x) are worth one retry; 4xx are not.
            msg.contains("HTTP 5")
        }
        // The client already retried these to its own ceiling; a further
        // retry here would just multiply the wait.
        LlmError::Loom(_) | LlmError::MissingCredentials(_) => false,
    }
}

// --- Z.AI (Anthropic Messages API format) ---

#[derive(Serialize)]
struct ZaiRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ZaiMessage>,
}

#[derive(Serialize)]
struct ZaiMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ZaiResponse {
    content: Option<Vec<ZaiContent>>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ZaiContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
    thinking: Option<String>,
}

/// Request timeout for a Z.AI call, scaled to its token budget. GLM-5.3 runs at
/// its maximum reasoning effort whenever a request names no effort, and at max
/// effort a hard prompt can spend most of a 128K budget on thinking. The
/// slowest 5.3 tier streams about 50 tokens/s, so a fixed 600 s would cut a
/// long answer off and waste the whole call. Never below the old 600 s.
pub(crate) fn zai_timeout(max_tokens: u32) -> Duration {
    Duration::from_secs((u64::from(max_tokens) / 50 + 120).max(600))
}

async fn call_zai(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    let api_key = cfg
        .api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| LlmError::MissingCredentials("ZAI_ANTHROPIC_API_KEY".into()))?;

    let client = Client::builder()
        .timeout(zai_timeout(cfg.max_tokens))
        .build()?;

    let body = ZaiRequest {
        model: cfg.model.clone(),
        max_tokens: cfg.max_tokens,
        messages: vec![ZaiMessage {
            role: "user".into(),
            content: prompt.into(),
        }],
    };

    let resp = client
        .post(format!("{}/v1/messages", cfg.url))
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let text = resp.text().await?;
    info!(bytes = text.len(), http_status = %status, "ZAI response received");

    if !status.is_success() {
        return Err(LlmError::Api(format!(
            "HTTP {}: {}",
            status,
            &text[..text.len().min(500)]
        )));
    }

    let parsed: ZaiResponse = serde_json::from_str(&text)
        .map_err(|e| LlmError::Api(format!("JSON parse error ({}B): {}", text.len(), e)))?;

    if let Some(err) = parsed.error {
        return Err(LlmError::Api(format!("API error: {}", err)));
    }

    let content = parsed.content.ok_or(LlmError::EmptyResponse)?;

    if let Some(thinking) = content.iter().find(|c| c.content_type == "thinking") {
        if let Some(ref t) = thinking.thinking {
            info!(reasoning_chars = t.len(), "LLM reasoning block");
        }
    }

    let text_parts: Vec<&str> = content
        .iter()
        .filter(|c| c.content_type == "text")
        .filter_map(|c| c.text.as_deref())
        .collect();

    if text_parts.is_empty() {
        return Err(LlmError::EmptyResponse);
    }

    Ok(text_parts.join("\n"))
}

// --- Loom (façade client) ---

/// Talk to the Ontology Loom façade through `loom-client`.
///
/// The hand-rolled version of this lived here for months and learned one
/// lesson the hard way: a façade in verbatim mode answers 200 with ontology
/// prose and never calls the model, and two nights of verdicts were derived
/// from that text before anyone noticed (2026-09-01). The crate encodes that
/// as `Error::ScaffoldOnly`, alongside two more it did not know about —
/// truncation on a reasoning model returns EMPTY content, and a budget below
/// ~1536 tokens triggers it — so this path now gets a token floor and a
/// doubling retry it never had.
///
/// Retries live in the client (three attempts, 20s apart to match what the
/// Z.AI path does for gateway 52x), which is why `call` does not wrap this
/// one in its own retry.
async fn call_loom(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    let client = LoomClient::builder(&cfg.url)
        .timeout(Duration::from_secs(600))
        .retry_backoff(Duration::from_secs(20))
        .build();

    let answer = client
        .chat(
            ChatRequest::new(&cfg.model, vec![Message::user(prompt)])
                .temperature(1.0)
                .top_p(0.95)
                .top_k(20)
                .max_tokens(u64::from(cfg.max_tokens))
                // Dream prompts are generative and their subject IS in the
                // ontology: keep the scaffold, refuse a retrieval-only serve.
                .options(LoomOptions::declining_verbatim()),
        )
        .await?;

    if let Some(reasoning) = &answer.reasoning {
        info!(reasoning_chars = reasoning.len(), "Loom reasoning block");
    }
    info!(
        bytes = answer.content.len(),
        served_mode = %answer.served_mode,
        attempts = answer.attempts,
        "Loom response received"
    );

    Ok(answer.content)
}

// --- dream-core seam ---

use dream_core::seams::{BoxFut, Llm, LlmError as SeamError, LlmRequest};
use dream_gate::manifest::ModelIdentity;

/// An [`LlmConfig`] as a `dream_core` language model (Z.AI or the Loom).
///
/// The request's `max_tokens` is honoured (planner calls clamp it); its
/// `temperature` is not: the Loom path pins its own sampling parameters and
/// the Z.AI path takes the provider default, as before the extraction.
#[derive(Debug, Clone)]
pub struct LlmAdapter {
    cfg: LlmConfig,
}

impl LlmAdapter {
    /// Wrap `cfg`.
    pub fn new(cfg: LlmConfig) -> Self {
        Self { cfg }
    }

    /// The wrapped config.
    pub fn config(&self) -> &LlmConfig {
        &self.cfg
    }
}

impl From<LlmError> for SeamError {
    fn from(e: LlmError) -> Self {
        match e {
            LlmError::Request(e) => SeamError::Transport(e.to_string()),
            LlmError::Api(m) => SeamError::Api(m),
            LlmError::EmptyResponse => SeamError::Empty,
            LlmError::MissingCredentials(m) => SeamError::MissingCredentials(m),
            // The client already retried to its own ceiling; not transient.
            LlmError::Loom(e) => SeamError::Api(format!("Loom: {e}")),
        }
    }
}

impl Llm for LlmAdapter {
    fn complete<'a>(&'a self, req: &'a LlmRequest) -> BoxFut<'a, Result<String, SeamError>> {
        Box::pin(async move {
            let mut cfg = self.cfg.clone();
            cfg.max_tokens = req.max_tokens;
            call(&cfg, &req.prompt).await.map_err(SeamError::from)
        })
    }

    fn identity(&self) -> ModelIdentity {
        ModelIdentity {
            provider: format!("{:?}", self.cfg.provider).to_lowercase(),
            model: self.cfg.model.clone(),
            max_tokens: self.cfg.max_tokens,
            fallback: None,
        }
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;

    fn cfg(provider: Provider) -> LlmConfig {
        LlmConfig {
            provider,
            url: "http://127.0.0.1:9".into(),
            model: "glm-test".into(),
            max_tokens: 4096,
            api_key: None,
        }
    }

    #[test]
    fn identity_is_the_frozen_manifest_shape() {
        let id = LlmAdapter::new(cfg(Provider::Zai)).identity();
        assert_eq!(id.provider, "zai");
        assert_eq!(id.model, "glm-test");
        assert_eq!(id.max_tokens, 4096);
        assert!(id.fallback.is_none());
        assert_eq!(
            LlmAdapter::new(cfg(Provider::Loom)).identity().provider,
            "loom"
        );
    }

    #[test]
    fn errors_map_onto_the_seam_vocabulary() {
        assert_eq!(SeamError::from(LlmError::EmptyResponse), SeamError::Empty);
        assert_eq!(
            SeamError::from(LlmError::Api("HTTP 524: x".into())),
            SeamError::Api("HTTP 524: x".into())
        );
        assert!(SeamError::from(LlmError::Api("HTTP 524: x".into())).is_transient());
        assert!(!SeamError::from(LlmError::MissingCredentials("k".into())).is_transient());
    }

    /// No key is a credentials error through the seam, with no network call.
    #[tokio::test]
    async fn a_zai_adapter_without_a_key_reports_missing_credentials() {
        let a = LlmAdapter::new(cfg(Provider::Zai));
        let req = LlmRequest::new("hi", 256);
        let r = a.complete(&req).await;
        assert!(matches!(r, Err(SeamError::MissingCredentials(_))), "{r:?}");
    }
}

#[cfg(test)]
mod timeout_tests {
    #[test]
    fn zai_timeout_scales_with_the_token_budget() {
        assert_eq!(super::zai_timeout(32_768).as_secs(), 775);
        assert_eq!(super::zai_timeout(131_072).as_secs(), 2741);
        assert_eq!(super::zai_timeout(1_000).as_secs(), 600);
    }
}
