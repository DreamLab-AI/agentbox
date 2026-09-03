//! Sense disambiguation: part of speech and context words.

use prose_sanitiser_core::Span;

use super::check;
use crate::sense::{resolve, Verdict};
use crate::table::{self, Dialect};
use crate::UK_SENSE_ID;

/// Resolve the first occurrence of `word` in `document`.
fn verdict(document: &str, word: &str) -> Verdict {
    let start = document
        .find(word)
        .expect("the word occurs in the document");
    let entry = table::lookup(word).expect("the word is in the table");
    resolve(
        document,
        Span::new(start, start + word.len()),
        entry,
        Dialect::Ise,
    )
}

/// Whether the verdict suggests `target`.
fn suggests(verdict: &Verdict, target: &str) -> bool {
    matches!(verdict, Verdict::Suggest { target: t, .. } if *t == target)
}

#[test]
fn the_noun_verb_split_is_read_from_part_of_speech() {
    // licence/license: noun takes -ce, verb takes -se, inside British English.
    assert_eq!(
        verdict("The board voted to license a doctor.", "license"),
        Verdict::CorrectAsWritten
    );
    assert!(suggests(
        &verdict("She showed me a driving license.", "license"),
        "licence"
    ));

    // practice/practise runs the other way round.
    assert_eq!(
        verdict("Their general practice is closed.", "practice"),
        Verdict::CorrectAsWritten
    );
    assert!(suggests(
        &verdict("They practice medicine here.", "practice"),
        "practise"
    ));
}

#[test]
fn the_meter_trap_is_resolved_by_context() {
    for device in [
        "The gas meter is outside.",
        "An electricity meter was installed.",
        "The parking meter takes coins.",
    ] {
        assert_eq!(
            verdict(device, "meter"),
            Verdict::CorrectAsWritten,
            "{device:?}"
        );
    }
    assert!(suggests(
        &verdict("The rope was cut to 12 meter lengths.", "meter"),
        "metre"
    ));
}

#[test]
fn program_keeps_its_computing_sense() {
    assert_eq!(
        verdict("The computer program compiled cleanly.", "program"),
        Verdict::CorrectAsWritten
    );
    assert!(suggests(
        &verdict("The television program starts at eight.", "program"),
        "programme"
    ));
}

#[test]
fn the_remaining_named_pairs_resolve_from_their_glosses() {
    assert!(suggests(
        &verdict("She wrote a check to the bank.", "check"),
        "cheque"
    ));
    assert!(suggests(
        &verdict("The car had a flat tire.", "tire"),
        "tyre"
    ));
    assert!(suggests(
        &verdict("A building of six story height.", "story"),
        "storey"
    ));
    assert!(suggests(
        &verdict("He parked against the curb on the road.", "curb"),
        "kerb"
    ));
    assert!(suggests(
        &verdict("A cold draft from the window.", "draft"),
        "draught"
    ));
}

#[test]
fn a_resolved_sense_is_still_never_auto_fixable() {
    // Resolution buys silence, not permission. The tier stays low.
    use prose_sanitiser_core::{ConfidenceTier, Config};

    let findings = super::check_with(
        "She wrote a check to the bank.",
        &Config::new().with_write(true),
    );
    let sense: Vec<_> = findings
        .iter()
        .filter(|f| f.rule_id == UK_SENSE_ID)
        .collect();
    assert_eq!(sense.len(), 1);
    assert_eq!(sense[0].confidence, ConfidenceTier::LowConfidenceJudgement);
    assert!(sense[0].replacement.is_none());
    assert!(!sense[0].is_fixable(&Config::new().with_write(true)));
}

#[test]
fn an_unresolved_sense_names_both_readings() {
    let findings = check("The mat was replaced.");
    let sense: Vec<_> = findings
        .iter()
        .filter(|f| f.rule_id == UK_SENSE_ID)
        .collect();
    if let Some(finding) = sense.first() {
        assert!(
            finding.advice.contains("depends on sense"),
            "advice was {:?}",
            finding.advice
        );
        assert!(finding.replacement.is_none());
    }
}

#[test]
fn an_unconditional_entry_has_nothing_to_resolve() {
    assert_eq!(verdict("The color is wrong.", "color"), Verdict::Unresolved);
}

#[test]
fn resolution_reads_only_the_containing_sentence() {
    // A cue in a neighbouring sentence must not leak across the full stop.
    let document = "The bank called yesterday. Please check the wiring.";
    assert_ne!(
        verdict(document, "check"),
        Verdict::Suggest {
            target: "cheque",
            sense: String::new()
        }
    );
    assert!(!suggests(&verdict(document, "check"), "cheque"));
}

#[test]
fn the_dominant_reading_wins_when_nothing_discriminates() {
    // Without a prior, every plain use of these words is an unresolved report.
    // Measured over 414,000 words of British technical prose, the "verify"
    // prior alone removed 210 of them.
    for silent in [
        "The check runs on every commit.",
        "Add a check here.",
        "The story continues.",
        "Send me the draft.",
    ] {
        assert!(check(silent).is_empty(), "fired on {silent:?}");
    }
}

#[test]
fn a_single_cue_still_beats_the_prior() {
    // The prior is one point, so any real evidence overrules it.
    assert!(suggests(
        &verdict("She wrote a check to the bank.", "check"),
        "cheque"
    ));
    assert!(suggests(
        &verdict("A cold draft from the window.", "draft"),
        "draught"
    ));
    assert!(suggests(
        &verdict("A six story building on the road.", "story"),
        "storey"
    ));
}

#[test]
fn senses_that_agree_on_the_answer_are_not_a_tie() {
    // VarCon glosses "verify" twice for `check`, once tagged <N> and once bare.
    // Both say the spelling is already correct, so a score tie between them
    // settles the question rather than blocking it.
    let entry = table::lookup("check").expect("check is in the table");
    let agreeing = entry
        .senses()
        .iter()
        .filter(|sense| sense.usage() == "verify")
        .count();
    assert!(agreeing >= 2, "expected the duplicated gloss");
    assert_eq!(
        verdict("Run the check before merging.", "check"),
        Verdict::CorrectAsWritten
    );
}
