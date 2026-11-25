//! New-page proposal — port of `NEW_PAGE_TEMPLATE`, `PAGE_WORTHINESS_PROMPT`,
//! and `_propose_new_pages` from `ingest.py`. Runs against unresolved-topic
//! assertions (zero resolved `ontology_terms`) that still landed on the
//! episode ledger, asking the Loom to judge which topics deserve a brand
//! new ontology page.

use super::config::Settings;
use super::ledger::{tier_label, LEDGER_SUBDIR};
use super::loom::{call_loom, resolve_loom_url};
use super::pyval::{get_str, get_str_vec, get_tier, Assertion};
use crate::common::state::{CreatedPageRecord, IngestState};
use crate::common::vault_shape::{page_resource, VaultShape, V3};
use crate::common::{slugify_default, to_json_pretty_ascii, yaml_scalar};
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

/// The body of a proposed page, as Obsidian markdown: headings, not outline
/// bullets, and no `json-ld` fences (both fail `ontomark validate` / `repair
/// bodies --check`; the page's identity and edges come from its frontmatter and
/// wikilinks).
fn new_page_body(
    title: &str,
    definition: &str,
    parent_label: &str,
    related: &[String],
    episode_source: &str,
    evidence_block: &str,
) -> String {
    let mut relationships = vec![format!("- Parent: [[{parent_label}]]")];
    relationships.extend(related.iter().map(|t| format!("- Related: [[{t}]]")));
    format!(
        "# {title}\n\n{definition}\n\n## Overview\n\n{evidence_block}\n\n## Relationships\n\n{}\n\n## Provenance\n\n- Episode: {episode_source}\n",
        relationships.join("\n")
    )
}

/// A proposed page in the vocabulary-2 shape: a `Draft Concept`.
fn new_page_content(
    title: &str,
    definition: &str,
    parent_label: &str,
    related: &[String],
    date: &str,
    episode_source: &str,
    evidence_block: &str,
) -> String {
    format!(
        "---\ntype: Draft Concept\ntitle: {title}\npublic: false\nstatus: draft\ngenerated:\n  by: process:podcast-ingest/{version}\n  at: {date}\n---\n\n{body}",
        version = env!("CARGO_PKG_VERSION"),
        body = new_page_body(
            title,
            definition,
            parent_label,
            related,
            episode_source,
            evidence_block
        )
    )
}

/// One ledger cited as evidence: its slug and the claim fingerprints cited.
struct Evidence {
    slug: String,
    fingerprints: Vec<String>,
}

/// Group the assertions by the ledger they landed on, keeping only claims the
/// ledger really carries (`<!-- assertion-fp: <fp> -->`): a citation to a
/// fingerprint the ledger lacks is a validation error (`DANGLING_LOCATOR`).
fn evidence_for(working_dir: &Path, assertions: &[&Assertion]) -> Vec<Evidence> {
    let mut out: Vec<Evidence> = Vec::new();
    for a in assertions {
        let file = get_str(a, "_source_file", "");
        let slug = Path::new(&file)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let fp = get_str(a, "fingerprint", "");
        if slug.is_empty() || fp.is_empty() {
            continue;
        }
        let ledger = working_dir.join(LEDGER_SUBDIR).join(format!("{slug}.md"));
        let carries = std::fs::read_to_string(&ledger)
            .map(|text| text.contains(&format!("<!-- assertion-fp: {fp} -->")))
            .unwrap_or(false);
        if !carries {
            continue;
        }
        match out.iter_mut().find(|e| e.slug == slug) {
            Some(e) if !e.fingerprints.contains(&fp) => e.fingerprints.push(fp),
            Some(_) => {}
            None => out.push(Evidence {
                slug,
                fingerprints: vec![fp],
            }),
        }
    }
    out
}

