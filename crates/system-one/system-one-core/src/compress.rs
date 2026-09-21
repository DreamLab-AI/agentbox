//! Deterministic rubric compression: making the 48-token cut deliberately
//! instead of letting the tokeniser make it.
//!
//! # Why
//!
//! The engine truncates every option to [`crate::budget::OPTION_TOKEN_CAP`]
//! tokens, tail-first, mid-sentence, unconditionally (`laya 0.3.4,
//! laya/common.py:build_sequence`). A skill description whose median length is
//! ~115 tokens therefore reaches the judge as its first ~40%, chosen by nothing
//! but position. If the clause that distinguishes this skill from its
//! neighbours happens to live in the second half — and in a "what it does; use
//! it when; do not use it when" description it usually does — the judge is
//! given the least discriminative part of the text.
//!
//! [`compress_rubric`] takes the cut back. It is deterministic (same input,
//! same output, no randomness, no locale), so the result can be cached
//! alongside the rubric's embedding and compared across runs.
//!
//! # The algorithm, in full
//!
//! 1. Collapse whitespace runs and trim.
//! 2. If the text already fits the cap, return it unchanged.
//! 3. Split into clauses at sentence and clause boundaries (`.`, `;`, `:`, `?`,
//!    `!`, newline, em- and en-dash, ` - `), keeping each clause's own text.
//! 4. Score each clause by **content density**: the count of distinct
//!    lower-cased content words (four or more characters, not in
//!    [`STOPWORDS`]) divided by the clause's estimated tokens. A clause of
//!    connective filler scores near zero; a clause naming the thing this option
//!    uniquely does scores high.
//! 5. Order clauses by descending density, then by descending content-word
//!    count, then by original position — a total order, so the result is stable.
//! 6. Take clauses greedily in that order while they fit the cap, and emit them
//!    **in that same order**, so the most discriminative clause is first and the
//!    cheapest to lose is last. This is the "front-loading" the budget rules
//!    require: whatever else happens downstream, position now tracks value.
//! 7. If even the top clause overflows, hard-truncate it on a word boundary.
//!
//! The output is never longer than the cap, whatever the input.
//!
//! ```
//! use system_one_core::compress::compress_rubric;
//!
//! let rubric = "Use this skill when the operator asks to rebuild the container image. \
//!               It is one of several available skills. \
//!               Invokes the Nix flake and waits for the supervisor to come back.";
//! let out = compress_rubric(rubric, 20);
//!
//! assert!(out.changed);
//! assert!(out.tokens <= 20);
//! // The filler clause loses to the two that name something.
//! assert!(!out.text.contains("one of several"));
//! ```

use crate::tokens::estimate_tokens;

/// Words too common to distinguish one option from another.
///
/// Deliberately short and English-only: this is a *ranking* aid inside a
/// deterministic compressor, not a linguistic model, and a longer list buys
/// accuracy in one language at the cost of silently mangling another. Text in a
/// language this list does not cover simply scores every word as content, which
/// degrades to "keep the densest clauses" — still deterministic, still safe.
pub const STOPWORDS: &[&str] = &[
    "that", "this", "with", "from", "have", "will", "your", "when", "what", "which", "into",
    "about", "there", "their", "them", "then", "than", "they", "been", "were", "also", "such",
    "only", "some", "more", "most", "other", "each", "over", "able", "used", "using", "use",
    "very", "just", "like", "make", "made", "does", "done", "should", "would", "could", "must",
    "these", "those", "here", "where", "while", "after", "before", "because", "however",
];

/// The outcome of compressing one rubric.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompressedRubric {
    /// The compressed text. Never exceeds the requested cap.
    pub text: String,
    /// Whether compression changed anything, whitespace normalisation included.
    pub changed: bool,
    /// Estimated tokens of [`CompressedRubric::text`].
    pub tokens: usize,
}

