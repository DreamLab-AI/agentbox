//! `LinkValidator` — wiki-link validation and automatic fixing for ontology
//! files.
//!
//! Detects broken `[[wiki-link]]` references and suggests/applies fixes via
//! Levenshtein-distance fuzzy matching against `*.md` files under the
//! knowledge-graph root.
//!
//! Ported from `skills/ontology-enrich/src/link_validator.py`.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::markdown::find_wiki_links;

/// Report of link validation results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkReport {
    pub file_path: String,
    pub total_links: usize,
    pub valid_links: usize,
    pub broken_links: Vec<String>,
    pub suggestions: std::collections::BTreeMap<String, String>,
    pub fixes_applied: usize,
}

/// Validator for wiki-link references in ontology files.
pub struct LinkValidator {
    /// Root directory for knowledge graph pages.
    kg_root: PathBuf,
}

impl Default for LinkValidator {
    fn default() -> Self {
        Self::new("")
    }
}

impl LinkValidator {
    /// Initialise a link validator.
    ///
    /// `knowledge_graph_root` defaults to `$VAULT_PAGES` — the `[vault]`
    /// path authority resolved from `agentbox.toml` (ADR-2028) — when empty.
    /// Never a hard-coded corpus path (ADR-2028).
    pub fn new(knowledge_graph_root: &str) -> Self {
        let root = if knowledge_graph_root.is_empty() {
            env::var("VAULT_PAGES").unwrap_or_default()
        } else {
            knowledge_graph_root.to_string()
        };
        Self {
            kg_root: PathBuf::from(root),
        }
    }

    /// Validate all wiki-links in a file.
    pub fn validate_links(&self, file_path: &Path) -> std::io::Result<LinkReport> {
        let content = fs::read_to_string(file_path)?;
        let links = find_wiki_links(&content);

        if links.is_empty() {
            return Ok(LinkReport {
                file_path: file_path.display().to_string(),
                total_links: 0,
                valid_links: 0,
                broken_links: vec![],
                suggestions: Default::default(),
                fixes_applied: 0,
            });
        }

        let mut broken = Vec::new();
        let mut suggestions = std::collections::BTreeMap::new();

        for link in &links {
            if !self.link_exists(link) {
                broken.push(link.clone());
                if let (Some(suggestion), _confidence) =
                    self.suggest_alternative_with_confidence(link)
                {
                    suggestions.insert(link.clone(), suggestion);
                }
            }
        }

        let valid_count = links.len() - broken.len();

        Ok(LinkReport {
            file_path: file_path.display().to_string(),
            total_links: links.len(),
            valid_links: valid_count,
            broken_links: broken,
            suggestions,
            fixes_applied: 0,
        })
    }

    /// Automatically fix broken links with high-confidence suggestions.
    pub fn auto_fix_links(
        &self,
        file_path: &Path,
        broken_links: &[String],
        confidence_threshold: f64,
    ) -> std::io::Result<LinkReport> {
        let mut content = fs::read_to_string(file_path)?;
        let mut fixes_applied = 0usize;
        let mut suggestions = std::collections::BTreeMap::new();

        for broken in broken_links {
            let (suggestion, confidence) = self.suggest_alternative_with_confidence(broken);

            if let Some(suggestion) = suggestion {
                if confidence >= confidence_threshold {
                    let old_link = format!("[[{broken}]]");
                    let new_link = format!("[[{suggestion}]]");
                    content = content.replace(&old_link, &new_link);
                    fixes_applied += 1;
                    suggestions.insert(broken.clone(), suggestion);
                } else {
                    suggestions.insert(broken.clone(), suggestion);
                }
            }
        }

        if fixes_applied > 0 {
            fs::write(file_path, &content)?;
        }

        let mut final_report = self.validate_links(file_path)?;
        final_report.fixes_applied = fixes_applied;
        final_report.suggestions = suggestions;

        Ok(final_report)
    }

    /// Check whether a wiki-link target exists as `<kg_root>/<target>.md`.
    fn link_exists(&self, link_target: &str) -> bool {
        self.kg_root.join(format!("{link_target}.md")).exists()
    }

    fn suggest_alternative_with_confidence(&self, broken_link: &str) -> (Option<String>, f64) {
        if !self.kg_root.exists() {
            return (None, 0.0);
        }

        let Ok(entries) = fs::read_dir(&self.kg_root) else {
            return (None, 0.0);
        };

        let mut scores: Vec<(String, f64)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let similarity = calculate_similarity(broken_link, stem);
            scores.push((stem.to_string(), similarity));
        }

