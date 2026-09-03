//! The deterministic stylistic scanners.
//!
//! Two audiences, one philosophy — no model, no network, no rendering:
//!
//! - [`prose`] scans prose and Markdown for AI writing tells (the `slop-scan`
//!   binary), scoring by the skill's Tier-1/Tier-2 weighting.
//! - [`design`] scans source for design anti-patterns (the `slop-detect`
//!   binary), covering the CLI-decidable layer of the slop catalogue.

pub mod design;
pub mod prose;
pub mod rules;
