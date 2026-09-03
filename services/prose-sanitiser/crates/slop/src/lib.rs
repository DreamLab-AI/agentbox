//! The deterministic stylistic scanners.
//!
//! Two audiences, one philosophy — no model, no network, no rendering:
//!
//! - [`prose`] scans prose and Markdown for AI writing tells (the `slop-scan`
//!   binary), scoring by the skill's Tier-1/Tier-2 weighting.
//! - [`design`] scans source for design anti-patterns (the `slop-detect`
//!   binary), covering the CLI-decidable layer of the slop catalogue.
//!
//! # Honest scope
//!
//! From the capability matrix (section B of the design brief), everything in
//! this crate sits in **can detect and report, but must not claim to strip**:
//!
//! | Capability | Why |
//! |---|---|
//! | AI stylistic tells (lexical, structural, narrative) | Heuristic, not forensic. Population-level evidence only |
//!
//! These are population-level signals, not forensic ones. Lexical markers are
//! well quantified across large corpora, but **no single marker identifies a
//! document**, and a clean scan is not evidence of human authorship any more
//! than a dirty one is evidence of a model. A finding here is a prompt for an
//! editor to look, never a verdict.
//!
//! Because lexical markers decay as models update, the tables are a snapshot
//! rather than a constant, and should be re-derived rather than trusted
//! indefinitely.
//!
//! # Versioned tables
//!
//! Because lexical markers decay as models update, the tables are a snapshot
//! rather than a constant. [`rules::RULESET_VERSION`] stamps every report,
//! every rule carries `since`, `reviewed` and its `sources`, and
//! [`rules::CHANGELOG`] records what moved between versions and on what
//! evidence. A rule whose `reviewed` date is stale is visible as data.
//!
//! # Library API
//!
//! [`SlopChecker`] is the [`prose_sanitiser_core::Check`] implementation:
//! `check(&str, &Config) -> Vec<Finding>` with real byte spans, never
//! mutating, honouring the HTML-comment suppression directives and the
//! language pre-filter. There is deliberately no `Fix` implementation, because
//! no rule here emits a replacement.
//!
//! [`structural`] adds the whole-document measures, reported as rates per
//! 10,000 words against the published Common Crawl figures. They are opt-in.
//!
//! The UK-English rule the prose table carries is owned by
//! `prose-sanitiser-uk`; [`rules`] references its constants so the two cannot
//! drift.

pub mod check;
pub mod design;
pub mod prose;
pub mod rules;
pub mod structural;

pub use check::SlopChecker;
pub use rules::{FIXABILITY, RULESET_REVIEWED, RULESET_VERSION};
pub use structural::StructuralMetrics;
