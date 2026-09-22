//! The parent side (SPEC 6, 7, 11): the peg-in transaction shape a wallet
//! builds on the parent, and the shapes of the peg holders' peg-out payment
//! and the producer's checkpoint, all with rust-bitcoin for the parent
//! network the chain document names. A port of the transaction and marker
//! construction of `siding/lib/parent.mjs` (`scanPegins`, `payPegout`) and
//! `siding/lib/checkpoint.mjs` (`sendCheckpoint`), not of their RPC client:
//! siding hands Bitcoin Core a `send` call with `[{address: btc}, {data:
//! hex}]`, and [`PegIn::core_send_outputs`] is that argument.
//!
//! A peg-in is a parent transaction that pays a **peg output** — a taproot
//! output to the peg holders' address — and carries `OP_RETURN
//! pegin:<chain id>:<sidechain output script>` naming where the coins
//! appear on the sidechain. After `pegConfirmations` the producer claims it
//! ([`sidestr_core::state::ClaimRequest`]). The peg output's script path
//! (`and_v(v:pk(refund), older(refundBlocks))`) is the peg holders'
//! descriptor; the wallet pays the address it is given.
//!
//! ```
//! use bitcoin::consensus::encode::{deserialize, serialize};
//! use sidestr_core::document::ChainDocument;
//! use sidestr_core::marker::parse_peg_marker;
//! use sidestr_wallet::pegin::{build_pegin, scan_pegin};
//! use sidestr_wallet::Error;
//!
//! let chain = ChainDocument::from_json(r#"{"id":"sidestr:trial","name":"trial","parent":"tbtc4",
//!   "challenge":"512098b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b","powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
//!   "addressPrefix":"trl","genesisTime":1790000000,"pegs":[]}"#).unwrap();
//! let peg_address = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";
//! let mine = "512098b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b"; // or a trl1p… address
//!
//! let p = build_pegin(&chain, peg_address, 250_000, mine).unwrap();
//! assert_eq!(p.marker.script_pubkey.len(), 2 + 20 + 34);   // 6a, len, "pegin:sidestr:trial:", the raw script
//! // the unsigned parent transaction round-trips and the marker parses under sidestr-core
//! let tx = p.transaction(vec![], None);
//! let back: bitcoin::Transaction = deserialize(&serialize(&tx)).unwrap();
//! assert_eq!(parse_peg_marker(&back.output[1].script_pubkey, "sidestr:trial").unwrap(), p.side_script);
//! // and a level-2 producer scanning the parent finds it
//! let found = scan_pegin(&back, "sidestr:trial").unwrap();
//! assert_eq!((found.vout, found.amount), (0, 250_000));
//!
//! // a mainnet peg address beside tbtc4 is the wrong network
//! let bc = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
//! assert!(matches!(build_pegin(&chain, bc, 250_000, mine), Err(Error::WrongNetwork { .. })));
//! ```

use core::str::FromStr;

use bitcoin::script::PushBytesBuf;
use bitcoin::transaction::Version;
use bitcoin::{absolute::LockTime, Address, Amount, Network, ScriptBuf, Transaction, TxIn, TxOut};
use sidestr_core::document::ChainDocument;
use sidestr_core::marker::{
    checkpoint_data, parse_peg_marker, peg_marker_data, pegout_marker_data,
};
use sidestr_core::parents::Parent;

use crate::error::{Error, Result};
use crate::spend::{dust_threshold, resolve_to};

/// The parent's 80-byte `OP_RETURN` relay policy (`siding/lib/marker.mjs`:
/// "inside the 80-byte OP_RETURN policy limit").
pub const PARENT_DATA_LIMIT: usize = 80;

/// The rust-bitcoin network a SPEC 3.2 parent's addresses are encoded for:
/// the BLAKE2b forks share Bitcoin's address encodings with their origins.
/// `None` for a reserved parent (`ltc`, `vtc`).
pub fn parent_network(parent: &Parent) -> Option<Network> {
    match parent.alias {
        "btc" | "xbt" => Some(Network::Bitcoin),
        "tbtc4" | "txbt4" => Some(Network::Testnet4),
        _ => None,
    }
}

