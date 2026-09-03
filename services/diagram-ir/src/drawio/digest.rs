//! Markdown digest and JSON rendering for the draw.io IR.
//!
//! The two escaping helpers here are deliberately different from the Mermaid
//! ones: draw.io folds newlines through `str.splitlines()` — `" · "` inline and
//! `" ⏎ "` in tables — where Mermaid does a plain `"\n"` replace.

use serde_json::{json, Map, Value};

use crate::drawio::analyse::{analyse, page_bounds};
use crate::drawio::model::Page;
use crate::markdown::escape_markdown;
use crate::pyfmt::{path_name, py_bool, repr_dict_str_int, splitlines};
use crate::{Fail, Failable};

fn fold_lines(text: &str, replacement: &str) -> String {
    splitlines(text).join(replacement)
}

/// `_escape_inline`.
pub fn escape_inline(text: &str) -> String {
    escape_markdown(&fold_lines(text, " · "))
}

/// `_escape_table`.
pub fn escape_table(text: &str) -> String {
    escape_markdown(&fold_lines(text, " ⏎ "))
}

/// `digest`.
pub fn digest(path: &str, pages: &[Page], selected: &[Page], max_rows: usize) -> String {
    let mut out: Vec<String> = Vec::new();
    out.push(format!(
        "# draw.io IR — {}",
        escape_inline(&path_name(path))
    ));
    out.push(String::new());
    let listing: Vec<String> = pages
        .iter()
        .map(|page| {
            format!(
                "[{}] {} ({}n/{}e)",
                page.index,
                escape_inline(&page.name),
                page.nodes.len(),
                page.edges.len()
            )
        })
        .collect();
    out.push(format!("{} page(s): {}", pages.len(), listing.join(", ")));

    for page in selected {
        let info = analyse(page);
        let (x0, y0, x1, y1) = page_bounds(page);
        out.push(String::new());
        out.push(format!(
            "## Page {} — {}",
            page.index,
            escape_inline(&page.name)
        ));
        out.push(String::new());
        out.push(if y1 > y0 {
            format!(
                "- source canvas: {}×{} px (aspect {:.2})",
                (x1 - x0) as i64,
                (y1 - y0) as i64,
                (x1 - x0) / (y1 - y0)
            )
        } else {
            "- source canvas: empty".to_string()
        });
        out.push(format!(
            "- nodes: {} total / {} drawable / {} containers, depth {}",
            info.nodes_total, info.nodes_drawable, info.containers, info.max_depth
        ));
        out.push(format!(
            "- edges: {} ({} labeled, {} dangling), cycle: {}",
            info.edges_total,
            info.edges_labeled,
            info.edges_dangling,
            py_bool(info.has_cycle)
        ));
        out.push(format!(
            "- shapes: {}",
            repr_dict_str_int(&info.shape_pairs())
        ));
        out.push(format!(
            "- type candidates: {}",
            info.type_candidates.join(", ")
        ));
        out.push(format!(
            "- budget: nodes {} (max 9), edges {} (max 12)",
            if info.over_node_budget { "OVER" } else { "ok" },
            if info.over_edge_budget { "OVER" } else { "ok" }
        ));
        if !info.hubs.is_empty() {
            let hubs: Vec<String> = info
                .hubs
                .iter()
                .map(|hub| {
                    let label = if hub.label.is_empty() {
                        &hub.id
                    } else {
                        &hub.label
                    };
                    format!("{}({})", escape_inline(label), hub.degree)
                })
                .collect();
            out.push(format!("- hubs (focal candidates): {}", hubs.join(", ")));
        }
        if !info.entry_points.is_empty() {
            out.push(format!(
                "- entry points: {}",
                joined_inline(&info.entry_points)
            ));
        }
        if !info.terminals.is_empty() {
            out.push(format!("- terminals: {}", joined_inline(&info.terminals)));
        }
        if !info.orphans.is_empty() {
            out.push(format!("- unconnected: {}", joined_inline(&info.orphans)));
        }
        if !info.collapsible_groups.is_empty() {
            out.push("- collapsible groups (simplify here first):".to_string());
            for group in &info.collapsible_groups {
                out.push(format!(
                    "  - {} — {} children: {}",
                    escape_inline(&group.label),
                    group.children,
                    joined_inline(&group.child_labels)
                ));
            }
        }

        out.push(String::new());
        out.push("### Nodes".to_string());
        out.push(String::new());
        out.push("| id | label | shape | depth | parent | deg | box |".to_string());
        out.push("|---|---|---|---|---|---|---|".to_string());
        let listed: Vec<&crate::drawio::model::Node> = page
            .nodes
            .iter()
            .filter(|node| !node.label.is_empty() || !node.children.is_empty())
            .collect();
        for node in listed.iter().take(max_rows) {
            out.push(format!(
                "| {} | {} | {} | {} | {} | {}/{} | {},{} {}×{} |",
                escape_table(&node.id),
                escape_table(&node.label),
                escape_table(&node.shape),
                node.depth,
                escape_table(node.parent.as_deref().unwrap_or("-")),
                node.in_degree,
                node.out_degree,
                node.x as i64,
                node.y as i64,
                node.w as i64,
                node.h as i64
            ));
        }
        if listed.len() > max_rows {
            out.push(format!(
                "| … | +{} more (use --json) | | | | | |",
                listed.len() - max_rows
            ));
        }

        out.push(String::new());
        out.push("### Edges".to_string());
        out.push(String::new());
        out.push("| source | target | label | style |".to_string());
        out.push("|---|---|---|---|".to_string());
        let names: std::collections::HashMap<&str, String> = page
            .nodes
            .iter()
            .map(|node| {
                let first = node.label.split('\n').next().unwrap_or("");
                let name = if first.is_empty() {
                    node.id.clone()
                } else {
                    first.to_string()
                };
                (node.id.as_str(), name)
            })
            .collect();
        for edge in page.edges.iter().take(max_rows) {
            let mut marks: Vec<&str> = Vec::new();
            if edge.dashed {
                marks.push("dashed");
            }
            if edge.bidirectional {
                marks.push("bidir");
            }
            if edge.undirected {
                marks.push("undirected");
            }
            let lookup = |id: Option<&str>| -> String {
                names
                    .get(id.unwrap_or(""))
                    .cloned()
                    .unwrap_or_else(|| "?".to_string())
            };
            let label = escape_table(&edge.label);
            out.push(format!(
                "| {} | {} | {} | {} |",
                escape_table(&lookup(edge.source.as_deref())),
                escape_table(&lookup(edge.target.as_deref())),
                if label.is_empty() {
                    "-".to_string()
                } else {
                    label
                },
                if marks.is_empty() {
                    "-".to_string()
                } else {
                    marks.join(" ")
                }
            ));
        }
        if page.edges.len() > max_rows {
            out.push(format!(
                "| … | +{} more (use --json) | | |",
                page.edges.len() - max_rows
            ));
        }
    }
    out.push(String::new());
    out.join("\n")
}