/// Compress `rubric` to at most `cap_tokens` estimated tokens, front-loading the
/// most discriminative clause.
///
/// A `cap_tokens` of zero is treated as one: an option with no text at all
/// cannot be judged, so the function always returns something.
///
/// ```
/// use system_one_core::compress::compress_rubric;
///
/// // Already short: returned unchanged.
/// let out = compress_rubric("routes voice input", 48);
/// assert_eq!(out.text, "routes voice input");
/// assert!(!out.changed);
///
/// // A single unbreakable clause is cut on a word boundary, not mid-word.
/// let out = compress_rubric("alpha bravo charlie delta echo foxtrot golf hotel", 4);
/// assert!(out.tokens <= 4);
/// assert!(!out.text.ends_with("fox"));
/// ```
#[must_use]
pub fn compress_rubric(rubric: &str, cap_tokens: usize) -> CompressedRubric {
    let cap = cap_tokens.max(1);
    let normalised = normalise(rubric);

    if estimate_tokens(&normalised) <= cap {
        let tokens = estimate_tokens(&normalised);
        return CompressedRubric {
            changed: normalised != rubric,
            text: normalised,
            tokens,
        };
    }

    let clauses = split_clauses(&normalised);
    let mut ranked: Vec<(usize, &str, f64, usize)> = clauses
        .iter()
        .enumerate()
        .map(|(index, clause)| {
            let (content, density) = score(clause);
            (index, *clause, density, content)
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.2.partial_cmp(&a.2)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.3.cmp(&a.3))
            .then(a.0.cmp(&b.0))
    });

    let mut kept: Vec<&str> = Vec::new();
    let mut budget = cap;
    for (_, clause, _, _) in &ranked {
        let cost = estimate_tokens(clause) + usize::from(!kept.is_empty());
        if cost <= budget {
            kept.push(clause);
            budget -= cost;
        }
    }

    let text = if kept.is_empty() {
        // Not even the best clause fits: cut it on a word boundary.
        truncate_to_tokens(ranked.first().map_or(normalised.as_str(), |r| r.1), cap)
    } else {
        kept.join(" ")
    };

    let text = truncate_to_tokens(&text, cap);
    let tokens = estimate_tokens(&text);
    CompressedRubric {
        changed: text != rubric,
        text,
        tokens,
    }
}

/// Collapse every whitespace run to a single space and trim.
fn normalise(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(ch);
        }
    }
    out
}

/// Split normalised text into clauses at sentence and clause boundaries.
///
/// The terminator stays with the clause it ends, so rejoining kept clauses
/// produces readable text rather than a run-on.
fn split_clauses(text: &str) -> Vec<&str> {
    let bytes_len = text.len();
    let mut clauses = Vec::new();
    let mut start = 0usize;
    let mut chars = text.char_indices().peekable();

    while let Some((index, ch)) = chars.next() {
        let boundary = match ch {
            '.' | ';' | '?' | '!' | ':' => chars
                .peek()
                .is_none_or(|(_, next)| next.is_whitespace() || *next == '"'),
            '—' | '–' => true,
            '-' => {
                index > 0
                    && text[..index].ends_with(' ')
                    && chars.peek().is_some_and(|(_, next)| *next == ' ')
            }
            _ => false,
        };
        if boundary {
            let end = index + ch.len_utf8();
            let clause = text[start..end].trim();
            if !clause.is_empty() {
                clauses.push(clause);
            }
            start = end;
        }
    }

    if start < bytes_len {
        let clause = text[start..].trim();
        if !clause.is_empty() {
            clauses.push(clause);
        }
    }
    if clauses.is_empty() {
        clauses.push(text);
    }
    clauses
}

/// `(distinct content words, content density)` for a clause.
fn score(clause: &str) -> (usize, f64) {
    let mut seen: Vec<String> = Vec::new();
    for word in clause.split(|c: char| !c.is_alphanumeric()) {
        if word.chars().count() < 4 {
            continue;
        }
        let lower = word.to_lowercase();
        if STOPWORDS.contains(&lower.as_str()) || seen.contains(&lower) {
            continue;
        }
        seen.push(lower);
    }
    let tokens = estimate_tokens(clause).max(1);
    #[allow(clippy::cast_precision_loss)]
    let density = seen.len() as f64 / tokens as f64;
    (seen.len(), density)
}

