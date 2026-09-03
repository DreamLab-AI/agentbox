//! Per-character classification shared by Layer A inspect and clean.
//!
//! This is the context-free half of Layer A: one codepoint, its immediately
//! preceding kept neighbour, and a verdict. Everything that needs wider context
//! — which word a character sits in, whether a bidi structure balances, what a
//! variation-selector chain decodes to — lives in [`crate::confusables`],
//! [`crate::bidi`] and [`crate::stego`], and reaches a caller through
//! [`crate::check::check_text`].
//!
//! The `treat_confusables` argument no longer consults a hand-written lookalike
//! table. It asks [`crate::confusables::prototype`] instead, which is UTS #39
//! `confusables.txt` data plus one documented fullwidth override, so it covers
//! several hundred codepoints where the old table covered seventy-one.

use unicode_general_category::{get_general_category, GeneralCategory};

use super::tables::{
    self, BIDI_CPS, EMOJI_GLUE_CODEPOINTS, HANGUL_FILLERS, KHMER_VOWELS, MONGOLIAN_FVS,
    ORTHOGRAPHIC_CF, SCRIPT_JOINERS, SPACE_HOMOGLYPHS, STRIP_CODEPOINTS, ZW_FAMILY,
};
use crate::confusables;
use prose_sanitiser_core::Unit;

/// Variation selectors beyond FE0x (VS17–VS256 in Supplementary Special-purpose).
const VS_SUPPLEMENT: std::ops::Range<u32> = 0xE0100..0xE01F0;
/// Tag characters used in flag sequences (U+E0020–U+E007F).
const TAG_RANGE: std::ops::Range<u32> = 0xE0020..0xE0080;

/// What to do with one input character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Pass the character through untouched.
    Keep,
    /// Remove the character entirely.
    Strip,
    /// Substitute a different character for it.
    Replace,
}

/// The outcome of classifying one character.
#[derive(Debug, Clone, Copy)]
pub struct Decision {
    /// What to do with the character.
    pub action: Action,
    /// The surviving character for keep/replace; `None` for strip.
    pub output: Option<Unit>,
    /// The inspect classification, or `None` when the character is unremarkable.
    pub kind: Option<&'static str>,
}

/// Whether this unit is a byte-order mark in the one position where `U+FEFF`
/// means "byte-order mark" rather than "stray zero-width no-break space".
///
/// Unicode gives `U+FEFF` two jobs. At offset 0 it is a BOM and is part of the
/// document's framing; anywhere else it is a zero-width no-break space and a
/// known steganographic carrier. Only the second is contraband, so the offset
/// is load-bearing information and callers must pass it.
pub fn is_bom_at_start(offset: usize, unit: Unit) -> bool {
    offset == 0 && unit.as_char() == Some('\u{FEFF}')
}

/// BMP and supplementary private-use planes (Co: no portable meaning).
pub fn is_private_use(codepoint: u32) -> bool {
    (0xE000..=0xF8FF).contains(&codepoint)
        || (0xF0000..=0xFFFFD).contains(&codepoint)
        || (0x100000..=0x10FFFD).contains(&codepoint)
}

fn is_strip_cp(codepoint: u32) -> bool {
    tables::contains(STRIP_CODEPOINTS, codepoint)
        || VS_SUPPLEMENT.contains(&codepoint)
        || (0xE0001..=0xE007F).contains(&codepoint)
        || is_private_use(codepoint)
}

/// Finer-grained inspect kind for strip-class codepoints.
fn strip_kind(codepoint: u32) -> &'static str {
    if (0xE0001..=0xE007F).contains(&codepoint) {
        return "tag_chars";
    }
    if VS_SUPPLEMENT.contains(&codepoint)
        || (0xFE00..=0xFE0F).contains(&codepoint)
        || (0x180B..=0x180D).contains(&codepoint)
    {
        return "variation_selector";
    }
    if tables::contains(BIDI_CPS, codepoint) {
        return "bidi";
    }
    if tables::contains(ZW_FAMILY, codepoint) {
        return "zwj_family";
    }
    if is_private_use(codepoint) {
        return "private_use";
    }
    "strip"
}

fn is_emoji_glue(codepoint: u32) -> bool {
    tables::contains(EMOJI_GLUE_CODEPOINTS, codepoint)
}