/// The most a marker's push carries: the shared grammar
/// ([`sidestr_core::marker::op_return_data`]) reads a direct push or
/// `OP_PUSHDATA1`, one length byte, so 255 bytes; `PushBytesBuf` itself would
/// happily build an `OP_PUSHDATA2` push no parser reads back (audit F4).
pub const MARKER_DATA_LIMIT: usize = 255;

/// `OP_RETURN` with one minimal push of `data`, held to
/// [`MARKER_DATA_LIMIT`] so the script parses back through the shared marker
/// grammar; [`Error::MarkerTooLong`] otherwise.
fn op_return(data: &[u8]) -> Result<ScriptBuf> {
    if data.len() > MARKER_DATA_LIMIT {
        return Err(Error::MarkerTooLong(data.len()));
    }
    let push = PushBytesBuf::try_from(data.to_vec())
        .map_err(|_| Error::Encoding("push over 255 bytes".into()))?;
    Ok(ScriptBuf::new_op_return(&push))
}

/// A peg-in's two outputs, ready for whatever funds and signs the parent
/// transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PegIn {
    /// The chain the coins appear on.
    pub chain_id: String,
    /// Sats pegged.
    pub amount: u64,
    /// The sidechain script the marker names.
    pub side_script: ScriptBuf,
    /// The peg holders' address, checked for the parent's network.
    pub peg_address: Address,
    /// Output 0: `amount` to the peg address.
    pub peg: TxOut,
    /// Output 1: `OP_RETURN pegin:<chain id>:<script bytes>`, 0 sats.
    pub marker: TxOut,
}

/// Build the shape. `peg_address` must be a taproot address for the
/// document's parent network ([`Error::WrongNetwork`] otherwise);
/// `side_script_or_address` is a script hex or an address under the chain's
/// prefix (any prefix is accepted, as everywhere); the marker must fit
/// [`PARENT_DATA_LIMIT`].
pub fn build_pegin(
    chain: &ChainDocument,
    peg_address: &str,
    amount: u64,
    side_script_or_address: &str,
) -> Result<PegIn> {
    let parent = chain.parent()?;
    let network =
        parent_network(parent).ok_or(Error::Core(sidestr_core::Error::ReservedParent {
            alias: parent.alias,
            label: parent.label,
        }))?;
    let wrong = |a: &str| Error::WrongNetwork {
        address: a.to_string(),
        network: network.to_string(),
        parent: parent.alias.to_string(),
    };
    let address = Address::from_str(peg_address.trim())
        .map_err(|_| Error::BadDestination(peg_address.to_string()))?
        .require_network(network)
        .map_err(|_| wrong(peg_address))?;
    let peg_script = address.script_pubkey();
    if !peg_script.is_p2tr() {
        return Err(Error::BadDestination(format!(
            "{peg_address}: a peg output is a taproot output (SPEC 6)"
        )));
    }
    if amount == 0 {
        return Err(Error::BadAmount);
    }
    let dust = dust_threshold(&peg_script);
    if amount < dust {
        return Err(Error::Dust {
            value: amount,
            min: dust,
            script: peg_script.to_hex_string(),
        });
    }
    let side_script = resolve_to(side_script_or_address, &chain.address_prefix)?.script;
    let data = peg_marker_data(&chain.id, &side_script);
    if data.len() > PARENT_DATA_LIMIT {
        return Err(Error::MarkerTooLong(data.len()));
    }
    let marker_script = op_return(&data)?;
    debug_assert_eq!(
        parse_peg_marker(&marker_script, &chain.id).as_ref(),
        Some(&side_script)
    );
    Ok(PegIn {
        chain_id: chain.id.clone(),
        amount,
        side_script,
        peg: TxOut {
            value: Amount::from_sat(amount),
            script_pubkey: peg_script,
        },
        marker: TxOut {
            value: Amount::ZERO,
            script_pubkey: marker_script,
        },
        peg_address: address,
    })
}

