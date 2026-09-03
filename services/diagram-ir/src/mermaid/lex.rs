//! Mermaid lexing: fenced-block extraction, directive and frontmatter
//! stripping, the top-level mask, and logical statement joining.
//!
//! Label cleaning lives next door in [`crate::mermaid::label`] and is
//! re-exported here so callers keep one import.

use regex::Regex;
use std::sync::OnceLock;

use crate::mermaid::label::is_word;
use crate::pyfmt::{path_name, path_suffix, splitlines, strip};
use crate::{Fail, Failable};

pub const MARKDOWN_SUFFIXES: &[&str] = &[".md", ".markdown", ".mdown", ".mkd"];
pub const MERMAID_SUFFIXES: &[&str] = &[".mmd", ".mermaid"];
pub const FRONTMATTER_MAX_LINES: usize = 40;

/// Re-exported so callers keep a single lexing import.
pub use crate::mermaid::label::clean_label;

#[derive(Debug, Clone)]
pub struct SourceBlock {
    pub index: i64,
    pub text: String,
    pub source_line: i64,
}

/// `load_blocks` — the suffix gate runs before any bytes are read.
pub fn check_suffix(path: &str) -> Failable<()> {
    let suffix = path_suffix(path).to_lowercase();
    if MERMAID_SUFFIXES.contains(&suffix.as_str()) || MARKDOWN_SUFFIXES.contains(&suffix.as_str()) {
        return Ok(());
    }
    Err(Fail::new(format!(
        "{}: not a Mermaid file",
        path_name(path)
    )))
}

/// `load_blocks`, given the already-bounded source text.
pub fn split_blocks(path: &str, source: &str) -> Failable<Vec<SourceBlock>> {
    let suffix = path_suffix(path).to_lowercase();
    if MERMAID_SUFFIXES.contains(&suffix.as_str()) {
        return Ok(vec![SourceBlock {
            index: 0,
            text: source.to_string(),
            source_line: 1,
        }]);
    }
    let opener = fence_open_re();
    let mut blocks: Vec<SourceBlock> = Vec::new();
    let lines = splitlines(source);
    let mut start: Option<i64> = None;
    let mut fence = String::new();
    let mut content: Vec<String> = Vec::new();
    for (offset, line) in lines.iter().enumerate() {
        let line_number = offset as i64 + 1;
        if start.is_none() {
            if let Some(captures) = opener.captures(line) {
                start = Some(line_number + 1);
                fence = captures[1].to_string();
                content = Vec::new();
            }
            continue;
        }
        let closer = fence_close_re(&fence);
        if closer.is_match(line) {
            blocks.push(SourceBlock {
                index: blocks.len() as i64,
                text: content.join("\n"),
                source_line: start.expect("fence is open"),
            });
            start = None;
            fence = String::new();
            content = Vec::new();
        } else {
            content.push(line.clone());
        }
    }
    if let Some(start) = start {
        return Err(Fail::new(format!(
            "{}: unterminated mermaid fence starting at line {}",
            path_name(path),
            start - 1
        )));
    }
    if blocks.is_empty() {
        return Err(Fail::new(format!(
            "{}: no fenced mermaid block found",
            path_name(path)
        )));
    }
    Ok(blocks)
}

fn fence_open_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^\s*(`{3,}|~{3,})\s*mermaid\s*$").unwrap())
}

fn fence_close_re(fence: &str) -> Regex {
    let marker = fence.chars().next().unwrap_or('`');
    Regex::new(&format!(
        r"^\s*{}{{{},}}\s*$",
        regex::escape(&marker.to_string()),
        fence.chars().count()
    ))
    .expect("fence pattern is well formed")
}

/// `_frontmatter_end`.
fn frontmatter_end(lines: &[String]) -> i64 {
    let first = lines.iter().position(|line| !strip(line).is_empty());
    let Some(first) = first else {
        return -1;
    };
    if strip(&lines[first]) != "---" {
        return -1;
    }
    let limit = std::cmp::min(lines.len(), first + FRONTMATTER_MAX_LINES + 1);
    for (index, line) in lines.iter().enumerate().take(limit).skip(first + 1) {
        if strip(line) == "---" {
            return index as i64;
        }
    }
    -1
}

/// `_prepared_lines` — frontmatter and `%%{init}%%` directives are blanked, not
/// interpreted.
pub fn prepared_lines(block: &SourceBlock) -> Vec<(i64, String)> {
    let mut prepared: Vec<(i64, String)> = Vec::new();
    let mut in_directive = false;
    let lines = splitlines(&block.text);
    let frontmatter = frontmatter_end(&lines);
    for (offset, raw) in lines.iter().enumerate() {
        let line_number = block.source_line + offset as i64;
        let stripped = strip(raw);
        if offset as i64 <= frontmatter {
            prepared.push((line_number, String::new()));
            continue;
        }
        if in_directive {
            if stripped.contains("}%%") {
                in_directive = false;
            }
            prepared.push((line_number, String::new()));
            continue;
        }
        if stripped.starts_with("%%{") {
            if !stripped.contains("}%%") {
                in_directive = true;
            }
            prepared.push((line_number, String::new()));
            continue;
        }
        if stripped.starts_with("%%") {
            prepared.push((line_number, String::new()));
            continue;
        }
        prepared.push((
            line_number,
            raw.trim_end_matches(crate::pyfmt::is_py_space).to_string(),
        ));
    }
    prepared
}

fn header_flowchart_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b").unwrap())
}

const UNSUPPORTED_KINDS: &[&str] = &[
    "pie",
    "mindmap",
    "gitgraph",
    "quadrantchart",
    "timeline",
    "c4context",
    "sankey",
    "sankey-beta",
    "gantt",
    "journey",
    "classdiagram",
    "statediagram",
];

