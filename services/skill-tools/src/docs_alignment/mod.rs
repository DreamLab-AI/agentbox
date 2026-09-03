//! Rust port of the `docs-alignment` skill's Python validator tooling:
//! link/orphan validation, Mermaid diagram checking, ASCII-art diagram
//! detection, Markdown report generation, and the orchestrator that ties
//! them (plus the two still-Python `archive_working_docs.py` /
//! `scan_stubs.py` scripts) together.
//!
//! Each submodule ports exactly one Python script:
//!
//! | Module | Python source |
//! |---|---|
//! | [`links`] / [`links_external`] | `validate_links.py` |
//! | [`mermaid`] | `check_mermaid.py` |
//! | [`ascii_diagrams`] | `detect_ascii.py` |
//! | [`report`] | `generate_report.py` |
//! | [`orchestrator`] | `docs_alignment.py` |
//!
//! [`models`] holds the shared JSON report shapes and [`cli`] holds small
//! helpers (JSON-or-file output, ignore-pattern matching) shared by the five
//! `[[bin]]` targets in `src/bin/`.

pub mod ascii_diagrams;
pub mod cli;
pub mod links;
pub mod links_external;
pub mod mermaid;
pub mod models;
pub mod orchestrator;
pub mod report;
mod report_sections;