impl PegIn {
    /// The two outputs, peg first.
    pub fn outputs(&self) -> Vec<TxOut> {
        vec![self.peg.clone(), self.marker.clone()]
    }
    /// An unsigned parent transaction: these inputs (the parent wallet's
    /// coins, witnesses empty), the peg, the marker, then `change` if any.
    /// Signing is the parent wallet's; a PSBT round-trip is 0.2's.
    pub fn transaction(&self, inputs: Vec<TxIn>, change: Option<TxOut>) -> Transaction {
        let mut output = self.outputs();
        output.extend(change);
        Transaction {
            version: Version::TWO,
            lock_time: LockTime::ZERO,
            input: inputs,
            output,
        }
    }
    /// The `outputs` argument of Bitcoin Core's `send` RPC, as
    /// `siding/lib/parent.mjs` shapes it: `[{"<address>": "<btc>"}, {"data":
    /// "<hex>"}]`, the amount as a BTC string with eight decimals.
    pub fn core_send_outputs(&self) -> serde_json::Value {
        serde_json::json!([
            { self.peg_address.to_string(): btc_string(self.amount) },
            { "data": hex::encode(marker_payload(&self.marker.script_pubkey)) }
        ])
    }
}

/// `sats` as Bitcoin Core writes an amount: `"0.00250000"`.
pub fn btc_string(sats: u64) -> String {
    format!("{}.{:08}", sats / 100_000_000, sats % 100_000_000)
}

/// The data behind an `OP_RETURN` script's push, for a `{"data": …}` output.
fn marker_payload(spk: &ScriptBuf) -> Vec<u8> {
    sidestr_core::marker::op_return_data(spk)
        .unwrap_or_default()
        .to_vec()
}

/// A peg-in found in a parent transaction (`siding/lib/parent.mjs
/// scanPegins`, per transaction).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundPegIn {
    /// The peg output's index.
    pub vout: u32,
    /// Its value in sats.
    pub amount: u64,
    /// The sidechain script the marker names.
    pub script: ScriptBuf,
}

/// The peg-in a parent transaction makes for `chain_id`, if any: the first
/// output whose marker names this chain gives the script, and the peg
/// output is the first taproot output (the marker is `OP_RETURN`, never
/// taproot). `None` when there is no marker or no taproot output.
pub fn scan_pegin(tx: &Transaction, chain_id: &str) -> Option<FoundPegIn> {
    let script = tx
        .output
        .iter()
        .find_map(|o| parse_peg_marker(&o.script_pubkey, chain_id))?;
    let (vout, peg) = tx
        .output
        .iter()
        .enumerate()
        .find(|(_, o)| o.script_pubkey.is_p2tr())?;
    Some(FoundPegIn {
        vout: vout as u32,
        amount: peg.value.to_sat(),
        script,
    })
}

/// The peg holders' payment of one burn on the parent (SPEC 7;
/// `siding/lib/parent.mjs payPegout`): `value` to the parent script the
/// burn named, and `OP_RETURN pegout:<chain id>:<sidechain txid, 32 raw
/// bytes>` so a validator with a parent view pairs the payment with its
/// burn. The parent's fee comes from the peg outputs, which is the parent
/// wallet's business.
///
/// The record is `8 + chain id + 32` bytes and goes on the parent, so it is
/// held to [`PARENT_DATA_LIMIT`] like the peg-in marker: a chain id over 40
/// bytes is [`Error::MarkerTooLong`] here rather than a transaction the
/// parent will not relay. (The reference `pegoutMarkerData` does not check;
/// its `send` would fail at the node.)
pub fn pegout_payment_outputs(
    chain_id: &str,
    side_txid: &str,
    parent_script_hex: &str,
    value: u64,
) -> Result<Vec<TxOut>> {
    let script = ScriptBuf::from_hex(parent_script_hex)
        .map_err(|_| Error::BadDestination(parent_script_hex.to_string()))?;
    let data = pegout_marker_data(chain_id, side_txid)?;
    if data.len() > PARENT_DATA_LIMIT {
        return Err(Error::MarkerTooLong(data.len()));
    }
    Ok(vec![
        TxOut {
            value: Amount::from_sat(value),
            script_pubkey: script,
        },
        TxOut {
            value: Amount::ZERO,
            script_pubkey: op_return(&data)?,
        },
    ])
}

