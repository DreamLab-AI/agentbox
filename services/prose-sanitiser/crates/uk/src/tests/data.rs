//! Invariants of the generated table, and the override cross-check.
//!
//! The point of the cross-check tests is that the hand-verified lists in
//! [`crate::overrides`] and the VarCon-derived table must agree. If a future
//! data revision starts proposing *advertize* or *sulphur*, the build fails
//! here rather than producing a wrong suggestion in someone's prose.

use crate::overrides::{ALWAYS_ISE_ROOTS, ALWAYS_YSE_ROOTS, NEVER_FIX};
use crate::table::{self, Dialect};

#[test]
fn the_table_was_generated_and_is_sorted() {
    assert!(
        table::len() > 4_000,
        "table looks truncated: {}",
        table::len()
    );
    assert_eq!(table::VARCON_VERSION, "2020.12.07");

    let entries = table::entries();
    for pair in entries.windows(2) {
        assert!(
            pair[0].american() < pair[1].american(),
            "table is not sorted: {:?} then {:?}",
            pair[0].american(),
            pair[1].american()
        );
    }
}

#[test]
fn every_key_is_lowercase_and_every_target_differs() {
    for entry in table::entries() {
        assert_eq!(
            entry.american(),
            entry.american().to_lowercase(),
            "key is not lowercase: {:?}",
            entry.american()
        );
        for dialect in [Dialect::Ise, Dialect::Oxford] {
            if let Some(target) = entry.target(dialect) {
                assert_ne!(target, entry.american(), "no-op entry for {target:?}");
                assert!(
                    !target.chars().any(char::is_uppercase),
                    "proper-noun target {target:?} for {:?}",
                    entry.american()
                );
            }
        }
    }
}

#[test]
fn a_sense_dependent_entry_never_offers_an_unconditional_fix() {
    for entry in table::entries() {
        if entry.is_unconditional() {
            continue;
        }
        assert!(entry.target(Dialect::Ise).is_none());
        assert!(entry.target(Dialect::Oxford).is_none());
        assert!(
            entry.senses().len() >= 2,
            "{:?} is marked sense-dependent with {} senses",
            entry.american(),
            entry.senses().len()
        );
        // At least one sense must actually want a change, or the entry is noise.
        assert!(
            entry
                .senses()
                .iter()
                .any(|sense| !sense.is_correct_as_written()),
            "{:?} is sense-dependent but no sense wants a change",
            entry.american()
        );
    }
}

#[test]
fn the_eight_named_sense_pairs_are_all_sense_dependent() {
    // Section A5 of the brief names these as never safe to blind-replace.
    for word in [
        "license", "practice", "program", "meter", "check", "tire", "story", "curb", "draft",
    ] {
        let entry = table::lookup(word).unwrap_or_else(|| panic!("{word} missing from the table"));
        assert!(
            !entry.is_unconditional(),
            "{word} must be sense-dependent, not an unconditional pair"
        );
    }
}

#[test]
fn the_technical_register_words_are_absent_from_the_table() {
    // These are correct British English. VarCon agrees, so there is no entry at
    // all, which is a stronger guarantee than an override.
    for word in [
        "sulfur",
        "sulphate",
        "fetus",
        "dialog",
        "disk",
        "colorimeter",
        "advertise",
        "analyse",
        "paralyse",
        "instill",
    ] {
        assert!(
            table::lookup(word).is_none(),
            "{word} should not be in the table"
        );
    }
}

#[test]
fn no_always_ise_root_is_ever_pushed_towards_ize() {
    // The cross-check: VarCon must not disagree with the hand-verified list.
    for root in ALWAYS_ISE_ROOTS.iter().chain(ALWAYS_YSE_ROOTS) {
        for suffix in ["e", "es", "ed", "ing"] {
            let word = format!("{root}{suffix}");
            if let Some(entry) = table::lookup(&word) {
                for dialect in [Dialect::Ise, Dialect::Oxford] {
                    if let Some(target) = entry.target(dialect) {
                        assert!(
                            !target.contains("iz") && !target.contains("yz"),
                            "{word} would become {target} under {dialect:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn the_yse_set_stays_yse_in_oxford_spelling() {
    // Hart's Rules: the root is Greek lysis, not -izein, so there is no Oxford
    // exception. VarCon encodes this by carrying no `Z` tag on those lines.
    for (american, british) in [
        ("analyze", "analyse"),
        ("paralyze", "paralyse"),
        ("catalyze", "catalyse"),
        ("hydrolyze", "hydrolyse"),
    ] {
        let entry =
            table::lookup(american).unwrap_or_else(|| panic!("{american} missing from the table"));
        assert_eq!(entry.target(Dialect::Ise), Some(british));
        assert_eq!(
            entry.target(Dialect::Oxford),
            Some(british),
            "{american} must stay -yse in Oxford spelling too"
        );
    }
}

#[test]
fn every_never_fix_word_is_protected() {
    for word in NEVER_FIX {
        assert!(
            crate::overrides::is_protected(word),
            "{word} is listed but not protected"
        );
    }
    assert!(crate::overrides::protected_forms().len() > NEVER_FIX.len());
}

#[test]
fn lookup_is_case_insensitive() {
    let lower = table::lookup("color").expect("color is in the table");
    for spelling in ["Color", "COLOR", "cOlOr"] {
        assert_eq!(
            table::lookup(spelling).map(|entry| entry.american()),
            Some(lower.american())
        );
    }
}

#[test]
fn possessive_forms_are_keyed_separately() {
    // VarCon lists them as distinct forms, so the tokeniser keeps the
    // apostrophe and the table can answer for "color's" directly.
    let entry = table::lookup("color's").expect("color's is in the table");
    assert_eq!(entry.target(Dialect::Ise), Some("colour's"));
}
