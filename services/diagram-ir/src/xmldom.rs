//! A minimal XML document tree with `xml.etree.ElementTree` lookup semantics.
//!
//! quick-xml is a pull parser, but the draw.io port needs `find("root")`,
//! `find(".//mxGraphModel")` and `findall(".//mxPoint")`, so the events are
//! collected into the smallest tree that answers those three shapes.
//!
//! Entity expansion is not available: DTDs are rejected before parsing and
//! quick-xml resolves only the five predefined XML entities plus numeric
//! character references, so no input can pull in external data.

use quick_xml::events::Event;
use quick_xml::reader::Reader;

/// One element. `text` is ElementTree's `.text`: the character data before the
/// first child element, and nothing else.
#[derive(Debug, Clone, Default)]
pub struct Element {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub text: String,
    pub children: Vec<Element>,
}

impl Element {
    pub fn new(name: impl Into<String>) -> Self {
        Element {
            name: name.into(),
            ..Default::default()
        }
    }

    /// `element.get(key)`.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    /// `element.get(key, default)`.
    pub fn get_or<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        self.get(key).unwrap_or(default)
    }

    /// `element.find("child")` — first direct child with that tag.
    pub fn find(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|child| child.name == name)
    }

    /// `element.find(".//tag")` — first descendant, document order, excluding self.
    pub fn find_descendant(&self, name: &str) -> Option<&Element> {
        for child in &self.children {
            if child.name == name {
                return Some(child);
            }
            if let Some(found) = child.find_descendant(name) {
                return Some(found);
            }
        }
        None
    }

    /// `element.findall(".//tag")` — every descendant, document order.
    pub fn find_all_descendants(&self, name: &str) -> Vec<&Element> {
        let mut out = Vec::new();
        self.collect_descendants(name, &mut out);
        out
    }

    fn collect_descendants<'a>(&'a self, name: &str, out: &mut Vec<&'a Element>) {
        for child in &self.children {
            if child.name == name {
                out.push(child);
            }
            child.collect_descendants(name, out);
        }
    }
}

/// Parse a document into its root element. The error string is the parser's own
/// description; callers wrap it in their `malformed XML (...)` message.
pub fn parse_document(xml: &str) -> Result<Element, String> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.trim_text(false);
    config.expand_empty_elements = false;
    config.check_end_names = true;

    let mut stack: Vec<Element> = Vec::new();
    let mut root: Option<Element> = None;
    loop {
        match reader.read_event() {
            Err(error) => return Err(error.to_string()),
            Ok(Event::Eof) => break,
            Ok(Event::DocType(_)) => {
                return Err("document type declarations are not supported".to_string())
            }
            Ok(Event::Start(start)) => {
                stack.push(element_from_start(&start)?);
            }
            Ok(Event::Empty(start)) => {
                let element = element_from_start(&start)?;
                push_child(&mut stack, &mut root, element)?;
            }
            Ok(Event::End(_)) => {
                let element = match stack.pop() {
                    Some(element) => element,
                    None => return Err("unbalanced end tag".to_string()),
                };
                push_child(&mut stack, &mut root, element)?;
            }
            Ok(Event::Text(text)) => {
                let decoded = text.unescape().map_err(|error| error.to_string())?;
                append_text(&mut stack, &decoded);
            }
            Ok(Event::CData(data)) => {
                // CDATA is literal by definition; no entity resolution happens.
                let decoded = String::from_utf8_lossy(data.as_ref()).into_owned();
                append_text(&mut stack, &decoded);
            }
            Ok(_) => {}
        }
    }
    if !stack.is_empty() {
        return Err("unclosed element".to_string());
    }
    root.ok_or_else(|| "no element found".to_string())
}

fn element_from_start(start: &quick_xml::events::BytesStart<'_>) -> Result<Element, String> {
    let name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
    let mut attrs = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        let value = attribute
            .unescape_value()
            .map_err(|error| error.to_string())?
            .into_owned();
        attrs.push((key, value));
    }
    Ok(Element {
        name,
        attrs,
        text: String::new(),
        children: Vec::new(),
    })
}

fn push_child(
    stack: &mut [Element],
    root: &mut Option<Element>,
    element: Element,
) -> Result<(), String> {
    match stack.last_mut() {
        Some(parent) => {
            parent.children.push(element);
            Ok(())
        }
        None => {
            if root.is_some() {
                return Err("junk after document element".to_string());
            }
            *root = Some(element);
            Ok(())
        }
    }
}

/// ElementTree keeps only the text that precedes the first child in `.text`.
fn append_text(stack: &mut [Element], text: &str) {
    if let Some(current) = stack.last_mut() {
        if current.children.is_empty() {
            current.text.push_str(text);
        }
    }
}
