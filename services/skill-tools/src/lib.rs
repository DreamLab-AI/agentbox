//! Rust ports of three families of agentbox Python skill tooling:
//!
//! - [`uiux`]: BM25 search + design-system generation for the `ui-ux-pro-max-skill` skill.
//! - [`wardley`]: Wardley Map generation, heuristics, interactive D3 rendering and
//!   strategic analysis for the `wardley-maps` skill.
//! - [`docs_alignment`]: documentation link/mermaid/ASCII validation and reporting for
//!   the `docs-alignment` skill.
//!
//! Each module is self-contained and backs one or more `[[bin]]` targets declared in
//! `Cargo.toml`. See each module's own documentation for its public API.

pub mod docs_alignment;
pub mod uiux;
pub mod wardley;
