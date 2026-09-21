//! Sovereign System One — the capacity-adapting façade.
//!
//! Two consumers in this estate ask a typed-decision judge three primitives —
//! `choice`, `score`, `noul` — and both currently ask TypeSafe's cloud API:
//! the live skill router (ADR-2091) and the Jev verbatim compaction plugin
//! (ADR-2093). Laya is an open-weights encoder that answers the same three
//! primitives locally in ~30 ms, but its context is 512–1024 tokens while the
//! router sends ~15,000 and compaction sends up to 25,000. It also amputates
//! every option at 48 tokens, tail-first, before any budget logic runs.
//!
//! This crate is the gap-closer, and it is deliberately thin. The protocol,
//! the budget arithmetic and the two adaptations are
//! [`system_one_core`]'s — this binary does not carry a second copy of
//! `fit_options`, `window_state`, the `aggregate_*` family or `expand_choice`,
//! because the invariants those enforce are only worth testing once. What is
//! here is the server around them:
//!
//! * **[`service`]** — the sequencing: capabilities, compress, shortlist, window,
//!   aggregate, re-expand, and then hand the finished response back to
//!   [`system_one_core::validate::validate_response`] for the standard to
//!   judge;
//! * **[`embed`]** — bge-small with a persistent, corruption-tolerant cache,
//!   which is what turns a state into the relevance order core's fitter wants;
//! * **[`engine`]** — the loopback client for whichever engine is behind the
//!   façade, whose `/predict` shape is its own protocol, not the System One
//!   wire format. It also reads the engine's `/v1/models` *capability*
//!   declaration, which is the only thing that decides which adaptations run:
//!   the façade never branches on an engine's name, and an engine that fails
//!   to declare itself gets the conservative treatment rather than the
//!   unconstrained one;
//! * **[`plan`]** — the small orchestration helpers that are genuinely the
//!   server's: ranking, query text, and mapping an engine's option name back
//!   onto a caller's key;
//! * **[`compress`]** — the one deliberate divergence from core, documented
//!   and measured in that module, pending promotion into the standard.
//!
//! Two properties are structural rather than configurable. There is **no
//! cloud fallback**: [`config::assert_lan`] refuses a non-LAN URL at startup,
//! so no configuration can create an egress path. And the façade **never
//! fabricates an answer**: every failure leaves as
//! `{"error":{"code","message"}}` and the consumer takes its own fail-open
//! path, because a fail-open that cannot tell it is failing open is just a
//! wrong answer.
//!
//! ```
//! use system_one_facade::{config::Config, service::Facade, server::router};
//! use std::sync::Arc;
//!
//! // A façade is a config plus two HTTP clients; nothing is dialled until a
//! // request arrives, so this is cheap enough to build in a test.
//! let facade = Arc::new(Facade::new(Config::default()));
//! let _app = router(facade);
//! ```

#![deny(missing_docs)]

pub mod compress;
pub mod config;
pub mod embed;
pub mod engine;
pub mod error;
pub mod plan;
pub mod server;
pub mod service;
