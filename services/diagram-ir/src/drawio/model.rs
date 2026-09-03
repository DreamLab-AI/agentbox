//! The draw.io IR: nodes, edges, pages, and the `mxGraphModel` flattening.

use serde::Serialize;
use std::collections::HashMap;

use crate::drawio::decode::{inflate, MAX_XML_BYTES};
use crate::drawio::style::{
    classify_shape, clean_label, parse_style, style_get, style_get_or, style_has,
};
use crate::xmldom::{parse_document, Element};
use crate::{Fail, Failable};

/// Field order is the dataclass declaration order, which is what `asdict()`
/// serialises and therefore what `--json` must emit.
#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub shape: String,
    pub parent: Option<String>,
    pub depth: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub fill: String,
    pub stroke: String,
    pub font_color: String,
    pub dashed: bool,
    pub rounded: bool,
    pub container: bool,
    pub children: Vec<String>,
    pub link: String,
    pub attrs: serde_json::Map<String, serde_json::Value>,
    pub in_degree: i64,
    pub out_degree: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub id: String,
    pub source: Option<String>,
    pub target: Option<String>,
    pub label: String,
    pub dashed: bool,
    pub bidirectional: bool,
    pub undirected: bool,
    pub style_name: String,
    pub waypoints: i64,
    pub stroke: String,
}

#[derive(Debug, Clone, Default)]
pub struct Page {
    pub id: String,
    pub name: String,
    pub index: i64,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

impl Page {
    /// `page.node_map` — a later duplicate id wins, exactly as the Python
    /// dict comprehension does.
    pub fn node_map(&self) -> HashMap<&str, usize> {
        let mut map = HashMap::new();
        for (index, node) in self.nodes.iter().enumerate() {
            map.insert(node.id.as_str(), index);
        }
        map
    }
}

/// `_reject_unsafe_xml`.
pub fn reject_unsafe_xml(xml: &str, source: &str) -> Failable<()> {
    let upper = xml.to_uppercase();
    if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
        return Err(Fail::new(format!(
            "{source}: DTD and entity declarations are not supported"
        )));
    }
    Ok(())
}

/// `_num` — a missing, empty or unparseable geometry attribute is 0.0.
fn num(geom: Option<&Element>, key: &str) -> f64 {
    let Some(geom) = geom else {
        return 0.0;
    };
    let raw = geom.get(key).unwrap_or("0");
    if raw.is_empty() {
        return 0.0;
    }
    raw.trim().parse::<f64>().unwrap_or(0.0)
}

struct RawCell {
    cell: Element,
    attrs: Vec<(String, String)>,
    value: String,
}

