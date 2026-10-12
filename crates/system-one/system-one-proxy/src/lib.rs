//! `system-one-proxy`: the loopback typed-decision endpoint every System One
//! consumer in agentbox calls (ADR-2139).
//!
//! The judge is a vendor slot. This proxy forwards `POST /v1/systemone` to the
//! backend named in its projection file (`/run/agentbox/system-one.json`),
//! owns the vendor keys and enforces two rules the consumers cannot:
//!
//! * a key goes only to the host it is paired with ([`key`]);
//! * consumers projected `local` at boot never reach a cloud backend
//!   ([`server`], ADR-2094 §5).
//!
//! Modules: [`config`] (the watched projection), [`key`] (credentials),
//! [`server`] (routes), [`error`] (the envelope).

pub mod config;
pub mod error;
pub mod key;
pub mod server;
