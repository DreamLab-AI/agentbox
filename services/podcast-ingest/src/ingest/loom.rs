//! Ontology Loom client for the extraction phase.
//!
//! The hand-rolled request this replaced worked, but it could not see the two
//! things `loom-client` checks: whether the façade actually called the model,
//! and whether the answer stopped at the token budget. Extraction is exactly
//! where both hurt — a truncated JSON array parses as nothing, and scaffold
//! prose parses as nothing while looking like a model that had no opinion.

use crate::common::http::client;
use loom_client::{ChatRequest, LoomClient, LoomOptions, Message};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex;

/// Qwen3.8's reasoning tokens count against `max_tokens`; 4096 truncated real
/// extractions mid-array.
const EXTRACTION_MAX_TOKENS: u64 = 12288;

/// Reasoning over a full episode transcript regularly exceeds three minutes;
/// 180s was producing spurious read timeouts.
const EXTRACTION_TIMEOUT: Duration = Duration::from_secs(600);

/// Health-probe timeout when choosing between façade addresses.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

static RESOLVED_LOOM_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn resolved_cell() -> &'static Mutex<Option<String>> {
    RESOLVED_LOOM_URL.get_or_init(|| Mutex::new(None))
}

/// A client for `loom_url`, sharing the process-wide connection pool.
fn loom(loom_url: &str, timeout: Duration) -> LoomClient {
    LoomClient::builder(loom_url)
        .timeout(timeout)
        .http_client(client().clone())
        .build()
}

/// Pick the first reachable Loom façade, once per process.
///
/// The LAN address (via the gateway host's NAT) is canonical; the direct rail
/// address reaches the connected node when the NAT is down. Both serve the same
/// façade. The crate does the probing; the memoisation stays here, because a
/// library holding process-global state is a library that surprises somebody.
pub async fn resolve_loom_url(loom_url: &str, loom_fallback_urls: &[String]) -> String {
    {
        let cached = resolved_cell().lock().await;
        if let Some(url) = cached.as_ref() {
            return url.clone();
        }
    }

    let mut candidates: Vec<String> = vec![loom_url.to_string()];
    candidates.extend(loom_fallback_urls.iter().cloned());

    let chosen = match loom_client::resolve_base(&candidates, PROBE_TIMEOUT).await {
        Some(url) => {
            if url != candidates[0] {
                println!("  Loom primary unreachable, using fallback: {url}");
            }
            url
        }
        // Nothing answered. Keep the primary so the caller's own error path
        // reports a refused request rather than an unset URL.
        None => candidates[0].clone(),
    };

    let mut cached = resolved_cell().lock().await;
    *cached = Some(chosen.clone());
    chosen
}

/// Ask the façade to extract knowledge from `prompt`, returning the raw
/// assistant text. `None` on any failure, logged — extraction is best-effort
/// per episode and one bad call must not stop the run.
pub async fn call_loom(prompt: &str, loom_url: &str, model: &str) -> Option<String> {
    let request = ChatRequest::new(
        model,
        vec![
            Message::system(
                "You are a knowledge extraction assistant. Return ONLY valid JSON. \
                 No markdown fencing, no thinking tags.",
            ),
            Message::user(prompt),
        ],
    )
    .temperature(0.2)
    .max_tokens(EXTRACTION_MAX_TOKENS)
    // Scaffold injection ON: grounded extraction resolves far more
    // ontology_terms to existing KG pages than raw generation does.
    // Declining verbatim blocks the retrieval short-circuit.
    .options(LoomOptions::declining_verbatim());

    match loom(loom_url, EXTRACTION_TIMEOUT).chat(request).await {
        Ok(answer) => Some(answer.content),
        Err(e) => {
            println!("  Loom error: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use loom_client::LoomClient;

    #[test]
    fn the_health_root_drops_a_trailing_v1() {
        // Regression: the test that stood here asserted the opposite of its own
        // name, and had been red on main. /health lives at the façade root, so
        // a base of `…/v1` must probe `…/health`.
        assert_eq!(LoomClient::new("http://loom:8080/v1").root(), "http://loom:8080");
    }

    #[test]
    fn a_base_without_v1_is_unchanged() {
        assert_eq!(LoomClient::new("http://example.com").root(), "http://example.com");
    }
}
