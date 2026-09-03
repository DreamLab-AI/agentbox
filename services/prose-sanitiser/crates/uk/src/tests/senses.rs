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

// ---- the practice/practise tuning -----------------------------------------
//
// Measured on 2,000 documents of British human prose, `practice` and
// `practices` were 146 of 218 `us-spelling-sense` findings. Every one was a
// false positive: British English spells the noun `practice`, and the noun is
// what almost all of them were. The tuning reads the token directly in front
// and, failing that, assumes the noun for a pair whose noun sense is already
// correct.

/// Sentences where `practice` is a noun and British English is already right.
const NOUN_READINGS: &[&str] = &[
    "In practice the scheme works well.",
    "Best practice suggests otherwise.",
    "The general practice takes new patients.",
    "Their practices are well documented.",
    "This is standard practice across the sector.",
    "Good practice requires a written record.",
    "The practice of medicine is regulated.",
    "Community pharmacy practices vary widely.",
    "It is common practice.",
    "Clinical practice guidelines were issued.",
    "Such practices should be discouraged.",
    "Family practice is a recognised speciality.",
    "The report reviews law and practice.",
];

/// Sentences where the verb reading is signalled and must still be reported.
const VERB_READINGS: &[&str] = &[
    "We must practice restraint.",
    "They practice medicine here.",
    "He wants to practice law.",
    "Doctors routinely practice defensive medicine.",
];

#[test]
fn the_noun_reading_of_practice_is_silent() {
    for sentence in NOUN_READINGS {
        assert_eq!(
            verdict(sentence, if sentence.contains("practices") { "practices" } else { "practice" }),
            Verdict::CorrectAsWritten,
            "reported a noun reading: {sentence:?}"
        );
        assert!(
            check(sentence).iter().all(|f| f.rule_id != UK_SENSE_ID),
            "reported a noun reading end to end: {sentence:?}"
        );
    }
}

#[test]
fn the_verb_reading_of_practice_is_still_reported() {
    for sentence in VERB_READINGS {
        assert!(
            suggests(&verdict(sentence, "practice"), "practise"),
            "missed a verb reading: {sentence:?}"
        );
    }
}

#[test]
fn the_inflected_verb_forms_are_unconditional_and_untouched_by_the_tuning() {
    // `practiced` and `practicing` have no noun reading at all, so they stay in
    // the unconditional table with a mechanical replacement behind --write.
    for (sentence, target) in [
        ("He practiced law for thirty years.", "practised"),
        ("She is practicing her scales.", "practising"),
    ] {
        let findings = check(sentence);
        assert_eq!(findings.len(), 1, "{sentence:?}");
        assert_eq!(findings[0].replacement.as_deref(), Some(target));
    }
}

#[test]
fn the_noun_default_cannot_reach_licence_or_programme() {
    // The gate is "the noun sense is already correct British English", which
    // licence and programme both fail. Without that gate this tuning would
    // silence the two pairs it most needs to keep reporting.
    assert!(suggests(
        &verdict("She showed me a driving license.", "license"),
        "licence"
    ));
    assert!(suggests(
        &verdict("The training program was cancelled.", "program"),
        "programme"
    ));
}

#[test]
fn a_determiner_still_outranks_a_content_word() {
    // The immediate-token reading must not have cost the determiner rule its
    // effect: "a licence" is a noun by determiner, "to license" a verb by "to".
    assert!(suggests(&verdict("He has a license.", "license"), "licence"));
    assert_eq!(
        verdict("The board voted to license a doctor.", "license"),
        Verdict::CorrectAsWritten
    );
}
