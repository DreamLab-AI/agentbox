//! Mermaid behaviour across all four supported grammars, the Markdown fence
//! extraction, and every refusal path.

mod common;

use common::{mermaid_error, mermaid_from_source, mermaid_one, mermaid_output};
use diagram_ir::mermaid::analyse::analyse;
use diagram_ir::mermaid::model::{Diagram, Edge, Node};
use diagram_ir::mermaid::shapes::{classify_shape, edge_operators, parse_node_expression};
use diagram_ir::mermaid::{MAX_EDGES, MAX_NODES};

fn node<'a>(diagram: &'a Diagram, id: &str) -> &'a Node {
    diagram
        .nodes
        .iter()
        .find(|node| node.id == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

fn edge<'a>(diagram: &'a Diagram, source: &str, target: &str) -> &'a Edge {
    diagram
        .edges
        .iter()
        .find(|edge| edge.source == source && edge.target == target)
        .unwrap_or_else(|| panic!("no edge {source} -> {target}"))
}

#[test]
fn flowchart_headers_set_the_kind_and_direction() {
    for (source, direction) in [
        ("flowchart LR\n A", "LR"),
        ("graph TD\n A", "TD"),
        ("FlowChart bt\n A", "BT"),
        ("graph  RL\n A", "RL"),
    ] {
        let diagram = mermaid_one(source);
        assert_eq!(diagram.kind, "flowchart");
        assert_eq!(diagram.direction, direction);
    }
    assert_eq!(mermaid_one("sequenceDiagram\n A->>B: x").direction, "LR");
    assert_eq!(mermaid_one("stateDiagram-v2\n [*] --> A").direction, "TD");
    assert_eq!(mermaid_one("erDiagram\n A ||--|| B : x").direction, "TD");
}

#[test]
fn every_classic_delimiter_maps_to_a_shape() {
    let cases = [
        ("A(((c)))", "circle"),
        ("A((c))", "circle"),
        ("A([c])", "stadium"),
        ("A{{c}}", "hexagon"),
        ("A[(c)]", "cylinder"),
        ("A[[c]]", "subroutine"),
        ("A[/c/]", "parallelogram"),
        ("A[\\c\\]", "parallelogram"),
        ("A[/c\\]", "trapezoid"),
        ("A[\\c/]", "trapezoid"),
        ("A[c]", "rect"),
        ("A(c)", "round"),
        ("A{c}", "rhombus"),
        ("A>c]", "asymmetric"),
    ];
    for (expression, shape) in cases {
        let (id, label, parsed) = parse_node_expression(expression)
            .unwrap_or_else(|| panic!("{expression} should parse"));
        assert_eq!(id, "A", "{expression}");
        assert_eq!(label, "c", "{expression}");
        assert_eq!(parsed, shape, "{expression}");
    }
    assert_eq!(classify_shape("[nope"), "rect");
}

