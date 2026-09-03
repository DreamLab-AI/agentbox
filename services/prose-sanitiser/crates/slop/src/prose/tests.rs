use super::*;

fn scan_text(body: &str, floor: Severity) -> ScanResult {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("doc.md");
    std::fs::write(&path, body).unwrap();
    scan(&path, floor)
}

fn rule_ids(result: &ScanResult) -> Vec<String> {
    let mut ids: Vec<String> = result.findings.iter().map(|f| f.rule.clone()).collect();
    ids.sort();
    ids.dedup();
    ids
}

#[test]
fn clean_prose_produces_nothing() {
    let result = scan_text("A short note about hills.\n\nIt rained.\n", Severity::Low);
    assert!(result.findings.is_empty());
    assert_eq!(result.weighted(), 0);
    assert_eq!(result.verdict(), "Clean, no mechanical tells detected");
}

#[test]
fn tier1_vocabulary_is_a_high_severity_tell() {
    let result = scan_text(
        "We leverage a robust and seamless approach.\n",
        Severity::Low,
    );
    assert_eq!(result.high(), 1);
    assert!(rule_ids(&result).contains(&"tier1-vocab".to_string()));
    // One finding per line, not one per matching word.
    assert_eq!(result.findings.len(), 1);
}

#[test]
fn the_x_heading_and_opener_are_case_sensitive() {
    let result = scan_text("## The system\n", Severity::Low);
    assert!(rule_ids(&result).contains(&"the-heading".to_string()));

    let opener = scan_text("The system does a thing.\n", Severity::Low);
    assert!(rule_ids(&opener).contains(&"the-opener".to_string()));

    // A proper noun after "The" is left alone.
    let proper = scan_text("The Loom answers on port 8084.\n", Severity::Low);
    assert!(!rule_ids(&proper).contains(&"the-opener".to_string()));
}

#[test]
fn negative_parallelism_and_throat_clearing_are_caught() {
    let result = scan_text(
        "This is not just a tool, but a platform.\nIn today's rapidly evolving landscape, we ship.\n",
        Severity::Low,
    );
    let ids = rule_ids(&result);
    assert!(ids.contains(&"negative-parallelism".to_string()));
    assert!(ids.contains(&"throat-clearing".to_string()));
}

#[test]
fn us_spellings_are_flagged_for_uk_enforcement() {
    let result = scan_text("We optimize the color of the center.\n", Severity::Low);
    assert!(rule_ids(&result).contains(&"us-spelling".to_string()));
    // The UK forms are not flagged.
    let uk = scan_text("We optimise the colour of the centre.\n", Severity::Low);
    assert!(!rule_ids(&uk).contains(&"us-spelling".to_string()));
}

#[test]
fn fenced_code_is_never_scanned() {
    let result = scan_text(
        "Text.\n\n```python\n# we leverage a robust seamless approach\ncolor = 1\n```\n\nMore text.\n",
        Severity::Low,
    );
    assert!(result.findings.is_empty(), "got {:?}", rule_ids(&result));
}

#[test]
fn tilde_fences_toggle_too() {
    let result = scan_text("~~~\nWe leverage robust things.\n~~~\n", Severity::Low);
    assert!(result.findings.is_empty());
}

#[test]
fn blockquotes_and_the_ignore_marker_are_skipped() {
    let quoted = scan_text("> We leverage a robust approach.\n", Severity::Low);
    assert!(quoted.findings.is_empty());

    let ignored = scan_text("We leverage things. <!-- slop-ignore -->\n", Severity::Low);
    assert!(ignored.findings.is_empty());
}

#[test]
fn em_dash_density_trips_only_past_the_budget() {
    // Two em-dashes in a short file is within the per-500-word budget.
    let ok = scan_text("A — b — c.\n", Severity::Low);
    assert!(!ok
        .findings
        .iter()
        .any(|f| f.label == "Em-dash density over threshold"));

    let over = scan_text("A — b — c — d — e.\n", Severity::Low);
    let density = over
        .findings
        .iter()
        .find(|f| f.label == "Em-dash density over threshold")
        .expect("density finding");
    assert_eq!(density.severity, Severity::High);
    assert_eq!(density.line, 0, "aggregates report line 0");
    assert!(density.snippet.contains("4 em-dashes"));
}

