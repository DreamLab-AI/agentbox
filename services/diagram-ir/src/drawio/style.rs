//! draw.io style-string parsing, label cleaning and shape classification.

use regex::Regex;
use std::sync::OnceLock;

use crate::entities::unescape;
use crate::pyfmt::strip;

/// `mxCell` style key/value pairs, in document order.
pub type Style = Vec<(String, String)>;

pub fn style_get<'a>(style: &'a Style, key: &str) -> Option<&'a str> {
    style
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

pub fn style_get_or<'a>(style: &'a Style, key: &str, default: &'a str) -> &'a str {
    style_get(style, key).unwrap_or(default)
}

pub fn style_has(style: &Style, key: &str) -> bool {
    style.iter().any(|(name, _)| name == key)
}

/// `parse_style` — a later duplicate key overwrites the earlier value, matching
/// the Python dict build.
pub fn parse_style(style: Option<&str>) -> Style {
    let mut out: Style = Vec::new();
    let Some(style) = style else {
        return out;
    };
    for part in style.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (key, value) = match part.split_once('=') {
            Some((key, value)) => (key.trim().to_string(), value.trim().to_string()),
            None => (part.trim().to_string(), "1".to_string()),
        };
        match out.iter_mut().find(|(name, _)| *name == key) {
            Some(slot) => slot.1 = value,
            None => out.push((key, value)),
        }
    }
    out
}

fn br_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<br\s*/?>|</p\s*>|</div\s*>").unwrap())
}

fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

fn runs_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[ \t]+").unwrap())
}

/// `clean_label` — draw.io labels are HTML fragments; flatten to plain lines.
pub fn clean_label(value: Option<&str>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if value.is_empty() {
        return String::new();
    }
    let text = br_re().replace_all(value, "\n");
    let text = tag_re().replace_all(&text, "");
    let text = unescape(&text);
    let text = text.replace('\u{a0}', " ");
    let lines: Vec<String> = text
        .split('\n')
        .map(|line| strip(&runs_re().replace_all(line, " ")).to_string())
        .collect();
    let lines = lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    strip(&lines).to_string()
}

/// `mxgraph.*` stencil prefixes mapped to an icon family.
const SHAPE_FAMILIES: &[(&str, &str)] = &[
    ("mxgraph.aws", "aws"),
    ("mxgraph.azure", "azure"),
    ("mxgraph.gcp", "gcp"),
    ("mxgraph.kubernetes", "kubernetes"),
    ("mxgraph.cisco", "network"),
    ("mxgraph.veeam", "infra"),
    ("mxgraph.flowchart", "flowchart"),
    ("mxgraph.bpmn", "bpmn"),
    ("mxgraph.er", "er"),
    ("mxgraph.sysml", "uml"),
    ("mxgraph.archimate", "archimate"),
];

/// Style key to canonical shape name, checked in order.
const SHAPE_KEYS: &[(&str, &str)] = &[
    ("swimlane", "swimlane"),
    ("ellipse", "ellipse"),
    ("rhombus", "rhombus"),
    ("triangle", "triangle"),
    ("cylinder", "cylinder"),
    ("cylinder3", "cylinder"),
    ("hexagon", "hexagon"),
    ("cloud", "cloud"),
    ("actor", "actor"),
    ("umlActor", "actor"),
    ("note", "note"),
    ("card", "card"),
    ("step", "step"),
    ("process", "process"),
    ("parallelogram", "parallelogram"),
    ("document", "document"),
    ("datastore", "cylinder"),
    ("umlLifeline", "lifeline"),
    ("umlFrame", "frame"),
    ("table", "table"),
    ("tableRow", "table-row"),
    ("partialRectangle", "table-row"),
    ("image", "image"),
    ("text", "text"),
    ("group", "group"),
];

/// `classify_shape`.
pub fn classify_shape(style: &Style) -> String {
    let raw = style_get_or(style, "shape", "");
    if !raw.is_empty() {
        for (key, name) in SHAPE_KEYS {
            if raw == *key || raw.starts_with(key) {
                return (*name).to_string();
            }
        }
        for (prefix, family) in SHAPE_FAMILIES {
            if raw.starts_with(prefix) {
                return format!("icon:{family}");
            }
        }
        return format!("shape:{raw}");
    }
    for (key, name) in SHAPE_KEYS {
        if style_has(style, key) {
            return (*name).to_string();
        }
    }
    if style_get(style, "ellipse") == Some("1") {
        return "ellipse".to_string();
    }
    "rect".to_string()
}

/// `shape_family`.
pub fn shape_family(shape: &str) -> String {
    if let Some(rest) = shape.strip_prefix("icon:") {
        return rest.to_string();
    }
    if shape.starts_with("shape:") {
        return "custom".to_string();
    }
    shape.to_string()
}
