//! One signer of a federated chain, running (feature `bin`): the chain on
//! disk, the block round and the peg-out round driven every second, relays
//! followed and published to, the parent polled when there is one, and
//! what a mirror needs served over HTTP. `bin/siding.mjs produce` on a
//! level-2 document, in Rust, minus what is not level 2's (the desk, the
//! EVM rule, checkpoints).
//!
//! Everything that owns state runs on one thread — `sidestr-core`'s state
//! is not `Send` — so the HTTP server asks the loop over a channel, and
//! only the relay sockets are separate tasks.

use std::path::{Path, PathBuf};
use std::time::Duration;

use bitcoin::{OutPoint, Txid};
use serde::{Deserialize, Serialize};
use sidestr_core::block::{HeaderFamily, SidestrBlock};
use sidestr_core::chain::ChainOf;
use sidestr_core::document::ChainDocument;
use sidestr_core::marker::{parse_claims, parse_peg_marker};
use sidestr_core::parent::rpc::CoreRpc;
use sidestr_core::parent::{
    claimable, outpoints_to_lock, paid_pegouts_in, parent_network, scan_pegins, FoundPegin,
    ParentRpc, PegWallet,
};
use sidestr_nostr::event::Event;
use sidestr_nostr::kinds::{
    KIND_BLOCK_PROPOSAL, KIND_PARTIAL_SIGNATURE, KIND_PEGOUT_PSBT, KIND_PEGOUT_SIGNED,
    KIND_SEALED_BLOCK, KIND_TRANSACTION,
};
use sidestr_nostr::relay::Follower;
use sidestr_nostr::tip::{sign_tip, TipTemplate, TIP_HEADERS};
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result};
use crate::journal::{FileJournal, VoteJournal};
use crate::pegout::{
    burn_key, PaidPegout, PegCoin, PegoutAction, PegoutConfig, PegoutLedger, PegoutRound,
};
use crate::relay::{follow, ok_count, publish_all, unix_now};
use crate::round::{Action, ClaimChecker, Round, RoundConfig};
use crate::signer::LocalKey;

/// How a signer is run.
#[derive(Debug, Clone)]
pub struct Settings {
    /// The chain document.
    pub chain: PathBuf,
    /// The block file directory; `pegins.json`, `pegouts.json` and the
    /// journal live beside it.
    pub dir: PathBuf,
    /// The key file (32-byte hex). Never a command-line value.
    pub key_file: PathBuf,
    /// The HTTP port on 127.0.0.1.
    pub port: u16,
    /// Seconds between blocks when the mempool is empty.
    pub interval: u64,
    /// Seconds between blocks when it is not.
    pub tx_interval: u64,
    /// The round's options.
    pub round: RoundConfig,
    /// The peg-out round's options (network filled from the document).
    pub pegout: PegoutConfig,
    /// Relays to follow and publish to.
    pub relays: Vec<String>,
    /// Mirrors to name in the tip announcement; none means no announcement.
    pub mirrors: Vec<String>,
    /// The parent node's JSON-RPC, cookie file and peg wallet.
    pub parent: Option<ParentSettings>,
    /// The vote journal; default `<dir>/votes.jsonl`.
    pub journal: Option<PathBuf>,
}

/// A parent view.
#[derive(Debug, Clone)]
pub struct ParentSettings {
    /// `http://127.0.0.1:48332/`.
    pub url: String,
    /// The node's cookie file.
    pub cookie: PathBuf,
    /// The peg wallet's name, if peg-outs are to be paid from here.
    pub wallet: Option<String>,
    /// Seconds between polls.
    pub poll: u64,
    /// The first parent height to scan for peg-ins.
    pub from: u32,
}

/// `pegins.json`: the scan position and what was found (`bin/siding.mjs pegState`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PeginState {
    scanned: i64,
    pegins: Vec<PeginRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeginRecord {
    txid: String,
    vout: u32,
    amount: u64,
    script: String,
    height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_address: Option<String>,
}

impl From<&FoundPegin> for PeginRecord {
    fn from(p: &FoundPegin) -> Self {
        Self {
            txid: p.txid.clone(),
            vout: p.vout,
            amount: p.amount,
            script: p.script.to_hex_string(),
            height: p.height,
            parent_address: p.parent_address.clone(),
        }
    }
}

