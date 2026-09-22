//! `sidestr-wallet` — a wallet for sidestr sidechains, in Rust: the coin
//! set for a script, the reference coin selection, taproot key-path spends
//! and peg-out burns signed behind a signer port, the parent-side peg-in
//! transaction shape, and delivery as a `POST /tx` body or a kind-23500
//! event.
//!
//! A wallet needs a chain id and a relay, and nothing of the producer's
//! (SPEC 11). It learns the chain from a mirror's `chain.json`, held to the
//! signer's announced tip; asks a producer `/coins/<script hex>` for what
//! its script owns, or folds the block file itself with
//! [`sidestr_core::State`] and gets the same list; builds a transaction
//! Bitcoin's rules accept, with the fee at the document's `minFeeRate`; and
//! hands it over as `POST /tx` or as an event on a relay whose key is
//! anyone's, because the transaction authorises itself. A producer includes
//! what validates. A wallet with nothing publishes a kind-23501 request and
//! a faucet may answer it.
//!
//! This crate is a port of **siding**, the reference implementation by
//! Melvin Carvalho (<https://github.com/sidestr/spec>, AGPL-3.0), ported from
//! commit `2de40bdac4cba01be0864156a553d8287c22e279` — `siding/lib/spend.mjs`,
//! `lib/address.mjs`, the construction halves of `lib/parent.mjs` and
//! `lib/checkpoint.mjs`, and the `send` and `faucet` commands of
//! `bin/siding.mjs` — and carries the same licence, AGPL-3.0-only. `SPEC.md`
//! in that repository is the design; section numbers below are its. Where a
//! function ports a siding function its documentation names it. Consensus
//! types, the markers, addresses and the document come from
//! [`sidestr_core`] and are not duplicated here.
//!
//! # What is here
//!
//! | module | what | SPEC | ported from |
//! |---|---|---|---|
//! | [`coins`] | the coin set for a script: `/coins` JSON or a state fold; maturity | 11 | `siding/lib/chain.mjs coins`, `spend.mjs` |
//! | [`select`] | largest-first selection to the amount plus a fee bound | 11 | `spend.mjs buildSpend` |
//! | [`spend`] | a key-path spend to an address or script, fee at `minFeeRate`, signed, as hex | 11 | `spend.mjs buildSpend`, `resolveTo`; `siding send` |
//! | [`burn`] | a peg-out: `OP_RETURN pegout:<parent script hex>`, at least `pegoutMin` | 7 | `spend.mjs` (`--pegout`) |
//! | [`pegin`] | the parent side: peg output + `pegin:<chain id>:<script>` marker; the peg-out payment and checkpoint shapes; scanning | 6, 7, 11 | `parent.mjs`, `checkpoint.mjs` |
//! | [`deliver`] | `POST /tx`, `/coins`, `/tip`, `/chain.json` as data; kind 23500 / 23501 templates; HTTP behind feature `client` | 11 | `spend.mjs deliver`, `bin/siding.mjs` routes |
//! | [`key`] | the [`SpendSigner`] port, a plain key, pubkey → `5120` script → bech32m, ADR-2101 spend-key derivation | 3 | `sign.mjs`, `address.mjs` |
//! | [`policy`] | the [`SpendPolicy`] hook every builder consults; [`Permissive`] | — | (ADR-2100) |
//!
//! # A payment, end to end
//!
//! Against a chain held in memory — the same calls work against a
//! producer's `/coins` and `/tip` (see [`deliver`]).
//!
//! ```
//! use bitcoin::secp256k1::SecretKey;
//! use sidestr_core::block::{challenge_for, pubkey_of};
//! use sidestr_core::document::{ChainDocument, Peg};
//! use sidestr_core::state::{NextBlock, State};
//! use sidestr_wallet::burn::{build_burn, BurnRequest};
//! use sidestr_wallet::spend::{build_spend, SpendRequest};
//! use sidestr_wallet::{coins, key, Error, Permissive, PlainKey, SpendSigner};
//!
//! // the chain's signer seals blocks; the wallet's spend key is a role key (ADR-2101)
//! let signer = SecretKey::from_slice(&[7u8; 32]).unwrap();
//! let root = SecretKey::from_slice(&[0x11u8; 32]).unwrap();
//! let wallet = PlainKey::new(key::derive_spend_key(&root, &"0".repeat(64), 0).unwrap());
//!
//! // a throwaway document whose genesis pegs 0.01 BTC to the wallet's script (SPEC 5)
//! let json = format!(r#"{{"id":"sidestr:example","name":"example","parent":"tbtc4","challenge":"{}",
//!   "powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","addressPrefix":"ex",
//!   "genesisTime":1790000000,"signer":"{}","pegs":[]}}"#, challenge_for(&pubkey_of(&signer)).to_hex_string(), pubkey_of(&signer));
//! let mut doc = ChainDocument::from_json(&json).unwrap();
//! doc.pegs.push(Peg { txid: "a".repeat(64), vout: 0, amount: 1_000_000, script: wallet.script().to_hex_string(), extra: Default::default() });
//! let mut chain = State::with_key(doc.clone(), &signer).unwrap();
//!
//! // genesis coins are coinbase outputs: mature at 100 (a wallet sees this as `coinbase: true`)
//! let listed = coins::from_state(&chain, &wallet.script());
//! assert!(listed[0].coinbase && !listed[0].is_mature(chain.height()));
//! for i in 1..=100 { chain.produce(&signer, &NextBlock { time: 1790000000 + i, claims: vec![] }, None).unwrap(); }
//!
//! // pay someone: an address under the chain's prefix, fee at minFeeRate, signed through the port
//! let you = key::address_for(&PlainKey::new(SecretKey::from_slice(&[8u8; 32]).unwrap()).pubkey(), "ex").unwrap();
//! let req = SpendRequest { chain: &doc, coins: &listed, tip_height: chain.height(), to: &you, amount: 250_000, fee: None };
//! let paid = build_spend(&req, &wallet, &Permissive).unwrap();
//! let ok = chain.submit(paid.tx.clone()).unwrap();          // the producer's mempool policy, and the signature
//! assert_eq!((ok.txid, ok.fee), (paid.txid, paid.fee));
//!
//! // once mined, the change is a coin; burn some of it to a parent address: the peg holders owe it on tbtc4 (SPEC 7)
//! chain.produce(&signer, &NextBlock { time: 1790000200, claims: vec![] }, None).unwrap();
//! let coins_now = coins::from_state(&chain, &wallet.script());
//! assert_eq!(coins_now[0].value, paid.change);
//! let burn = build_burn(&BurnRequest { chain: &doc, coins: &coins_now, tip_height: chain.height(), to: "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc", amount: 10_000, fee: None }, &wallet, &Permissive).unwrap();
//! assert!(chain.submit(burn.tx.clone()).is_ok());
//!
//! // what the wallet refuses before signing
//! assert!(matches!(build_spend(&SpendRequest { amount: 5_000_000, ..req }, &wallet, &Permissive), Err(Error::Insufficient { .. })));
//! assert!(matches!(build_spend(&SpendRequest { amount: 100, ..req }, &wallet, &Permissive), Err(Error::Dust { .. })));
//! ```
//!
//! # Conventions that matter
//!
//! - **Keys stay behind [`SpendSigner`].** A builder computes the BIP 341
//!   key-path sighash and asks the port to sign it; it never holds a secret.
//!   [`PlainKey`] is the in-memory implementation; a signer that holds a
//!   derived role key and permits named operations only (ADR-2101) fits the
//!   same trait. [`key::derive_spend_key`] is the derivation; the identity
//!   key never spends.
//! - **The wallet builds and signs; it does not decide.** Every builder
//!   consults a [`SpendPolicy`] with the chain, kind, script, amount, fee
//!   and input count before signing. [`Permissive`] says yes; the authority
//!   gate (ADR-2100) is the caller's implementation.
//! - **The fee is `minFeeRate × vsize`, exactly**, sized with the 64-byte
//!   witness the signer will produce, unless the caller fixes one — and a
//!   fixed fee under the rate is refused here rather than by the producer.
//! - **No I/O by default.** `deliver` returns URLs, bodies and event
//!   templates; feature `client` adds the HTTP calls over `ureq`. Nothing
//!   here publishes to a relay: the event's signature is `sidestr-nostr`'s.
//! - **Amounts are sats**, `u64`; txids in markers are display-order hex, as
//!   the markers carry them; structural txids are [`bitcoin::Txid`].
//!
//! # Where this port departs from siding
//!
//! - **The signature is plain BIP 341, `SIGHASH_DEFAULT`, 64 bytes.**
//!   `spend.mjs` signs with the schema kernel's *unified* sighash (hash type
//!   `0x01 | 0x20`, a 65-byte witness) — a construction only that kernel
//!   verifies, which [`sidestr_core::block::verify_key_path_input`] refuses
//!   as an invalid taproot sighash type. siding's own verifier accepts the
//!   standard form as well (its `verifyInput` falls through to BIP 341 when
//!   the `0x20` bit is absent), so a transaction from this crate is accepted
//!   by both engines and a byte-for-byte match with the kernel's output is
//!   not a goal; acceptance is (`tests/oracle.rs`).
//! - **Dust is refused.** siding will pay 1 sat to a taproot script and
//!   return 1 sat of change; this crate refuses an amount under the script's
//!   dust threshold ([`spend::dust_threshold`], 330 sats for taproot) and
//!   leaves change under it to the fee instead of minting an unspendable
//!   coin. A burn's `OP_RETURN` has no dust floor; `pegoutMin` governs it.
//! - **A fixed fee is checked against `minFeeRate`** before signing;
//!   siding lets the producer refuse it.
//! - **Zero BIP 340 auxiliary randomness** in [`PlainKey`], as `sidestr-core`
//!   seals blocks: a spend is a pure function of its inputs and the key.
//! - **The EVM deposit branch is not carried** (`--evm`; ADR-2096 excludes
//!   the `evm` rule), nor are assets (SPEC 12, reserved).

#![forbid(unsafe_code)]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::broken_intra_doc_links
)]

pub mod burn;
pub mod coins;
pub mod deliver;
pub mod error;
pub mod key;
pub mod pegin;
pub mod policy;
pub mod select;
pub mod spend;

pub use burn::{build_burn, BurnRequest};
pub use coins::Coin;
pub use error::{Error, Result};
pub use key::{PlainKey, SpendSigner};
pub use pegin::{build_pegin, PegIn};
pub use policy::{Permissive, SpendPolicy};
pub use spend::{build_spend, Spend, SpendRequest};
