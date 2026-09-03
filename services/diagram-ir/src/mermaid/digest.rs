//! Markdown digest and JSON rendering for the Mermaid IR.
//!
//! `_escape_table` here is a plain `"\n"` replace, not the `str.splitlines()`
//! fold the draw.io digest uses, and everything else escapes through
//! `_escape_markdown` directly. The two are not interchangeable.

use serde_json::{json, Map, Value};

use crate::markdown::escape_markdown;
use crate::mermaid::analyse::analyse;
use crate::mermaid::model::Diagram;
use crate::pyfmt::{path_name, py_bool, repr_dict_str_int};
use crate::{Fail, Failable};

/// `_escape_table`.
pub fn escape_table(text: &str) -> String {
    escape_markdown(&text.replace('\n', " ⏎ "))
}

/// `digest`.
pub fn digest(path: &str, diagrams: &[Diagram], selected: &[&Diagram], max_rows: usize) -> String {
    let mut output: Vec<String> =
        vec![format!("# Mermaid IR — {}", path_name(path)), String::new()];
    let listing: Vec<String> = diagrams
        .iter()
        .map(|diagram| {
            format!(
                "[{}] {} ({}n/{}e)",
                diagram.index,
                diagram.kind,
                diagram.nodes.len(),
                diagram.edges.len()
            )
        })
        .collect();
    output.push(format!(
        "{} diagram(s): {}",
        diagrams.len(),
        listing.join(", ")
    ));

    for diagram in selected {
        let info = analyse(diagram);
        output.extend([
            String::new(),
            format!("## Diagram {} — {}", diagram.index, diagram.kind),
            String::new(),
            format!(
                "- source layout: none (Mermaid is layout-free); direction: {}",
                diagram.direction
            ),
            format!(
                "- nodes: {} total / {} drawable / {} containers, depth {}",
                info.nodes_total, info.nodes_drawable, info.containers, info.max_depth
            ),
            format!(
                "- edges: {} ({} labeled, {} dangling), cycle: {}",
                info.edges_total,
                info.edges_labeled,
                info.edges_dangling,
                py_bool(info.has_cycle)
            ),
            format!("- shapes: {}", repr_dict_str_int(&info.shape_pairs())),
            format!("- type candidates: {}", info.type_candidates.join(", ")),
            format!(
                "- budget: nodes {} (max 9), edges {} (max 12)",
                if info.over_node_budget { "OVER" } else { "ok" },
                if info.over_edge_budget { "OVER" } else { "ok" }
            ),
        ]);
        if diagram.discarded.style_directives != 0 || diagram.discarded.click_handlers != 0 {
            output.push(format!(
                "- discarded: {} style directives, {} click handlers",
                diagram.discarded.style_directives, diagram.discarded.click_handlers
            ));
        }
        if !diagram.fragments.is_empty() {
            let fragments: Vec<String> = diagram
                .fragments
                .iter()
                .map(|item| {
                    let label = if item.label.is_empty() {
                        "unlabeled"
                    } else {
                        &item.label
                    };
                    format!("{}({})", item.kind, escape_markdown(label))
                })
                .collect();
            output.push(format!("- fragments: {}", fragments.join(", ")));
        }
        if !diagram.notes.is_empty() {
            let notes: Vec<String> = diagram
                .notes
                .iter()
                .take(6)
                .map(|note| escape_markdown(note))
                .collect();
            output.push(format!("- notes: {}", notes.join("; ")));
        }
        if !info.hubs.is_empty() {
            let hubs: Vec<String> = info
                .hubs
                .iter()
                .map(|hub| format!("{}({})", escape_markdown(&hub.label), hub.degree))
                .collect();
            output.push(format!("- hubs (focal candidates): {}", hubs.join(", ")));
        }
        if !info.entry_points.is_empty() {
            output.push(format!("- entry points: {}", joined(&info.entry_points)));
        }
        if !info.terminals.is_empty() {
            output.push(format!("- terminals: {}", joined(&info.terminals)));
        }
        if !info.orphans.is_empty() {
            output.push(format!("- unconnected: {}", joined(&info.orphans)));
        }
        if !info.collapsible_groups.is_empty() {
            output.push("- collapsible groups (simplify here first):".to_string());
            for group in &info.collapsible_groups {
                output.push(format!(
                    "  - {} — {} children: {}",
                    escape_markdown(&group.label),
                    group.children,
                    joined(&group.child_labels)
                ));
            }
        }

        output.extend([
            String::new(),
            "### Nodes".to_string(),
            String::new(),
            "| id | label | shape | depth | parent | deg | fields |".to_string(),
            "|---|---|---|---|---|---|---|".to_string(),
        ]);
        for node in diagram.nodes.iter().take(max_rows) {
            let fields = escape_table(&node.fields.join("; "));
            output.push(format!(
                "| {} | {} | {} | {} | {} | {}/{} | {} |",
                escape_table(&node.id),
                escape_table(&node.label),
                node.shape,
                node.depth,
                node.parent.as_deref().unwrap_or("-"),
                node.in_degree,
                node.out_degree,
                if fields.is_empty() { "-" } else { &fields }
            ));
        }
        if diagram.nodes.len() > max_rows {
            output.push(format!(
                "| … | +{} more (use --json) | | | | | |",
                diagram.nodes.len() - max_rows
            ));
        }

        output.extend([
            String::new(),
            "### Edges".to_string(),
            String::new(),
            "| source | target | label | style |".to_string(),
            "|---|---|---|---|".to_string(),
        ]);
        let names: std::collections::HashMap<&str, &str> = diagram
            .nodes
            .iter()
            .map(|node| {
                (
                    node.id.as_str(),
                    node.label.split('\n').next().unwrap_or(""),
                )
            })
            .collect();
        for edge in diagram.edges.iter().take(max_rows) {
            let mut marks: Vec<&str> = vec![&edge.style, &edge.arrowhead];
            if edge.bidirectional {
                marks.push("bidir");
            }
            if edge.undirected {
                marks.push("undirected");
            }
            let label = escape_table(&edge.label);
            output.push(format!(
                "| {} | {} | {} | {} |",
                escape_table(
                    names
                        .get(edge.source.as_str())
                        .copied()
                        .unwrap_or(&edge.source)
                ),
                escape_table(
                    names
                        .get(edge.target.as_str())
                        .copied()
                        .unwrap_or(&edge.target)
                ),
                if label.is_empty() { "-" } else { &label },
                marks.join(" ")
            ));
        }
        if diagram.edges.len() > max_rows {
            output.push(format!(
                "| … | +{} more (use --json) | | |",
                diagram.edges.len() - max_rows
            ));
        }
    }
    output.push(String::new());
    output.join("\n")
}

