//! Mermaid node expressions, shape families and link operators.

use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::mermaid::lex::{clean_label, split_top_level, strip_class_suffix, top_level_mask_chars};
use crate::pyfmt::strip;

/// `(opening, closing, shape)` — checked in order, longest delimiters first.
pub const SHAPE_FOR_DELIMITERS: &[(&str, &str, &str)] = &[
    ("(((", ")))", "circle"),
    ("((", "))", "circle"),
    ("([", "])", "stadium"),
    ("{{", "}}", "hexagon"),
    ("[(", ")]", "cylinder"),
    ("[[", "]]", "subroutine"),
    ("[/", "/]", "parallelogram"),
    ("[\\", "\\]", "parallelogram"),
    ("[/", "\\]", "trapezoid"),
    ("[\\", "/]", "trapezoid"),
    ("[", "]", "rect"),
    ("(", ")", "round"),
    ("{", "}", "rhombus"),
    (">", "]", "asymmetric"),
];

/// Mermaid v11.3+ `@{ shape: ... }` names, folded onto the classic families.
const EXPANDED_SHAPE_FAMILIES: &[(&str, &str)] = &[
    ("rect", "rect"),
    ("rectangle", "rect"),
    ("proc", "rect"),
    ("process", "rect"),
    ("rounded", "round"),
    ("event", "round"),
    ("stadium", "stadium"),
    ("pill", "stadium"),
    ("terminal", "stadium"),
    ("circle", "circle"),
    ("circ", "circle"),
    ("sm-circ", "circle"),
    ("small-circle", "circle"),
    ("start", "circle"),
    ("dbl-circ", "circle"),
    ("double-circle", "circle"),
    ("fr-circ", "circle"),
    ("framed-circle", "circle"),
    ("stop", "circle"),
    ("cyl", "cylinder"),
    ("cylinder", "cylinder"),
    ("database", "cylinder"),
    ("db", "cylinder"),
    ("h-cyl", "cylinder"),
    ("horizontal-cylinder", "cylinder"),
    ("lin-cyl", "cylinder"),
    ("lined-cylinder", "cylinder"),
    ("diam", "rhombus"),
    ("decision", "rhombus"),
    ("diamond", "rhombus"),
    ("question", "rhombus"),
    ("hex", "hexagon"),
    ("hexagon", "hexagon"),
    ("prepare", "hexagon"),
    ("fr-rect", "subroutine"),
    ("framed-rectangle", "subroutine"),
    ("subproc", "subroutine"),
    ("subprocess", "subroutine"),
    ("subroutine", "subroutine"),
    ("lean-r", "parallelogram"),
    ("lean-l", "parallelogram"),
    ("in-out", "parallelogram"),
    ("lean-right", "parallelogram"),
    ("lean-left", "parallelogram"),
    ("out-in", "parallelogram"),
    ("trap-t", "trapezoid"),
    ("trap-b", "trapezoid"),
    ("trapezoid", "trapezoid"),
    ("inv-trapezoid", "trapezoid"),
    ("manual", "trapezoid"),
    ("priority", "trapezoid"),
];

fn expanded_families() -> &'static HashMap<&'static str, &'static str> {
    static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    MAP.get_or_init(|| EXPANDED_SHAPE_FAMILIES.iter().copied().collect())
}

/// `classify_shape`.
pub fn classify_shape(expression: &str) -> String {
    for (opening, closing, shape) in SHAPE_FOR_DELIMITERS {
        if expression.starts_with(opening) && expression.ends_with(closing) {
            return (*shape).to_string();
        }
    }
    "rect".to_string()
}

fn attribute_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\A[a-z][a-z0-9_-]*\z").unwrap())
}

fn shape_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\A[a-z][a-z0-9-]*\z").unwrap())
}

fn node_id_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[\w.:-]+").unwrap())
}

