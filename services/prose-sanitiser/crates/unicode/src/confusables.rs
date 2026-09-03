//! UTS #39 confusable, mixed-script and restriction-level analysis.
//!
//! Homoglyph substitution is the strongest known evasion against statistical
//! AI-text detectors: replacing 5 to 20 per cent of Latin characters with
//! lookalikes from another script collapses seven published detectors from a
//! mean MCC of 0.64 to roughly zero (SilverSpeak, ACL 2025 GenAI-Detect). The
//! mitigation the paper proposes is input-side normalisation, which is what
//! this module supplies.
//!
//! # What comes from the standard
//!
//! Everything structural comes from [`unicode_security`], the unicode-rs
//! implementation of [UTS #39](https://www.unicode.org/reports/tr39/):
//!
//! - **`confusables.txt` prototypes**, via the skeleton algorithm
//!   ([`skeleton`]). The algorithm is NFD-based, not NFKC-based: NFD, drop
//!   default-ignorable characters, substitute confusable prototypes, re-apply
//!   NFD. This crate never applies NFKC to prose, so the standard's own choice
//!   suits it exactly.
//! - **Identifier_Status**, so a codepoint restricted from identifiers
//!   (fullwidth forms, mathematical alphanumerics, enclosed letters, Roman
//!   numerals) can be told from one that is a normal letter in a living script.
//! - **Mixed-script detection** over the resolved script set, so a word mixing
//!   Cyrillic and Latin is separable from a word that is honestly Cyrillic.
//! - **Restriction levels**, reported for context.
//!
//! # Where its coverage stops, stated honestly
//!
//! `unicode-security` 0.1.2 ships Unicode 16.0.0 data and its own "implement
//! all of UTS #39" tracking issue is still open, so coverage is partial. Two
//! gaps matter here, and this module closes both explicitly rather than
//! pretending they do not exist:
//!
//! 1. **Fullwidth forms.** `confusables.txt` folds only some of
//!    `U+FF01..=U+FF5E` to ASCII: `Ａ`, `ａ` and `Ｉ` fold, but `Ｂ`, `Ｄ`, `ｚ`
//!    and every fullwidth digit do not. That is deliberate on the standard's
//!    part — width folding is NFKC's remit, and NFKC is lossy by design — but
//!    it leaves a hole an attacker can drive through. [`WIDTH_FOLD`] closes it
//!    with one mechanical rule (subtract `0xFEE0`), applied only where both
//!    ends are alphanumeric, so typography is untouched.
//! 2. **Same-script confusables.** Latin `ı`, `l` and `1` are mutually
//!    confusable inside one script, so mixed-script detection cannot see them.
//!    They are caught only by the context-free per-character pass, which is why
//!    that pass exists alongside the run-level one.
//!
//! 3. **Single-character words.** A lone substituted letter — the English
//!    articles `a` and `I` are the obvious targets — is single-script, so the
//!    mixed-script rule cannot see it. It is caught by the whole-word rule,
//!    which admits length-one runs for every script except Greek. Greek is
//!    excluded because a lone Greek letter in English prose is ordinary
//!    scientific notation, and Greek folds readily to ASCII.
//!
//! No other override list is maintained. Every other prototype in this module
//! comes from the standard's own data.

use unicode_script::Script;
use unicode_security::mixed_script::AugmentedScriptSet;
use unicode_security::{skeleton as uts39_skeleton, GeneralSecurityProfile, MixedScript};

pub use unicode_security::{RestrictionLevel, RestrictionLevelDetection};

use prose_sanitiser_core::Unit;

/// The Unicode version backing the UTS #39 tables in use.
pub const UNICODE_VERSION: (u64, u64, u64) = unicode_security::UNICODE_VERSION;

/// The fullwidth block this module folds to ASCII, closing a documented gap in
/// `confusables.txt`. The fold is `codepoint - 0xFEE0`, applied only when both
/// the source and the target are alphanumeric.
pub const WIDTH_FOLD: std::ops::RangeInclusive<u32> = 0xFF01..=0xFF5E;

