use super::*;

fn scan_source(name: &str, body: &str) -> Vec<Finding> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    std::fs::write(&path, body).unwrap();
    scan_file(&path, &RuleFilter::default())
}

fn rules_hit(findings: &[Finding]) -> Vec<String> {
    let mut names: Vec<String> = findings.iter().map(|f| f.rule.clone()).collect();
    names.sort();
    names.dedup();
    names
}

#[test]
fn a_clean_stylesheet_produces_nothing() {
    let findings = scan_source(
        "a.css",
        "body { font-family: 'Fraunces', Georgia, serif; color: #1c1a17; background: #faf7f2; }\n\
         h1 { font-family: 'Space Mono', monospace; line-height: 1.5; }\n",
    );
    assert!(findings.is_empty(), "got {:?}", rules_hit(&findings));
}

#[test]
fn the_overused_font_rule_fires_on_the_primary_face_only() {
    let hit = scan_source(
        "a.css",
        "body { font-family: Inter, 'Fraunces', sans-serif; }\n",
    );
    assert!(rules_hit(&hit).contains(&"overused-font".to_string()));
    assert_eq!(hit[0].severity, Severity::Warn);
    assert_eq!(hit[0].line, 1);

    // Inter as a fallback, not the primary, is not the tell.
    let miss = scan_source("a.css", "body { font-family: 'Fraunces', Inter, serif; }\n");
    assert!(!rules_hit(&miss).contains(&"overused-font".to_string()));
}

#[test]
fn a_single_named_family_is_flagged_once_for_the_whole_file() {
    let findings = scan_source(
        "a.css",
        "body { font-family: 'Fraunces', serif; }\nh1 { font-family: 'Fraunces', serif; }\n",
    );
    let single: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.rule == "single-font")
        .collect();
    assert_eq!(single.len(), 1);
    assert_eq!(single[0].line, 0, "whole-file findings report line 0");
    assert_eq!(single[0].snippet, "fraunces");
}

#[test]
fn the_blue_to_purple_gradient_is_the_canonical_tell() {
    let findings = scan_source(
        "a.css",
        ".hero { background: linear-gradient(135deg, #3b82f6, #8b5cf6); }\n",
    );
    let gradient = findings
        .iter()
        .find(|f| f.rule == "purple-blue-gradient")
        .expect("gradient finding");
    assert_eq!(gradient.severity, Severity::Warn);

    // A single-hue gradient is fine.
    let clean = scan_source(
        "a.css",
        ".hero { background: linear-gradient(135deg, #3b82f6, #1e40af); }\n",
    );
    assert!(!rules_hit(&clean).contains(&"purple-blue-gradient".to_string()));
}

#[test]
fn grey_text_on_a_coloured_background_is_caught_without_lookbehind() {
    let findings = scan_source("a.css", ".badge { background: #c2410c; color: #808080; }\n");
    assert!(rules_hit(&findings).contains(&"gray-on-color".to_string()));
}

#[test]
fn a_hyphenated_color_property_does_not_count_as_the_foreground() {
    // `border-color` must not be read as the text colour — the case the
    // Python's (?<!-) lookbehind existed for.
    let findings = scan_source(
        "a.css",
        ".badge { background: #c2410c; border-color: #808080; }\n",
    );
    assert!(!rules_hit(&findings).contains(&"gray-on-color".to_string()));
}

#[test]
fn pure_black_and_white_are_reported_and_capped_at_six() {
    let mut body = String::new();
    for index in 0..10 {
        body.push_str(&format!(".c{index} {{ color: #000; }}\n"));
    }
    let findings = scan_source("a.css", &body);
    let pure: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.rule == "pure-black-white")
        .collect();
    assert_eq!(pure.len(), 6, "the Python caps this rule at six");
}

#[test]
fn skipped_heading_levels_break_the_outline() {
    let findings = scan_source("a.html", "<h1>A</h1>\n<h2>B</h2>\n<h4>C</h4>\n");
    let skipped = findings
        .iter()
        .find(|f| f.rule == "skipped-heading")
        .expect("skipped heading");
    assert_eq!(skipped.line, 3);
    assert!(skipped.message.contains("h2→h4"));

    let ordered = scan_source("a.html", "<h1>A</h1>\n<h2>B</h2>\n<h3>C</h3>\n");
    assert!(!rules_hit(&ordered).contains(&"skipped-heading".to_string()));
}

#[test]
fn nested_cards_need_increasing_indentation_and_proximity() {
    let nested = scan_source(
        "a.jsx",
        "<div className=\"card\">\n  <div className=\"card inner\">x</div>\n</div>\n",
    );
    assert!(rules_hit(&nested).contains(&"nested-cards".to_string()));

    // Siblings at the same indentation are not nested.
    let siblings = scan_source(
        "a.jsx",
        "<div className=\"card\">a</div>\n<div className=\"card\">b</div>\n",
    );
    assert!(!rules_hit(&siblings).contains(&"nested-cards".to_string()));
}

#[test]
fn five_centred_blocks_trip_the_everything_centered_rule() {
    let four = scan_source("a.css", &".x { text-align: center; }\n".repeat(4));
    assert!(!rules_hit(&four).contains(&"everything-centered".to_string()));

    let five = scan_source("a.css", &".x { text-align: center; }\n".repeat(5));
    let finding = five
        .iter()
        .find(|f| f.rule == "everything-centered")
        .expect("centered finding");
    assert!(finding.message.starts_with("5 center-aligned blocks"));

    // Tailwind classes count too.
    let tailwind = scan_source("a.html", &"<p class=\"text-center\">x</p>\n".repeat(5));
    assert!(rules_hit(&tailwind).contains(&"everything-centered".to_string()));
}

