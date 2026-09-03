use super::*;
use crate::finding::{Config, Span};
use crate::fixability::Fixability;

const RULES: &[RuleMeta] = &[
    RuleMeta {
        id: "tier1-vocab",
        name: "Tier-1 banned vocabulary",
        description: "Vocabulary with a measured excess frequency in LLM output.",
        severity: Severity::High,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-01-14",
        reviewed: "2026-09-03",
        help_uri: Some("https://example.invalid/tier1"),
        sources: &["https://doi.org/10.1126/sciadv.adt3813"],
    },
    RuleMeta {
        id: "never-fires",
        name: "Unused rule",
        description: "Present in the table but silent in this run.",
        severity: Severity::Low,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-01-14",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[],
    },
];

fn sample_finding() -> Finding {
    Finding {
        rule_id: "tier1-vocab".to_string(),
        label: "Tier-1 banned vocabulary".to_string(),
        span: Span::new(2, 7),
        matched: "delve".to_string(),
        severity: Severity::High,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        advice: "Use a plain word.".to_string(),
        replacement: None,
    }
}

fn sample_report() -> Report {
    Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES)
        .with_ruleset_version("2026.09.03")
        .with_entries(vec![
            ReportEntry::new("post.md", 4, 3, sample_finding()).with_snippet("We delve into it.")
        ])
}

#[test]
fn the_sarif_envelope_is_exactly_2_1_0() {
    let sarif = sample_report().to_sarif();
    assert_eq!(sarif["version"], SARIF_VERSION);
    assert_eq!(sarif["version"], "2.1.0");
    assert_eq!(sarif["$schema"], SARIF_SCHEMA);
    assert_eq!(sarif["runs"].as_array().unwrap().len(), 1);
}

#[test]
fn the_driver_table_lists_only_the_rules_that_fired() {
    let sarif = sample_report().to_sarif();
    let rules = sarif["runs"][0]["tool"]["driver"]["rules"]
        .as_array()
        .unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0]["id"], "tier1-vocab");
    assert_eq!(rules[0]["helpUri"], "https://example.invalid/tier1");
}

#[test]
fn rule_metadata_carries_the_tier_and_both_dates() {
    let sarif = sample_report().to_sarif();
    let properties = &sarif["runs"][0]["tool"]["driver"]["rules"][0]["properties"];
    assert_eq!(properties["confidence"], "low-confidence-judgement");
    assert_eq!(properties["since"], "2026-01-14");
    assert_eq!(properties["reviewed"], "2026-09-03");
    assert_eq!(
        sarif["runs"][0]["tool"]["driver"]["properties"]["rulesetVersion"],
        "2026.09.03"
    );
}

#[test]
fn severity_maps_onto_the_sarif_levels() {
    assert_eq!(sarif_level(Severity::High), "error");
    assert_eq!(sarif_level(Severity::Medium), "warning");
    assert_eq!(sarif_level(Severity::Low), "note");
}

#[test]
fn a_result_carries_location_fingerprint_and_tier() {
    let sarif = sample_report().to_sarif();
    let result = &sarif["runs"][0]["results"][0];
    assert_eq!(result["ruleId"], "tier1-vocab");
    assert_eq!(result["level"], "error");
    let region = &result["locations"][0]["physicalLocation"]["region"];
    assert_eq!(region["startLine"], 4);
    assert_eq!(region["startColumn"], 3);
    assert_eq!(region["snippet"]["text"], "We delve into it.");
    assert!(result["partialFingerprints"]["proseSanitiser/v1"].is_string());
    assert_eq!(
        result["properties"]["confidence"],
        "low-confidence-judgement"
    );
    assert_eq!(result["properties"]["autoFixable"], false);
}

#[test]
fn a_judgement_finding_never_emits_a_sarif_fix() {
    let mut finding = sample_finding();
    finding.replacement = Some("look at".to_string());
    let report = Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES)
        .with_entries(vec![ReportEntry::new("post.md", 1, 1, finding)]);
    assert!(report.to_sarif()["runs"][0]["results"][0]["fixes"].is_null());
}

#[test]
fn a_mechanical_finding_emits_a_sarif_fix() {
    let mut finding = sample_finding();
    finding.rule_id = "never-fires".to_string();
    finding.confidence = ConfidenceTier::CertainMechanical;
    finding.replacement = Some("".to_string());
    let report = Report::new(ToolMeta::new("clean-text", "0.1.0"), RULES)
        .with_entries(vec![ReportEntry::new("post.md", 1, 1, finding)]);
    let fixes = &report.to_sarif()["runs"][0]["results"][0]["fixes"];
    assert_eq!(
        fixes[0]["artifactChanges"][0]["replacements"][0]["deletedRegion"]["byteOffset"],
        2
    );
    assert_eq!(
        fixes[0]["artifactChanges"][0]["replacements"][0]["deletedRegion"]["byteLength"],
        5
    );
}

#[test]
fn an_aggregate_finding_omits_the_line_region() {
    let report = Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES)
        .with_entries(vec![ReportEntry::new("post.md", 0, 0, sample_finding())]);
    let region = &report.to_sarif()["runs"][0]["results"][0]["locations"][0]["physicalLocation"];
    assert!(region["region"].is_null());
    assert_eq!(region["artifactLocation"]["uri"], "post.md");
}