/// Cut `text` to at most `cap_tokens` estimated tokens, preferring a word
/// boundary and never splitting a character.
///
/// ```
/// use system_one_core::compress::truncate_to_tokens;
/// use system_one_core::tokens::estimate_tokens;
///
/// let out = truncate_to_tokens("日本語のテキストをここで切ります", 3);
/// assert!(estimate_tokens(&out) <= 3);
/// ```
#[must_use]
pub fn truncate_to_tokens(text: &str, cap_tokens: usize) -> String {
    let cap = cap_tokens.max(1);
    if estimate_tokens(text) <= cap {
        return text.to_owned();
    }
    let max_chars = crate::tokens::chars_for_tokens(cap);

    // Char-boundary-safe: take whole characters, never bytes.
    let end_byte = text
        .char_indices()
        .nth(max_chars)
        .map_or(text.len(), |(byte, _)| byte);
    let head = &text[..end_byte];

    let cut = head
        .rfind(char::is_whitespace)
        .filter(|at| *at > 0)
        .unwrap_or(head.len());
    head[..cut].trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_never_exceeds_the_cap() {
        let rubric = "Rebuilds the container image from the Nix flake; waits for supervisord; \
                      reports the manifest diff. Use when the operator says rebuild. \
                      Do not use for a source-only restart — that is the up path.";
        for cap in 1..=64usize {
            let out = compress_rubric(rubric, cap);
            assert!(out.tokens <= cap, "cap={cap} got={}", out.tokens);
            assert_eq!(out.tokens, estimate_tokens(&out.text));
        }
    }

    #[test]
    fn short_text_is_returned_unchanged() {
        let out = compress_rubric("routes voice input to the bridge", 48);
        assert_eq!(out.text, "routes voice input to the bridge");
        assert!(!out.changed);
    }

    #[test]
    fn whitespace_is_normalised_and_reported_as_a_change() {
        let out = compress_rubric("  routes   voice\n\ninput ", 48);
        assert_eq!(out.text, "routes voice input");
        assert!(out.changed);
    }

    #[test]
    fn it_is_deterministic() {
        let rubric = "Alpha clause names a thing. Beta clause is mostly filler that will \
                      have been of the and to. Gamma clause names another distinct thing.";
        let first = compress_rubric(rubric, 24);
        for _ in 0..50 {
            assert_eq!(compress_rubric(rubric, 24), first);
        }
    }

    #[test]
    fn the_densest_clause_is_emitted_first() {
        let rubric = "It is one of the things that you would have been able to use. \
                      Transcodes Opus audio into Whisper-ready PCM frames.";
        let out = compress_rubric(rubric, 14);
        assert!(out.text.starts_with("Transcodes"), "got {:?}", out.text);
    }

    #[test]
    fn multibyte_text_is_never_split_mid_character() {
        let rubric = "日本語のルーブリック、これは非常に長い説明です。".repeat(10);
        for cap in 1..=48usize {
            let out = compress_rubric(&rubric, cap);
            assert!(out.tokens <= cap);
            assert!(std::str::from_utf8(out.text.as_bytes()).is_ok());
        }
    }

    #[test]
    fn a_single_unbreakable_clause_is_cut_on_a_word_boundary() {
        let out = compress_rubric("alpha bravo charlie delta echo foxtrot golf hotel", 4);
        assert!(out.tokens <= 4);
        assert!(!out.text.is_empty());
        assert!(out.text.split(' ').all(|w| {
            [
                "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
            ]
            .contains(&w)
        }));
    }

    #[test]
    fn empty_input_is_handled() {
        let out = compress_rubric("", 48);
        assert_eq!(out.text, "");
        assert_eq!(out.tokens, 0);
    }

    #[test]
    fn clause_splitting_keeps_terminators() {
        assert_eq!(
            split_clauses("One thing. Two things; three — four - five"),
            vec!["One thing.", "Two things;", "three —", "four -", "five"]
        );
    }

    #[test]
    fn a_decimal_point_is_not_a_clause_boundary() {
        assert_eq!(split_clauses("costs 0.63 cents"), vec!["costs 0.63 cents"]);
    }
}
