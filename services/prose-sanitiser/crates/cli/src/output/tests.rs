use super::*;
use prose_sanitiser_core::{
    ConfidenceTier, Finding, ReportEntry, RuleMeta, Severity, Span, ToolMeta,
};

const RULES: &[RuleMeta] = &[RuleMeta {
    id: "tier1-vocab",
    name: "Tier-1 banned vocabulary",
    description: "Excess vocabulary.",
    severity: Severity::High,
    confidence: ConfidenceTier::LowConfidenceJudgement,
    since: "2026-01-14",
    reviewed: "2026-09-03",
    help_uri: None,
    sources: &[],
}];

fn report() -> Report {
    Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES)
        .with_ruleset_version("2026.09.03")
        .with_entries(vec![ReportEntry::new(
            "post.md",
            4,
            3,
            Finding {
                rule_id: "tier1-vocab".to_string(),
                label: "Tier-1 banned vocabulary".to_string(),
                span: Span::new(2, 7),
                matched: "delve".to_string(),
                severity: Severity::High,
                confidence: ConfidenceTier::LowConfidenceJudgement,
                advice: "Use a plain word.".to_string(),
                replacement: None,
            },
        )])
}

#[test]
fn every_format_round_trips_through_its_wire_name() {
    for format in [
        OutputFormat::Text,
        OutputFormat::Json,
        OutputFormat::Jsonl,
        OutputFormat::Sarif,
    ] {
        assert_eq!(
            OutputFormat::from_str(format.as_str(), true).unwrap(),
            format
        );
    }
}

#[test]
fn text_is_the_default_and_the_only_non_machine_format() {
    assert_eq!(OutputFormat::default(), OutputFormat::Text);
    assert!(!OutputFormat::Text.is_machine());
    assert!(OutputFormat::Json.is_machine());
    assert!(OutputFormat::Jsonl.is_machine());
    assert!(OutputFormat::Sarif.is_machine());
}

#[test]
fn text_and_json_render_nothing_because_each_binary_owns_its_shape() {
    assert!(render(&report(), OutputFormat::Text).is_none());
    assert!(render(&report(), OutputFormat::Json).is_none());
}

#[test]
fn sarif_renders_a_2_1_0_document() {
    let rendered = render(&report(), OutputFormat::Sarif).unwrap();
    let value: serde_json::Value = serde_json::from_str(&rendered).unwrap();
    assert_eq!(value["version"], "2.1.0");
    assert_eq!(value["runs"][0]["results"][0]["ruleId"], "tier1-vocab");
}

#[test]
fn jsonl_has_no_trailing_newline_and_one_object_per_line() {
    let rendered = render(&report(), OutputFormat::Jsonl).unwrap();
    assert!(!rendered.ends_with('\n'));
    assert_eq!(rendered.lines().count(), 1);
    let value: serde_json::Value = serde_json::from_str(rendered.lines().next().unwrap()).unwrap();
    assert_eq!(value["confidence"], "low-confidence-judgement");
}

#[test]
fn a_text_line_is_rustc_shaped() {
    let report = report();
    let line = text_line(&report.entries()[0]);
    assert_eq!(
        line,
        "post.md:4:3: high[tier1-vocab]: Tier-1 banned vocabulary (low-confidence-judgement)"
    );
}

#[test]
fn an_aggregate_entry_drops_the_line_and_column() {
    let mut report = report();
    let entry = ReportEntry::new("post.md", 0, 0, report.entries()[0].finding.clone());
    report = report.with_entries(vec![entry]);
    assert!(text_line(&report.entries()[0]).starts_with("post.md: high["));
}