#[test]
fn a_same_line_disable_suppresses_only_the_named_rule() {
    let findings = scan_source(
        "a.css",
        "/* slop-disable tiny-text */\n.x { font-size: 9px; text-align: justify; }\n",
    );
    // The disable comment sits on its own line, so line 2 is still scanned.
    assert!(rules_hit(&findings).contains(&"tiny-text".to_string()));

    let inline = scan_source(
        "a.css",
        ".x { font-size: 9px; } /* slop-disable tiny-text */\n",
    );
    assert!(
        inline.is_empty(),
        "a line carrying the marker is skipped entirely"
    );
}

#[test]
fn a_next_line_disable_suppresses_the_following_line() {
    let findings = scan_source(
        "a.css",
        "/* slop-disable-next-line tiny-text */\n.x { font-size: 9px; }\n",
    );
    assert!(!rules_hit(&findings).contains(&"tiny-text".to_string()));

    // A different rule on that line still reports.
    let other = scan_source(
        "a.css",
        "/* slop-disable-next-line tiny-text */\n.x { text-align: justify; }\n",
    );
    assert!(rules_hit(&other).contains(&"justified-text".to_string()));
}

#[test]
fn a_disable_marker_with_no_rule_names_suppresses_everything() {
    // Only reachable when the marker is followed by nothing the rule-name
    // character class can eat.
    let map = disabled_map(&["/* slop-disable-next-line  */", ".x { font-size: 9px; }"]);
    assert!(is_disabled(&map, 2, "tiny-text"));
    assert!(is_disabled(&map, 2, "anything-else"));
}

#[test]
fn an_html_bare_marker_parses_its_own_dashes_as_a_rule_name() {
    // `<!-- slop-disable-next-line -->` leaves "--" for the rule-name class,
    // so it suppresses a rule literally called "--" rather than everything.
    // Faithful to the Python, and left alone: the fix is a catalogue change,
    // not a silent behaviour divergence in the port.
    let map = disabled_map(&["<!-- slop-disable-next-line -->", ".x { font-size: 9px; }"]);
    assert!(!is_disabled(&map, 2, "tiny-text"));
    assert!(is_disabled(&map, 2, "--"));
}

#[test]
fn html_comment_disables_are_recognised_too() {
    let findings = scan_source(
        "a.html",
        "<!-- slop-disable-next-line tiny-text -->\n<p style=\"font-size: 9px\">x</p>\n",
    );
    assert!(!rules_hit(&findings).contains(&"tiny-text".to_string()));
}

#[test]
fn the_rule_filter_honours_only_and_ignore() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.css");
    std::fs::write(&path, ".x { font-size: 9px; text-align: justify; }\n").unwrap();

    let only = scan_file(
        &path,
        &RuleFilter {
            only: Some("tiny-text".into()),
            ignore: Vec::new(),
        },
    );
    assert_eq!(rules_hit(&only), vec!["tiny-text".to_string()]);

    let ignored = scan_file(
        &path,
        &RuleFilter {
            only: None,
            ignore: vec!["tiny-text".into()],
        },
    );
    assert!(!rules_hit(&ignored).contains(&"tiny-text".to_string()));
    assert!(rules_hit(&ignored).contains(&"justified-text".to_string()));
}

#[test]
fn the_severity_floor_filters_the_result_set() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.css");
    std::fs::write(&path, ".x { font-size: 9px; text-align: justify; }\n").unwrap();
    let paths = vec![path];

    let all = scan(&paths, &RuleFilter::default(), Severity::Info);
    assert_eq!(all.len(), 2);
    let warn_only = scan(&paths, &RuleFilter::default(), Severity::Warn);
    assert_eq!(rules_hit(&warn_only), vec!["tiny-text".to_string()]);
    let error_only = scan(&paths, &RuleFilter::default(), Severity::Error);
    assert!(error_only.is_empty());
}

#[test]
fn the_walk_covers_the_scannable_extensions_and_skips_noise() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.css"), "body{}").unwrap();
    std::fs::write(dir.path().join("b.tsx"), "<div/>").unwrap();
    std::fs::write(dir.path().join("c.py"), "pass").unwrap();
    std::fs::create_dir(dir.path().join("node_modules")).unwrap();
    std::fs::write(dir.path().join("node_modules/d.css"), "body{}").unwrap();

    let found = walk(&[dir.path().to_path_buf()]);
    assert_eq!(found.len(), 2);
    assert!(found
        .iter()
        .all(|p| !p.to_string_lossy().contains("node_modules")));
}

#[test]
fn findings_group_by_rule_in_descending_count_order() {
    let findings = scan_source(
        "a.css",
        ".a { color: #000; }\n.b { color: #fff; }\n.c { text-align: justify; }\n",
    );
    let grouped = by_rule(&findings);
    assert_eq!(grouped[0].0, "pure-black-white");
    assert_eq!(grouped[0].1, 2);
}

#[test]
fn findings_serialise_with_the_python_keys() {
    let findings = scan_source("a.css", ".x { font-size: 9px; }\n");
    let json = findings[0].to_json();
    for key in ["rule", "severity", "file", "line", "snippet", "message"] {
        assert!(json.get(key).is_some(), "missing key {key}");
    }
    assert_eq!(json["severity"], "warn");
}

#[test]
fn severity_parses_and_orders() {
    assert_eq!(Severity::parse("warn"), Some(Severity::Warn));
    assert_eq!(Severity::parse("fatal"), None);
    assert!(Severity::Info < Severity::Warn);
    assert!(Severity::Warn < Severity::Error);
}
