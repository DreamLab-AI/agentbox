//! Golden parity: every output here was produced by the Python the crate
//! replaced, byte for byte, and is asserted unchanged.

mod common;

use common::{drawio_output, golden, mermaid_output};

/// The goldens are captured stdout, and both binaries append the newline the
/// digest already carries but the JSON does not.
fn assert_golden(actual: &str, name: &str) {
    let mut actual = actual.to_string();
    if !actual.ends_with('\n') {
        actual.push('\n');
    }
    let expected = golden(name);
    assert_eq!(actual, expected, "output drifted from golden {name}");
}

#[test]
fn mermaid_flowchart_matches_python() {
    assert_golden(
        &mermaid_output("sample-flowchart.mmd", None, false, 40),
        "sample-flowchart.md",
    );
    assert_golden(
        &mermaid_output("sample-flowchart.mmd", None, true, 40),
        "sample-flowchart.json",
    );
}

#[test]
fn mermaid_max_rows_truncation_matches_python() {
    assert_golden(
        &mermaid_output("sample-flowchart.mmd", None, false, 3),
        "sample-flowchart.max3.md",
    );
}

#[test]
fn mermaid_sequence_matches_python() {
    assert_golden(
        &mermaid_output("sample-sequence.mmd", None, false, 40),
        "sample-sequence.md",
    );
    assert_golden(
        &mermaid_output("sample-sequence.mmd", None, true, 40),
        "sample-sequence.json",
    );
}

#[test]
fn mermaid_state_matches_python() {
    assert_golden(
        &mermaid_output("sample-state.mmd", None, false, 40),
        "sample-state.md",
    );
    assert_golden(
        &mermaid_output("sample-state.mmd", None, true, 40),
        "sample-state.json",
    );
}

#[test]
fn mermaid_er_matches_python() {
    assert_golden(
        &mermaid_output("sample-er.mmd", None, false, 40),
        "sample-er.md",
    );
    assert_golden(
        &mermaid_output("sample-er.mmd", None, true, 40),
        "sample-er.json",
    );
}

#[test]
fn mermaid_markdown_blocks_match_python() {
    assert_golden(
        &mermaid_output("sample-blocks.md", Some("all"), false, 40),
        "sample-blocks.md",
    );
    assert_golden(
        &mermaid_output("sample-blocks.md", Some("all"), true, 40),
        "sample-blocks.json",
    );
}

#[test]
fn mermaid_multiline_labels_match_python() {
    assert_golden(
        &mermaid_output("multiline-label.mmd", None, false, 40),
        "multiline-label.md",
    );
    assert_golden(
        &mermaid_output("multiline-label.mmd", None, true, 40),
        "multiline-label.json",
    );
}

#[test]
fn drawio_architecture_matches_python() {
    assert_golden(
        &drawio_output("sample-architecture.drawio", None, false, 40),
        "sample-architecture.md",
    );
    assert_golden(
        &drawio_output("sample-architecture.drawio", None, true, 40),
        "sample-architecture.json",
    );
}

#[test]
fn drawio_all_pages_match_python() {
    assert_golden(
        &drawio_output("sample-architecture.drawio", Some("all"), false, 40),
        "sample-architecture.all.md",
    );
    assert_golden(
        &drawio_output("sample-architecture.drawio", Some("all"), true, 40),
        "sample-architecture.all.json",
    );
}

#[test]
fn drawio_max_rows_truncation_matches_python() {
    assert_golden(
        &drawio_output("sample-architecture.drawio", None, false, 2),
        "sample-architecture.max2.md",
    );
}

#[test]
fn drawio_containers_match_python() {
    assert_golden(
        &drawio_output("compressed.drawio", None, false, 40),
        "compressed.md",
    );
    assert_golden(
        &drawio_output("compressed.drawio", None, true, 40),
        "compressed.json",
    );
    assert_golden(
        &drawio_output("bare-model.drawio", None, true, 40),
        "bare-model.json",
    );
    assert_golden(
        &drawio_output("text-chunk.drawio.png", None, true, 40),
        "text-chunk.json",
    );
    assert_golden(
        &drawio_output("ztxt-chunk.drawio.png", None, true, 40),
        "ztxt-chunk.json",
    );
    assert_golden(
        &drawio_output("embedded.drawio.svg", None, true, 40),
        "embedded-svg.json",
    );
}
