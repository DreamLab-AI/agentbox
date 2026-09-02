//! Rust port of the `ui-ux-pro-max-skill`'s Python tooling (`core.py`, `search.py`,
//! `design_system.py`): a BM25 search engine over CSV reference data (styles, color
//! palettes, font pairings, chart types, per-stack implementation guidelines, ...)
//! plus a design-system generator that aggregates multi-domain search results with
//! a small reasoning layer and can persist the result as a Master + Overrides
//! Markdown file pair.
//!
//! # Module map
//!
//! - [`data`] — CSV reference data, embedded at compile time via `include_str!`
//!   directly from `skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/`.
//! - [`config`] — `CSV_CONFIG`/`STACK_CONFIG` static metadata (`core.py`).
//! - [`bm25`] — the BM25 ranking engine and tokenizer (`core.py`'s `BM25` class).
//! - [`domain_detect`] — `detect_domain` (`core.py`).
//! - [`outcome`] — `OrderedRow`/`SearchOutcome` result types shared by `search`/
//!   `search_stack` (mirroring the plain dicts `core.py` returns).
//! - [`search_core`] — `search`/`search_stack` (`core.py`).
//! - [`design_system`] — `DesignSystem`/`generate_design_system_text` (module-level
//!   surface of `design_system.py`).
//! - [`design_system_generator`] — `DesignSystemGenerator` (`design_system.py`).
//! - [`formatters`] — `format_ascii_box`/`format_markdown` (`design_system.py`).
//! - [`master_md`] — `format_master_md` (`design_system.py`).
//! - [`page_override`] — `format_page_override_md`/`_generate_intelligent_overrides`/
//!   `_detect_page_type` (`design_system.py`).
//! - [`persist`] — `persist_design_system` (`design_system.py`).
//! - [`cli`] — the `uiux-search` binary's argument parsing and `run()` entry point,
//!   plus `format_output` (`search.py`).

pub mod bm25;
pub mod cli;
pub mod config;
pub mod data;
pub mod design_system;
pub mod design_system_generator;
pub mod domain_detect;
pub mod formatters;
pub mod master_md;
pub mod outcome;
pub mod page_override;
pub mod persist;
pub mod search_core;

pub use bm25::Bm25;
pub use design_system::DesignSystem;
pub use design_system_generator::DesignSystemGenerator;
pub use domain_detect::detect_domain;
pub use outcome::{OrderedRow, SearchOutcome};
pub use search_core::{search, search_stack};
