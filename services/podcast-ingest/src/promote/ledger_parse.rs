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
fn re_prop_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^  ([a-zA-Z0-9_-]+):: (.*)$").unwrap())
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

/// Port of `parse_ledger_page`.
pub fn parse_ledger_page(path: &Path) -> Vec<Assertion> {
    let bytes = std::fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let episode_slug = episode_slug_from_ledger(path);
    let ledger_file = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
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
            props.insert(pm[1].to_string(), pm[2].trim().to_string());
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

/// Port of `load_all_assertions`.
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
}