/// `_parse_expanded_attributes` — only label and shape cross the trust
/// boundary; image URLs, icon names, sizes and renderer config are dropped.
fn parse_expanded_attributes(text: &str) -> Option<(String, String)> {
    if !text.starts_with("@{") || !text.ends_with('}') {
        return None;
    }
    let chars: Vec<char> = text.chars().collect();
    let inner: String = if chars.len() >= 3 {
        chars[2..chars.len() - 1].iter().collect()
    } else {
        String::new()
    };
    let mut values: Vec<(String, String)> = Vec::new();
    for raw_attribute in split_top_level(&inner, ',') {
        let Some((key, raw_value)) = raw_attribute.split_once(':') else {
            continue;
        };
        let key = strip(key).to_lowercase();
        if !attribute_key_re().is_match(&key) {
            continue;
        }
        let value = clean_label(raw_value);
        match values.iter_mut().find(|(name, _)| *name == key) {
            Some(slot) => slot.1 = value,
            None => values.push((key, value)),
        }
    }
    let lookup = |name: &str| {
        values
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let has = |name: &str| values.iter().any(|(key, _)| key == name);
    let mut shape_name = lookup("shape").unwrap_or_default().to_lowercase();
    if shape_name.is_empty() {
        shape_name = if has("img") {
            "image".to_string()
        } else if has("icon") {
            "icon".to_string()
        } else {
            "rect".to_string()
        };
    }
    if !shape_name_re().is_match(&shape_name) {
        shape_name = "rect".to_string();
    }
    let shape = expanded_families()
        .get(shape_name.as_str())
        .map(|family| (*family).to_string())
        .unwrap_or(shape_name);
    Some((lookup("label").unwrap_or_default(), shape))
}

/// `_parse_node_expression` — `(id, label, shape)`.
pub fn parse_node_expression(expression: &str) -> Option<(String, String, String)> {
    let trimmed = strip(expression);
    let trimmed = trimmed.trim_end_matches(';');
    let text = strip_class_suffix(strip(trimmed));
    if text.is_empty() {
        return None;
    }
    let captures = node_id_re().find(&text)?;
    let node_id = captures.as_str().to_string();
    let rest = strip(&text[captures.end()..]).to_string();
    if rest.is_empty() {
        return Some((node_id.clone(), node_id, "rect".to_string()));
    }
    if let Some((label, shape)) = parse_expanded_attributes(&rest) {
        let label = if label.is_empty() {
            node_id.clone()
        } else {
            label
        };
        return Some((node_id, label, shape));
    }
    let rest_chars: Vec<char> = rest.chars().collect();
    for (opening, closing, _shape) in SHAPE_FOR_DELIMITERS {
        if rest.starts_with(opening) && rest.ends_with(closing) {
            let start = opening.chars().count();
            let end = rest_chars.len().saturating_sub(closing.chars().count());
            let label: String = if start <= end {
                rest_chars[start..end].iter().collect()
            } else {
                String::new()
            };
            return Some((node_id, clean_label(&label), classify_shape(&rest)));
        }
    }
    None
}

#[derive(Debug, Clone)]
pub struct Operator {
    /// Character index into the statement, matching the Python's string slicing.
    pub start: usize,
    pub end: usize,
    pub label: String,
    pub style: String,
    pub arrowhead: String,
    pub bidirectional: bool,
    pub undirected: bool,
}

/// `_operator_style`.
fn operator_style(token: &str) -> (String, String, bool, bool) {
    let style = if token.contains('.') {
        "dashed"
    } else if token.contains('=') {
        "thick"
    } else {
        "solid"
    };
    let arrowhead = if token.ends_with('x') {
        "cross"
    } else if token.ends_with('o') {
        "circle"
    } else {
        "arrow"
    };
    let undirected = !token.contains('>') && !(token.ends_with('x') || token.ends_with('o'));
    let bidirectional = (token.starts_with('<') && token.ends_with('>'))
        || ((token.starts_with('x') || token.starts_with('o'))
            && (token.ends_with('x') || token.ends_with('o')));
    (
        style.to_string(),
        arrowhead.to_string(),
        bidirectional,
        undirected,
    )
}

fn labelled_link_re() -> &'static Regex {
    // The Python spells the compact alternative `(?![-=.\s])([^\s|<>]+?)`; with
    // no lookahead available the same language is written as an explicit first
    // character class, which constrains exactly the character the lookahead did.
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?:--|-\.|==)(?:\s+(.+?)\s+|([^-=.\s|<>][^\s|<>]*?))(\.-+[>xo]|\.-+|-{2,}>|--[xo]|=+>|={2,}|-{3,})",
        )
        .unwrap()
    })
}