#[test]
fn latex_triple_hyphens_count_as_em_dashes() {
    let result = scan_text("A --- b --- c --- d --- e.\n", Severity::Low);
    assert!(result
        .findings
        .iter()
        .any(|f| f.label == "Em-dash density over threshold"));
}

#[test]
fn an_em_dash_in_a_list_item_is_its_own_finding() {
    let result = scan_text("- a bullet — with a dash\n", Severity::Low);
    let finding = result
        .findings
        .iter()
        .find(|f| f.label == "Em-dash inside a list item")
        .expect("list finding");
    assert_eq!(finding.severity, Severity::Medium);
    assert_eq!(finding.line, 1);
}

#[test]
fn three_distinct_tier2_words_cluster_into_one_low_finding() {
    let two = scan_text("A crucial and notable point.\n", Severity::Low);
    assert!(!two.findings.iter().any(|f| f.label.starts_with("Tier-2")));

    let three = scan_text("A crucial, notable and remarkable point.\n", Severity::Low);
    let cluster = three
        .findings
        .iter()
        .find(|f| f.label.starts_with("Tier-2"))
        .expect("cluster finding");
    assert_eq!(cluster.severity, Severity::Low);
    assert_eq!(cluster.snippet, "crucial, notable, remarkable");
    assert_eq!(cluster.line, 1);
}

#[test]
fn transition_overuse_is_a_medium_aggregate() {
    let result = scan_text(
        "Furthermore. Moreover. Additionally. Consequently.\n",
        Severity::Low,
    );
    let finding = result
        .findings
        .iter()
        .find(|f| f.label == "Transition-word overuse")
        .expect("transition finding");
    assert_eq!(finding.severity, Severity::Medium);
}

#[test]
fn the_severity_floor_filters_line_and_aggregate_findings_alike() {
    let body = "We leverage things.\nIt is basically fine.\n- **Term:** a bullet\n";
    let all = scan_text(body, Severity::Low);
    let ids = rule_ids(&all);
    assert!(ids.contains(&"tier1-vocab".to_string()));
    assert!(ids.contains(&"hedge-words".to_string()));
    assert!(ids.contains(&"bold-label-bullet".to_string()));

    let high_only = scan_text(body, Severity::High);
    assert_eq!(rule_ids(&high_only), vec!["tier1-vocab".to_string()]);

    // An aggregate below the floor is suppressed too.
    let dashes = scan_text("- a — b\n", Severity::High);
    assert!(!dashes
        .findings
        .iter()
        .any(|f| f.label == "Em-dash inside a list item"));
}

#[test]
fn the_verdict_ladder_matches_the_python_thresholds() {
    assert_eq!(verdict(0, 0), "Clean, no mechanical tells detected");
    assert_eq!(verdict(0, 3), "Mostly clean, minor tells");
    assert_eq!(verdict(1, 3), "Some AI tells present");
    assert_eq!(verdict(0, 6), "Some AI tells present");
    assert_eq!(verdict(5, 15), "STRONG AI writing fingerprint");
    assert_eq!(verdict(0, 20), "STRONG AI writing fingerprint");
}

#[test]
fn the_weighted_score_uses_the_tier_weights() {
    // One high (3) + one medium (2).
    let result = scan_text(
        "We leverage things.\nIt is basically fine.\n",
        Severity::Low,
    );
    assert_eq!(result.high(), 1);
    assert_eq!(result.weighted(), 5);
}

#[test]
fn a_directory_scan_walks_only_the_prose_extensions() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "We leverage things.\n").unwrap();
    std::fs::write(dir.path().join("b.txt"), "Plain.\n").unwrap();
    std::fs::write(dir.path().join("c.rs"), "// we leverage things\n").unwrap();
    std::fs::create_dir(dir.path().join("node_modules")).unwrap();
    std::fs::write(
        dir.path().join("node_modules/d.md"),
        "We leverage things.\n",
    )
    .unwrap();

    let result = scan(dir.path(), Severity::Low);
    assert_eq!(result.files_scanned, 2, "only .md and .txt");
    assert_eq!(result.high(), 1);
}

