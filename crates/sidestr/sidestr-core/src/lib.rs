//! `sidestr-core` — user-activated sidechains beside a Bitcoin-family parent,
//! in Rust: the chain document, the parents table, signed stock-header blocks,
//! the peg-in claim and peg-out burn rules, the block file and an in-memory
//! validating chain.
//!
//! A sidestr chain runs beside a Bitcoin-family chain with Bitcoin's
//! transaction rules, blocks that are valid because they are *signed* rather
//! than because they were mined, no subsidy, and every coin on it a coin
//! locked on the parent. The name is the chain beside the chain. "User
//! activated" is a claim about who enforces the rules: a chain has signers,
//! and signers decide the *order* of blocks. They do not decide the rules. A
//! node applies a rule because its operator adopted the document, and a
//! block that breaks an adopted rule is invalid to that node whatever
//! signature it carries. The signers can stall the chain. They cannot change
//! it.
//!
//! This crate is a port of **siding**, the reference implementation by
//! Melvin Carvalho (<https://github.com/sidestr/spec>, AGPL-3.0), ported from
//! commit `2de40bdac4cba01be0864156a553d8287c22e279` together with the parts of
//! the engine it loads — `bitcoin-desktop/schema` (the block, header and
//! spending checks) and `bitcoin-blake/blaketestnode` (the block file) — and
//! carries the same licence, AGPL-3.0-only. `SPEC.md` in that repository is
//! the design; section numbers below are its. Where a function ports a
//! siding function its documentation names it, so the two can be read side
//! by side.
//!
//! # What is here
//!
//! | module | what | SPEC | ported from |
//! |---|---|---|---|
//! | [`parents`] | the parents a chain can sit beside: alias, long id, header family, genesis and fork block | 3.2 | `siding/lib/parents.mjs` |
//! | [`document`] | the chain document: id, parent, challenge, prefix, peg and fee parameters, pegs, `genesisHash`; the magic `siding new` derives | 3, 5 | `siding/bin/siding.mjs new`, `lib/engine.mjs` |
//! | [`block`] | the header family boundary; building a block; the signed block data (BIP 325 over this chain's header); the solution push in the coinbase; the BIP 34 height; sign, seal, verify | 4 | `siding/lib/block.mjs` |
//! | [`marker`] | the `OP_RETURN` grammar: `pegin:`, `claim:`, `pegout:`, `ckpt:`, and text records | 6, 7, 11 | `siding/lib/marker.mjs`, `overlay.mjs`, `parent.mjs`, `checkpoint.mjs`, `records.mjs` |
//! | [`rules`] | the rules in phases with the sidestr overlay: zero subsidy, the signature challenge, the claim rule, the burn rule; the extension point for more | 4, 6, 7, 12 | `schema/codec/blocks.js`, `headers.js`; `siding/lib/overlay.mjs` |
//! | [`state`] | the chain in memory: headers, UTXO set, the overlay's records, a mempool with the producer's policy, block production | 4, 5, 11 | `siding/lib/chain.mjs`, `blaketestnode/lib/node.mjs` |
//! | [`blockfile`] | `[u32 height][u32 size][block]` with a JSON index (feature `std`) | 11 | `blaketestnode/lib/blockfile.mjs` |
//! | [`chain`] | the chain on disk: replay, genesis when absent, every accepted block written (feature `std`) | 5, 11 | `siding/lib/chain.mjs` |
//! | [`address`] | bech32 / bech32m both ways, any prefix | 3 | `siding/lib/address.mjs` |
//!
//! # How the pieces talk (SPEC section 11)
//!
//! - **Blocks** are served as a file, `[u32 height][u32 size][block]`, with a
//!   JSON index and `chain.json`, from any **mirror**: a directory on a web
//!   server, nothing more. [`chain::Chain`] reads and writes that file;
//!   [`state::State`] is the same chain fed blocks by whoever fetched them.
//! - **Peg-ins** (§6): an output on the parent to the chain's peg wallet with
//!   `OP_RETURN pegin:<chain id>:<sidechain script bytes>`; the producer
//!   claims it at `pegConfirmations` with a coinbase payout followed by
//!   `claim:<txid>:<vout>` ([`state::ClaimRequest`], [`marker::parse_claims`]).
//! - **Peg-outs** (§7): a sidechain output `OP_RETURN pegout:<parent script
//!   hex>` with a value of at least `pegoutMin`; the value leaves the supply,
//!   the chain records the burn ([`state::State::pegouts`]) and the peg
//!   holders owe it on the parent.
//! - **Transactions** reach a producer and are included when they validate
//!   ([`state::State::submit`]): the mempool's policy is the document's
//!   `minFeeRate` and `pegoutMin`, published so a wallet can compute it.
//! - **Tips and relays** are not in this crate: the tip announcement (kind
//!   33333) and transactions as events (kind 23500) are `sidestr-nostr`'s.
//!
//! # A chain, end to end
//!
//! ```
//! use bitcoin::consensus::encode::serialize;
//! use sidestr_core::block::{challenge_for, pubkey_of};
//! use sidestr_core::document::{ChainDocument, Peg};
//! use sidestr_core::state::{NextBlock, State};
//!
//! // a signer key: in siding a 32-byte hex file, never an argument
//! let key = bitcoin::secp256k1::SecretKey::from_slice(&[7u8; 32]).unwrap();
//! let me = challenge_for(&pubkey_of(&key));
//!
//! // the document is the chain's identity: the genesis is derived from it
//! let mut doc = ChainDocument::from_json(&r#"{
//!   "id": "sidestr:example", "name": "example", "parent": "tbtc4", "challenge": "", "signer": "",
//!   "powLimit": "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
//!   "addressPrefix": "ex", "genesisTime": 1790000000, "pegs": []
//! }"#.replace("\"challenge\": \"\"", &format!("\"challenge\": \"{}\"", me.to_hex_string()))
//!    .replace("\"signer\": \"\"", &format!("\"signer\": \"{}\"", pubkey_of(&key)))).unwrap();
//! doc.pegs.push(Peg { txid: "a".repeat(64), vout: 0, amount: 100_000_000, script: me.to_hex_string(), extra: Default::default() });
//!
//! // SPEC 5: the genesis mints exactly the pegs, sealed by the signer, deterministically
//! let mut state = State::with_key(doc.clone(), &key).unwrap();
//! assert_eq!(state.coins(&me)[0].value, 100_000_000);
//! let genesis = State::genesis_block_for(&doc, &key).unwrap();
//! assert_eq!(state.genesis_hash(), genesis.header.block_hash());
//!
//! // SPEC 4: a block is valid because it is signed; the producer makes one on the tip
//! let (added, block) = state.produce(&key, &NextBlock { time: 1790000100, claims: vec![] }, None).unwrap();
//! assert_eq!((added.height, block.txdata.len()), (1, 1));
//!
//! // a validator with no key replays the same bytes to the same tip
//! let mut validator = State::from_genesis(doc, &genesis, None).unwrap();
//! validator.add_block_bytes(&serialize(&block), Some(added.hash), None).unwrap();
//! assert_eq!(validator.tip(), state.tip());
//!
//! // and refuses the block again, or one the rules fail, by name
//! assert!(validator.add_block(&block, None, None).unwrap_err().to_string().contains("apply 1 at height 1"));
//! ```
//!
//! # Conventions that matter
//!
//! - **Keys are files, never arguments.** [`block::key_from_hex`] takes the
//!   file's text; nothing here prints a key. A block is a pure function of its
//!   inputs and the key (zero BIP 340 auxiliary randomness), so two producers
//!   with the same key and mempool make the same block.
//! - **A chain id is a name, not a proof.** The document's `genesisHash` is
//!   what a validator holds a block file to ([`state::State::from_genesis`],
//!   [`chain::Chain::open`]); a mirror is held to the announced tip.
//! - **The header format and proof-of-work hash follow the parent** (§3).
//!   Nothing in the document names them; [`parents::resolve_parent`] decides,
//!   and [`block::HeaderFamily`] is the seam. This version carries the stock
//!   family (`btc`, `tbtc4`); a BLAKE2b parent (`xbt`, `txbt4`) is refused as
//!   [`Error::UnsupportedFamily`] until `sidestr-header` lands.
//! - **Nothing in the rules does I/O.** [`document`], [`block`], [`marker`],
//!   [`rules`], [`state`] and [`address`] take bytes and return verdicts; the
//!   filesystem and the clock are behind feature `std` in [`blockfile`] and
//!   [`chain`]. The crate is not `no_std`; `std` names what touches the
//!   operating system.
//! - **Amounts are sats**, `u64`. Txids in markers are display-order hex
//!   strings, as the markers carry them; structural txids are [`bitcoin::Txid`].
//!
//! # Where this port departs from siding
//!
//! Each is deliberate and small; the byte-for-byte genesis and the interop
//! tests in `tests/` are what say they are harmless.
//!
//! - **Script verification fails closed.** The reference kernel verifies every
//!   script type and reports a witness version it does not know as
//!   "unverifiable", which lets the block through. This crate verifies
//!   taproot key-path spends — the only spends a level-1 chain with a `5120…`
//!   challenge and bech32m wallets makes — and *refuses* anything else
//!   ([`block::verify_key_path_input`]). A block spending by script path is
//!   invalid here and valid there; a full interpreter is 0.2's.
//! - **Overlay records commit on apply.** siding's claim and burn checks write
//!   into their maps while validating, so a block that later fails another
//!   rule still leaves its claims recorded at its height. Here
//!   [`rules::validate_block_context`] returns the records a block *would*
//!   leave and [`state::State::apply`] commits them only when every rule
//!   passed.
//! - **`record_text` checks the push length.** The reference's check is
//!   commented out; [`marker::record_text`] refuses a record whose bytes do not
//!   match its push length.
//! - **Zero auxiliary randomness everywhere**, not only for the genesis. Both
//!   are valid BIP 340; only reproducibility differs.
//! - **A document naming `assets`, `pool` or `evm`, or a level-2 federation,
//!   is refused** at [`document::ChainDocument::validate`], as `loadEngine`
//!   refuses a rule it does not have: those overlays are not carried, and a
//!   validator must not run a chain it would misjudge.

#![forbid(unsafe_code)]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::broken_intra_doc_links
)]

pub mod address;
pub mod block;
#[cfg(feature = "std")]
pub mod blockfile;
#[cfg(feature = "std")]
pub mod chain;
pub mod document;
pub mod error;
pub mod marker;
pub mod parents;
pub mod rules;
pub mod state;

pub use block::{HeaderFamily, Stock};
pub use document::ChainDocument;
pub use error::{Error, Result};
pub use parents::{resolve_parent, Family, Parent};
pub use state::State;
