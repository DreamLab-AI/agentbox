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
//! | Code spans and code blocks, fenced *and* indented | `color`, `initialize` and `--no-color` are identifiers and flags. Renaming one breaks the program. |
//! | YAML `---` and TOML `+++` front matter | Keys are part of a schema, not prose. |
//! | Link destinations, URLs, `mailto:` targets, e-mail addresses, file paths | A path is a path, whether or not it carries a scheme. |
//! | Quoted text and blockquote lines | Changing a quotation misrepresents its author. |
//! | Capitalised words away from a sentence start | The cheap, effective proper-noun test. |
//! | Gazetteer names | *World Health Organization* is spelled that way by charter. |
//!
//! Non-English paragraphs are skipped too, but that is not done here: it is
//! [`LanguageFilter`](prose_sanitiser_core::LanguageFilter) on the shared
//! [`Config`](prose_sanitiser_core::Config), applied by the checker, so every
//! crate in the workspace makes the same call.
//!
//! # Code and links come from a CommonMark parse
//!
//! Code spans, code blocks and link destinations are located by
//! [`pulldown_cmark`], not by regex. That was a correctness fix rather than a
//! tidy-up. The regex pass this replaced paired backticks by run length within
//! a line, which is close enough for inline code but says nothing about
//! four-space indented blocks, and it recognised a link only by its scheme, so
//! `[color](relative/path/color)` had its destination rewritten. A parser knows
//! the difference between an indented code block and a wrapped list item —
//! which is why indented code can now be excluded safely, where a naive
//! four-space rule would have silenced half the findings in any document with a
//! nested list — and it knows a destination is a destination however it is
//! spelled.
//!
//! Link *text* is still checked. It is prose the author wrote and a reader
//! reads; only the target is off limits.
//!
//! # Quotation marks
//!
//! Curly quotes are directional, so they pair directly: `“ ”`, `« »` and
//! `‘ ’`. Straight quotes carry no direction and are paired in order within one
//! paragraph, so an unbalanced quote costs at most a paragraph rather than the
//! rest of the document.
//!
//! Straight *single* quotes are the hard case, because in English an ASCII
//! apostrophe is far more often a contraction or a possessive than a quotation
//! mark. They are classified by what surrounds them: a `'` with a letter after
//! it and none before it can open a quotation, and a `'` with a letter before
//! it and none after it can close one. That leaves `don't` and `dogs'` alone —
//! neither position qualifies — while `'The color is red.'` is protected. Only
//! a matched opener/closer pair inside one paragraph excludes anything.

use std::ops::Range;
use std::sync::OnceLock;

