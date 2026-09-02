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

fn json_escape_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c if (c as u32) < 128 => out.push(c),
            c => {
                let cp = c as u32;
                if cp > 0xFFFF {
                    let v = cp - 0x10000;
                    let high = 0xD800 + (v >> 10);
                    let low = 0xDC00 + (v & 0x3FF);
                    out.push_str(&format!("\\u{high:04x}\\u{low:04x}"));
                } else {
                    out.push_str(&format!("\\u{cp:04x}"));
                }
            }
        }
    }
    out.push('"');
    out
}

/// `json.dumps(list_of_strings)` — compact, `', '`-separated (Python's
/// default separators when `indent` is not given).
fn json_string_array_compact(items: &[String]) -> String {
    let parts: Vec<String> = items.iter().map(|s| json_escape_string(s)).collect();
    format!("[{}]", parts.join(", "))
}

/// `json.dumps([{"@id": ..., "label": ...}, ...])` — compact.
fn json_related_array_compact(items: &[(String, String)]) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|(id, label)| {
            format!(
                "{{\"@id\": {}, \"label\": {}}}",
                json_escape_string(id),
                json_escape_string(label)
            )
        })
        .collect();
    format!("[{}]", parts.join(", "))
}

/// Port of `NEW_PAGE_TEMPLATE.format(...)`.
#[allow(clippy::too_many_arguments)]
fn new_page_content(
    title: &str,
    slug: &str,
    wikilinks_json: &str,
    definition: &str,
    domain: &str,
    parent_slug: &str,
    parent_label: &str,
    related_json: &str,
    date: &str,
    episode_source: &str,
    evidence_block: &str,
) -> String {
    format!(
        "---\n\
public: true\n\
---\n\
\n\
# {title}\n\
```json-ld\n\
{{\n\
  \"@context\": \"https://narrativegoldmine.com/context/v1.jsonld\",\n\
  \"@id\": \"urn:visionflow:page:{slug}\",\n\
  \"@type\": \"Page\",\n\
  \"vc:slug\": \"{slug}\",\n\
  \"title\": \"{title}\",\n\
  \"vc:public\": true,\n\
  \"vc:outboundWikilinks\": {wikilinks_json},\n\
  \"vc:schemaVersion\": 2\n\
}}\n\
```\n\
\n\
```json-ld\n\
{{\n\
  \"@context\": \"https://narrativegoldmine.com/ns/v2.jsonld\",\n\
  \"@id\": \"urn:ngm:class:{slug}\",\n\
  \"@type\": \"Class\",\n\
  \"label\": \"{title}\",\n\
  \"definition\": \"{definition}\",\n\
  \"domain\": \"{domain}\",\n\
  \"maturity\": \"draft\",\n\
  \"quality\": 0.35,\n\
  \"subClassOf\": [{{\"@id\": \"urn:ngm:class:{parent_slug}\", \"label\": \"{parent_label}\"}}],\n\
  \"relations\": {{\n\
    \"relatedTo\": {related_json}\n\
  }},\n\
  \"provenance\": {{\n\
    \"source\": \"podcast-knowledge-ingest\",\n\
    \"created\": \"{date}\",\n\
    \"episode\": \"{episode_source}\"\n\
  }}\n\
}}\n\
```\n\
\n\
- ### Overview\n\
{evidence_block}\n\
- ### Relationships\n\
- ### Provenance\n"
    )
}

/// Port of `_propose_new_pages`.
pub async fn propose_new_pages(
    unmatched: &[Assertion],
    ontology_dir: &Path,
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
        let page_path = ontology_dir.join(format!("{title}.md"));

        if page_path.exists() {
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
        let mut wikilinks: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
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
                "  - {prefix}{claim} *(Source: {source}, via AI Daily Brief, {today})*"
            ));
            for term in get_str_vec(a, "ontology_terms") {
                if term.to_lowercase() != title_lower {
                    wikilinks.insert(term);
                }
            }
        }

        let related: Vec<(String, String)> = prop
            .get("related_terms")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .take(5)
                    .map(|t| {
                        (
                            format!("urn:ngm:class:{}", slugify_default(t)),
                            t.to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let related_json = json_related_array_compact(&related);

        let wikilinks_list: Vec<String> = wikilinks.into_iter().take(8).collect();
        let wikilinks_json = json_string_array_compact(&wikilinks_list);

        let definition = prop
            .get("definition")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{title} as discussed in AI industry analysis."));
        let domain = prop
            .get("domain")
            .and_then(|v| v.as_str())
            .unwrap_or("artificial-intelligence");
        let parent_slug = prop
            .get("parent_slug")
            .and_then(|v| v.as_str())
            .unwrap_or("artificial-intelligence");
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
            &slug,
            &wikilinks_json,
            &definition,
            domain,
            parent_slug,
            parent_label,
            &related_json,
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
    fn compact_string_array_matches_python_separators() {
        let items = vec!["Foo".to_string(), "Bar Baz".to_string()];
        assert_eq!(json_string_array_compact(&items), "[\"Foo\", \"Bar Baz\"]");
    }

    #[test]
    fn compact_string_array_empty() {
        let items: Vec<String> = vec![];
        assert_eq!(json_string_array_compact(&items), "[]");
    }

    #[test]
    fn related_array_compact_shape() {
        let items = vec![("urn:ngm:class:foo".to_string(), "Foo".to_string())];
        assert_eq!(
            json_related_array_compact(&items),
            "[{\"@id\": \"urn:ngm:class:foo\", \"label\": \"Foo\"}]"
        );
    }

    #[test]
    fn new_page_content_has_expected_shape() {
        let content = new_page_content(
            "Foo Bar",
            "foo-bar",
            "[]",
            "A definition.",
            "artificial-intelligence",
            "artificial-intelligence",
            "Artificial Intelligence",
            "[]",
            "2026-01-01",
            "ep.md",
            "  - a claim",
        );
        assert!(content.starts_with("---\npublic: true\n---\n\n# Foo Bar\n"));
        assert!(content.contains("\"@id\": \"urn:visionflow:page:foo-bar\""));
        assert!(content
            .contains("- ### Overview\n  - a claim\n- ### Relationships\n- ### Provenance\n"));
    }
}
