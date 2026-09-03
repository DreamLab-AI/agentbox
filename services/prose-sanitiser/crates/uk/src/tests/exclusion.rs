//! Span exclusion: the regions no rule may look at.

use prose_sanitiser_core::{Check, Config, Fix, Span};

use super::{check, check_with, matches};
use crate::{UkEnglish, UkOptions};

/// The text `--write` would leave behind: every fix the stylistic tier allows.
///
/// This is the assertion Codex asked for and the crate did not have. Detection
/// tests prove a finding was not raised; only a fix-level test proves the bytes
/// survive, and the two can disagree — a rule can raise nothing while a
/// neighbouring rule's replacement still lands inside a protected span.
fn rewritten(document: &str) -> String {
    let checker = UkEnglish::new();
    let config = Config::new().with_write(true);
    checker
        .fix_document(document, &config)
        .apply(document)
        .expect("a patch built from this document applies to it")
}

/// Assert that `document` is returned byte for byte by a `--write` pass.
fn unchanged_under_write(document: &str) {
    assert_eq!(
        rewritten(document),
        document,
        "a --write pass rewrote a protected span"
    );
}

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
    // The switch lives on the shared Config, not on UkOptions, so one setting
    // governs every checker in the workspace.
    let text = "Ceci est un texte francais avec le mot color dedans, ecrit pour le test \
                de detection de langue automatique.";
    assert!(check(text).is_empty(), "the filter should skip French");
    assert_eq!(
        check_with(text, &Config::new().without_language_filter()).len(),
        1
    );
}

#[test]
fn a_suppression_directive_silences_a_finding() {
    let document = "<!-- prose-sanitiser-disable us-spelling -->\nThe color is wrong.";
    assert!(check(document).is_empty());
    // And an audit can switch suppressions off to see what was hidden.
    assert_eq!(
        check_with(document, &Config::new().with_suppressions(false)).len(),
        1
    );
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

// ---- the spans Codex found unprotected ------------------------------------
//
// Every case below produced a `us-spelling` finding before 2026-09-03, and
// `--write` would have applied it: to someone else's words, to code, or to a
// link target. Each is asserted twice, once for detection and once for the
// bytes, because those are different guarantees.

#[test]
fn single_quotation_marks_protect_their_contents() {
    for document in [
        "He said 'The color is red.' and sat down.",
        "He said \u{2018}The color is red.\u{2019} and sat down.",
    ] {
        assert!(check(document).is_empty(), "fired on {document:?}");
        unchanged_under_write(document);
    }
}

#[test]
fn an_apostrophe_is_not_a_quotation_mark() {
    // The reason straight singles were skipped entirely before. A contraction
    // and a plural possessive must not open a span, or one apostrophe would
    // silence everything to the next one.
    assert_eq!(matches("It doesn't change the color at all."), ["color"]);
    assert_eq!(matches("The doctors' color chart is wrong."), ["color"]);
    // Hart's is an apostrophe; the curly quote after it must not close a span
    // that no opener began.
    assert_eq!(
        matches("Hart\u{2019}s rules and the color of the page."),
        ["color"]
    );
}

#[test]
fn indented_code_blocks_are_skipped() {
    let document = "Set the property:\n\n    color: red\n    theater: none\n\nThe colour is fine.";
    assert!(check(document).is_empty(), "{:?}", matches(document));
    unchanged_under_write(document);
}

#[test]
fn a_wrapped_list_item_is_not_mistaken_for_indented_code() {
    // The reason the old implementation refused to touch four-space indents at
    // all. A parser knows the difference; a column count does not.
    let document = "- A bullet that wraps\n    onto a second line about color.\n";
    assert_eq!(matches(document), ["color"]);
}

#[test]
fn link_destinations_are_protected_whatever_their_scheme() {
    for document in [
        "See [the guide](relative/path/color) for detail.",
        "See [the guide](./docs/color/theater.md) for detail.",
        "See [the guide][ref] for detail.\n\n[ref]: ../color/center.html\n",
        "An image: ![alt text](img/color-chart.png) here.",
    ] {
        assert!(check(document).is_empty(), "fired on {document:?}");
        unchanged_under_write(document);
    }
}

#[test]
fn link_text_is_prose_and_stays_checked() {
    // The target is off limits; the words a reader sees are not.
    assert_eq!(matches("Read [the color guide](docs/style.md)."), ["color"]);
}

#[test]
fn bare_file_paths_are_protected() {
    for document in [
        "See ./docs/color/theater.md for detail.",
        "It lives in /etc/default/color on the host.",
        "Open src/color/center.rs and read it.",
        "Check ~/config/color.toml first.",
    ] {
        assert!(check(document).is_empty(), "fired on {document:?}");
        unchanged_under_write(document);
    }
}

#[test]
fn a_slash_in_prose_is_not_a_path() {
    // The line the path test walks. Two words joined by a slash are English,
    // not a filename, and excluding them would silence a real class of finding.
    assert_eq!(matches("The color/center split is arbitrary."), ["color", "center"]);
    assert_eq!(matches("Use color and/or center as you like."), ["color", "center"]);
}

#[test]
fn a_four_space_line_after_a_blank_line_is_indented_code() {
    // Codex finding 6: `    color: red` preceded by a blank line is an indented
    // code block under CommonMark §4.4, not a lazy continuation. The parser
    // correctly classifies it as code and the spelling check skips it.
    let document = "Set the property:\n\n    color: red\n";
    assert!(
        check(document).is_empty(),
        "4-space indented line after blank line must be treated as code: {:?}",
        matches(document)
    );
    unchanged_under_write(document);
}

#[test]
fn a_four_space_line_without_a_blank_line_is_lazy_continuation() {
    // The counterpart: without the blank line, the 4-space text is a lazy
    // continuation of the paragraph (CommonMark §5.1) and IS prose, so US
    // spellings in it must be flagged.
    let document = "Set the property:\n    color: red\n";
    assert_eq!(
        matches(document),
        ["color"],
        "4-space line without a blank separator is paragraph continuation, not code"
    );
}