impl PeginRecord {
    fn found(&self) -> FoundPegin {
        FoundPegin {
            txid: self.txid.clone(),
            vout: self.vout,
            amount: self.amount,
            script: bitcoin::ScriptBuf::from_bytes(hex::decode(&self.script).unwrap_or_default()),
            height: self.height,
            parent_address: self.parent_address.clone(),
        }
    }
}

/// `bin/siding.mjs checkClaims`: every claim in a proposal is a confirmed,
/// unspent peg-in on the parent paying the peg, whose marker names the
/// script the claim pays.
struct ParentClaims {
    rpc: std::rc::Rc<CoreRpc>,
    chain_id: String,
    need: u32,
    challenge: bitcoin::ScriptBuf,
}

impl<F: HeaderFamily> ClaimChecker<F> for ParentClaims {
    fn check(&self, block: &F::Block) -> Option<String> {
        let coinbase = block.txdata().first()?;
        let (claims, errors) = parse_claims(coinbase);
        if let Some(e) = errors.first() {
            return Some(e.clone());
        }
        for c in claims {
            let short = &c.txid[..c.txid.len().min(12)];
            let txid: Txid = c.txid.parse().ok()?;
            let o = match self.rpc.tx_out(&txid, c.vout) {
                Ok(Some(o)) => o,
                Ok(None) => {
                    return Some(format!("{short}…:{} is not unspent on the parent", c.vout))
                }
                Err(e) => return Some(e.to_string()),
            };
            if o.confirmations < self.need {
                return Some(format!(
                    "{short}… has {} of {} confirmations",
                    o.confirmations, self.need
                ));
            }
            if o.value != c.payout.value || o.script_pubkey != self.challenge {
                return Some(format!(
                    "{short}… does not pay the peg {} sats",
                    c.payout.value
                ));
            }
            let raw = match self
                .rpc
                .call("getrawtransaction", serde_json::json!([c.txid, true]))
            {
                Ok(v) => v,
                Err(e) => return Some(e.to_string()),
            };
            let marker = raw["vout"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["scriptPubKey"]["hex"].as_str())
                .filter_map(|h| hex::decode(h).ok())
                .find_map(|b| parse_peg_marker(bitcoin::Script::from_bytes(&b), &self.chain_id));
            if marker.as_deref() != Some(c.payout.script_pubkey.as_script()) {
                return Some(format!(
                    "{short}…'s marker names {}…, the claim pays {}…",
                    marker
                        .map(|m| m.to_hex_string())
                        .unwrap_or_else(|| "nothing".into())
                        .chars()
                        .take(12)
                        .collect::<String>(),
                    &c.payout.script_pubkey.to_hex_string()[..12]
                ));
            }
        }
        None
    }
}

/// What the HTTP thread asks the loop.
enum Query {
    Status(oneshot::Sender<serde_json::Value>),
    Tip(oneshot::Sender<serde_json::Value>),
    Chain(oneshot::Sender<serde_json::Value>),
    Blocks(oneshot::Sender<serde_json::Value>),
    Pegouts(oneshot::Sender<serde_json::Value>),
    Coins(String, oneshot::Sender<serde_json::Value>),
    Tx(
        String,
        oneshot::Sender<core::result::Result<serde_json::Value, String>>,
    ),
}

fn log(s: impl AsRef<str>) {
    let now = unix_now();
    let (h, m, sec) = ((now / 3600) % 24, (now / 60) % 60, now % 60);
    println!("{h:02}:{m:02}:{sec:02} {}", s.as_ref());
}

fn read_json<T: for<'a> Deserialize<'a> + Default>(path: &Path) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, v: &T) {
    if let Ok(text) = serde_json::to_string_pretty(v) {
        if let Err(e) = std::fs::write(path, text) {
            log(format!("{}: {e}", path.display()));
        }
    }
}

/// The signer's state, on the loop's thread.
struct Node<F: HeaderFamily> {
    doc: ChainDocument,
    chain: ChainOf<F>,
    round: Round<F>,
    pegout: Option<PegoutRound>,
    parent: Option<std::rc::Rc<CoreRpc>>,
    pegins: PeginState,
    settings: Settings,
    txs: Follower,
    key: LocalKey,
    last_block: u64,
    announced: Option<u32>,
    announce_retry_at: u64,
    started: u64,
}

