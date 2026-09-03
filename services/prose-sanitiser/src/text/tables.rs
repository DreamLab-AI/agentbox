//! Codepoint tables for Layer A: invisible controls, space homoglyphs and
//! Latin confusables.
//!
//! Generated verbatim from the Python `text_unicode` tables this crate
//! replaces; the counts are asserted in the tests below so a hand edit that
//! drops an entry fails the build rather than silently weakening detection.

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

/// Optional confusable Latin lookalikes (aggressive mode only).
pub const LATIN_CONFUSABLES: &[(u32, char)] = &[
    (0x0410, 'A'), // CYRILLIC CAPITAL LETTER A
    (0x0412, 'B'), // CYRILLIC CAPITAL LETTER VE
    (0x0415, 'E'), // CYRILLIC CAPITAL LETTER IE
    (0x041A, 'K'), // CYRILLIC CAPITAL LETTER KA
    (0x041C, 'M'), // CYRILLIC CAPITAL LETTER EM
    (0x041D, 'H'), // CYRILLIC CAPITAL LETTER EN
    (0x041E, 'O'), // CYRILLIC CAPITAL LETTER O
    (0x0420, 'P'), // CYRILLIC CAPITAL LETTER ER
    (0x0421, 'C'), // CYRILLIC CAPITAL LETTER ES
    (0x0422, 'T'), // CYRILLIC CAPITAL LETTER TE
    (0x0425, 'X'), // CYRILLIC CAPITAL LETTER HA
    (0x0430, 'a'), // CYRILLIC SMALL LETTER A
    (0x0435, 'e'), // CYRILLIC SMALL LETTER IE
    (0x043E, 'o'), // CYRILLIC SMALL LETTER O
    (0x0440, 'p'), // CYRILLIC SMALL LETTER ER
    (0x0441, 'c'), // CYRILLIC SMALL LETTER ES
    (0x0443, 'y'), // CYRILLIC SMALL LETTER U
    (0x0445, 'x'), // CYRILLIC SMALL LETTER HA
    (0x0456, 'i'), // CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
    (0xFF21, 'A'), // FULLWIDTH LATIN CAPITAL LETTER A
    (0xFF22, 'B'), // FULLWIDTH LATIN CAPITAL LETTER B
    (0xFF23, 'C'), // FULLWIDTH LATIN CAPITAL LETTER C
    (0xFF24, 'D'), // FULLWIDTH LATIN CAPITAL LETTER D
    (0xFF25, 'E'), // FULLWIDTH LATIN CAPITAL LETTER E
    (0xFF26, 'F'), // FULLWIDTH LATIN CAPITAL LETTER F
    (0xFF27, 'G'), // FULLWIDTH LATIN CAPITAL LETTER G
    (0xFF28, 'H'), // FULLWIDTH LATIN CAPITAL LETTER H
    (0xFF29, 'I'), // FULLWIDTH LATIN CAPITAL LETTER I
    (0xFF2A, 'J'), // FULLWIDTH LATIN CAPITAL LETTER J
    (0xFF2B, 'K'), // FULLWIDTH LATIN CAPITAL LETTER K
    (0xFF2C, 'L'), // FULLWIDTH LATIN CAPITAL LETTER L
    (0xFF2D, 'M'), // FULLWIDTH LATIN CAPITAL LETTER M
    (0xFF2E, 'N'), // FULLWIDTH LATIN CAPITAL LETTER N
    (0xFF2F, 'O'), // FULLWIDTH LATIN CAPITAL LETTER O
    (0xFF30, 'P'), // FULLWIDTH LATIN CAPITAL LETTER P
    (0xFF31, 'Q'), // FULLWIDTH LATIN CAPITAL LETTER Q
    (0xFF32, 'R'), // FULLWIDTH LATIN CAPITAL LETTER R
    (0xFF33, 'S'), // FULLWIDTH LATIN CAPITAL LETTER S
    (0xFF34, 'T'), // FULLWIDTH LATIN CAPITAL LETTER T
    (0xFF35, 'U'), // FULLWIDTH LATIN CAPITAL LETTER U
    (0xFF36, 'V'), // FULLWIDTH LATIN CAPITAL LETTER V
    (0xFF37, 'W'), // FULLWIDTH LATIN CAPITAL LETTER W
    (0xFF38, 'X'), // FULLWIDTH LATIN CAPITAL LETTER X
    (0xFF39, 'Y'), // FULLWIDTH LATIN CAPITAL LETTER Y
    (0xFF3A, 'Z'), // FULLWIDTH LATIN CAPITAL LETTER Z
    (0xFF41, 'a'), // FULLWIDTH LATIN SMALL LETTER A
    (0xFF42, 'b'), // FULLWIDTH LATIN SMALL LETTER B
    (0xFF43, 'c'), // FULLWIDTH LATIN SMALL LETTER C
    (0xFF44, 'd'), // FULLWIDTH LATIN SMALL LETTER D
    (0xFF45, 'e'), // FULLWIDTH LATIN SMALL LETTER E
    (0xFF46, 'f'), // FULLWIDTH LATIN SMALL LETTER F
    (0xFF47, 'g'), // FULLWIDTH LATIN SMALL LETTER G
    (0xFF48, 'h'), // FULLWIDTH LATIN SMALL LETTER H
    (0xFF49, 'i'), // FULLWIDTH LATIN SMALL LETTER I
    (0xFF4A, 'j'), // FULLWIDTH LATIN SMALL LETTER J
    (0xFF4B, 'k'), // FULLWIDTH LATIN SMALL LETTER K
    (0xFF4C, 'l'), // FULLWIDTH LATIN SMALL LETTER L
    (0xFF4D, 'm'), // FULLWIDTH LATIN SMALL LETTER M
    (0xFF4E, 'n'), // FULLWIDTH LATIN SMALL LETTER N
    (0xFF4F, 'o'), // FULLWIDTH LATIN SMALL LETTER O
    (0xFF50, 'p'), // FULLWIDTH LATIN SMALL LETTER P
    (0xFF51, 'q'), // FULLWIDTH LATIN SMALL LETTER Q
    (0xFF52, 'r'), // FULLWIDTH LATIN SMALL LETTER R
    (0xFF53, 's'), // FULLWIDTH LATIN SMALL LETTER S
    (0xFF54, 't'), // FULLWIDTH LATIN SMALL LETTER T
    (0xFF55, 'u'), // FULLWIDTH LATIN SMALL LETTER U
    (0xFF56, 'v'), // FULLWIDTH LATIN SMALL LETTER V
    (0xFF57, 'w'), // FULLWIDTH LATIN SMALL LETTER W
    (0xFF58, 'x'), // FULLWIDTH LATIN SMALL LETTER X
    (0xFF59, 'y'), // FULLWIDTH LATIN SMALL LETTER Y
    (0xFF5A, 'z'), // FULLWIDTH LATIN SMALL LETTER Z
];