/// Characters that can start or continue an emoji sequence.
fn is_emoji_base(codepoint: u32) -> bool {
    (0x1F000..=0x1FAFF).contains(&codepoint)
        || (0x2600..=0x27BF).contains(&codepoint) // misc symbols / dingbats / arrows
        || (0x2B00..=0x2BFF).contains(&codepoint) // misc symbols and arrows
        || matches!(
            codepoint,
            0x00A9 | 0x00AE | 0x2122 | 0x3030 | 0x303D | 0x3297 | 0x3299
        )
        || matches!(codepoint, 0x0023 | 0x002A)
        || (0x0030..=0x0039).contains(&codepoint) // keycap bases
}

fn category(character: char) -> GeneralCategory {
    get_general_category(character)
}

/// The two-letter General_Category abbreviation, as `unicodedata.category`
/// returns it.
pub fn category_code(character: char) -> &'static str {
    match category(character) {
        GeneralCategory::UppercaseLetter => "Lu",
        GeneralCategory::LowercaseLetter => "Ll",
        GeneralCategory::TitlecaseLetter => "Lt",
        GeneralCategory::ModifierLetter => "Lm",
        GeneralCategory::OtherLetter => "Lo",
        GeneralCategory::NonspacingMark => "Mn",
        GeneralCategory::SpacingMark => "Mc",
        GeneralCategory::EnclosingMark => "Me",
        GeneralCategory::DecimalNumber => "Nd",
        GeneralCategory::LetterNumber => "Nl",
        GeneralCategory::OtherNumber => "No",
        GeneralCategory::ConnectorPunctuation => "Pc",
        GeneralCategory::DashPunctuation => "Pd",
        GeneralCategory::OpenPunctuation => "Ps",
        GeneralCategory::ClosePunctuation => "Pe",
        GeneralCategory::InitialPunctuation => "Pi",
        GeneralCategory::FinalPunctuation => "Pf",
        GeneralCategory::OtherPunctuation => "Po",
        GeneralCategory::MathSymbol => "Sm",
        GeneralCategory::CurrencySymbol => "Sc",
        GeneralCategory::ModifierSymbol => "Sk",
        GeneralCategory::OtherSymbol => "So",
        GeneralCategory::SpaceSeparator => "Zs",
        GeneralCategory::LineSeparator => "Zl",
        GeneralCategory::ParagraphSeparator => "Zp",
        GeneralCategory::Control => "Cc",
        GeneralCategory::Format => "Cf",
        GeneralCategory::Surrogate => "Cs",
        GeneralCategory::PrivateUse => "Co",
        GeneralCategory::Unassigned => "Cn",
        // The crate marks the enum non-exhaustive; every category above is
        // assigned, so anything new can only be an unassigned codepoint.
        _ => "Cn",
    }
}

/// Non-ASCII letter/mark — the neighbour that makes a joiner orthographic.
fn is_joining_letter(unit: Unit) -> bool {
    match unit.as_char() {
        Some(character) => {
            (character as u32) > 0x7F
                && matches!(
                    category(character),
                    GeneralCategory::UppercaseLetter
                        | GeneralCategory::LowercaseLetter
                        | GeneralCategory::TitlecaseLetter
                        | GeneralCategory::ModifierLetter
                        | GeneralCategory::OtherLetter
                        | GeneralCategory::NonspacingMark
                        | GeneralCategory::SpacingMark
                        | GeneralCategory::EnclosingMark
                )
        }
        None => false,
    }
}

fn is_letter_in_range(unit: Unit, range: std::ops::RangeInclusive<u32>) -> bool {
    match unit.as_char() {
        Some(character) => {
            range.contains(&(character as u32))
                && matches!(
                    category(character),
                    GeneralCategory::UppercaseLetter
                        | GeneralCategory::LowercaseLetter
                        | GeneralCategory::TitlecaseLetter
                        | GeneralCategory::ModifierLetter
                        | GeneralCategory::OtherLetter
                )
        }
        None => false,
    }
}

fn is_hangul_jamo(unit: Unit) -> bool {
    match unit.as_char() {
        Some(character) => {
            let codepoint = character as u32;
            (0x1100..=0x11FF).contains(&codepoint)
                || (0xA960..=0xA97C).contains(&codepoint) // Hangul Jamo Extended-A
                || (0xD7B0..=0xD7C6).contains(&codepoint) // Hangul Jamo Extended-B
        }
        None => false,
    }
}

fn previous_is_emoji_base(previous: Option<Unit>) -> bool {
    previous
        .and_then(Unit::as_char)
        .map(|character| is_emoji_base(character as u32))
        .unwrap_or(false)
}