impl<F: HeaderFamily> Node<F> {
    fn status(&self) -> serde_json::Value {
        let s = self.chain.state();
        let tip = s.tip();
        let fed = self.round.federation();
        serde_json::json!({
            "chain": self.doc.id, "parent": self.doc.parent,
            "height": tip.height, "hash": tip.hash.to_string(), "time": tip.time,
            "coins": s.utxo().len(), "mempool": s.mempool().count(), "minFeeRate": s.min_fee_rate(),
            "relays": self.settings.relays,
            "announce": if self.settings.mirrors.is_empty() { serde_json::Value::Null } else { serde_json::json!({"mirrors": self.settings.mirrors, "announced": self.announced.map(i64::from).unwrap_or(-1)}) },
            "pegouts": {"burned": s.pegouts().len(), "paid": self.pegout.as_ref().map(|p| p.ledger().paid.len()).unwrap_or(0), "min": s.pegout_min(), "payer": self.settings.parent.as_ref().and_then(|p| p.wallet.clone())},
            "pegins": self.parent.as_ref().map(|_| serde_json::json!({"scanned": self.pegins.scanned, "known": self.pegins.pegins.len(), "claimed": self.pegins.pegins.iter().filter(|p| s.claimed(&p.txid, p.vout)).count()})),
            "signer": self.key.pubkey_hex(), "genesis": s.genesis_hash().to_string(), "interval": self.settings.interval,
            "level2": {"signers": fed.signers.len(), "threshold": fed.threshold, "slot": self.round.slot() + 1,
                        "proposeAfter": self.settings.round.propose_after, "resignAfter": self.settings.round.resign_after,
                        "pending": self.round.pending().map(|p| serde_json::json!({"height": p.height, "signatures": p.sigs.len(), "at": p.at})),
                        "journal": self.settings.journal.as_ref().map(|j| j.display().to_string())},
            "engine": "sidestr-round", "started": self.started,
        })
    }

    fn tip_json(&self) -> serde_json::Value {
        let t = self.chain.state().tip();
        serde_json::json!({"height": t.height, "hash": t.hash.to_string(), "time": t.time})
    }

    fn answer(&mut self, q: Query) {
        match q {
            Query::Status(r) => {
                let _ = r.send(self.status());
            }
            Query::Tip(r) => {
                let _ = r.send(self.tip_json());
            }
            Query::Chain(r) => {
                let mut d = self.doc.clone();
                d.genesis_hash = Some(self.chain.state().genesis_hash().to_string());
                let _ = r.send(serde_json::to_value(&d).unwrap_or_default());
            }
            Query::Blocks(r) => {
                let _ = r.send(serde_json::to_value(self.chain.index()).unwrap_or_default());
            }
            Query::Pegouts(r) => {
                let _ = r.send(
                    self.pegout
                        .as_ref()
                        .map(|p| serde_json::to_value(p.ledger()).unwrap_or_default())
                        .unwrap_or_else(|| serde_json::json!({"paid": {}})),
                );
            }
            Query::Coins(hex_spk, r) => {
                let list: Vec<serde_json::Value> = hex::decode(&hex_spk)
                    .map(|b| self.chain.state().coins(bitcoin::Script::from_bytes(&b)))
                    .unwrap_or_default()
                    .into_iter()
                    .map(|c| serde_json::json!({"outpoint": format!("{}:{}", c.outpoint.txid, c.outpoint.vout), "value": c.value, "height": c.height, "coinbase": c.coinbase}))
                    .collect();
                let _ = r.send(serde_json::Value::Array(list));
            }
            Query::Tx(hex_tx, r) => {
                let res = hex::decode(hex_tx.trim())
                    .map_err(|e| e.to_string())
                    .and_then(|b| self.chain.submit(&b).map_err(|e| e.to_string()))
                    .map(|s| {
                        log(format!("tx {}… accepted, fee {}", &s.txid.to_string()[..16], s.fee));
                        serde_json::json!({"txid": s.txid.to_string(), "fee": s.fee, "vsize": s.vsize, "dup": s.dup})
                    });
                let _ = r.send(res);
            }
        }
    }

    fn headers_hex(&self) -> Vec<String> {
        let s = self.chain.state();
        let tip = s.height();
        let from = tip.saturating_sub(TIP_HEADERS as u32 - 1);
        (from..=tip)
            .filter_map(|h| s.header_at(h))
            .map(|h| hex::encode(s.family().encode_header(h)))
            .collect()
    }

