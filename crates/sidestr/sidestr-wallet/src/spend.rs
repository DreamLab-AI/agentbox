//! A key-path taproot spend to an address or script, with the fee sized at
//! the chain's `minFeeRate`, signed through the [`SpendSigner`] port and
//! encoded as the hex a producer's `POST /tx` takes (SPEC 11). A port of
//! `siding/lib/spend.mjs buildSpend` and `resolveTo`, and of the shape
//! `siding send` prints.
//!
//! The transaction is the one a validator with only key-path verification
//! accepts ([`sidestr_core::block::verify_key_path_input`]): version 2,
//! lock time 0, every input an outpoint paying the signer's `5120‖key`
//! script with sequence `0xfffffffd`, every witness one 64-byte BIP 340
//! signature over the BIP 341 key-path sighash with `SIGHASH_DEFAULT`, the
//! amount to the destination, change back to the signer's script.
//!
//! ```
//! use bitcoin::secp256k1::SecretKey;
//! use sidestr_core::block::verify_key_path_input;
//! use sidestr_core::document::ChainDocument;
//! use sidestr_wallet::coins::Coin;
//! use sidestr_wallet::key::PlainKey;
//! use sidestr_wallet::policy::Permissive;
//! use sidestr_wallet::spend::{build_spend, SpendRequest};
//! use sidestr_wallet::SpendSigner;
//!
//! let chain = ChainDocument::from_json(r#"{"id":"sidestr:example","name":"example","parent":"tbtc4",
//!   "challenge":"5120aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
//!   "addressPrefix":"ex","genesisTime":1790000000,"pegs":[],"minFeeRate":2,"pegoutMin":10000}"#).unwrap();
//! let me = PlainKey::new(SecretKey::from_slice(&[9u8; 32]).unwrap());
//! // a coin the producer listed for my script (a real one is a peg-in claim or a payment)
//! let coins = vec![Coin { outpoint: format!("{}:0", "ab".repeat(32)).parse().unwrap(), value: 100_000, height: 5, coinbase: false }];
//! let you = sidestr_wallet::key::address_for(&PlainKey::new(SecretKey::from_slice(&[8u8; 32]).unwrap()).pubkey(), "ex").unwrap();
//!
//! let s = build_spend(&SpendRequest { chain: &chain, coins: &coins, tip_height: 10, to: &you, amount: 40_000, fee: None }, &me, &Permissive).unwrap();
//! assert_eq!((s.inputs, s.amount, s.vsize), (1, 40_000, 154));   // one input, amount + change
//! assert_eq!(s.fee, 2 * s.vsize);                  // minFeeRate × vsize, exactly
//! assert_eq!(s.change, 100_000 - 40_000 - s.fee);
//! assert_eq!(s.tx.output[1].script_pubkey, me.script());
//! // what the chain will check
//! let prevouts = [bitcoin::TxOut { value: bitcoin::Amount::from_sat(100_000), script_pubkey: me.script() }];
//! assert!(verify_key_path_input(&s.tx, 0, &prevouts).is_ok());
//! assert_eq!(s.hex, bitcoin::consensus::encode::serialize_hex(&s.tx));
//! ```

use bitcoin::consensus::encode::serialize_hex;
use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
use bitcoin::transaction::Version;
use bitcoin::{
    absolute::LockTime, Amount, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid, Witness,
};
use sidestr_core::address::{decode_address, script_to_address};
use sidestr_core::block::verify_key_path_input;
use sidestr_core::document::ChainDocument;

use crate::coins::{mature, Coin};
use crate::error::{Error, Result};
use crate::key::SpendSigner;
use crate::policy::{Intent, IntentKind, SpendPolicy};
use crate::select::{fee_bound, select};

/// What `--to` resolved to (`spend.mjs resolveTo`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// The output script paid.
    pub script: ScriptBuf,
    /// A warning when the address carries a prefix other than the chain's:
    /// the script is what is paid, so it is accepted, and said.
    pub note: Option<String>,
}

