//! `sequenceDiagram` parsing.

use regex::Regex;
use std::sync::OnceLock;

use crate::mermaid::flowchart::discard_nonsemantic;
use crate::mermaid::lex::clean_label;
use crate::mermaid::model::{Diagram, Fragment};
use crate::pyfmt::strip;
use crate::{Fail, Failable};

fn participant_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)^(?:create\s+)?(participant|actor)\s+(?:"([^"]+)"|'([^']+)'|([\w.:-]+))(?:\s+as\s+(.+))?$"#,
        )
        .unwrap()
    })
}

fn message_re() -> &'static Regex {
    // Endpoints may be bare ids or multi-word names introduced by a quoted
    // `participant "Alice Smith"` declaration; the lazy id keeps `A-->>B` from
    // swallowing dashes into the source.
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^([\w.:-]+?(?: [\w.:-]+)*?)(?:\(\))?\s*(<<--?>>|--?>>|--?>|--?\)|--?x)\s*[+-]?\s*(?:\(\))?([\w.:-]+?(?: [\w.:-]+)*?)\s*:\s*(.*)$",
        )
        .unwrap()
    })
}

fn fragment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(alt|opt|loop|par|critical|break)\b\s*(.*)$").unwrap())
}

fn region_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(else|and|option)\b\s*(.*)$").unwrap())
}

fn message_shape_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<<--?>>|--?>>|--?>|--?\)|--?x").unwrap())
}

/// `_parse_sequence`.
pub fn parse(
    diagram: &mut Diagram,
    lines: &[(i64, String)],
    header_position: usize,
) -> Failable<()> {
    let mut fragment_stack: Vec<usize> = Vec::new();
    for (line_number, raw) in &lines[header_position + 1..] {
        let text = strip(raw).to_string();
        if text.is_empty() {
            continue;
        }
        let lowered = text.to_lowercase();
        if discard_nonsemantic(diagram, &text) {
            continue;
        }
        if let Some(captures) = participant_re().captures(&text) {
            let kind = captures[1].to_lowercase();
            let quoted = captures
                .get(2)
                .or_else(|| captures.get(3))
                .map(|group| group.as_str());
            let bare = captures.get(4).map(|group| group.as_str());
            let alias = captures.get(5).map(|group| group.as_str());
            let (node_id, label) = match quoted {
                // `participant "Alice Smith" as A` — messages use the alias,
                // the quoted string is the display name.
                Some(quoted) => (alias.unwrap_or(quoted).to_string(), quoted.to_string()),
                // `participant A as Alice` — the bare token is the id.
                None => {
                    let bare = bare.unwrap_or("");
                    (bare.to_string(), alias.unwrap_or(bare).to_string())
                }
            };
            let shape = if kind == "actor" { "actor" } else { "lifeline" };
            diagram.add_node(&node_id, &clean_label(&label), shape, None, false)?;
            continue;
        }
        if let Some(captures) = fragment_re().captures(&text) {
            diagram.fragments.push(Fragment {
                kind: captures[1].to_lowercase(),
                label: clean_label(&captures[2]),
                line: *line_number,
                depth: fragment_stack.len() as i64,
                regions: Vec::new(),
            });
            fragment_stack.push(diagram.fragments.len() - 1);
            continue;
        }
        if let Some(captures) = region_re().captures(&text) {
            if let Some(current) = fragment_stack.last().copied() {
                let region = clean_label(&captures[2]);
                diagram.fragments[current].regions.push(region);
                continue;
            }
        }
        if lowered == "end" {
            fragment_stack.pop();
            continue;
        }
        if lowered.starts_with("activate ")
            || lowered.starts_with("deactivate ")
            || lowered.starts_with('+')
            || lowered.starts_with('-')
        {
            continue;
        }
        if lowered.starts_with("note ") {
            let note = match text.split_once(':') {
                Some((_, tail)) => tail.to_string(),
                None => text.chars().skip(5).collect::<String>(),
            };
            diagram.notes.push(clean_label(&note));
            continue;
        }
        if let Some(captures) = message_re().captures(&text) {
            let source = captures[1].to_string();
            let token = captures[2].to_string();
            let target = captures[3].to_string();
            let label = captures[4].to_string();
            // Auto-add endpoints only when undeclared, so an earlier
            // `actor`/`participant` declaration keeps its shape and label.
            for endpoint in [&source, &target] {
                if !diagram.contains(endpoint) {
                    diagram.add_node(endpoint, endpoint, "lifeline", None, false)?;
                }
            }
            let arrowhead = if token.ends_with('x') {
                "cross"
            } else if token.ends_with(')') {
                "async"
            } else if token.ends_with(">>") {
                "arrow"
            } else {
                // `->` / `-->` are open arrows with no arrowhead.
                "none"
            };
            let style = if token.starts_with("--") || token.starts_with("<<--") {
                "dashed"
            } else {
                "solid"
            };
            diagram.add_edge(
                &source,
                &target,
                &clean_label(&label),
                style,
                arrowhead,
                token.starts_with("<<"),
                arrowhead == "none",
            )?;
            continue;
        }
        if message_shape_re().is_match(&text) {
            return Err(Fail::new(format!("malformed edge at line {line_number}")));
        }
    }
    Ok(())
}
