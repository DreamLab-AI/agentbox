//! Ontology Loom client for the extraction phase — port of `resolve_loom_url`
//! and `call_loom` in `ingest.py`.

use crate::common::http::client;
use serde_json::json;
use std::sync::OnceLock;
use tokio::sync::Mutex;

static RESOLVED_LOOM_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn resolved_cell() -> &'static Mutex<Option<String>> {
    RESOLVED_LOOM_URL.get_or_init(|| Mutex::new(None))
}

/// `url.rsplit("/v1", 1)[0]` — the base URL with a trailing `/v1` (the last
/// occurrence of the substring) stripped, or the original string unchanged
/// if `/v1` does not appear.
fn strip_v1_suffix(url: &str) -> String {
    match url.rfind("/v1") {
        Some(idx) => url[..idx].to_string(),
        None => url.to_string(),
    }
}

/// Pick the first reachable Loom façade, once per process. Mirrors
/// `resolve_loom_url`'s module-level memoisation (`_RESOLVED_LOOM_URL`).
///
/// The LAN address (via machinelearn's hp-nat DNAT) is canonical; the 25G
/// rail address reaches HP directly when the DNAT is down. Both serve the
/// same façade on `:8084`.
pub async fn resolve_loom_url(loom_url: &str, loom_fallback_urls: &[String]) -> String {
    {
        let cached = resolved_cell().lock().await;
        if let Some(url) = cached.as_ref() {
            return url.clone();
        }
    }

    let mut candidates: Vec<String> = vec![loom_url.to_string()];
    candidates.extend(loom_fallback_urls.iter().cloned());

    for (i, url) in candidates.iter().enumerate() {
        let base = strip_v1_suffix(url);
        let health_url = format!("{base}/health");
        let resp = client()
            .get(&health_url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
        if let Ok(resp) = resp {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                        if i != 0 {
                            println!("  Loom primary unreachable, using fallback: {url}");
                        }
                        let mut cached = resolved_cell().lock().await;
                        *cached = Some(url.clone());
                        return url.clone();
                    }
                }
            }
        }
    }

    let fallback = candidates[0].clone();
    let mut cached = resolved_cell().lock().await;
    *cached = Some(fallback.clone());
    fallback
}

/// Python:
/// ```python
/// def call_loom(prompt: str, loom_url: str, model: str) -> str | None:
///     ...
///     resp = requests.post(f"{loom_url}/chat/completions", json={...}, timeout=600)
///     resp.raise_for_status()
///     return resp.json()["choices"][0]["message"]["content"]
/// ```
pub async fn call_loom(prompt: &str, loom_url: &str, model: &str) -> Option<String> {
    let body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a knowledge extraction assistant. Return ONLY valid JSON. No markdown fencing, no thinking tags."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        // Qwen3.8's reasoning tokens count against max_tokens; 4096
        // truncated real extractions mid-array (finish_reason=length).
        "max_tokens": 12288,
        // Scaffold injection ON (default budget): grounded extraction
        // resolves far more ontology_terms to existing KG pages than raw
        // generation. verbatim:false blocks the Loom's retrieval
        // short-circuit.
        "loom_options": {"verbatim": false},
    });

    let result = client()
        .post(format!("{loom_url}/chat/completions"))
        .json(&body)
        // Qwen3.8-27B reasoning over a full episode transcript regularly
        // exceeds 3 minutes; 180s was producing spurious read timeouts.
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await;

    match result {
        Ok(resp) => match resp.error_for_status() {
            Ok(resp) => match resp.json::<serde_json::Value>().await {
                Ok(v) => v
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string()),
                Err(e) => {
                    println!("  Loom error: {e}");
                    None
                }
            },
            Err(e) => {
                println!("  Loom error: {e}");
                None
            }
        },
        Err(e) => {
            println!("  Loom error: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_trailing_v1() {
        assert_eq!(
            strip_v1_suffix("http://192.168.2.132:8084/v1"),
            "http://192.168.2.132:8084"
        );
    }

    #[test]
    fn leaves_url_without_v1_unchanged() {
        assert_eq!(strip_v1_suffix("http://example.com"), "http://example.com");
    }
}