    fn peg_coins(&self) -> Vec<PegCoin> {
        let (Some(rpc), Some(p)) = (&self.parent, &self.settings.parent) else {
            return vec![];
        };
        if p.wallet.is_none() {
            return vec![];
        }
        let challenge = self.chain.state().challenge().to_hex_string();
        match rpc.wallet_call("listunspent", serde_json::json!([1, 9_999_999, [], true])) {
            Ok(v) => v
                .as_array()
                .into_iter()
                .flatten()
                .filter(|u| u["scriptPubKey"].as_str() == Some(challenge.as_str()))
                .filter_map(|u| {
                    Some(PegCoin {
                        outpoint: OutPoint {
                            txid: u["txid"].as_str()?.parse().ok()?,
                            vout: u32::try_from(u["vout"].as_u64()?).ok()?,
                        },
                        value: (u["amount"].as_f64()? * 1e8).round() as u64,
                    })
                })
                .collect(),
            Err(e) => {
                log(format!("peg-out round: listunspent: {e}"));
                vec![]
            }
        }
    }

    /// `bin/siding.mjs pegTick`: scan new parent blocks for peg-ins, hand
    /// the claimable ones to the round, keep them out of the wallet's own
    /// payments until claimed.
    fn peg_tick(&mut self) {
        let Some(rpc) = self.parent.clone() else {
            return;
        };
        let network = self.doc.parent().ok().and_then(parent_network);
        let tip = match rpc.block_count() {
            Ok(t) => t,
            Err(e) => {
                log(format!("parent: {e}"));
                return;
            }
        };
        if i64::from(tip) > self.pegins.scanned {
            let from = u32::try_from(self.pegins.scanned + 1).unwrap_or(0);
            match scan_pegins(rpc.as_ref(), &self.doc.id, from, tip, network, |_| {}) {
                Ok(found) => {
                    for p in &found {
                        if !self
                            .pegins
                            .pegins
                            .iter()
                            .any(|q| q.txid == p.txid && q.vout == p.vout)
                        {
                            log(format!(
                                "peg-in {}…:{}: {} sats to {}…, parent h{}",
                                &p.txid[..16],
                                p.vout,
                                p.amount,
                                &p.script.to_hex_string()[..12],
                                p.height
                            ));
                            self.pegins.pegins.push(p.into());
                        }
                    }
                    self.pegins.scanned = i64::from(tip);
                    write_json(&self.settings.dir.join("pegins.json"), &self.pegins);
                }
                Err(e) => log(format!("peg-in scan: {e}")),
            }
        }
        let found: Vec<FoundPegin> = self.pegins.pegins.iter().map(PeginRecord::found).collect();
        let s = self.chain.state();
        let claims = claimable(&found, tip, self.doc.peg_confirmations, |t, v| {
            s.claimed(t, v)
        });
        if self
            .settings
            .parent
            .as_ref()
            .is_some_and(|p| p.wallet.is_some())
        {
            let lock = outpoints_to_lock(&found, |t, v| s.claimed(t, v));
            let unlock: Vec<OutPoint> = found
                .iter()
                .filter(|p| s.claimed(&p.txid, p.vout))
                .filter_map(|p| {
                    Some(OutPoint {
                        txid: p.txid.parse().ok()?,
                        vout: p.vout,
                    })
                })
                .collect();
            if !lock.is_empty() {
                if let Err(e) = rpc.lock_outputs(&lock, true) {
                    log(format!("lockunspent: {e}"));
                }
            }
            if !unlock.is_empty() {
                if let Err(e) = rpc.lock_outputs(&unlock, false) {
                    log(format!("lockunspent: {e}"));
                }
            }
        }
        // empty included: a claim sealed by another signer must leave the list
        self.round.want_claims(claims);
    }

