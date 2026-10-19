//! Phase 4 ledger writer — port of `TIER_LABELS`, `_build_page_index`,
//! `_LINK_STOPWORDS`, `_resolve_ontology_term`, `_extract_episode_meta`,
//! `_ledger_page_path`, `_build_ledger_header`, `_build_ledger_bullet`, and
//! `write_assertion_ledger` from `ingest.py`.
//!
//! Curated ontology pages are never modified by this module — every
//! verified assertion lands as a bullet on a per-episode
//! `podcast-evidence___<episode-slug>.md` ledger page instead.

use super::pyval::{get_raw_or, get_str, get_str_vec, get_truthy_display, Assertion};
use crate::common::{assertion_fingerprint, yaml_scalar};
use indexmap::IndexMap;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// `TIER_LABELS = {1: "", 2: "Industry analysis", 3: "Emerging signal"}`.
pub fn tier_label(tier: i64) -> &'static str {
    match tier {
        2 => "Industry analysis",
        3 => "Emerging signal",
        _ => "",
    }
}

/// Generic single-word tokens and bare acronyms that resolve to a real page
/// but almost always mean something else in context — linking them injects
/// false graph edges (RUNBOOK PC-1). Only ever matched by EXACT slug, never
/// substring.
const LINK_STOPWORDS: &[&str] = &[
    "model", "base", "value", "logic", "curve", "safe", "rest", "api", "uri", "url", "gan", "uma",
    "raft", "core", "state", "scale", "chain", "node", "agent", "token", "graph", "data", "cloud",
    "edge", "stack", "layer", "loop", "flow", "field", "space", "vector", "signal", "policy",
    "target",
];

fn re_quality() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#""quality":\s*([\d.]+)"#).unwrap())
}

/// Page index entry: (path, JSON-LD `quality` score, or `0.5` if absent).
pub type PageIndex = IndexMap<String, (PathBuf, f64)>;

/// Port of `_build_page_index`, extended for aliases: `slug -> (path, quality)`
/// for every non-ledger page under `ontology_dir`, built once per run.
///
/// A page is indexed under its own title first. Each `aliases:` entry in its
/// frontmatter is then indexed too, but only when no real title already owns
/// that slug and no *other* page claims it: an ambiguous alias stays out of
/// the index, so the term is left unlinked rather than guessed.
pub fn build_page_index(ontology_dir: &Path) -> PageIndex {
    let mut index = PageIndex::new();
    let mut entries: Vec<PathBuf> = std::fs::read_dir(ontology_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    entries.sort();

    // alias slug -> (path, quality), or None once two pages claim it.
    let mut aliases: IndexMap<String, Option<(PathBuf, f64)>> = IndexMap::new();
    for p in entries {
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if stem.starts_with("podcast-evidence") {
            continue;
        }
        let bytes = std::fs::read(&p).unwrap_or_default();
        let content = String::from_utf8_lossy(&bytes);
        let quality = re_quality()
            .captures(&content)
            .and_then(|c| c[1].parse::<f64>().ok())
            .unwrap_or(0.5);
        for alias in frontmatter_aliases(&content) {
            let slug = term_slug(&alias);
            match aliases.get(&slug) {
                None => {
                    aliases.insert(slug, Some((p.clone(), quality)));
                }
                Some(Some((other, _))) if *other != p => {
                    aliases.insert(slug, None);
                }
                Some(_) => {}
            }
        }
        index.insert(term_slug(&stem), (p, quality));
    }
    for (slug, claim) in aliases {
        if let (false, Some(entry)) = (index.contains_key(&slug), claim) {
            index.insert(slug, entry);
        }
    }
    index
}

/// The lookup key for a title or term: lower-case, spaces as hyphens.
fn term_slug(term: &str) -> String {
    term.trim().to_lowercase().replace(' ', "-")
}

/// The `aliases:` entries of a page's frontmatter, as a block list
/// (`- Name`) or an inline list (`[A, B]`). Anything outside the leading
/// `---` block is ignored.
fn frontmatter_aliases(content: &str) -> Vec<String> {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut in_aliases = false;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("aliases:") {
            let rest = rest.trim();
            in_aliases = rest.is_empty();
            if let Some(inline) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                out.extend(inline.split(',').filter_map(clean_alias));
            }
        } else if in_aliases {
            match line.trim_start().strip_prefix("- ") {
                Some(item) => out.extend(clean_alias(item)),
                None => in_aliases = false,
            }
        }
    }
    out
}

