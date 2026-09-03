use super::*;
use prose_sanitiser_core::surrogate;

fn units(text: &str) -> Vec<Unit> {
    surrogate::decode(text.as_bytes())
}

fn hits(text: &str) -> Vec<ConfusableHit> {
    scan(&units(text))
}

/// The legitimate-content controls from section D3 of the design brief. A
/// single hit on any of these is a hard failure, not a tuning question.
const LEGITIMATE: &[(&str, &str)] = &[
    ("Devanagari", "देवनागरी हिन्दी नमस्ते"),
    ("Persian", "سلام فارسی نوشتار"),
    ("Hebrew", "שלום עברית כתיבה"),
    ("Hebrew-Latin", "שלום world שלום"),
    ("Russian", "Москва привет мир"),
    ("Greek", "Ελλάδα λόγος κόσμος"),
    ("Japanese", "日本語 の 文章"),
    ("Korean", "한국어 문장"),
    ("accented Latin", "café naïve Zürich façade"),
    ("Turkish", "İstanbul ışık yıldız"),
    ("emoji", "\u{1F600} \u{2764}\u{FE0F} \u{1F1EC}\u{1F1E7}"),
    (
        "ASCII prose",
        "The quick brown fox jumps over the lazy dog 0123456789",
    ),
];

#[test]
fn legitimate_content_produces_no_hits_at_all() {
    for (name, sample) in LEGITIMATE {
        let found = hits(sample);
        assert!(
            found.is_empty(),
            "{name} must produce zero hits, got {found:?}"
        );
    }
}

#[test]
fn the_skeleton_is_the_uts39_comparison_key() {
    // Two strings are confusable exactly when their skeletons match.
    assert_eq!(skeleton("paypal"), skeleton("\u{0440}ay\u{0440}al"));
    // ASCII digit one and lowercase L share a skeleton, so "paypa1" is
    // confusable with "paypal" too. That is the standard's judgement, and the
    // reason `prototype` refuses to fold ASCII: the comparison is sound but the
    // corresponding *substitution* would corrupt every digit in a document.
    assert_eq!(skeleton("paypal"), skeleton("paypa1"));
}

#[test]
fn the_skeleton_is_never_used_as_a_transformation() {
    // It is deliberately lossy: honest Russian and accented Latin skeleton to
    // something quite unlike themselves, which is why prose is never folded
    // through it wholesale.
    assert_ne!(skeleton("привет"), "привет");
    assert_ne!(skeleton("café"), "café");
}

#[test]
fn prototype_folds_cross_script_lookalikes_to_ascii() {
    assert_eq!(prototype('\u{0430}'), Some('a')); // Cyrillic a
    assert_eq!(prototype('\u{043E}'), Some('o')); // Cyrillic o
    assert_eq!(prototype('\u{0435}'), Some('e')); // Cyrillic ie
    assert_eq!(prototype('\u{03BF}'), Some('o')); // Greek omicron
    assert_eq!(prototype('\u{0585}'), Some('o')); // Armenian oh
}

#[test]
fn prototype_declines_ascii_and_honest_letters() {
    // Already ASCII: nothing to fold, and folding would corrupt digits.
    assert_eq!(prototype('a'), None);
    assert_eq!(prototype('1'), None);
    assert_eq!(prototype('0'), None);
    // Accented Latin skeletons to a base plus a combining mark, never a single
    // ASCII character, so it is left alone.
    assert_eq!(prototype('é'), None);
    assert_eq!(prototype('ü'), None);
    // Not a letter or digit at all.
    assert_eq!(prototype('\u{2014}'), None);
}

#[test]
fn the_fullwidth_override_closes_the_documented_gap() {
    // confusables.txt folds some fullwidth forms but not others; the override
    // makes the whole alphabet behave consistently.
    for (source, expected) in [
        ('\u{FF21}', 'A'), // folds in confusables.txt
        ('\u{FF24}', 'D'), // does not: the gap
        ('\u{FF5A}', 'z'), // does not
        ('\u{FF10}', '0'), // fullwidth digit: does not
    ] {
        assert_eq!(prototype(source), Some(expected), "U+{:04X}", source as u32);
    }
}

#[test]
fn restricted_identifiers_are_caught_without_any_context() {
    // Fullwidth, mathematical alphanumeric, Roman numeral: all restricted from
    // identifiers by UTS #39 and all folding to ASCII.
    for sample in ["\u{FF21}bc", "\u{1D41A}bc", "\u{2160}bc"] {
        let found = hits(sample);
        assert_eq!(found.len(), 1, "{sample:?}");
        assert_eq!(found[0].reason, ConfusableReason::Restricted);
    }
}

