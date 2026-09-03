use super::*;
use prose_sanitiser_core::Fixability;

fn finding(rule: &str, tier: ConfidenceTier, start: usize, end: usize) -> Finding {
    Finding {
        rule_id: rule.to_string(),
        label: "test".to_string(),
        span: Span::new(start, end),
        matched: String::new(),
        severity: Severity::High,
        confidence: tier,
        advice: String::new(),
        replacement: Some(String::new()),
    }
}

fn outcome(findings: Vec<Finding>, text: Option<&str>) -> FileOutcome {
    FileOutcome {
        path: PathBuf::from("post.md"),
        kind: Kind::Text,
        findings,
        text: text.map(str::to_string),
    }
}

#[test]
fn line_and_column_are_one_based() {
    let text = "one\ntwo three\n";
    assert_eq!(line_and_column(text, 0), (1, 1));
    assert_eq!(line_and_column(text, 4), (2, 1));
    assert_eq!(line_and_column(text, 8), (2, 5));
    // Past the end clamps rather than panicking.
    assert_eq!(line_and_column(text, 9_999), (3, 1));
}

#[test]
fn line_and_column_count_characters_not_bytes() {
    let text = "naïve — word";
    let offset = text.find("word").unwrap();
    assert_eq!(line_and_column(text, offset), (1, 9));
}

#[test]
fn prose_layers_run_on_text_and_on_markdown_containers() {
    assert!(is_prose(Path::new("a.txt"), Kind::Text));
    assert!(is_prose(Path::new("a.md"), Kind::Container));
    assert!(is_prose(Path::new("a.HTML"), Kind::Container));
    assert!(!is_prose(Path::new("a.pdf"), Kind::Container));
    assert!(!is_prose(Path::new("a.docx"), Kind::Container));
    assert!(!is_prose(Path::new("a.png"), Kind::Image));
}

#[test]
fn a_named_media_rule_keeps_the_media_crates_own_identity() {
    // The media crate owns the id, the tier and the severity; this crate must
    // not paraphrase any of them.
    let note = "PNG chunk caBX (possible C2PA container)";
    let expected = prose_sanitiser_media::rule_for_finding(note).expect("a named rule");
    let finding = media_finding(note);
    assert_eq!(finding.rule_id, expected.id);
    assert_eq!(finding.confidence, expected.confidence);
    assert_eq!(finding.severity, expected.severity);
    assert_ne!(finding.rule_id, RULE_MEDIA_PROVENANCE);
    assert!(finding.replacement.is_none());
}

#[test]
fn an_unnamed_observation_falls_back_and_stays_report_only() {
    let finding = media_finding("format not fully inspected");
    assert_eq!(finding.rule_id, RULE_MEDIA_PROVENANCE);
    assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
    assert_eq!(finding.severity, Severity::Low);
}

#[test]
fn no_media_finding_ever_carries_a_replacement() {
    // Container surgery belongs to clean-image and clean-file. Whatever tier
    // the media crate assigns, this pass must never offer to rewrite bytes.
    for note in [
        "PNG chunk caBX (possible C2PA container)",
        "JPEG APP11 segment (JUMBF/C2PA common)",
        "byte-scan C2PA markers: c2pa",
        "format not fully inspected",
    ] {
        assert!(media_finding(note).replacement.is_none(), "{note}");
    }
}

#[test]
fn the_driver_table_covers_every_layer() {
    let ids: Vec<&str> = all_rule_meta().iter().map(|meta| meta.id).collect();
    // One rule from each crate that owns any, plus the local fallback.
    assert!(ids.contains(&"tier1-vocab"), "slop missing");
    assert!(ids.contains(&"unicode-invisible"), "unicode missing");
    assert!(ids.contains(&"us-spelling"), "uk missing");
    assert!(
        ids.iter().any(|id| id.starts_with("media-")),
        "media missing"
    );
    assert!(ids.contains(&RULE_MEDIA_PROVENANCE), "fallback missing");
}

#[test]
fn the_driver_table_has_no_duplicate_ids() {
    let mut ids: Vec<&str> = all_rule_meta().iter().map(|meta| meta.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "a rule id is documented twice");
}

#[test]
fn every_unicode_rule_reaches_the_driver_table() {
    // The Layer A rules are the only certain-mechanical ones in the pass, so a
    // missing entry silently drops a SARIF `fixes[]` a consumer would offer.
    for rule in prose_sanitiser_unicode::RULES {
        assert!(
            all_rule_meta().iter().any(|meta| meta.id == rule.id),
            "{} missing from the driver table",
            rule.id
        );
    }
}

#[test]
fn the_driver_table_is_built_once() {
    assert_eq!(all_rule_meta().as_ptr(), all_rule_meta().as_ptr());
}

#[test]
fn media_findings_never_produce_an_edit() {
    let outcome = outcome(vec![media_finding("PNG chunk caBX")], None);
    assert!(outcome.patch(&Config::new()).is_empty());
    assert!(outcome.patch(&Config::new().with_write(true)).is_empty());
}

#[test]
fn a_binary_file_is_never_patched_however_the_tiers_fall() {
    let outcome = outcome(
        vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            0,
            1,
        )],
        None,
    );
    assert!(outcome.patch(&Config::new()).is_empty());
}