#[test]
fn expanded_shape_attributes_are_normalised() {
    for (expression, label, shape) in [
        (r#"A@{ shape: rounded, label: "Start" }"#, "Start", "round"),
        (r#"A@{ shape: db, label: Store }"#, "Store", "cylinder"),
        (
            r#"A@{ shape: diam, label: "Choose?" }"#,
            "Choose?",
            "rhombus",
        ),
        (r#"A@{ shape: manual }"#, "A", "trapezoid"),
        (r#"A@{ label: "no shape" }"#, "no shape", "rect"),
        (
            r#"A@{ img: "https://example.invalid/x.png" }"#,
            "A",
            "image",
        ),
        (r#"A@{ icon: "aws:s3" }"#, "A", "icon"),
        (r#"A@{ shape: NOT A SHAPE }"#, "A", "rect"),
        (r#"A@{ shape: unknown-thing }"#, "A", "unknown-thing"),
    ] {
        let (_, parsed_label, parsed_shape) =
            parse_node_expression(expression).unwrap_or_else(|| panic!("{expression}"));
        assert_eq!(parsed_label, label, "{expression}");
        assert_eq!(parsed_shape, shape, "{expression}");
    }
}

#[test]
fn expanded_attributes_never_leak_image_or_icon_targets() {
    let diagram = mermaid_one(
        "flowchart TD\n  A@{ shape: image, img: \"https://example.invalid/logo.png\", w: 40 }\n",
    );
    let json =
        diagram_ir::mermaid::digest::to_json("x.mmd", std::slice::from_ref(&diagram), &[&diagram]);
    assert!(
        !json.contains("example.invalid"),
        "the image URL must not cross the trust boundary"
    );
}

#[test]
fn labelled_edges_parse_in_spaced_compact_and_piped_forms() {
    let diagram = mermaid_one(
        "flowchart LR\n  A-- yes -->B\n  B--no-->C\n  C-->|maybe|D\n  D-. retry .-> A\n  A== fast ==>C\n",
    );
    assert_eq!(edge(&diagram, "A", "B").label, "yes");
    assert_eq!(edge(&diagram, "B", "C").label, "no");
    assert_eq!(edge(&diagram, "C", "D").label, "maybe");
    assert_eq!(edge(&diagram, "D", "A").label, "retry");
    assert_eq!(edge(&diagram, "D", "A").style, "dashed");
    assert_eq!(edge(&diagram, "A", "C").label, "fast");
    assert_eq!(edge(&diagram, "A", "C").style, "thick");
}

#[test]
fn unlabelled_operators_keep_their_arrowheads() {
    let diagram = mermaid_one(
        "flowchart LR\n  A-->B\n  B---C\n  C--oD\n  D--xE\n  E<-->F\n  F-.->G\n  G===H\n",
    );
    let style = |source: &str, target: &str| {
        let edge = edge(&diagram, source, target);
        (
            edge.style.clone(),
            edge.arrowhead.clone(),
            edge.bidirectional,
            edge.undirected,
        )
    };
    assert_eq!(
        style("A", "B"),
        ("solid".into(), "arrow".into(), false, false)
    );
    assert_eq!(
        style("B", "C"),
        ("solid".into(), "arrow".into(), false, true)
    );
    assert_eq!(
        style("C", "D"),
        ("solid".into(), "circle".into(), false, false)
    );
    assert_eq!(
        style("D", "E"),
        ("solid".into(), "cross".into(), false, false)
    );
    assert_eq!(
        style("E", "F"),
        ("solid".into(), "arrow".into(), true, false)
    );
    assert_eq!(
        style("F", "G"),
        ("dashed".into(), "arrow".into(), false, false)
    );
    assert_eq!(
        style("G", "H"),
        ("thick".into(), "arrow".into(), false, true)
    );
}

#[test]
fn long_operators_stay_unlabelled() {
    let diagram = mermaid_one("flowchart LR\n  A----->B\n  C --o D --> E\n");
    assert_eq!(diagram.edges.len(), 3);
    assert_eq!(edge(&diagram, "A", "B").label, "");
    assert_eq!(edge(&diagram, "C", "D").arrowhead, "circle");
    assert_eq!(edge(&diagram, "D", "E").arrowhead, "arrow");
}

#[test]
fn ampersand_groups_and_chains_expand_to_every_pair() {
    let diagram = mermaid_one("flowchart LR\n  A & B --> C & D\n  X-->Y-->Z\n");
    assert_eq!(diagram.edges.len(), 6);
    for (source, target) in [("A", "C"), ("A", "D"), ("B", "C"), ("B", "D")] {
        edge(&diagram, source, target);
    }
    edge(&diagram, "X", "Y");
    edge(&diagram, "Y", "Z");
}

#[test]
fn subgraphs_nest_and_set_parents() {
    let diagram = mermaid_one(
        "flowchart TD\n  subgraph Outer[Outer zone]\n    subgraph Inner\n      A\n    end\n    B\n  end\n  C\n",
    );
    assert_eq!(node(&diagram, "Outer").label, "Outer zone");
    assert!(node(&diagram, "Outer").container);
    assert_eq!(node(&diagram, "Inner").parent.as_deref(), Some("Outer"));
    assert_eq!(node(&diagram, "Inner").depth, 1);
    assert_eq!(node(&diagram, "A").parent.as_deref(), Some("Inner"));
    assert_eq!(node(&diagram, "A").depth, 2);
    assert_eq!(node(&diagram, "B").parent.as_deref(), Some("Outer"));
    assert_eq!(node(&diagram, "C").parent, None);
    assert_eq!(analyse(&diagram).max_depth, 2);
}

#[test]
fn a_subgraph_title_that_is_not_an_expression_gets_a_generated_id() {
    let diagram = mermaid_one("flowchart TD\n  subgraph \"Two words here\"\n    A\n  end\n");
    assert_eq!(node(&diagram, "subgraph-1").label, "Two words here");
    assert!(node(&diagram, "subgraph-1").container);
}

#[test]
fn style_directives_and_click_handlers_are_counted_then_dropped() {
    let diagram = mermaid_one(
        "flowchart TD\n  A-->B\n  style A fill:#f9f\n  classDef hot fill:#f00\n  class A hot\n  linkStyle 0 stroke:#000\n  click A \"https://example.invalid\" _blank\n",
    );
    assert_eq!(diagram.discarded.style_directives, 4);
    assert_eq!(diagram.discarded.click_handlers, 1);
    let json =
        diagram_ir::mermaid::digest::to_json("x.mmd", std::slice::from_ref(&diagram), &[&diagram]);
    assert!(
        !json.contains("example.invalid"),
        "click targets never survive"
    );
}

#[test]
fn unsupported_kinds_name_the_supported_set() {
    for kind in [
        "pie",
        "mindmap",
        "gitGraph",
        "quadrantChart",
        "timeline",
        "C4Context",
        "sankey",
        "gantt",
        "journey",
        "classDiagram",
    ] {
        let error = mermaid_error(&format!("{kind} something\n"));
        assert_eq!(
            error,
            format!(
                "unsupported diagram kind: `{kind}` (supported: flowchart, sequenceDiagram, stateDiagram-v2, erDiagram)"
            )
        );
    }
    assert_eq!(
        mermaid_error("banana split\n"),
        "not a Mermaid file at line 1"
    );
    assert_eq!(mermaid_error("\n\n   \n"), "not a Mermaid file");
}

#[test]
fn malformed_edges_report_their_line() {
    assert_eq!(
        mermaid_error("flowchart TD\n  A -->\n"),
        "malformed edge at line 2"
    );
    assert_eq!(
        mermaid_error("erDiagram\n  weird--stuff\n"),
        "malformed edge at line 2"
    );
    assert_eq!(
        mermaid_error("erDiagram\n  A ||--o{ B C : x\n"),
        "malformed edge at line 2"
    );
    assert_eq!(
        mermaid_error("sequenceDiagram\n  A ->> : missing target\n"),
        "malformed edge at line 2"
    );
    assert_eq!(
        mermaid_error("sequenceDiagram\n  A--> B\n"),
        "malformed edge at line 2",
        "a flowchart arrow is not a sequence message"
    );
}

#[test]
fn the_node_limit_is_enforced() {
    let mut source = String::from("flowchart TD\n");
    for index in 0..(MAX_NODES + 5) {
        source.push_str(&format!("  n{index}\n"));
    }
    assert_eq!(
        mermaid_error(&source),
        format!("node limit exceeded (max {MAX_NODES})")
    );
}

#[test]
fn the_edge_limit_is_enforced() {
    // One statement, two groups: 71 x 71 pairs is over the 5000-edge cap.
    let group = |prefix: char| {
        (0..71)
            .map(|index| format!("{prefix}{index}"))
            .collect::<Vec<_>>()
            .join(" & ")
    };
    let source = format!("flowchart TD\n  {} --> {}\n", group('a'), group('b'));
    assert_eq!(
        mermaid_error(&source),
        format!("edge limit exceeded (max {MAX_EDGES})")
    );
}

#[test]
fn diagram_selection_reports_what_is_available() {
    use diagram_ir::mermaid::digest::select_diagrams;
    let diagrams = mermaid_from_source(
        "doc.md",
        "```mermaid\nflowchart LR\n A\n```\n```mermaid\nerDiagram\n A ||--|| B : x\n```\n",
    )
    .unwrap();
    assert_eq!(select_diagrams(&diagrams, None).unwrap().len(), 1);
    assert_eq!(select_diagrams(&diagrams, Some("all")).unwrap().len(), 2);
    assert_eq!(
        select_diagrams(&diagrams, Some("1")).unwrap()[0].kind,
        "erDiagram"
    );
    assert_eq!(
        select_diagrams(&diagrams, Some("9")).unwrap_err().0,
        "no diagram with index 9 (have 0..1)"
    );
    assert_eq!(
        select_diagrams(&diagrams, Some("first")).unwrap_err().0,
        "--diagram must be an index or 'all'"
    );
}

#[test]
fn digest_truncates_tables_at_max_rows() {
    let digest = mermaid_output("sample-flowchart.mmd", None, false, 3);
    assert!(digest.contains("| … | +7 more (use --json) | | | | | |"));
    assert!(digest.contains("| … | +5 more (use --json) | | |"));
}

#[test]
fn edge_operator_spans_cover_the_whole_link() {
    let operators = edge_operators("A-- yes -->B");
    assert_eq!(operators.len(), 1);
    assert_eq!(operators[0].label, "yes");
    assert_eq!(&"A-- yes -->B"[..operators[0].start], "A");
    assert_eq!(&"A-- yes -->B"[operators[0].end..], "B");
}

#[test]
fn analysis_classifies_flowcharts_by_their_shapes() {
    let with_decision = mermaid_one("flowchart TD\n  A --> B{Choose?}\n");
    assert_eq!(
        analyse(&with_decision).type_candidates,
        vec!["flowchart".to_string(), "architecture".to_string()]
    );
    let without = mermaid_one("flowchart TD\n  A --> B\n");
    assert_eq!(
        analyse(&without).type_candidates,
        vec!["architecture".to_string()],
        "the duplicate candidate collapses"
    );
    assert_eq!(
        analyse(&mermaid_one("sequenceDiagram\n  A->>B: x\n")).type_candidates,
        vec!["sequence".to_string()]
    );
    assert_eq!(
        analyse(&mermaid_one("stateDiagram-v2\n  A --> B\n")).type_candidates,
        vec!["state machine".to_string()]
    );
    assert_eq!(
        analyse(&mermaid_one("erDiagram\n  A ||--|| B : x\n")).type_candidates,
        vec!["ER / data model".to_string()]
    );
}

#[test]
fn analysis_reports_cycles_hubs_and_budgets() {
    let diagram = mermaid_one("flowchart LR\n  A-->B\n  B-->C\n  C-->A\n");
    let info = analyse(&diagram);
    assert!(info.has_cycle);
    assert_eq!(info.hubs.len(), 3);
    assert!(info.entry_points.is_empty());
    assert!(info.terminals.is_empty());
    assert!(!info.over_node_budget && !info.over_edge_budget);

    let wide = mermaid_one(&format!(
        "flowchart LR\n{}",
        (0..14)
            .map(|index| format!("  hub --> n{index}\n"))
            .collect::<String>()
    ));
    let info = analyse(&wide);
    assert!(info.over_node_budget && info.over_edge_budget);
    assert_eq!(info.hubs[0].id, "hub");
    assert_eq!(info.entry_points, vec!["hub".to_string()]);
    assert_eq!(info.terminals.len(), 6, "the list is capped at six");
}
