//! Slug and text-normalisation helpers shared by all three binaries.
//!
//! Ported from `slugify()` in both `ingest.py` and `bulk_ingest.py` (the two
//! copies were byte-identical in Python; here they share one implementation).

use regex::Regex;
use std::sync::OnceLock;

fn re_strip() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^\w\s-]").unwrap())
}

fn re_whitespace_underscore() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[\s_]+").unwrap())
}

fn re_dash_run() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"-+").unwrap())
}

/// Python:
/// ```python
/// def slugify(title: str, max_len: int = 80) -> str:
///     s = title.lower().strip()
///     s = re.sub(r'[^\w\s-]', '', s)
///     s = re.sub(r'[\s_]+', '-', s)
///     s = re.sub(r'-+', '-', s).strip('-')
///     return s[:max_len]
/// ```
pub fn slugify(title: &str, max_len: usize) -> String {
    let lowered = title.to_lowercase();
    let trimmed = lowered.trim();
    let no_punct = re_strip().replace_all(trimmed, "");
    let dashed = re_whitespace_underscore().replace_all(&no_punct, "-");
    let collapsed = re_dash_run().replace_all(&dashed, "-");
    let stripped = collapsed.trim_matches('-');
    stripped.chars().take(max_len).collect()
}

/// Default `max_len` of 80, matching the Python default parameter.
pub fn slugify_default(title: &str) -> String {
    slugify(title, 80)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_slugify() {
        assert_eq!(
            slugify_default("The 5-Minute AI Weekly Recap: Realignment Week"),
            "the-5-minute-ai-weekly-recap-realignment-week"
        );
    }

    #[test]
    fn collapses_underscores_and_dashes() {
        assert_eq!(slugify_default("a__b---c"), "a-b-c");
    }

    #[test]
    fn strips_punctuation() {
        assert_eq!(slugify_default("Hello, World!!"), "hello-world");
    }

    #[test]
    fn truncates_to_max_len() {
        let long = "a".repeat(100);
        assert_eq!(slugify(&long, 10).len(), 10);
    }
}
