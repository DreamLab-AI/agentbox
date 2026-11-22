//! Loom client for dossier drafting — port of `DOSSIER_SYSTEM_PROMPT`,
//! `build_dossier_prompt`, `call_loom`, `check_loom_reachable`,
//! `DraftResult`, and `assemble_draft` from `promote.py`.

use super::ledger_parse::Assertion;
use super::splice::{apply_splice, clean_loom_response, extract_splice_json, split_frontmatter};
use crate::common::http::client;
use loom_client::{ChatRequest, LoomClient, LoomOptions, Message};
use serde_json::Value;
use std::time::Duration;

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
Produce a JSON splice edit that integrates this evidence into the page.\n\
\n\
Rules:\n\
- Use only the evidence that is about the page topic itself. Leave out items\n\
  that merely mention it, and state each fact once.\n\
- If the page already has a section for recent developments, extend it with\n\
  mode \"replace_section\", anchored on that section's heading line, and keep\n\
  its existing text. Otherwise add one new section headed\n\
  \"## Recent Developments\" with mode \"insert_after\", anchored on the heading\n\
  line of the section it should follow.\n\
- Write the section as the page writes its own: a heading line, then either\n\
  short paragraphs or \"- \" bullets, one fact per bullet, each naming its\n\
  source. No indented lines, no nested lists.\n\
- Preserve everything else on the page unchanged. The anchor must appear\n\
  exactly once in CURRENT PAGE.\n"
    )
}

/// Ask the façade for a splice edit, returning the raw assistant text.
///
/// `None` on any failure, logged: a dossier that cannot be drafted is a
/// skipped page, not a failed run.
pub async fn call_loom(
    prompt: &str,
    loom_url: &str,
    model: &str,
    timeout_secs: u64,
    max_tokens: u64,
) -> Option<String> {
    let client = LoomClient::builder(loom_url)
        .timeout(Duration::from_secs(timeout_secs))
        .http_client(client().clone())
        .build();

    let request = ChatRequest::new(
        model,
        vec![
            Message::system(DOSSIER_SYSTEM_PROMPT),
            Message::user(prompt),
        ],
    )
    .temperature(0.2)
    .max_tokens(max_tokens)
    // The page's subject is in the ontology: ground the edit, but never accept
    // retrieval in place of a drafted splice.
    .options(LoomOptions::declining_verbatim());

    match client.chat(request).await {
        Ok(answer) => Some(answer.content),
        Err(e) => {
            eprintln!("    [loom] error: {e}");
            None
        }
    }
}

/// Is the façade up? `GET {root}/health`, where the root is the base URL with
/// any trailing `/v1` removed.
pub async fn check_loom_reachable(loom_url: &str, timeout_secs: u64) -> bool {
    let client = LoomClient::builder(loom_url)
        .http_client(client().clone())
        .build();
    let up = client.healthy(Duration::from_secs(timeout_secs)).await;
    if !up {
        eprintln!("  [loom] health check failed at {}/health", client.root());
    }
    up
}

#[derive(Debug, Clone)]
pub struct DraftResult {
    pub ok: bool,
    pub spliced_text: Option<String>,
    pub edit: Option<Value>,
    pub error: Option<String>,
}

/// Port of `assemble_draft`, drafting against the page body only.
///
/// The YAML frontmatter is withheld from the model and re-attached unchanged,
/// so an edit can neither anchor on governed data nor alter it.
/// `spliced_text` is the whole proposed page, frontmatter included.
pub async fn assemble_draft(
    topic: &str,
    page_text: &str,
    assertions: &[Assertion],
    loom_url: &str,
    loom_model: &str,
) -> DraftResult {
    let (_, body) = split_frontmatter(page_text);
    let prompt = build_dossier_prompt(topic, body, assertions);
    match call_loom(&prompt, loom_url, loom_model, 300, 4096).await {
        Some(raw) => draft_from_response(page_text, &raw),
        None => DraftResult {
            ok: false,
            spliced_text: None,
            edit: None,
            error: Some("loom_unreachable_or_error".to_string()),
        },
    }
}

/// Turn the model's reply into a validated draft of `page_text`.
pub fn draft_from_response(page_text: &str, raw: &str) -> DraftResult {
    let (head, body) = split_frontmatter(page_text);
    let cleaned = clean_loom_response(raw);
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

    match apply_splice(body, &edit) {
        Ok(spliced) => DraftResult {
            ok: true,
            spliced_text: Some(format!("{head}{spliced}")),
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

    #[test]
    fn a_draft_is_spliced_into_the_body_and_keeps_the_frontmatter() {
        let page = "---\ntype: Class\ntitle: T\n---\n# T\n\n## Overview\nText.\n";
        let reply = r###"{"mode": "insert_after", "anchor": "Text.", "content": "## Recent Developments\nNew."}"###;
        let draft = draft_from_response(page, reply);
        assert!(draft.ok, "{:?}", draft.error);
        assert_eq!(
            draft.spliced_text.as_deref(),
            Some("---\ntype: Class\ntitle: T\n---\n# T\n\n## Overview\nText.\n\n## Recent Developments\nNew.\n")
        );
    }

    #[test]
    fn an_anchor_in_the_frontmatter_is_refused() {
        let page = "---\ntype: Class\ntitle: Unique Title\n---\n# T\n\nBody.\n";
        let reply =
            r###"{"mode": "insert_after", "anchor": "title: Unique Title", "content": "x"}"###;
        let draft = draft_from_response(page, reply);
        assert!(!draft.ok);
        assert!(draft.error.unwrap().contains("anchor not found"));
    }
}
