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

async fn call_zai(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    let api_key = cfg
        .api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| LlmError::MissingCredentials("ZAI_ANTHROPIC_API_KEY".into()))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(600))
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
