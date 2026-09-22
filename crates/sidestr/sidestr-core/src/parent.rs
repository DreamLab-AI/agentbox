//! The parent chain as a producer or a signer sees it (SPEC 6, 7, 11; the
//! level-2 view): peg-ins found in the parent's blocks, whether one is still
//! unspent and how deep, the peg wallet's payment of a burn, the producer's
//! checkpoint, and the reconciliation of burns against what the wallet has
//! already paid. A port of `siding/lib/parent.mjs` and
//! `siding/lib/checkpoint.mjs` (Melvin Carvalho, AGPL-3.0).
//!
//! The node is behind two traits — [`ParentRpc`] for the chain (read-only)
//! and [`PegWallet`] for the peg wallet's own RPCs — and everything that
//! decides is a pure function of what they return: [`find_pegin`] over a
//! decoded transaction, [`claimable`] over found peg-ins and the chain's
//! records, [`pegout_payment`] and [`checkpoint_payment`] as the outputs a
//! `send` call takes, [`reconcile`] over the chain's burns and the wallet's
//! history. One blocking JSON-RPC implementation, Bitcoin Core's, is behind
//! the `rpc` feature (`parent::rpc::CoreRpc`); a test doubles the traits in memory.
//!
//! Blocks come back as decoded transactions (`getblock` verbosity 2, each
//! transaction's `hex`), never as a raw block: a BLAKE2b parent's blocks have
//! 164-byte headers that the parent's serialisation library does not read,
//! and the transaction format is the same on every family.
//!
//! ```
//! use bitcoin::hashes::Hash;
//! use sidestr_core::marker::Burn;
//! use sidestr_core::parent::{checkpoint_payment, pegout_payment, reconcile, SendOutput};
//! use sidestr_core::parents::resolve_parent;
//!
//! // SPEC 7: the peg holders pay a burn on the parent — the value to the script the burn named,
//! // and `pegout:<chain id>:<sidechain txid>` so a validator with a parent view pairs the two
//! let burn = Burn { txid: "c".repeat(64), vout: 1, script: format!("5120{}", "e9".repeat(32)), value: 50_000, height: 133 };
//! let outs = pegout_payment("sidestr:trial", &burn, resolve_parent("tbtc4").unwrap()).unwrap();
//! assert!(matches!(&outs[0], SendOutput::Pay { address, btc } if address.starts_with("tb1p") && btc == "0.00050000"));
//! assert!(matches!(&outs[1], SendOutput::Data(d) if d.starts_with(b"pegout:sidestr:trial:")));
//!
//! // SPEC 11: a checkpoint is one data output; the wallet adds change
//! let ck = checkpoint_payment("sidestr:trial", 70_000, &bitcoin::BlockHash::all_zeros().to_string()).unwrap();
//! assert_eq!(ck.len(), 1);
//!
//! // reconciliation: a burn the wallet's history shows paid is paid, the rest are owed
//! let mut paid = std::collections::BTreeMap::new();
//! paid.insert("c".repeat(64), bitcoin::Txid::all_zeros());
//! let r = reconcile(&[burn.clone(), Burn { txid: "d".repeat(64), ..burn }], &paid);
//! assert_eq!((r.paid.len(), r.outstanding.len()), (1, 1));
//! ```

use std::collections::BTreeMap;

use bitcoin::{Address, BlockHash, Network, OutPoint, Script, ScriptBuf, Transaction, Txid};

use crate::error::{Error, Result};
use crate::marker::{
    checkpoint_data, parse_checkpoint, parse_peg_marker, parse_pegout_marker, pegout_marker_data,
    Burn,
};
use crate::parents::Parent;
use crate::state::ClaimRequest;

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

/// `sats` as Bitcoin Core writes an amount: `"0.00250000"`.
pub fn btc_string(sats: u64) -> String {
    format!("{}.{:08}", sats / 100_000_000, sats % 100_000_000)
}

/// A parent block as the view needs it: its height, hash, time and decoded
/// transactions (`getblock <hash> 2`, each `tx[i].hex`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParentBlock {
    /// The block's height.
    pub height: u32,
    /// Its hash.
    pub hash: BlockHash,
    /// Its header time.
    pub time: u32,
    /// Every transaction, coinbase first.
    pub txs: Vec<Transaction>,
}

/// What `gettxout` says of an unspent output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxOutStatus {
    /// Confirmations (0 in the mempool).
    pub confirmations: u32,
    /// Sats.
    pub value: u64,
    /// The output script.
    pub script_pubkey: ScriptBuf,
}