use prose_sanitiser_core::Span;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
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
        if options.exclude_code || options.exclude_links {
            raw.extend(markdown(
                document,
                options.exclude_code,
                options.exclude_links,
            ));
        }
        if options.exclude_links {
            raw.extend(links(document));
            raw.extend(paths(document));
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

/// Code and link-destination spans, taken from a CommonMark parse.
///
/// `code` and `links` are the caller's switches, honoured independently so a
/// caller that has already stripped one kind of structure is not forced to take
/// the other as well.
///
/// The link handling is the part worth reading. `pulldown_cmark`'s offset
/// iterator reports the byte range of the whole link, `[text](destination)`,
/// and the range of each inner text run. Excluding the link range *minus* its
/// text runs leaves exactly the syntax and the destination: `[`, `](…)`, or the
/// `][ref]` of a reference link, or the whole of an autolink. That is target
/// independent of scheme, which is the property a regex could not have.
fn markdown(document: &str, code: bool, links: bool) -> Vec<(usize, usize)> {
    /// One open link or image, and the text runs seen inside it so far.
    struct OpenLink {
        range: Range<usize>,
        text: Vec<(usize, usize)>,
    }

    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut open: Vec<OpenLink> = Vec::new();

    // Tables are enabled so a pipe row parses as a table rather than as a
    // paragraph of stray punctuation; nothing else changes what is excluded.
    let parser = Parser::new_ext(document, Options::ENABLE_TABLES).into_offset_iter();

    for (event, range) in parser {
        match event {
            Event::Start(Tag::Link { .. } | Tag::Image { .. }) if links => open.push(OpenLink {
                range,
                text: Vec::new(),
            }),
            Event::End(TagEnd::Link | TagEnd::Image) if links => {
                if let Some(link) = open.pop() {
                    spans.extend(outside(&link.range, &link.text));
                    // An image inside a link is itself a text run of the outer
                    // link, so its whole range counts as covered.
                    if let Some(parent) = open.last_mut() {
                        parent.text.push((link.range.start, link.range.end));
                    }
                }
            }
            Event::Code(_) if code => spans.push((range.start, range.end)),
            Event::Start(Tag::CodeBlock(_)) if code => spans.push((range.start, range.end)),
            Event::Text(_) | Event::Code(_) => {
                if let Some(link) = open.last_mut() {
                    link.text.push((range.start, range.end));
                }
            }
            _ => {}
        }
    }

    // An unclosed link tag cannot happen in a well-formed parse, but a stack
    // left non-empty must not silently drop its destinations.
    for link in open {
        spans.extend(outside(&link.range, &link.text));
    }
    spans
}

/// The parts of `range` that `covered` does not account for.
fn outside(range: &Range<usize>, covered: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut gaps = Vec::new();
    let mut cursor = range.start;
    let mut sorted: Vec<(usize, usize)> = covered.to_vec();
    sorted.sort_unstable();
    for (start, end) in sorted {
        if start > cursor {
            gaps.push((cursor, start));
        }
        cursor = cursor.max(end);
    }
    if cursor < range.end {
        gaps.push((cursor, range.end));
    }
    gaps
}

/// URLs, `mailto:` targets and bare e-mail addresses.
///
/// Kept alongside the CommonMark pass rather than replaced by it: a bare URL in
/// running text is not a Markdown link, and neither is anything in a document
/// that is not Markdown at all.
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

/// Bare file paths: `./docs/color/theater.md`, `/etc/default/color`, `src/x.rs`.
///
/// Whitespace-delimited tokens are tested one at a time rather than matched by
/// one large pattern, because the test is a shape rather than a syntax and
/// reads far better written out. See [`is_path_like`] for what the shape is and
/// which near misses it deliberately lets through.
fn paths(document: &str) -> Vec<(usize, usize)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\S+").expect("the token pattern is a constant"));
    re.find_iter(document)
        .filter_map(|hit| {
            // Opening brackets are trimmed from the front and sentence
            // punctuation from the end. A leading dot is left alone, because
            // `./docs` starts with one and losing it would lose the strongest
            // signal the token has.
            let token = hit.as_str();
            let lead = token.len() - token.trim_start_matches(['(', '[', '{', '<', '"', '\'']).len();
            let trimmed = token[lead..].trim_end_matches([
                '.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '"', '\'',
            ]);
            is_path_like(trimmed)
                .then(|| (hit.start() + lead, hit.start() + lead + trimmed.len()))
        })
        .collect()
}

