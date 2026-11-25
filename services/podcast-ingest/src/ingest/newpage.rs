//! New-page proposal — port of `NEW_PAGE_TEMPLATE`, `PAGE_WORTHINESS_PROMPT`,
//! and `_propose_new_pages` from `ingest.py`. Runs against unresolved-topic
//! assertions (zero resolved `ontology_terms`) that still landed on the
//! episode ledger, asking the Loom to judge which topics deserve a brand
//! new ontology page.

use super::config::Settings;
use super::ledger::tier_label;
use super::loom::{call_loom, resolve_loom_url};
use super::pyval::{get_str, get_str_vec, get_tier, Assertion};
use crate::common::state::{CreatedPageRecord, IngestState};
use crate::common::{slugify_default, to_json_pretty_ascii};
use regex::Regex;
use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;

fn re_think_tags() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<think>.*?</think>").unwrap())
}
fn re_json_array() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)\[.*\]").unwrap())
}
fn re_trailing_comma_array() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r",\s*\]").unwrap())
}
fn re_trailing_comma_obj() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r",\s*\}").unwrap())
}

const PAGE_WORTHINESS_PROMPT_HEAD: &str =
    "Given these unmatched assertions from a podcast, group them by
topic and for each proposed new ontology page return:
{\"title\": \"...\", \"slug\": \"...\", \"definition\": \"one-sentence definition\",
  \"domain\": \"governance|artificial-intelligence|infrastructure|economics|security\",
  \"parent_label\": \"nearest existing ontology parent concept\",
  \"parent_slug\": \"slug of parent\",
  \"related_terms\": [\"existing ontology pages this relates to\"],
  \"worth_adding\": true/false,
  \"reason\": \"why this topic deserves a page (or why not)\"}

Only set worth_adding=true if the topic is:
- A distinct concept (not just a news event)
- Likely to recur and accumulate more knowledge over time
- Not already covered by a broader existing page

Return a JSON array. Unmatched assertions:
";

/// The body and header of a proposed page, as Obsidian markdown: headings,
/// not outline bullets, and no `json-ld` fences (both fail `ontomark
/// validate` / `repair bodies --check`; the page's identity and edges come from
/// its frontmatter and wikilinks).
fn new_page_content(
    title: &str,
    definition: &str,
    parent_label: &str,
    related: &[String],
    date: &str,
    episode_source: &str,
    evidence_block: &str,
) -> String {
    let mut relationships = vec![format!("- Parent: [[{parent_label}]]")];
    relationships.extend(related.iter().map(|t| format!("- Related: [[{t}]]")));
    format!(
        "---\n\
type: Draft Concept\n\
title: {title}\n\
public: false\n\
status: draft\n\
generated:\n\
\x20 by: process:podcast-ingest/{version}\n\
\x20 at: {date}\n\
---\n\
\n\
# {title}\n\
\n\
{definition}\n\
\n\
## Overview\n\
\n\
{evidence_block}\n\
\n\
## Relationships\n\
\n\
{relationships}\n\
\n\
## Provenance\n\
\n\
- Episode: {episode_source}\n",
        version = env!("CARGO_PKG_VERSION"),
        relationships = relationships.join("\n")
    )
}

/// Port of `_propose_new_pages`.
///
/// A proposed page is a working-graph draft: it is written under `working_dir`
/// as a non-public `Draft Concept`, never into the curated corpus. `pages_dir`
/// is only consulted so a topic the curated corpus already has is not proposed
/// again.
pub async fn propose_new_pages(
    unmatched: &[Assertion],
    pages_dir: Option<&Path>,
    working_dir: &Path,
    settings: &Settings,
    state: &mut IngestState,
    today: &str,
) {
    println!(
        "\n  Assessing {} unmatched assertions for new page proposals...",
        unmatched.len()
    );

    let assertions_json_input: Vec<Value> = unmatched
        .iter()
        .map(|a| {
            serde_json::json!({
                "claim": get_str(a, "claim", ""),
                "tier": get_tier(a, "tier", 1),
                "source": get_str(a, "source", ""),
                "ontology_terms": get_str_vec(a, "ontology_terms"),
            })
        })
        .collect();
    let assertions_json =
        to_json_pretty_ascii(&assertions_json_input).unwrap_or_else(|_| "[]".to_string());
    let prompt = format!("{PAGE_WORTHINESS_PROMPT_HEAD}{assertions_json}");

    let loom_url = resolve_loom_url(&settings.loom_url, &settings.loom_fallback_urls).await;
    let response = match call_loom(&prompt, &loom_url, &settings.loom_model).await {
        Some(r) => r,
        None => {
            println!("  Loom unavailable for page proposals, skipping.");
            return;
        }
    };

    let response = re_think_tags()
        .replace_all(&response, "")
        .trim()
        .to_string();
    let arr_text = match re_json_array().find(&response) {
        Some(m) => m.as_str().to_string(),
        None => {
            println!("  Could not parse page proposals from Loom response.");
            return;
        }
    };
    let raw = re_trailing_comma_array()
        .replace_all(&arr_text, "]")
        .to_string();
    let raw = re_trailing_comma_obj().replace_all(&raw, "}").to_string();

    let proposals: Vec<Value> = match serde_json::from_str(&raw) {
        Ok(Value::Array(arr)) => arr,
        _ => {
            println!("  JSON parse error in page proposals.");
            return;
        }
    };

    let mut created = 0usize;
    for prop in &proposals {
        let worth_adding = prop
            .get("worth_adding")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !worth_adding {
            let title_disp = prop.get("title").and_then(|v| v.as_str()).unwrap_or("?");
            let reason = prop
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("not worth adding");
            println!("    SKIP: {title_disp} — {reason}");
            continue;
        }

        let title = match prop.get("title").and_then(|v| v.as_str()) {
            Some(t) => t.to_string(),
            None => continue,
        };
        let slug = prop
            .get("slug")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| slugify_default(&title));
        let page_path = working_dir.join(format!("{title}.md"));

        if page_path.exists() || pages_dir.is_some_and(|d| d.join(format!("{title}.md")).exists()) {
            println!("    EXISTS: {title}");
            continue;
        }

        let title_lower = title.to_lowercase();
        let mut page_assertions: Vec<&Assertion> = unmatched
            .iter()
            .filter(|a| {
                get_str_vec(a, "ontology_terms").iter().any(|t| {
                    let tl = t.to_lowercase();
                    tl.contains(&title_lower) || title_lower.contains(&tl)
                })
            })
            .collect();
        if page_assertions.is_empty() {
            if let Some(first) = unmatched.first() {
                page_assertions = vec![first];
            }
        }

        let mut evidence_lines: Vec<String> = Vec::new();
        for a in &page_assertions {
            let tier = get_tier(a, "tier", 1);
            let label = tier_label(tier);
            let prefix = if !label.is_empty() {
                format!("**[{label}]** ")
            } else {
                String::new()
            };
            let claim = get_str(a, "claim", "");
            let source = get_str(a, "source", "unknown");
            evidence_lines.push(format!(
                "- {prefix}{claim} *(Source: {source}, via AI Daily Brief, {today})*"
            ));
        }

        let related: Vec<String> = prop
            .get("related_terms")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .take(5)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let definition = prop
            .get("definition")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{title} as discussed in AI industry analysis."));
        let parent_label = prop
            .get("parent_label")
            .and_then(|v| v.as_str())
            .unwrap_or("Artificial Intelligence");
        let episode_source = page_assertions
            .first()
            .map(|a| get_str(a, "_source_file", "unknown"))
            .unwrap_or_else(|| "unknown".to_string());

        let page_content = new_page_content(
            &title,
            &definition,
            parent_label,
            &related,
            today,
            &episode_source,
            &evidence_lines.join("\n"),
        );

        let _ = std::fs::write(&page_path, page_content);
        created += 1;
        state.created_pages.push(CreatedPageRecord {
            page: title.clone(),
            slug: slug.clone(),
            date: today.to_string(),
            assertions: page_assertions.len(),
        });
        let file_name = page_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        println!(
            "    CREATED: {file_name} ({} assertions)",
            page_assertions.len()
        );
    }

    println!("  New pages created: {created}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_page_content_is_obsidian_markdown_that_passes_validation() {
        let content = new_page_content(
            "Foo Bar",
            "A definition.",
            "Artificial Intelligence",
            &["Baz".to_string()],
            "2026-01-01",
            "ep.md",
            "- a claim",
        );
        assert!(content.starts_with(
            "---\ntype: Draft Concept\ntitle: Foo Bar\npublic: false\nstatus: draft\n"
        ));
        assert!(content.contains("\n  at: 2026-01-01\n---\n\n# Foo Bar\n"));
        assert!(!content.contains("public: true"));
        // `ontomark validate` rejects json-ld fences; `repair bodies --check`
        // rejects heading bullets.
        assert!(!content.contains("```"), "{content}");
        assert!(
            !content.lines().any(|l| l.trim_start().starts_with("- #")),
            "{content}"
        );
        assert!(content.contains("\n## Overview\n\n- a claim\n\n## Relationships\n\n- Parent: [[Artificial Intelligence]]\n- Related: [[Baz]]\n\n## Provenance\n\n- Episode: ep.md\n"));
    }
}