/// The parent chain, read-only (`parent.mjs makeParent().rpc`).
pub trait ParentRpc {
    /// `getblockcount`.
    fn block_count(&self) -> Result<u32>;
    /// `getblockhash`.
    fn block_hash(&self, height: u32) -> Result<BlockHash>;
    /// `getblock <hash> 2`, transactions decoded.
    fn block(&self, hash: &BlockHash) -> Result<ParentBlock>;
    /// `gettxout <txid> <vout> true`: `None` when spent or unknown.
    fn tx_out(&self, txid: &Txid, vout: u32) -> Result<Option<TxOutStatus>>;
    /// The block at a height.
    fn block_at(&self, height: u32) -> Result<ParentBlock> {
        self.block(&self.block_hash(height)?)
    }
}

/// One output of a Core `send`: `{address: btc}` or `{data: hex}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutput {
    /// Pay an address an amount, as Core writes it (`"0.00250000"`).
    Pay {
        /// The parent address.
        address: String,
        /// The amount, eight decimals.
        btc: String,
    },
    /// An `OP_RETURN` carrying these bytes.
    Data(Vec<u8>),
}

/// Where a wallet transaction sits (`gettransaction`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WalletTxStatus {
    /// Confirmations, 0 when unconfirmed.
    pub confirmations: u32,
    /// The parent block's height, when confirmed.
    pub block_height: Option<u32>,
    /// The parent block's hash, when confirmed.
    pub block_hash: Option<BlockHash>,
    /// The parent block's time, when confirmed.
    pub time: Option<u32>,
}

/// The peg wallet's own RPCs at `/wallet/<name>` (`parent.mjs
/// makeParent().walletRpc`). Without a wallet the parent is read-only.
pub trait PegWallet {
    /// `lockunspent`: keep (or release) these outputs out of the wallet's
    /// own payments; returns how many the node accepted.
    fn lock_outputs(&self, outpoints: &[OutPoint], lock: bool) -> Result<usize>;
    /// `send [outputs, null, "unset", 1]`: the wallet funds, signs and
    /// broadcasts; the txid comes back.
    fn send(&self, outputs: &[SendOutput]) -> Result<Txid>;
    /// Every transaction the wallet sent, decoded (`listtransactions` then
    /// `gettransaction … true true`).
    fn sent_transactions(&self) -> Result<Vec<(Txid, Transaction)>>;
    /// Where one of the wallet's transactions sits.
    fn transaction_status(&self, txid: &Txid) -> Result<WalletTxStatus>;
}

// --- peg-ins (SPEC 6) --------------------------------------------------------------

/// A peg-in found on the parent (`parent.mjs scanPegins`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundPegin {
    /// Parent txid, display order.
    pub txid: String,
    /// The peg output's index.
    pub vout: u32,
    /// Its value in sats.
    pub amount: u64,
    /// The sidechain script the marker named.
    pub script: ScriptBuf,
    /// The parent block's height.
    pub height: u32,
    /// The peg output's parent address, when the network is known.
    pub parent_address: Option<String>,
}

/// The peg-in a parent transaction makes for `chain_id`, if any: a marker
/// naming this chain gives the sidechain script, and the peg output is the
/// first taproot output (the marker is `OP_RETURN`, never taproot).
pub fn find_pegin(
    tx: &Transaction,
    chain_id: &str,
    height: u32,
    network: Option<Network>,
) -> Option<FoundPegin> {
    let script = tx
        .output
        .iter()
        .find_map(|o| parse_peg_marker(&o.script_pubkey, chain_id))?;
    let (vout, peg) = tx
        .output
        .iter()
        .enumerate()
        .find(|(_, o)| o.script_pubkey.is_p2tr())?;
    Some(FoundPegin {
        txid: tx.compute_txid().to_string(),
        vout: vout as u32,
        amount: peg.value.to_sat(),
        script,
        height,
        parent_address: network
            .and_then(|n| Address::from_script(&peg.script_pubkey, n).ok())
            .map(|a| a.to_string()),
    })
}

/// The outputs of `tx` paying `script`: `(vout, sats)`. What a wallet's
/// funding looks like from the chain's side.
pub fn find_payments(tx: &Transaction, script: &Script) -> Vec<(u32, u64)> {
    tx.output
        .iter()
        .enumerate()
        .filter(|(_, o)| o.script_pubkey.as_script() == script)
        .map(|(i, o)| (i as u32, o.value.to_sat()))
        .collect()
}

