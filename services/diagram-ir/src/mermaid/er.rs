//! `erDiagram` parsing.

use regex::Regex;
use std::sync::OnceLock;

use crate::mermaid::flowchart::discard_nonsemantic;
use crate::mermaid::lex::clean_label;
use crate::mermaid::model::Diagram;
use crate::pyfmt::strip;
use crate::{Fail, Failable};

fn direction_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^direction\s+(TD|TB|LR|RL|BT)$").unwrap())
}

fn entity_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([A-Za-z_][\w.-]*)\s*\{$").unwrap())
}

fn relationship_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^([A-Za-z_][\w.-]*)\s+(\S*(?:--|\.\.)\S*)\s+([A-Za-z_][\w.-]*)\s*(?::\s*(.*))?$",
        )
        .unwrap()
    })
}

/// `_parse_er`.
pub fn parse(
    diagram: &mut Diagram,
    lines: &[(i64, String)],
    header_position: usize,
) -> Failable<()> {
    let mut current: Option<usize> = None;
    for (line_number, raw) in &lines[header_position + 1..] {
        let text = strip(raw).to_string();
        if text.is_empty() {
            continue;
        }
        if discard_nonsemantic(diagram, &text) {
            continue;
        }
        if text == "}" {
            current = None;
            continue;
        }
        if let Some(captures) = direction_re().captures(&text) {
            if current.is_none() {
                diagram.direction = captures[1].to_uppercase();
                continue;
            }
        }
        if let Some(captures) = entity_re().captures(&text) {
            let name = captures[1].to_string();
            current = Some(diagram.add_node(&name, &name, "table", None, false)?);
            continue;
        }
        if let Some(index) = current {
            diagram.nodes[index].fields.push(clean_label(&text));
            continue;
        }
        if let Some(captures) = relationship_re().captures(&text) {
            let source = captures[1].to_string();
            let cardinality = captures[2].to_string();
            let target = captures[3].to_string();
            let relationship_label = captures.get(4).map(|group| group.as_str().to_string());
            diagram.add_node(&source, &source, "table", None, false)?;
            diagram.add_node(&target, &target, "table", None, false)?;
            let (left, separator, right) = match cardinality.split_once("--") {
                Some((left, right)) => (left.to_string(), "--".to_string(), right.to_string()),
                None => match cardinality.split_once("..") {
                    Some((left, right)) => (left.to_string(), "..".to_string(), right.to_string()),
                    None => (cardinality.clone(), String::new(), String::new()),
                },
            };
            let mut label_parts = vec![strip(&format!("{left} {separator} {right}")).to_string()];
            // An empty trailing `: ` group is falsy in the Python and is not
            // appended.
            if let Some(relationship_label) = relationship_label.filter(|value| !value.is_empty()) {
                label_parts.push(clean_label(&relationship_label));
            }
            let style = if separator == ".." { "dashed" } else { "solid" };
            diagram.add_edge(
                &source,
                &target,
                &label_parts.join(" · "),
                style,
                "cardinality",
                false,
                true,
            )?;
            continue;
        }
        if text.contains("--") || text.contains("..") {
            return Err(Fail::new(format!("malformed edge at line {line_number}")));
        }
    }
    Ok(())
}
