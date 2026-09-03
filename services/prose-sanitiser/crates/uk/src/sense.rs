//! Sense disambiguation for the pairs that depend on meaning, not dialect.
//!
//! *licence*/*license*, *practice*/*practise*, *program*/*programme*,
//! *meter*/*metre*, *check*/*cheque*, *tyre*/*tire*, *storey*/*story* and
//! *kerb*/*curb* are not American against British. They are one sense against
//! another **inside** British English, which is why a flat find-and-replace
//! gets roughly half of them wrong.
//!
//! Two signals are combined, both drawn from [`crate::table`] entries that
//! VarCon itself split into groups:
//!
//! * **Part of speech**, when VarCon tagged the groups `<N>` and `<V>`. A
//!   determiner in front means a noun (*a driving licence*); *to*, a modal or a
//!   pronoun subject means a verb (*to license a doctor*).
//! * **Context words**, when VarCon distinguished the groups with a usage gloss.
//!   The cue lists live in [`crate::cues`], keyed on the gloss verbatim.
//!
//! # The confidence rule
//!
//! Resolution never unlocks an automatic fix. Even a confidently resolved sense
//! pair stays [`ConfidenceTier::LowConfidenceJudgement`], because the cost of
//! being wrong is a changed meaning rather than a changed style. What
//! resolution buys is *silence*: recognising that *the gas meter* and *the
//! computer program* are already correct, so no finding is raised at all.
//! Everything unresolved is reported for a human, with both senses named.
//!
//! [`ConfidenceTier::LowConfidenceJudgement`]: prose_sanitiser_core::ConfidenceTier::LowConfidenceJudgement

use prose_sanitiser_core::Span;

use crate::cues::{cues_for, is_default_gloss, DEFAULT_GLOSS_BONUS, NUMERIC_CUE};
use crate::exclude::word_re;
use crate::table::{Dialect, Entry, Sense};

/// What the disambiguator concluded about one occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The spelling is right for the sense in use. Raise nothing.
    CorrectAsWritten,
    /// The sense is clear and the spelling is wrong for it. Report, with the
    /// suggestion named in the advice, but never as an applyable replacement.
    Suggest {
        /// The British form for the sense that won.
        target: &'static str,
        /// How the winning sense reads, for the advice line.
        sense: String,
    },
    /// No sense won. Report both readings and let a human decide.
    Unresolved,
}

/// Part of speech, as far as a few local cues can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pos {
    Noun,
    Verb,
}

impl Pos {
    /// The VarCon tag this corresponds to.
    fn tag(self) -> &'static str {
        match self {
            Pos::Noun => "N",
            Pos::Verb => "V",
        }
    }
}

/// Words that make the next content word a noun.
const DETERMINERS: &[&str] = &[
    "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our",
    "their", "no", "any", "some", "each", "every", "another", "one", "both", "such", "which",
];

/// Words that make the next word a verb.
const VERB_MARKERS: &[&str] = &[
    "to", "not", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "do",
    "does", "did", "have", "has", "had", "be", "been", "being", "am", "is", "are", "was", "were",
    "i", "we", "you", "they", "he", "she", "it", "who", "please", "let", "help",
];

/// Prepositions that make the following word a noun.
const PREPOSITIONS: &[&str] = &[
    "of", "for", "in", "on", "at", "with", "without", "under", "by", "from", "into", "onto",
    "about", "against", "through", "during", "per",
];

/// How many tokens either side of the occurrence to read for part of speech.
const POS_WINDOW: usize = 3;

/// Decide what to do about one occurrence of a sense-dependent word.
///
/// `span` must be the byte range of the occurrence inside `document`, and
/// `entry` must be sense-dependent: an unconditional entry has no senses to
/// weigh and always returns [`Verdict::Unresolved`].
///
/// # Examples
///
/// ```
/// use prose_sanitiser_uk::sense::{resolve, Verdict};
/// use prose_sanitiser_uk::table::{self, Dialect};
/// use prose_sanitiser_core::Span;
///
/// let document = "You need a permit to license a doctor.";
/// let start = document.find("license").unwrap();
/// let entry = table::lookup("license").unwrap();
/// let verdict = resolve(document, Span::new(start, start + 7), entry, Dialect::Ise);
/// assert_eq!(verdict, Verdict::CorrectAsWritten);
/// ```
pub fn resolve(document: &str, span: Span, entry: &Entry, dialect: Dialect) -> Verdict {
    let senses = entry.senses();
    if senses.is_empty() {
        return Verdict::Unresolved;
    }

    let sentence = sentence_around(document, span);
    let context: Vec<String> = word_re()
        .find_iter(sentence.text)
        .map(|hit| hit.as_str().to_lowercase())
        .collect();
    // Part of speech may only weigh in when VarCon actually used it to tell
    // these senses apart. Otherwise a tagged sense would collect a free bonus
    // over an untagged one, and "the gas meter" would score as the SI unit
    // purely because the unit sense carries an <N> and the instrument does not.
    let pos = pos_discriminates(senses)
        .then(|| detect_pos(document, span))
        .flatten();
    let numeric = is_numeric_prefixed(document, span);

    // Score every sense, then let the *targets* decide whether the winner is
    // ambiguous. Two senses tying on score is harmless when they agree on the
    // answer, which happens whenever VarCon glosses one meaning twice.
    let scored: Vec<(i32, &Sense)> = senses
        .iter()
        .map(|candidate| (score_sense(candidate, &context, pos, numeric), candidate))
        .collect();
    let Some(top) = scored.iter().map(|(score, _)| *score).max() else {
        return Verdict::Unresolved;
    };
    if top <= 0 {
        return Verdict::Unresolved;
    }
    let winners: Vec<&Sense> = scored
        .iter()
        .filter(|(score, _)| *score == top)
        .map(|(_, sense)| *sense)
        .collect();

    let target = winners[0].target(dialect);
    if winners.iter().any(|sense| sense.target(dialect) != target) {
        // The leading senses disagree about the spelling, so nothing is settled.
        return Verdict::Unresolved;
    }
    match target {
        None => Verdict::CorrectAsWritten,
        Some(target) => Verdict::Suggest {
            target,
            sense: winners[0].describe(),
        },
    }
}

