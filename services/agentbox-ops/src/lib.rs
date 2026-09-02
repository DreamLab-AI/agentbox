//! Shared logic for the `agentbox-ops` tool suite.
//!
//! Each binary in this crate replaces a Python script retired by the
//! 2026-09-02 estate legacy audit. The modules here hold the behaviour that
//! is worth unit-testing independently of the CLI shell around it.

pub mod distil;
pub mod hermes;
pub mod procs;
pub mod pyjson;
pub mod solar;
pub mod token_audit;
pub mod voyager;