/// Peg-ins for `chain_id` in the parent's blocks `from..=to`
/// (`parent.mjs scanPegins`); `on_block` hears each height as it is read.
pub fn scan_pegins<R: ParentRpc + ?Sized>(
    rpc: &R,
    chain_id: &str,
    from: u32,
    to: u32,
    network: Option<Network>,
    mut on_block: impl FnMut(&ParentBlock),
) -> Result<Vec<FoundPegin>> {
    let mut found = Vec::new();
    for h in from..=to {
        let block = rpc.block_at(h)?;
        on_block(&block);
        found.extend(
            block
                .txs
                .iter()
                .filter_map(|tx| find_pegin(tx, chain_id, h, network)),
        );
    }
    Ok(found)
}

/// Still unspent on the parent, and how many confirmations
/// (`parent.mjs pegStatus`): `None` confirmations when spent or unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PegStatus {
    /// The output is unspent.
    pub unspent: bool,
    /// Its confirmations, when unspent.
    pub confirmations: Option<u32>,
}

/// [`PegStatus`] of an outpoint.
pub fn peg_status<R: ParentRpc + ?Sized>(rpc: &R, txid: &Txid, vout: u32) -> Result<PegStatus> {
    Ok(match rpc.tx_out(txid, vout)? {
        None => PegStatus {
            unspent: false,
            confirmations: None,
        },
        Some(o) => PegStatus {
            unspent: true,
            confirmations: Some(o.confirmations),
        },
    })
}

/// The peg-ins the producer may claim in its next block: found on the parent
/// at least `peg_confirmations` deep at `parent_tip`, and not yet claimed
/// (`siding/bin/siding.mjs produce`, the scan-and-claim loop; SPEC 6). The
/// confirmation count is `tip + 1 - height`, compared in `u64` so a parent
/// height or confirmation count at `u32::MAX` cannot overflow.
pub fn claimable(
    found: &[FoundPegin],
    parent_tip: u32,
    peg_confirmations: u32,
    claimed: impl Fn(&str, u32) -> bool,
) -> Vec<ClaimRequest> {
    found
        .iter()
        .filter(|p| u64::from(parent_tip) + 1 >= u64::from(p.height) + u64::from(peg_confirmations))
        .filter(|p| !claimed(&p.txid, p.vout))
        .map(|p| ClaimRequest {
            txid: p.txid.clone(),
            vout: p.vout,
            amount: p.amount,
            script: p.script.clone(),
        })
        .collect()
}

/// The outpoints the peg wallet must not spend: peg-ins found but not yet
/// claimed (`parent.mjs lockOutputs`: "a spent peg-in is refused as a
/// claim"). A claimed one is unlocked and joins the reserve.
pub fn outpoints_to_lock(
    found: &[FoundPegin],
    claimed: impl Fn(&str, u32) -> bool,
) -> Vec<OutPoint> {
    found
        .iter()
        .filter(|p| !claimed(&p.txid, p.vout))
        .filter_map(|p| {
            Some(OutPoint {
                txid: p.txid.parse().ok()?,
                vout: p.vout,
            })
        })
        .collect()
}

// --- peg-outs (SPEC 7): the parent side ------------------------------------------------

/// The peg wallet's payment of one burn (`parent.mjs payPegout`): the parent
/// script the burn named gets the burned value, and `OP_RETURN
/// pegout:<chain id>:<sidechain txid, 32 raw bytes>` rides along so a
/// validator with a parent view pairs each burn with its payment. The
/// address comes from the script for the parent's network (siding asks the
/// node with `decodescript`); a script with no address is refused.
pub fn pegout_payment(chain_id: &str, burn: &Burn, parent: &Parent) -> Result<Vec<SendOutput>> {
    let network = parent_network(parent).ok_or(Error::ReservedParent {
        alias: parent.alias,
        label: parent.label,
    })?;
    let script = ScriptBuf::from_hex(&burn.script).map_err(|e| Error::Encoding(e.to_string()))?;
    let address = Address::from_script(&script, network).map_err(|_| {
        Error::Parent(format!(
            "script {}… has no address on the parent",
            &burn.script[..burn.script.len().min(16)]
        ))
    })?;
    Ok(vec![
        SendOutput::Pay {
            address: address.to_string(),
            btc: btc_string(burn.value),
        },
        SendOutput::Data(pegout_marker_data(chain_id, &burn.txid)?),
    ])
}

