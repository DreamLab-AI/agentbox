//! `colloquy-core` — the cq shared-agent-learning standard, in pure Rust.
//!
//! Agents that work alone rediscover the same failures independently. cq is an
//! open standard for stopping that: agents **query** a shared store before
//! acting, **propose** what they learned, **confirm** what held, **flag** what
//! rotted, and graduate durable knowledge upward through a human gate. This
//! crate is a clean-room implementation of the standard's data model and rules.
//!
//! It is deliberately *pure*: no clock, no I/O, no network, no store. Every
//! time-dependent function takes `now` as an argument, which is what lets the
//! same crate drive an agent runtime natively and a `wasm32` edge worker, with
//! both computing byte-identical confidence for the same evidence.
//!
//! # The shape of it
//!
//! | Module | Owns |
//! |---|---|
//! | [`mod@unit`] | The knowledge unit: cq's wire schema. |
//! | [`kind`] | The ladder — pitfall, workaround, tool recommendation, gap signal. |
//! | [`id`] | Content-addressed `ku_…` identifiers. |
//! | [`principal`] | Authorising principals, and the collapse that makes counts honest. |
//! | [`confidence`] | Attestations in, diversity-weighted evidence out. |
//! | [`decay`] | Per-kind staleness. |
//! | [`graduation`] | Tier promotion and the human gate. |
//! | [`mod@validate`] | Limits, including the embedding window. |
//! | [`cluster`] | Level-2 workarounds aggregated into level-4 gap signals. |
//! | [`time`] | RFC 3339 timestamps without a date library. |
//!
//! # The two rules worth knowing before reading the code
//!
//! **Confidence follows principals, not confirmations.** cq's trust model says
//! three confirmations from three independent parties outrank eight hundred from
//! two. Implemented over accounts that rule is defeated by anyone who can create
//! accounts — and in an agent estate, creating an account is a command. So every
//! attestation is folded onto its *authorising principal* before it is weighed:
//! an operator's fifty agents count once. See [`principal::collapse`].
//!
//! **A flag suppresses nothing.** Flagging lowers a unit's standing and marks it
//! [`unit::UnitStatus::Disputed`], which is still served. Only a signed decision
//! retires a unit, so no single member can remove knowledge from the store by
//! objecting to it. See [`confidence::Ledger::apply`].
//!
//! # A unit's life, end to end
//!
//! ```
//! use colloquy_core::{
//!     confidence::Ledger, graduation::{graduate, Approval, GraduationPolicy},
//!     kind::UnitKind, principal::Attestation, time::Timestamp,
//!     unit::{Insight, KnowledgeUnit, Tier, UnitStatus}, validate::{validate, Limits},
//! };
//!
//! let t0 = Timestamp::parse_rfc3339("2026-01-01T00:00:00Z").unwrap();
//!
//! // An agent proposes what it learned. Proposing is not confirming.
//! let mut unit = KnowledgeUnit::propose(
//!     "did:nostr:scribe",
//!     UnitKind::Workaround,
//!     ["http", "retry-semantics"],
//!     Insight::new(
//!         "A regenerated idempotency key turns one retry into two charges",
//!         "The client mints a fresh key per attempt, so the provider sees distinct requests.",
//!         "Derive the key from the order id, never from the attempt counter.",
//!     ),
//!     t0,
//! );
//! validate(&unit, &Limits::default()).unwrap();
//! assert_eq!(unit.lifecycle.status, UnitStatus::Draft);
//!
//! // Two independent principals confirm it — one of them a person.
//! let mut ledger = Ledger::default();
//! ledger.confirm(Attestation::agent("auditor", "did:nostr:bob", t0.plus_secs(3_600)));
//! ledger.confirm(Attestation::human("did:nostr:alice", 0.9, t0.plus_secs(7_200)));
//! let assessment = ledger.apply(&mut unit, &Default::default(), &Default::default(), t0.plus_secs(7_200));
//!
//! assert_eq!(unit.lifecycle.status, UnitStatus::Active);
//! assert_eq!(assessment.distinct_principals, 2);
//! assert!(unit.evidence.confidence > 0.5);
//!
//! // A person approves promotion to the shared tier.
//! graduate(
//!     &mut unit, &ledger, Tier::Shared,
//!     &Approval { approved_by: "did:nostr:alice".into(), at: t0.plus_secs(9_000), authorising_event: None },
//!     &GraduationPolicy::for_tier(Tier::Shared),
//!     &Default::default(), &Default::default(), t0.plus_secs(9_000),
//! ).unwrap();
//! assert_eq!(unit.tier(), Tier::Shared);
//! ```
//!
//! # Relationship to cq
//!
//! The wire schema is cq's, so units round-trip between implementations. Two
//! fields are ours and both are additive, which is what keeps that true:
//! [`unit::Graduation::authorising_event`] makes a human approval checkable
//! rather than merely asserted, and [`unit::UnitStatus::Disputed`] separates
//! "contested" from "withdrawn".
//!
//! cq is published by Mozilla AI under the Apache-2.0 licence; this crate is an
//! independent implementation of the documented standard and carries the same
//! licence.

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rustdoc::broken_intra_doc_links)]

pub mod cluster;
pub mod confidence;
pub mod decay;
pub mod graduation;
pub mod id;
pub mod kind;
pub mod principal;
pub mod time;
pub mod unit;
pub mod validate;

pub use confidence::{Assessment, Ledger};
pub use decay::StalenessPolicy;
pub use graduation::{Approval, GraduationPolicy};
pub use id::UnitId;
pub use kind::UnitKind;
pub use principal::{Attestation, ConfirmationPolicy, MemberClass, PrincipalId};
pub use time::Timestamp;
pub use unit::{Evidence, Insight, KnowledgeUnit, Severity, Tier, UnitStatus};
pub use validate::{validate, Limits};

/// The README's examples, compiled and run as doctests.
///
/// A README that has drifted from the API is worse than no README, and the only
/// reliable guard is to make it fail the build.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
