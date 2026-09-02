//! Shared JSON report struct definitions for the docs-alignment tooling.
//!
//! These mirror the Python `@dataclass` shapes in `validate_links.py` and
//! `check_mermaid.py` field-for-field (name, order, optionality) so the JSON
//! produced by the Rust binaries is a drop-in replacement for the Python
//! output consumed by `docs_alignment.py` / `generate_report.py`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A single link found in a markdown document (`validate_links.py::LinkInfo`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkInfo {
    pub source_file: String,
    pub line_number: usize,
    pub link_text: String,
    pub link_target: String,
    /// One of: "internal", "external", "anchor", "code".
    pub link_type: String,
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

/// Full link-validation report (`validate_links.py::ValidationReport`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub total_files: usize,
    pub total_links: usize,
    pub valid_links: usize,
    pub broken_links: Vec<LinkInfo>,
    pub orphan_docs: Vec<String>,
    /// docs -> code targets
    pub forward_links: BTreeMap<String, Vec<String>>,
    /// docs -> docs targets
    pub backward_links: BTreeMap<String, Vec<String>>,
    pub anchor_errors: Vec<LinkInfo>,
}

/// A single mermaid diagram found in a markdown document
/// (`check_mermaid.py::MermaidDiagram`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidDiagram {
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
    pub diagram_type: String,
    pub content: String,
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

/// Full mermaid-validation report shape returned by `MermaidValidator::run`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidReport {
    pub total_diagrams: usize,
    pub valid_diagrams: usize,
    pub invalid_diagrams: usize,
    pub by_type: BTreeMap<String, usize>,
    pub mmdc_available: bool,
    pub valid_diagram_list: Vec<MermaidDiagram>,
    pub invalid_diagram_list: Vec<MermaidDiagram>,
    pub suggestions: Vec<String>,
}

/// A single detected ASCII-art diagram (`detect_ascii.py::AsciiDiagram`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsciiDiagram {
    pub file: String,
    pub start_line: usize,
    pub end_line: usize,
    pub diagram_type: String,
    pub preview: String,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

/// Full ASCII-detection report shape returned by `AsciiDiagramDetector::run`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsciiReport {
    pub total_detected: usize,
    pub high_confidence: usize,
    pub by_type: BTreeMap<String, usize>,
    pub ascii_diagrams: Vec<AsciiDiagram>,
    pub priority_conversions: Vec<AsciiDiagram>,
}