/// Every burn the peg wallet has already paid, from the wallet's own
/// transactions (`parent.mjs paidPegouts`): sidechain txid → parent txid.
pub fn paid_pegouts_in(txs: &[(Txid, Transaction)], chain_id: &str) -> BTreeMap<String, Txid> {
    let mut paid = BTreeMap::new();
    for (parent_txid, tx) in txs {
        for o in &tx.output {
            if let Some(side) = parse_pegout_marker(&o.script_pubkey, chain_id) {
                paid.insert(side, *parent_txid);
            }
        }
    }
    paid
}

/// Burns paired with their parent payments, and burns still owed.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Reconciled {
    /// Burns the wallet's history shows paid, with the paying parent txid.
    pub paid: Vec<(Burn, Txid)>,
    /// Burns with no payment yet, oldest first.
    pub outstanding: Vec<Burn>,
}

/// Pair the chain's burns ([`crate::state::StateOf::pegouts`]) with the
/// payments the wallet has made ([`paid_pegouts_in`])
/// (`siding/bin/siding.mjs produce`, `reconcile`). Pure: what to do about
/// the outstanding ones — pay them, or hand them to a round — is the
/// caller's.
pub fn reconcile(burns: &[Burn], paid: &BTreeMap<String, Txid>) -> Reconciled {
    let mut r = Reconciled::default();
    for b in burns {
        match paid.get(&b.txid) {
            Some(t) => r.paid.push((b.clone(), *t)),
            None => r.outstanding.push(b.clone()),
        }
    }
    r.outstanding.sort_by_key(|b| b.height);
    r
}

// --- checkpoints (SPEC 11) ------------------------------------------------------------

/// The producer's checkpoint (`checkpoint.mjs sendCheckpoint`): one data
/// output, `ckpt:<chain id>:<height LE u32>:<32-byte hash>`; the wallet adds
/// change. Refused when the chain id makes it exceed 80 bytes.
pub fn checkpoint_payment(chain_id: &str, height: u32, hash: &str) -> Result<Vec<SendOutput>> {
    let data = checkpoint_data(chain_id, height, hash)?;
    if data.len() > PARENT_DATA_LIMIT {
        return Err(Error::Parent(format!(
            "checkpoint of {} bytes exceeds the 80-byte data limit; the chain id is too long",
            data.len()
        )));
    }
    Ok(vec![SendOutput::Data(data)])
}

/// The checkpoints the peg wallet has already sent, from its own
/// transactions (`checkpoint.mjs sentCheckpoints`): `(height, hash)` → parent txid.
pub fn sent_checkpoints_in(
    txs: &[(Txid, Transaction)],
    chain_id: &str,
) -> BTreeMap<(u32, String), Txid> {
    let mut out = BTreeMap::new();
    for (parent_txid, tx) in txs {
        for o in &tx.output {
            if let Some(c) = parse_checkpoint(&o.script_pubkey, chain_id) {
                out.insert(c, *parent_txid);
            }
        }
    }
    out
}

/// Bitcoin Core's JSON-RPC over HTTP, blocking, cookie-authenticated
/// (feature `rpc`).
#[cfg(feature = "rpc")]
pub mod rpc {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use bitcoin::consensus::encode::deserialize;
    use bitcoin::{BlockHash, OutPoint, ScriptBuf, Transaction, Txid};
    use serde_json::{json, Value};

    use super::{ParentBlock, ParentRpc, PegWallet, SendOutput, TxOutStatus, WalletTxStatus};
    use crate::error::{Error, Result};

    /// A node's JSON-RPC endpoint with its cookie file (`parent.mjs
    /// makeParent`). The cookie is minted anew every time the node starts, so
    /// it is read again on a 401 rather than dying with it — a node upgrade on
    /// 21 September left every producer sending a stale cookie until
    /// restarted. With a `wallet`, the wallet's RPCs go to `/wallet/<name>`;
    /// without one the parent is read-only.
    #[derive(Debug)]
    pub struct CoreRpc {
        url: String,
        cookie_file: PathBuf,
        wallet: Option<String>,
        auth: Mutex<Option<String>>,
        agent: ureq::Agent,
    }

