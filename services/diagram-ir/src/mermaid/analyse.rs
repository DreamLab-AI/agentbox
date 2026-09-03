//! Structural analysis of a Mermaid diagram.

use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::mermaid::model::{Diagram, Edge, Node};

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

/// `_has_cycle` — unlike the draw.io side, both endpoints must be known nodes.
pub fn has_cycle(nodes: &[Node], edges: &[Edge]) -> bool {
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in nodes {
        adjacency.entry(node.id.as_str()).or_default();
    }
    let ids: HashMap<&str, &str> = nodes
        .iter()
        .map(|node| (node.id.as_str(), node.id.as_str()))
        .collect();
    for edge in edges {
        let source = ids.get(edge.source.as_str());
        let target = ids.get(edge.target.as_str());
        if let (Some(source), Some(target)) = (source, target) {
            if let Some(list) = adjacency.get_mut(*source) {
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

/// `shape_family` — the Mermaid IR already stores canonical families.
pub fn shape_family(shape: &str) -> String {
    shape.to_string()
}

fn name(node: &Node) -> String {
    if node.label.is_empty() {
        node.id.clone()
    } else {
        node.label.replace('\n', " · ")
    }
}

/// `analyze`.
pub fn analyse(diagram: &Diagram) -> Analysis {
    let containers: Vec<&Node> = diagram
        .nodes
        .iter()
        .filter(|node| node.container || !node.children.is_empty())
        .collect();
    let leaves: Vec<&Node> = diagram
        .nodes
        .iter()
        .filter(|node| !(node.container || !node.children.is_empty()))
        .collect();

    let mut counts: HashMap<String, i64> = HashMap::new();
    for node in &diagram.nodes {
        *counts.entry(shape_family(&node.shape)).or_insert(0) += 1;
    }
    let mut ordered: Vec<(String, i64)> = counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
    ordered.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let mut shapes = serde_json::Map::new();
    for (family, count) in &ordered {
        shapes.insert(family.clone(), serde_json::Value::from(*count));
    }

    let mut ranked: Vec<&Node> = leaves.clone();
    ranked.sort_by(|left, right| {
        let left_key = (left.in_degree + left.out_degree, &left.id);
        let right_key = (right.in_degree + right.out_degree, &right.id);
        right_key.cmp(&left_key)
    });
    let hubs: Vec<Hub> = ranked
        .iter()
        .take(5)
        .filter(|node| node.in_degree + node.out_degree > 0)
        .map(|node| Hub {
            id: node.id.clone(),
            label: name(node),
            degree: node.in_degree + node.out_degree,
        })
        .collect();

    let entry_points: Vec<String> = leaves
        .iter()
        .filter(|node| node.out_degree != 0 && node.in_degree == 0)
        .map(|node| name(node))
        .collect();
    let terminals: Vec<String> = leaves
        .iter()
        .filter(|node| node.in_degree != 0 && node.out_degree == 0)
        .map(|node| name(node))
        .collect();
    let orphans: Vec<String> = leaves
        .iter()
        .filter(|node| node.in_degree == 0 && node.out_degree == 0)
        .map(|node| name(node))
        .collect();

    let raw_candidates: Vec<&str> = match diagram.kind.as_str() {
        "flowchart" => vec![
            if counts.get("rhombus").copied().unwrap_or(0) != 0 {
                "flowchart"
            } else {
                "architecture"
            },
            "architecture",
        ],
        "sequenceDiagram" => vec!["sequence"],
        "stateDiagram-v2" => vec!["state machine"],
        _ => vec!["ER / data model"],
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let candidates: Vec<String> = raw_candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate))
        .map(str::to_string)
        .collect();

    let index: HashMap<&str, &Node> = diagram
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let mut collapsible: Vec<Collapsible> = containers
        .iter()
        .filter(|node| !node.children.is_empty())
        .map(|node| Collapsible {
            id: node.id.clone(),
            label: name(node),
            children: node.children.len() as i64,
            child_labels: node
                .children
                .iter()
                .filter_map(|child| index.get(child.as_str()))
                .map(|child| name(child))
                .take(8)
                .collect(),
        })
        .collect();
    collapsible.sort_by_key(|group| std::cmp::Reverse(group.children));

    let drawable = leaves.len();
    Analysis {
        nodes_total: diagram.nodes.len() as i64,
        nodes_drawable: drawable as i64,
        containers: containers.len() as i64,
        leaves: leaves.len() as i64,
        edges_total: diagram.edges.len() as i64,
        edges_labeled: diagram
            .edges
            .iter()
            .filter(|edge| !edge.label.is_empty())
            .count() as i64,
        edges_dangling: 0,
        max_depth: diagram
            .nodes
            .iter()
            .map(|node| node.depth)
            .max()
            .unwrap_or(0),
        shapes,
        has_cycle: has_cycle(&diagram.nodes, &diagram.edges),
        hubs,
        entry_points: entry_points.iter().take(6).cloned().collect(),
        terminals: terminals.iter().take(6).cloned().collect(),
        orphans: orphans.iter().take(6).cloned().collect(),
        type_candidates: candidates,
        collapsible_groups: collapsible.into_iter().take(8).collect(),
        over_node_budget: drawable > 9,
        over_edge_budget: diagram.edges.len() > 12,
    }
}