/// `parse_page`.
pub fn parse_page(diagram: &Element, index: i64) -> Failable<Page> {
    let name = match diagram.get("name") {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => format!("Page-{}", index + 1),
    };
    let mut page = Page {
        id: match diagram.get("id") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => format!("page-{index}"),
        },
        name,
        index,
        ..Default::default()
    };

    let inline_model = diagram.find_descendant("mxGraphModel").cloned();
    let model = match inline_model {
        Some(model) => model,
        None => {
            let text = diagram.text.trim().to_string();
            let inflated = if text.is_empty() {
                None
            } else {
                inflate(&text)?
            };
            let Some(inflated) = inflated else {
                return Ok(page);
            };
            reject_unsafe_xml(&inflated, &format!("page {index}"))?;
            let parsed = parse_document(&inflated)
                .map_err(|error| Fail::new(format!("page {index}: malformed XML ({error})")))?;
            if parsed.name == "mxGraphModel" {
                parsed
            } else {
                match parsed.find_descendant("mxGraphModel") {
                    Some(found) => found.clone(),
                    None => return Ok(page),
                }
            }
        }
    };

    let Some(root) = model.find("root") else {
        return Ok(page);
    };

    // Pass 1: collect raw cells, unwrapping <object>/<UserObject> containers.
    let mut raw: HashMap<String, RawCell> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for element in &root.children {
        let (cell, attrs, cid, value) = if element.name == "object" || element.name == "UserObject"
        {
            let Some(cell) = element.find("mxCell") else {
                continue;
            };
            let attrs: Vec<(String, String)> = element
                .attrs
                .iter()
                .filter(|(key, _)| !matches!(key.as_str(), "id" | "label" | "placeholders"))
                .cloned()
                .collect();
            let cid = match element.get("id") {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => cell.get("id").unwrap_or("").to_string(),
            };
            (
                cell.clone(),
                attrs,
                cid,
                element.get("label").unwrap_or("").to_string(),
            )
        } else if element.name == "mxCell" {
            (
                element.clone(),
                Vec::new(),
                element.get("id").unwrap_or("").to_string(),
                element.get("value").unwrap_or("").to_string(),
            )
        } else {
            continue;
        };
        if cid.is_empty() {
            continue;
        }
        raw.insert(cid.clone(), RawCell { cell, attrs, value });
        order.push(cid);
    }

    // Pass 2: vertices. Absolute geometry is resolved after the pass.
    let mut edge_label_parts: HashMap<String, Vec<String>> = HashMap::new();
    for cid in &order {
        let entry = &raw[cid];
        let style = parse_style(entry.cell.get("style"));
        let parent = entry.cell.get("parent").map(|value| value.to_string());
        if entry.cell.get("edge") == Some("1") {
            continue;
        }
        if entry.cell.get("vertex") != Some("1") {
            continue;
        }
        // An edge label is a vertex parented to an edge; fold it into the edge.
        let parent_is_edge = parent
            .as_deref()
            .and_then(|key| raw.get(key))
            .map(|entry| entry.cell.get("edge") == Some("1"))
            .unwrap_or(false);
        if parent_is_edge || style_has(&style, "edgeLabel") {
            if let Some(parent) = parent.filter(|value| !value.is_empty()) {
                let text = clean_label(Some(&entry.value));
                if !text.is_empty() {
                    edge_label_parts.entry(parent).or_default().push(text);
                }
            }
            continue;
        }

        let geom = entry.cell.find("mxGeometry");
        let mut attrs = serde_json::Map::new();
        for (key, value) in &entry.attrs {
            if matches!(key.as_str(), "link" | "tooltip") {
                continue;
            }
            attrs.insert(key.clone(), serde_json::Value::String(value.clone()));
        }
        page.nodes.push(Node {
            id: cid.clone(),
            label: clean_label(Some(&entry.value)),
            shape: classify_shape(&style),
            parent,
            depth: 0,
            x: num(geom, "x"),
            y: num(geom, "y"),
            w: num(geom, "width"),
            h: num(geom, "height"),
            fill: style_get_or(&style, "fillColor", "").to_string(),
            stroke: style_get_or(&style, "strokeColor", "").to_string(),
            font_color: style_get_or(&style, "fontColor", "").to_string(),
            dashed: style_get(&style, "dashed") == Some("1"),
            rounded: style_get(&style, "rounded") == Some("1"),
            container: style_get(&style, "container") == Some("1") || style_has(&style, "swimlane"),
            children: Vec::new(),
            link: entry
                .attrs
                .iter()
                .find(|(key, _)| key == "link")
                .map(|(_, value)| value.clone())
                .unwrap_or_default(),
            attrs,
            in_degree: 0,
            out_degree: 0,
        });
    }

    resolve_geometry(&mut page);

    // Pass 3: edges.
    let node_map = page.node_map();
    let known: Vec<String> = node_map.keys().map(|key| (*key).to_string()).collect();
    let known: std::collections::HashSet<String> = known.into_iter().collect();
    for cid in &order {
        let entry = &raw[cid];
        if entry.cell.get("edge") != Some("1") {
            continue;
        }
        let style = parse_style(entry.cell.get("style"));
        let geom = entry.cell.find("mxGeometry");
        let waypoints = geom
            .map(|geom| {
                geom.find_all_descendants("mxPoint")
                    .iter()
                    .filter(|point| point.get("as").is_none())
                    .count() as i64
            })
            .unwrap_or(0);
        let mut label = clean_label(Some(&entry.value));
        if let Some(extra) = edge_label_parts.get(cid) {
            if !extra.is_empty() {
                let mut parts: Vec<String> = Vec::new();
                if !label.is_empty() {
                    parts.push(label.clone());
                }
                parts.extend(extra.iter().filter(|part| !part.is_empty()).cloned());
                label = parts.join(" / ");
            }
        }
        let source = entry.cell.get("source").map(|value| value.to_string());
        let target = entry.cell.get("target").map(|value| value.to_string());
        let start_arrow = style_get_or(&style, "startArrow", "none");
        let end_arrow_defaulted = style_get_or(&style, "endArrow", "classic");
        page.edges.push(Edge {
            id: cid.clone(),
            source: source.filter(|value| known.contains(value)),
            target: target.filter(|value| known.contains(value)),
            label,
            dashed: style_get(&style, "dashed") == Some("1"),
            bidirectional: !matches!(start_arrow, "none" | "0" | "")
                && !matches!(end_arrow_defaulted, "none" | "0"),
            undirected: matches!(style_get(&style, "endArrow"), Some("none") | Some("0"))
                && matches!(start_arrow, "none" | "0" | ""),
            style_name: {
                let shape = style_get_or(&style, "shape", "");
                if shape.is_empty() {
                    if style_has(&style, "edgeStyle") {
                        "orthogonal".to_string()
                    } else {
                        String::new()
                    }
                } else {
                    shape.to_string()
                }
            },
            waypoints,
            stroke: style_get_or(&style, "strokeColor", "").to_string(),
        });
    }

    let node_map = page.node_map();
    let mut degrees: Vec<(usize, bool)> = Vec::new();
    for edge in &page.edges {
        if let Some(source) = edge.source.as_deref() {
            if let Some(index) = node_map.get(source) {
                degrees.push((*index, false));
            }
        }
        if let Some(target) = edge.target.as_deref() {
            if let Some(index) = node_map.get(target) {
                degrees.push((*index, true));
            }
        }
    }
    for (index, incoming) in degrees {
        if incoming {
            page.nodes[index].in_degree += 1;
        } else {
            page.nodes[index].out_degree += 1;
        }
    }

    Ok(page)
}