fn clean_alias(raw: &str) -> Option<String> {
    let alias = raw.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    (!alias.is_empty()).then(|| alias.to_string())
}

/// Port of `_resolve_ontology_term`, tightened: a term resolves only to a page
/// whose title or alias is exactly that term. The Python original also accepted
/// any page whose slug merely *contained* the term, which linked "OpenAI" to
/// "OpenAI API" and "NVIDIA" to "NVIDIA H200"; an unresolved term is now left
/// unlinked instead.
pub fn resolve_ontology_term(term: &str, page_index: &PageIndex) -> Option<PathBuf> {
    let slug = term_slug(term);
    let tokens: Vec<&str> = slug.split('-').filter(|t| !t.is_empty()).collect();

    if tokens.len() < 2 && (LINK_STOPWORDS.contains(&slug.as_str()) || slug.chars().count() <= 4) {
        return None;
    }

    page_index.get(&slug).map(|(path, _)| path.clone())
}

pub struct EpisodeMeta {
    pub title: String,
    pub url: String,
    pub episode_date: String,
}

fn re_title() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^#\s+(.+)$").unwrap())
}
fn re_youtube_url() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\*\*YouTube\*\*:\s*(\S+)").unwrap())
}
fn re_date() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\*\*Date\*\*:\s*(\S+)").unwrap())
}

/// Port of `_extract_episode_meta`.
pub fn extract_episode_meta(md_path: &Path) -> EpisodeMeta {
    let content = std::fs::read_to_string(md_path).unwrap_or_default();
    let title = re_title()
        .captures(&content)
        .map(|c| c[1].trim().to_string())
        .unwrap_or_else(|| {
            md_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        });
    let url = re_youtube_url()
        .captures(&content)
        .map(|c| c[1].trim().to_string())
        .unwrap_or_default();
    let episode_date = re_date()
        .captures(&content)
        .map(|c| c[1].trim().to_string())
        .unwrap_or_default();
    EpisodeMeta {
        title,
        url,
        episode_date,
    }
}

pub const LEDGER_FP_MARKER_PREFIX: &str = "<!-- assertion-fp: ";
pub const LEDGER_FP_MARKER_SUFFIX: &str = " -->";

fn re_ledger_fp() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<!-- assertion-fp:\s*([0-9a-f]+)\s*-->").unwrap())
}

/// Subdirectory of the working pages root that holds the evidence ledgers.
pub const LEDGER_SUBDIR: &str = "podcast-evidence";

/// Port of `_ledger_page_path`.
///
/// Ledgers are `<working_dir>/podcast-evidence/<episode-slug>.md`. Episode
/// identity is the filename stem. The retired flat `podcast-evidence___<slug>.md`
/// name is rejected by `vault validate` as an `a___b.md` namespace filename.
pub fn ledger_page_path(working_dir: &Path, episode_slug: &str) -> PathBuf {
    working_dir
        .join(LEDGER_SUBDIR)
        .join(format!("{episode_slug}.md"))
}