/// `_kind_and_direction`.
pub fn kind_and_direction(lines: &[(i64, String)]) -> Failable<(String, String, usize)> {
    for (position, (line_number, raw)) in lines.iter().enumerate() {
        let text = strip(raw);
        if text.is_empty() {
            continue;
        }
        if let Some(captures) = header_flowchart_re().captures(text) {
            return Ok((
                "flowchart".to_string(),
                captures[2].to_uppercase(),
                position,
            ));
        }
        if starts_with_keyword(text, "sequenceDiagram") {
            return Ok(("sequenceDiagram".to_string(), "LR".to_string(), position));
        }
        if starts_with_keyword(text, "stateDiagram-v2") {
            return Ok(("stateDiagram-v2".to_string(), "TD".to_string(), position));
        }
        if starts_with_keyword(text, "erDiagram") {
            return Ok(("erDiagram".to_string(), "TD".to_string(), position));
        }
        let token = text.split_whitespace().next().unwrap_or("");
        if UNSUPPORTED_KINDS.contains(&token.to_lowercase().as_str()) {
            return Err(Fail::new(format!(
                "unsupported diagram kind: `{token}` (supported: {})",
                crate::mermaid::SUPPORTED_KINDS
            )));
        }
        return Err(Fail::new(format!(
            "not a Mermaid file at line {line_number}"
        )));
    }
    Err(Fail::new("not a Mermaid file"))
}

/// `re.match(r"^keyword\b", text, re.I)`.
fn starts_with_keyword(text: &str, keyword: &str) -> bool {
    if text.len() < keyword.len() {
        return false;
    }
    if !text[..keyword.len()].eq_ignore_ascii_case(keyword) {
        return false;
    }
    match text[keyword.len()..].chars().next() {
        None => true,
        Some(next) => !is_word(next),
    }
}

/// `_top_level_mask` — keep top-level syntax positions, blank quoted or
/// bracketed content. Returned as chars so indices stay comparable with the
/// source text.
pub fn top_level_mask_chars(chars: &[char]) -> Vec<char> {
    let mut output = chars.to_vec();
    let mut stack: Vec<char> = Vec::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, character) in chars.iter().copied().enumerate() {
        if let Some(active) = quote {
            output[index] = ' ';
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active {
                quote = None;
            }
            continue;
        }
        if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
            output[index] = ' ';
            continue;
        }
        if matches!(character, '[' | '(' | '{') {
            stack.push(character);
            output[index] = ' ';
            continue;
        }
        if matches!(character, ']' | ')' | '}') {
            let opener = match character {
                ']' => '[',
                ')' => '(',
                _ => '{',
            };
            if stack.last() == Some(&opener) {
                stack.pop();
            }
            output[index] = ' ';
            continue;
        }
        if !stack.is_empty() {
            output[index] = ' ';
        }
    }
    output
}

/// `_top_level_mask` for callers that only need a boolean regex test.
pub fn top_level_mask(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    top_level_mask_chars(&chars).into_iter().collect()
}

/// `_split_top_level`.
pub fn split_top_level(text: &str, delimiter: char) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mask = top_level_mask_chars(&chars);
    let mut parts: Vec<String> = Vec::new();
    let mut start = 0usize;
    for (index, character) in mask.iter().copied().enumerate() {
        if character == delimiter {
            parts.push(chars[start..index].iter().collect());
            start = index + 1;
        }
    }
    parts.push(chars[start..].iter().collect());
    parts
}

/// `_statement_complete`.
pub fn statement_complete(text: &str) -> bool {
    let mut stack: Vec<char> = Vec::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for character in text.chars() {
        if let Some(active) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active {
                quote = None;
            }
            continue;
        }
        if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
        } else if matches!(character, '[' | '(' | '{') {
            stack.push(character);
        } else if matches!(character, ']' | ')' | '}') {
            let opener = match character {
                ']' => '[',
                ')' => '(',
                _ => '{',
            };
            if stack.last() == Some(&opener) {
                stack.pop();
            }
        }
    }
    quote.is_none() && stack.is_empty()
}

/// `_logical_statements` — join multiline Mermaid strings before splitting on
/// semicolons.
pub fn logical_statements(lines: &[(i64, String)]) -> Failable<Vec<(i64, String)>> {
    let mut logical: Vec<(i64, String)> = Vec::new();
    let mut pending: Vec<String> = Vec::new();
    let mut start_line = 0i64;
    for (line_number, raw) in lines {
        if pending.is_empty() && strip(raw).is_empty() {
            continue;
        }
        if pending.is_empty() {
            start_line = *line_number;
        }
        pending.push(raw.clone());
        let combined = pending.join("\n");
        if !statement_complete(&combined) {
            continue;
        }
        for statement in split_top_level(&combined, ';') {
            logical.push((start_line, statement));
        }
        pending.clear();
    }
    if !pending.is_empty() {
        return Err(Fail::new(format!(
            "unterminated statement at line {start_line}"
        )));
    }
    Ok(logical)
}

/// `_strip_class_suffix` — drop Mermaid's `:::class` attachment.
pub fn strip_class_suffix(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mask = top_level_mask_chars(&chars);
    let mut index = None;
    for position in 0..mask.len() {
        if mask[position] == ':'
            && mask.get(position + 1) == Some(&':')
            && mask.get(position + 2) == Some(&':')
        {
            index = Some(position);
            break;
        }
    }
    let Some(index) = index else {
        return text.to_string();
    };
    let mut end = index + 3;
    while end < chars.len() && (chars[end].is_alphanumeric() || matches!(chars[end], '_' | '-')) {
        end += 1;
    }
    let mut result: String = chars[..index].iter().collect();
    result.extend(&chars[end..]);
    strip(&result).to_string()
}
