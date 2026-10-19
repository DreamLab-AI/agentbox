//! Ledger parsing — port of the `Assertion` dataclass, `episode_slug_from_ledger`,
//! `parse_ledger_page`, `load_all_assertions`, and `group_by_topic` from
//! `promote.py`.

use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

pub const LEDGER_GLOB_PREFIX: &str = "podcast-evidence___";

fn re_ledger_fp() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<!--\s*assertion-fp:\s*([0-9a-f]+)\s*-->").unwrap())
}
fn re_wikilink() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap())
}
/// One indented property sub-line of an assertion bullet.
///
/// Two spellings are read. `  **key:** value` is the working vault's format
/// (contract C1 migration rule C) and what the ingest writer emits. The v1
/// `  key:: value` is accepted so ledgers written before the migration still
/// parse. Exactly one of the two key groups captures.
fn re_prop_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?m)^  (?:\*\*([a-zA-Z0-9_-]+):\*\*|([a-zA-Z0-9_-]+)::) (.*)$").unwrap()
    })
}
fn re_tier_bold_prefix() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\*\*\[[^\]]+\]\*\*\s*").unwrap())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assertion {
    pub claim: String,
    pub topics: Vec<String>,
    pub tier: String,
    pub confidence: String,
    pub source: String,
    pub fp: String,
    pub episode_slug: String,
    pub ledger_file: String,
    pub claim_date: String,
    pub evidence: String,
}

/// Port of `episode_slug_from_ledger`.
pub fn episode_slug_from_ledger(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    stem.strip_prefix(LEDGER_GLOB_PREFIX)
        .map(|s| s.to_string())
        .unwrap_or(stem)
}

