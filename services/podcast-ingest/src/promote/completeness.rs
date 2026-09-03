//! Answer-completeness gate — port of `STOPWORDS`, `_normalize`,
//! `_long_words`, `matches_gold`, and `completeness_score` from
//! `promote.py`. See `references/promotion.md` §"Answer-completeness gate"
//! for the deliberate simplification versus the paper's full copy-ceiling
//! method (this is a bag-of-words coverage instrument, not a correctness
//! check).

use super::ledger_parse::Assertion;
use regex::Regex;
use serde_json::json;
use std::collections::HashSet;
use std::sync::OnceLock;

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "from", "into", "have", "has", "been", "were",
    "are", "was", "will", "would", "could", "should", "their", "they", "them", "which", "when",
    "what", "than", "then", "also", "such", "these", "those", "over", "more", "some", "even",
    "just", "like",
];

fn re_non_word() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^\w\s]").unwrap())
}
fn re_whitespace() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

/// Port of `_normalize`.
pub fn normalize(text: &str) -> String {
    let lowered = text.to_lowercase();
    let no_punct = re_non_word().replace_all(&lowered, " ");
    re_whitespace()
        .replace_all(&no_punct, " ")
        .trim()
        .to_string()
}

/// Port of `_long_words`.
pub fn long_words(text: &str) -> Vec<String> {
    normalize(text)
        .split_whitespace()
        .filter(|w| w.chars().count() >= 4 && !STOPWORDS.contains(w))
        .map(|w| w.to_string())
        .collect()
}

/// Port of `matches_gold`.
pub fn matches_gold(gold_claim: &str, shown_text: &str) -> bool {
    let norm_shown = normalize(shown_text);
    let norm_gold = normalize(gold_claim);
    if !norm_gold.is_empty() && norm_shown.contains(&norm_gold) {
        return true;
    }
    let words = long_words(gold_claim);
    if words.is_empty() {
        return false;
    }
    let shown_words: HashSet<&str> = norm_shown.split_whitespace().collect();
    let hits = words
        .iter()
        .filter(|w| shown_words.contains(w.as_str()))
        .count();
    (hits as f64 / words.len() as f64) >= 0.80
}

/// Port of `completeness_score`. Returns `(score, detail)`.
pub fn completeness_score(
    assertions: &[Assertion],
    spliced_content: &str,
) -> (f64, Vec<serde_json::Value>) {
    let mut detail = Vec::new();
    let mut hit = 0usize;
    for a in assertions {
        let matched = matches_gold(&a.claim, spliced_content);
        if matched {
            hit += 1;
        }
        let claim_truncated: String = a.claim.chars().take(120).collect();
        detail.push(json!({"fp": a.fp, "claim": claim_truncated, "matched": matched}));
    }
    let score = if assertions.is_empty() {
        0.0
    } else {
        hit as f64 / assertions.len() as f64
    };
    (score, detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assertion(claim: &str, fp: &str) -> Assertion {
        Assertion {
            claim: claim.to_string(),
            topics: vec![],
            tier: "1".to_string(),
            confidence: "0.9".to_string(),
            source: "Host".to_string(),
            fp: fp.to_string(),
            episode_slug: "ep1".to_string(),
            ledger_file: "podcast-evidence___ep1.md".to_string(),
            claim_date: "2026-01-01".to_string(),
            evidence: String::new(),
        }
    }

    #[test]
    fn normalize_strips_punctuation_and_collapses_whitespace() {
        assert_eq!(normalize("Hello,   World!!"), "hello world");
    }

    #[test]
    fn matches_gold_exact_substring() {
        assert!(matches_gold(
            "OpenAI released GPT-5",
            "text OpenAI released GPT-5 today"
        ));
    }

    #[test]
    fn matches_gold_by_word_coverage() {
        // 4/4 long words present (openai, released, models, today) => >=0.80
        assert!(matches_gold(
            "OpenAI released several models today",
            "today OpenAI models were released in a blog post"
        ));
    }

    #[test]
    fn matches_gold_false_when_insufficient_coverage() {
        assert!(!matches_gold(
            "OpenAI released several completely unrelated models today",
            "irrelevant text entirely"
        ));
    }

    #[test]
    fn completeness_score_computes_hit_ratio() {
        let assertions = vec![
            assertion("OpenAI released GPT-5", "fp1"),
            assertion("Completely unrelated claim about widgets", "fp2"),
        ];
        let (score, detail) = completeness_score(&assertions, "OpenAI released GPT-5 today");
        assert_eq!(score, 0.5);
        assert_eq!(detail.len(), 2);
    }

    #[test]
    fn completeness_score_empty_assertions_is_zero() {
        let (score, _) = completeness_score(&[], "any text");
        assert_eq!(score, 0.0);
    }
}