/// Load-bearing invisible char: emoji glue, script joiner, flag tag char, or
/// same-script filler/selector (Mongolian FVS, Khmer vowel, Hangul filler).
pub fn is_glue(codepoint: u32) -> bool {
    is_emoji_glue(codepoint)
        || tables::contains(SCRIPT_JOINERS, codepoint)
        || TAG_RANGE.contains(&codepoint)
        || tables::contains(MONGOLIAN_FVS, codepoint)
        || tables::contains(KHMER_VOWELS, codepoint)
        || tables::contains(HANGUL_FILLERS, codepoint)
}

/// Classify one input unit for both inspect and clean.
pub fn decide(
    unit: Unit,
    previous_kept: Option<Unit>,
    normalize_spaces: bool,
    treat_confusables: bool,
    strip_emoji_glue: bool,
) -> Decision {
    let keep = Decision {
        action: Action::Keep,
        output: Some(unit),
        kind: None,
    };
    // An undecodable byte is a lone surrogate to Python: category Cs, in no
    // table, so it is always kept untouched.
    let Some(character) = unit.as_char() else {
        return keep;
    };
    let codepoint = character as u32;

    if is_emoji_glue(codepoint) && !strip_emoji_glue && previous_is_emoji_base(previous_kept) {
        return keep;
    }
    if !strip_emoji_glue {
        if tables::contains(SCRIPT_JOINERS, codepoint)
            && previous_kept.map(is_joining_letter).unwrap_or(false)
        {
            return keep;
        }
        if TAG_RANGE.contains(&codepoint) && previous_is_emoji_base(previous_kept) {
            return keep;
        }
        if tables::contains(MONGOLIAN_FVS, codepoint)
            && previous_kept
                .map(|p| is_letter_in_range(p, 0x1800..=0x18AF))
                .unwrap_or(false)
        {
            return keep;
        }
        if tables::contains(KHMER_VOWELS, codepoint)
            && previous_kept
                .map(|p| is_letter_in_range(p, 0x1780..=0x17FF))
                .unwrap_or(false)
        {
            return keep;
        }
        if tables::contains(HANGUL_FILLERS, codepoint)
            && previous_kept.map(is_hangul_jamo).unwrap_or(false)
        {
            return keep;
        }
        if tables::contains(ORTHOGRAPHIC_CF, codepoint) {
            return keep;
        }
    }
    if is_strip_cp(codepoint) {
        return Decision {
            action: Action::Strip,
            output: None,
            kind: Some(strip_kind(codepoint)),
        };
    }
    if normalize_spaces {
        if let Some(replacement) = tables::lookup(SPACE_HOMOGLYPHS, codepoint) {
            return Decision {
                action: Action::Replace,
                output: Some(Unit::Char(replacement)),
                kind: Some("space"),
            };
        }
    }
    if treat_confusables {
        if let Some(replacement) = confusables::prototype(character) {
            return Decision {
                action: Action::Replace,
                output: Some(Unit::Char(replacement)),
                kind: Some("confusable"),
            };
        }
    }
    if category(character) == GeneralCategory::Format
        && tables::lookup(SPACE_HOMOGLYPHS, codepoint).is_none()
    {
        return Decision {
            action: Action::Strip,
            output: None,
            kind: Some("other_cf"),
        };
    }
    keep
}

/// `U+XXXX NAME (Cc)` — the Python `_char_label`.
pub fn char_label(unit: Unit) -> String {
    match unit.as_char() {
        Some(character) => {
            let name = unicode_names2::name(character)
                .map(|name| name.to_string())
                .unwrap_or_else(|| "UNKNOWN".to_string());
            format!(
                "U+{:04X} {} ({})",
                character as u32,
                name,
                category_code(character)
            )
        }
        // Python sees an undecodable byte as U+DCxx, an unnamed surrogate.
        None => match unit {
            Unit::Raw(byte) => format!("U+{:04X} UNKNOWN (Cs)", 0xDC00u32 + byte as u32),
            Unit::Char(_) => unreachable!("as_char returned None for a Char unit"),
        },
    }
}