#[test]
fn mechanical_findings_patch_without_an_opt_in() {
    let outcome = outcome(
        vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            1,
            2,
        )],
        Some("a\u{200b}b"),
    );
    assert_eq!(outcome.patch(&Config::new()).len(), 1);
}

#[test]
fn stylistic_findings_need_the_write_opt_in() {
    let outcome = outcome(
        vec![finding(
            "us-spelling",
            ConfidenceTier::HighConfidenceStylistic,
            0,
            5,
        )],
        Some("color word"),
    );
    assert!(outcome.patch(&Config::new()).is_empty());
    assert_eq!(outcome.patch(&Config::new().with_write(true)).len(), 1);
}

#[test]
fn judgement_findings_are_never_patched() {
    let outcome = outcome(
        vec![finding(
            "tier1-vocab",
            ConfidenceTier::LowConfidenceJudgement,
            0,
            5,
        )],
        Some("delve here"),
    );
    assert!(outcome.patch(&Config::new()).is_empty());
    assert!(outcome.patch(&Config::new().with_write(true)).is_empty());
}

#[test]
fn the_severity_floor_filters_the_report_and_the_counts() {
    let mut low = finding("tier1-vocab", ConfidenceTier::LowConfidenceJudgement, 0, 1);
    low.severity = Severity::Low;
    let outcome = outcome(
        vec![
            finding("unicode-invisible", ConfidenceTier::CertainMechanical, 2, 3),
            low,
        ],
        Some("abcd"),
    );
    assert_eq!(outcome.reportable(&Config::new()).len(), 2);
    let high_only = Config::new().with_min_severity(Severity::High);
    assert_eq!(outcome.reportable(&high_only).len(), 1);
    assert_eq!(outcome.tier_counts(&high_only), [1, 0, 0]);
    assert_eq!(outcome.tier_counts(&Config::new()), [1, 0, 1]);
}

#[test]
fn entries_locate_findings_in_the_source_text() {
    let text = "one\ntwo delve three\n";
    let start = text.find("delve").unwrap();
    let outcome = outcome(
        vec![finding(
            "tier1-vocab",
            ConfidenceTier::LowConfidenceJudgement,
            start,
            start + 5,
        )],
        Some(text),
    );
    let entries = outcome.entries(&Config::new());
    assert_eq!(entries[0].line, 2);
    assert_eq!(entries[0].column, 5);
    assert_eq!(entries[0].path, "post.md");
}

#[test]
fn entries_for_a_binary_file_carry_no_line() {
    let outcome = outcome(vec![media_finding("PNG chunk caBX")], None);
    assert_eq!(outcome.entries(&Config::new())[0].line, 0);
}

#[test]
fn reading_a_missing_file_is_a_tool_error() {
    let error = read_text(Path::new("/nonexistent/file.md")).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
    let error = kind_of(Path::new("/nonexistent/file.md")).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
}

// ---- fixability -------------------------------------------------------

#[test]
fn the_soft_binding_rule_declares_that_no_fix_exists() {
    let declared = FIXABILITY_OVERRIDES
        .iter()
        .find(|(id, _)| *id == "media-c2pa-soft-binding")
        .map(|(_, fixability)| *fixability);
    assert_eq!(declared, Some(Fixability::NoFixExists));
}

#[test]
fn configure_applies_every_declared_override() {
    let config = configure(Config::new());
    for (rule_id, fixability) in FIXABILITY_OVERRIDES {
        assert_eq!(
            config.fixability_for(rule_id),
            Some(*fixability),
            "{rule_id}"
        );
    }
}

#[test]
fn a_no_fix_finding_is_never_patched_even_with_a_replacement_and_write() {
    // The hazard the axis exists to close: certain detection would otherwise
    // make this auto-fixable straight through `to_edit`.
    let mut finding = finding(
        "media-c2pa-soft-binding",
        ConfidenceTier::CertainMechanical,
        0,
        4,
    );
    finding.replacement = Some(String::new());
    let outcome = FileOutcome {
        path: PathBuf::from("a.md"),
        kind: Kind::Text,
        findings: vec![finding],
        text: Some("abcd".to_string()),
    };

    // Unconfigured, the tier alone would allow it.
    assert_eq!(outcome.patch(&Config::new()).len(), 1);
    // Configured, it never applies, with or without --write.
    let config = configure(Config::new());
    assert!(outcome.patch(&config).is_empty());
    assert!(outcome.patch(&config.clone().with_write(true)).is_empty());
}

#[test]
fn entries_resolve_fixability_against_the_configuration() {
    let outcome = FileOutcome {
        path: PathBuf::from("a.png"),
        kind: Kind::Image,
        findings: vec![finding(
            "media-c2pa-soft-binding",
            ConfidenceTier::CertainMechanical,
            0,
            0,
        )],
        text: None,
    };
    let entries = outcome.entries(&configure(Config::new()));
    assert_eq!(entries[0].fixability, Fixability::NoFixExists);
    // The tier still tells the truth about the detection.
    assert_eq!(
        entries[0].finding.confidence,
        ConfidenceTier::CertainMechanical
    );
}

#[test]
fn an_ordinary_finding_still_takes_its_tiers_default() {
    let outcome = FileOutcome {
        path: PathBuf::from("a.md"),
        kind: Kind::Text,
        findings: vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            0,
            1,
        )],
        text: Some("ab".to_string()),
    };
    let entries = outcome.entries(&configure(Config::new()));
    assert_eq!(entries[0].fixability, Fixability::Mechanical);
}
