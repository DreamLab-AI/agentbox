//! Codepoint tables for Layer A: invisible controls and space homoglyphs.
//!
//! Generated verbatim from the Python `text_unicode` tables this crate
//! replaces; the counts are asserted in the tests below so a hand edit that
//! drops an entry fails the build rather than silently weakening detection.
//!
//! There is deliberately **no** confusables table here. The hand-written
//! 71-entry Latin lookalike list this module used to carry was replaced by
//! UTS #39 `confusables.txt` data; see [`crate::confusables`] for what the
//! standard covers and for the one documented override that closes its
//! fullwidth gap.

/// Format / invisible controls commonly used for steganography or broken pastes.
pub const STRIP_CODEPOINTS: &[u32] = &[
    0x00AD, // SOFT HYPHEN
    0x034F, // COMBINING GRAPHEME JOINER
    0x061C, // ARABIC LETTER MARK
    0x115F, // HANGUL CHOSEONG FILLER
    0x1160, // HANGUL JUNGSEONG FILLER
    0x17B4, // KHMER VOWEL INHERENT AQ
    0x17B5, // KHMER VOWEL INHERENT AA
    0x180B, // MONGOLIAN FREE VARIATION SELECTOR ONE
    0x180C, // MONGOLIAN FREE VARIATION SELECTOR TWO
    0x180D, // MONGOLIAN FREE VARIATION SELECTOR THREE
    0x180E, // MONGOLIAN VOWEL SEPARATOR
    0x200B, // ZERO WIDTH SPACE
    0x200C, // ZERO WIDTH NON-JOINER
    0x200D, // ZERO WIDTH JOINER
    0x200E, // LEFT-TO-RIGHT MARK
    0x200F, // RIGHT-TO-LEFT MARK
    0x202A, // LEFT-TO-RIGHT EMBEDDING
    0x202B, // RIGHT-TO-LEFT EMBEDDING
    0x202C, // POP DIRECTIONAL FORMATTING
    0x202D, // LEFT-TO-RIGHT OVERRIDE
    0x202E, // RIGHT-TO-LEFT OVERRIDE
    0x2060, // WORD JOINER
    0x2061, // FUNCTION APPLICATION
    0x2062, // INVISIBLE TIMES
    0x2063, // INVISIBLE SEPARATOR
    0x2064, // INVISIBLE PLUS
    0x2066, // LEFT-TO-RIGHT ISOLATE
    0x2067, // RIGHT-TO-LEFT ISOLATE
    0x2068, // FIRST STRONG ISOLATE
    0x2069, // POP DIRECTIONAL ISOLATE
    0x206A, // INHIBIT SYMMETRIC SWAPPING
    0x206B, // ACTIVATE SYMMETRIC SWAPPING
    0x206C, // INHIBIT ARABIC FORM SHAPING
    0x206D, // ACTIVATE ARABIC FORM SHAPING
    0x206E, // NATIONAL DIGIT SHAPES
    0x206F, // NOMINAL DIGIT SHAPES
    0xFE00, // VARIATION SELECTOR-1
    0xFE01, // VARIATION SELECTOR-2
    0xFE02, // VARIATION SELECTOR-3
    0xFE03, // VARIATION SELECTOR-4
    0xFE04, // VARIATION SELECTOR-5
    0xFE05, // VARIATION SELECTOR-6
    0xFE06, // VARIATION SELECTOR-7
    0xFE07, // VARIATION SELECTOR-8
    0xFE08, // VARIATION SELECTOR-9
    0xFE09, // VARIATION SELECTOR-10
    0xFE0A, // VARIATION SELECTOR-11
    0xFE0B, // VARIATION SELECTOR-12
    0xFE0C, // VARIATION SELECTOR-13
    0xFE0D, // VARIATION SELECTOR-14
    0xFE0E, // VARIATION SELECTOR-15
    0xFE0F, // VARIATION SELECTOR-16
    0xFEFF, // ZERO WIDTH NO-BREAK SPACE
    0xFFF9, // INTERLINEAR ANNOTATION ANCHOR
    0xFFFA, // INTERLINEAR ANNOTATION SEPARATOR
    0xFFFB, // INTERLINEAR ANNOTATION TERMINATOR
];