/// Whether `token` reads as a filesystem path rather than as prose.
///
/// A path either says so at the front — `./`, `../`, `~/` or a leading `/` —
/// or ends in a file extension after at least one slash. Requiring one of those
/// two is what keeps `color/center` and `and/or` checked: a slash alone is
/// punctuation in English, and treating every slashed pair as a path would
/// silence a real class of finding to catch a rare one.
fn is_path_like(token: &str) -> bool {
    if !token.contains('/') || token.contains("://") {
        return false;
    }
    if token.starts_with("./")
        || token.starts_with("../")
        || token.starts_with("~/")
        || token.starts_with('/')
    {
        return true;
    }
    let last = token.rsplit('/').next().unwrap_or_default();
    match last.rsplit_once('.') {
        Some((stem, extension)) => {
            !stem.is_empty()
                && (1..=8).contains(&extension.len())
                && extension.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// Quoted regions: curly pairs, straight pairs, and blockquote lines.
fn quotations(document: &str) -> Vec<(usize, usize)> {
    let mut spans = blockquote_lines(document);
    spans.extend(curly_pairs(document, '\u{201C}', '\u{201D}'));
    spans.extend(curly_pairs(document, '\u{00AB}', '\u{00BB}'));
    spans.extend(curly_pairs(document, '\u{2018}', '\u{2019}'));
    spans.extend(straight_pairs(document));
    spans
}

/// Directional quote pairs, matched open-to-close within one paragraph.
///
/// The paragraph bound matters most for `‘ ’`, because U+2019 is also the
/// typographic apostrophe: without it, one apostrophe after an unclosed opening
/// quote would swallow whatever followed. Pairing only after an opener is what
/// keeps *Hart's* — an apostrophe with no opener in sight — from excluding
/// anything at all.
fn curly_pairs(document: &str, open_mark: char, close_mark: char) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut paragraph_start = 0usize;
    for paragraph in document.split_inclusive("\n\n") {
        let mut open: Option<usize> = None;
        for (index, character) in paragraph.char_indices() {
            if character == open_mark && open.is_none() {
                open = Some(index);
            } else if character == close_mark {
                if let Some(start) = open.take() {
                    spans.push((
                        paragraph_start + start,
                        paragraph_start + index + character.len_utf8(),
                    ));
                }
            }
        }
        paragraph_start += paragraph.len();
    }
    spans
}

/// Straight quote pairs, `"` and `'`, matched within one paragraph.
///
/// Double quotes pair in order: they carry no direction, so the first opens and
/// the second closes. Single quotes are filtered first by
/// [`opens_single`] and [`closes_single`], because most ASCII apostrophes in
/// English prose are not quotation marks at all.
fn straight_pairs(document: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut paragraph_start = 0usize;

    for paragraph in document.split_inclusive("\n\n") {
        let mut double: Option<usize> = None;
        let mut single: Option<usize> = None;

        for (index, character) in paragraph.char_indices() {
            match character {
                '"' => match double.take() {
                    Some(start) => {
                        spans.push((paragraph_start + start, paragraph_start + index + 1))
                    }
                    None => double = Some(index),
                },
                '\'' => {
                    if single.is_some() && closes_single(paragraph, index) {
                        let start = single.take().expect("checked by the guard above");
                        spans.push((paragraph_start + start, paragraph_start + index + 1));
                    } else if single.is_none() && opens_single(paragraph, index) {
                        single = Some(index);
                    }
                }
                _ => {}
            }
        }
        paragraph_start += paragraph.len();
    }
    spans
}

/// Whether the `'` at `index` can open a quotation: a letter after, none before.
fn opens_single(text: &str, index: usize) -> bool {
    !preceded_by_alphanumeric(text, index) && followed_by_alphanumeric(text, index)
}

/// Whether the `'` at `index` can close one: a letter before, none after.
///
/// Terminal punctuation counts as "before", because a quotation that ends in a
/// full stop puts it inside the quote: `'The color is red.'`.
fn closes_single(text: &str, index: usize) -> bool {
    let before = text[..index]
        .chars()
        .next_back()
        .is_some_and(|c| c.is_alphanumeric() || ".,!?;:".contains(c));
    before && !followed_by_alphanumeric(text, index)
}

/// Whether the character before `index` is alphanumeric.
fn preceded_by_alphanumeric(text: &str, index: usize) -> bool {
    text[..index]
        .chars()
        .next_back()
        .is_some_and(char::is_alphanumeric)
}

/// Whether the character after the one at `index` is alphanumeric.
fn followed_by_alphanumeric(text: &str, index: usize) -> bool {
    text[index..]
        .chars()
        .nth(1)
        .is_some_and(char::is_alphanumeric)
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