/// The Python resolves absolute geometry in place while iterating, so a node
/// whose parent was already rewritten reads the parent's absolute position and
/// then walks the chain again. That double-count is observable behaviour at
/// depth two and deeper, so it is reproduced rather than corrected.
fn resolve_geometry(page: &mut Page) {
    let node_map = page.node_map();
    let parent_index: Vec<Option<usize>> = page
        .nodes
        .iter()
        .map(|node| {
            node.parent
                .as_deref()
                .and_then(|parent| node_map.get(parent).copied())
        })
        .collect();
    let ids: Vec<String> = page.nodes.iter().map(|node| node.id.clone()).collect();

    fn resolve(
        nodes: &[Node],
        ids: &[String],
        parent_index: &[Option<usize>],
        index: usize,
        seen: &mut std::collections::HashSet<String>,
    ) -> (f64, f64, i64) {
        if !seen.insert(ids[index].clone()) {
            return (nodes[index].x, nodes[index].y, 0);
        }
        let Some(parent) = parent_index[index] else {
            return (nodes[index].x, nodes[index].y, 0);
        };
        let (px, py, pdepth) = resolve(nodes, ids, parent_index, parent, seen);
        (nodes[index].x + px, nodes[index].y + py, pdepth + 1)
    }

    for index in 0..page.nodes.len() {
        let mut seen = std::collections::HashSet::new();
        let (x, y, depth) = resolve(&page.nodes, &ids, &parent_index, index, &mut seen);
        page.nodes[index].x = x;
        page.nodes[index].y = y;
        page.nodes[index].depth = depth;
        if let Some(parent) = parent_index[index] {
            let child = page.nodes[index].id.clone();
            page.nodes[parent].children.push(child);
            page.nodes[parent].container = true;
        }
    }
}

/// `parse_file`.
pub fn parse_file(path: &str, xml: &str) -> Failable<Vec<Page>> {
    let file_name = crate::pyfmt::path_name(path);
    reject_unsafe_xml(xml, &file_name)?;
    let root = parse_document(xml)
        .map_err(|error| Fail::new(format!("{file_name}: malformed XML ({error})")))?;
    if root.name == "mxGraphModel" {
        let mut wrapper = Element::new("diagram");
        wrapper
            .attrs
            .push(("name".to_string(), crate::pyfmt::path_stem(path)));
        wrapper.attrs.push(("id".to_string(), "single".to_string()));
        wrapper.children.push(root);
        return Ok(vec![parse_page(&wrapper, 0)?]);
    }
    let diagrams = root.find_all_descendants("diagram");
    if diagrams.is_empty() {
        return Err(Fail::new(format!(
            "{file_name}: mxfile contains no <diagram> pages"
        )));
    }
    let mut pages = Vec::new();
    for (index, diagram) in diagrams.into_iter().enumerate() {
        pages.push(parse_page(diagram, index as i64)?);
    }
    Ok(pages)
}

/// `load_mxfile` — the `<mxfile>` (or bare `<mxGraphModel>`) XML for any input.
pub fn load_mxfile(path: &str, data: &[u8]) -> Failable<String> {
    let file_name = crate::pyfmt::path_name(path);
    if data.starts_with(crate::drawio::decode::PNG_MAGIC) {
        return match crate::drawio::decode::png_embedded_xml(data)? {
            Some(xml) if !xml.is_empty() => Ok(xml),
            _ => Err(Fail::new(format!(
                "{file_name}: PNG has no embedded draw.io diagram"
            ))),
        };
    }
    let decoded = String::from_utf8_lossy(data).into_owned();
    let text = decoded.trim_start_matches('\u{feff}').trim().to_string();
    if text.contains("<mxfile") || text.contains("<mxGraphModel") {
        return Ok(text);
    }
    let head: String = text.chars().take(2000).collect();
    if head.contains("<svg") {
        return match crate::drawio::decode::svg_embedded_xml(&text) {
            Some(xml) if !xml.is_empty() => Ok(xml),
            _ => Err(Fail::new(format!(
                "{file_name}: SVG has no embedded draw.io diagram"
            ))),
        };
    }
    if let Some(inflated) = inflate(&text)? {
        if inflated.contains("<mxGraphModel") {
            return Ok(inflated);
        }
    }
    Err(Fail::new(format!(
        "{file_name}: not a draw.io file (no mxfile, mxGraphModel, or payload)"
    )))
}

/// The decompression cap, re-exported for the digest's error messages.
pub const XML_LIMIT: usize = MAX_XML_BYTES;
