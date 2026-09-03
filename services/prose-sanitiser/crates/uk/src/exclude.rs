//! Span exclusion: the regions no spelling rule may look at.
//!
//! This runs **before** any rule, and it is the single biggest source of
//! correctness in the crate. A dialect pair is a fact about English prose, and
//! most of a real document is not English prose: it is CSS properties, function
//! names, YAML keys, URLs, someone else's words, and names.
//!
//! # What is excluded, and why
//!
//! | Region | Why |
//! |---|---|
//! | Fenced code blocks, inline code | `color`, `initialize` and `--no-color` are identifiers and flags. Renaming one breaks the program. |
//! | YAML `---` and TOML `+++` front matter | Keys are part of a schema, not prose. |
//! | URLs, `mailto:` targets, e-mail addresses | A path is a path. |
//! | Quoted text and blockquote lines | Changing a quotation misrepresents its author. |
//! | Capitalised words away from a sentence start | The cheap, effective proper-noun test. |
//! | Gazetteer names | *World Health Organization* is spelled that way by charter. |
//!
//! Non-English paragraphs are skipped too, but that is not done here: it is
//! [`LanguageFilter`](prose_sanitiser_core::LanguageFilter) on the shared
//! [`Config`](prose_sanitiser_core::Config), applied by the checker, so every
//! crate in the workspace makes the same call.
//!
//! # What is deliberately not excluded
//!
//! Indent-style code blocks (four leading spaces) are left alone: in ordinary
//! prose documents that pattern is far more often a wrapped line or a nested
//! list than code, and excluding it would silence real findings. Single quotes
//! are not treated as quotation marks either, because in English they are
//! apostrophes far more often than they are quotes.

use std::sync::OnceLock;

use prose_sanitiser_core::Span;
use regex::Regex;

use crate::options::UkOptions;

/// The merged set of regions rules must skip.
///
/// Built once per document by [`Exclusions::compute`], then queried per token.
#[derive(Debug, Clone, Default)]
pub struct Exclusions {
    spans: Vec<Span>,
}

impl Exclusions {
    /// Work out every excluded region of `document` under `options`.
    pub fn compute(document: &str, options: &UkOptions) -> Self {
        let mut raw: Vec<(usize, usize)> = Vec::new();

        if options.exclude_front_matter {
            raw.extend(front_matter(document));
        }
        let fences = code_fences(document);
        if options.exclude_code {
            raw.extend(fences.iter().copied());
            raw.extend(inline_code(document, &fences));
        }
        if options.exclude_links {
            raw.extend(links(document));
        }
        if options.exclude_quotations {
            raw.extend(quotations(document));
        }
        if options.exclude_proper_nouns {
            raw.extend(proper_nouns(document));
        }
        raw.extend(options.gazetteer().spans(document));

        Self { spans: merge(raw) }
    }

    /// Whether `span` touches any excluded region.
    pub fn blocks(&self, span: Span) -> bool {
        let index = self.spans.partition_point(|other| other.end <= span.start);
        self.spans
            .get(index)
            .is_some_and(|other| other.start < span.end)
    }

    /// The merged excluded regions, in ascending order and non-overlapping.
    pub fn spans(&self) -> &[Span] {
        &self.spans
    }

    /// How many distinct excluded regions there are.
    pub fn len(&self) -> usize {
        self.spans.len()
    }

    /// Whether nothing at all is excluded.
    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }
}

/// Sort, merge and normalise raw ranges into disjoint ascending spans.
fn merge(mut raw: Vec<(usize, usize)>) -> Vec<Span> {
    raw.retain(|(start, end)| start < end);
    raw.sort_unstable();
    let mut merged: Vec<Span> = Vec::with_capacity(raw.len());
    for (start, end) in raw {
        match merged.last_mut() {
            Some(last) if start <= last.end => last.end = last.end.max(end),
            _ => merged.push(Span::new(start, end)),
        }
    }
    merged
}

/// YAML `---` or TOML `+++` front matter at the very top of the document.
fn front_matter(document: &str) -> Option<(usize, usize)> {
    let marker = ["---", "+++"].into_iter().find(|m| {
        document.starts_with(&format!("{m}\n")) || document.starts_with(&format!("{m}\r\n"))
    })?;

    let mut offset = 0usize;
    for (index, line) in document.split_inclusive('\n').enumerate() {
        if index > 0 {
            let trimmed = line.trim_end();
            if trimmed == marker || (marker == "---" && trimmed == "...") {
                return Some((0, offset + line.len()));
            }
        }
        offset += line.len();
    }
    // An unterminated front-matter block is almost certainly a horizontal rule.
    None
}

/// Fenced code blocks, from the opening fence line to the closing fence line.
fn code_fences(document: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut open: Option<(usize, char, usize)> = None;
    let mut offset = 0usize;

    for line in document.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        let fence = fence_marker(trimmed);

        match (&open, fence) {
            (None, Some((marker, width))) => open = Some((offset, marker, width)),
            (Some((start, marker, width)), Some((closing, closing_width)))
                if closing == *marker && closing_width >= *width =>
            {
                spans.push((*start, offset + line.trim_end().len()));
                open = None;
            }
            _ => {}
        }
        let _ = indent;
        offset += line.len();
    }
    // An unclosed fence swallows the rest of the document, which is what a
    // Markdown renderer does too.
    if let Some((start, _, _)) = open {
        spans.push((start, document.len()));
    }
    spans
}

