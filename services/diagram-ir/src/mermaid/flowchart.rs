//! `flowchart` / `graph` parsing.

use regex::Regex;
use std::sync::OnceLock;

use crate::mermaid::lex::{clean_label, logical_statements, split_top_level, top_level_mask};
use crate::mermaid::model::Diagram;
use crate::mermaid::shapes::{edge_operators, parse_node_expression};
use crate::pyfmt::strip;
use crate::{Fail, Failable};

const STYLE_DIRECTIVES: &[&str] = &["style ", "classdef ", "class ", "linkstyle "];
const DIRECTIONS: &[&str] = &["TD", "TB", "LR", "RL", "BT"];

/// `_discard_nonsemantic` — styling and click targets are counted, then dropped.
pub fn discard_nonsemantic(diagram: &mut Diagram, text: &str) -> bool {
    let lowered = text.to_lowercase();
    if STYLE_DIRECTIVES
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
    {
        diagram.discarded.style_directives += 1;
        return true;
    }
    if lowered.starts_with("click ") {
        diagram.discarded.click_handlers += 1;
        return true;
    }
    false
}

fn malformed_edge_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:--|==|-.).*?(?:>|x|o|-)").unwrap())
}

/// `_endpoint_group` — nodes are registered as the group is read, exactly as
/// the Python list comprehension does, even when a later segment fails.
fn endpoint_group(
    diagram: &mut Diagram,
    text: &str,
    parent: Option<&str>,
) -> Failable<Option<Vec<String>>> {
    let mut identifiers: Vec<String> = Vec::new();
    for raw in split_top_level(strip(text), '&') {
        let Some((node_id, label, shape)) = parse_node_expression(&raw) else {
            return Ok(None);
        };
        diagram.add_node(&node_id, &label, &shape, parent, false)?;
        identifiers.push(node_id);
    }
    Ok(if identifiers.is_empty() {
        None
    } else {
        Some(identifiers)
    })
}

/// `_parse_flowchart`.
pub fn parse(
    diagram: &mut Diagram,
    lines: &[(i64, String)],
    header_position: usize,
) -> Failable<()> {
    let mut containers: Vec<String> = Vec::new();
    for (line_number, raw) in logical_statements(&lines[header_position + 1..])? {
        let text = strip(&raw).to_string();
        if text.is_empty() {
            continue;
        }
        let lowered = text.to_lowercase();
        if discard_nonsemantic(diagram, &text) {
            continue;
        }
        if lowered.starts_with("direction ") {
            if containers.is_empty() {
                let direction = strip(split_once_whitespace(&text)).to_uppercase();
                if DIRECTIONS.contains(&direction.as_str()) {
                    diagram.direction = direction;
                }
            }
            continue;
        }
        if lowered.starts_with("subgraph ") {
            let spec = strip(split_once_whitespace(&text)).to_string();
            let (node_id, label) = match parse_node_expression(&spec) {
                Some((node_id, label, _shape)) => (node_id, label),
                None => {
                    let generated = format!(
                        "subgraph-{}",
                        diagram.nodes.iter().filter(|node| node.container).count() + 1
                    );
                    (generated, clean_label(&spec))
                }
            };
            let parent = containers.last().cloned();
            diagram.add_node(&node_id, &label, "container", parent.as_deref(), true)?;
            containers.push(node_id);
            continue;
        }
        if lowered == "end" {
            containers.pop();
            continue;
        }

        let operators = edge_operators(&text);
        let parent = containers.last().cloned();
        if !operators.is_empty() {
            let chars: Vec<char> = text.chars().collect();
            let mut segments: Vec<String> = Vec::new();
            let mut cursor = 0usize;
            for operator in &operators {
                segments.push(
                    chars[cursor.min(chars.len())..operator.start.min(chars.len())]
                        .iter()
                        .collect(),
                );
                cursor = operator.end;
            }
            segments.push(chars[cursor.min(chars.len())..].iter().collect());
            if segments.len() != operators.len() + 1 {
                return Err(Fail::new(format!("malformed edge at line {line_number}")));
            }
            let mut groups: Vec<Option<Vec<String>>> = Vec::new();
            for segment in &segments {
                groups.push(endpoint_group(diagram, segment, parent.as_deref())?);
            }
            if groups.iter().any(Option::is_none) {
                return Err(Fail::new(format!("malformed edge at line {line_number}")));
            }
            let valid: Vec<&Vec<String>> = groups.iter().flatten().collect();
            for (index, operator) in operators.iter().enumerate() {
                for source in valid[index] {
                    for target in valid[index + 1] {
                        diagram.add_edge(
                            source,
                            target,
                            &operator.label,
                            &operator.style,
                            &operator.arrowhead,
                            operator.bidirectional,
                            operator.undirected,
                        )?;
                    }
                }
            }
            continue;
        }
        if malformed_edge_re().is_match(&top_level_mask(&text)) {
            return Err(Fail::new(format!("malformed edge at line {line_number}")));
        }
        if let Some((node_id, label, shape)) = parse_node_expression(&text) {
            diagram.add_node(&node_id, &label, &shape, parent.as_deref(), false)?;
        }
    }
    Ok(())
}

/// `text.split(maxsplit=1)[1]` with the IndexError case folded to an empty
/// remainder rather than a traceback.
fn split_once_whitespace(text: &str) -> &str {
    match text.find(char::is_whitespace) {
        Some(index) => text[index..].trim_start_matches(char::is_whitespace),
        None => "",
    }
}