    /// `bin/siding.mjs reconcile`: burns the wallet's history shows paid
    /// (by another signer, or before a crash) are recorded, not paid twice.
    fn reconcile(&mut self) {
        let (Some(rpc), Some(round)) = (&self.parent, &mut self.pegout) else {
            return;
        };
        if self
            .settings
            .parent
            .as_ref()
            .is_none_or(|p| p.wallet.is_none())
        {
            return;
        }
        let sent = match rpc.sent_transactions() {
            Ok(s) => s,
            Err(e) => {
                log(format!("peg-out reconcile: {e}"));
                return;
            }
        };
        let paid = paid_pegouts_in(&sent, &self.doc.id);
        let mut changed = false;
        for b in self.chain.state().pegouts() {
            let key = burn_key(&b);
            if round.ledger().paid.contains_key(&key) {
                continue;
            }
            if let Some(txid) = paid.get(&b.txid) {
                round.mark_paid(
                    &key,
                    PaidPegout {
                        parent_txid: txid.to_string(),
                        address: None,
                        value: b.value,
                        script: b.script.clone(),
                        height: b.height,
                        at: unix_now(),
                        signers: vec![],
                        reconciled: Some(true),
                    },
                );
                log(format!(
                    "peg-out {}… was paid by the federation in {}…",
                    &key[..16],
                    &txid.to_string()[..16]
                ));
                changed = true;
            }
        }
        if changed {
            write_json(&self.settings.dir.join("pegouts.json"), round.ledger());
        }
    }
}

fn parse_range(h: &str, size: u64) -> Option<(u64, u64)> {
    let r = h.strip_prefix("bytes=")?;
    let (a, b) = r.split_once('-')?;
    let start: u64 = a.parse().ok()?;
    let end: u64 = if b.is_empty() {
        size.saturating_sub(1)
    } else {
        b.parse().ok()?
    };
    (start <= end && end < size).then_some((start, end))
}

fn serve_http(port: u16, dat: PathBuf, to_loop: mpsc::UnboundedSender<Query>) -> Result<()> {
    let server = tiny_http::Server::http(("127.0.0.1", port))
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let path = req.url().split('?').next().unwrap_or("/").to_string();
            let cors = [
                ("access-control-allow-origin", "*"),
                ("access-control-allow-headers", "range, content-type"),
                ("access-control-allow-methods", "GET, POST, OPTIONS"),
            ];
            let with_cors = |mut r: tiny_http::Response<std::io::Cursor<Vec<u8>>>| {
                for (k, v) in cors {
                    r = r.with_header(tiny_http::Header::from_bytes(k, v).expect("static header"));
                }
                r
            };
            let json = |code: u16, v: &serde_json::Value| {
                with_cors(
                    tiny_http::Response::from_string(v.to_string())
                        .with_status_code(code)
                        .with_header(
                            tiny_http::Header::from_bytes("content-type", "application/json")
                                .expect("static header"),
                        ),
                )
            };
            let ask = |q: Query, rx: oneshot::Receiver<serde_json::Value>| {
                let _ = to_loop.send(q);
                rx.blocking_recv().unwrap_or(serde_json::Value::Null)
            };
            if req.method() == &tiny_http::Method::Options {
                let _ = req.respond(with_cors(
                    tiny_http::Response::from_data(Vec::new()).with_status_code(204),
                ));
                continue;
            }
            let response = match (req.method().as_str(), path.as_str()) {
                ("GET", "/") | ("GET", "/status.json") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Status(tx), rx))
                }
                ("GET", "/tip") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Tip(tx), rx))
                }
                ("GET", "/chain.json") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Chain(tx), rx))
                }
                ("GET", "/blocks.json") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Blocks(tx), rx))
                }
                ("GET", "/pegouts.json") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Pegouts(tx), rx))
                }
                ("GET", "/blocks.dat") => match std::fs::read(&dat) {
                    Ok(bytes) => {
                        let size = bytes.len() as u64;
                        let range = req
                            .headers()
                            .iter()
                            .find(|h| h.field.equiv("range"))
                            .and_then(|h| parse_range(h.value.as_str(), size));
                        let (code, body, extra) = match range {
                            Some((s, e)) => (
                                206,
                                bytes[s as usize..=e as usize].to_vec(),
                                Some(format!("bytes {s}-{e}/{size}")),
                            ),
                            None => (200, bytes, None),
                        };
                        let mut r =
                            with_cors(tiny_http::Response::from_data(body).with_status_code(code))
                                .with_header(
                                    tiny_http::Header::from_bytes(
                                        "content-type",
                                        "application/octet-stream",
                                    )
                                    .expect("static header"),
                                )
                                .with_header(
                                    tiny_http::Header::from_bytes("accept-ranges", "bytes")
                                        .expect("static header"),
                                );
                        if let Some(cr) = extra {
                            r = r.with_header(
                                tiny_http::Header::from_bytes("content-range", cr.as_str())
                                    .expect("static header"),
                            );
                        }
                        r
                    }
                    Err(e) => json(500, &serde_json::json!({"error": e.to_string()})),
                },
                ("GET", p) if p.starts_with("/coins/") => {
                    let (tx, rx) = oneshot::channel();
                    json(200, &ask(Query::Coins(p[7..].to_ascii_lowercase(), tx), rx))
                }
                ("POST", "/tx") => {
                    let mut body = String::new();
                    let _ = std::io::Read::read_to_string(
                        &mut std::io::Read::take(req.as_reader(), 262_144),
                        &mut body,
                    );
                    let (tx, rx) = oneshot::channel();
                    let _ = to_loop.send(Query::Tx(body, tx));
                    match rx.blocking_recv() {
                        Ok(Ok(v)) => json(200, &v),
                        Ok(Err(e)) => json(400, &serde_json::json!({"error": e})),
                        Err(_) => json(500, &serde_json::json!({"error": "the signer is gone"})),
                    }
                }
                _ => json(404, &serde_json::json!({"error": "not found"})),
            };
            let _ = req.respond(response);
        }
    });
    Ok(())
}