#[test]
fn mixed_script_substitution_is_caught_per_word() {
    let found = hits("h\u{0435}llo");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].character, '\u{0435}');
    assert_eq!(found[0].prototype, 'e');
    assert_eq!(found[0].reason, ConfusableReason::MixedScriptRun);
    assert_eq!(found[0].offset, 1);
    assert_eq!(found[0].word, "hello".replace('e', "\u{0435}"));
}

#[test]
fn a_hebrew_latin_document_flags_only_the_tampered_word() {
    // Mixed direction is normal; a Latin word with a Cyrillic letter is not.
    let found = hits("שלום p\u{0430}ypal שלום");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].prototype, 'a');
}

#[test]
fn silverspeak_substitution_rates_are_all_detected() {
    // Substituting 5, 10 and 20 per cent of a Latin passage's characters with
    // Cyrillic lookalikes must be caught at every rate.
    let base = "the quick brown fox jumps over the lazy dog and runs away home";
    let swappable: Vec<usize> = base
        .char_indices()
        .filter(|(_, c)| matches!(c, 'a' | 'e' | 'o' | 'c' | 'p' | 'x' | 'y'))
        .map(|(index, _)| index)
        .collect();
    for rate in [5usize, 10, 20] {
        let take = (swappable.len() * rate).div_ceil(100).max(1);
        let targets: Vec<usize> = swappable
            .iter()
            .copied()
            .step_by((swappable.len() / take).max(1))
            .take(take)
            .collect();
        let tampered: String = base
            .char_indices()
            .map(|(index, character)| {
                if targets.contains(&index) {
                    match character {
                        'a' => '\u{0430}',
                        'e' => '\u{0435}',
                        'o' => '\u{043E}',
                        'c' => '\u{0441}',
                        'p' => '\u{0440}',
                        'x' => '\u{0445}',
                        'y' => '\u{0443}',
                        other => other,
                    }
                } else {
                    character
                }
            })
            .collect();
        let found = hits(&tampered);
        assert!(
            found.len() >= take,
            "{rate} per cent: expected at least {take} hits, got {}",
            found.len()
        );
        // Precision: every hit must fold back to the original character.
        for hit in &found {
            let original = base.chars().nth(tampered.chars().take(hit.offset).count());
            assert_eq!(Some(hit.prototype), original, "{rate} per cent");
        }
    }
}

#[test]
fn a_wholly_substituted_word_is_caught_in_a_latin_document() {
    // Every character swapped, so the word is single-script Cyrillic sitting
    // in an otherwise English document.
    let found = hits("please log in to \u{0440}\u{0430}\u{0443}\u{0440}\u{0430} now");
    assert!(!found.is_empty());
    assert!(found
        .iter()
        .all(|hit| hit.reason == ConfusableReason::SubstitutedWord));
}

#[test]
fn an_honestly_cyrillic_document_is_never_folded() {
    // The same word, in a document that is genuinely Russian: left alone,
    // because the substituted-word rule is gated on document dominance.
    assert!(hits("Москва привет \u{0440}\u{0430}\u{0443}\u{0440}\u{0430} мир").is_empty());
}

#[test]
fn a_substituted_single_letter_word_is_caught() {
    // Swapping the English article "a" for Cyrillic small a is single-script,
    // so only the whole-word rule can see it.
    let found = hits("this is \u{0430} test of the system");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].character, '\u{0430}');
    assert_eq!(found[0].prototype, 'a');
    assert_eq!(found[0].reason, ConfusableReason::SubstitutedWord);
}

#[test]
fn a_lone_greek_letter_in_english_prose_is_left_alone() {
    // Scientific notation, not substitution — even though Greek folds readily
    // to ASCII (alpha to "a", sigma to "o", rho to "p").
    for sample in [
        "the \u{03B1} particle decays quickly",
        "let \u{03C3} denote the standard deviation",
        "the \u{03C1} term dominates at low temperature",
    ] {
        assert!(hits(sample).is_empty(), "{sample:?} must not be flagged");
    }
}

#[test]
fn restriction_levels_are_reported_for_context() {
    assert_eq!(restriction_level("hello"), RestrictionLevel::ASCIIOnly);
    assert_eq!(restriction_level("привет"), RestrictionLevel::SingleScript);
    assert!(restriction_level("p\u{0430}ypal") > RestrictionLevel::SingleScript);
}

#[test]
fn the_unicode_version_backing_the_tables_is_recorded() {
    // Stated so the honest-coverage note in the module docs cannot drift from
    // the data actually compiled in.
    assert_eq!(UNICODE_VERSION.0, 16);
}