/// Spaces that look like (or substitute for) U+0020.
pub const SPACE_HOMOGLYPHS: &[(u32, char)] = &[
    (0x00A0, ' '), // NO-BREAK SPACE
    (0x1680, ' '), // OGHAM SPACE MARK
    (0x2000, ' '), // EN QUAD
    (0x2001, ' '), // EM QUAD
    (0x2002, ' '), // EN SPACE
    (0x2003, ' '), // EM SPACE
    (0x2004, ' '), // THREE-PER-EM SPACE
    (0x2005, ' '), // FOUR-PER-EM SPACE
    (0x2006, ' '), // SIX-PER-EM SPACE
    (0x2007, ' '), // FIGURE SPACE
    (0x2008, ' '), // PUNCTUATION SPACE
    (0x2009, ' '), // THIN SPACE
    (0x200A, ' '), // HAIR SPACE
    (0x202F, ' '), // NARROW NO-BREAK SPACE
    (0x205F, ' '), // MEDIUM MATHEMATICAL SPACE
    (0x3000, ' '), // IDEOGRAPHIC SPACE
];

/// Bidi controls, for the `bidi` inspect kind. Policy lives in [`crate::bidi`].
pub const BIDI_CPS: &[u32] = &[
    0x061C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069,
];

/// The zero-width family, for the `zwj_family` inspect kind.
pub const ZW_FAMILY: &[u32] = &[0x180E, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF];

/// Joiner and presentation selectors that bind an emoji sequence together.
pub const EMOJI_GLUE_CODEPOINTS: &[u32] = &[0x200D, 0xFE0E, 0xFE0F];

/// ZWNJ and ZWJ, which are orthographic inside complex scripts.
pub const SCRIPT_JOINERS: &[u32] = &[0x200C, 0x200D];

/// Arabic and Syriac `Cf` marks that are orthographic wherever they appear.
pub const ORTHOGRAPHIC_CF: &[u32] = &[
    0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06DD, 0x070F, 0x08E2, 0x110BD, 0x110CD,
];

/// Mongolian free variation selectors, load-bearing after a Mongolian letter.
pub const MONGOLIAN_FVS: &[u32] = &[0x180B, 0x180C, 0x180D];

/// Khmer inherent vowels, load-bearing after a Khmer letter.
pub const KHMER_VOWELS: &[u32] = &[0x17B4, 0x17B5];

/// Hangul jamo fillers, load-bearing after a jamo.
pub const HANGUL_FILLERS: &[u32] = &[0x115F, 0x1160];

/// Look up a replacement in one of the homoglyph tables.
pub fn lookup(table: &[(u32, char)], codepoint: u32) -> Option<char> {
    table
        .iter()
        .find(|(from, _)| *from == codepoint)
        .map(|(_, to)| *to)
}

/// Membership test for the flat codepoint sets.
pub fn contains(table: &[u32], codepoint: u32) -> bool {
    table.contains(&codepoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_match_the_ported_python_sizes() {
        assert_eq!(STRIP_CODEPOINTS.len(), 56);
        assert_eq!(SPACE_HOMOGLYPHS.len(), 16);
        assert_eq!(BIDI_CPS.len(), 12);
        assert_eq!(ZW_FAMILY.len(), 6);
        assert_eq!(EMOJI_GLUE_CODEPOINTS.len(), 3);
        assert_eq!(ORTHOGRAPHIC_CF.len(), 11);
    }

    #[test]
    fn lookup_maps_spaces_and_nothing_else() {
        assert_eq!(lookup(SPACE_HOMOGLYPHS, 0x00A0), Some(' '));
        assert_eq!(lookup(SPACE_HOMOGLYPHS, 0x0041), None);
    }

    #[test]
    fn every_space_homoglyph_maps_to_plain_space() {
        assert!(SPACE_HOMOGLYPHS.iter().all(|(_, to)| *to == ' '));
    }

    #[test]
    fn space_homoglyphs_are_never_also_strip_codepoints() {
        assert!(!SPACE_HOMOGLYPHS
            .iter()
            .any(|(cp, _)| contains(STRIP_CODEPOINTS, *cp)));
    }
}