        if scores.is_empty() {
            return (None, 0.0);
        }

        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let (best_match, confidence) = scores[0].clone();

        if confidence < 0.5 {
            return (None, confidence);
        }

        (Some(best_match), confidence)
    }
}

/// Calculate similarity between two strings (1.0 = identical), using
/// normalised Levenshtein distance with exact/substring short-circuits.
///
/// Ported from `_calculate_similarity`.
fn calculate_similarity(str1: &str, str2: &str) -> f64 {
    let s1 = str1.to_lowercase();
    let s2 = str2.to_lowercase();

    if s1 == s2 {
        return 1.0;
    }
    if s2.contains(&s1) || s1.contains(&s2) {
        return 0.85;
    }

    let distance = levenshtein_distance(&s1, &s2);
    let max_len = s1.chars().count().max(s2.chars().count());
    if max_len == 0 {
        return 1.0;
    }

    1.0 - (distance as f64 / max_len as f64)
}

/// Ported from `_levenshtein_distance`.
fn levenshtein_distance(s1: &str, s2: &str) -> usize {
    let s1: Vec<char> = s1.chars().collect();
    let s2: Vec<char> = s2.chars().collect();

    if s1.len() < s2.len() {
        return levenshtein_distance(
            &s2.iter().collect::<String>(),
            &s1.iter().collect::<String>(),
        );
    }
    if s2.is_empty() {
        return s1.len();
    }

    let mut previous_row: Vec<usize> = (0..=s2.len()).collect();
    for (i, c1) in s1.iter().enumerate() {
        let mut current_row = vec![i + 1];
        for (j, c2) in s2.iter().enumerate() {
            let insertions = previous_row[j + 1] + 1;
            let deletions = current_row[j] + 1;
            let substitutions = previous_row[j] + usize::from(c1 != c2);
            current_row.push(insertions.min(deletions).min(substitutions));
        }
        previous_row = current_row;
    }

    *previous_row.last().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similarity_exact_match() {
        assert_eq!(calculate_similarity("Bitcoin", "bitcoin"), 1.0);
    }

    #[test]
    fn similarity_substring_match() {
        assert_eq!(calculate_similarity("Bitcoin", "Bitcoin_Cash"), 0.85);
    }

    #[test]
    fn similarity_levenshtein_fallback() {
        let s = calculate_similarity("Blockchain", "Blockhain");
        assert!(s > 0.5 && s < 1.0);
    }

    #[test]
    fn levenshtein_basic_cases() {
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("", "abc"), 3);
        assert_eq!(levenshtein_distance("abc", "abc"), 0);
    }

    #[test]
    fn validate_links_no_links_found() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.md");
        fs::write(&file, "no links here").unwrap();
        let validator = LinkValidator::new(dir.path().to_str().unwrap());
        let report = validator.validate_links(&file).unwrap();
        assert_eq!(report.total_links, 0);
    }

    #[test]
    fn validate_links_detects_broken_and_valid() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Existing.md"), "# Existing").unwrap();
        let file = dir.path().join("test.md");
        fs::write(&file, "See [[Existing]] and [[Missing]]").unwrap();
        let validator = LinkValidator::new(dir.path().to_str().unwrap());
        let report = validator.validate_links(&file).unwrap();
        assert_eq!(report.total_links, 2);
        assert_eq!(report.valid_links, 1);
        assert_eq!(report.broken_links, vec!["Missing".to_string()]);
    }

    #[test]
    fn auto_fix_links_replaces_high_confidence_matches() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Bitcoin.md"), "# Bitcoin").unwrap();
        let file = dir.path().join("test.md");
        fs::write(&file, "See [[bitcoin]]").unwrap();
        let validator = LinkValidator::new(dir.path().to_str().unwrap());
        let report = validator.validate_links(&file).unwrap();
        assert_eq!(report.broken_links, vec!["bitcoin".to_string()]);

        let fixed = validator
            .auto_fix_links(&file, &report.broken_links, 0.8)
            .unwrap();
        assert_eq!(fixed.fixes_applied, 1);
        let content = fs::read_to_string(&file).unwrap();
        assert!(content.contains("[[Bitcoin]]"));
    }
}