#[test]
fn findings_serialise_with_the_python_keys() {
    let result = scan_text("We leverage things.\n", Severity::Low);
    let json = result.findings[0].to_json();
    for key in ["rule", "label", "sev", "fix", "file", "line", "snippet"] {
        assert!(json.get(key).is_some(), "missing key {key}");
    }
    assert_eq!(json["sev"], "high");
    assert_eq!(json["line"], 1);
}

#[test]
fn undecodable_bytes_do_not_derail_the_scan() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("doc.md");
    let mut body = b"We leverage things ".to_vec();
    body.push(0xFF);
    body.extend_from_slice(b" here.\n");
    std::fs::write(&path, body).unwrap();
    let result = scan(&path, Severity::Low);
    assert_eq!(result.high(), 1);
}

// ---- snippet windowing -------------------------------------------------

#[test]
fn a_short_line_is_quoted_whole() {
    let line = "We delve into it.";
    assert_eq!(snippet_around(line, 3, 8, SNIPPET_CHARS), line);
}

#[test]
fn a_long_line_centres_the_window_on_the_match() {
    // The match sits far past the old fixed 160-character prefix.
    let filler = "word ".repeat(120);
    let line = format!("{filler}delve{filler}");
    let start = line.chars().count() / 2;
    let snippet = snippet_around(&line, start, start + 5, SNIPPET_CHARS);

    assert!(
        snippet.contains("delve"),
        "snippet lost the match: {snippet}"
    );
    assert!(snippet.starts_with("..."));
    assert!(snippet.ends_with("..."));
    // The window itself is the budget; the markers sit outside it.
    assert_eq!(snippet.chars().count(), SNIPPET_CHARS + 6);
}

#[test]
fn a_match_near_the_start_does_not_pad_off_the_front() {
    let line = format!("delve{}", "word ".repeat(120));
    let snippet = snippet_around(&line, 0, 5, SNIPPET_CHARS);
    assert!(snippet.starts_with("delve"), "{snippet}");
    assert!(snippet.ends_with("..."));
}

#[test]
fn a_match_near_the_end_does_not_pad_off_the_back() {
    let line = format!("{}delve", "word ".repeat(120));
    let count = line.chars().count();
    let snippet = snippet_around(&line, count - 5, count, SNIPPET_CHARS);
    assert!(snippet.ends_with("delve"), "{snippet}");
    assert!(snippet.starts_with("..."));
}

#[test]
fn a_match_longer_than_the_window_keeps_its_own_start() {
    let line = "x".repeat(500);
    let snippet = snippet_around(&line, 100, 400, SNIPPET_CHARS);
    assert_eq!(snippet.chars().count(), SNIPPET_CHARS + 6);
}

#[test]
fn windowing_counts_characters_not_bytes() {
    // Every character is multi-byte, so a byte-based window would split one.
    let line = "é".repeat(400);
    let snippet = snippet_around(&line, 200, 201, SNIPPET_CHARS);
    assert_eq!(snippet.chars().filter(|c| *c == 'é').count(), SNIPPET_CHARS);
}

#[test]
fn every_reported_snippet_contains_its_match() {
    // The regression the baseline found: 75 of 120 findings quoted a snippet
    // that did not contain the thing being reported.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("long.md");
    // Spaces around each marker: the rules are word-boundary anchored, so
    // "basically" glued to the next word is genuinely not a hedge word.
    let filler = "ordinary words here ".repeat(40);
    std::fs::write(
        &path,
        format!("{filler}we delve into it {filler}\n{filler}basically {filler}\n"),
    )
    .unwrap();

    let findings = scan(&path, Severity::Low);
    assert!(findings.findings.len() >= 2);
    for finding in &findings.findings {
        if finding.line == 0 {
            continue; // whole-file aggregate: a summary, not a quotation
        }
        let matched = &finding.snippet;
        assert!(
            matched.contains("delve") || matched.contains("basically"),
            "{} at line {} quoted a snippet without its match: {matched}",
            finding.rule,
            finding.line
        );
    }
}