/// Render a YAML scalar as the text a bullet property would carry.
fn yaml_text(v: Option<&serde_yaml::Value>) -> String {
    match v {
        Some(serde_yaml::Value::String(s)) => s.trim().to_string(),
        Some(serde_yaml::Value::Number(n)) => n.to_string(),
        Some(serde_yaml::Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// Read the machine-readable `assertions:` list from a ledger's frontmatter.
///
/// The list is the typed twin of the body bullets (PRD Q16), so when a ledger
/// carries one it is authoritative. Entries without a fingerprint, a claim or
/// any topic are skipped, as the bullet reader skips them. A page with no
/// frontmatter, no list, or unparseable YAML yields nothing, and the caller
/// falls back to the bullets.
fn frontmatter_assertions(text: &str, episode_slug: &str, ledger_file: &str) -> Vec<Assertion> {
    let Some(rest) = text.strip_prefix("---\n") else {
        return Vec::new();
    };
    let Some(end) = rest.find("\n---") else {
        return Vec::new();
    };
    let Ok(doc) = serde_yaml::from_str::<serde_yaml::Value>(&rest[..end]) else {
        return Vec::new();
    };
    let Some(items) = doc.get("assertions").and_then(|v| v.as_sequence()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in items {
        let fp = yaml_text(item.get("fingerprint"));
        let claim = yaml_text(item.get("claim"));
        let topics: Vec<String> = item
            .get("topics")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|t| t.as_str())
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if fp.is_empty() || claim.is_empty() || topics.is_empty() {
            continue;
        }
        out.push(Assertion {
            claim,
            topics,
            tier: yaml_text(item.get("tier")),
            confidence: yaml_text(item.get("confidence")),
            source: yaml_text(item.get("source")),
            fp,
            episode_slug: episode_slug.to_string(),
            ledger_file: ledger_file.to_string(),
            claim_date: yaml_text(item.get("claim-date")),
            evidence: yaml_text(item.get("evidence")),
        });
    }
    out
}

/// Port of `parse_ledger_page`, extended for the working vault's layout.
///
/// Reads the frontmatter `assertions:` list when the page has one, otherwise
/// the body bullets.
pub fn parse_ledger_page(path: &Path) -> Vec<Assertion> {
    let bytes = std::fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let episode_slug = episode_slug_from_ledger(path);
    let ledger_file = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let from_frontmatter = frontmatter_assertions(&text, &episode_slug, &ledger_file);
    if !from_frontmatter.is_empty() {
        return from_frontmatter;
    }

    let mut out = Vec::new();

    // Split on top-level bullet starts (lines beginning with "- ") so each
    // chunk is one bullet block, including its indented `  key:: value` and
    // fingerprint-comment sub-lines.
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    for line in text.split('\n') {
        if line.starts_with("- ") {
            blocks.push(vec![line]);
        } else if let Some(last) = blocks.last_mut() {
            if line.starts_with("  ") || line.trim().is_empty() {
                last.push(line);
            }
        }
    }

    for block in blocks {
        let first = block[0];
        let rest = block[1..].join("\n");

        let fp = match re_ledger_fp().captures(&rest) {
            Some(c) => c[1].to_string(),
            None => continue, // not an assertion bullet
        };

        let topics: Vec<String> = re_wikilink()
            .captures_iter(first)
            .map(|c| c[1].to_string())
            .collect();
        let without_links = re_wikilink().replace_all(&first[2..], "");
        let claim = re_tier_bold_prefix()
            .replace_all(without_links.trim(), "")
            .trim()
            .to_string();

        let mut props: HashMap<String, String> = HashMap::new();
        for pm in re_prop_line().captures_iter(&rest) {
            let key = pm.get(1).or_else(|| pm.get(2)).map(|m| m.as_str());
            if let Some(key) = key {
                props.insert(key.to_string(), pm[3].trim().to_string());
            }
        }

        if topics.is_empty() {
            // unmatched-topic assertions carry no wikilink; not
            // candidate-eligible for this topic-grouped stage
            continue;
        }

        out.push(Assertion {
            claim,
            topics,
            tier: props.get("tier").cloned().unwrap_or_default(),
            confidence: props.get("confidence").cloned().unwrap_or_default(),
            source: props.get("source").cloned().unwrap_or_default(),
            fp,
            episode_slug: episode_slug.clone(),
            ledger_file: ledger_file.clone(),
            claim_date: props.get("claim-date").cloned().unwrap_or_default(),
            evidence: props.get("evidence").cloned().unwrap_or_default(),
        });
    }
    out
}

/// Parse every `*.md` page directly under `ledger_dir`.
///
/// For the working vault's dedicated `podcast-evidence/` directory, where every
/// page is a ledger and the episode slug is the filename stem. The flat layout
/// mixes ledgers with topic pages and needs the prefix filter in
/// [`load_all_assertions`] instead.
pub fn load_ledger_dir_assertions(ledger_dir: &Path) -> Vec<Assertion> {
    let mut paths: Vec<std::path::PathBuf> = std::fs::read_dir(ledger_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.extension().map(|x| x == "md").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    paths.sort();

    let mut out = Vec::new();
    for p in paths {
        out.extend(parse_ledger_page(&p));
    }
    out
}

/// Port of `load_all_assertions`, for the retired flat layout in which ledger
/// pages (`podcast-evidence___<slug>.md`) sit beside the topic pages.
pub fn load_all_assertions(pages_dir: &Path) -> Vec<Assertion> {
    let mut paths: Vec<std::path::PathBuf> = std::fs::read_dir(pages_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .map(|n| {
                            let n = n.to_string_lossy();
                            n.starts_with(LEDGER_GLOB_PREFIX) && n.ends_with(".md")
                        })
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    paths.sort();

    let mut out = Vec::new();
    for p in paths {
        out.extend(parse_ledger_page(&p));
    }
    out
}

/// Port of `group_by_topic`. Preserves first-seen topic order (Python dict
/// insertion order via `defaultdict`).
pub fn group_by_topic(assertions: &[Assertion]) -> indexmap::IndexMap<String, Vec<Assertion>> {
    let mut by_topic: indexmap::IndexMap<String, Vec<Assertion>> = indexmap::IndexMap::new();
    for a in assertions {
        for t in &a.topics {
            by_topic.entry(t.clone()).or_default().push(a.clone());
        }
    }
    by_topic
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const SAMPLE_LEDGER: &str = "---\npublic: true\n---\n\n# AI Daily Brief — Test\n\n- **[Industry analysis]** Something happened. [[Topic A]] [[Topic B]]\n  tier:: 2\n  confidence:: 0.8\n  source:: Host\n  claim-date:: 2026-01-01\n  evidence:: Extra detail.\n  <!-- assertion-fp: abcdef0123456789 -->\n";

    #[test]
    fn episode_slug_strips_prefix() {
        let p = Path::new("/x/podcast-evidence___my-episode.md");
        assert_eq!(episode_slug_from_ledger(p), "my-episode");
    }

    #[test]
    fn parses_bullet_with_wikilinks_and_props() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("podcast-evidence___ep1.md");
        std::fs::write(&path, SAMPLE_LEDGER).unwrap();
        let assertions = parse_ledger_page(&path);
        assert_eq!(assertions.len(), 1);
        let a = &assertions[0];
        assert_eq!(a.claim, "Something happened.");
        assert_eq!(a.topics, vec!["Topic A".to_string(), "Topic B".to_string()]);
        assert_eq!(a.tier, "2");
        assert_eq!(a.confidence, "0.8");
        assert_eq!(a.source, "Host");
        assert_eq!(a.fp, "abcdef0123456789");
        assert_eq!(a.episode_slug, "ep1");
        assert_eq!(a.evidence, "Extra detail.");
    }

    #[test]
    fn skips_unmatched_topic_bullets() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("podcast-evidence___ep1.md");
        let content = "- A claim with no wikilinks.\n  tier:: 1\n  confidence:: 0.9\n  source:: Host\n  claim-date:: 2026-01-01\n  <!-- assertion-fp: 1111111111111111 -->\n";
        std::fs::write(&path, content).unwrap();
        assert!(parse_ledger_page(&path).is_empty());
    }

    #[test]
    fn group_by_topic_groups_multi_topic_bullets() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("podcast-evidence___ep1.md");
        std::fs::write(&path, SAMPLE_LEDGER).unwrap();
        let assertions = parse_ledger_page(&path);
        let grouped = group_by_topic(&assertions);
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped["Topic A"].len(), 1);
        assert_eq!(grouped["Topic B"].len(), 1);
    }

    const V2_LEDGER: &str = "---\ntype: Episode\ntitle: AI Daily Brief — V2\npublic: false\nstatus: stable\ngenerated:\n  by: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58Z\n---\n# AI Daily Brief — V2\n\n- **[Industry analysis]** A v2 claim. [[Topic A]]\n  **tier:** 2\n  **confidence:** 0.95\n  **source-authority:** primary\n  **claim-date:** 2025-12-18\n  **evidence:** The transcript states a thing.\n  <!-- assertion-fp: c18d8701c0f4b858 -->\n";

    #[test]
    fn parses_working_vault_bold_key_sublines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a-v2-episode.md");
        std::fs::write(&path, V2_LEDGER).unwrap();
        let assertions = parse_ledger_page(&path);
        assert_eq!(assertions.len(), 1);
        let a = &assertions[0];
        assert_eq!(a.claim, "A v2 claim.");
        assert_eq!(a.topics, vec!["Topic A".to_string()]);
        assert_eq!(a.tier, "2");
        assert_eq!(a.confidence, "0.95");
        assert_eq!(a.claim_date, "2025-12-18");
        assert_eq!(a.evidence, "The transcript states a thing.");
        assert_eq!(a.fp, "c18d8701c0f4b858");
        assert_eq!(a.episode_slug, "a-v2-episode", "the stem is the identity");
    }

    #[test]
    fn frontmatter_assertions_list_is_preferred_over_bullets() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("typed.md");
        let page = "---\ntype: Episode\nassertions:\n  - fingerprint: 5ce5c6ba18662930\n    claim: Typed claim.\n    topics: [AI Investment, Prometheus]\n    tier: 1\n    confidence: 0.95\n    source: The New York Times\n    claim-date: '2026-09-15'\n    evidence: Cited in the transcript.\n  - fingerprint: 0000000000000001\n    claim: No topics so it is skipped.\n    topics: []\n---\n\n- Bullet claim. [[Other Topic]]\n  **tier:** 1\n  <!-- assertion-fp: ffffffffffffffff -->\n";
        std::fs::write(&path, page).unwrap();
        let assertions = parse_ledger_page(&path);
        assert_eq!(assertions.len(), 1, "{assertions:?}");
        let a = &assertions[0];
        assert_eq!(a.claim, "Typed claim.");
        assert_eq!(
            a.topics,
            vec!["AI Investment".to_string(), "Prometheus".to_string()]
        );
        assert_eq!(a.tier, "1");
        assert_eq!(a.confidence, "0.95");
        assert_eq!(a.source, "The New York Times");
        assert_eq!(a.claim_date, "2026-09-15");
        assert_eq!(a.fp, "5ce5c6ba18662930");
    }

    #[test]
    fn ledger_dir_loader_reads_unprefixed_pages_and_ignores_other_files() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("ep-one.md"), V2_LEDGER).unwrap();
        std::fs::write(dir.path().join("notes.txt"), V2_LEDGER).unwrap();
        std::fs::create_dir(dir.path().join("sub.md")).unwrap();
        let assertions = load_ledger_dir_assertions(dir.path());
        assert_eq!(assertions.len(), 1);
        assert_eq!(assertions[0].episode_slug, "ep-one");
        // The flat loader would see nothing here: no `podcast-evidence___` prefix.
        assert!(load_all_assertions(dir.path()).is_empty());
    }
}
