//! `sidestr-nostr` — the Nostr plane of sidestr sidechains: the events a
//! chain's signers, producers, wallets and mirrors exchange, and the trust
//! rule that makes a relay's answer worth acting on.
//!
//! A sidestr chain has no peer-to-peer network. Blocks are served as a file
//! from any mirror; everything else — where the tip is and who serves it,
//! transactions on their way to a producer, a faucet request, a rule change,
//! a miner's pledge, a federation's co-signing round — is a signed Nostr
//! event on a public relay (SPEC 11). This crate is those events: their
//! shapes, their tags, what each must carry, and the small amount of
//! judgement the spec attaches to them (which mirror to trust, whether a
//! mirror is behind or lying, which announcement is newest). It does not
//! open sockets; see [`relay`] for the messages and the port.
//!
//! This crate is a port of **siding**, the reference implementation by
//! Melvin Carvalho (<https://github.com/sidestr/spec>, AGPL-3.0), ported
//! from commit `2de40bdac4cba01be0864156a553d8287c22e279` (the tip parser
//! follows `announce.mjs` at `e457737`, spec 0.0.3), with the event
//! id and signature rule from the schema kernel it loads
//! (`bitcoin-desktop/schema`, `codec/nostr.js`), and carries the same
//! licence, AGPL-3.0-only. `SPEC.md` in that repository is the design;
//! section numbers below are its. Where a function ports a siding function
//! its documentation names it. The agentbox kinds (38420–38425) are this
//! estate's own, from its records.
//!
//! # What is here
//!
//! | module | what | kinds | SPEC | ported from |
//! |---|---|---|---|---|
//! | [`event`] | the NIP-01 event, its id (SHA-256), BIP-340 verify, the sealed [`Signer`] port, an in-memory key | — | 11 | `siding/lib/relay.mjs makeEvents`, `schema/codec/nostr.js verifyNostrEvent`, `siding/lib/schnorr.mjs` |
//! | [`kinds`] | every kind with owner (external / estate), storage class, `d` grammar and conformance | all | App. A | `docs/PROTOCOL-registry.md`, ADR-2098 |
//! | [`tags`] | the tag grammar, the `chain` check a relay cannot do, outpoints | — | 11 | `siding/lib/relay.mjs subscribe` |
//! | [`tip`] | the announcement: build, parse (both header families), the mirror trust rule, judging a mirror, the newest | 33333 | 11 | `siding/lib/announce.mjs` |
//! | [`tx`] | a transaction as an event; a faucet request | 23500, 23501 | 11 | `siding/lib/relay.mjs txEvent`, `bin/siding.mjs faucet` |
//! | [`rules`] | a rule document; the genesis document — **SPEC prose only**, no upstream code | 33500, 33501 | 8, App. A | — |
//! | [`record`] | the peg record *or* the desk's pledge: `PegRecord \| Pledge \| Ambiguous`, never guessed | 33502 | 6.2, App. A | `siding/lib/pledge.mjs`, `bin/siding.mjs onPledge` |
//! | [`round`] | the level-2 envelopes: proposal, partial signature, sealed block, peg-out PSBT and its co-signature | 23510–23514 | 9.1 | `siding/lib/round.mjs`, `pegoutround.mjs` (codecs only) |
//! | [`estate`] | the account binding and the five settlement domain events | 38420–38425 | ADR-2098, DDD-022 | — |
//! | [`relay`] | NIP-01 client and relay messages, the two subscriptions, the on-receipt checks, the [`relay::RelayClient`] port | — | 11 | `siding/lib/relay.mjs`, `announce.mjs fetchLatestTip` |
//!
//! # The announcement and the mirror (SPEC 11)
//!
//! In Melvin Carvalho's words, adapted from `announce.mjs` and SPEC 11: a
//! client that knows only a chain id asks a relay for the chain's kind-33333
//! announcement, takes a mirror from it, reads that mirror's `chain.json`,
//! and accepts the mirror when the document's signer is the announcement's
//! author. A mirror is then held to the announcement: the header at its tip
//! must be the announced one, and it may be behind but never ahead of the
//! signer. **A chain id is a name, not a proof**, so with only the id the
//! newest announcement wins and a client shows the signer it settled on; a
//! client that already knows the signer takes no other's. That rule is
//! [`tip::choose_mirror`], [`tip::judge_mirror`] and [`tip::newest`], and
//! nothing from a relay is trusted before [`Event::verify`]: "the event
//! signature is checked, then the transaction itself must validate".
//!
//! # A producer's afternoon
//!
//! ```
//! use sidestr_core::parents::Family;
//! use sidestr_nostr::event::{SecretKeySigner, Signer};
//! use sidestr_nostr::relay::Follower;
//! use sidestr_nostr::tip::{choose_mirror, judge_mirror, parse_tip_as, sign_tip, MirrorChain, TipTemplate};
//! use sidestr_nostr::tx::{parse_transaction, sign_transaction_event};
//!
//! // the signer key is a file, never an argument (siding/lib/sign.mjs loadKey)
//! let signer = SecretKeySigner::from_hex(&"07".repeat(32)).unwrap();
//! let me = signer.pubkey_hex().unwrap();
//!
//! // after a block: announce the tip, the last headers (stock family: 80 bytes each) and the mirrors
//! let header = |i: u8| format!("{i:02x}").repeat(80);
//! let tip = TipTemplate::new("sidestr:example", 2, vec![header(0), header(1), header(2)], vec!["https://mirror.example/example".into()]).unwrap();
//! let announcement = sign_tip(&signer, &tip, 1_790_100_000).unwrap();
//!
//! // a client with only the chain id: verify, parse for the chain's family, pick the mirror the signer vouches for
//! announcement.verify().unwrap();
//! let t = parse_tip_as(&announcement, Family::Stock).unwrap();
//! let chosen = choose_mirror(&t, "sidestr:example", |url| {
//!     assert_eq!(url, "https://mirror.example/example/chain.json");
//!     Ok(MirrorChain { id: "sidestr:example".into(), signer: Some(me.clone()) })
//! }).unwrap();
//! assert_eq!(chosen.mirror, "https://mirror.example/example");
//! // …and hold the mirror to the announcement
//! assert!(judge_mirror(Some(&t), 2, Some(&header(2))).ok().unwrap());
//! assert!(!judge_mirror(Some(&t), 3, None).ok().unwrap());          // ahead of the signer: lying
//!
//! // meanwhile a wallet sends a transaction with a throwaway key; the producer follows kind 23500
//! let throwaway = SecretKeySigner::from_bytes(&[9u8; 32]).unwrap();
//! let ev = sign_transaction_event(&throwaway, "sidestr:example", "02000000000101ab", 1_790_100_001).unwrap();
//! let mut follow = Follower::new(23500, "sidestr:example");
//! if let Some(ev) = follow.accept(&ev) {                             // kind, unseen, this chain, verifies
//!     let tx = parse_transaction(ev, Some("sidestr:example")).unwrap();
//!     assert_eq!(tx.tx_hex, "02000000000101ab");                    // next: the mempool judges it
//! }
//! ```
//!
//! # Conventions that matter
//!
//! - **Keys sit behind [`Signer`], and only named operations reach it.** A
//!   [`event::SignRequest`] has no public constructor, so a signer is
//!   driven only through `sign_tip`, `sign_transaction_event`, `sign_rule`,
//!   `sign_pledge`, `sign_proposal`, `sign_account_binding` and their
//!   siblings, and always sees the whole event (ADR-2101). The in-memory
//!   [`event::SecretKeySigner`] signs with zero BIP-340 auxiliary
//!   randomness, so an event is a pure function of its fields and the key.
//! - **Verify first, decode second.** No parser verifies a signature; every
//!   consumer calls [`Event::verify`] (or uses [`relay::Follower`] /
//!   [`tip::newest`], which do) before decoding, as siding verifies before
//!   `parseTip` and before `submit`.
//! - **Content is authoritative; tags are an index** (the colloquy-nostr
//!   rule). Where both carry a fact the codecs refuse a disagreement
//!   ([`Error::Disagree`]) rather than resolve it.
//! - **Nothing cryptographic is hand-rolled.** SHA-256 is RustCrypto `sha2`;
//!   BIP-340 is `secp256k1` through `bitcoin`, sharing `sidestr-core`'s
//!   context.
//!
//! # Where this port departs from siding
//!
//! - **Both header families parse** (upstream matched at spec 0.0.3).
//!   Before sidestr/spec PR #7, `parseTip` accepted only content whose
//!   length divides by 328 (the 164-byte Knots v2 header), so it returned
//!   `null` for every announcement of a chain beside a stock Bitcoin parent
//!   (80-byte headers, 160 hex) — the live `sidestr:dreamlab` announcement
//!   among them (`fixtures/live-33333.json`). Since 0.0.3 `headerWidth`
//!   reads the width from the content, bounded to `TIP_HEADERS` headers and
//!   hex-checked before slicing; this crate applies the same bound.
//!   [`tip::parse_tip`] infers the family from the length and
//!   [`tip::parse_tip_as`] takes it from the chain's parent; a length that
//!   fits both is refused, never guessed.
//! - **Refusals are typed.** siding's parsers return `null`; here every
//!   refusal is an [`Error`] variant carrying the reason.
//! - **33502 is decoded by structure** into `PegRecord | Pledge | Ambiguous`
//!   (ADR-2098 D2). Upstream reads every 33502 as a pledge.
//! - **No socket.** siding uses the platform's `WebSocket`; here the I/O is
//!   a port ([`relay::RelayClient`]) and the rules are pure.
//!
//! [`Signer`]: event::Signer
//! [`Event::verify`]: event::Event::verify

#![forbid(unsafe_code)]
#![deny(
    missing_docs,
    missing_debug_implementations,
    rustdoc::broken_intra_doc_links
)]

pub mod error;
pub mod estate;
pub mod event;
pub mod kinds;
pub mod record;
pub mod relay;
pub mod round;
pub mod rules;
pub mod tags;
pub mod tip;
pub mod tx;

pub use error::{Error, Result};
pub use event::{Event, SecretKeySigner, SignRequest, Signer, UnsignedEvent};

/// The README's examples, compiled and run as doctests.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
