//! The public surface: configuration, fixes, reporting, and compatibility.

use prose_sanitiser_core::{Check, ConfidenceTier, Config, Fix, Severity};

use super::{check, check_with};
use crate::report::Summary;
use crate::{UkEnglish, UK_SENSE_ID, US_SPELLING_ID};

#[test]
fn the_checker_reports_both_rule_ids() {
    assert_eq!(UkEnglish::new().rule_ids(), [US_SPELLING_ID, UK_SENSE_ID]);
}

#[test]
fn unconditional_findings_are_high_confidence_stylistic() {
    for finding in check("We optimize the color.") {
        assert_eq!(finding.rule_id, US_SPELLING_ID);
        assert_eq!(finding.confidence, ConfidenceTier::HighConfidenceStylistic);
        assert_eq!(finding.severity, Severity::Medium);
        assert!(finding.replacement.is_some());
    }
}

#[test]
fn nothing_this_crate_produces_is_certain_mechanical() {
    // Spelling is a style question. Only Unicode and container surgery earn
    // the mechanical tier.
    let findings = check("The color of the check from the bank.");
    assert!(!findings.is_empty());
    assert!(findings
        .iter()
        .all(|f| f.confidence != ConfidenceTier::CertainMechanical));
}

#[test]
fn a_fix_needs_the_write_opt_in() {
    let document = "We optimize the color.";
    let checker = UkEnglish::new();

    let (findings, patch) = checker.check_and_fix(document, &Config::new());
    assert_eq!(findings.len(), 2);
    assert!(patch.is_empty(), "stylistic fixes need --write");

    let config = Config::new().with_write(true);
    let (_, patch) = checker.check_and_fix(document, &config);
    assert_eq!(
        patch.apply(document).as_deref(),
        Some("We optimise the colour.")
    );
}

#[test]
fn the_free_functions_still_work() {
    // Backwards compatibility: these are the entry points the crate shipped.
    let findings = crate::check("We optimize the color scheme.");
    let matched: Vec<&str> = findings.iter().map(|f| f.matched.as_str()).collect();
    assert_eq!(matched, ["optimize", "color"]);

    let config = Config::new().without_rule(US_SPELLING_ID);
    assert!(crate::check_with("We optimize it.", &config).is_empty());

    let (_, patch) = crate::check_and_fix("The color.", &Config::new().with_write(true));
    assert_eq!(patch.len(), 1);
}

#[test]
fn the_legacy_constants_are_unchanged() {
    // `prose-sanitiser-slop` embeds these in its own rule table.
    assert_eq!(crate::US_SPELLING_ID, "us-spelling");
    assert_eq!(crate::US_SPELLING_LABEL, "US spelling (enforce UK)");
    assert_eq!(crate::US_SPELLING_SEVERITY, Severity::Medium);
    assert_eq!(
        crate::US_SPELLING_CONFIDENCE,
        ConfidenceTier::LowConfidenceJudgement
    );
    assert!(crate::US_SPELLING_FIX.starts_with("Use UK spelling"));
    assert!(crate::US_SPELLING_PATTERN.starts_with(r"\b(optimiz"));
    assert!(crate::US_SPELLING_PATTERN.ends_with(r"modeled)\b"));
    // It must stay a valid regex, because the slop scanner compiles it.
    assert!(regex::Regex::new(crate::US_SPELLING_PATTERN).is_ok());
}

#[test]
fn rules_can_be_disabled_independently() {
    let document = "The color of the check from the bank.";
    let without_spelling = Config::new().without_rule(US_SPELLING_ID);
    assert!(check_with(document, &without_spelling)
        .iter()
        .all(|f| f.rule_id == UK_SENSE_ID));

    let without_sense = Config::new().without_rule(UK_SENSE_ID);
    assert!(check_with(document, &without_sense)
        .iter()
        .all(|f| f.rule_id == US_SPELLING_ID));

    let neither = Config::new()
        .without_rule(US_SPELLING_ID)
        .without_rule(UK_SENSE_ID);
    assert!(check_with(document, &neither).is_empty());
}

#[test]
fn the_severity_threshold_filters_by_rule() {
    let document = "The color of the check from the bank.";
    // Sense findings are Low, spelling findings Medium.
    let medium = Config::new().with_min_severity(Severity::Medium);
    assert!(check_with(document, &medium)
        .iter()
        .all(|f| f.rule_id == US_SPELLING_ID));

    let high = Config::new().with_min_severity(Severity::High);
    assert!(check_with(document, &high).is_empty());
}

#[test]
fn spans_address_the_source_exactly() {
    let document = "We optimize the color scheme.";
    for finding in check(document) {
        assert_eq!(finding.span.slice(document), Some(finding.matched.as_str()));
    }
}

#[test]
fn the_summary_counts_per_rule() {
    let checker = UkEnglish::new();
    let config = Config::new().with_write(true);
    let mut summary = Summary::new();
    for document in [
        "The colour is already right.",
        "The color is wrong.",
        "She wrote a check to the bank.",
    ] {
        summary.record(document, &checker.check(document, &config), &config);
    }

    assert_eq!(summary.documents(), 3);
    assert!(summary.words() > 10);
    assert_eq!(summary.total(), 2);
    assert_eq!(summary.total_fixable(), 1, "only the unconditional pair");

    let rules: Vec<&str> = summary.rules().map(|(id, _)| id).collect();
    assert_eq!(rules, [US_SPELLING_ID, UK_SENSE_ID]);
    assert!(summary.per_ten_thousand(US_SPELLING_ID) > 0.0);
    assert_eq!(summary.per_ten_thousand("no-such-rule"), 0.0);

    let rendered = summary.render();
    assert!(rendered.contains("per 10k words"));
    assert!(rendered.contains(US_SPELLING_ID));
}

#[test]
fn an_empty_summary_renders_without_panicking() {
    let summary = Summary::new();
    assert!(summary.render().contains("no findings"));
    assert_eq!(summary.per_ten_thousand(US_SPELLING_ID), 0.0);
}

#[test]
fn the_gazetteer_reports_its_size() {
    use crate::Gazetteer;

    let base = Gazetteer::default();
    assert!(!base.is_empty());
    let extended = Gazetteer::new(&["Acme Color Ltd"]);
    assert_eq!(extended.len(), base.len() + 1);
}

#[test]
fn an_empty_document_is_handled() {
    assert!(check("").is_empty());
    assert!(check("   \n\n  ").is_empty());
}
