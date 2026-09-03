//! A language pre-filter, so English-only rules never fire on other languages.
//!
//! The UK-spelling rule and the slop lexicon are both alternations of English
//! words. Run them over German, Dutch or Malay and they hit by coincidence:
//! *color* is a legitimate Dutch loan, *elegant* is ordinary German, and the
//! resulting findings are noise that trains a reader to ignore the tool.
//!
//! [`whatlang`](https://github.com/greyblake/whatlang-rs) classifies a span by
//! trigram profile, which is cheap and needs no model. This module wraps it with
//! the one policy decision that matters: **uncertainty means English**. A short
//! span, an unreliable classification, or a span that is mostly code or numbers
//! is treated as English and scanned, because a pre-filter that silently
//! disables the rules is far worse than one that occasionally lets a rule fire
//! on a foreign paragraph.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::LanguageFilter;
//!
//! let filter = LanguageFilter::default();
//! assert!(filter.is_english(
//!     "The report delves into the tapestry of considerations that underpin the decision."
//! ));
//! assert!(!filter.is_english(
//!     "Der Bericht befasst sich mit den zahlreichen Erwägungen, die der Entscheidung zugrunde liegen."
//! ));
//! // Too short to classify: scanned rather than skipped.
//! assert!(filter.is_english("Guten Tag"));
//! ```

use whatlang::{Detector, Lang};

use crate::finding::Span;

/// Below this many characters, a span is scanned rather than classified.
///
/// Trigram classification on a fragment is close to a coin toss; whatlang's own
/// guidance is that short text is unreliable. Sixty characters is roughly the
/// point at which its reliability flag starts meaning something.
pub const MIN_CLASSIFIABLE_CHARS: usize = 60;

/// Decide whether a span of text should be scanned by English-only rules.
///
/// [`Default`] gives the safe configuration: enabled, with the uncertainty
/// policy above. Construct with [`LanguageFilter::disabled`] to scan everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanguageFilter {
    enabled: bool,
    min_chars: usize,
}

impl Default for LanguageFilter {
    fn default() -> Self {
        Self {
            enabled: true,
            min_chars: MIN_CLASSIFIABLE_CHARS,
        }
    }
}

impl LanguageFilter {
    /// The default filter: classify spans long enough to classify.
    pub fn new() -> Self {
        Self::default()
    }

    /// A filter that passes everything: every span counts as English.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            min_chars: MIN_CLASSIFIABLE_CHARS,
        }
    }

    /// Whether the filter is doing anything.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Change the length below which a span is scanned unclassified.
    pub fn with_min_chars(mut self, min_chars: usize) -> Self {
        self.min_chars = min_chars;
        self
    }

    /// Whether English-only rules should run over `text`.
    ///
    /// Returns `true` when the filter is disabled, when `text` is too short to
    /// classify, when the classification is not reliable, or when the detected
    /// language is English.
    pub fn is_english(&self, text: &str) -> bool {
        if !self.enabled {
            return true;
        }
        // Count letters, not bytes: a span of numbers, punctuation and code
        // carries no trigram signal however long it is.
        if text.chars().filter(|c| c.is_alphabetic()).count() < self.min_chars {
            return true;
        }
        // Restricting the candidate set to the Latin-script languages the tool
        // is plausibly handed keeps a Latin-script paragraph from being
        // classified as something exotic on a handful of trigrams.
        let detector = Detector::with_allowlist(CANDIDATES.to_vec());
        match detector.detect(text) {
            Some(info) if !info.is_reliable() => true,
            Some(info) => info.lang() == Lang::Eng,
            None => true,
        }
    }

    /// The paragraphs of `document` that English-only rules should run over.
    ///
    /// Paragraphs are split on blank lines, which is the unit a trigram
    /// classifier can actually judge: a single line is usually too short, and a
    /// whole document hides one foreign block inside a majority-English score.
    pub fn english_spans(&self, document: &str) -> Vec<Span> {
        paragraphs(document)
            .into_iter()
            .filter(|span| {
                span.slice(document)
                    .is_some_and(|text| self.is_english(text))
            })
            .collect()
    }

    /// Whether the byte at `offset` sits in a span the English rules may scan.
    ///
    /// Precomputed spans from [`LanguageFilter::english_spans`] should be reused
    /// across a whole file rather than recomputed per finding.
    pub fn offset_is_english(&self, spans: &[Span], offset: usize) -> bool {
        if !self.enabled {
            return true;
        }
        spans
            .iter()
            .any(|span| offset >= span.start && offset < span.end)
    }
}

/// The Latin-script languages a prose tool is realistically handed.
///
/// A deliberately short list. Every extra candidate is another chance for a
/// genuinely English paragraph to be misfiled and silently skipped.
const CANDIDATES: &[Lang] = &[
    Lang::Eng,
    Lang::Fra,
    Lang::Deu,
    Lang::Spa,
    Lang::Por,
    Lang::Ita,
    Lang::Nld,
    Lang::Swe,
    Lang::Dan,
    Lang::Pol,
    Lang::Ces,
    Lang::Ron,
    Lang::Tur,
    Lang::Ind,
    Lang::Vie,
];

/// Split `document` into paragraph spans on blank lines.
///
/// Public because the same unit is useful to a caller that wants to report per
/// paragraph, and because deriving it twice from the same document in two
/// crates would be two chances to disagree.
pub fn paragraphs(document: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut start: Option<usize> = None;
    let mut offset = 0usize;

    for line in document.split_inclusive('\n') {
        let blank = line.trim().is_empty();
        match (blank, start) {
            (true, Some(begin)) => {
                spans.push(Span::new(begin, offset));
                start = None;
            }
            (false, None) => start = Some(offset),
            _ => {}
        }
        offset += line.len();
    }
    if let Some(begin) = start {
        spans.push(Span::new(begin, document.len()));
    }
    spans
}

#[cfg(test)]
mod tests;