/// A destination is a script hex or a segwit address under any prefix; the
/// script is what is paid (`spend.mjs resolveTo`). An address with another
/// chain's prefix is accepted with a note naming what it is here.
pub fn resolve_to(to: &str, hrp: &str) -> Result<Resolved> {
    let to = to.trim();
    if !to.is_empty() && to.len() % 2 == 0 && to.bytes().all(|b| b.is_ascii_hexdigit()) {
        let script = ScriptBuf::from_hex(&to.to_ascii_lowercase())
            .map_err(|_| Error::BadDestination(to.to_string()))?;
        return Ok(Resolved { script, note: None });
    }
    let a = decode_address(to).ok_or_else(|| Error::BadDestination(to.to_string()))?;
    let note = (a.hrp != hrp.to_ascii_lowercase()).then(|| {
        format!(
            "{}… carries prefix '{}', this chain's is '{hrp}' ({}); paying its script",
            to.chars().take(12).collect::<String>(),
            a.hrp,
            script_to_address(&a.script, hrp).unwrap_or_default()
        )
    });
    Ok(Resolved {
        script: a.script,
        note,
    })
}

/// What a spend is built from.
#[derive(Debug, Clone, Copy)]
pub struct SpendRequest<'a> {
    /// The chain document: `id`, `addressPrefix`, `minFeeRate` are read.
    pub chain: &'a ChainDocument,
    /// The signer's coins as listed, immature ones included; the builder
    /// applies maturity against `tip_height`.
    pub coins: &'a [Coin],
    /// The producer's tip height (`/tip`), for maturity.
    pub tip_height: u32,
    /// A script hex or an address under any prefix.
    pub to: &'a str,
    /// Sats to pay.
    pub amount: u64,
    /// A fixed fee, or `None` for `minFeeRate × vsize`.
    pub fee: Option<u64>,
}

/// A built, signed spend: the transaction and what `siding send` reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spend {
    /// The signed transaction.
    pub tx: Transaction,
    /// Its consensus encoding, hex: the `POST /tx` body and the kind-23500 content.
    pub hex: String,
    /// Its id.
    pub txid: Txid,
    /// Coins spent.
    pub inputs: usize,
    /// Sats paid to the destination (burned, for a peg-out).
    pub amount: u64,
    /// Sats of fee.
    pub fee: u64,
    /// Virtual size, weight over four rounded up.
    pub vsize: u64,
    /// Sats returned to the signer's script; 0 when there was no change output.
    pub change: u64,
    /// A warning worth showing (prefix mismatch; what a peg-out means).
    pub note: Option<String>,
}

/// Build and sign a spend. Checks, in order: the amount is positive and not
/// dust for its script; the mature coins cover it plus the fee bound
/// ([`crate::select`]); the fee, sized or given, meets `minFeeRate`; the
/// policy permits the intent. Then every input is signed and re-verified
/// under `sidestr-core`'s rule before the transaction is returned.
pub fn build_spend(
    req: &SpendRequest<'_>,
    signer: &dyn SpendSigner,
    policy: &dyn SpendPolicy,
) -> Result<Spend> {
    let dest = resolve_to(req.to, &req.chain.address_prefix)?;
    assemble(
        req.chain,
        req.coins,
        req.tip_height,
        req.amount,
        req.fee,
        signer,
        policy,
        Plan {
            kind: IntentKind::Spend,
            output_script: dest.script.clone(),
            intent_script: dest.script,
            note: dest.note,
        },
    )
}

/// The half of a build that spend and burn share: what the first output is,
/// and what the policy is told it pays.
pub(crate) struct Plan {
    pub kind: IntentKind,
    /// The script of the amount-carrying output.
    pub output_script: ScriptBuf,
    /// The script the policy weighs: the destination, or the parent script a burn names.
    pub intent_script: ScriptBuf,
    pub note: Option<String>,
}