/// Run one signer until the process ends. Generic over the header family;
/// [`run`] picks it from the document.
pub async fn run_as<F: HeaderFamily>(doc: ChainDocument, settings: Settings) -> Result<()> {
    let key_text = std::fs::read_to_string(&settings.key_file)
        .map_err(|e| Error::Key(format!("{}: {e}", settings.key_file.display())))?;
    let key = LocalKey::from_hex(&key_text)?;
    let dir = settings.dir.clone();
    std::fs::create_dir_all(&dir)?;
    let chain = ChainOf::<F>::open_sealed(doc.clone(), &dir, |_| {
        Err(sidestr_core::Error::Chain(
            "no block file: copy blocks.dat and blocks.json from a mirror of this chain first"
                .into(),
        ))
    })?;
    let journal_path = settings
        .journal
        .clone()
        .unwrap_or_else(|| dir.join("votes.jsonl"));
    let journal = FileJournal::open(&journal_path)?;
    let loaded = journal.entries()?.len();
    let mut round = Round::new(
        chain.state(),
        Box::new(LocalKey::from_hex(&key_text)?),
        Box::new(journal),
        settings.round.clone(),
    )?;
    let fed = round.federation().clone();
    let network = doc.parent().ok().and_then(parent_network);
    let parent = settings
        .parent
        .as_ref()
        .map(|p| std::rc::Rc::new(CoreRpc::new(&p.url, &p.cookie, p.wallet.as_deref())));
    if let Some(rpc) = &parent {
        round = round.with_claim_checker(Box::new(ParentClaims {
            rpc: rpc.clone(),
            chain_id: doc.id.clone(),
            need: doc.peg_confirmations,
            challenge: chain.state().challenge().to_owned(),
        }));
    }
    let pegout = match (&parent, &settings.parent) {
        (Some(_), Some(p)) if p.wallet.is_some() => Some(PegoutRound::new(
            fed.clone(),
            &doc.id,
            Box::new(LocalKey::from_hex(&key_text)?),
            Box::new(FileJournal::open(&journal_path)?),
            PegoutConfig {
                network,
                ..settings.pegout.clone()
            },
            read_json::<PegoutLedger>(&dir.join("pegouts.json")),
        )?),
        _ => None,
    };
    let mut pegins: PeginState = read_json(&dir.join("pegins.json"));
    if pegins.pegins.is_empty() && pegins.scanned == 0 {
        pegins.scanned = i64::from(settings.parent.as_ref().map(|p| p.from).unwrap_or(0)) - 1;
    }
    let now = unix_now();
    let mut node = Node {
        txs: Follower::new(KIND_TRANSACTION, &doc.id),
        doc,
        chain,
        round,
        pegout,
        parent,
        pegins,
        settings: settings.clone(),
        key,
        last_block: now,
        announced: None,
        announce_retry_at: 0,
        started: now,
    };
    log(format!(
        "level 2: signer {} of {}, threshold {}, proposing after {} s when it is another signer's turn; journal {} ({loaded} entries)",
        node.round.slot() + 1,
        fed.signers.len(),
        fed.threshold,
        settings.round.propose_after,
        journal_path.display()
    ));
    log(format!(
        "chain {} at {} ({} coins), {} relay(s), {} mirror(s), parent {}",
        node.doc.id,
        node.chain.state().height(),
        node.chain.state().utxo().len(),
        settings.relays.len(),
        settings.mirrors.len(),
        settings
            .parent
            .as_ref()
            .map(|p| p.url.as_str())
            .unwrap_or("none")
    ));
    if let Some(p) = node.pegout.as_ref() {
        log(format!(
            "parent wallet {}: peg-outs for {} are paid by the federation's PSBT round ({} of {}), {} paid so far",
            settings.parent.as_ref().and_then(|p| p.wallet.clone()).unwrap_or_default(),
            node.doc.id,
            fed.threshold,
            fed.signers.len(),
            p.ledger().paid.len()
        ));
    }

    let (to_loop, mut queries) = mpsc::unbounded_channel::<Query>();
    serve_http(settings.port, node.chain.dat_path(), to_loop)?;
    log(format!(
        "producer on http://127.0.0.1:{}/ every {} s ({} s with transactions)",
        settings.port, settings.interval, settings.tx_interval
    ));
    let mut events = follow(
        settings.relays.clone(),
        vec![
            KIND_BLOCK_PROPOSAL,
            KIND_PARTIAL_SIGNATURE,
            KIND_SEALED_BLOCK,
            KIND_PEGOUT_PSBT,
            KIND_PEGOUT_SIGNED,
            KIND_TRANSACTION,
        ],
        600,
        log,
    );
    let mut second = tokio::time::interval(Duration::from_secs(1));
    let poll = settings
        .parent
        .as_ref()
        .map(|p| p.poll.max(1))
        .unwrap_or(60);
    let mut parent_tick = tokio::time::interval(Duration::from_secs(poll));
    let mut announce_tick = tokio::time::interval(Duration::from_secs(3));
    let relays = settings.relays.clone();

    let publish = |ev: Event, what: String| {
        let relays = relays.clone();
        tokio::spawn(async move {
            let r = publish_all(&relays, &ev, Duration::from_secs(8)).await;
            log(format!("{what} reached {} relay(s)", ok_count(&r)));
        });
    };
    let handle = |node: &mut Node<F>, actions: Vec<Action>| {
        for a in actions {
            match a {
                Action::Log(s) => log(s),
                Action::Publish(ev) => {
                    let what = match ev.kind {
                        KIND_BLOCK_PROPOSAL => format!(
                            "round: proposal h{} {}…",
                            sidestr_nostr::tags::first(&ev.tags, "h").unwrap_or("?"),
                            &ev.id[..12]
                        ),
                        KIND_PARTIAL_SIGNATURE => format!(
                            "round: partial h{}",
                            sidestr_nostr::tags::first(&ev.tags, "h").unwrap_or("?")
                        ),
                        _ => format!(
                            "round: sealed h{}",
                            sidestr_nostr::tags::first(&ev.tags, "h").unwrap_or("?")
                        ),
                    };
                    publish(ev, what);
                }
                Action::Sealed(_) => {
                    node.last_block = unix_now();
                }
            }
        }
    };
    let handle_pegout = |node: &mut Node<F>, actions: Vec<PegoutAction>| {
        for a in actions {
            match a {
                PegoutAction::Log(s) => log(s),
                PegoutAction::Publish(ev) => {
                    let what = format!(
                        "peg-out round: kind {} for {}…",
                        ev.kind,
                        sidestr_nostr::tags::first(&ev.tags, "d")
                            .map(|d| &d[..d.len().min(16)])
                            .unwrap_or("?")
                    );
                    publish(ev, what);
                }
                PegoutAction::Broadcast(f) => {
                    let Some(rpc) = node.parent.clone() else {
                        continue;
                    };
                    let hex = hex::encode(bitcoin::consensus::encode::serialize(&f.tx));
                    match rpc.call("sendrawtransaction", serde_json::json!([hex])) {
                        Ok(_) => {
                            if let Some(p) = node.pegout.as_mut() {
                                p.mark_paid(&f.burn, f.record);
                                write_json(&node.settings.dir.join("pegouts.json"), p.ledger());
                            }
                        }
                        Err(e) => log(format!("peg-out round: sendrawtransaction: {e}")),
                    }
                }
            }
        }
    };

    loop {
        tokio::select! {
            _ = second.tick() => {
                let now = unix_now();
                let wait = if node.chain.state().mempool().count() > 0 { settings.tx_interval } else { settings.interval };
                let due = now.saturating_sub(node.last_block) >= wait;
                let actions = node.round.tick(now, &mut node.chain, due);
                handle(&mut node, actions);
                while let Ok(q) = queries.try_recv() { node.answer(q); }
            }
            Some(q) = queries.recv() => { node.answer(q); }
            Some((_, ev)) = events.recv() => {
                let now = unix_now();
                match ev.kind {
                    KIND_TRANSACTION => {
                        if node.txs.accept(&ev).is_some() {
                            if let Ok(t) = sidestr_nostr::tx::parse_transaction(&ev, Some(&node.doc.id)) {
                                match hex::decode(&t.tx_hex).map_err(|e| e.to_string()).and_then(|b| node.chain.submit(&b).map_err(|e| e.to_string())) {
                                    Ok(s) => if !s.dup { log(format!("tx {}… accepted from a relay, fee {}", &s.txid.to_string()[..16], s.fee)) },
                                    Err(e) => log(format!("tx from a relay refused: {e}")),
                                }
                            }
                        }
                    }
                    KIND_PEGOUT_PSBT | KIND_PEGOUT_SIGNED => {
                        let burns = node.chain.state().pegouts();
                        if let Some(p) = node.pegout.as_mut() {
                            let actions = p.on_event(now, &ev, &burns);
                            handle_pegout(&mut node, actions);
                        }
                    }
                    _ => {
                        let actions = node.round.on_event(now, &mut node.chain, &ev);
                        handle(&mut node, actions);
                    }
                }
            }
            _ = parent_tick.tick() => {
                if node.parent.is_some() {
                    node.peg_tick();
                    node.reconcile();
                    let coins = node.peg_coins();
                    let burns = node.chain.state().pegouts();
                    if let Some(p) = node.pegout.as_mut() {
                        let actions = p.tick(unix_now(), &burns, &coins);
                        handle_pegout(&mut node, actions);
                    }
                }
            }
            _ = announce_tick.tick() => {
                if !relays.is_empty() && !settings.mirrors.is_empty() {
                    let tip = node.chain.state().tip();
                    let now = unix_now();
                    if node.announced != Some(tip.height) && now >= node.announce_retry_at {
                        let headers = node.headers_hex();
                        match TipTemplate::new(node.doc.id.clone(), tip.height, headers.clone(), settings.mirrors.clone()).and_then(|t| sign_tip(&node.key, &t, now)) {
                            Ok(ev) => {
                                let r = publish_all(&relays, &ev, Duration::from_secs(8)).await;
                                let ok = ok_count(&r);
                                if ok > 0 { node.announced = Some(tip.height); } else { node.announce_retry_at = now + 60; }
                                log(format!("announced tip {} {}… (kind 33333, {} headers, {} mirror(s)) to {ok}/{} relay(s)", tip.height, &tip.hash.to_string()[..16], headers.len(), settings.mirrors.len(), relays.len()));
                            }
                            Err(e) => log(format!("announce: {e}")),
                        }
                    }
                }
            }
        }
    }
}