/// Whether at least two senses carry different part-of-speech tags.
///
/// This is what makes part of speech admissible evidence: licence/license and
/// practice/practise are split `<N>` against `<V>`, so the tag decides. Where
/// only one sense is tagged, the tag says nothing about the other and must be
/// ignored.
fn pos_discriminates(senses: &[Sense]) -> bool {
    let mut seen: Vec<&str> = senses.iter().filter_map(Sense::part_of_speech).collect();
    seen.sort_unstable();
    seen.dedup();
    seen.len() >= 2
}

/// Score one sense against the surrounding text.
///
/// A cue word outweighs a part-of-speech match, because a cue is specific to
/// one reading while a tag merely rules one out. A contradicted tag is
/// penalised hardest of all, so "to license a doctor" cannot be read as a noun
/// however the vocabulary falls.
fn score_sense(sense: &Sense, context: &[String], pos: Option<Pos>, numeric: bool) -> i32 {
    let mut score = 0i32;

    if let (Some(detected), Some(tagged)) = (pos, sense.part_of_speech()) {
        if tagged == detected.tag() {
            score += 2;
        } else if matches!(tagged, "N" | "V") {
            score -= 3;
        }
    }

    if is_default_gloss(sense.usage()) {
        score += DEFAULT_GLOSS_BONUS;
    }

    for cue in cues_for(sense.usage()) {
        if *cue == NUMERIC_CUE {
            if numeric {
                score += 4;
            }
        } else if context.iter().any(|word| word == cue) {
            score += 3;
        }
    }
    score
}

/// Guess the part of speech from the words immediately around the occurrence.
fn detect_pos(document: &str, span: Span) -> Option<Pos> {
    // `regex::Matches` is forward-only, so collect before walking backwards.
    let preceding: Vec<&str> = word_re()
        .find_iter(&document[..span.start])
        .map(|hit| hit.as_str())
        .collect();
    let before: Vec<&str> = preceding.iter().rev().take(POS_WINDOW).copied().collect();
    let after = word_re()
        .find_iter(document.get(span.end..).unwrap_or(""))
        .map(|hit| hit.as_str().to_lowercase())
        .next();

    let mut noun = 0i32;
    let mut verb = 0i32;

    for (distance, word) in before.iter().enumerate() {
        let lower = word.to_lowercase();
        let weight = (POS_WINDOW - distance) as i32;
        if lower == "to" && distance == 0 {
            verb += 5;
        } else if VERB_MARKERS.contains(&lower.as_str()) {
            verb += weight;
        }
        if DETERMINERS.contains(&lower.as_str()) {
            noun += weight;
        } else if PREPOSITIONS.contains(&lower.as_str()) && distance == 0 {
            noun += 2;
        }
    }
    if after.as_deref() == Some("of") {
        noun += 2;
    }

    match noun.cmp(&verb) {
        std::cmp::Ordering::Greater => Some(Pos::Noun),
        std::cmp::Ordering::Less => Some(Pos::Verb),
        std::cmp::Ordering::Equal => None,
    }
}

/// Whether the occurrence is directly preceded by a number, as in "12 meters".
fn is_numeric_prefixed(document: &str, span: Span) -> bool {
    document[..span.start]
        .trim_end()
        .chars()
        .next_back()
        .is_some_and(|c| c.is_ascii_digit())
}

/// The sentence containing `span`, used as the cue-matching window.
struct Sentence<'a> {
    text: &'a str,
}

/// Widen `span` to its surrounding sentence, bounded by terminal punctuation.
fn sentence_around(document: &str, span: Span) -> Sentence<'_> {
    let start = document[..span.start]
        .rfind(['.', '!', '?', '\n'])
        .map_or(0, |index| index + 1);
    let end = document[span.end..]
        .find(['.', '!', '?', '\n'])
        .map_or(document.len(), |index| span.end + index);
    Sentence {
        text: document.get(start..end).unwrap_or(document),
    }
}
