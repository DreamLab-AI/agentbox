//! Span exclusion: the regions no rule may look at.

use prose_sanitiser_core::{Check, Config, Span};

use super::{check, matches};
use crate::{UkEnglish, UkOptions};

#[test]
fn fenced_code_blocks_are_skipped() {
    let document = "The colour is fine.\n\n```css\na { color: red; }\n```\n\nSo is this centre.";
    assert!(check(document).is_empty(), "{:?}", matches(document));
}

#[test]
fn a_tilde_fence_works_too_and_an_unclosed_fence_swallows_the_rest() {
    assert!(check("~~~\ncolor: red\n~~~\n").is_empty());
    assert!(check("intro\n\n```\ncolor\ncenter\ntheater\n").is_empty());
}

#[test]
fn inline_code_is_skipped_but_the_prose_around_it_is_not() {
    let document = "Set `color: red` but write the color out in prose.";
    assert_eq!(matches(document), ["color"]);
    // The surviving hit is the one after the closing backtick, not inside it.
    let finding = &check(document)[0];
    assert!(finding.span.start > document.rfind('`').expect("a closing backtick"));
}

#[test]
fn an_odd_backtick_cannot_silence_the_rest_of_the_document() {
    // Inline spans are confined to one line precisely so this stays checked.
    let document = "A stray ` backtick here.\nThe color is still wrong.";
    assert_eq!(matches(document), ["color"]);
}

#[test]
fn front_matter_is_skipped_in_both_flavours() {
    assert!(check("---\ncolor: blue\ntheater: yes\n---\n\nThe colour is fine.").is_empty());
    assert!(check("+++\ncolor = \"blue\"\n+++\n\nThe colour is fine.").is_empty());
}

#[test]
fn a_horizontal_rule_is_not_mistaken_for_front_matter() {
    // No closing marker, so the block is a rule and the prose stays checked.
    assert_eq!(matches("---\n\nThe color is wrong."), ["color"]);
}

#[test]
fn urls_and_email_addresses_are_skipped() {
    for document in [
        "See https://example.com/color/center for detail.",
        "Write to color.center@example.com about it.",
        "Visit www.example.com/theater today.",
        "A [link](https://example.org/catalog) in Markdown.",
    ] {
        assert!(check(document).is_empty(), "fired on {document:?}");
    }
}

#[test]
fn quotations_are_left_as_their_author_wrote_them() {
    for document in [
        "He said \"the color of the center\" and sat down.",
        "He said \u{201C}the color of the center\u{201D} and sat down.",
        "> The color of the center was wrong.",
    ] {
        assert!(check(document).is_empty(), "fired on {document:?}");
    }
}

#[test]
fn quotes_never_pair_across_a_paragraph_break() {
    // One stray quote in each paragraph. If pairing crossed the blank line the
    // two would match and silence everything between them; instead neither
    // opens a span, and both Americanisms stay visible.
    let document = "He said \"the color was wrong.\n\nThe center still\" needs work.";
    assert_eq!(matches(document), ["color", "center"]);
}

#[test]
fn quotation_exclusion_can_be_turned_off() {
    let checker = UkEnglish::with_options(UkOptions::new().with_quotation_exclusion(false));
    let findings = checker.check("He said \"the color\".", &Config::new());
    assert_eq!(findings.len(), 1);
}

#[test]
fn a_capitalised_word_mid_sentence_is_treated_as_a_name() {
    assert!(check("We met the Color Guard at noon.").is_empty());
}

#[test]
fn a_sentence_initial_americanism_is_still_caught() {
    // The proper-noun heuristic must not become a blanket amnesty.
    assert_eq!(
        matches("Color is the first thing readers notice."),
        ["Color"]
    );
    assert_eq!(matches("# Color management\n"), ["Color"]);
    assert_eq!(matches("- Color choices matter.\n"), ["Color"]);
    assert_eq!(matches("Done. Color is next."), ["Color"]);
}

#[test]
fn case_is_carried_into_the_replacement() {
    let findings = check("Color is next. COLOR is loud.");
    let replacements: Vec<&str> = findings
        .iter()
        .filter_map(|f| f.replacement.as_deref())
        .collect();
    assert_eq!(replacements, ["Colour", "COLOUR"]);
}

#[test]
fn non_english_paragraphs_are_skipped() {
    let german = "Die Farbe der mittleren Platte wurde vom Ausschuss nach einer langen \
                  und ziemlich langweiligen Diskussion \u{00FC}ber die Beleuchtung gew\u{00E4}hlt.";
    let document = format!("{german}\n\nThe color of the panel was wrong.");
    assert_eq!(matches(&document), ["color"]);
}

#[test]
fn the_language_filter_can_be_turned_off() {
    let checker = UkEnglish::with_options(UkOptions::new().with_language_filter(false));
    let text = "Ceci est un texte francais avec le mot color dedans, ecrit pour le test \
                de detection de langue automatique.";
    assert_eq!(checker.check(text, &Config::new()).len(), 1);
}

#[test]
fn short_text_is_never_silenced_by_the_language_filter() {
    // Below the length floor the detector is unreliable, so English is assumed.
    assert_eq!(matches("The color."), ["color"]);
}

#[test]
fn exclusions_are_merged_and_ordered() {
    let document = "---\ncolor: 1\n---\n\nSee `color` and https://x.com/color now.";
    let exclusions = UkEnglish::new().exclusions(document);
    assert!(!exclusions.is_empty());
    for pair in exclusions.spans().windows(2) {
        assert!(pair[0].end < pair[1].start, "spans overlap or abut");
    }
    let colour = document.rfind("color").unwrap();
    assert!(exclusions.blocks(Span::new(colour, colour + 5)));
}
