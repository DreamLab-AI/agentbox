use super::*;

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
fn a_parsed_provenance_structure_is_mechanical() {
    let finding = media_finding("JPEG APP11 segment (JUMBF/C2PA common)");
    assert_eq!(finding.rule_id, RULE_MEDIA_PROVENANCE);
    assert_eq!(finding.confidence, ConfidenceTier::CertainMechanical);
    assert_eq!(finding.severity, Severity::High);
    assert!(finding.replacement.is_none());
}

#[test]
fn a_raw_byte_scan_is_a_judgement_call() {
    let finding = media_finding("byte-scan C2PA markers: c2pa");
    assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
    assert_eq!(finding.severity, Severity::Low);
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
