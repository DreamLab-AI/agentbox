//! Phase 2 per-sentence source matching — port of `PUBLICATIONS`,
//! `RESEARCH_FIRMS`, `AI_COMPANIES`, `FALSE_POSITIVES`, and
//! `extract_sources` from `bulk_ingest.py`. The file-level driver
//! (`run_extraction`) lives in [`super::extraction`], split out purely to
//! keep both files under the crate's 500-line-per-file limit.
//!
//! Source names are interpolated into each regex pattern **unescaped** —
//! matching the Python originals' `rf'{pub}...'` f-strings, which do not
//! `re.escape()` the name either (so e.g. `"01.AI"`'s `.` matches any
//! character, exactly as in the Python behaviour being ported).

use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::sync::OnceLock;

const PUBLICATIONS: &[&str] = &[
    "Bloomberg",
    "Financial Times",
    "The New York Times",
    "New York Times",
    "NYT",
    "Wall Street Journal",
    "WSJ",
    "Reuters",
    "The Information",
    "The Verge",
    "TechCrunch",
    "Wired",
    "Ars Technica",
    "MIT Technology Review",
    "Nature",
    "Science",
    "ArXiv",
    "The Economist",
    "Forbes",
    "Fortune",
    "CNBC",
    "Washington Post",
    "Politico",
    "Axios",
    "Semafor",
    "404 Media",
    "The Atlantic",
    "Vox",
    "Business Insider",
    "Insider",
    "Fast Company",
    "Hacker News",
    "SemiAnalysis",
    "China Talk",
    "Brookings",
    "RAND",
];

const RESEARCH_FIRMS: &[&str] = &[
    "McKinsey",
    "Deloitte",
    "BCG",
    "Boston Consulting",
    "PwC",
    "KPMG",
    "Accenture",
    "Gartner",
    "Forrester",
    "IDC",
    "Bain",
    "Goldman Sachs",
    "Morgan Stanley",
    "JP Morgan",
    "Bank of America",
    "Bernstein",
    "Stanford",
    "MIT",
    "Harvard",
    "Oxford",
    "Cambridge",
    "Berkeley",
    "Carnegie Mellon",
    "Google DeepMind",
    "DeepMind",
];

const AI_COMPANIES: &[&str] = &[
    "OpenAI",
    "Anthropic",
    "Google",
    "Meta",
    "Microsoft",
    "Amazon",
    "Apple",
    "Nvidia",
    "xAI",
    "Mistral",
    "Cohere",
    "Stability",
    "Midjourney",
    "Hugging Face",
    "Databricks",
    "Snowflake",
    "Scale AI",
    "Anysphere",
    "Cursor",
    "Cognition",
    "Devin",
    "Perplexity",
    "Character AI",
    "Inflection",
    "Adept",
    "Runway",
    "ElevenLabs",
    "Suno",
    "ByteDance",
    "Alibaba",
    "Tencent",
    "Baidu",
    "Moonshot",
    "DeepSeek",
    "Zhipu",
    "01.AI",
];

pub const FALSE_POSITIVES: &[&str] = &[
    "he", "she", "they", "it", "we", "i", "who", "that", "this", "when he",
];

fn ci_regex(pattern: &str) -> Regex {
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .expect("valid regex")
}

struct SourceMatcher {
    name: &'static str,
    patterns: Vec<Regex>,
    kind: &'static str,
}

fn publication_matchers() -> &'static Vec<SourceMatcher> {
    static M: OnceLock<Vec<SourceMatcher>> = OnceLock::new();
    M.get_or_init(|| {
        PUBLICATIONS
            .iter()
            .map(|&pub_| SourceMatcher {
                name: pub_,
                kind: "article",
                patterns: vec![
                    ci_regex(&format!(r"{pub_}\s+(?:reports?|reported|reporting|wrote|writes|says?|said|notes?|noted|found|reveals?|revealed)")),
                    ci_regex(&format!(r"(?:according to|per|via|from|in)\s+(?:a\s+)?(?:new\s+)?{pub_}")),
                    ci_regex(&format!(r"{pub_}\s+(?:article|piece|story|report|analysis|investigation|interview|survey|study)")),
                ],
            })
            .collect()
    })
}

fn research_firm_matchers() -> &'static Vec<SourceMatcher> {
    static M: OnceLock<Vec<SourceMatcher>> = OnceLock::new();
    M.get_or_init(|| {
        RESEARCH_FIRMS
            .iter()
            .map(|&firm| SourceMatcher {
                name: firm,
                kind: "report",
                patterns: vec![
                    ci_regex(&format!(r"{firm}\s+(?:report|study|survey|research|analysis|paper|found|estimates?|projects?)")),
                    ci_regex(&format!(r"(?:according to|per|from)\s+{firm}")),
                    ci_regex(&format!(r"(?:new|latest|recent)\s+{firm}\s+(?:report|study|survey)")),
                ],
            })
            .collect()
    })
}

