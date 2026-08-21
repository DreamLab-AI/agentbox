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
    // One retry after a short backoff on transient failures (gateway 5xx like
    // Cloudflare 524, transport errors, empty bodies). A single retry saved
    // nights are cheap; hard API errors (4xx) are not retried.
    let first = dispatch_call(cfg, prompt).await;
    match first {
        Err(ref e) if is_transient(e) => {
            tracing::warn!(error = %e, "transient LLM failure — retrying once in 20s");
            tokio::time::sleep(Duration::from_secs(20)).await;
            dispatch_call(cfg, prompt).await
        }
        other => other,
    }
}

async fn dispatch_call(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    match cfg.provider {
        Provider::Zai => call_zai(cfg, prompt).await,
        Provider::Loom => call_loom(cfg, prompt).await,
    }
}

fn is_transient(e: &LlmError) -> bool {
    match e {
        LlmError::Request(_) | LlmError::EmptyResponse => true,
        LlmError::Api(msg) => {
            // HTTP 5xx (incl. Cloudflare 52x) are worth one retry; 4xx are not.
            msg.contains("HTTP 5")
        }
        LlmError::MissingCredentials(_) => false,
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

// --- Loom (OpenAI chat completions format) ---

#[derive(Serialize)]
struct LoomRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<LoomMessage>,
    temperature: f32,
    top_p: f32,
    top_k: u32,
}

#[derive(Serialize)]
struct LoomMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct LoomResponse {
    choices: Option<Vec<LoomChoice>>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct LoomChoice {
    message: LoomChoiceMessage,
}

#[derive(Deserialize)]
struct LoomChoiceMessage {
    content: Option<String>,
    reasoning_content: Option<String>,
}

async fn call_loom(cfg: &LlmConfig, prompt: &str) -> Result<String, LlmError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(600))
        .build()?;

    let body = LoomRequest {
        model: cfg.model.clone(),
        max_tokens: cfg.max_tokens,
        messages: vec![LoomMessage {
            role: "user".into(),
            content: prompt.into(),
        }],
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
    };

    let resp = client
        .post(format!("{}/chat/completions", cfg.url))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let text = resp.text().await?;
    info!(bytes = text.len(), http_status = %status, "Loom response received");

    if !status.is_success() {
        return Err(LlmError::Api(format!(
            "HTTP {}: {}",
            status,
            &text[..text.len().min(500)]
        )));
    }

    let parsed: LoomResponse = serde_json::from_str(&text)
        .map_err(|e| LlmError::Api(format!("JSON parse error: {}", e)))?;

    if let Some(err) = parsed.error {
        return Err(LlmError::Api(format!("API error: {}", err)));
    }

    let choices = parsed.choices.ok_or(LlmError::EmptyResponse)?;
    let first = choices.into_iter().next().ok_or(LlmError::EmptyResponse)?;

    if let Some(ref reasoning) = first.message.reasoning_content {
        info!(reasoning_chars = reasoning.len(), "Loom reasoning block");
    }

    first.message.content.ok_or(LlmError::EmptyResponse)
}
