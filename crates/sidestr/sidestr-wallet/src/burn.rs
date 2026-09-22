//! A peg-out (SPEC 7): a sidechain transaction paying a **burn output**,
//! `OP_RETURN pegout:<parent output script hex>` with a value of at least
//! `pegoutMin`. The value leaves the supply; the peg holders owe it to that
//! script on the parent. A port of the `pegout` branch of
//! `siding/lib/spend.mjs buildSpend` (`siding send --pegout`).
//!
//! The destination is a parent address (any prefix) or a script hex; only
//! the script matters, and a `bc1…` and a `tb1…` address with the same
//! program name the same script, so no network check applies here — the
//! peg holders' wallet on the parent decides what it can pay. The marker is
//! [`sidestr_core::marker::pegout_marker`], parsed back with
//! [`sidestr_core::marker::parse_pegout`] before the build goes on, so a
//! script the chain would refuse (under 2 or over 40 bytes) fails here.
//!
//! ```
//! use bitcoin::secp256k1::SecretKey;
//! use sidestr_core::document::ChainDocument;
//! use sidestr_core::marker::parse_pegout;
//! use sidestr_wallet::burn::{build_burn, BurnRequest};
//! use sidestr_wallet::coins::Coin;
//! use sidestr_wallet::{Error, PlainKey, Permissive};
//!
//! let chain = ChainDocument::from_json(r#"{"id":"sidestr:example","name":"example","parent":"tbtc4",
//!   "challenge":"5120aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
//!   "addressPrefix":"ex","genesisTime":1790000000,"pegs":[],"minFeeRate":1,"pegoutMin":10000}"#).unwrap();
//! let me = PlainKey::new(SecretKey::from_slice(&[9u8; 32]).unwrap());
//! let coins = vec![Coin { outpoint: format!("{}:0", "ab".repeat(32)).parse().unwrap(), value: 100_000, height: 5, coinbase: false }];
//! let parent = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";
//!
//! let req = BurnRequest { chain: &chain, coins: &coins, tip_height: 10, to: parent, amount: 25_000, fee: None };
//! let b = build_burn(&req, &me, &Permissive).unwrap();
//! let named = parse_pegout(&b.tx.output[0].script_pubkey).unwrap();
//! assert_eq!(named, sidestr_core::address::address_to_script(parent).unwrap().to_hex_string());
//! assert_eq!(b.tx.output[0].value.to_sat(), 25_000);
//! assert!(b.note.unwrap().starts_with("peg-out: 25000 sats burn here"));
//!
//! // below pegoutMin is refused before anything is signed
//! assert!(matches!(build_burn(&BurnRequest { amount: 9_999, ..req }, &me, &Permissive), Err(Error::BelowPegoutMin { min: 10000, .. })));
//! ```

use sidestr_core::document::ChainDocument;
use sidestr_core::marker::{parse_pegout, pegout_marker};

use crate::coins::Coin;
use crate::error::{Error, Result};
use crate::key::SpendSigner;
use crate::policy::{IntentKind, SpendPolicy};
use crate::spend::{assemble, resolve_to, Plan, Spend};

/// What a burn is built from.
#[derive(Debug, Clone, Copy)]
pub struct BurnRequest<'a> {
    /// The chain document: `id`, `parent`, `minFeeRate`, `pegoutMin` are read.
    pub chain: &'a ChainDocument,
    /// The signer's coins as listed, immature ones included.
    pub coins: &'a [Coin],
    /// The producer's tip height, for maturity.
    pub tip_height: u32,
    /// A parent address (any prefix) or the parent output script as hex.
    pub to: &'a str,
    /// Sats to burn; at least the document's `pegoutMin`.
    pub amount: u64,
    /// A fixed fee, or `None` for `minFeeRate × vsize`.
    pub fee: Option<u64>,
}

/// Build and sign a peg-out burn. [`Error::BelowPegoutMin`] before any coin
/// is touched; then the checks of [`crate::spend::build_spend`], with the
/// policy told [`IntentKind::Burn`] and the parent script.
pub fn build_burn(
    req: &BurnRequest<'_>,
    signer: &dyn SpendSigner,
    policy: &dyn SpendPolicy,
) -> Result<Spend> {
    let min = req.chain.pegout_min;
    if req.amount < min {
        return Err(Error::BelowPegoutMin {
            value: req.amount,
            min,
        });
    }
    let parent = resolve_to(req.to, &req.chain.address_prefix)?.script;
    let marker = pegout_marker(&parent.to_hex_string());
    if parse_pegout(&marker).is_none() {
        return Err(Error::BadDestination(format!(
            "{}: a peg-out names a parent output script of 2 to 40 bytes",
            req.to
        )));
    }
    let note = format!(
        "peg-out: {} sats burn here and are owed to {} on {} (at least {min})",
        req.amount, req.to, req.chain.parent
    );
    assemble(
        req.chain,
        req.coins,
        req.tip_height,
        req.amount,
        req.fee,
        signer,
        policy,
        Plan {
            kind: IntentKind::Burn,
            output_script: marker,
            intent_script: parent,
            note: Some(note),
        },
    )
}