/// The UTS #39 skeleton of `text`: the string every character confusable with
/// it shares.
///
/// Two strings are confusable exactly when their skeletons are equal.
///
/// ```
/// use prose_sanitiser_unicode::confusables::skeleton;
/// assert_eq!(skeleton("paypal"), skeleton("\u{0440}ay\u{0440}al"));
/// ```
pub fn skeleton(text: &str) -> String {
    uts39_skeleton(text).collect()
}

/// The ASCII alphanumeric a character is confusable with, if there is exactly
/// one.
///
/// Returns `None` for ASCII input, for anything that is not a letter or digit,
/// and whenever the skeleton is not a single ASCII alphanumeric — which is what
/// keeps accented Latin (`é` skeletons to `e` plus a combining acute),
/// Devanagari, Arabic, Hebrew and CJK out of the results entirely.
///
/// ```
/// use prose_sanitiser_unicode::confusables::prototype;
/// assert_eq!(prototype('\u{0430}'), Some('a')); // Cyrillic small a
/// assert_eq!(prototype('\u{FF5A}'), Some('z')); // fullwidth z: the override
/// assert_eq!(prototype('é'), None);             // honest Latin
/// assert_eq!(prototype('a'), None);             // already ASCII
/// ```
pub fn prototype(character: char) -> Option<char> {
    if character.is_ascii() || !character.is_alphanumeric() {
        return None;
    }
    let codepoint = character as u32;
    if WIDTH_FOLD.contains(&codepoint) {
        if let Some(folded) = char::from_u32(codepoint - 0xFEE0) {
            if folded.is_ascii_alphanumeric() {
                return Some(folded);
            }
        }
    }
    let mut buffer = [0u8; 4];
    let folded: String = uts39_skeleton(character.encode_utf8(&mut buffer)).collect();
    let mut chars = folded.chars();
    match (chars.next(), chars.next()) {
        (Some(candidate), None) if candidate.is_ascii_alphanumeric() && candidate != character => {
            Some(candidate)
        }
        _ => None,
    }
}

/// Whether UTS #39 restricts this character from use in identifiers.
///
/// Restricted-and-folding characters — fullwidth `Ａ`, mathematical bold `𝐀`,
/// Roman numeral `Ⅰ` — have no honest place in prose that also contains their
/// ASCII twin, so they are flagged without needing any surrounding context.
pub fn is_restricted(character: char) -> bool {
    !GeneralSecurityProfile::identifier_allowed(character)
}

/// The UTS #39 restriction level `text` conforms to.
pub fn restriction_level(text: &str) -> RestrictionLevel {
    RestrictionLevelDetection::detect_restriction_level(text)
}

/// Why a character was judged a homoglyph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfusableReason {
    /// UTS #39 restricts the character from identifiers and it folds to an
    /// ASCII alphanumeric: fullwidth, mathematical alphanumeric, enclosed or
    /// Roman-numeral forms. Context-free.
    Restricted,
    /// The word it sits in is not single-script and every non-ASCII character
    /// in that word folds to ASCII — the SilverSpeak substitution signature.
    MixedScriptRun,
    /// The whole word was substituted: single-script, no Latin, every character
    /// folds to ASCII, inside a document that is otherwise ASCII Latin.
    SubstitutedWord,
}

impl ConfusableReason {
    /// The lowercase wire form used in JSON reports.
    pub fn as_str(self) -> &'static str {
        match self {
            ConfusableReason::Restricted => "restricted-identifier",
            ConfusableReason::MixedScriptRun => "mixed-script-run",
            ConfusableReason::SubstitutedWord => "substituted-word",
        }
    }
}

/// One character judged confusable with an ASCII alphanumeric.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfusableHit {
    /// Character offset into the scanned units.
    pub offset: usize,
    /// The character as it appears in the source.
    pub character: char,
    /// The ASCII alphanumeric it is confusable with.
    pub prototype: char,
    /// Why it was judged confusable.
    pub reason: ConfusableReason,
    /// The word it was found in, for a report a human can read.
    pub word: String,
}

/// A maximal run of alphanumeric characters: one word, for script purposes.
struct Run {
    offset: usize,
    text: String,
    chars: Vec<char>,
}