/// The producer's checkpoint on the parent (SPEC 11;
/// `siding/lib/checkpoint.mjs sendCheckpoint`): one `OP_RETURN` carrying
/// `ckpt:<chain id>:<height LE u32>:<32-byte hash>`, change back to the
/// wallet. Parses back with [`sidestr_core::marker::parse_checkpoint`].
pub fn checkpoint_output(chain_id: &str, height: u32, hash: &str) -> Result<TxOut> {
    Ok(TxOut {
        value: Amount::ZERO,
        script_pubkey: op_return(&checkpoint_data(chain_id, height, hash)?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sidestr_core::marker::{parse_checkpoint, parse_pegout_marker};
    use sidestr_core::parents::resolve_parent;

    #[test]
    fn networks_and_records() {
        assert_eq!(
            parent_network(resolve_parent("btc").unwrap()),
            Some(Network::Bitcoin)
        );
        assert_eq!(
            parent_network(resolve_parent("txbt4").unwrap()),
            Some(Network::Testnet4)
        );
        assert_eq!(btc_string(250_000), "0.00250000");
        assert_eq!(btc_string(123_456_789_012), "1234.56789012");
        let outs = pegout_payment_outputs(
            "sidestr:trial",
            &"c".repeat(64),
            &format!("5120{}", "e9".repeat(32)),
            12_345,
        )
        .unwrap();
        assert_eq!(
            parse_pegout_marker(&outs[1].script_pubkey, "sidestr:trial"),
            Some("c".repeat(64))
        );
        assert_eq!(outs[0].value.to_sat(), 12_345);
        let ck = checkpoint_output("sidestr:trial", 70_000, &"d".repeat(64)).unwrap();
        assert_eq!(
            parse_checkpoint(&ck.script_pubkey, "sidestr:trial"),
            Some((70_000, "d".repeat(64)))
        );
        assert!(pegout_payment_outputs("x", "zz", "5120", 1).is_err());
    }

    /// Audit F4 (2026-09-22): a parent record too long for the marker
    /// grammar (or the parent's relay policy) is an error, never a
    /// well-formed `OP_PUSHDATA2` output that `parse_pegout_marker` ignores.
    #[test]
    fn long_records_are_refused_not_emitted_unreadable() {
        let txid = "c".repeat(64);
        // 8 + 40 + 32 = 80: the largest record the parent relays
        let id = format!("sidestr:{}", "x".repeat(32));
        let outs = pegout_payment_outputs(&id, &txid, "5120", 1).unwrap();
        assert_eq!(
            sidestr_core::marker::op_return_data(&outs[1].script_pubkey).map(<[u8]>::len),
            Some(PARENT_DATA_LIMIT)
        );
        assert_eq!(
            parse_pegout_marker(&outs[1].script_pubkey, &id),
            Some(txid.clone())
        );
        // one byte over the parent's policy
        let over = format!("sidestr:{}", "x".repeat(33));
        assert!(matches!(
            pegout_payment_outputs(&over, &txid, "5120", 1),
            Err(Error::MarkerTooLong(81))
        ));
        // the auditor's reproduction: a 216-byte id made a 256-byte push
        let huge = "x".repeat(216);
        assert!(matches!(
            pegout_payment_outputs(&huge, &"a".repeat(64), "51", 10_000),
            Err(Error::MarkerTooLong(256))
        ));
        // the push bound itself, for any caller of the helper
        assert!(matches!(
            op_return(&[0u8; MARKER_DATA_LIMIT + 1]),
            Err(Error::MarkerTooLong(256))
        ));
        assert!(op_return(&[0u8; MARKER_DATA_LIMIT]).is_ok());
    }
}
