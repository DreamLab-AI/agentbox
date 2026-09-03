//! Sequence, state and ER grammar coverage.

mod common;

use common::mermaid_one;
use diagram_ir::mermaid::model::{Diagram, Edge, Node};

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
fn sequence_participants_keep_declared_names_and_shapes() {
    let diagram = mermaid_one(
        "sequenceDiagram\n  participant \"Alice Smith\" as A\n  actor B as Bob\n  create participant C\n  A->>B: hi\n  A->>C: hi\n",
    );
    assert_eq!(node(&diagram, "A").label, "Alice Smith");
    assert_eq!(node(&diagram, "A").shape, "lifeline");
    assert_eq!(node(&diagram, "B").label, "Bob");
    assert_eq!(node(&diagram, "B").shape, "actor");
    assert_eq!(node(&diagram, "C").label, "C");
}

#[test]
fn sequence_arrowheads_and_styles_are_classified() {
    let diagram = mermaid_one(
        "sequenceDiagram\n  A->B: open\n  A-->>B: dashed reply\n  A-)B: async\n  A--xB: cancel\n  A<<->>B: both\n",
    );
    let by_label = |label: &str| {
        diagram
            .edges
            .iter()
            .find(|edge| edge.label == label)
            .unwrap_or_else(|| panic!("no edge labelled {label}"))
    };
    assert_eq!(by_label("open").arrowhead, "none");
    assert!(by_label("open").undirected);
    assert_eq!(by_label("dashed reply").arrowhead, "arrow");
    assert_eq!(by_label("dashed reply").style, "dashed");
    assert_eq!(by_label("async").arrowhead, "async");
    assert_eq!(by_label("cancel").arrowhead, "cross");
    assert!(by_label("both").bidirectional);
}

#[test]
fn sequence_fragments_notes_and_activation_are_handled() {
    let diagram = mermaid_one(
        "sequenceDiagram\n  A->>B: go\n  activate B\n  deactivate B\n  Note over A,B: a note\n  alt happy\n    A->>B: yes\n  else sad\n    A->>B: no\n  end\n  par first\n    A->>B: p\n  and second\n    A->>B: q\n  end\n",
    );
    assert_eq!(diagram.notes, vec!["a note".to_string()]);
    assert_eq!(diagram.fragments.len(), 2);
    assert_eq!(diagram.fragments[0].kind, "alt");
    assert_eq!(diagram.fragments[0].label, "happy");
    assert_eq!(diagram.fragments[0].depth, 0);
    assert_eq!(diagram.fragments[0].regions, vec!["sad".to_string()]);
    assert_eq!(diagram.fragments[1].kind, "par");
    assert_eq!(diagram.fragments[1].regions, vec!["second".to_string()]);
    assert_eq!(diagram.edges.len(), 5, "activation lines add no edges");
}

#[test]
fn state_start_and_end_markers_synthesise_pseudo_states() {
    let diagram = mermaid_one("stateDiagram-v2\n  [*] --> A\n  A --> [*]\n  [*] --> B\n");
    assert_eq!(node(&diagram, "__start_1").shape, "start");
    assert_eq!(node(&diagram, "__start_1").label, "[start]");
    assert_eq!(node(&diagram, "__start_2").shape, "start");
    assert_eq!(node(&diagram, "__end_1").shape, "end");
}

#[test]
fn state_composites_aliases_stereotypes_and_descriptions() {
    let diagram = mermaid_one(
        "stateDiagram-v2\n  state \"Waiting here\" as Idle\n  state Running {\n    Working --> Paused : pause\n  }\n  state pick <<choice>>\n  Idle : idle description\n  state Lonely\n  Idle --> Running : start\n",
    );
    assert_eq!(node(&diagram, "Idle").label, "idle description");
    assert!(node(&diagram, "Running").container);
    assert_eq!(node(&diagram, "Working").parent.as_deref(), Some("Running"));
    assert_eq!(edge(&diagram, "Working", "Paused").label, "pause");
    assert_eq!(node(&diagram, "pick").shape, "choice");
    assert_eq!(node(&diagram, "Lonely").shape, "state");
    assert_eq!(edge(&diagram, "Idle", "Running").label, "start");
}

#[test]
fn state_transition_labels_ignore_double_colons() {
    let diagram = mermaid_one("stateDiagram-v2\n  A --> B:::hot : guarded\n");
    assert_eq!(edge(&diagram, "A", "B").label, "guarded");
}

#[test]
fn er_entities_carry_fields_and_cardinality() {
    let diagram = mermaid_one(
        "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER }|..|{ ADDRESS : uses\n  CUSTOMER {\n    string name\n    int age\n  }\n",
    );
    assert_eq!(
        node(&diagram, "CUSTOMER").fields,
        vec!["string name", "int age"]
    );
    assert_eq!(node(&diagram, "CUSTOMER").shape, "table");
    let places = edge(&diagram, "CUSTOMER", "ORDER");
    assert_eq!(places.label, "|| -- o{ · places");
    assert_eq!(places.style, "solid");
    assert_eq!(places.arrowhead, "cardinality");
    assert!(places.undirected);
    assert_eq!(edge(&diagram, "CUSTOMER", "ADDRESS").style, "dashed");
}
