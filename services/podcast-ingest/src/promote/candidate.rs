//! Candidacy detection — port of `Candidate`, `target_page_name`, and
//! `find_candidates` from `promote.py`.

use super::ledger_parse::{group_by_topic, load_all_assertions, Assertion};
use crate::common::sha256_hex_prefix;
use regex::Regex;
use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

fn re_non_word_dash() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^\w-]").unwrap())
}
fn re_path_sep() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[/\\]").unwrap())
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub topic: String,
    pub assertions: Vec<Assertion>,
}

impl Candidate {
    pub fn episodes(&self) -> HashSet<String> {
        self.assertions
            .iter()
            .map(|a| a.episode_slug.clone())
            .collect()
    }

    pub fn fingerprints(&self) -> HashSet<String> {
        self.assertions.iter().map(|a| a.fp.clone()).collect()
    }

    /// Sorted fingerprint list — used wherever the Python original calls
    /// `sorted(candidate.fingerprints)`.
    pub fn sorted_fingerprints(&self) -> Vec<String> {
        let mut v: Vec<String> = self.fingerprints().into_iter().collect();
        v.sort();
        v
    }

    pub fn sorted_episodes(&self) -> Vec<String> {
        let mut v: Vec<String> = self.episodes().into_iter().collect();
        v.sort();
        v
    }

    /// Port of `Candidate.slug()`.
    pub fn slug(&self) -> String {
        let s = self.topic.to_lowercase().replace(' ', "-");
        let cleaned = re_non_word_dash().replace_all(&s, "").to_string();
        if cleaned == s && cleaned.chars().count() <= 80 {
            return cleaned;
        }
        let digest = sha256_hex_prefix(self.topic.as_bytes(), 8);
        if cleaned.is_empty() {
            digest
        } else {
            let truncated: String = cleaned.chars().take(80).collect();
            format!("{truncated}-{digest}")
        }
    }
}

/// Port of `target_page_name`.
pub fn target_page_name(topic: &str) -> String {
    format!("{}.md", re_path_sep().replace_all(topic, "_"))
}

/// Port of `find_candidates`.
pub fn find_candidates(
    pages_dir: &Path,
    min_assertions: usize,
    min_episodes: usize,
) -> Vec<Candidate> {
    let assertions = load_all_assertions(pages_dir);
    let by_topic = group_by_topic(&assertions);

    let mut candidates: Vec<Candidate> = Vec::new();
    for (topic, items) in by_topic {
        let episodes: HashSet<String> = items.iter().map(|a| a.episode_slug.clone()).collect();
        if items.len() >= min_assertions && episodes.len() >= min_episodes {
            candidates.push(Candidate {
                topic,
                assertions: items,
            });
        }
    }
    candidates.sort_by(|a, b| {
        b.assertions
            .len()
            .cmp(&a.assertions.len())
            .then_with(|| a.topic.cmp(&b.topic))
    });
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_ledger(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn slug_lowercases_and_dashes() {
        let c = Candidate {
            topic: "Advertising".to_string(),
            assertions: vec![],
        };
        assert_eq!(c.slug(), "advertising");
    }

    #[test]
    fn slug_strips_non_word_chars_and_appends_digest_when_lossy() {
        // "/" and "!" get stripped, so cleaned != the pre-strip string —
        // per Candidate::slug() this is a *lossy* sanitisation, which must
        // be disambiguated with a topic-digest suffix rather than returned
        // bare (two different topics could otherwise collide on one slug).
        let c = Candidate {
            topic: "AI/ML Trends!".to_string(),
            assertions: vec![],
        };
        let slug = c.slug();
        assert!(slug.starts_with("aiml-trends-"));
        assert_eq!(
            slug.len(),
            "aiml-trends-".len() + 8,
            "must end in an 8-hex-char digest"
        );
    }

    #[test]
    fn slug_is_bare_when_sanitisation_is_lossless() {
        let c = Candidate {
            topic: "AI Hardware".to_string(),
            assertions: vec![],
        };
        assert_eq!(c.slug(), "ai-hardware");
    }

    #[test]
    fn target_page_name_replaces_path_separators() {
        assert_eq!(target_page_name("AI/ML"), "AI_ML.md");
        assert_eq!(target_page_name("Advertising"), "Advertising.md");
    }

    #[test]
    fn find_candidates_requires_min_assertions_and_episodes() {
        let dir = tempdir().unwrap();
        let bullet = |fp: &str| {
            format!(
                "- Claim {fp}. [[Beta Topic]]\n  tier:: 1\n  confidence:: 0.9\n  source:: Host\n  claim-date:: 2026-01-01\n  <!-- assertion-fp: {fp} -->\n"
            )
        };
        write_ledger(
            dir.path(),
            "podcast-evidence___ep-b.md",
            &format!(
                "{}{}{}",
                bullet("1111111111111111"),
                bullet("2222222222222222"),
                bullet("3333333333333333")
            ),
        );
        write_ledger(
            dir.path(),
            "podcast-evidence___ep-c.md",
            &format!(
                "{}{}",
                bullet("4444444444444444"),
                bullet("5555555555555555")
            ),
        );

        let candidates = find_candidates(dir.path(), 5, 2);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].topic, "Beta Topic");
        assert_eq!(candidates[0].assertions.len(), 5);
    }

    #[test]
    fn find_candidates_rejects_single_episode() {
        let dir = tempdir().unwrap();
        let mut content = String::new();
        for i in 0..6 {
            content.push_str(&format!(
                "- Claim {i}. [[Alpha Topic]]\n  tier:: 1\n  confidence:: 0.9\n  source:: Host\n  claim-date:: 2026-01-01\n  <!-- assertion-fp: {i:016x} -->\n"
            ));
        }
        write_ledger(dir.path(), "podcast-evidence___ep-a.md", &content);
        let candidates = find_candidates(dir.path(), 5, 2);
        assert!(candidates.is_empty());
    }
}
