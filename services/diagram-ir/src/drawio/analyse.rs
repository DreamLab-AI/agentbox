//! Structural analysis of a draw.io page — signals, never decisions.

use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::drawio::model::{Edge, Node, Page};
use crate::drawio::style::shape_family;

#[derive(Debug, Clone, Serialize)]
pub struct Hub {
    pub id: String,
    pub label: String,
    pub degree: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Collapsible {
    pub id: String,
    pub label: String,
    pub children: i64,
    pub child_labels: Vec<String>,
}

/// Key order mirrors the Python dict literal, which is what `--json` emits.
#[derive(Debug, Clone, Serialize)]
pub struct Analysis {
    pub nodes_total: i64,
    pub nodes_drawable: i64,
    pub containers: i64,
    pub leaves: i64,
    pub edges_total: i64,
    pub edges_labeled: i64,
    pub edges_dangling: i64,
    pub max_depth: i64,
    pub shapes: serde_json::Map<String, serde_json::Value>,
    pub has_cycle: bool,
    pub hubs: Vec<Hub>,
    pub entry_points: Vec<String>,
    pub terminals: Vec<String>,
    pub orphans: Vec<String>,
    pub type_candidates: Vec<String>,
    pub collapsible_groups: Vec<Collapsible>,
    pub over_node_budget: bool,
    pub over_edge_budget: bool,
}

impl Analysis {
    /// The `shapes` dict as ordered pairs, for the digest's Python-`repr` line.
    pub fn shape_pairs(&self) -> Vec<(String, i64)> {
        self.shapes
            .iter()
            .map(|(key, value)| (key.clone(), value.as_i64().unwrap_or(0)))
            .collect()
    }
}

const WHITE: u8 = 0;
const GREY: u8 = 1;
const BLACK: u8 = 2;

/// `_has_cycle` — an edge is followed when its source is a known node; an
/// unknown target counts as already finished.
pub fn has_cycle(nodes: &[Node], edges: &[Edge]) -> bool {
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in nodes {
        adjacency.entry(node.id.as_str()).or_default();
    }
    for edge in edges {
        if let (Some(source), Some(target)) = (edge.source.as_deref(), edge.target.as_deref()) {
            if let Some(list) = adjacency.get_mut(source) {
                list.push(target);
            }
        }
    }
    let mut colour: HashMap<&str, u8> =
        nodes.iter().map(|node| (node.id.as_str(), WHITE)).collect();

    for node in nodes {
        if colour.get(node.id.as_str()).copied().unwrap_or(BLACK) != WHITE {
            continue;
        }
        if visit(&adjacency, &mut colour, node.id.as_str()) {
            return true;
        }
    }
    false
}

fn visit<'a>(
    adjacency: &HashMap<&'a str, Vec<&'a str>>,
    colour: &mut HashMap<&'a str, u8>,
    start: &'a str,
) -> bool {
    let mut stack: Vec<(&'a str, usize)> = vec![(start, 0)];
    colour.insert(start, GREY);
    while !stack.is_empty() {
        let top = stack.len() - 1;
        let node = stack[top].0;
        let neighbours = adjacency.get(node).map(Vec::as_slice).unwrap_or(&[]);
        let mut advanced = false;
        while stack[top].1 < neighbours.len() {
            let next = neighbours[stack[top].1];
            stack[top].1 += 1;
            match colour.get(next).copied().unwrap_or(BLACK) {
                GREY => return true,
                WHITE => {
                    colour.insert(next, GREY);
                    stack.push((next, 0));
                    advanced = true;
                    break;
                }
                _ => {}
            }
        }
        if !advanced {
            colour.insert(node, BLACK);
            stack.pop();
        }
    }
    false
}

/// `_aligned` — true when the boxes stack as lanes.
pub fn aligned(boxes: &[&Node], tolerance: f64) -> bool {
    if boxes.len() < 2 {
        return false;
    }
    let spread = |values: Vec<f64>| -> f64 {
        let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
        max - min
    };
    let same_x = spread(boxes.iter().map(|node| node.x).collect()) <= tolerance;
    let same_w = spread(boxes.iter().map(|node| node.w).collect()) <= tolerance;
    let same_y = spread(boxes.iter().map(|node| node.y).collect()) <= tolerance;
    let same_h = spread(boxes.iter().map(|node| node.h).collect()) <= tolerance;
    (same_x && same_w) || (same_y && same_h)
}

fn name_of(node: &Node) -> String {
    if node.label.is_empty() {
        node.id.clone()
    } else {
        node.label.replace('\n', " · ")
    }
}

/// `page_bounds`.
pub fn page_bounds(page: &Page) -> (f64, f64, f64, f64) {
    let boxes: Vec<(f64, f64, f64, f64)> = page
        .nodes
        .iter()
        .filter(|node| node.w != 0.0 && node.h != 0.0)
        .map(|node| (node.x, node.y, node.x + node.w, node.y + node.h))
        .collect();
    if boxes.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    (
        boxes.iter().map(|b| b.0).fold(f64::INFINITY, f64::min),
        boxes.iter().map(|b| b.1).fold(f64::INFINITY, f64::min),
        boxes.iter().map(|b| b.2).fold(f64::NEG_INFINITY, f64::max),
        boxes.iter().map(|b| b.3).fold(f64::NEG_INFINITY, f64::max),
    )
}

/// `analyze`.
pub fn analyse(page: &Page) -> Analysis {
    let nodes = &page.nodes;
    let edges = &page.edges;
    let node_map = page.node_map();

    let drawable = nodes
        .iter()
        .filter(|node| {
            node.shape != "text" && (!node.label.is_empty() || !node.children.is_empty())
        })
        .count();
    let containers: Vec<&Node> = nodes
        .iter()
        .filter(|node| !node.children.is_empty())
        .collect();
    let leaves: Vec<&Node> = nodes
        .iter()
        .filter(|node| node.children.is_empty())
        .collect();

    let mut shape_order: Vec<String> = Vec::new();
    let mut shape_counts: HashMap<String, i64> = HashMap::new();
    for node in nodes {
        let family = shape_family(&node.shape);
        if !shape_counts.contains_key(&family) {
            shape_order.push(family.clone());
        }
        *shape_counts.entry(family).or_insert(0) += 1;
    }
    // `sorted(..., key=lambda kv: -kv[1])` is stable, so ties keep first-seen order.
    let mut ordered: Vec<(String, i64)> = shape_order
        .iter()
        .map(|family| (family.clone(), shape_counts[family]))
        .collect();
    ordered.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    let mut shapes = serde_json::Map::new();
    for (family, count) in &ordered {
        shapes.insert(family.clone(), serde_json::Value::from(*count));
    }
    let shape_count = |name: &str| shape_counts.get(name).copied().unwrap_or(0);

    let mut ranked: Vec<&Node> = leaves.clone();
    ranked.sort_by(|left, right| {
        (right.in_degree + right.out_degree).cmp(&(left.in_degree + left.out_degree))
    });
    let hubs: Vec<Hub> = ranked
        .iter()
        .take(5)
        .filter(|node| node.in_degree + node.out_degree > 0)
        .map(|node| Hub {
            id: node.id.clone(),
            label: name_of(node),
            degree: node.in_degree + node.out_degree,
        })
        .collect();

    let sources: Vec<String> = leaves
        .iter()
        .filter(|node| node.out_degree != 0 && node.in_degree == 0)
        .map(|node| name_of(node))
        .collect();
    let sinks: Vec<String> = leaves
        .iter()
        .filter(|node| node.in_degree != 0 && node.out_degree == 0)
        .map(|node| name_of(node))
        .collect();
    let orphans: Vec<String> = leaves
        .iter()
        .filter(|node| node.in_degree == 0 && node.out_degree == 0)
        .map(|node| name_of(node))
        .collect();

    // Type candidates, strongest signal first. Advisory only.
    let mut candidates: Vec<String> = Vec::new();
    if shape_count("lifeline") != 0 {
        candidates.push("sequence".to_string());
    }
    if shape_count("table") != 0 || shape_count("er") != 0 {
        candidates.push("er".to_string());
    }
    let lanes: Vec<&Node> = nodes
        .iter()
        .filter(|node| node.shape == "swimlane" && !node.children.is_empty())
        .collect();
    if lanes.len() >= 2 && aligned(&lanes, 8.0) {
        candidates.push("swimlane".to_string());
    }
    if shape_count("rhombus") != 0 {
        candidates.push("flowchart".to_string());
    }
    if shape_count("ellipse") >= std::cmp::max(2, (leaves.len() / 3) as i64) && !edges.is_empty() {
        candidates.push("state".to_string());
    }
    if ["aws", "azure", "gcp", "kubernetes", "network"]
        .iter()
        .any(|family| shape_counts.contains_key(*family))
    {
        candidates.push("architecture".to_string());
    }
    if !containers.is_empty() && shape_count("swimlane") == 0 {
        candidates.push("nested".to_string());
    }
    if !edges.is_empty() && !has_cycle(nodes, edges) && sources.len() == 1 {
        candidates.push("tree".to_string());
    }
    if !edges.is_empty() {
        candidates.push("architecture".to_string());
    }
    if candidates.is_empty() {
        candidates.push("architecture".to_string());
    }
    let mut seen: HashSet<String> = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));

    let mut collapsible: Vec<Collapsible> = containers
        .iter()
        .filter(|container| {
            !container.children.is_empty()
                && container.children.iter().all(|child| {
                    node_map
                        .get(child.as_str())
                        .map(|index| nodes[*index].children.is_empty())
                        .unwrap_or(false)
                })
        })
        .map(|container| Collapsible {
            id: container.id.clone(),
            label: name_of(container),
            children: container.children.len() as i64,
            child_labels: container
                .children
                .iter()
                .filter_map(|child| node_map.get(child.as_str()).map(|index| &nodes[*index]))
                .filter(|child| !child.label.is_empty())
                .map(name_of)
                .take(8)
                .collect(),
        })
        .collect();
    collapsible.sort_by_key(|group| std::cmp::Reverse(group.children));

    Analysis {
        nodes_total: nodes.len() as i64,
        nodes_drawable: drawable as i64,
        containers: containers.len() as i64,
        leaves: leaves.len() as i64,
        edges_total: edges.len() as i64,
        edges_labeled: edges.iter().filter(|edge| !edge.label.is_empty()).count() as i64,
        edges_dangling: edges
            .iter()
            .filter(|edge| !(edge.source.is_some() && edge.target.is_some()))
            .count() as i64,
        max_depth: nodes.iter().map(|node| node.depth).max().unwrap_or(0),
        shapes,
        has_cycle: has_cycle(nodes, edges),
        hubs,
        entry_points: sources.iter().take(6).cloned().collect(),
        terminals: sinks.iter().take(6).cloned().collect(),
        orphans: orphans.iter().take(6).cloned().collect(),
        type_candidates: candidates.into_iter().take(3).collect(),
        collapsible_groups: collapsible.into_iter().take(8).collect(),
        over_node_budget: drawable > 9,
        over_edge_budget: edges.len() > 12,
    }
}
