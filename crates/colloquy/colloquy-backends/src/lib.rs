//! `colloquy-backends` — the production transports.
//!
//! `colloquy-store` defines what the shared and public tiers *do*;
//! this crate is how they actually reach RuVector and the Nostr relay. The split
//! exists so the mapping can be tested without a database or a network, and so
//! this crate — which has credentials, a key, and a child process — stays small
//! enough to read in one sitting.
//!
//! Nothing here is a stand-in. [`RuvectorBackend`] spawns the same
//! `ruvector-mcp.cjs` the rest of the estate talks to, so the embedding pipeline
//! and the protected-namespace gates apply unchanged. [`WsRelayBackend`] opens a
//! real websocket to the relay and signs with the container's own key.

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rustdoc::broken_intra_doc_links)]

pub mod compat;
pub mod mcp_client;
pub mod relay_ws;
pub mod ruvector;

pub use mcp_client::{McpError, McpStdioClient};
pub use relay_ws::{RelayWsError, WsRelayBackend};
pub use ruvector::RuvectorBackend;
