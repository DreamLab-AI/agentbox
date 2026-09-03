//! Language pre-filter, so UK spelling rules never fire on non-English text.
//!
//! A dialect rule applied to the wrong language is pure noise: German *Zentrum*
//! and French *couleur* have nothing to do with British English, and a
//! multilingual document should not light up red in its non-English half.
//!
//! Detection uses [`whatlang`] (MIT, 69 languages, trigram-based), applied per
//! paragraph rather than per document so a quoted German block inside an
//! English article is skipped without silencing the article.
//!
//! # Why the length floor matters
//!
//! Trigram detection is unreliable on short input, and a wrong answer here
//! silences real findings. The filter therefore only trusts a verdict when the
//! paragraph is at least [`MIN_PARAGRAPH_CHARS`] long **and** whatlang itself
//! reports the detection reliable. Anything shorter is treated as English,
//! because a false negative (checking text we should have skipped) merely
//! produces a finding a human can dismiss, while a false positive silently
//! drops real ones.

use prose_sanitiser_core::Span;
use whatlang::{Detector, Lang};

/// Paragraphs shorter than this are assumed English and always checked.
///
/// Eighty characters is roughly a full line of prose. Below that, trigram
/// detection routinely mistakes English for Dutch, Tagalog or Esperanto.
pub const MIN_PARAGRAPH_CHARS: usize = 80;

/// Languages the detector is allowed to choose between.
///
/// Restricting the candidate set sharpens the decision: the question is never
/// "which of 69 languages is this" but "is this English or something else it
/// could plausibly be confused with". Every entry uses the Latin script, since
/// a non-Latin paragraph contains no English words to check in the first place.
const CANDIDATES: &[Lang] = &[
    Lang::Eng,
    Lang::Deu,
    Lang::Fra,
    Lang::Spa,
    Lang::Ita,
    Lang::Por,
    Lang::Nld,
    Lang::Dan,
    Lang::Swe,
    Lang::Nob,
    Lang::Pol,
    Lang::Ces,
    Lang::Ron,
    Lang::Hun,
    Lang::Fin,
    Lang::Tur,
    Lang::Ind,
    Lang::Vie,
];

/// Byte ranges whose language is confidently **not** English.
///
/// Returns an empty vector when the filter is off, when every paragraph is too
/// short to judge, or when the text is English, which is the common case and
/// costs one pass over the paragraphs.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_uk::lang;
///
/// let english = "The colour of the centre panel was chosen by the committee \
///                after a long and rather tedious discussion about lighting.";
/// assert!(lang::non_english_spans(english).is_empty());
///
/// let german = "Die Farbe der mittleren Platte wurde vom Ausschuss nach einer \
///               langen und ziemlich langweiligen Diskussion über die Beleuchtung gewählt.";
/// assert_eq!(lang::non_english_spans(german).len(), 1);
/// ```
pub fn non_english_spans(document: &str) -> Vec<Span> {
    let detector = Detector::with_allowlist(CANDIDATES.to_vec());
    paragraphs(document)
        .filter(|(_, text)| text.chars().count() >= MIN_PARAGRAPH_CHARS)
        .filter(|(_, text)| is_confidently_not_english(&detector, text))
        .map(|(start, text)| Span::new(start, start + text.len()))
        .collect()
}

/// Whether the detector is sure enough to overrule the default of "English".
fn is_confidently_not_english(detector: &Detector, text: &str) -> bool {
    detector
        .detect(text)
        .is_some_and(|info| info.lang() != Lang::Eng && info.is_reliable())
}

/// Split into blank-line-separated paragraphs, keeping each one's byte offset.
fn paragraphs(document: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0usize;
    let mut out = Vec::new();
    for chunk in document.split("\n\n") {
        let leading = chunk.len() - chunk.trim_start().len();
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            out.push((offset + leading, trimmed));
        }
        offset += chunk.len() + 2;
    }
    out.into_iter()
}
