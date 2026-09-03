//! `stateDiagram-v2` parsing.

use regex::Regex;
use std::sync::OnceLock;

use crate::mermaid::flowchart::discard_nonsemantic;
use crate::mermaid::lex::{clean_label, strip_class_suffix};
use crate::mermaid::model::Diagram;
use crate::mermaid::shapes::parse_node_expression;
use crate::pyfmt::strip;
use crate::{Fail, Failable};

fn direction_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^direction\s+(TD|TB|LR|RL|BT)$").unwrap())
}

fn composite_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^state\s+([\w.:-]+)\s*\{$").unwrap())
}

fn alias_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)^state\s+"(.*?)"\s+as\s+([\w.:-]+)$"#).unwrap())
}

fn stereotype_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^state\s+([\w.:-]+)\s+<<(fork|join|choice)>>$").unwrap())
}

fn description_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([A-Za-z_][\w.-]*)\s*:\s*(.+)$").unwrap())
}

fn plain_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^state\s+([\w.:-]+)$").unwrap())
}

/// `re.search(r"(?<!:):(?!:)", text)` — a single colon that is not part of a
/// `::` run. Returned as a byte offset; `:` is ASCII, so the scan is safe.
fn lone_colon(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    (0..bytes.len()).find(|index| {
        bytes[*index] == b':'
            && (*index == 0 || bytes[index - 1] != b':')
            && (index + 1 == bytes.len() || bytes[index + 1] != b':')
    })
}

/// `_state_endpoint` — `[*]` synthesises a fresh pseudo-state each time.
fn state_endpoint(
    diagram: &mut Diagram,
    token: &str,
    source_role: bool,
    parent: Option<&str>,
) -> Failable<Option<String>> {
    let value = strip_class_suffix(strip(token));
    if value == "[*]" {
        let prefix = if source_role { "start" } else { "end" };
        let marker = format!("__{prefix}");
        let count = diagram
            .nodes
            .iter()
            .filter(|node| node.id.starts_with(&marker))
            .count();
        let node_id = format!("__{}_{}", prefix, count + 1);
        diagram.add_node(&node_id, &format!("[{prefix}]"), prefix, parent, false)?;
        return Ok(Some(node_id));
    }
    let Some((node_id, label, shape)) = parse_node_expression(&value) else {
        return Ok(None);
    };
    let shape = if shape == "rect" {
        "state"
    } else {
        shape.as_str()
    };
    diagram.add_node(&node_id, &label, shape, parent, false)?;
    Ok(Some(node_id))
}

/// `_parse_state`.
pub fn parse(
    diagram: &mut Diagram,
    lines: &[(i64, String)],
    header_position: usize,
) -> Failable<()> {
    let mut containers: Vec<String> = Vec::new();
    for (line_number, raw) in &lines[header_position + 1..] {
        let text = strip(raw).to_string();
        if text.is_empty() {
            continue;
        }
        if discard_nonsemantic(diagram, &text) {
            continue;
        }
        if text == "}" {
            containers.pop();
            continue;
        }
        let parent = containers.last().cloned();
        if let Some(captures) = direction_re().captures(&text) {
            if containers.is_empty() {
                diagram.direction = captures[1].to_uppercase();
                continue;
            }
        }
        if let Some(captures) = composite_re().captures(&text) {
            let node_id = captures[1].to_string();
            diagram.add_node(&node_id, &node_id, "container", parent.as_deref(), true)?;
            containers.push(node_id);
            continue;
        }
        if let Some(captures) = alias_re().captures(&text) {
            diagram.add_node(
                &captures[2],
                &clean_label(&captures[1]),
                "state",
                parent.as_deref(),
                false,
            )?;
            continue;
        }
        if let Some(captures) = stereotype_re().captures(&text) {
            let node_id = captures[1].to_string();
            let stereotype = captures[2].to_lowercase();
            diagram.add_node(&node_id, &node_id, &stereotype, parent.as_deref(), false)?;
            continue;
        }
        if text.contains("-->") {
            let (source_text, target_text) = text.split_once("-->").expect("contains checked");
            let mut target_text = target_text.to_string();
            let mut label = String::new();
            if let Some(index) = lone_colon(&target_text) {
                label = target_text[index + 1..].to_string();
                target_text = target_text[..index].to_string();
            }
            let source = state_endpoint(diagram, source_text, true, parent.as_deref())?;
            let target = state_endpoint(diagram, &target_text, false, parent.as_deref())?;
            let (Some(source), Some(target)) = (source, target) else {
                return Err(Fail::new(format!("malformed edge at line {line_number}")));
            };
            diagram.add_plain_edge(&source, &target, &clean_label(&label))?;
            continue;
        }
        if let Some(captures) = description_re().captures(&text) {
            diagram.add_node(
                &captures[1],
                &clean_label(&captures[2]),
                "state",
                parent.as_deref(),
                false,
            )?;
            continue;
        }
        if let Some(captures) = plain_re().captures(&text) {
            let node_id = captures[1].to_string();
            diagram.add_node(&node_id, &node_id, "state", parent.as_deref(), false)?;
        }
    }
    Ok(())
}
