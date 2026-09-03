//! Mermaid lexing: fenced blocks, directives, statement joining and label
//! flattening.

mod common;

use common::{mermaid_error, mermaid_from_source, mermaid_one};
use diagram_ir::mermaid::lex::{
    check_suffix, clean_label, split_blocks, split_top_level, statement_complete,
    strip_class_suffix, top_level_mask,
};
use diagram_ir::mermaid::model::{Diagram, Node};

fn node<'a>(diagram: &'a Diagram, id: &str) -> &'a Node {
    diagram
        .nodes
        .iter()
        .find(|node| node.id == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

#[test]
fn frontmatter_and_init_directives_are_skipped() {
    let diagram = mermaid_one(
        "---\ntitle: Ignored\nconfig:\n  theme: dark\n---\n%%{init: {'theme':'forest'}}%%\n%% a comment\nflowchart LR\n  A-->B\n",
    );
    assert_eq!(diagram.kind, "flowchart");
    assert_eq!(diagram.nodes.len(), 2);
    let diagram = mermaid_one("%%{init: {\n 'theme':'forest'\n}}%%\nflowchart LR\n  A-->B\n");
    assert_eq!(
        diagram.nodes.len(),
        2,
        "a multi-line directive is skipped whole"
    );
}

#[test]
fn semicolons_split_statements_only_at_the_top_level() {
    let diagram = mermaid_one("flowchart LR\n  A-->B; B-->C;\n  D[\"has ; inside\"]\n");
    assert_eq!(diagram.edges.len(), 2);
    assert_eq!(node(&diagram, "D").label, "has ; inside");
    assert_eq!(
        split_top_level("a;b[\"x;y\"];c", ';'),
        vec!["a", "b[\"x;y\"]", "c"]
    );
}

#[test]
fn the_top_level_mask_blanks_quoted_and_bracketed_spans() {
    assert_eq!(top_level_mask("A[label]-->B"), "A       -->B");
    assert_eq!(top_level_mask("A[\"a-->b\"]-->B"), "A         -->B");
    assert!(statement_complete("A[\"closed\"]"));
    assert!(!statement_complete("A[\"open"));
    assert!(!statement_complete("A[open"));
}

#[test]
fn multiline_statements_are_joined_before_parsing() {
    let diagram = mermaid_one("flowchart TD\n  A[\"first\n  second\"] --> B\n");
    assert_eq!(node(&diagram, "A").label, "first\nsecond");
    assert_eq!(diagram.edges.len(), 1);
    assert_eq!(
        mermaid_error("flowchart TD\n  A[\"never closed\n"),
        "unterminated statement at line 2"
    );
}

#[test]
fn labels_are_flattened_without_being_interpreted() {
    assert_eq!(clean_label("\"quoted\""), "quoted");
    assert_eq!(clean_label("`ticks`"), "ticks");
    assert_eq!(clean_label("a<br/>b"), "a\nb");
    assert_eq!(clean_label("<b>bold</b>"), "bold");
    assert_eq!(clean_label("**strong**"), "strong");
    assert_eq!(clean_label("__under__"), "under");
    assert_eq!(clean_label("*emph*"), "emph");
    assert_eq!(clean_label("snake_case_stays"), "snake_case_stays");
    assert_eq!(clean_label("#quot;q#quot;"), "\"q\"");
    assert_eq!(
        clean_label("&amp; &#65; &nbsp;"),
        "& A",
        "the trailing non-breaking space is whitespace to Python's strip too"
    );
    assert_eq!(clean_label("say \\\"hi\\\""), "say \"hi\"");
}

#[test]
fn inline_class_attachments_are_stripped_from_ids() {
    assert_eq!(strip_class_suffix("A[Label]:::hot"), "A[Label]");
    assert_eq!(strip_class_suffix("A:::hot-class"), "A");
    assert_eq!(
        strip_class_suffix("A[\"has ::: inside\"]"),
        "A[\"has ::: inside\"]"
    );
    let diagram = mermaid_one("flowchart TD\n  A[Alpha]:::hot --> B:::cold\n");
    assert_eq!(node(&diagram, "A").label, "Alpha");
    assert_eq!(node(&diagram, "B").label, "B");
}

#[test]
fn markdown_fences_are_extracted_for_both_markers() {
    let source = "# Title\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\ntext\n\n~~~mermaid\nerDiagram\n  A ||--|| B : x\n~~~\n";
    let diagrams = mermaid_from_source("doc.md", source).expect("two blocks");
    assert_eq!(diagrams.len(), 2);
    assert_eq!(diagrams[0].kind, "flowchart");
    assert_eq!(diagrams[0].source_line, 4);
    assert_eq!(diagrams[1].kind, "erDiagram");
    assert_eq!(diagrams[1].source_line, 11);
}

#[test]
fn fence_errors_are_reported_verbatim() {
    let error = split_blocks("doc.md", "# x\n\n```mermaid\nflowchart LR\n  A-->B\n").unwrap_err();
    assert_eq!(
        error.0,
        "doc.md: unterminated mermaid fence starting at line 3"
    );
    let error = split_blocks("doc.md", "# x\n\nnothing here\n").unwrap_err();
    assert_eq!(error.0, "doc.md: no fenced mermaid block found");
}

#[test]
fn only_mermaid_and_markdown_suffixes_are_accepted() {
    assert!(check_suffix("a.mmd").is_ok());
    assert!(check_suffix("a.MERMAID").is_ok());
    assert!(check_suffix("dir/a.markdown").is_ok());
    assert_eq!(
        check_suffix("dir/a.txt").unwrap_err().0,
        "a.txt: not a Mermaid file"
    );
}