fn ai_company_matchers() -> &'static Vec<SourceMatcher> {
    static M: OnceLock<Vec<SourceMatcher>> = OnceLock::new();
    M.get_or_init(|| {
        AI_COMPANIES
            .iter()
            .map(|&company| SourceMatcher {
                name: company,
                kind: "announcement",
                patterns: vec![
                    ci_regex(&format!(r"{company}\s+(?:announced|released|launched|published|unveiled|introduced|posted|wrote|shared|blogged)")),
                    ci_regex(&format!(r"{company}(?:'s|s)?\s+(?:blog|post|announcement|press release|paper|system card|safety report)")),
                ],
            })
            .collect()
    })
}

fn re_sentence_split() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[.!?]+").unwrap())
}
fn re_quote() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        RegexBuilder::new("(\\w+(?:\\s\\w+)?)\\s+(?:wrote|said|posted|tweeted|noted|added|argued|suggested|responded|commented),?\\s*[\"\u{201c}](.{20,200}?)[\"\u{201d}]")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}
fn re_social_hint(idx: usize) -> &'static Regex {
    static M0: OnceLock<Regex> = OnceLock::new();
    static M1: OnceLock<Regex> = OnceLock::new();
    match idx {
        0 => M0.get_or_init(|| ci_regex(r"(?:on X|on Twitter|posted on X|tweeted)")),
        _ => M1.get_or_init(|| ci_regex(r"@\w+\s+(?:wrote|said|posted|noted)")),
    }
}
fn re_social_name() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| ci_regex(r"(\w+(?:\s\w+)?)\s+(?:posted on X|tweeted|wrote on X)"))
}

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Port of `extract_sources`.
pub fn extract_sources(transcript: &str, title: &str) -> Vec<Value> {
    let mut sources: Vec<Value> = Vec::new();

    for sent in re_sentence_split().split(transcript) {
        let sent = sent.trim();
        if sent.chars().count() < 20 {
            continue;
        }

        for m in publication_matchers() {
            if m.patterns.iter().any(|p| p.is_match(sent)) {
                sources.push(json!({"source": m.name, "type": m.kind, "context": truncate_chars(sent, 300), "episode": title}));
            }
        }
        for m in research_firm_matchers() {
            if m.patterns.iter().any(|p| p.is_match(sent)) {
                sources.push(json!({"source": m.name, "type": m.kind, "context": truncate_chars(sent, 300), "episode": title}));
            }
        }
        for m in ai_company_matchers() {
            if m.patterns.iter().any(|p| p.is_match(sent)) {
                sources.push(json!({"source": m.name, "type": m.kind, "context": truncate_chars(sent, 300), "episode": title}));
            }
        }

        for caps in re_quote().captures_iter(sent) {
            let source = caps[1].trim().to_string();
            let context = truncate_chars(&caps[2], 200);
            sources.push(
                json!({"source": source, "type": "quote", "context": context, "episode": title}),
            );
        }

        for idx in 0..2 {
            if re_social_hint(idx).is_match(sent) {
                let source = re_social_name()
                    .captures(sent)
                    .map(|c| c[1].to_string())
                    .unwrap_or_else(|| "X post".to_string());
                sources.push(json!({"source": source, "type": "social", "context": truncate_chars(sent, 300), "episode": title}));
                break;
            }
        }
    }

    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut deduped = Vec::new();
    for s in sources {
        let source_lower = s
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let type_ = s
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key = (source_lower.clone(), type_);
        if !seen.contains(&key) && !FALSE_POSITIVES.contains(&source_lower.as_str()) {
            seen.insert(key);
            deduped.push(s);
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_publication_source() {
        let transcript = "Bloomberg reported that the deal closed yesterday according to sources.";
        let sources = extract_sources(transcript, "Ep 1");
        assert!(sources
            .iter()
            .any(|s| s["source"] == "Bloomberg" && s["type"] == "article"));
    }

    #[test]
    fn extracts_ai_company_announcement() {
        let transcript =
            "OpenAI announced a new model today with impressive capabilities across benchmarks.";
        let sources = extract_sources(transcript, "Ep 1");
        assert!(sources
            .iter()
            .any(|s| s["source"] == "OpenAI" && s["type"] == "announcement"));
    }

    #[test]
    fn extracts_quote_with_straight_quotes() {
        let transcript =
            "Sam Altman said \"this changes everything for developers everywhere\" at the event.";
        let sources = extract_sources(transcript, "Ep 1");
        assert!(sources.iter().any(|s| s["type"] == "quote"));
    }

    #[test]
    fn deduplicates_by_source_and_type() {
        let transcript =
            "Bloomberg reported the news. Later, Bloomberg reported more details on the story.";
        let sources = extract_sources(transcript, "Ep 1");
        let count = sources
            .iter()
            .filter(|s| s["source"] == "Bloomberg")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn filters_false_positive_pronoun_sources() {
        let transcript = "He said this was a big deal for everyone involved in the industry today.";
        let sources = extract_sources(transcript, "Ep 1");
        assert!(!sources
            .iter()
            .any(|s| s["source"].as_str().map(|x| x.to_lowercase()) == Some("he".to_string())));
    }

    #[test]
    fn short_sentences_are_skipped() {
        let sources = extract_sources("Short. Also short.", "Ep 1");
        assert!(sources.is_empty());
    }
}