/// Port of `_build_ledger_header`, in the working vault's `Episode` shape
/// (ADR-2107, VAULT-corpus-format §V2/§V5).
///
/// `public: false` is a real YAML boolean, emitted as the bare literal and
/// never run through `yaml_scalar`, which would re-quote it. A ledger is
/// working-graph evidence: only a human publishes an Episode, so this pipeline
/// never writes `public: true`. `generated_at` is an RFC 3339 timestamp.
pub fn build_ledger_header(meta: &EpisodeMeta, today: &str, generated_at: &str) -> String {
    let mut props: Vec<(String, String)> = vec![
        ("type".to_string(), "Episode".to_string()),
        (
            "title".to_string(),
            yaml_scalar(&format!("AI Daily Brief — {}", meta.title)),
        ),
        ("public".to_string(), "false".to_string()),
        ("status".to_string(), "stable".to_string()),
        ("source".to_string(), yaml_scalar("AI Daily Brief")),
    ];
    if !meta.url.is_empty() {
        props.push(("episode-url".to_string(), yaml_scalar(&meta.url)));
    }
    if !meta.episode_date.is_empty() {
        props.push(("episode-date".to_string(), yaml_scalar(&meta.episode_date)));
    }
    props.push(("ingest-date".to_string(), yaml_scalar(today)));

    let mut lines: Vec<String> = vec!["---".to_string()];
    lines.extend(props.iter().map(|(k, v)| format!("{k}: {v}")));
    lines.push("generated:".to_string());
    lines.push(format!(
        "  by: process:podcast-ingest/{}",
        env!("CARGO_PKG_VERSION")
    ));
    lines.push(format!("  at: {generated_at}"));
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push(format!("# AI Daily Brief — {}", meta.title));
    lines.push(String::new());
    lines.join("\n") + "\n"
}

/// Port of `_build_ledger_bullet`. Returns `(bullet_text, resolved_topic_titles)`.
pub fn build_ledger_bullet(
    assertion: &Assertion,
    page_index: &PageIndex,
    today: &str,
    episode_date: &str,
) -> (String, Vec<String>) {
    let claim = get_str(assertion, "claim", "");
    let default_tier = Value::Number(1.into());
    let tier_raw = get_raw_or(assertion, "tier", &default_tier);
    let tier_key = tier_raw
        .as_i64()
        .unwrap_or_else(|| tier_raw.as_f64().unwrap_or(1.0) as i64);
    let confidence = get_str(assertion, "confidence", "");
    let source = get_str(assertion, "source", "unknown");
    let fp = get_str(assertion, "fingerprint", "");

    let mut resolved_titles: Vec<String> = Vec::new();
    for term in get_str_vec(assertion, "ontology_terms") {
        if let Some(page) = resolve_ontology_term(&term, page_index) {
            if let Some(stem) = page.file_stem() {
                resolved_titles.push(stem.to_string_lossy().to_string());
            }
        }
    }

    let wikilinks = resolved_titles
        .iter()
        .map(|t| format!("[[{t}]]"))
        .collect::<Vec<_>>()
        .join(" ");
    let label = tier_label(tier_key);
    let tier_prefix = if !label.is_empty() {
        format!("**[{label}]** ")
    } else {
        String::new()
    };
    let mut bullet_first_line = format!("- {tier_prefix}{claim}");
    if !wikilinks.is_empty() {
        bullet_first_line.push_str(&format!(" {wikilinks}"));
    }

    let mut sub_lines: Vec<String> = vec![
        format!("  **tier:** {}", super::pyval::py_display(tier_raw)),
        format!("  **confidence:** {confidence}"),
        format!("  **source:** {source}"),
    ];
    if let Some(authority) = get_truthy_display(assertion, "source_authority") {
        sub_lines.push(format!("  **source-authority:** {authority}"));
    }
    if let Some(volatility) = get_truthy_display(assertion, "volatility") {
        sub_lines.push(format!("  **volatility:** {volatility}"));
    }
    let claim_date = if !episode_date.is_empty() {
        episode_date
    } else {
        today
    };
    sub_lines.push(format!("  **claim-date:** {claim_date}"));

    if let Some(evidence) = get_truthy_display(assertion, "evidence") {
        if evidence != claim {
            sub_lines.push(format!("  **evidence:** {evidence}"));
        }
    }
    sub_lines.push(format!(
        "  {LEDGER_FP_MARKER_PREFIX}{fp}{LEDGER_FP_MARKER_SUFFIX}"
    ));

    let bullet = format!("{bullet_first_line}\n{}\n", sub_lines.join("\n"));
    (bullet, resolved_titles)
}

