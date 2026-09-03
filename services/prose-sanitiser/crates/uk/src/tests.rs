//! Unit tests for the UK-English rule.

use super::*;

#[test]
fn the_pattern_compiles() {
    assert!(us_spelling_re().is_match("color"));
}

#[test]
fn it_finds_american_spellings_with_their_offsets() {
    let findings = check("We optimize the color scheme.");
    assert_eq!(findings.len(), 2);
    assert_eq!(findings[0].matched, "optimize");
    assert_eq!(findings[0].span, Span::new(3, 11));
    assert_eq!(findings[1].matched, "color");
    assert_eq!(findings[1].span, Span::new(16, 21));
}

#[test]
fn it_matches_case_insensitively() {
    let findings = check("Color and BEHAVIOR");
    let matched: Vec<&str> = findings.iter().map(|f| f.matched.as_str()).collect();
    assert_eq!(matched, ["Color", "BEHAVIOR"]);
}

#[test]
fn uk_spellings_are_left_alone() {
    assert!(check("We optimise the colour of the centre.").is_empty());
}

#[test]
fn every_finding_is_report_only() {
    let config = Config::new().with_write(true);
    for finding in check("We optimize the color.") {
        assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
        assert!(finding.replacement.is_none());
        assert!(!finding.is_fixable(&config));
    }
}

#[test]
fn the_known_false_positives_still_match_and_are_still_report_only() {
    // Documented limitation of the current flat alternation: these are correct
    // British English, and the rule flags them anyway. They are reported, never
    // applied, which is what keeps the defect non-destructive.
    for text in [
        "the gas meter",
        "to license a doctor",
        "World Health Organization",
        "the dialog box uses catalog",
    ] {
        let findings = check(text);
        assert!(!findings.is_empty(), "expected a hit in {text:?}");
        assert!(findings.iter().all(|f| f.replacement.is_none()));
    }
}

#[test]
fn a_disabled_rule_reports_nothing() {
    let config = Config::new().without_rule(US_SPELLING_ID);
    assert!(check_with("We optimize it.", &config).is_empty());
}

#[test]
fn a_high_severity_threshold_filters_the_medium_rule_out() {
    let config = Config::new().with_min_severity(Severity::High);
    assert!(check_with("We optimize it.", &config).is_empty());
}

#[test]
fn the_checker_trait_reports_its_rule_id() {
    assert_eq!(UkEnglish::new().rule_ids(), [US_SPELLING_ID]);
    assert_eq!(UkEnglish.check_default("color").len(), 1);
}
