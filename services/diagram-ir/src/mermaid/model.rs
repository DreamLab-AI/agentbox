//! The Mermaid IR. Field order is the dataclass declaration order, because
//! `asdict()` is what `--json` serialises.

use serde::Serialize;
use std::collections::HashMap;

use crate::mermaid::{MAX_EDGES, MAX_NODES};
use crate::{Fail, Failable};

#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub shape: String,
    pub parent: Option<String>,
    pub depth: i64,
    pub container: bool,
    pub children: Vec<String>,
    pub fields: Vec<String>,
    pub in_degree: i64,
    pub out_degree: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub label: String,
    pub style: String,
    pub arrowhead: String,
    pub bidirectional: bool,
    pub undirected: bool,
    pub order: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Fragment {
    pub kind: String,
    pub label: String,
    pub line: i64,
    pub depth: i64,
    pub regions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Discarded {
    pub style_directives: i64,
    pub click_handlers: i64,
}

#[derive(Debug, Clone)]
pub struct Diagram {
    pub index: i64,
    pub kind: String,
    pub source_line: i64,
    pub direction: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub fragments: Vec<Fragment>,
    pub notes: Vec<String>,
    pub discarded: Discarded,
    /// `_nodes_by_id` is `init=False, repr=False` on the dataclass and is never
    /// serialised; `to_json` builds its own dict.
    nodes_by_id: HashMap<String, usize>,
}

impl Diagram {
    pub fn new(index: i64, kind: &str, source_line: i64, direction: &str) -> Self {
        Diagram {
            index,
            kind: kind.to_string(),
            source_line,
            direction: direction.to_string(),
            nodes: Vec::new(),
            edges: Vec::new(),
            fragments: Vec::new(),
            notes: Vec::new(),
            discarded: Discarded {
                style_directives: 0,
                click_handlers: 0,
            },
            nodes_by_id: HashMap::new(),
        }
    }

    pub fn node_index(&self, node_id: &str) -> Option<usize> {
        self.nodes_by_id.get(node_id).copied()
    }

    pub fn contains(&self, node_id: &str) -> bool {
        self.nodes_by_id.contains_key(node_id)
    }

    fn depth_for(&self, parent: Option<&str>) -> i64 {
        let Some(parent) = parent else {
            return 0;
        };
        match self.node_index(parent) {
            Some(index) => self.nodes[index].depth + 1,
            None => 1,
        }
    }

    fn attach(&mut self, parent: &str, child: &str) {
        let Some(index) = self.node_index(parent) else {
            return;
        };
        if !self.nodes[index].children.iter().any(|item| item == child) {
            self.nodes[index].children.push(child.to_string());
            self.nodes[index].container = true;
        }
    }

    /// `add_node`.
    pub fn add_node(
        &mut self,
        node_id: &str,
        label: &str,
        shape: &str,
        parent: Option<&str>,
        container: bool,
    ) -> Failable<usize> {
        if let Some(index) = self.node_index(node_id) {
            if !label.is_empty()
                && (label != node_id || self.nodes[index].label == self.nodes[index].id)
            {
                self.nodes[index].label = label.to_string();
            }
            if shape != "rect" || self.nodes[index].shape.is_empty() {
                self.nodes[index].shape = shape.to_string();
            }
            if let Some(parent) = parent {
                if self.nodes[index].parent.is_none() {
                    self.nodes[index].parent = Some(parent.to_string());
                    self.nodes[index].depth = self.depth_for(Some(parent));
                    self.attach(parent, node_id);
                }
            }
            self.nodes[index].container = self.nodes[index].container || container;
            return Ok(index);
        }
        if self.nodes.len() >= MAX_NODES {
            return Err(Fail::new(format!("node limit exceeded (max {MAX_NODES})")));
        }
        let depth = self.depth_for(parent);
        let node = Node {
            id: node_id.to_string(),
            label: if label.is_empty() {
                node_id.to_string()
            } else {
                label.to_string()
            },
            shape: shape.to_string(),
            parent: parent.map(str::to_string),
            depth,
            container,
            children: Vec::new(),
            fields: Vec::new(),
            in_degree: 0,
            out_degree: 0,
        };
        let index = self.nodes.len();
        self.nodes.push(node);
        self.nodes_by_id.insert(node_id.to_string(), index);
        if let Some(parent) = parent {
            self.attach(parent, node_id);
        }
        Ok(index)
    }

    /// `add_edge`.
    #[allow(clippy::too_many_arguments)]
    pub fn add_edge(
        &mut self,
        source: &str,
        target: &str,
        label: &str,
        style: &str,
        arrowhead: &str,
        bidirectional: bool,
        undirected: bool,
    ) -> Failable<()> {
        if self.edges.len() >= MAX_EDGES {
            return Err(Fail::new(format!("edge limit exceeded (max {MAX_EDGES})")));
        }
        let order = self.edges.len() as i64 + 1;
        self.edges.push(Edge {
            id: format!("e{order}"),
            source: source.to_string(),
            target: target.to_string(),
            label: label.to_string(),
            style: style.to_string(),
            arrowhead: arrowhead.to_string(),
            bidirectional,
            undirected,
            order,
        });
        Ok(())
    }

    /// `add_edge` with the flowchart/state defaults.
    pub fn add_plain_edge(&mut self, source: &str, target: &str, label: &str) -> Failable<()> {
        self.add_edge(source, target, label, "solid", "arrow", false, false)
    }

    /// `_finalize_degrees`.
    pub fn finalise_degrees(&mut self) {
        let mut updates: Vec<(usize, bool)> = Vec::new();
        for edge in &self.edges {
            if let Some(index) = self.nodes_by_id.get(&edge.source) {
                updates.push((*index, false));
            }
            if let Some(index) = self.nodes_by_id.get(&edge.target) {
                updates.push((*index, true));
            }
        }
        for (index, incoming) in updates {
            if incoming {
                self.nodes[index].in_degree += 1;
            } else {
                self.nodes[index].out_degree += 1;
            }
        }
    }
}