/// RFC 3339 UTC timestamp for the `generated` provenance block.
fn generated_at() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Port of `write_assertion_ledger`. `verified_assertions` carry an
/// `_episode_path` string field (set by the caller in `phase_integrate`)
/// used to locate episode metadata. Returns `(n_bullets_written, unmatched)`.
pub fn write_assertion_ledger(
    episode_filename: &str,
    verified_assertions: &[Assertion],
    working_dir: &Path,
    pages_dir: Option<&Path>,
    state_assertions: &mut IndexMap<String, Value>,
    today: &str,
    page_index: Option<&PageIndex>,
) -> (usize, Vec<Assertion>) {
    let episode_slug = Path::new(episode_filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| episode_filename.to_string());

    let meta_path = verified_assertions
        .iter()
        .find_map(|a| get_truthy_display(a, "_episode_path"));
    let meta = match &meta_path {
        Some(p) => extract_episode_meta(Path::new(p)),
        None => EpisodeMeta {
            title: episode_slug.clone(),
            url: String::new(),
            episode_date: String::new(),
        },
    };

    let ledger_path = ledger_page_path(working_dir, &episode_slug);
    let existing_content = std::fs::read_to_string(&ledger_path).unwrap_or_default();
    let existing_fps: HashSet<String> = re_ledger_fp()
        .captures_iter(&existing_content)
        .map(|c| c[1].to_string())
        .collect();

    let owned_index;
    let page_index: &PageIndex = match page_index {
        Some(idx) => idx,
        None => {
            owned_index = pages_dir.map(build_page_index).unwrap_or_default();
            &owned_index
        }
    };

    let mut unmatched: Vec<Assertion> = Vec::new();
    let mut new_bullets: Vec<String> = Vec::new();

    for assertion in verified_assertions {
        let mut assertion = assertion.clone();
        let mut fp = get_str(&assertion, "fingerprint", "");
        if fp.is_empty() {
            let source = get_str(&assertion, "source", "");
            let claim = get_str(&assertion, "claim", "");
            fp = assertion_fingerprint(&source, &claim);
            assertion.insert("fingerprint".to_string(), Value::String(fp.clone()));
        }
        if existing_fps.contains(&fp) {
            continue;
        }
        let (bullet, resolved_titles) =
            build_ledger_bullet(&assertion, page_index, today, &meta.episode_date);
        new_bullets.push(bullet);
        if resolved_titles.is_empty() {
            let mut tagged = assertion.clone();
            tagged.insert(
                "_source_file".to_string(),
                Value::String(episode_filename.to_string()),
            );
            unmatched.push(tagged);
        }
        if !fp.is_empty() {
            let claim = get_str(&assertion, "claim", "");
            state_assertions.insert(
                fp,
                serde_json::json!({
                    "claim": claim,
                    "integrated_into": ledger_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    "date": today,
                }),
            );
        }
    }

    if new_bullets.is_empty() {
        return (0, unmatched);
    }

    let content = if !existing_content.is_empty() {
        format!(
            "{}\n{}",
            existing_content.trim_end_matches('\n'),
            new_bullets.join("\n")
        )
    } else {
        format!(
            "{}{}",
            build_ledger_header(&meta, today, &generated_at()),
            new_bullets.join("\n")
        )
    };

    let final_content = format!("{}\n", content.trim_end_matches('\n'));
    if let Some(parent) = ledger_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&ledger_path, final_content);
    (new_bullets.len(), unmatched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn assertion(json_val: Value) -> Assertion {
        match json_val {
            Value::Object(o) => o,
            _ => unreachable!(),
        }
    }

    #[test]
    fn tier_labels_match_python() {
        assert_eq!(tier_label(1), "");
        assert_eq!(tier_label(2), "Industry analysis");
        assert_eq!(tier_label(3), "Emerging signal");
    }

    fn write_page(dir: &Path, title: &str, aliases: &[&str], quality: f64) {
        let mut fm = format!("---\ntype: Class\ntitle: {title}\nquality: {quality}\n");
        if !aliases.is_empty() {
            fm.push_str("aliases:\n");
            for a in aliases {
                fm.push_str(&format!("- {a}\n"));
            }
        }
        fm.push_str("---\n\nBody.\n");
        std::fs::write(dir.join(format!("{title}.md")), fm).unwrap();
    }

    /// 2026-10-19 triage: "OpenAI" was snapped onto "OpenAI API" (132 ledger
    /// bullets) because any page title containing the term, at least half its
    /// length, matched. A company is not its product page.
    #[test]
    fn a_term_never_snaps_onto_a_longer_page_title() {
        let dir = tempdir().unwrap();
        write_page(dir.path(), "OpenAI API", &[], 0.8);
        write_page(dir.path(), "NVIDIA H200", &[], 0.8);
        let idx = build_page_index(dir.path());
        assert!(resolve_ontology_term("OpenAI", &idx).is_none());
        assert!(resolve_ontology_term("NVIDIA", &idx).is_none());
        assert!(resolve_ontology_term("H200", &idx).is_none());
    }

    #[test]
    fn an_exact_title_resolves_case_and_space_insensitively() {
        let dir = tempdir().unwrap();
        write_page(dir.path(), "Prompt Engineering", &[], 0.8);
        let idx = build_page_index(dir.path());
        let hit = resolve_ontology_term("prompt engineering", &idx).unwrap();
        assert_eq!(hit.file_stem().unwrap(), "Prompt Engineering");
    }

    #[test]
    fn an_alias_resolves_to_its_page() {
        let dir = tempdir().unwrap();
        write_page(
            dir.path(),
            "OpenAI Research Organisation",
            &["Open AI", "OpenAI"],
            0.8,
        );
        write_page(dir.path(), "OpenAI API", &[], 0.9);
        let idx = build_page_index(dir.path());
        let hit = resolve_ontology_term("OpenAI", &idx).unwrap();
        assert_eq!(hit.file_stem().unwrap(), "OpenAI Research Organisation");
    }

    #[test]
    fn a_real_title_beats_an_alias_of_another_page() {
        let dir = tempdir().unwrap();
        write_page(dir.path(), "Gemini", &[], 0.5);
        write_page(dir.path(), "Google Gemini Model", &["Gemini"], 0.9);
        let idx = build_page_index(dir.path());
        let hit = resolve_ontology_term("Gemini", &idx).unwrap();
        assert_eq!(hit.file_stem().unwrap(), "Gemini");
    }

    #[test]
    fn an_alias_claimed_by_two_pages_is_left_unlinked() {
        let dir = tempdir().unwrap();
        write_page(dir.path(), "Mercury Planet", &["Mercury"], 0.8);
        write_page(dir.path(), "Mercury Element", &["Mercury"], 0.8);
        let idx = build_page_index(dir.path());
        assert!(resolve_ontology_term("Mercury", &idx).is_none());
    }

    #[test]
    fn resolve_stopword_single_token_refused() {
        let idx = PageIndex::new();
        assert!(resolve_ontology_term("api", &idx).is_none());
        assert!(resolve_ontology_term("gan", &idx).is_none());
    }

    #[test]
    fn build_bullet_no_wikilinks_no_tier_prefix() {
        let idx = PageIndex::new();
        let a = assertion(json!({
            "claim": "A claim.",
            "tier": 1,
            "confidence": 0.9,
            "source": "Host",
            "fingerprint": "abc123",
            "ontology_terms": []
        }));
        let (bullet, resolved) = build_ledger_bullet(&a, &idx, "2026-01-01", "");
        assert!(resolved.is_empty());
        assert!(bullet.starts_with("- A claim.\n"));
        assert!(bullet.contains("  **tier:** 1\n"));
        assert!(bullet.contains("  **confidence:** 0.9\n"));
        assert!(bullet.contains("  **source:** Host\n"));
        assert!(bullet.contains("  **claim-date:** 2026-01-01\n"));
        assert!(!bullet.contains("::"), "the v1 key:: sub-lines are retired");
        assert!(bullet.contains("<!-- assertion-fp: abc123 -->"));
    }

    #[test]
    fn build_bullet_tier2_gets_label_prefix() {
        let idx = PageIndex::new();
        let a = assertion(json!({"claim": "X", "tier": 2, "fingerprint": "f1"}));
        let (bullet, _) = build_ledger_bullet(&a, &idx, "2026-01-01", "");
        assert!(bullet.starts_with("- **[Industry analysis]** X\n"));
    }

    #[test]
    fn header_is_a_non_public_episode_with_provenance() {
        let meta = EpisodeMeta {
            title: "Episode Title".to_string(),
            url: "https://youtu.be/x".to_string(),
            episode_date: "2026-01-01".to_string(),
        };
        let header = build_ledger_header(&meta, "2026-01-02", "2026-01-02T03:04:05Z");
        assert!(header.starts_with("---\ntype: Episode\n"));
        // `public` is a bare boolean, and a ledger is never public.
        assert!(header.contains("\npublic: false\n"));
        assert!(!header.contains("public: true"));
        assert!(header.contains("\nstatus: stable\n"));
        // No YAML-special characters in this title, so yaml_scalar leaves it
        // bare (unquoted) — only special/bool/number/date-shaped scalars,
        // or a title containing one of `:#[]{},"'`, get quoted.
        assert!(header.contains("title: AI Daily Brief — Episode Title\n"));
        assert!(header.contains("episode-url: \"https://youtu.be/x\"\n"));
        assert!(header.contains("episode-date: \"2026-01-01\"\n"));
        assert!(header.contains("generated:\n  by: process:podcast-ingest/"));
        assert!(header.contains("\n  at: 2026-01-02T03:04:05Z\n---\n"));
        assert!(header.ends_with("# AI Daily Brief — Episode Title\n\n"));
    }

    #[test]
    fn ledger_path_is_a_podcast_evidence_subdirectory_entry() {
        let path = ledger_page_path(Path::new("/v/working"), "an-episode");
        assert_eq!(path, Path::new("/v/working/podcast-evidence/an-episode.md"));
        assert!(
            !path.to_string_lossy().contains("___"),
            "the flat a___b.md name is rejected by vault validate"
        );
    }

    #[test]
    fn write_ledger_appends_idempotently() {
        let dir = tempdir().unwrap();
        let mut state_assertions = IndexMap::new();
        let a1 = assertion(json!({
            "claim": "First claim.",
            "tier": 1,
            "confidence": 0.9,
            "source": "Host",
            "ontology_terms": []
        }));
        let (n, _) = write_assertion_ledger(
            "episode-one.md",
            std::slice::from_ref(&a1),
            dir.path(),
            None,
            &mut state_assertions,
            "2026-01-01",
            None,
        );
        assert_eq!(n, 1);
        let content =
            std::fs::read_to_string(dir.path().join("podcast-evidence/episode-one.md")).unwrap();
        assert!(content.ends_with('\n') && !content.ends_with("\n\n"));

        // Re-running with the same assertion (now fingerprinted, since the
        // ledger records it) is idempotent — but here we simulate a fresh
        // extraction that produces the identical fingerprint.
        let fp = crate::common::assertion_fingerprint("Host", "First claim.");
        let mut a1_fp = a1.clone();
        a1_fp.insert("fingerprint".to_string(), Value::String(fp));
        let (n2, _) = write_assertion_ledger(
            "episode-one.md",
            &[a1_fp],
            dir.path(),
            None,
            &mut state_assertions,
            "2026-01-01",
            None,
        );
        assert_eq!(
            n2, 0,
            "second run with an already-ledgered fingerprint must add nothing"
        );
    }
}