pub const BIDI_CPS: &[u32] = &[
    0x061C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069,
];

pub const ZW_FAMILY: &[u32] = &[0x180E, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF];

pub const EMOJI_GLUE_CODEPOINTS: &[u32] = &[0x200D, 0xFE0E, 0xFE0F];

pub const SCRIPT_JOINERS: &[u32] = &[0x200C, 0x200D];

pub const ORTHOGRAPHIC_CF: &[u32] = &[
    0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605, 0x06DD, 0x070F, 0x08E2, 0x110BD, 0x110CD,
];

pub const MONGOLIAN_FVS: &[u32] = &[0x180B, 0x180C, 0x180D];

pub const KHMER_VOWELS: &[u32] = &[0x17B4, 0x17B5];

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
        assert_eq!(LATIN_CONFUSABLES.len(), 71);
        assert_eq!(BIDI_CPS.len(), 12);
        assert_eq!(ZW_FAMILY.len(), 6);
        assert_eq!(EMOJI_GLUE_CODEPOINTS.len(), 3);
        assert_eq!(ORTHOGRAPHIC_CF.len(), 11);
    }

    #[test]
    fn lookup_maps_confusables_and_spaces() {
        assert_eq!(lookup(SPACE_HOMOGLYPHS, 0x00A0), Some(' '));
        assert_eq!(lookup(LATIN_CONFUSABLES, 0x0430), Some('a'));
        assert_eq!(lookup(LATIN_CONFUSABLES, 0x0041), None);
    }

    #[test]
    fn every_space_homoglyph_maps_to_plain_space() {
        assert!(SPACE_HOMOGLYPHS.iter().all(|(_, to)| *to == ' '));
    }

    #[test]
    fn confusables_and_spaces_do_not_overlap() {
        assert!(!LATIN_CONFUSABLES
            .iter()
            .any(|(cp, _)| lookup(SPACE_HOMOGLYPHS, *cp).is_some()));
    }
}
