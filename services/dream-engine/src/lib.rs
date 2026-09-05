//! Dream engine — nightly evidence-gated repository evolution.
//!
//! The acceptance path is deliberately split into small, pure, testable pieces
//! (ADR-2024 closeout):
//!
//! [`readiness`] refuses an unusable nomination before scheduling →
//! [`manifest`] freezes what the experiment is, before any model call →
//! [`runner`] executes evaluators behind a seam → [`receipts`] types and
//! persists their raw results → [`candidate`] applies the emitted patch in
//! isolation and re-runs the required evaluators → [`gate`] decides, from the
//! receipts alone, whether ACCEPT survives. [`runstate`] keeps the run
//! restart-safe and [`roster`] keeps the nightly schedule fair.

pub mod candidate;
pub mod compile;
pub mod config;
pub mod context;
pub mod dispatch;
pub mod engine;
pub mod gate;
pub mod inbox;
pub mod ledger;
pub mod llm;
pub mod manifest;
pub mod persist;
pub mod readiness;
pub mod receipts;
pub mod roster;
pub mod runner;
pub mod runstate;
pub mod ruvector;
pub mod verdict;
pub mod witness;