fn joined_inline(labels: &[String]) -> String {
    labels
        .iter()
        .map(|label| escape_inline(label))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `to_json`.
pub fn to_json(path: &str, pages: &[Page], selected: &[Page]) -> String {
    let mut payload = Map::new();
    payload.insert("source".to_string(), json!(crate::pyfmt::path_str(path)));
    payload.insert("pages_total".to_string(), json!(pages.len()));
    let rendered: Vec<Value> = selected
        .iter()
        .map(|page| {
            let (x0, y0, x1, y1) = page_bounds(page);
            let mut bounds = Map::new();
            bounds.insert("x0".to_string(), json!(x0));
            bounds.insert("y0".to_string(), json!(y0));
            bounds.insert("x1".to_string(), json!(x1));
            bounds.insert("y1".to_string(), json!(y1));
            let mut entry = Map::new();
            entry.insert("id".to_string(), json!(page.id));
            entry.insert("name".to_string(), json!(page.name));
            entry.insert("index".to_string(), json!(page.index));
            entry.insert("bounds".to_string(), Value::Object(bounds));
            entry.insert(
                "analysis".to_string(),
                serde_json::to_value(analyse(page)).expect("analysis serialises"),
            );
            entry.insert(
                "nodes".to_string(),
                serde_json::to_value(&page.nodes).expect("nodes serialise"),
            );
            entry.insert(
                "edges".to_string(),
                serde_json::to_value(&page.edges).expect("edges serialise"),
            );
            Value::Object(entry)
        })
        .collect();
    payload.insert("pages".to_string(), Value::Array(rendered));
    serde_json::to_string_pretty(&Value::Object(payload)).expect("payload serialises")
}

/// `select_pages`.
pub fn select_pages<'a>(pages: &'a [Page], selector: Option<&str>) -> Failable<Vec<&'a Page>> {
    let Some(selector) = selector else {
        return Ok(pages.iter().take(1).collect());
    };
    if selector == "all" {
        return Ok(pages.iter().collect());
    }
    if !selector.is_empty() && selector.chars().all(|ch| ch.is_ascii_digit()) {
        let index: i64 = selector.parse().unwrap_or(-1);
        let matched: Vec<&Page> = pages.iter().filter(|page| page.index == index).collect();
        if matched.is_empty() {
            return Err(Fail::new(format!(
                "no page with index {} (have 0..{})",
                index,
                pages.len() as i64 - 1
            )));
        }
        return Ok(matched);
    }
    let lowered = selector.to_lowercase();
    let matched: Vec<&Page> = pages
        .iter()
        .filter(|page| page.name.to_lowercase() == lowered)
        .collect();
    if matched.is_empty() {
        let names: Vec<&str> = pages.iter().map(|page| page.name.as_str()).collect();
        return Err(Fail::new(format!(
            "no page named {} (have: {})",
            crate::pyfmt::repr_str(selector),
            names.join(", ")
        )));
    }
    Ok(matched)
}
