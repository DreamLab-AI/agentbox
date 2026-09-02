//! Loom client for dossier drafting — port of `DOSSIER_SYSTEM_PROMPT`,
//! `build_dossier_prompt`, `call_loom`, `check_loom_reachable`,
//! `DraftResult`, and `assemble_draft` from `promote.py`.

use super::ledger_parse::Assertion;
use super::splice::{apply_splice, clean_loom_response, extract_splice_json};
use crate::common::http::client;
use serde_json::{json, Value};

pub const DOSSIER_SYSTEM_PROMPT: &str =
    "You are a knowledge-base editing assistant integrating verified podcast \
evidence into an existing wiki page. Return ONLY a strict JSON object \
of the shape {\"mode\": \"insert_after\"|\"replace_section\", \
\"anchor\": <verbatim substring of the CURRENT PAGE to anchor on>, \
\"content\": <the new/replacement markdown text>}. The anchor must \
appear EXACTLY ONCE, character-for-character, in the current page. \
Do not rewrite or reformat any text outside your inserted/replaced \
content. No markdown fencing, no commentary — JSON only.";

/// Port of `build_dossier_prompt`.
pub fn build_dossier_prompt(topic: &str, page_text: &str, assertions: &[Assertion]) -> String {
    let facts: Vec<String> = assertions
        .iter()
        .map(|a| {
            let mut line = format!("- {}", a.claim);
            if !a.evidence.is_empty() && a.evidence != a.claim {
                line.push_str(&format!(" ({})", a.evidence));
            }
            line.push_str(&format!(
                " [source: {}, confidence {}, tier {}]",
                a.source, a.confidence, a.tier
            ));
            line
        })
        .collect();
    let facts_block = facts.join("\n");

    format!(
        "Page topic: {topic}\n\
\n\
=== CURRENT PAGE ===\n\
{page_text}\n\
=== END CURRENT PAGE ===\n\
\n\
New verified evidence to integrate, drawn from podcast-evidence ledger pages\n\
(each already fingerprinted and source-attributed):\n\
{facts_block}\n\
\n\
Produce a JSON splice edit that integrates this evidence into the page as a\n\
new or extended section (e.g. \"### Recent Developments\" or an existing\n\
comparable heading). Preserve everything else on the page unchanged. Pick an\n\
anchor that is unambiguous (appears exactly once) in CURRENT PAGE.\n"
    )
}

/// Port of `call_loom` (promote.py's version — `urllib.request`-based in
/// Python; ported to `reqwest`, matching the same request shape).
pub async fn call_loom(
    prompt: &str,
    loom_url: &str,
    model: &str,
    timeout_secs: u64,
    max_tokens: u64,
) -> Option<String> {
    let body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": DOSSIER_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "loom_options": {"verbatim": false},
    });

    let url = format!("{}/chat/completions", loom_url.trim_end_matches('/'));
    let result = client()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .send()
        .await;

    match result {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(v) => v
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    eprintln!(
                        "    [loom] error: malformed response (missing choices[0].message.content)"
                    );
                    None
                }),
            Err(e) => {
                eprintln!("    [loom] error: {e}");
                None
            }
        },
        Err(e) => {
            eprintln!("    [loom] error: {e}");
            None
        }
    }
}

/// Port of `check_loom_reachable`.
pub async fn check_loom_reachable(loom_url: &str, timeout_secs: u64) -> bool {
    let mut health_url = loom_url.trim_end_matches('/').to_string();
    if let Some(stripped) = health_url.strip_suffix("/v1") {
        health_url = stripped.to_string();
    }
    health_url.push_str("/health");

    let result = client()
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .send()
        .await;

    match result {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(body) => body.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            Err(e) => {
                eprintln!("  [loom] health check failed at {health_url}: {e}");
                false
            }
        },
        Err(e) => {
            eprintln!("  [loom] health check failed at {health_url}: {e}");
            false
        }
    }
}

#[derive(Debug, Clone)]
pub struct DraftResult {
    pub ok: bool,
    pub spliced_text: Option<String>,
    pub edit: Option<Value>,
    pub error: Option<String>,
}

/// Port of `assemble_draft`.
pub async fn assemble_draft(
    topic: &str,
    page_text: &str,
    assertions: &[Assertion],
    loom_url: &str,
    loom_model: &str,
) -> DraftResult {
    let prompt = build_dossier_prompt(topic, page_text, assertions);
    let raw = match call_loom(&prompt, loom_url, loom_model, 300, 4096).await {
        Some(r) => r,
        None => {
            return DraftResult {
                ok: false,
                spliced_text: None,
                edit: None,
                error: Some("loom_unreachable_or_error".to_string()),
            }
        }
    };

    let cleaned = clean_loom_response(&raw);
    let edit = match extract_splice_json(&cleaned) {
        Some(e) => e,
        None => {
            let truncated: String = cleaned.chars().take(300).collect();
            return DraftResult {
                ok: false,
                spliced_text: None,
                edit: None,
                error: Some(format!("malformed_splice_json: {truncated:?}")),
            };
        }
    };

    match apply_splice(page_text, &edit) {
        Ok(spliced) => DraftResult {
            ok: true,
            spliced_text: Some(spliced),
            edit: Some(edit),
            error: None,
        },
        Err(e) => DraftResult {
            ok: false,
            spliced_text: None,
            edit: None,
            error: Some(format!("splice_validation_failed: {e}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dossier_prompt_includes_topic_and_facts() {
        let assertions = vec![Assertion {
            claim: "A claim.".to_string(),
            topics: vec!["Topic".to_string()],
            tier: "1".to_string(),
            confidence: "0.9".to_string(),
            source: "Host".to_string(),
            fp: "abc".to_string(),
            episode_slug: "ep1".to_string(),
            ledger_file: "podcast-evidence___ep1.md".to_string(),
            claim_date: "2026-01-01".to_string(),
            evidence: String::new(),
        }];
        let prompt = build_dossier_prompt("Topic", "page body", &assertions);
        assert!(prompt.contains("Page topic: Topic"));
        assert!(prompt.contains("=== CURRENT PAGE ===\npage body\n=== END CURRENT PAGE ==="));
        assert!(prompt.contains("- A claim. [source: Host, confidence 0.9, tier 1]"));
    }
}
