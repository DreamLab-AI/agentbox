//! A tolerant HTML scanner with `html.parser.HTMLParser` semantics.
//!
//! Only what the self-check needs is modelled: start tags (including the
//! self-closing form, which fires a start *and* an end), end tags, character
//! data with `convert_charrefs=True`, and the CDATA content mode `<script>` and
//! `<style>` switch on. Nothing is executed, fetched or rendered.

use std::collections::{HashMap, HashSet};

use crate::entities::unescape;

pub type Attrs = HashMap<String, String>;

#[derive(Debug, Clone, Default)]
pub struct TextNode {
    pub attrs: Attrs,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct Script {
    pub attrs: Attrs,
    pub attr_names: Vec<String>,
    pub body: String,
    pub closed: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Svg {
    pub attrs: Attrs,
    pub first: Option<String>,
    pub title: Option<TextNode>,
    pub desc: Option<TextNode>,
}

const REFERENCE_ATTRS: &[&str] = &[
    "src",
    "href",
    "xlink:href",
    "poster",
    "srcset",
    "action",
    "formaction",
];

#[derive(Debug, Default)]
pub struct DiagramParser {
    pub roots: Vec<Attrs>,
    pub items: Vec<Attrs>,
    pub actions: HashSet<String>,
    pub controls: i64,
    pub statuses: Vec<Attrs>,
    pub statuses_in_controls: i64,
    pub scripts: Vec<Script>,
    pub styles: Vec<String>,
    pub svgs: Vec<Svg>,
    pub unsafe_findings: Vec<String>,
    pub references: Vec<(String, String, String)>,
    svg_depth: usize,
    current_svg: Option<usize>,
    capture: Option<String>,
    current_script: Option<usize>,
    in_style: bool,
    element_stack: Vec<String>,
    motion_root_depth: Option<usize>,
    controls_depth: Option<usize>,
}

impl DiagramParser {
    fn handle_starttag(&mut self, tag: &str, attrs: &[(String, Option<String>)]) {
        let normalised: Vec<(String, String)> = attrs
            .iter()
            .map(|(key, value)| (key.to_lowercase(), value.clone().unwrap_or_default()))
            .collect();
        let mut data: Attrs = Attrs::new();
        for (key, value) in &normalised {
            data.insert(key.clone(), value.clone());
        }
        if matches!(tag, "base" | "embed" | "object" | "iframe") {
            self.unsafe_findings
                .push(format!("<{tag}> is not allowed in a diagram file"));
        }
        for (key, value) in &normalised {
            if key.starts_with("on") {
                self.unsafe_findings
                    .push(format!("executable attribute {key} on <{tag}>"));
            }
            if key == "srcdoc" {
                self.unsafe_findings
                    .push(format!("srcdoc attribute on <{tag}>"));
            }
            if REFERENCE_ATTRS.contains(&key.as_str()) {
                self.references.push((
                    tag.to_string(),
                    data.get("rel").cloned().unwrap_or_default(),
                    value.clone(),
                ));
            }
        }
        if data.contains_key("data-motion-root") {
            self.roots.push(data.clone());
            if self.motion_root_depth.is_none() {
                self.motion_root_depth = Some(self.element_stack.len());
            }
        }
        if self.motion_root_depth.is_some() {
            if data.contains_key("data-motion-item") {
                self.items.push(data.clone());
            }
            if let Some(action) = data.get("data-motion-action") {
                self.actions.insert(action.clone());
            }
            if data.contains_key("data-motion-controls") {
                self.controls += 1;
                if self.controls_depth.is_none() {
                    self.controls_depth = Some(self.element_stack.len());
                }
            }
            if data.contains_key("data-motion-status") {
                self.statuses.push(data.clone());
                if self.controls_depth.is_some() {
                    self.statuses_in_controls += 1;
                }
            }
        }
        if tag == "script" {
            self.scripts.push(Script {
                attrs: data.clone(),
                attr_names: normalised.iter().map(|(key, _)| key.clone()).collect(),
                body: String::new(),
                closed: false,
            });
            self.current_script = Some(self.scripts.len() - 1);
        }
        if tag == "style" {
            self.in_style = true;
        }
        self.element_stack.push(tag.to_string());
        if tag == "svg" && self.svg_depth == 0 {
            self.svg_depth = 1;
            self.svgs.push(Svg {
                attrs: data,
                first: None,
                title: None,
                desc: None,
            });
            self.current_svg = Some(self.svgs.len() - 1);
            return;
        }
        if self.svg_depth != 0 {
            self.svg_depth += 1;
            let index = self.current_svg.expect("an svg is open");
            if self.svg_depth == 2 && self.svgs[index].first.is_none() {
                self.svgs[index].first = Some(tag.to_string());
            }
            if self.svg_depth == 2 && (tag == "title" || tag == "desc") {
                let node = TextNode {
                    attrs: data,
                    text: String::new(),
                };
                if tag == "title" {
                    self.svgs[index].title = Some(node);
                } else {
                    self.svgs[index].desc = Some(node);
                }
                self.capture = Some(tag.to_string());
            }
        }
    }

    fn handle_endtag(&mut self, tag: &str) {
        if tag == "script" {
            if let Some(index) = self.current_script.take() {
                self.scripts[index].closed = true;
            }
        }
        if tag == "style" {
            self.in_style = false;
        }
        if self.svg_depth != 0 {
            if tag == "title" || tag == "desc" {
                self.capture = None;
            }
            self.svg_depth -= 1;
            if self.svg_depth == 0 {
                self.current_svg = None;
            }
        }
        if let Some(position) = self.element_stack.iter().rposition(|name| name == tag) {
            self.element_stack.truncate(position);
        }
        if let Some(depth) = self.motion_root_depth {
            if self.element_stack.len() <= depth {
                self.motion_root_depth = None;
            }
        }
        if let Some(depth) = self.controls_depth {
            if self.element_stack.len() <= depth {
                self.controls_depth = None;
            }
        }
    }

    fn handle_data(&mut self, data: &str) {
        if let Some(index) = self.current_script {
            self.scripts[index].body.push_str(data);
        }
        if self.in_style {
            self.styles.push(data.to_string());
        }
        if let (Some(capture), Some(index)) = (self.capture.clone(), self.current_svg) {
            let node = if capture == "title" {
                self.svgs[index].title.as_mut()
            } else {
                self.svgs[index].desc.as_mut()
            };
            if let Some(node) = node {
                node.text.push_str(data);
            }
        }
    }
}

/// `parsed_document`.
pub fn parse(source: &str) -> DiagramParser {
    let mut parser = DiagramParser::default();
    let chars: Vec<char> = source.chars().collect();
    let mut index = 0usize;
    let mut cdata: Option<String> = None;
    let mut pending = String::new();

    while index < chars.len() {
        if let Some(element) = cdata.clone() {
            // `set_cdata_mode` scans for `</elem`; everything before it is data.
            match find_close(&chars, index, &element) {
                Some(position) => {
                    pending.push_str(&chars[index..position].iter().collect::<String>());
                    flush(&mut parser, &mut pending, true);
                    index = position;
                    cdata = None;
                }
                None => {
                    pending.push_str(&chars[index..].iter().collect::<String>());
                    flush(&mut parser, &mut pending, true);
                    index = chars.len();
                    cdata = None;
                }
            }
            continue;
        }
        if chars[index] != '<' {
            pending.push(chars[index]);
            index += 1;
            continue;
        }
        let next = chars.get(index + 1).copied();
        if next == Some('!') {
            flush(&mut parser, &mut pending, false);
            if chars.get(index + 2) == Some(&'-') && chars.get(index + 3) == Some(&'-') {
                index = skip_to(&chars, index + 4, "-->").unwrap_or(chars.len());
            } else {
                index = skip_to(&chars, index + 2, ">").unwrap_or(chars.len());
            }
            continue;
        }
        if next == Some('?') {
            flush(&mut parser, &mut pending, false);
            index = skip_to(&chars, index + 2, ">").unwrap_or(chars.len());
            continue;
        }
        if next == Some('/') {
            match chars.get(index + 2) {
                Some(letter) if letter.is_ascii_alphabetic() => {
                    flush(&mut parser, &mut pending, false);
                    let (name, after) = read_name(&chars, index + 2);
                    parser.handle_endtag(&name);
                    index = skip_to(&chars, after, ">").unwrap_or(chars.len());
                }
                _ => {
                    flush(&mut parser, &mut pending, false);
                    index = skip_to(&chars, index + 2, ">").unwrap_or(chars.len());
                }
            }
            continue;
        }
        match next {
            Some(letter) if letter.is_ascii_alphabetic() => {
                flush(&mut parser, &mut pending, false);
                let (name, after) = read_name(&chars, index + 1);
                let (attrs, self_closing, after) = read_attributes(&chars, after);
                parser.handle_starttag(&name, &attrs);
                if self_closing {
                    parser.handle_endtag(&name);
                } else if name == "script" || name == "style" {
                    cdata = Some(name.clone());
                }
                index = after;
            }
            _ => {
                pending.push('<');
                index += 1;
            }
        }
    }
    flush(&mut parser, &mut pending, cdata.is_some());
    parser
}

/// `convert_charrefs=True` converts references in ordinary data but never
/// inside a CDATA content element.
fn flush(parser: &mut DiagramParser, pending: &mut String, raw: bool) {
    if pending.is_empty() {
        return;
    }
    let data = if raw {
        std::mem::take(pending)
    } else {
        let converted = unescape(pending);
        pending.clear();
        converted
    };
    parser.handle_data(&data);
}

fn read_name(chars: &[char], start: usize) -> (String, usize) {
    let mut end = start;
    while end < chars.len() && !chars[end].is_whitespace() && !matches!(chars[end], '>' | '/' | '=')
    {
        end += 1;
    }
    (
        chars[start..end].iter().collect::<String>().to_lowercase(),
        end,
    )
}

#[allow(clippy::type_complexity)]
fn read_attributes(chars: &[char], start: usize) -> (Vec<(String, Option<String>)>, bool, usize) {
    let mut attrs: Vec<(String, Option<String>)> = Vec::new();
    let mut index = start;
    let mut self_closing = false;
    loop {
        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        if chars[index] == '>' {
            index += 1;
            break;
        }
        if chars[index] == '/' {
            if chars.get(index + 1) == Some(&'>') {
                self_closing = true;
                index += 2;
                break;
            }
            index += 1;
            continue;
        }
        let name_start = index;
        while index < chars.len()
            && !chars[index].is_whitespace()
            && !matches!(chars[index], '=' | '>' | '/')
        {
            index += 1;
        }
        if index == name_start {
            index += 1;
            continue;
        }
        let name: String = chars[name_start..index]
            .iter()
            .collect::<String>()
            .to_lowercase();
        let mut cursor = index;
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if chars.get(cursor) == Some(&'=') {
            cursor += 1;
            while cursor < chars.len() && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            let value = match chars.get(cursor) {
                Some('"') | Some('\'') => {
                    let quote = chars[cursor];
                    cursor += 1;
                    let value_start = cursor;
                    while cursor < chars.len() && chars[cursor] != quote {
                        cursor += 1;
                    }
                    let raw: String = chars[value_start..cursor].iter().collect();
                    if cursor < chars.len() {
                        cursor += 1;
                    }
                    raw
                }
                _ => {
                    let value_start = cursor;
                    while cursor < chars.len()
                        && !chars[cursor].is_whitespace()
                        && chars[cursor] != '>'
                    {
                        cursor += 1;
                    }
                    chars[value_start..cursor].iter().collect()
                }
            };
            attrs.push((name, Some(unescape(&value))));
            index = cursor;
        } else {
            attrs.push((name, None));
        }
    }
    (attrs, self_closing, index)
}

fn skip_to(chars: &[char], start: usize, marker: &str) -> Option<usize> {
    let marker: Vec<char> = marker.chars().collect();
    let mut index = start;
    while index + marker.len() <= chars.len() {
        if chars[index..index + marker.len()] == marker[..] {
            return Some(index + marker.len());
        }
        index += 1;
    }
    None
}

/// `interesting = re.compile(r'</\s*elem', re.I)`.
fn find_close(chars: &[char], start: usize, element: &str) -> Option<usize> {
    let name: Vec<char> = element.chars().collect();
    let mut index = start;
    while index < chars.len() {
        if chars[index] == '<' && chars.get(index + 1) == Some(&'/') {
            let mut cursor = index + 2;
            while cursor < chars.len() && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            if cursor + name.len() <= chars.len()
                && chars[cursor..cursor + name.len()]
                    .iter()
                    .map(|ch| ch.to_ascii_lowercase())
                    .eq(name.iter().copied())
            {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}
