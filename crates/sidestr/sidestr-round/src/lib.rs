//! `sidestr-round` — level 2 of sidestr sidechains, usable now: the
//! co-signing round of `k`-of-`n` signers as a pure state machine that
//! interoperates on the wire with the reference signer as it runs today,
//! the peg-out PSBT round over rust-bitcoin, a durable vote journal, and
//! `cosign`, a runnable signer.
//!
//! # The round, in the reference's words
//!
//! Adapted from Melvin Carvalho's `proposals/level-2.md` and
//! `siding/lib/round.mjs`, AGPL-3.0: a level-2 chain has `n` signers and a
//! threshold `k`. Nothing changes for a validator — the challenge is still
//! a script and a block is still valid when its solution satisfies it.
//! Every signer runs a producer: the same validator, the same mempool, its
//! own mirror. At each height **the proposer is signer `height mod n`**;
//! after `proposeAfter` seconds without a block, the next signer in order
//! may propose, and so on around the ring. The proposer builds the block
//! without its solution and publishes it as a kind 23510 event; each other
//! signer validates it against its own chain and rules exactly as it would
//! a block from the mirror, requires that every transaction is one its
//! mempool accepts, that the height is its tip plus one, that the proposer
//! is entitled at this time, and that it has not signed another proposal
//! for this height; if all hold it publishes a kind 23511 event with its
//! partial signature. With `k` signatures the proposer assembles the
//! witness, seals the block, adds it, and publishes it as a kind 23514
//! event so every signer adds it at once. Signer keys are Nostr keys, so a
//! proposal or a partial is authenticated by the event itself.
//!
//! Two rules the draft did not state, as built upstream: a signer's "one
//! signature per height" **relaxes once the proposal it signed has had
//! `proposeAfter` seconds to seal and has not** — otherwise a proposer that
//! dies after collecting fewer than `k` strands the height — and **a
//! proposer drops its own proposal after `proposeAfter × n` seconds**. A
//! peg-out is the same round with the same rule of one signature per burn
//! per signer: a PSBT the payer publishes as kind 23512, returned signed as
//! kind 23513, finalised and broadcast by the payer.
//!
//! # What is here
//!
//! | module | what | ported from |
//! |---|---|---|
//! | [`round`] | [`round::Round`]: the block round, pure — `tick(now)` and `on_event(now, event)` return [`round::Action`]s | `siding/lib/round.mjs` |
//! | [`pegout`] | the PSBT functions over rust-bitcoin and [`pegout::PegoutRound`], pure the same way | `siding/lib/pegoutround.mjs`; Core's wallet RPCs it called |
//! | [`journal`] | [`journal::VoteJournal`]: what this signer authorised, written before it is published; file and memory | — (ADR-2101, review §7) |
//! | [`signer`] | [`signer::BlockSigner`] and [`signer::LocalKey`]: the key behind named operations | `siding/lib/sign.mjs`, `schnorr.mjs` |
//! | [`chain`] | [`chain::ChainView`]: the chain as the round sees it, over `sidestr-core`'s state or its file-backed chain | `siding/lib/chain.mjs` (`submit`, `addSealed`) |
//! | `relay` (feature `relay`) | the tokio websocket client with reconnection, and a NIP-01 relay stand-in for one box | `siding/lib/relay.mjs` |
//! | `node` (feature `bin`) | one signer running: chain on disk, both rounds, relays, HTTP for mirrors, the tip announcement, the parent | `bin/siding.mjs produce` |
//!
//! The envelopes themselves — the five kinds, their tags and content — are
//! `sidestr-nostr`'s [`sidestr_nostr::round`]; the federation, the partial
//! signature and the seal are `sidestr-core`'s [`sidestr_core::federation`].
//! This crate is the protocol between them.
//!
//! # Wire compatibility
//!
//! A Rust signer co-signs with reference signers and the reverse, on a live
//! chain, with no change to what travels:
//!
//! - **23510** proposal: tags `["chain", id]`, `["h", height]`; content the
//!   block hex without its solution. **23511** partial: `chain`, `h`,
//!   `["e", proposal id]`; content the 64-byte BIP-340 signature as hex
//!   over the tapscript sighash of the block's virtual transaction for the
//!   federation's leaf. **23514** sealed: `chain`, `h`; content the sealed
//!   block hex. **23512** peg-out PSBT: `chain`, `["d", "<txid>:<vout>"]`,
//!   `h`; content the PSBT, base64. **23513** co-signed: `chain`, `d`,
//!   `["e", 23512 id]`; content the PSBT with this signer's signatures.
//! - The proposer ring, the lateness entitlement (from when the block became
//!   due, never negative), the one-signature rule and its relaxation, the
//!   `proposeAfter × n` drop, the replay filter on a proposal older than
//!   `proposeAfter × n`, the `since` window of 600 s, the follow-by-kind
//!   subscription (relays refuse `#chain`), and the on-receipt checks
//!   (kind, unseen, chain tag, signature) are `round.mjs`'s to the second.
//! - Every refusal is logged with `round.mjs`'s wording, so operators read
//!   one log across engines.
//!
//! Proven by `tests/interop_round.rs` and `tests/interop_pegout.rs`: three
//! signers on one box through an in-process relay, {Rust, JS, JS} and
//! {Rust, Rust, JS}, on a chain the reference makes; sealed blocks whose
//! witness carries the other engine's slot in both directions; one signer
//! down tolerated, two halts, one back resumes; a Rust signer restarted on
//! its journal; burns paid by PSBTs proposed by JS and co-signed by Rust
//! and the reverse, every finalised parent transaction verified under
//! BIP 342 against `tr(NUMS, multi_a(k, …))`.
//!
//! # Hardening, behind options with upstream's behaviour as default
//!
//! None of it changes the wire.
//!
//! | option | default | what |
//! |---|---|---|
//! | [`journal::VoteJournal`] | a journal is always given; [`journal::MemoryJournal`] forgets, [`journal::FileJournal`] is append-only and `fsync`ed | a signature (height or burn, proposal id, template id or unsigned txid, time) is written **before** the `Publish` action is returned; if the write fails the signer does not sign; on restart the journal is loaded and the one-signature rule applies against it |
//! | [`round::RoundConfig::resign_after`] | `Some(propose_after)` — upstream's relaxation | `None` never re-signs a height (ADR-2101); a stranded height then waits for its proposer |
//! | `on_sealed` | always | a 23514 is a *candidate*: it enters through the validator ([`chain::ChainView::add_block`]) and is never treated as finality |
//! | proposal validation order | always | the chain's deterministic rules first ([`sidestr_core::state::StateOf::judge`], minus the block signature and the proof of work sealing satisfies — [`round::RULES_NOT_JUDGED_ON_A_TEMPLATE`]), the local mempool's policy second; the one new refusal names the rules |
//! | [`pegout::PegoutConfig::max_fee`] | 100 000 sats | a co-signer refuses a payment whose fee is over the cap (the reference checks outputs and inputs, not the difference) |
//! | 23513 verification | always | a co-signer's PSBT counts only if it is the proposed transaction with a verifying signature by its author |
//!
//! # Honest limits
//!
//! This is upstream's protocol. It tolerates `n − k` signers being **down**
//! and nothing being **wrong**: availability tolerance, not Byzantine
//! tolerance. A faulty proposer can strand a height until the relaxation;
//! two subsets of `k` can seal one template to two hashes; the entitlement
//! is clock-based; a relay can delay or replay. The journal stops a restart
//! from becoming a double signature and is not anti-rollback (a host
//! restored from a snapshot has an old journal). The consensus protocol
//! above the signature — views, durable safety state, decision
//! certificates, `AUTHORISE_TEMPLATE` then `FINALISE_BLOCK` — is ADR-2101's
//! separate crate, and it replaces [`round::Round`], not the codecs, the
//! federation or the journal.
//!
//! # Running a signer
//!
//! ```text
//! cosign --chain chain.json --dir ~/.sidestr/fed --key-file ~/.sidestr/fed.key \
//!        --port 3461 --interval 600 --tx-interval 30 --propose-after 30 \
//!        --relay wss://nos.lol,wss://relay.primal.net,wss://nostr.mom \
//!        --announce-mirror https://mirror.example/fed \
//!        [--parent-rpc http://127.0.0.1:48332/ --parent-cookie ~/.bitcoin/.cookie --parent-wallet fed-peg] \
//!        [--resign-after upstream|never|<secs>] [--journal DIR/votes.jsonl]
//! ```
//!
//! The key is a file, never an argument. The block directory must already
//! hold the chain's `blocks.dat` and `blocks.json` (copied from a mirror);
//! a joining signer does not make a genesis. `cosign` serves
//! `/status.json`, `/chain.json`, `/tip`, `/blocks.json`, `/blocks.dat`
//! (with `Range`), `/coins/<script hex>`, `/pegouts.json` and `POST /tx`
//! on 127.0.0.1, announces kind 33333 naming `--announce-mirror` after
//! every block, and with a parent node claims peg-ins and pays peg-outs
//! through the PSBT round from the wallet that holds the federation's
//! descriptor with this key private (`siding peg-wallet`). The feature
//! `bin` builds it; `relay` alone gives the client and the stand-in.
//!
//! # Where this port departs from siding
//!
//! - **Pure state machines.** `round.mjs` publishes, subscribes and reads
//!   the clock inside; here the time is an argument and I/O is an action.
//! - **The peg-out round does not need Core for the PSBT**: funding,
//!   signing, combining and finalising are rust-bitcoin; the parent is
//!   asked only for coins and for broadcast. The PSBT carries what Core
//!   fills for the descriptor, so Core-backed signers co-sign it.
//! - **`entitled` in the peg-out round is never negative**, as the block
//!   round's already is; upstream's peg-out variant would refuse the
//!   rightful payer's proposal made a moment before the co-signer saw the
//!   burn.
//! - **Zero BIP-340 auxiliary randomness** in [`signer::LocalKey`], as the
//!   sibling crates; upstream draws random aux. Both are valid.
//! - The hardening table above.

#![forbid(unsafe_code)]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::broken_intra_doc_links
)]

pub mod chain;
pub mod error;
pub mod journal;
#[cfg(feature = "bin")]
pub mod node;
pub mod pegout;
#[cfg(feature = "relay")]
pub mod relay;
pub mod round;
pub mod signer;

pub use error::{Error, Result};

/// The README's examples, compiled and run as doctests.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