fn runs(units: &[Unit]) -> Vec<Run> {
    let mut out: Vec<Run> = Vec::new();
    let mut current: Option<Run> = None;
    for (offset, unit) in units.iter().copied().enumerate() {
        match unit.as_char().filter(|c| c.is_alphanumeric()) {
            Some(character) => {
                let run = current.get_or_insert_with(|| Run {
                    offset,
                    text: String::new(),
                    chars: Vec::new(),
                });
                run.text.push(character);
                run.chars.push(character);
            }
            None => {
                if let Some(run) = current.take() {
                    out.push(run);
                }
            }
        }
    }
    out.extend(current);
    out
}

/// Whether the document is predominantly written in ASCII Latin.
///
/// Used only to gate [`ConfusableReason::SubstitutedWord`], so a document that
/// is honestly Greek or Cyrillic throughout never has its own script folded
/// away.
fn ascii_latin_dominant(units: &[Unit]) -> bool {
    let mut ascii = 0usize;
    let mut letters = 0usize;
    for character in units.iter().copied().filter_map(Unit::as_char) {
        if character.is_alphabetic() {
            letters += 1;
            if character.is_ascii() {
                ascii += 1;
            }
        }
    }
    letters > 0 && ascii * 2 > letters
}

/// Find every character in `units` that is confusable with an ASCII
/// alphanumeric, with the reason it was judged so.
///
/// The three rules are deliberately layered so that precision survives
/// legitimate content: rule one is context-free and only fires on codepoints
/// UTS #39 already restricts; rules two and three need word- and
/// document-level context before they will touch a living script.
///
/// ```
/// use prose_sanitiser_core::surrogate;
/// use prose_sanitiser_unicode::confusables::{scan, ConfusableReason};
///
/// // Cyrillic 'е' inside an otherwise Latin word.
/// let hits = scan(&surrogate::decode("h\u{0435}llo".as_bytes()));
/// assert_eq!(hits.len(), 1);
/// assert_eq!(hits[0].prototype, 'e');
/// assert_eq!(hits[0].reason, ConfusableReason::MixedScriptRun);
///
/// // Honest Devanagari is left alone.
/// assert!(scan(&surrogate::decode("देवनागरी".as_bytes())).is_empty());
/// ```
pub fn scan(units: &[Unit]) -> Vec<ConfusableHit> {
    let latin_document = ascii_latin_dominant(units);
    let mut hits: Vec<ConfusableHit> = Vec::new();

    for run in runs(units) {
        let prototypes: Vec<Option<char>> = run.chars.iter().map(|c| prototype(*c)).collect();
        let every_non_ascii_folds = run
            .chars
            .iter()
            .zip(&prototypes)
            .all(|(character, folded)| character.is_ascii() || folded.is_some());
        let single_script = run.text.as_str().is_single_script();
        let has_ascii_alnum = run.chars.iter().any(char::is_ascii_alphanumeric);
        let scripts = AugmentedScriptSet::for_str(&run.text);

        let mixed_script_substitution = !single_script && every_non_ascii_folds;
        // A one-character run needs an extra guard. Substituting the English
        // articles "a" and "I" is a real attack, but a lone Greek letter in
        // otherwise-English prose is the ordinary scientific convention — and
        // Greek folds readily to ASCII (alpha to "a", sigma to "o", rho to
        // "p"), so admitting it would flag "the alpha particle". Greek is
        // therefore excluded at length one and caught only by the run-level
        // rules, which need corroborating Latin in the same word.
        let long_enough = run.chars.len() >= 2 || !scripts.base.contains_script(Script::Greek);
        let word_substitution = single_script
            && long_enough
            && !has_ascii_alnum
            && !scripts.base.contains_script(Script::Latin)
            && every_non_ascii_folds
            && latin_document;

        for (index, (character, folded)) in run.chars.iter().zip(&prototypes).enumerate() {
            let Some(folded) = *folded else { continue };
            let reason = if is_restricted(*character) {
                ConfusableReason::Restricted
            } else if mixed_script_substitution {
                ConfusableReason::MixedScriptRun
            } else if word_substitution {
                ConfusableReason::SubstitutedWord
            } else {
                continue;
            };
            hits.push(ConfusableHit {
                offset: run.offset + index,
                character: *character,
                prototype: folded,
                reason,
                word: run.text.clone(),
            });
        }
    }
    hits
}

#[cfg(test)]
mod tests;