/// Run one signer for the document at `settings.chain`, picking the header
/// family from its parent.
pub async fn run(settings: Settings) -> Result<()> {
    let doc = ChainDocument::from_json(
        &std::fs::read_to_string(&settings.chain)
            .map_err(|e| Error::Federation(format!("{}: {e}", settings.chain.display())))?,
    )?;
    doc.validate()?;
    if doc.signers.is_none() {
        return Err(Error::Federation(
            "not a federated chain: the document has no signers; a level-1 chain is produced by `siding produce`".into(),
        ));
    }
    match doc.family()? {
        sidestr_core::parents::Family::Stock => {
            run_as::<sidestr_core::block::Stock>(doc, settings).await
        }
        sidestr_core::parents::Family::Blake2b => {
            run_as::<sidestr_header::Blake2bV2>(doc, settings).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_parse_as_a_mirror_sends_them() {
        assert_eq!(parse_range("bytes=8-15", 100), Some((8, 15)));
        assert_eq!(parse_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=90-100", 100), None);
        assert_eq!(parse_range("items=1-2", 100), None);
    }

    #[test]
    fn pegin_records_round_trip() {
        let f = FoundPegin {
            txid: "ab".repeat(32),
            vout: 1,
            amount: 5,
            script: bitcoin::ScriptBuf::from_bytes(vec![0x51, 0x20]),
            height: 9,
            parent_address: None,
        };
        let r = PeginRecord::from(&f);
        assert_eq!(r.found(), f);
    }
}
