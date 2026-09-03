//! The UK prose set from section D3 of the design brief.
//!
//! Every sentence here is correct British English. The requirement is **zero
//! auto-fixes**: not one of them may produce a finding that could be applied,
//! in either dialect, under any configuration including `--write`.
//!
//! The previous implementation, a single flat alternation, failed on all seven.

use prose_sanitiser_core::{Config, Fix};

use super::{check, check_with};
use crate::UkEnglish;

/// The sentences named in the brief, verbatim.
const UK_SENTENCES: &[&str] = &[
    "The World Health Organization published the guidance.",
    "She showed me a driving licence issued last year.",
    "The board voted to license a doctor from overseas.",
    "The gas meter read 12 metres of unused cable.",
    "The computer program compiled without a warning.",
    "Emissions of sulfur dioxide fell again this year.",
    "Close the dialog box before saving the file.",
];

/// Sentences the same traps appear in, phrased differently.
const UK_VARIANTS: &[&str] = &[
    "The International Labour Organization met in Geneva.",
    "He holds a licence to practise medicine in Wales.",
    "Their general practice takes new patients on Mondays.",
    "The electricity meter is behind the utility cupboard.",
    "The programme begins at eight on the second storey.",
    "A flat tyre is not the same problem as a tired driver.",
    "She wrote a cheque and left it on the kerb.",
    "The Department of Defense declined to comment.",
    "The Australian Labor Party won the seat.",
    "We shipped the aluminium disk drive with the sulfur samples.",
];

#[test]
fn the_d3_sentences_produce_no_auto_fixes() {
    let checker = UkEnglish::new();
    for dialect in [Config::new(), Config::new().with_oxford(true)] {
        // `write` on is the adversarial case: it is the only setting under
        // which a stylistic finding could ever be applied.
        let config = dialect.with_write(true);
        for sentence in UK_SENTENCES.iter().chain(UK_VARIANTS) {
            let findings = check_with(sentence, &config);
            let patch = checker.fix(sentence, &findings, &config);
            assert!(
                patch.is_empty(),
                "{sentence:?} would be rewritten to {:?}",
                patch.apply(sentence)
            );
            assert!(
                findings.iter().all(|f| !f.is_fixable(&config)),
                "{sentence:?} produced a fixable finding"
            );
        }
    }
}

#[test]
fn the_d3_sentences_are_almost_entirely_silent() {
    // Stronger than the contract: these should not merely be unfixable, they
    // should not be mentioned at all. Anything that does fire is a judgement
    // call and must say so.
    for sentence in UK_SENTENCES {
        let findings = check(sentence);
        for finding in &findings {
            assert_eq!(
                finding.rule_id,
                crate::UK_SENSE_ID,
                "{sentence:?} raised a spelling finding on {:?}",
                finding.matched
            );
        }
    }
}

#[test]
fn organisation_names_keep_their_american_spelling() {
    for name in [
        "The World Health Organization met.",
        "A report from the Department of Defense.",
        "He works at the Rockefeller Center in New York.",
        "The Australian Labor Party conference.",
        "She reread The Color Purple last summer.",
        "Survivors of the attack on Pearl Harbor.",
    ] {
        assert!(check(name).is_empty(), "fired on {name:?}");
    }
}

#[test]
fn a_house_organisation_list_is_honoured() {
    use prose_sanitiser_core::Check;

    use crate::UkOptions;

    let options = UkOptions::new().with_organisations(["Wilson Color Labs"]);
    let checker = UkEnglish::with_options(options);
    let text = "Wilson Color Labs measured the color of the sample.";
    let findings = checker.check(text, &Config::new());

    assert_eq!(findings.len(), 1, "only the running-prose hit should fire");
    assert_eq!(findings[0].matched, "color");
    assert!(findings[0].span.start > text.find("Labs").unwrap());
}

#[test]
fn technical_register_terms_are_never_touched() {
    for term in [
        "We measured sulfur dioxide and sulfuric acid.",
        "The fetus was scanned at twenty weeks.",
        "Click the dialog box, then the disk icon.",
        "A colorimeter measured the sample.",
    ] {
        assert!(check(term).is_empty(), "fired on {term:?}");
    }
}

#[test]
fn a_house_word_allowlist_silences_domain_vocabulary() {
    use prose_sanitiser_core::Check;

    use crate::UkOptions;

    // Terms of art that are not really dialect choices. On 414,000 words of
    // British technical prose these three accounted for 66 of 130 spelling
    // findings, and none of them was a mistake.
    let text = "The build artifact carried a rumor through the distill stage.";
    assert_eq!(check(text).len(), 3);

    let options = UkOptions::new().with_allowed_words(["Artifact", "rumor", "DISTILL"]);
    let checker = UkEnglish::with_options(options);
    assert!(
        checker.check(text, &Config::new()).is_empty(),
        "the allowlist is case-insensitive and covers both rules"
    );
    assert_eq!(
        checker.options().allowed_words(),
        ["artifact", "distill", "rumor"]
    );
}
