//! `colloquy-store` — one contract, three tiers.
//!
//! cq's tier architecture promises that "API contracts remain stable across
//! backing store implementations". [`KnowledgeStore`] is that contract, and the
//! three implementations here are the tiers this estate actually has:
//!
//! | Tier | Implementation | Retrieval | Backed by |
//! |---|---|---|---|
//! | Local | [`LocalStore`] | keywords | an append-only JSON-lines file, or nothing |
//! | Shared | [`SharedStore`] | vectors | [`VectorBackend`] — RuVector in deployment |
//! | Public | [`RelayStore`] | tag filters | [`RelayBackend`] — the Nostr relay |
//!
//! The two backends are traits rather than concrete clients on purpose. This
//! crate owns the *mapping*, which is where the mistakes live; the transport
//! belongs to whoever configured the deployment, and keeping it out means this
//! crate has no credentials, no key material, and no opinion about which sidecar
//! is running.
//!
//! # No fourth slot
//!
//! Colloquy consumes the estate's existing memory and event adapter slots. It
//! does not add one. A knowledge store is a *consumer* of durable state, not a
//! new kind of durable state, and the adapter contract is not negotiable.

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rustdoc::broken_intra_doc_links)]

pub mod local;
pub mod query;
pub mod relay;
pub mod shared;
pub mod store;

pub use local::LocalStore;
pub use query::{Hit, Query, Stats};
pub use relay::{Filter, RelayBackend, RelayStore};
pub use shared::{SharedStore, VectorBackend};
pub use store::{KnowledgeStore, StoreError, StorePolicies, StoredUnit};

/// The README's examples, compiled and run as doctests.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
