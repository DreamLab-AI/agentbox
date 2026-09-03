//! Unit tests for the shared finding vocabulary.

use super::*;

fn finding(start: usize, end: usize, tier: ConfidenceTier, replacement: Option<&str>) -> Finding {
    Finding {
        rule_id: "test-rule".to_string(),
        label: "Test".to_string(),
        span: Span::new(start, end),
        matched: "x".to_string(),
        severity: Severity::Medium,
        confidence: tier,
        advice: "advice".to_string(),
        replacement: replacement.map(str::to_string),
    }
}

#[test]
fn severity_round_trips_through_the_wire_form() {
    for severity in [Severity::High, Severity::Medium, Severity::Low] {
        assert_eq!(Severity::parse(severity.as_str()), Some(severity));
    }
    assert_eq!(Severity::parse("critical"), None);
}

#[test]
fn confidence_tier_round_trips_and_gates_fixes() {
    for tier in [
        ConfidenceTier::CertainMechanical,
        ConfidenceTier::HighConfidenceStylistic,
        ConfidenceTier::LowConfidenceJudgement,
    ] {
        assert_eq!(ConfidenceTier::parse(tier.as_str()), Some(tier));
    }
    assert!(ConfidenceTier::CertainMechanical.auto_fixable());
    assert!(!ConfidenceTier::HighConfidenceStylistic.auto_fixable());
    assert!(ConfidenceTier::HighConfidenceStylistic.fixable_with_opt_in());
    assert!(!ConfidenceTier::LowConfidenceJudgement.fixable_with_opt_in());
}

#[test]
fn judgement_findings_are_never_fixable_even_under_write() {
    let config = Config::new().with_write(true);
    let judgement = finding(0, 1, ConfidenceTier::LowConfidenceJudgement, Some("y"));
    assert!(!judgement.is_fixable(&config));
    assert_eq!(judgement.to_edit(&config), None);
}

#[test]
fn stylistic_findings_need_the_write_opt_in() {
    let stylistic = finding(0, 1, ConfidenceTier::HighConfidenceStylistic, Some("y"));
    assert!(!stylistic.is_fixable(&Config::new()));
    assert!(stylistic.is_fixable(&Config::new().with_write(true)));
}

#[test]
fn mechanical_findings_fix_without_an_opt_in() {
    let mechanical = finding(0, 1, ConfidenceTier::CertainMechanical, Some("y"));
    assert!(mechanical.is_fixable(&Config::new()));
}

#[test]
fn a_finding_with_no_replacement_is_report_only() {
    let report_only = finding(0, 1, ConfidenceTier::CertainMechanical, None);
    assert!(!report_only.is_fixable(&Config::new()));
}

#[test]
fn patch_applies_edits_in_source_order() {
    let patch = Patch::from_edits([
        Edit {
            span: Span::new(6, 11),
            replacement: "there".to_string(),
            rule_id: "r".to_string(),
        },
        Edit {
            span: Span::new(0, 5),
            replacement: "howdy".to_string(),
            rule_id: "r".to_string(),
        },
    ]);
    assert_eq!(patch.len(), 2);
    assert_eq!(patch.apply("hello world").as_deref(), Some("howdy there"));
}

#[test]
fn patch_discards_overlapping_edits() {
    let patch = Patch::from_edits([
        Edit {
            span: Span::new(0, 5),
            replacement: "a".to_string(),
            rule_id: "first".to_string(),
        },
        Edit {
            span: Span::new(3, 8),
            replacement: "b".to_string(),
            rule_id: "second".to_string(),
        },
    ]);
    assert_eq!(patch.len(), 1);
    assert_eq!(patch.edits()[0].rule_id, "first");
}

#[test]
fn patch_refuses_a_span_that_straddles_a_utf8_boundary() {
    let patch = Patch::from_edits([Edit {
        span: Span::new(0, 1),
        replacement: "e".to_string(),
        rule_id: "r".to_string(),
    }]);
    assert_eq!(patch.apply("é"), None);
}

#[test]
fn an_empty_patch_returns_the_source_unchanged() {
    let patch = Patch::new();
    assert!(patch.is_empty());
    assert_eq!(patch.apply("unchanged").as_deref(), Some("unchanged"));
}

#[test]
fn spans_report_overlap_and_slice_their_source() {
    let left = Span::new(0, 4);
    let right = Span::new(3, 6);
    assert!(left.overlaps(&right));
    assert!(!left.overlaps(&Span::new(4, 6)));
    assert_eq!(left.len(), 4);
    assert!(!left.is_empty());
    assert_eq!(left.slice("abcdef"), Some("abcd"));
}

#[test]
fn config_builders_gate_rules_and_severity() {
    let config = Config::new()
        .with_min_severity(Severity::Medium)
        .with_oxford(true)
        .without_rule("us-spelling");
    assert!(config.oxford);
    assert!(!config.rule_enabled("us-spelling"));
    assert!(config.rule_enabled("hedge-words"));
    assert!(config.severity_reportable(Severity::High));
    assert!(!config.severity_reportable(Severity::Low));
}