/// The dust threshold for a script under Bitcoin's default relay policy
/// (330 sats for a taproot output; 0 for `OP_RETURN`). siding does not check
/// this; a chain accepts a 1-sat output and no wallet can economically spend
/// it, so this crate refuses to make one.
pub fn dust_threshold(script: &ScriptBuf) -> u64 {
    TxOut::minimal_non_dust(script.clone()).value.to_sat()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn assemble(
    chain: &ChainDocument,
    coins: &[Coin],
    tip_height: u32,
    amount: u64,
    fee: Option<u64>,
    signer: &dyn SpendSigner,
    policy: &dyn SpendPolicy,
    plan: Plan,
) -> Result<Spend> {
    if amount == 0 {
        return Err(Error::BadAmount);
    }
    let dust = dust_threshold(&plan.output_script);
    if amount < dust {
        return Err(Error::Dust {
            value: amount,
            min: dust,
            script: plan.output_script.to_hex_string(),
        });
    }
    let me = signer.script();
    let rate = chain.min_fee_rate;
    let picked = select(
        &mature(coins, tip_height),
        amount,
        fee.unwrap_or(fee_bound(rate)),
    )?;
    let sum = picked.sum;

    // the unsigned skeleton (`spend.mjs`: version 2, sequence 0xfffffffd, lockTime 0)
    let inputs: Vec<TxIn> = picked
        .picked
        .iter()
        .map(|c| TxIn {
            previous_output: c.outpoint,
            script_sig: ScriptBuf::new(),
            sequence: Sequence(0xffff_fffd),
            witness: Witness::new(),
        })
        .collect();
    let change_dust = dust_threshold(&me);
    // outputs for a fee: the amount, then change when it is worth an output;
    // change below dust is left to the fee rather than made into a coin
    let layout = |f: u64| -> Result<(Vec<TxOut>, u64, u64)> {
        let change = sum
            .checked_sub(amount)
            .and_then(|r| r.checked_sub(f))
            .ok_or(Error::InsufficientForFee { amount, fee: f })?;
        let mut out = vec![TxOut {
            value: Amount::from_sat(amount),
            script_pubkey: plan.output_script.clone(),
        }];
        if change > 0 && change >= change_dust {
            out.push(TxOut {
                value: Amount::from_sat(change),
                script_pubkey: me.clone(),
            });
            Ok((out, change, f))
        } else {
            Ok((out, 0, f + change))
        }
    };
    let mut tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: inputs,
        output: layout(fee.unwrap_or(0))?.0,
    };
    // size it as it will be signed: one 64-byte signature per input
    let placeholder = Witness::from_slice(&[[0u8; 64]]);
    for i in &mut tx.input {
        i.witness = placeholder.clone();
    }
    let vsize = tx.weight().to_wu().div_ceil(4);
    let min_fee = vsize * rate;
    let (outputs, change, fee) = match fee {
        None => layout(min_fee)?,
        Some(f) if f < min_fee => {
            return Err(Error::FeeBelowMinimum {
                fee: f,
                min: min_fee,
                vsize,
                rate,
            })
        }
        Some(f) => layout(f)?,
    };
    tx.output = outputs;
    // with one output fewer the size only shrinks, so the fee still clears the rate

    policy
        .permit(&Intent {
            chain_id: &chain.id,
            kind: plan.kind,
            script: &plan.intent_script,
            amount,
            fee,
            inputs: tx.input.len(),
        })
        .map_err(Error::Policy)?;

    // sign: BIP 341 key path, SIGHASH_DEFAULT, over every prevout (all pay `me`)
    let prevouts: Vec<TxOut> = picked
        .picked
        .iter()
        .map(|c| TxOut {
            value: Amount::from_sat(c.value),
            script_pubkey: me.clone(),
        })
        .collect();
    for i in 0..tx.input.len() {
        let digest = SighashCache::new(&tx)
            .taproot_key_spend_signature_hash(i, &Prevouts::All(&prevouts), TapSighashType::Default)
            .map_err(|e| Error::Signer(format!("sighash: {e}")))?;
        let sig = signer.sign_key_path(digest.as_ref())?;
        tx.input[i].witness = Witness::from_slice(&[sig.serialize()]);
    }
    for i in 0..tx.input.len() {
        verify_key_path_input(&tx, i, &prevouts)
            .map_err(|e| Error::Signer(format!("input {i} does not verify after signing: {e}")))?;
    }
    let vsize = tx.weight().to_wu().div_ceil(4);
    Ok(Spend {
        hex: serialize_hex(&tx),
        txid: tx.compute_txid(),
        inputs: tx.input.len(),
        amount,
        fee,
        vsize,
        change,
        note: plan.note,
        tx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_scripts_and_addresses() {
        let r = resolve_to(&format!("5120{}", "AB".repeat(32)), "trl").unwrap();
        assert_eq!(r.script.to_hex_string(), format!("5120{}", "ab".repeat(32)));
        assert!(r.note.is_none());
        let tb = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";
        let r = resolve_to(tb, "trl").unwrap();
        assert!(r.note.unwrap().contains("carries prefix 'tb'"));
        assert!(resolve_to(tb, "tb").unwrap().note.is_none());
        assert!(matches!(
            resolve_to("trl1nope", "trl"),
            Err(Error::BadDestination(_))
        ));
        assert!(matches!(
            resolve_to("abc", "trl"),
            Err(Error::BadDestination(_))
        ));
        assert_eq!(
            dust_threshold(&ScriptBuf::from_hex(&format!("5120{}", "ab".repeat(32))).unwrap()),
            330
        );
        assert_eq!(
            dust_threshold(&ScriptBuf::from_hex("6a0461626364").unwrap()),
            0
        );
    }
}