fn joined(labels: &[String]) -> String {
    labels
        .iter()
        .map(|label| escape_markdown(label))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `to_json`.
pub fn to_json(path: &str, diagrams: &[Diagram], selected: &[&Diagram]) -> String {
    let mut payload = Map::new();
    payload.insert("source".to_string(), json!(crate::pyfmt::path_str(path)));
    payload.insert("diagrams_total".to_string(), json!(diagrams.len()));
    let rendered: Vec<Value> = selected
        .iter()
        .map(|diagram| {
            let mut entry = Map::new();
            entry.insert("index".to_string(), json!(diagram.index));
            entry.insert("kind".to_string(), json!(diagram.kind));
            entry.insert("source_line".to_string(), json!(diagram.source_line));
            entry.insert("direction".to_string(), json!(diagram.direction));
            entry.insert(
                "analysis".to_string(),
                serde_json::to_value(analyse(diagram)).expect("analysis serialises"),
            );
            entry.insert(
                "discarded".to_string(),
                serde_json::to_value(&diagram.discarded).expect("discarded serialises"),
            );
            entry.insert(
                "fragments".to_string(),
                serde_json::to_value(&diagram.fragments).expect("fragments serialise"),
            );
            entry.insert(
                "notes".to_string(),
                serde_json::to_value(&diagram.notes).expect("notes serialise"),
            );
            entry.insert(
                "nodes".to_string(),
                serde_json::to_value(&diagram.nodes).expect("nodes serialise"),
            );
            entry.insert(
                "edges".to_string(),
                serde_json::to_value(&diagram.edges).expect("edges serialise"),
            );
            Value::Object(entry)
        })
        .collect();
    payload.insert("diagrams".to_string(), Value::Array(rendered));
    serde_json::to_string_pretty(&Value::Object(payload)).expect("payload serialises")
}

/// `select_diagrams`.
pub fn select_diagrams<'a>(
    diagrams: &'a [Diagram],
    selector: Option<&str>,
) -> Failable<Vec<&'a Diagram>> {
    let Some(selector) = selector else {
        return Ok(diagrams.iter().take(1).collect());
    };
    if selector == "all" {
        return Ok(diagrams.iter().collect());
    }
    if !selector.is_empty() && selector.chars().all(|ch| ch.is_ascii_digit()) {
        let index: i64 = selector.parse().unwrap_or(-1);
        let selected: Vec<&Diagram> = diagrams
            .iter()
            .filter(|diagram| diagram.index == index)
            .collect();
        if selected.is_empty() {
            return Err(Fail::new(format!(
                "no diagram with index {} (have 0..{})",
                index,
                diagrams.len() as i64 - 1
            )));
        }
        return Ok(selected);
    }
    Err(Fail::new("--diagram must be an index or 'all'"))
}