/// The fence character and run length, if `line` opens or closes a fence.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let marker = line.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let width = line.chars().take_while(|c| *c == marker).count();
    (width >= 3).then_some((marker, width))
}

/// Inline code spans, paired by backtick-run length within a single line.
///
/// Confining a span to one line stops a stray backtick from swallowing the rest
/// of the document, which matters because a document containing an odd number
/// of backticks is common and a silently disabled linter is not acceptable.
fn inline_code(document: &str, fences: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut offset = 0usize;

    for line in document.split_inclusive('\n') {
        let line_start = offset;
        offset += line.len();
        if fences
            .iter()
            .any(|(start, end)| line_start >= *start && line_start < *end)
        {
            continue;
        }
        let runs = backtick_runs(line);
        let mut index = 0usize;
        while index < runs.len() {
            let (start, width) = runs[index];
            match runs[index + 1..].iter().position(|(_, w)| *w == width) {
                Some(relative) => {
                    let (close_start, close_width) = runs[index + 1 + relative];
                    spans.push((line_start + start, line_start + close_start + close_width));
                    index += relative + 2;
                }
                None => index += 1,
            }
        }
    }
    spans
}

/// Byte offset and length of every run of backticks in `line`.
fn backtick_runs(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut runs = Vec::new();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            let start = index;
            while index < bytes.len() && bytes[index] == b'`' {
                index += 1;
            }
            runs.push((start, index - start));
        } else {
            index += 1;
        }
    }
    runs
}

/// URLs, `mailto:` targets and bare e-mail addresses.
fn links(document: &str) -> Vec<(usize, usize)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(concat!(
            r#"(?i)(?:\b(?:https?|ftp|file|mailto|data):[^\s<>()\[\]{}"']+"#,
            r#"|\bwww\.[^\s<>()\[\]{}"']+"#,
            r#"|\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b)"#,
        ))
        .expect("the link pattern is a compile-time constant")
    });
    re.find_iter(document)
        .map(|hit| (hit.start(), hit.end()))
        .collect()
}

/// Quoted regions: curly pairs, straight pairs, and blockquote lines.
fn quotations(document: &str) -> Vec<(usize, usize)> {
    let mut spans = blockquote_lines(document);

    // Curly quotes are unambiguous, so pair them directly.
    let mut open: Option<usize> = None;
    for (index, character) in document.char_indices() {
        match character {
            '\u{201C}' | '\u{00AB}' => open = Some(index),
            '\u{201D}' | '\u{00BB}' => {
                if let Some(start) = open.take() {
                    spans.push((start, index + character.len_utf8()));
                }
            }
            _ => {}
        }
    }

    // Straight quotes carry no direction, so pair them in order and only within
    // one paragraph: an unbalanced quote then costs at most a paragraph.
    let mut paragraph_start = 0usize;
    for paragraph in document.split_inclusive("\n\n") {
        let mut pending: Option<usize> = None;
        for (index, character) in paragraph.char_indices() {
            if character != '"' {
                continue;
            }
            match pending.take() {
                Some(start) => spans.push((paragraph_start + start, paragraph_start + index + 1)),
                None => pending = Some(index),
            }
        }
        paragraph_start += paragraph.len();
    }
    spans
}

/// Whole lines that begin with a Markdown blockquote marker.
fn blockquote_lines(document: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut offset = 0usize;
    for line in document.split_inclusive('\n') {
        if line.trim_start().starts_with('>') {
            spans.push((offset, offset + line.trim_end().len()));
        }
        offset += line.len();
    }
    spans
}

/// Capitalised words that are not at the start of a sentence.
///
/// Crude, and right far more often than it is wrong. *Organization* inside
/// *World Health Organization* is caught here even without the gazetteer, while
/// a sentence-initial *Color* is still checked, because that is where a genuine
/// Americanism appears.
fn proper_nouns(document: &str) -> Vec<(usize, usize)> {
    word_re()
        .find_iter(document)
        .filter(|hit| hit.as_str().chars().next().is_some_and(char::is_uppercase))
        .filter(|hit| !is_sentence_start(document, hit.start()))
        .map(|hit| (hit.start(), hit.end()))
        .collect()
}

/// Whether the token beginning at `start` opens a sentence.
///
/// True at the start of the document, after terminal punctuation, and after any
/// run of Markdown structure (a heading marker, a list bullet, a table cell
/// edge), because in all of those a capital letter is orthography rather than a
/// name.
pub fn is_sentence_start(document: &str, start: usize) -> bool {
    let before = &document[..start];
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    let prefix = &before[line_start..];

    // Only whitespace and Markdown furniture before it on this line.
    if prefix
        .chars()
        .all(|c| c.is_whitespace() || "#>-*+.)|[]0123456789".contains(c))
    {
        return true;
    }

    let trimmed = before
        .trim_end_matches(|c: char| c.is_whitespace() || "\"'\u{201C}\u{2018}([{".contains(c));
    matches!(
        trimmed.chars().next_back(),
        Some('.') | Some('!') | Some('?') | Some(':') | None
    )
}

/// Word tokens: letters, with internal apostrophes kept.
///
/// Keeping the apostrophe matters because VarCon lists possessives as separate
/// forms, so `color's` is a table key in its own right.
pub fn word_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[A-Za-z]+(?:['\u{2019}][A-Za-z]+)*")
            .expect("the word pattern is a compile-time constant")
    })
}
