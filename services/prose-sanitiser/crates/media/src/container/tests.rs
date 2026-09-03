use super::*;

fn write(dir: &Path, name: &str, data: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, data).unwrap();
    path
}

#[test]
fn the_extension_decides_before_the_bytes() {
    assert_eq!(
        detect_container_format(Path::new("a.md"), Some(b"%PDF")),
        "markdown"
    );
    assert_eq!(detect_container_format(Path::new("a.htm"), None), "html");
    assert_eq!(
        detect_container_format(Path::new("a.mdx"), None),
        "markdown"
    );
}

#[test]
fn bytes_decide_when_the_extension_does_not() {
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(b"%PDF-1.7")),
        "pdf"
    );
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(b"  <svg xmlns=\"...\">")),
        "svg"
    );
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(b"plain")),
        "unknown"
    );
    assert_eq!(detect_container_format(Path::new("blob"), None), "unknown");
}

#[test]
fn zip_containers_are_told_apart_by_their_parts() {
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    let build = |names: &[&str]| {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            for name in names {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(b"<x/>").unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    };

    let docx = build(&["word/document.xml"]);
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(&docx)),
        "docx"
    );
    let odt = build(&["content.xml", "meta.xml"]);
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(&odt)),
        "odt"
    );
    let other = build(&["random.txt"]);
    assert_eq!(
        detect_container_format(Path::new("blob"), Some(&other)),
        "unknown"
    );
}

#[test]
fn markdown_round_trips_through_inspect_and_clean() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(
        dir.path(),
        "post.md",
        b"---\ntitle: Hills\ngenerator: Claude\n---\n\nBody\xe2\x80\x8btext.\n",
    );
    let report = inspect_container(&source).unwrap();
    assert_eq!(report.format, "markdown");
    assert!(report.has_ai_metadata);
    assert!(report.details["has_frontmatter"].as_bool().unwrap());

    let dest = dir.path().join("post.cleaned.md");
    let result = clean_container(&source, &dest, true).unwrap();
    assert_eq!(result["format"], "markdown");
    assert_eq!(result["still_has_ai_metadata"], false);

    let actions: Vec<String> = serde_json::from_value(result["actions"].clone()).unwrap();
    assert!(actions.contains(&"drop frontmatter key: generator".to_string()));
    // The zero-width space in the body was scrubbed by the Layer A pass.
    assert!(actions
        .iter()
        .any(|a| a.starts_with("layer A text: removed=1")));
    let text = std::fs::read_to_string(&dest).unwrap();
    assert_eq!(text, "---\ntitle: Hills\n---\n\nBodytext.\n");
}

#[test]
fn the_layer_a_pass_can_be_switched_off() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(
        dir.path(),
        "post.md",
        b"---\ntitle: t\n---\nBody\xe2\x80\x8btext.\n",
    );
    let dest = dir.path().join("out.md");
    clean_container(&source, &dest, false).unwrap();
    // The invisible carrier survives when the caller opts out.
    assert!(std::fs::read(&dest)
        .unwrap()
        .windows(3)
        .any(|w| w == b"\xe2\x80\x8b"));
}

#[test]
fn html_is_cleaned_and_reinspected() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(
        dir.path(),
        "page.html",
        br#"<html><head><meta name="generator" content="Claude"></head><body>Text</body></html>"#,
    );
    assert!(inspect_container(&source).unwrap().has_ai_metadata);

    let dest = dir.path().join("page.cleaned.html");
    let result = clean_container(&source, &dest, true).unwrap();
    assert_eq!(result["still_has_ai_metadata"], false);
    assert!(std::fs::read_to_string(&dest)
        .unwrap()
        .contains("<body>Text</body>"));
}

#[test]
fn svg_notes_and_tools_are_populated() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(
        dir.path(),
        "d.svg",
        br#"<svg><metadata>c2pa</metadata></svg>"#,
    );
    let report = inspect_container(&source).unwrap();
    assert_eq!(report.format, "svg");
    assert!(report.has_c2pa);
    // SVG/PDF/DOCX always get the optional-tool probe.
    assert!(report.tools["exiftool"]["available"].is_boolean());
}

#[test]
fn an_unsupported_container_is_reported_not_cleaned() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "thing.bin", b"just some bytes");
    let report = inspect_container(&source).unwrap();
    assert_eq!(report.format, "unknown");
    assert_eq!(
        report.findings,
        vec!["unsupported container: unknown".to_string()]
    );
    assert!(report
        .notes
        .contains(&"format not fully inspected: unknown".to_string()));

    let dest = dir.path().join("out.bin");
    let error = clean_container(&source, &dest, true).unwrap_err();
    assert_eq!(error, "unsupported container format: unknown");
}

#[test]
fn the_report_json_carries_a_confidence_per_finding() {
    let dir = tempfile::tempdir().unwrap();
    let source = write(dir.path(), "post.md", b"---\ngenerator: Claude\n---\n");
    let json = inspect_container(&source).unwrap().to_json();
    let findings = json["findings"].as_array().unwrap();
    let confidences = json["findings_confidence"].as_array().unwrap();
    assert_eq!(findings.len(), confidences.len());
    assert_eq!(confidences[0], "probable");
}
