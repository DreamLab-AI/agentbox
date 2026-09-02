use super::*;

fn write(dir: &Path, name: &str, data: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&path, data).unwrap();
    path
}

#[test]
fn a_text_file_is_scanned_by_layer_a() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), "notes.txt", "hidden\u{200b}mark".as_bytes());
    let item = scan_file(&path, None);
    assert_eq!(item["kind"], "text");
    assert_eq!(item["suspicious_total"], 1);
    assert_eq!(item["has_c2pa"], false);
    let findings: Vec<String> = serde_json::from_value(item["findings"].clone()).unwrap();
    assert_eq!(findings[0], "layer-a [zwj_family] U+200B ZERO WIDTH SPACE (Cf) x1");
    assert_eq!(item["confidence"][0], "probable");
}

#[test]
fn a_display_name_overrides_the_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), "a.txt", b"plain");
    let item = scan_file(&path, Some("https://example.com/a.txt"));
    assert_eq!(item["path"], "https://example.com/a.txt");
}

#[test]
fn a_text_bearing_container_gets_both_scans() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(
        dir.path(),
        "post.md",
        "---\ngenerator: Claude\n---\nBody\u{200b}text\n".as_bytes(),
    );
    let item = scan_file(&path, None);
    assert_eq!(item["kind"], "markdown");
    assert_eq!(item["has_ai_metadata"], true);
    // The frontmatter finding and the Layer A finding are both present.
    let findings: Vec<String> = serde_json::from_value(item["findings"].clone()).unwrap();
    assert!(findings.iter().any(|f| f.starts_with("frontmatter key")));
    assert!(findings.iter().any(|f| f.starts_with("layer-a ")));
    assert_eq!(item["suspicious_total"], 1);
    // Confidence stays aligned with findings, one for one.
    assert_eq!(
        item["confidence"].as_array().unwrap().len(),
        findings.len()
    );
}

#[test]
fn an_image_is_scanned_as_its_own_format() {
    let dir = tempfile::tempdir().unwrap();
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&crate::image::png::build_chunk(
        b"IHDR",
        &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0],
    ));
    png.extend_from_slice(&crate::image::png::build_chunk(b"IEND", b""));
    let path = write(dir.path(), "pic.png", &png);
    let item = scan_file(&path, None);
    assert_eq!(item["kind"], "png");
    assert_eq!(item["suspicious_total"], 0);
}

#[test]
fn actionability_needs_a_strong_finding_or_c2pa() {
    assert!(is_actionable(&serde_json::json!({"has_c2pa": true, "confidence": []})));
    assert!(is_actionable(
        &serde_json::json!({"has_c2pa": false, "confidence": ["probable"]})
    ));
    assert!(is_actionable(
        &serde_json::json!({"has_c2pa": false, "confidence": ["confirmed"]})
    ));
    assert!(!is_actionable(
        &serde_json::json!({"has_c2pa": false, "confidence": ["informational"]})
    ));
    assert!(!is_actionable(
        &serde_json::json!({"has_c2pa": false, "confidence": ["likely_false_positive"]})
    ));
    assert!(!is_actionable(&serde_json::json!({"path": "x", "error": "boom"})));
}

#[test]
fn the_summary_counts_every_dimension() {
    let files = vec![
        serde_json::json!({
            "kind": "png", "has_c2pa": true, "has_ai_metadata": true,
            "suspicious_total": 0, "confidence": ["confirmed"]
        }),
        serde_json::json!({
            "kind": "text", "has_c2pa": false, "has_ai_metadata": false,
            "suspicious_total": 3, "confidence": ["probable", "informational"]
        }),
        serde_json::json!({
            "kind": "text", "has_c2pa": false, "has_ai_metadata": false,
            "suspicious_total": 0, "confidence": []
        }),
        serde_json::json!({"path": "bad", "error": "unreadable"}),
    ];
    let summary = aggregate(&files);
    assert_eq!(summary["total"], 4);
    assert_eq!(summary["by_kind"]["text"], 2);
    assert_eq!(summary["by_kind"]["png"], 1);
    assert_eq!(summary["by_kind"]["error"], 1, "an item with no kind counts as error");
    assert_eq!(summary["with_c2pa"], 1);
    assert_eq!(summary["with_ai_metadata"], 1);
    assert_eq!(summary["with_suspicious_text"], 1);
    assert_eq!(summary["actionable_files"], 2);
    assert_eq!(summary["findings_by_confidence"]["confirmed"], 1);
    assert_eq!(summary["findings_by_confidence"]["probable"], 1);
    assert_eq!(summary["findings_by_confidence"]["informational"], 1);
    assert_eq!(summary["findings_by_confidence"]["likely_false_positive"], 0);
}

#[test]
fn an_empty_audit_summarises_cleanly() {
    let summary = aggregate(&[]);
    assert_eq!(summary["total"], 0);
    assert_eq!(summary["actionable_files"], 0);
    // Every confidence level is still present, at zero.
    assert_eq!(summary["findings_by_confidence"].as_object().unwrap().len(), 4);
}

#[test]
fn the_human_report_renders_the_python_dict_shape() {
    let files = vec![serde_json::json!({
        "path": "a.md", "kind": "markdown", "has_c2pa": false,
        "has_ai_metadata": true, "suspicious_total": 0,
        "findings": ["frontmatter key: generator"], "confidence": ["probable"]
    })];
    let summary = aggregate(&files);
    let text = human_report(&files, &summary, &[("Root".into(), "/tmp/x".into())]);
    assert!(text.starts_with("Root: /tmp/x\nFiles scanned: 1\n"));
    assert!(text.contains("By kind: {'markdown': 1}"));
    assert!(text.contains("Findings by confidence: {'confirmed': 0, 'probable': 1,"));
    assert!(text.contains("  [probable] a.md: frontmatter key: generator"));
}

#[test]
fn the_walk_is_sorted_pre_order_and_skips_noise_directories() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "b.txt", b"x");
    write(dir.path(), "a.txt", b"x");
    write(dir.path(), "sub/c.txt", b"x");
    write(dir.path(), "node_modules/skipped.txt", b"x");
    write(dir.path(), ".hidden/skipped.txt", b"x");
    write(dir.path(), "target/skipped.txt", b"x");

    let skip: Vec<String> = DEFAULT_SKIP_DIRS.iter().map(|s| s.to_string()).collect();
    let found: Vec<String> = walk_files(dir.path(), &skip)
        .iter()
        .map(|path| {
            path.strip_prefix(dir.path())
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(found, vec!["a.txt", "b.txt", "sub/c.txt"]);
}

#[test]
fn extra_skip_directories_are_honoured() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "keep/a.txt", b"x");
    write(dir.path(), "drop/b.txt", b"x");
    let skip = vec!["drop".to_string()];
    let found = walk_files(dir.path(), &skip);
    assert_eq!(found.len(), 1);
    assert!(found[0].ends_with("keep/a.txt"));
}
