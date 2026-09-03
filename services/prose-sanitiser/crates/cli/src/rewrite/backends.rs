//! The HTTP rewrite backends.
//!
//! Redirects are refused outright: urllib's default handler re-sends request
//! headers on a 3xx, which would forward the Authorization header (the API key)
//! to an unvalidated host behind the loopback allowlist. Any 3xx therefore
//! surfaces as an error rather than a second request.

use std::time::Duration;

use serde_json::{json, Map, Value};

/// POST JSON, refusing redirects so an API key cannot be forwarded onward.
fn http_json(
    url: &str,
    payload: &Value,
    headers: &[(String, String)],
    timeout: f64,
) -> Result<Value, String> {
    let parsed = crate::audit::website::net::parse_url(url)
        .map_err(|error| format!("refusing non-http(s) rewrite endpoint: {url} ({error})"))?;
    if parsed.scheme != "http" && parsed.scheme != "https" {
        return Err(format!("refusing non-http(s) rewrite endpoint: {url}"));
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs_f64(timeout))
        // urllib's default handler re-sends headers on 3xx, which would forward
        // the Authorization header to an unvalidated host behind the loopback
        // allowlist. Any 3xx must surface as an error instead.
        .redirects(0)
        .build();
    let mut request = agent.post(url).set("Content-Type", "application/json");
    for (name, value) in headers {
        request = request.set(name, value);
    }
    match request.send_json(payload.clone()) {
        Ok(response) => response
            .into_json::<Value>()
            .map_err(|error| format!("bad JSON response: {error}")),
        Err(ureq::Error::Status(status, _)) => Err(format!("HTTP {status}")),
        Err(error) => Err(error.to_string()),
    }
}

/// Truncate a debug rendering the way Python's `f"...{data!r}"[:500]` did.
fn clip_repr(value: &Value) -> String {
    value.to_string().chars().take(500).collect()
}

/// Call an Ollama `/api/chat` endpoint.
pub fn call_ollama(
    base_url: &str,
    model: &str,
    prompt: &str,
    timeout: f64,
    temperature: f64,
) -> Result<String, String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let data = http_json(
        &url,
        &json!({
            "model": model,
            "stream": false,
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": temperature},
        }),
        &[],
        timeout,
    )?;
    let content = data
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("ollama empty response: {}", clip_repr(&data)))?;
    Ok(content.trim().to_string())
}

/// Call an OpenAI-compatible `/v1/chat/completions` endpoint.
#[allow(clippy::too_many_arguments)]
pub fn call_openai_compatible(
    base_url: &str,
    model: &str,
    prompt: &str,
    api_key: Option<&str>,
    timeout: f64,
    temperature: f64,
    reasoning_effort: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let mut headers = Vec::new();
    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        headers.push(("Authorization".to_string(), format!("Bearer {key}")));
    }
    let mut payload = Map::new();
    payload.insert("model".into(), json!(model));
    payload.insert(
        "messages".into(),
        json!([{"role": "user", "content": prompt}]),
    );
    payload.insert("temperature".into(), json!(temperature));
    if let Some(effort) = reasoning_effort {
        payload.insert("reasoning_effort".into(), json!(effort));
    }

    let data = http_json(&url, &Value::Object(payload), &headers, timeout)?;
    let choices = data
        .get("choices")
        .and_then(Value::as_array)
        .filter(|choices| !choices.is_empty())
        .ok_or_else(|| format!("openai-compatible empty choices: {}", clip_repr(&data)))?;
    let content = choices[0]
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("openai-compatible empty content: {}", clip_repr(&data)))?;
    Ok(content.trim().to_string())
}