    fn base64(bytes: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    impl CoreRpc {
        /// A client for `url` (e.g. `http://127.0.0.1:48332/`) reading
        /// `user:password` from `cookie_file`, optionally for `wallet`.
        pub fn new(url: &str, cookie_file: impl Into<PathBuf>, wallet: Option<&str>) -> Self {
            Self {
                url: url.trim_end_matches('/').to_string(),
                cookie_file: cookie_file.into(),
                wallet: wallet.map(str::to_string),
                auth: Mutex::new(None),
                agent: ureq::Agent::new_with_config(
                    ureq::Agent::config_builder()
                        .http_status_as_error(false)
                        .build(),
                ),
            }
        }

        /// The wallet the wallet RPCs address, if any.
        pub fn wallet(&self) -> Option<&str> {
            self.wallet.as_deref()
        }

        fn read_auth(&self) -> Result<String> {
            let cookie = std::fs::read_to_string(&self.cookie_file)?;
            Ok(format!("Basic {}", base64(cookie.trim().as_bytes())))
        }

        fn auth(&self, refresh: bool) -> Result<String> {
            let mut a = self
                .auth
                .lock()
                .map_err(|_| Error::Parent("auth lock".into()))?;
            if refresh || a.is_none() {
                *a = Some(self.read_auth()?);
            }
            Ok(a.clone().expect("set above"))
        }

        fn post(
            &self,
            endpoint: &str,
            method: &str,
            params: Value,
            refreshed: bool,
        ) -> Result<Value> {
            let body =
                json!({ "jsonrpc": "1.0", "id": "sidestr", "method": method, "params": params });
            let mut r = self
                .agent
                .post(endpoint)
                .header("authorization", &self.auth(refreshed)?)
                .content_type("text/plain")
                .send(body.to_string().as_bytes())
                .map_err(|e| Error::Parent(format!("{method}: {e}")))?;
            if r.status() == 401 {
                if !refreshed {
                    return self.post(endpoint, method, params, true);
                }
                return Err(Error::Parent(format!(
                    "{method}: the node refused the cookie at {}",
                    self.cookie_file.display()
                )));
            }
            let text = r
                .body_mut()
                .read_to_string()
                .map_err(|e| Error::Parent(format!("{method}: {e}")))?;
            let v: Value = serde_json::from_str(&text)
                .map_err(|e| Error::Parent(format!("{method}: not JSON-RPC: {e}")))?;
            if let Some(e) = v.get("error").filter(|e| !e.is_null()) {
                return Err(Error::Parent(format!(
                    "{method}: {}",
                    e.get("message").and_then(Value::as_str).unwrap_or("error")
                )));
            }
            Ok(v.get("result").cloned().unwrap_or(Value::Null))
        }

        /// A raw call on the node.
        pub fn call(&self, method: &str, params: Value) -> Result<Value> {
            self.post(&self.url, method, params, false)
        }

        /// A raw call on the wallet endpoint.
        pub fn wallet_call(&self, method: &str, params: Value) -> Result<Value> {
            let wallet = self
                .wallet
                .as_deref()
                .ok_or_else(|| Error::Parent("no peg wallet: no wallet name was given".into()))?;
            let endpoint = format!("{}/wallet/{}", self.url, urlencode(wallet));
            self.post(&endpoint, method, params, false)
        }
    }

    fn urlencode(s: &str) -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    fn str_of<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
        v.get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Parent(format!("reply lacks {key}")))
    }

    fn u32_of(v: &Value, key: &str) -> Result<u32> {
        v.get(key)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| Error::Parent(format!("reply lacks {key}")))
    }

    /// Core prints amounts in BTC as a JSON number; sats are the nearest
    /// integer of `value × 10⁸`, as siding reads them (`Math.round(o.value * 1e8)`).
    fn sats_of(v: &Value) -> Result<u64> {
        let f = v
            .as_f64()
            .ok_or_else(|| Error::Parent(format!("amount {v}")))?;
        if !(0.0..=21_000_000.0).contains(&f) {
            return Err(Error::Parent(format!("amount {v}")));
        }
        Ok((f * 100_000_000.0).round() as u64)
    }

    fn tx_of(v: &Value) -> Result<Transaction> {
        let hex = str_of(v, "hex")?;
        deserialize(&hex::decode(hex).map_err(|e| Error::Encoding(e.to_string()))?)
            .map_err(|e| Error::Encoding(e.to_string()))
    }

    impl ParentRpc for CoreRpc {
        fn block_count(&self) -> Result<u32> {
            let v = self.call("getblockcount", json!([]))?;
            v.as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| Error::Parent("getblockcount: not a height".into()))
        }
        fn block_hash(&self, height: u32) -> Result<BlockHash> {
            let v = self.call("getblockhash", json!([height]))?;
            v.as_str()
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| Error::Parent("getblockhash: not a hash".into()))
        }
        fn block(&self, hash: &BlockHash) -> Result<ParentBlock> {
            let v = self.call("getblock", json!([hash.to_string(), 2]))?;
            let txs = v
                .get("tx")
                .and_then(Value::as_array)
                .ok_or_else(|| Error::Parent("getblock: no tx array".into()))?
                .iter()
                .map(tx_of)
                .collect::<Result<Vec<_>>>()?;
            Ok(ParentBlock {
                height: u32_of(&v, "height")?,
                hash: str_of(&v, "hash")?
                    .parse()
                    .map_err(|_| Error::Parent("getblock: bad hash".into()))?,
                time: u32_of(&v, "time")?,
                txs,
            })
        }
        fn tx_out(&self, txid: &Txid, vout: u32) -> Result<Option<TxOutStatus>> {
            let v = self.call("gettxout", json!([txid.to_string(), vout, true]))?;
            if v.is_null() {
                return Ok(None);
            }
            let spk = v
                .get("scriptPubKey")
                .and_then(|s| s.get("hex"))
                .and_then(Value::as_str)
                .ok_or_else(|| Error::Parent("gettxout: no scriptPubKey".into()))?;
            Ok(Some(TxOutStatus {
                confirmations: u32_of(&v, "confirmations")?,
                value: sats_of(v.get("value").unwrap_or(&Value::Null))?,
                script_pubkey: ScriptBuf::from_hex(spk)
                    .map_err(|e| Error::Encoding(e.to_string()))?,
            }))
        }
    }

    impl PegWallet for CoreRpc {
        fn lock_outputs(&self, outpoints: &[OutPoint], lock: bool) -> Result<usize> {
            let mut n = 0;
            for o in outpoints {
                let r = self.wallet_call(
                    "lockunspent",
                    json!([!lock, [{ "txid": o.txid.to_string(), "vout": o.vout }]]),
                );
                if r.is_ok() {
                    n += 1;
                }
            }
            Ok(n)
        }
        fn send(&self, outputs: &[SendOutput]) -> Result<Txid> {
            let outs: Vec<Value> = outputs
                .iter()
                .map(|o| match o {
                    SendOutput::Pay { address, btc } => json!({ address: btc }),
                    SendOutput::Data(d) => json!({ "data": hex::encode(d) }),
                })
                .collect();
            let r = self.wallet_call("send", json!([outs, Value::Null, "unset", 1]))?;
            if r.get("complete").and_then(Value::as_bool) != Some(true) {
                return Err(Error::Parent(format!("send did not complete: {r}")));
            }
            str_of(&r, "txid")?
                .parse()
                .map_err(|_| Error::Parent("send: bad txid".into()))
        }
        fn sent_transactions(&self) -> Result<Vec<(Txid, Transaction)>> {
            let list = self.wallet_call("listtransactions", json!(["*", 10000, 0, true]))?;
            let mut seen = std::collections::BTreeSet::new();
            let mut out = Vec::new();
            for t in list.as_array().into_iter().flatten() {
                if t.get("category").and_then(Value::as_str) != Some("send") {
                    continue;
                }
                let Ok(txid) = str_of(t, "txid")?.parse::<Txid>() else {
                    continue;
                };
                if !seen.insert(txid) {
                    continue;
                }
                let g =
                    self.wallet_call("gettransaction", json!([txid.to_string(), true, true]))?;
                out.push((txid, tx_of(&g)?));
            }
            Ok(out)
        }
        fn transaction_status(&self, txid: &Txid) -> Result<WalletTxStatus> {
            let g = self.wallet_call("gettransaction", json!([txid.to_string()]))?;
            Ok(WalletTxStatus {
                confirmations: g
                    .get("confirmations")
                    .and_then(Value::as_i64)
                    .map(|c| u32::try_from(c.max(0)).unwrap_or(0))
                    .unwrap_or(0),
                block_height: g
                    .get("blockheight")
                    .and_then(Value::as_u64)
                    .and_then(|n| u32::try_from(n).ok()),
                block_hash: g
                    .get("blockhash")
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse().ok()),
                time: g
                    .get("blocktime")
                    .and_then(Value::as_u64)
                    .and_then(|n| u32::try_from(n).ok()),
            })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn base64_and_amounts() {
            assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
            assert_eq!(base64(b"ab"), "YWI=");
            assert_eq!(base64(b"a"), "YQ==");
            assert_eq!(sats_of(&json!(0.001)).unwrap(), 100_000);
            assert_eq!(sats_of(&json!(1)).unwrap(), 100_000_000);
            assert_eq!(sats_of(&json!(0.00000001)).unwrap(), 1);
            assert_eq!(sats_of(&json!(0.1)).unwrap(), 10_000_000);
            assert_eq!(
                sats_of(&json!(20999999.99999999)).unwrap(),
                2_099_999_999_999_999
            );
            assert!(sats_of(&json!(-1)).is_err());
            assert!(sats_of(&json!("1")).is_err());
            assert_eq!(urlencode("sidestr-peg"), "sidestr-peg");
            assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::marker::peg_marker_data;
    use crate::parents::resolve_parent;
    use bitcoin::hashes::Hash;
    use bitcoin::script::PushBytesBuf;
    use bitcoin::transaction::Version;
    use bitcoin::{absolute::LockTime, Amount, TxOut};

    fn tx(outputs: Vec<TxOut>) -> Transaction {
        Transaction {
            version: Version::TWO,
            lock_time: LockTime::ZERO,
            input: vec![],
            output: outputs,
        }
    }
    fn out(value: u64, spk: ScriptBuf) -> TxOut {
        TxOut {
            value: Amount::from_sat(value),
            script_pubkey: spk,
        }
    }
    fn data(d: &[u8]) -> ScriptBuf {
        ScriptBuf::new_op_return(PushBytesBuf::try_from(d.to_vec()).unwrap())
    }
    fn p2tr(byte: u8) -> ScriptBuf {
        ScriptBuf::from_hex(&format!("5120{}", format!("{byte:02x}").repeat(32))).unwrap()
    }

    struct Mock {
        blocks: Vec<ParentBlock>,
        unspent: BTreeMap<(Txid, u32), TxOutStatus>,
    }
    impl ParentRpc for Mock {
        fn block_count(&self) -> Result<u32> {
            Ok(self.blocks.last().map(|b| b.height).unwrap_or(0))
        }
        fn block_hash(&self, height: u32) -> Result<BlockHash> {
            self.blocks
                .iter()
                .find(|b| b.height == height)
                .map(|b| b.hash)
                .ok_or_else(|| Error::Parent("no block".into()))
        }
        fn block(&self, hash: &BlockHash) -> Result<ParentBlock> {
            self.blocks
                .iter()
                .find(|b| b.hash == *hash)
                .cloned()
                .ok_or_else(|| Error::Parent("no block".into()))
        }
        fn tx_out(&self, txid: &Txid, vout: u32) -> Result<Option<TxOutStatus>> {
            Ok(self.unspent.get(&(*txid, vout)).cloned())
        }
    }

    #[test]
    fn pegins_are_found_claimed_and_locked() {
        let me = p2tr(0xab);
        let peg = tx(vec![
            out(250_000, p2tr(0x7e)),
            out(0, data(&peg_marker_data("sidestr:trial", &me))),
        ]);
        let other_chain = tx(vec![
            out(1, p2tr(0x7e)),
            out(0, data(&peg_marker_data("sidestr:other", &me))),
        ]);
        let no_taproot = tx(vec![out(0, data(&peg_marker_data("sidestr:trial", &me)))]);
        let f = find_pegin(&peg, "sidestr:trial", 100, Some(Network::Testnet4)).unwrap();
        assert_eq!(
            (f.vout, f.amount, &f.script, f.height),
            (0, 250_000, &me, 100)
        );
        assert!(f.parent_address.as_deref().unwrap().starts_with("tb1p"));
        assert!(find_pegin(&other_chain, "sidestr:trial", 100, None).is_none());
        assert!(find_pegin(&no_taproot, "sidestr:trial", 100, None).is_none());
        assert_eq!(find_payments(&peg, &p2tr(0x7e)), vec![(0, 250_000)]);
        assert!(find_payments(&peg, &me).is_empty());

        let mk = |h: u32, txs: Vec<Transaction>| ParentBlock {
            height: h,
            hash: BlockHash::from_byte_array([h as u8; 32]),
            time: 1_790_000_000 + h,
            txs,
        };
        let mock = Mock {
            blocks: vec![
                mk(10, vec![other_chain]),
                mk(11, vec![peg.clone()]),
                mk(12, vec![]),
            ],
            unspent: [(
                (peg.compute_txid(), 0),
                TxOutStatus {
                    confirmations: 2,
                    value: 250_000,
                    script_pubkey: p2tr(0x7e),
                },
            )]
            .into_iter()
            .collect(),
        };
        let mut seen = vec![];
        let found = scan_pegins(&mock, "sidestr:trial", 10, 12, None, |b| {
            seen.push(b.height)
        })
        .unwrap();
        assert_eq!(seen, vec![10, 11, 12]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].txid, peg.compute_txid().to_string());
        assert_eq!(
            peg_status(&mock, &peg.compute_txid(), 0).unwrap(),
            PegStatus {
                unspent: true,
                confirmations: Some(2)
            }
        );
        assert_eq!(
            peg_status(&mock, &peg.compute_txid(), 1).unwrap(),
            PegStatus {
                unspent: false,
                confirmations: None
            }
        );
        // SPEC 6: claimable at pegConfirmations, and only once
        assert!(claimable(&found, 15, 6, |_, _| false).is_empty());
        let c = claimable(&found, 16, 6, |_, _| false);
        assert_eq!((c.len(), c[0].amount, &c[0].script), (1, 250_000, &me));
        assert!(claimable(&found, 16, 6, |_, _| true).is_empty());
        assert_eq!(outpoints_to_lock(&found, |_, _| false).len(), 1);
        assert!(outpoints_to_lock(&found, |_, _| true).is_empty());
        assert!(scan_pegins(&mock, "sidestr:trial", 10, 13, None, |_| {}).is_err());
    }

    #[test]
    fn payments_checkpoints_and_reconciliation() {
        let tbtc4 = resolve_parent("tbtc4").unwrap();
        let burn = Burn {
            txid: "c".repeat(64),
            vout: 1,
            script: format!("5120{}", "e9".repeat(32)),
            value: 50_000,
            height: 133,
        };
        let outs = pegout_payment("sidestr:trial", &burn, tbtc4).unwrap();
        let SendOutput::Pay { address, btc } = &outs[0] else {
            panic!()
        };
        assert!(address.starts_with("tb1p") && btc == "0.00050000");
        let SendOutput::Data(d) = &outs[1] else {
            panic!()
        };
        assert_eq!(
            parse_pegout_marker(&data(d), "sidestr:trial"),
            Some("c".repeat(64))
        );
        // a bare OP_RETURN is not an address
        let no_addr = Burn {
            script: "6a00".into(),
            ..burn.clone()
        };
        assert!(pegout_payment("sidestr:trial", &no_addr, tbtc4).is_err());
        assert!(
            pegout_payment("sidestr:trial", &burn, resolve_parent("btc").unwrap())
                .unwrap()
                .iter()
                .any(
                    |o| matches!(o, SendOutput::Pay { address, .. } if address.starts_with("bc1p"))
                )
        );
        let ck = checkpoint_payment("sidestr:trial", 70_000, &"d".repeat(64)).unwrap();
        let SendOutput::Data(d) = &ck[0] else {
            panic!()
        };
        assert_eq!(
            parse_checkpoint(&data(d), "sidestr:trial"),
            Some((70_000, "d".repeat(64)))
        );
        assert!(checkpoint_payment(&"x".repeat(60), 1, &"d".repeat(64)).is_err());
        // the wallet's history read back
        let paid_tx = tx(vec![
            out(50_000, p2tr(0xe9)),
            out(0, data(&outs_data(&outs))),
        ]);
        let ck_tx = tx(vec![out(0, data(d))]);
        let history = vec![
            (Txid::from_byte_array([1u8; 32]), paid_tx),
            (Txid::from_byte_array([2u8; 32]), ck_tx),
        ];
        let paid = paid_pegouts_in(&history, "sidestr:trial");
        assert_eq!(
            paid.get(&"c".repeat(64)),
            Some(&Txid::from_byte_array([1u8; 32]))
        );
        assert!(paid_pegouts_in(&history, "sidestr:other").is_empty());
        let sent = sent_checkpoints_in(&history, "sidestr:trial");
        assert_eq!(
            sent.get(&(70_000, "d".repeat(64))),
            Some(&Txid::from_byte_array([2u8; 32]))
        );
        let owed = Burn {
            txid: "e".repeat(64),
            height: 200,
            ..burn.clone()
        };
        let older = Burn {
            txid: "f".repeat(64),
            height: 150,
            ..burn.clone()
        };
        let r = reconcile(&[owed.clone(), burn.clone(), older.clone()], &paid);
        assert_eq!(r.paid, vec![(burn, Txid::from_byte_array([1u8; 32]))]);
        assert_eq!(r.outstanding, vec![older, owed]);
        assert_eq!(btc_string(100_000), "0.00100000");
        assert_eq!(parent_network(tbtc4), Some(Network::Testnet4));
        assert_eq!(
            parent_network(resolve_parent("xbt").unwrap()),
            Some(Network::Bitcoin)
        );
    }

    fn outs_data(outs: &[SendOutput]) -> Vec<u8> {
        outs.iter()
            .find_map(|o| match o {
                SendOutput::Data(d) => Some(d.clone()),
                _ => None,
            })
            .unwrap()
    }
}
