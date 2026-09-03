//! The `-ise` default, the Oxford `-ize` mode, and what neither touches.

use prose_sanitiser_core::Config;

use super::{check, check_with};
use crate::table::Dialect;

/// Replacements suggested for `document` under `config`.
fn fixes(document: &str, config: &Config) -> Vec<String> {
    check_with(document, config)
        .into_iter()
        .filter_map(|finding| finding.replacement)
        .collect()
}

#[test]
fn the_default_is_ise() {
    let config = Config::new();
    assert_eq!(
        fixes("We optimize and organize and realize.", &config),
        ["optimise", "organise", "realise"]
    );
}

#[test]
fn oxford_mode_keeps_ize() {
    let oxford = Config::new().with_oxford(true);
    assert!(check_with("We optimize and organize and realize.", &oxford).is_empty());
}

#[test]
fn oxford_mode_does_not_excuse_yse() {
    let oxford = Config::new().with_oxford(true);
    assert_eq!(
        fixes("We analyze and paralyze the sample.", &oxford),
        ["analyse", "paralyse"]
    );
}

#[test]
fn oxford_mode_leaves_the_non_ize_pairs_alone() {
    // -our, -re and -ce pairs have nothing to do with the Oxford question.
    let oxford = Config::new().with_oxford(true);
    assert_eq!(
        fixes("The color of the center and the defense.", &oxford),
        ["colour", "centre", "defence"]
    );
}

#[test]
fn the_dialect_labels_read_sensibly() {
    assert_eq!(Dialect::default(), Dialect::Ise);
    assert_eq!(Dialect::Ise.label(), "British -ise");
    assert_eq!(Dialect::Oxford.label(), "Oxford -ize");
    assert_eq!(
        Dialect::from_config(&Config::new().with_oxford(true)),
        Dialect::Oxford
    );
}

#[test]
fn the_double_l_asymmetry_goes_both_ways() {
    // UK doubles before a vowel suffix where the US does not, and the US
    // doubles the root l where the UK does not. Both directions are data.
    let config = Config::new();
    assert_eq!(
        fixes("The traveler canceled and was modeling.", &config),
        ["traveller", "cancelled", "modelling"]
    );
    assert_eq!(
        fixes("They fulfill and enroll and distill.", &config),
        ["fulfil", "enrol", "distil"]
    );
}

#[test]
fn the_our_derivative_irregularity_is_respected() {
    // -ous, -ary and -imeter drop the u in British English too, so these are
    // already correct and must not be "restored".
    assert!(check("It was humorous, honorary work with a colorimeter.").is_empty());
    // While the plain forms do take it.
    assert_eq!(
        fixes("The humor and honor of it.", &Config::new()),
        ["humour", "honour"]
    );
}

#[test]
fn the_fulfilment_case_is_covered() {
    // UK never doubles before -ment; the old regex had no rule for this at all.
    assert_eq!(
        fixes("Order fulfillment and enrollment.", &Config::new()),
        ["fulfilment", "enrolment"]
    );
}