/// A proposed page in the vocabulary-3 shape (ADR-VG-010 §6): a `Proposal`,
/// `status: draft`, `promotion-status: candidate`, `visibility: shared`, with
/// `rel: evidence` sources that cite the ledgers directly, each with the
/// `fp:` locators of the claims relied on. The stamp's `by` is the operator's
/// principal and `via` is this process (ADR-VG-011 §1, ADR-VG-012 §6); the
/// first `contributors` entry is this write. The title is the file name, so no
/// `title` key (vault.toml).
#[allow(clippy::too_many_arguments)]
fn new_proposal_content(
    v3: &V3,
    title: &str,
    definition: &str,
    parent_label: &str,
    related: &[String],
    at: &str,
    episode_source: &str,
    evidence_block: &str,
    evidence: &[Evidence],
) -> String {
    let via = format!("process:podcast-ingest/{}", env!("CARGO_PKG_VERSION"));
    let by = &v3.principal;
    let sources: String = evidence
        .iter()
        .map(|e| {
            let locator = e
                .fingerprints
                .iter()
                .map(|f| format!("fp:{f}"))
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "- id: {}\n  rel: evidence\n  resource: '[[{LEDGER_SUBDIR}/{}]]'\n  locator: {locator}\n",
                yaml_scalar(&e.slug),
                e.slug
            )
        })
        .collect();
    format!(
        "---\ntype: Proposal\nstatus: draft\npage_resource: {resource}\nvisibility: shared\ngenerated:\n  by: {by}\n  via: {via}\n  at: {at}\ncontributors:\n- by: {by}\n  via: {via}\n  at: {at}\nproposes: {name}\ntopic: {name}\npromotion-status: candidate\nsources:\n{sources}---\n\n{body}",
        resource = page_resource(title),
        name = yaml_scalar(title),
        body = new_page_body(
            title,
            definition,
            parent_label,
            related,
            episode_source,
            evidence_block
        )
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
    let shape = match VaultShape::detect(working_dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("  New page proposals NOT written: {e}");
            return;
        }
    };
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

        let page_content = match &shape {
            VaultShape::V2 => new_page_content(
                &title,
                &definition,
                parent_label,
                &related,
                today,
                &episode_source,
                &evidence_lines.join("\n"),
            ),
            VaultShape::V3(v3) => {
                let evidence = evidence_for(working_dir, &page_assertions);
                if evidence.is_empty() {
                    println!("    SKIP: {title} — no ledger carries its evidence yet");
                    continue;
                }
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                new_proposal_content(
                    v3,
                    &title,
                    &definition,
                    parent_label,
                    &related,
                    &now,
                    &episode_source,
                    &evidence_lines.join("\n"),
                    &evidence,
                )
            }
        };

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

    const PRINCIPAL: &str =
        "did:nostr:b41654017f6850b13857d19d8ae0e3f88f1365600cab0321e8101c9e92682f7a";

    fn v3() -> V3 {
        V3 {
            root: std::path::PathBuf::from("/vault"),
            principal: PRINCIPAL.to_string(),
            promotion_statuses: None,
        }
    }

    fn ledgered(dir: &Path, slug: &str, fps: &[&str]) {
        let d = dir.join(LEDGER_SUBDIR);
        std::fs::create_dir_all(&d).unwrap();
        let body: String = fps
            .iter()
            .map(|f| format!("- claim\n  <!-- assertion-fp: {f} -->\n"))
            .collect();
        std::fs::write(d.join(format!("{slug}.md")), body).unwrap();
    }

    fn unmatched(file: &str, fp: &str) -> Assertion {
        let mut a = Assertion::new();
        a.insert("_source_file".into(), Value::String(file.into()));
        a.insert("fingerprint".into(), Value::String(fp.into()));
        a
    }

    #[test]
    fn a_v3_proposal_cites_its_ledgers_as_located_evidence() {
        let evidence = vec![
            Evidence {
                slug: "ep-one".into(),
                fingerprints: vec!["aa11".into(), "bb22".into()],
            },
            Evidence {
                slug: "ep-two".into(),
                fingerprints: vec!["cc33".into()],
            },
        ];
        let content = new_proposal_content(
            &v3(),
            "Foo Bar",
            "A definition.",
            "Artificial Intelligence",
            &["Baz".to_string()],
            "2026-11-25T10:00:00Z",
            "ep-one.md",
            "- a claim",
            &evidence,
        );
        let version = env!("CARGO_PKG_VERSION");
        let expected = format!(
            "---\ntype: Proposal\nstatus: draft\npage_resource: {}\nvisibility: shared\ngenerated:\n  by: {PRINCIPAL}\n  via: process:podcast-ingest/{version}\n  at: 2026-11-25T10:00:00Z\ncontributors:\n- by: {PRINCIPAL}\n  via: process:podcast-ingest/{version}\n  at: 2026-11-25T10:00:00Z\nproposes: Foo Bar\ntopic: Foo Bar\npromotion-status: candidate\nsources:\n- id: ep-one\n  rel: evidence\n  resource: '[[podcast-evidence/ep-one]]'\n  locator: fp:aa11,fp:bb22\n- id: ep-two\n  rel: evidence\n  resource: '[[podcast-evidence/ep-two]]'\n  locator: fp:cc33\n---\n\n# Foo Bar\n",
            page_resource("Foo Bar")
        );
        assert!(content.starts_with(&expected), "{content}");
        assert!(!content.contains("Draft Concept") && !content.contains("public:"));
        assert!(!content.contains("verified"));
    }

    #[test]
    fn evidence_keeps_only_claims_the_ledger_carries() {
        let dir = tempfile::tempdir().unwrap();
        ledgered(dir.path(), "ep-one", &["aa11", "bb22"]);
        let a1 = unmatched("ep-one.md", "aa11");
        let a2 = unmatched("ep-one.md", "zz99"); // not in the ledger
        let a3 = unmatched("ep-missing.md", "aa11"); // no such ledger
        let a4 = unmatched("ep-one.md", "bb22");
        let got = evidence_for(dir.path(), &[&a1, &a2, &a3, &a4]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].slug, "ep-one");
        assert_eq!(got[0].fingerprints, ["aa11", "bb22"]);
    }
}
