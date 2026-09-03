//! Tests for `super` (`docs_alignment::links`) — split out to keep
//! `links.rs` under the 500-line cap.

use super::*;
use std::fs;

fn write(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

#[test]
fn resolves_internal_link_and_flags_broken_one() {
    let tmp = tempfile::tempdir().unwrap();
    write(
        tmp.path(),
        "docs/index.md",
        "[good](other.md)\n[bad](missing.md)\n",
    );
    write(tmp.path(), "docs/other.md", "# Other\n");

    let mut v = LinkValidator::new(tmp.path(), "docs", false, vec![]);
    v.validate_local_pass();
    let report = v.finalize();

    assert_eq!(report.total_links, 2);
    assert_eq!(report.valid_links, 1);
    assert_eq!(report.broken_links.len(), 1);
    assert_eq!(report.broken_links[0].link_target, "missing.md");
}

#[test]
fn detects_orphan_doc() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "docs/index.md", "[other](other.md)\n");
    write(tmp.path(), "docs/other.md", "# Other\n");
    write(tmp.path(), "docs/orphan.md", "# Nobody links here\n");

    let mut v = LinkValidator::new(tmp.path(), "docs", false, vec![]);
    v.validate_local_pass();
    let report = v.finalize();

    assert!(report.orphan_docs.iter().any(|d| d.ends_with("orphan.md")));
    assert!(!report.orphan_docs.iter().any(|d| d.ends_with("other.md")));
}

#[test]
fn ignore_pattern_excludes_matching_paths() {
    let tmp = tempfile::tempdir().unwrap();
    write(tmp.path(), "docs/index.md", "hi\n");
    write(tmp.path(), "docs/vendor/skip.md", "should be ignored\n");

    let mut v = LinkValidator::new(tmp.path(), "docs", false, vec!["vendor".to_string()]);
    v.validate_local_pass();
    let report = v.finalize();

    assert_eq!(report.total_files, 1);
}

#[test]
fn anchor_link_validated_against_headings() {
    let tmp = tempfile::tempdir().unwrap();
    write(
        tmp.path(),
        "docs/index.md",
        "# Overview\n[jump](#overview)\n[bad jump](#missing-section)\n",
    );

    let mut v = LinkValidator::new(tmp.path(), "docs", false, vec![]);
    v.validate_local_pass();
    let report = v.finalize();

    assert_eq!(report.broken_links.len(), 1);
    assert_eq!(report.broken_links[0].link_target, "#missing-section");
}
