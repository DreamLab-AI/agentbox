//! Rust ports of four families of agentbox Python skill tooling:
//!
//! - [`uiux`]: BM25 search + design-system generation for the `ui-ux-pro-max-skill` skill.
//! - [`wardley`]: Wardley Map generation, heuristics, interactive D3 rendering and
//!   strategic analysis for the `wardley-maps` skill.
//! - [`docs_alignment`]: documentation link/mermaid/ASCII validation and reporting for
//!   the `docs-alignment` skill.
//! - [`paper_orchestra`]: deterministic helpers for the `paper-orchestra` skill family
//!   (workspace scaffolding, input and outline validation, claim-evidence and citation
//!   gates, refinement-loop arithmetic, and arXiv preflight).
//!
//! Each module is self-contained and backs one or more `[[bin]]` targets declared in
//! `Cargo.toml`. See each module's own documentation for its public API.

pub mod docs_alignment;
pub mod paper_orchestra;
pub mod uiux;
pub mod wardley;
