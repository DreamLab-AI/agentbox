//! Port of `promote.py` — ledger-promotion candidacy detector, dossier
//! assembly, and the blind-judge + answer-completeness pre-filter. See
//! `skills/podcast-knowledge-ingest/references/promotion.md` for the full
//! contract this implements.

pub mod candidate;
pub mod completeness;
pub mod dossier;
pub mod gemini;
pub mod judge;
pub mod ledger_parse;
pub mod loom;
pub mod run;
pub mod splice;
pub mod working_page;

pub const DEFAULT_LOOM_URL: &str = "http://192.168.2.132:8084/v1";
pub const DEFAULT_LOOM_MODEL: &str = "qwen3.8-27b";

pub use run::run_main;
