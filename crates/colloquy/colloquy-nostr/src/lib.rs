//! `colloquy-nostr` — the wire binding between [`colloquy_core`] and Nostr.
//!
//! Six event kinds (`38100`–`38105`), a tag grammar, and the reconstruction that
//! turns a subscription's worth of signed events back into per-unit evidence.
//!
//! # What this crate does not do
//!
//! It does not sign, and it does not verify signatures. Both belong to whoever
//! holds the key: pass already-verified events in, get unsigned templates out,
//! and hand those to your own signer. Keeping both out means this crate has no
//! key material to leak and no crypto to get wrong — and it is why [`event`]
//! defines the NIP-01 structs itself rather than depending on a Nostr library,
//! which would have coupled every consumer to one particular implementation.
//!
//! # The two decisions that matter
//!
//! **Content is authoritative; tags are an index.** Every fact acted on comes
//! from the event's JSON content. Tags exist so a relay can filter cheaply, and
//! [`decode`] treats a tag that disagrees with the content as an error rather
//! than resolving it silently.
//!
//! **An unregistered pubkey is dropped, not self-authorising.** See
//! [`ledger`] — it is the single place where the trust model could be
//! defeated, and the conservative direction is the safe one.
//!
//! ```
//! use colloquy_core::{kind::UnitKind, time::Timestamp, unit::{Insight, KnowledgeUnit}};
//! use colloquy_nostr::{encode::unit_event, kinds::KIND_KNOWLEDGE_UNIT};
//!
//! let t = Timestamp::from_secs(1_767_225_600);
//! let unit = KnowledgeUnit::propose(
//!     "did:nostr:abc", UnitKind::Pitfall, ["wire-format"],
//!     Insight::new("52-byte records are frozen", "…", "Never widen the record."),
//!     t,
//! );
//! let ev = unit_event(&unit, &"ab".repeat(32), t);
//! assert_eq!(ev.kind, KIND_KNOWLEDGE_UNIT);
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rustdoc::broken_intra_doc_links)]

pub mod decode;
pub mod event;
pub mod encode;
pub mod kinds;
pub mod ledger;
pub mod tags;

pub use event::{NostrEvent, UnsignedEvent};
pub use decode::{
    attestation_from_event, graduation_from_event, supersession_from_event, unit_from_event,
    AttestationRef, DecodeError, GraduationRef, SupersessionRef,
};
pub use encode::{
    confirmation_event, flag_event, gap_signal_event, graduation_event, supersession_event,
    unit_address, unit_event,
};
pub use kinds::{is_colloquy_kind, ALL_KINDS, COLLOQUY_KIND_RANGE};
pub use ledger::{reconstruct, PrincipalResolver, Reconstruction, ResolvedMember, StaticRegistry};

/// The README's examples, compiled and run as doctests.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
