//! `colloquy-mcp` — the six verbs, as an MCP server.
//!
//! `query`, `propose`, `confirm`, `flag`, `reflect`, `status`, over
//! newline-delimited JSON-RPC on stdio, against any [`colloquy_store`] tier.
//!
//! This supersedes the JavaScript precedent bridge, which implemented the same
//! idea for exactly one kind of knowledge — governance decisions. The
//! generalisation is the point: the machinery for "the system learned something
//! and a human approved it" was never specific to governance.
//!
//! ```
//! use colloquy_mcp::{server::Server, verbs::Identity};
//! use colloquy_store::LocalStore;
//!
//! let server = Server::new(
//!     LocalStore::in_memory(),
//!     Identity::agent("did:nostr:scribe", "did:nostr:operator"),
//! );
//! // server.serve_stdio(|| colloquy_core::Timestamp::from_secs(0)).await
//! # let _ = server;
//! ```

#![forbid(unsafe_code)]
#![deny(
    missing_docs,
    missing_debug_implementations,
    rustdoc::broken_intra_doc_links
)]

pub mod protocol;
pub mod server;
pub mod verbs;

pub use server::{Server, PROTOCOL_VERSION, SERVER_NAME};
pub use verbs::Identity;
