//! `sidestr-core` — user-activated sidechains beside a Bitcoin-family parent,
//! in Rust: the chain document, the parents table, signed blocks in either
//! header family, the peg-in claim and peg-out burn rules, the block file and
//! an in-memory validating chain.
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
//! | [`document`] | the chain document: id, parent, challenge, prefix, peg and fee parameters, pegs, `genesisHash`, a level-2 `signers`/`threshold`; the magic `siding new` derives | 3, 5 | `siding/bin/siding.mjs new`, `lib/engine.mjs`, `lib/overlay.mjs checkFederation` |
//! | [`block`] | the header family boundary ([`HeaderFamily`], [`Stock`], [`FamilyBlock`]); building a block; the signed block data (BIP 325 over this chain's header); the solution push in the coinbase; the BIP 34 height; sign, seal, verify | 3.2, 4 | `siding/lib/block.mjs` |
//! | [`sighash`] | the signature hashes a spend is judged by: BIP 341, and Knots' unified opt-in sighash beside a BLAKE2b parent; the taproot key-path verifier | 3 | `schema/codec/interpreter.js` |
//! | [`parent`] | the parent chain behind [`parent::ParentRpc`] / [`parent::PegWallet`]: peg-ins found in decoded blocks, peg status, what to claim and lock, the burn payment and checkpoint as `send` outputs, reconciliation; Bitcoin Core's JSON-RPC behind feature `rpc` | 6, 7, 11 | `siding/lib/parent.mjs`, `checkpoint.mjs`, `bin/siding.mjs produce` |
//! | [`federation`] | level 2, the pure parts: the NUMS internal key, the `multi_a(k, …)` leaf, output key and control block, partial signatures, witness assembly, sealing, and the verifier for exactly that leaf | level-2 | `siding/lib/federation.mjs`; `schema/codec/interpreter.js` (tapscript) |
//! | [`marker`] | the `OP_RETURN` grammar: `pegin:`, `claim:`, `pegout:`, `ckpt:`, and text records | 6, 7, 11 | `siding/lib/marker.mjs`, `overlay.mjs`, `parent.mjs`, `checkpoint.mjs`, `records.mjs` |
//! | [`rules`] | the rules in phases with the sidestr overlay: zero subsidy, the signature challenge, the claim rule, the burn rule; the family's own rules; the extension point for more | 4, 6, 7, 12 | `schema/codec/blocks.js`, `headers.js`; `siding/lib/overlay.mjs` |
//! | [`state`] | the chain in memory, generic over the family ([`StateOf`], [`State`] for stock): headers, UTXO set, the overlay's records, a mempool with the producer's policy, block production | 4, 5, 11 | `siding/lib/chain.mjs`, `blaketestnode/lib/node.mjs` |
//! | [`blockfile`] | `[u32 height][u32 size][block]` with a JSON index (feature `std`) | 11 | `blaketestnode/lib/blockfile.mjs` |
//! | [`chain`] | the chain on disk ([`chain::ChainOf`], [`chain::Chain`] for stock): replay, genesis when absent, every accepted block written (feature `std`) | 5, 11 | `siding/lib/chain.mjs` |
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
//!   [`chain::Chain::open`]) once block 0 has passed the rules; a mirror is
//!   held to the announced tip.
//! - **The header format and proof-of-work hash follow the parent** (§3).
//!   Nothing in the document names them; [`parents::resolve_parent`] decides,
//!   and [`block::HeaderFamily`] is the seam: the rules, [`StateOf`] and
//!   [`chain::ChainOf`] are generic over it. This crate carries the stock
//!   family ([`Stock`]: `btc`, `tbtc4`, the block is [`bitcoin::Block`]);
//!   `sidestr-header` implements the trait for Knots' 164-byte v2 header
//!   (`xbt`, `txbt4`) with [`FamilyBlock`] as its block, and depends on this
//!   crate, never the reverse. A state instantiated for one family refuses a
//!   document whose parent hands down the other ([`Error::UnsupportedFamily`]).
//!   Beside a BLAKE2b parent the chain also inherits Knots' unified opt-in
//!   sighash from height 0 ([`sighash`]), which every spend on the live
//!   `sidestr:txbt4-siding` chain uses.
//! - **A federation signs a template; consensus is elsewhere.** A level-2
//!   document derives its challenge from `signers` and `threshold`
//!   ([`federation::Federation`]); any `k` partial signatures seal a block
//!   ([`federation::seal_federated`]), and [`block::template_id`] is the
//!   identity they authorise, which sealing does not change — the sealed
//!   hash does. The co-signing round (`round.mjs`) is **not** ported: the
//!   ADR-2101 review found its timeout re-signing unsafe, and a consensus
//!   protocol above the signature is a separate crate.
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
//! - **The genesis is judged, not trusted.** `siding/lib/chain.mjs #apply`
//!   applies block 0 on its hash alone: if it matches the document's
//!   `genesisHash` (or the mirror's index) it is the chain's base, signed or
//!   not. [`StateOf::from_genesis`] runs every rule that applies at height 0
//!   first — the family's header rules, `sidestr:rule-block-signature` against
//!   the challenge, the block-context rules with the pegs as the one subsidy,
//!   and `sidestr:rule-genesis-document` (the block's signed data is that of
//!   [`StateOf::build_genesis_for`] and its `bits` the document's `powLimit`)
//!   — and only then holds the hash to the pin. A hash pin says which block 0
//!   you hold, not that it is well-formed; there is no trusted import. Shown
//!   to pass on the vendored fixtures, the two live reference chains
//!   (`sidestr:txbt4-siding`, `sidestr:melchain`) and the estate's sealed
//!   `sidestr:dreamlab` genesis — not asserted for every genesis the
//!   reference has ever produced. Kept deliberately stricter than the
//!   reference; the self-contained `tests/audit_regressions.rs` holds it.
//! - **A stock header with version bit 31 set is refused everywhere.** The
//!   kernel's `structVariants` would read such bytes as a Knots v2 header,
//!   and its `btc:rule-header-version` fails because a stock `version` is
//!   `i32le` and the word is negative. [`Stock::decode_header`] and the stock
//!   block decoder refuse the bytes by name; on the typed path
//!   [`HeaderFamily::version_number`] carries the codec's signedness into the
//!   rule, so [`StateOf::add_block`] refuses it as `btc:rule-header-version`,
//!   the rule the reference names on the same block.
//! - **The block file's record framing is checked.** `blockfile.mjs readBlock`
//!   reads through the index and never looks at a record's own
//!   `[u32 height][u32 size]` prefix. [`blockfile::read_block`] holds the
//!   index entry to the file's length with checked arithmetic and the prefix
//!   to the entry ([`Error::BlockFile`]), so a mirror whose `blocks.dat` and
//!   `blocks.json` disagree is refused rather than replayed.
//! - **Script verification fails closed.** The reference kernel verifies every
//!   script type and reports a witness version it does not know as
//!   "unverifiable", which lets the block through. This crate verifies
//!   taproot key-path spends — the only spends a level-1 chain with a `5120…`
//!   challenge and bech32m wallets makes — and *refuses* anything else
//!   ([`sighash::verify_taproot_key_path`]). A block spending by script path
//!   is invalid here and valid there; there is no general interpreter.
//! - **The solution's witness decoder is strict.** `decodeWitness` reads what
//!   it can and ignores the rest; [`block::decode_witness`] refuses a
//!   truncated item, trailing bytes, a non-minimal CompactSize and more than
//!   256 items, since the solution is consensus data.
//! - **The script path is one template, verified exactly.** The reference
//!   executes any tapscript; this crate verifies the taproot commitment,
//!   the leaf version and then exactly the `multi_a(k, pk_1 … pk_n)` leaf
//!   under BIP 342 ([`federation::verify_multi_a_input`]), refusing any
//!   other leaf by name ([`federation::ScriptPathError::NotMultiA`]) and an
//!   unknown leaf version too ([`federation::ScriptPathError::LeafVersion`]),
//!   where the kernel and Bitcoin Core treat the latter as a success. Within
//!   that template the two agree case for case (`tests/consensus_oracle.rs`,
//!   Core's interpreter behind the `consensus-oracle` feature).
//! - **The mempool judges signatures by the block rules.** siding's `submit`
//!   passes `unifiedSighash: true` on every family while its block rule
//!   applies it only from the fork height, so on a stock chain the reference
//!   mempool would admit a spend its own block rule refuses;
//!   [`StateOf::submit`] asks the family, as the block rule does.
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
//! - **A document naming `assets`, `pool` or `evm` is refused** at
//!   [`document::ChainDocument::validate`], as `loadEngine` refuses a rule it
//!   does not have: those overlays are not carried, and a validator must not
//!   run a chain it would misjudge. The Knots overlay's
//!   RDTS weight cap (`knots:rule-blockctx-weight-rdts`) is not carried
//!   either: on a sidestr chain `rdtsExpiryTime` is 0, so it is never active.

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
pub mod federation;
pub mod marker;
pub mod parent;
pub mod parents;
pub mod rules;
pub mod sighash;
pub mod state;

pub use block::{FamilyBlock, HeaderFamily, SidestrBlock, Stock};
pub use document::ChainDocument;
pub use error::{Error, Result};
pub use parents::{resolve_parent, Family, Parent};
pub use state::State;
pub use state::StateOf;
