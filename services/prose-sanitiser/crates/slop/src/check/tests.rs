use super::*;
use prose_sanitiser_core::{ConfidenceTier, Severity};

fn ids(findings: &[Finding]) -> Vec<&str> {
    findings.iter().map(|f| f.rule_id.as_str()).collect()
}

#[test]
fn a_lexical_hit_carries_a_real_byte_span() {
    let document = "We delve into it.";
    let findings = SlopChecker::new().check(document, &Config::new());
    assert_eq!(findings.len(), 1);
    let finding = &findings[0];
    assert_eq!(finding.rule_id, "tier1-vocab");
    assert_eq!(finding.span.slice(document).unwrap(), "delve");
    assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
}

#[test]
fn checking_never_produces_a_replacement_or_an_edit() {
    let document = "We delve into the seamless tapestry.\n- **Term:** value\n";
    let config = Config::new().with_write(true);
    for finding in SlopChecker::new().check(document, &config) {
        assert!(finding.replacement.is_none(), "{}", finding.rule_id);
        assert!(!finding.is_fixable(&config), "{}", finding.rule_id);
        assert!(finding.to_edit(&config).is_none(), "{}", finding.rule_id);
    }
}

#[test]
fn code_fences_and_blockquotes_are_never_scanned() {
    let document = "```\nWe delve into it.\n```\n> We delve into it.\n";
    assert!(SlopChecker::new()
        .check(document, &Config::new())
        .is_empty());
}

#[test]
fn the_legacy_ignore_marker_still_works() {
    let document = "We delve into it. <!-- slop-ignore -->\n";
    assert!(SlopChecker::new()
        .check(document, &Config::new())
        .is_empty());
}

#[test]
fn a_disable_directive_silences_only_the_named_rule() {
    let document = "<!-- prose-sanitiser-disable tier1-vocab -->\nWe delve, basically.\n";
    let findings = SlopChecker::new().check(document, &Config::new());
    assert_eq!(ids(&findings), ["hedge-words"]);
}

#[test]
fn suppressions_can_be_turned_off_for_an_audit() {
    let document = "<!-- prose-sanitiser-disable -->\nWe delve into it.\n";
    let config = Config::new().with_suppressions(false);
    assert_eq!(
        ids(&SlopChecker::new().check(document, &config)),
        ["tier1-vocab"]
    );
}

#[test]
fn a_disabled_rule_does_not_run() {
    let document = "We delve into it.";
    let config = Config::new().without_rule("tier1-vocab");
    assert!(SlopChecker::new().check(document, &config).is_empty());
}

#[test]
fn the_severity_floor_drops_weaker_findings() {
    let document = "We delve, basically, into it.";
    let all = SlopChecker::new().check(document, &Config::new());
    assert_eq!(ids(&all), ["tier1-vocab", "hedge-words"]);
    let high_only =
        SlopChecker::new().check(document, &Config::new().with_min_severity(Severity::High));
    assert_eq!(ids(&high_only), ["tier1-vocab"]);
}

#[test]
fn non_english_paragraphs_are_skipped_by_default() {
    let german = "Der Bericht befasst sich eingehend mit den zahlreichen Erwägungen, die der \
Entscheidung zugrunde liegen, und betont die Notwendigkeit einer umfassenden Überprüfung \
sämtlicher nachgelagerter Auswirkungen des Vorhabens.";
    // "robust" is ordinary German; the pre-filter must keep the rule off it.
    let document = format!("{german} Das System ist robust.\n");
    assert!(SlopChecker::new()
        .check(&document, &Config::new())
        .is_empty());

    // With the filter off, the coincidence fires.
    let config = Config::new().without_language_filter();
    assert_eq!(
        ids(&SlopChecker::new().check(&document, &config)),
        ["tier1-vocab"]
    );
}

#[test]
fn english_paragraphs_are_still_scanned_in_a_mixed_document() {
    let german = "Der Bericht befasst sich eingehend mit den zahlreichen Erwägungen, die der \
Entscheidung zugrunde liegen, und betont die Notwendigkeit einer umfassenden Überprüfung.";
    let english = "This report delves into the considerations that underpin the decision and \
underscores the need for a review of every downstream effect of the proposal.";
    let document = format!("{german}\n\n{english}\n");
    let findings = SlopChecker::new().check(&document, &Config::new());
    assert_eq!(ids(&findings), ["tier1-vocab"]);
    assert!(findings[0].span.start > document.find("This report").unwrap() - 1);
}

#[test]
fn structural_measures_are_off_unless_asked_for() {
    let document = format!("{}\n", "A — B — C — D. ".repeat(80));
    assert!(!SlopChecker::new().structural_enabled());
    let without = SlopChecker::new().check(&document, &Config::new());
    assert!(!ids(&without).iter().any(|id| id.starts_with("structural-")));

    let with = SlopChecker::new()
        .with_structural(true)
        .check(&document, &Config::new());
    assert!(ids(&with).contains(&"structural-emdash-density"));
}

#[test]
fn rule_ids_cover_everything_the_checker_can_emit() {
    let checker = SlopChecker::new().with_structural(true);
    let document = format!("We delve into it.\n{}\n", "A — B — C — D. ".repeat(80));
    for finding in checker.check(&document, &Config::new()) {
        assert!(
            checker.rule_ids().contains(&finding.rule_id.as_str()),
            "{} not declared in rule_ids()",
            finding.rule_id
        );
    }
}

#[test]
fn check_default_uses_the_safe_configuration() {
    let findings = SlopChecker::new().check_default("We delve into it.");
    assert_eq!(ids(&findings), ["tier1-vocab"]);
}

#[test]
fn an_empty_document_yields_nothing() {
    assert!(SlopChecker::new().check("", &Config::new()).is_empty());
    assert!(SlopChecker::new()
        .with_structural(true)
        .check("", &Config::new())
        .is_empty());
}