fn bare_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[xo][-=.]+[xo]|<[-=.]+>|-+\.-+>|=+>|-+(?:>|x|o)|-+\.-+|={3,}|-{3,}").unwrap()
    })
}

/// Byte offsets in the masked string map back to character indices in the
/// source, because masking can shorten a multi-byte character to one space.
struct MaskIndex {
    mask: String,
    byte_to_char: Vec<usize>,
}

fn build_mask(chars: &[char]) -> MaskIndex {
    let masked = top_level_mask_chars(chars);
    let mut mask = String::with_capacity(chars.len());
    let mut byte_to_char = Vec::with_capacity(chars.len() + 1);
    for (index, character) in masked.iter().copied().enumerate() {
        for _ in 0..character.len_utf8() {
            byte_to_char.push(index);
        }
        mask.push(character);
    }
    byte_to_char.push(chars.len());
    MaskIndex { mask, byte_to_char }
}

/// `_edge_operators`.
pub fn edge_operators(text: &str) -> Vec<Operator> {
    let chars: Vec<char> = text.chars().collect();
    let index = build_mask(&chars);
    let to_char = |offset: usize| index.byte_to_char[offset];
    let mut operators: Vec<Operator> = Vec::new();
    let mut occupied: Vec<(usize, usize)> = Vec::new();

    // Labelled links carry the label between the opening and closing operator:
    // `A-- text -->B`, `A-. retry .-> B`, `A== critical ==> B`, and the
    // undirected forms of each. The compact form drops the spaces — `B--yes-->C`
    // — so its label may not contain whitespace, and the operator characters
    // themselves may not open one (keeping `A----->B` unlabelled and
    // `A --o B --> C` two separate links).
    for captures in labelled_link_re().captures_iter(&index.mask) {
        let whole = captures.get(0).expect("group 0 always matches");
        let token = captures
            .get(3)
            .expect("operator group")
            .as_str()
            .to_string();
        let label_group = if captures.get(1).is_some() { 1 } else { 2 };
        let label_span = captures.get(label_group).expect("label group");
        let (style, arrowhead, bidirectional, undirected) = operator_style(&token);
        let start = to_char(whole.start());
        let end = to_char(whole.end());
        let label_text: String = chars[to_char(label_span.start())..to_char(label_span.end())]
            .iter()
            .collect();
        operators.push(Operator {
            start,
            end,
            label: clean_label(&label_text),
            style,
            arrowhead,
            bidirectional,
            undirected,
        });
        occupied.push((start, end));
    }

    for found in bare_link_re().find_iter(&index.mask) {
        let start = to_char(found.start());
        if occupied
            .iter()
            .any(|(from, to)| *from <= start && start < *to)
        {
            continue;
        }
        let token = found.as_str().to_string();
        let mut end = to_char(found.end());
        let mut label = String::new();
        if end < chars.len() && chars[end] == '|' {
            if let Some(offset) = chars[end + 1..].iter().position(|ch| *ch == '|') {
                let close = end + 1 + offset;
                label = clean_label(&chars[end + 1..close].iter().collect::<String>());
                end = close + 1;
            }
        }
        let (style, arrowhead, bidirectional, undirected) = operator_style(&token);
        operators.push(Operator {
            start,
            end,
            label,
            style,
            arrowhead,
            bidirectional,
            undirected,
        });
        occupied.push((start, end));
    }

    operators.sort_by_key(|operator| operator.start);
    operators
}
