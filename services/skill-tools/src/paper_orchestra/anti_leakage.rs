//! Post-hoc anti-leakage gate (derived from `anti_leakage_check.py`).
//!
//! Greps a generated paper for artefacts the Universal Anti-Leakage Prompt
//! forbids: email addresses, "corresponding author" phrases, affiliation
//! tokens and author-list patterns in the title block. It is a safety net, not
//! a substitute for the prompt. Comments are scanned too: arXiv publishes
//! source comments verbatim.

use std::sync::LazyLock;

use regex::Regex;

static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-.]+").expect("email regex")
});
static CORR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)corresponding\s+author|correspondence\s+to").expect("corr regex")
});
static AUTHOR_LIST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?:[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*\^\d+|\s*\$\^\{\d+\}\$)?(?:\s*,\s*|\s+and\s+)){2,}[A-Z][a-z]+\s+[A-Z][a-z]+",
    )
    .expect("author list regex")
});
static BEGIN_DOC_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\begin\{document\}").expect("begin regex"));
static SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\section\b").expect("section regex"));

/// Affiliation tokens that signal a de-anonymised title block.
pub const AFFILIATION_TOKENS: &[&str] = &[
    "Google",
    "OpenAI",
    "Microsoft",
    "DeepMind",
    "Meta AI",
    "FAIR",
    "Anthropic",
    "Stanford",
    "MIT",
    "Berkeley",
    "CMU",
    "Tsinghua",
    "Peking University",
    "Cornell",
];

/// The region between `\begin{document}` (or the top) and the first `\section`
/// (or 4000 bytes, snapped to a character boundary).
#[must_use]
pub fn title_block(text: &str) -> &str {
    let start = BEGIN_DOC_RE.find(text).map_or(0, |m| m.end());
    let end = match SECTION_RE.find(&text[start..]) {
        Some(m) => start + m.start(),
        None => {
            let mut e = (start + 4000).min(text.len());
            while !text.is_char_boundary(e) {
                e -= 1;
            }
            e
        }
    };
    &text[start..end]
}

/// Lists every leak found in `text`, one description per finding.
#[must_use]
pub fn find_leaks(text: &str) -> Vec<String> {
    let mut leaks = Vec::new();
    for m in EMAIL_RE.find_iter(text) {
        leaks.push(format!("email: {}", m.as_str()));
    }
    for m in CORR_RE.find_iter(text) {
        let mut s = m.start().saturating_sub(30);
        while !text.is_char_boundary(s) {
            s -= 1;
        }
        let mut e = (m.end() + 30).min(text.len());
        while !text.is_char_boundary(e) {
            e += 1;
        }
        leaks.push(format!(
            "corresponding-author phrase: ...{}...",
            text[s..e].replace('\n', " ")
        ));
    }
    let block = title_block(text);
    for tok in AFFILIATION_TOKENS {
        let re = Regex::new(&format!(r"\b{}\b", regex::escape(tok))).expect("token regex");
        if re.is_match(block) {
            leaks.push(format!("affiliation token in title block: {tok}"));
        }
    }
    if let Some(m) = AUTHOR_LIST_RE.find(block) {
        leaks.push(format!(
            "author-list-like pattern in title block: {}...",
            super::tex::take_chars(m.as_str(), 80)
        ));
    }
    leaks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_paper_has_no_leaks() {
        let t = "\\documentclass{article}\n\\begin{document}\n\\title{A Study}\n\\maketitle\n\\section{Intro}\nText.\n";
        assert!(find_leaks(t).is_empty());
    }

    #[test]
    fn email_and_correspondence_are_found() {
        let t =
            "\\begin{document}\nContact jane@example.org.\n\\section{A}\nCorresponding author: x\n";
        let l = find_leaks(t);
        assert!(l.iter().any(|x| x.starts_with("email: jane@example.org")));
        assert!(l.iter().any(|x| x.starts_with("corresponding-author")));
    }

    #[test]
    fn affiliation_only_counts_in_title_block() {
        let in_block = "\\begin{document}\nGoogle Research\n\\section{A}\n";
        let in_body = "\\begin{document}\n\\section{A}\nWe compare against Google systems.\n";
        assert!(find_leaks(in_block).iter().any(|x| x.contains("Google")));
        assert!(find_leaks(in_body).is_empty());
    }

    #[test]
    fn author_lists_and_comment_leaks() {
        let t = "\\begin{document}\nAlice Smith, Bob Jones and Carol White\n\\section{A}\n% mail me: a@b.co\n";
        let l = find_leaks(t);
        assert!(l.iter().any(|x| x.starts_with("author-list-like")));
        assert!(l.iter().any(|x| x.starts_with("email: a@b.co")));
    }

    #[test]
    fn multibyte_context_does_not_panic() {
        let t = format!("{}Corresponding author{}", "é".repeat(40), "é".repeat(40));
        assert_eq!(find_leaks(&t).len(), 1);
    }
}