/// Layer A hits are edit-based carriers; space homoglyphs are weaker context.
pub fn hit_confidence(kind: &str) -> &'static str {
    if kind == "space" {
        "informational"
    } else {
        "probable"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decide_char(character: char, previous: Option<char>) -> Decision {
        decide(
            Unit::Char(character),
            previous.map(Unit::Char),
            true,
            false,
            false,
        )
    }

    #[test]
    fn strips_free_floating_invisibles_with_a_precise_kind() {
        let zwsp = decide_char('\u{200B}', None);
        assert_eq!(zwsp.action, Action::Strip);
        assert_eq!(zwsp.kind, Some("zwj_family"));

        assert_eq!(decide_char('\u{202E}', None).kind, Some("bidi"));
        assert_eq!(
            decide_char('\u{E0101}', None).kind,
            Some("variation_selector")
        );
        assert_eq!(decide_char('\u{E0041}', None).kind, Some("tag_chars"));
        assert_eq!(decide_char('\u{E000}', None).kind, Some("private_use"));
        assert_eq!(decide_char('\u{00AD}', None).kind, Some("strip"));
    }

    #[test]
    fn keeps_emoji_glue_after_an_emoji_base() {
        // ZWJ after an emoji base is load-bearing.
        assert_eq!(
            decide_char('\u{200D}', Some('\u{2764}')).action,
            Action::Keep
        );
        // The same ZWJ free-floating after a letter is contraband.
        assert_eq!(decide_char('\u{200D}', Some('a')).action, Action::Strip);
    }

    #[test]
    fn keeps_script_joiners_inside_complex_scripts() {
        // ZWNJ after a Persian letter is orthographic.
        assert_eq!(
            decide_char('\u{200C}', Some('\u{0645}')).action,
            Action::Keep
        );
        assert_eq!(decide_char('\u{200C}', Some('a')).action, Action::Strip);
    }

    #[test]
    fn keeps_same_script_fillers_only_after_their_own_script() {
        // Mongolian FVS after a Mongolian letter, Khmer vowel after Khmer,
        // Hangul filler after a jamo.
        assert_eq!(
            decide_char('\u{180B}', Some('\u{1820}')).action,
            Action::Keep
        );
        assert_eq!(decide_char('\u{180B}', Some('a')).action, Action::Strip);
        assert_eq!(
            decide_char('\u{17B4}', Some('\u{1780}')).action,
            Action::Keep
        );
        assert_eq!(
            decide_char('\u{1160}', Some('\u{1100}')).action,
            Action::Keep
        );
    }

    #[test]
    fn orthographic_arabic_cf_marks_survive_anywhere() {
        assert_eq!(decide_char('\u{0600}', None).action, Action::Keep);
    }

    #[test]
    fn paranoid_mode_strips_every_load_bearing_invisible() {
        let decision = decide(
            Unit::Char('\u{200D}'),
            Some(Unit::Char('\u{2764}')),
            true,
            false,
            true,
        );
        assert_eq!(decision.action, Action::Strip);
    }

    #[test]
    fn normalises_spaces_and_optionally_confusables() {
        let space = decide_char('\u{00A0}', None);
        assert_eq!(space.action, Action::Replace);
        assert_eq!(space.output, Some(Unit::Char(' ')));
        assert_eq!(space.kind, Some("space"));

        // Cyrillic 'а' is only rewritten in aggressive mode.
        assert_eq!(decide_char('\u{0430}', None).action, Action::Keep);
        let confusable = decide(Unit::Char('\u{0430}'), None, true, true, false);
        assert_eq!(confusable.output, Some(Unit::Char('a')));
        assert_eq!(confusable.kind, Some("confusable"));
    }

    #[test]
    fn unlisted_format_characters_fall_through_to_other_cf() {
        // U+1D173 (MUSICAL SYMBOL BEGIN BEAM) is Cf but in none of the tables.
        assert_eq!(decide_char('\u{1D173}', None).kind, Some("other_cf"));
        // U+2065 is unassigned (Cn), not Cf, so it is left alone.
        assert_eq!(decide_char('\u{2065}', None).action, Action::Keep);
    }

    #[test]
    fn undecodable_bytes_are_always_kept() {
        let decision = decide(Unit::Raw(0xFF), None, true, true, true);
        assert_eq!(decision.action, Action::Keep);
        assert_eq!(decision.output, Some(Unit::Raw(0xFF)));
    }

    #[test]
    fn char_label_matches_the_python_format() {
        assert_eq!(
            char_label(Unit::Char('\u{200B}')),
            "U+200B ZERO WIDTH SPACE (Cf)"
        );
        assert_eq!(
            char_label(Unit::Char('a')),
            "U+0061 LATIN SMALL LETTER A (Ll)"
        );
    }

    #[test]
    fn confidence_downgrades_only_space_homoglyphs() {
        assert_eq!(hit_confidence("space"), "informational");
        assert_eq!(hit_confidence("bidi"), "probable");
    }
}