#[test]
fn jsonl_is_one_self_contained_object_per_line() {
    let report = sample_report();
    let rendered = report.to_jsonl();
    let lines: Vec<&str> = rendered.lines().collect();
    assert_eq!(lines.len(), 1);
    let value: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(value["rule"], "tier1-vocab");
    assert_eq!(value["confidence"], "low-confidence-judgement");
    assert_eq!(value["ruleset_version"], "2026.09.03");
    assert_eq!(value["line"], 4);
    assert_eq!(value["byte_start"], 2);
    assert!(!rendered.contains("\n\n"));
}

#[test]
fn a_fingerprint_survives_a_line_shift_but_not_a_rule_change() {
    let here = ReportEntry::new("post.md", 4, 3, sample_finding());
    let moved = ReportEntry::new("post.md", 90, 1, sample_finding());
    assert_eq!(here.fingerprint(), moved.fingerprint());

    let mut other_rule = sample_finding();
    other_rule.rule_id = "hedge-words".to_string();
    let different = ReportEntry::new("post.md", 4, 3, other_rule);
    assert_ne!(here.fingerprint(), different.fingerprint());

    let elsewhere = ReportEntry::new("other.md", 4, 3, sample_finding());
    assert_ne!(here.fingerprint(), elsewhere.fingerprint());
}

#[test]
fn an_empty_run_still_produces_a_valid_log() {
    let report = Report::new(ToolMeta::new("slop-scan", "0.1.0"), RULES);
    let sarif = report.to_sarif();
    assert_eq!(sarif["runs"][0]["results"].as_array().unwrap().len(), 0);
    assert_eq!(
        sarif["runs"][0]["tool"]["driver"]["rules"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert!(report.to_jsonl().is_empty());
}

// ---- fixability -------------------------------------------------------

#[test]
fn fixability_defaults_from_the_tier_in_sarif() {
    let sarif = sample_report().to_sarif();
    let result = &sarif["runs"][0]["results"][0];
    // The sample finding is a judgement call, so report-only.
    assert_eq!(result["properties"]["fixability"], "report-only");
    assert_eq!(result["properties"]["autoFixable"], false);
    assert!(result["properties"]["noFixExplanation"].is_null());
    // The rule table carries the tier's default too.
    let rule = &sarif["runs"][0]["tool"]["driver"]["rules"][0];
    assert_eq!(rule["properties"]["fixability"], "report-only");
}

#[test]
fn a_no_fix_exists_finding_says_so_and_offers_no_fix() {
    let mut finding = sample_finding();
    finding.confidence = ConfidenceTier::CertainMechanical;
    finding.replacement = Some("x".to_string());
    let entry = ReportEntry::new("post.md", 1, 1, finding).with_fixability(Fixability::NoFixExists);
    let report = Report::new(ToolMeta::new("sanitise", "0.1.0"), RULES).with_entries(vec![entry]);

    let result = &report.to_sarif()["runs"][0]["results"][0];
    assert_eq!(result["properties"]["fixability"], "no-fix-exists");
    assert_eq!(result["properties"]["autoFixable"], false);
    assert!(result["properties"]["noFixExplanation"].is_string());
    // Certain detection, but no `fixes[]`: the whole point of the axis.
    assert!(result["fixes"].is_null());
    assert_eq!(result["properties"]["confidence"], "certain-mechanical");
}

#[test]
fn a_no_fix_exists_finding_never_yields_an_edit_even_under_write() {
    let mut finding = sample_finding();
    finding.rule_id = "media-c2pa-soft-binding".to_string();
    finding.confidence = ConfidenceTier::CertainMechanical;
    finding.replacement = Some("x".to_string());

    // Without the override the tier would make it auto-fixable.
    assert!(finding.is_fixable(&Config::new()));

    let config = Config::new()
        .with_fixability_table(&[("media-c2pa-soft-binding", Fixability::NoFixExists)]);
    assert!(!finding.is_fixable(&config));
    assert!(finding.to_edit(&config).is_none());
    assert!(finding.to_edit(&config.clone().with_write(true)).is_none());
}

#[test]
fn resolving_against_a_config_picks_up_the_override() {
    let mut finding = sample_finding();
    finding.rule_id = "media-c2pa-soft-binding".to_string();
    finding.confidence = ConfidenceTier::CertainMechanical;
    let config = Config::new()
        .with_fixability_table(&[("media-c2pa-soft-binding", Fixability::NoFixExists)]);

    let derived = ReportEntry::new("a.png", 0, 0, finding.clone());
    assert_eq!(derived.fixability, Fixability::Mechanical);
    let resolved = derived.with_config(&config);
    assert_eq!(resolved.fixability, Fixability::NoFixExists);
}

#[test]
fn jsonl_carries_the_fixability() {
    let rendered = sample_report().to_jsonl();
    let value: serde_json::Value = serde_json::from_str(rendered.lines().next().unwrap()).unwrap();
    assert_eq!(value["fixability"], "report-only");
    assert_eq!(value["auto_fixable"], false);
}
