//! Replay a sidestr block file (a mirror's `blocks.dat`) with `sidestr-core`
//! and say where given transactions sit in the validated chain.
//!
//! ```text
//! sidechain-witness-replay --chain chain.json --blocks blocks.dat [--txid <64 hex>]... [--height N]... [--decode FILE]
//! ```
//!
//! `--height N` adds the validated block hash at height N under `hashes`
//! (a parent checkpoint names a height and a hash; this is what it must match).
//!
//! `--script HEX` adds the settled balance at the tip of that output script
//! (for an agent, `5120<x-only key>`) under `balances`: the sum and count of
//! its unspent coins in the validated UTXO set.
//!
//! `--decode FILE` reads lines `<label> <transaction hex>` (the content of
//! kind-23500 events, labelled by event id) and reports each one's txid, or
//! null when the hex is not a transaction, under `decoded`.
//!
//! The header family follows the document's parent: the stock 80-byte
//! header (`sidestr-core`) beside `btc`/`tbtc4`, Knots' 164-byte BLAKE2b v2
//! header (`sidestr-header`) beside `xbt`/`txbt4`.
//!
//! Prints one JSON object: the engine, the replayed tip (height, hash,
//! genesis), the block file's SHA-256, and for each `--txid` its height,
//! block hash and position, the outpoints it spends (each located), and the
//! transactions that later spend its outputs. A block the consensus rules
//! refuse stops the replay with a non-zero exit: nothing is reported from a
//! chain that did not validate.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use bitcoin::hashes::{sha256, Hash};
use bitcoin::{OutPoint, Txid};
use serde_json::{json, Value};
use sidestr_core::parents::Family;
use sidestr_core::{resolve_parent, ChainDocument, HeaderFamily, SidestrBlock, StateOf, Stock};
use sidestr_header::Blake2bV2;

struct Loc {
    height: u32,
    index: usize,
}

fn usage() -> ! {
    eprintln!("usage: sidechain-witness-replay --chain chain.json --blocks blocks.dat [--txid HEX]... [--height N]... [--script HEX]... [--decode FILE]");
    std::process::exit(2)
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let (mut chain, mut blocks, mut wanted, mut decode) = (None, None, Vec::new(), None);
    let mut heights: Vec<u32> = Vec::new();
    let mut scripts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let v = argv.get(i + 1).cloned().unwrap_or_else(|| usage());
        match argv[i].as_str() {
            "--chain" => chain = Some(v),
            "--blocks" => blocks = Some(v),
            "--decode" => decode = Some(v),
            "--script" => scripts.push(v.to_lowercase()),
            "--height" => heights.push(v.parse().unwrap_or_else(|e| {
                eprintln!("--height {v}: {e}");
                std::process::exit(2)
            })),
            "--txid" => wanted.push(Txid::from_str(&v).unwrap_or_else(|e| {
                eprintln!("--txid {v}: {e}");
                std::process::exit(2)
            })),
            _ => usage(),
        }
        i += 2;
    }
    let (chain, blocks) = (chain.unwrap_or_else(|| usage()), blocks.unwrap_or_else(|| usage()));
    match run(&chain, &blocks, &wanted, &heights, &scripts).and_then(|mut v| {
        if let Some(f) = &decode {
            v["decoded"] = decode_file(f)?;
        }
        Ok(v)
    }) {
        Ok(v) => println!("{}", serde_json::to_string_pretty(&v).expect("json")),
        Err(e) => {
            eprintln!("replay refused: {e}");
            std::process::exit(1)
        }
    }
}

fn run(chain: &str, blocks: &str, wanted: &[Txid], heights: &[u32], scripts: &[String]) -> Result<Value, String> {
    let doc = ChainDocument::from_json(&std::fs::read_to_string(chain).map_err(|e| format!("{chain}: {e}"))?)
        .map_err(|e| e.to_string())?;
    let dat = std::fs::read(blocks).map_err(|e| format!("{blocks}: {e}"))?;
    match resolve_parent(&doc.parent).map_err(|e| e.to_string())?.family {
        Family::Stock => replay::<Stock>(doc, &dat, wanted, heights, scripts, "stock"),
        Family::Blake2b => replay::<Blake2bV2>(doc, &dat, wanted, heights, scripts, "blake2b-v2"),
    }
}

fn replay<F: HeaderFamily>(
    doc: ChainDocument,
    dat: &[u8],
    wanted: &[Txid],
    heights: &[u32],
    scripts: &[String],
    family: &str,
) -> Result<Value, String> {
    let digest = sha256::Hash::hash(dat);

    let want: HashSet<Txid> = wanted.iter().copied().collect();
    let mut at: HashMap<Txid, Loc> = HashMap::new();
    let mut spends: HashMap<Txid, Vec<OutPoint>> = HashMap::new();
    let mut spent_by: HashMap<OutPoint, Txid> = HashMap::new();
    // Every output ever created, so a located transaction's inputs carry the
    // value and script they spent (who paid), not only an outpoint.
    let mut created: HashMap<OutPoint, (u64, String)> = HashMap::new();
    let mut outs: HashMap<Txid, Vec<Value>> = HashMap::new();
    let state = StateOf::<F>::replay_with(doc, dat, None, |_, height, block| {
        for (index, tx) in block.txdata().iter().enumerate() {
            let txid = tx.compute_txid();
            at.insert(txid, Loc { height, index });
            for (vout, o) in tx.output.iter().enumerate() {
                let script = o.script_pubkey.to_hex_string();
                if want.contains(&txid) {
                    outs.entry(txid).or_default().push(json!({ "vout": vout, "value": o.value.to_sat(), "script": script }));
                }
                created.insert(OutPoint { txid, vout: vout as u32 }, (o.value.to_sat(), script));
            }
            let ins: Vec<OutPoint> = if tx.is_coinbase() { Vec::new() } else { tx.input.iter().map(|i| i.previous_output).collect() };
            for op in &ins {
                if want.contains(&op.txid) {
                    spent_by.insert(*op, txid);
                }
            }
            if want.contains(&txid) {
                spends.insert(txid, ins);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    let locate = |txid: &Txid| -> Value {
        match at.get(txid) {
            Some(l) => json!({
                "height": l.height,
                "hash": state.hash_at(l.height).map(|h| h.to_string()),
                "index": l.index,
            }),
            None => Value::Null,
        }
    };
    let mut txs = serde_json::Map::new();
    for txid in wanted {
        let entry = match at.get(txid) {
            None => json!({ "found": false }),
            Some(_) => {
                let inputs: Vec<Value> = spends.get(txid).into_iter().flatten().map(|op| {
                    let (value, script) = created.get(op).cloned().map(|(v, s)| (Value::from(v), Value::String(s))).unwrap_or((Value::Null, Value::Null));
                    json!({ "txid": op.txid.to_string(), "vout": op.vout, "value": value, "script": script, "at": locate(&op.txid) })
                }).collect();
                let mut later: Vec<(&OutPoint, &Txid)> = spent_by.iter().filter(|(op, _)| op.txid == *txid).collect();
                later.sort_by_key(|(op, _)| op.vout);
                let spent: Vec<Value> = later.into_iter().map(|(op, by)| json!({
                    "vout": op.vout, "by": by.to_string(), "at": locate(by),
                })).collect();
                json!({ "found": true, "at": locate(txid), "outputs": outs.get(txid).cloned().unwrap_or_default(), "spends": inputs, "spent_by": spent })
            }
        };
        txs.insert(txid.to_string(), entry);
    }
    let mut hashes = serde_json::Map::new();
    for h in heights {
        hashes.insert(h.to_string(), state.hash_at(*h).map(|x| Value::String(x.to_string())).unwrap_or(Value::Null));
    }
    let mut balances = serde_json::Map::new();
    for sc in scripts {
        let (mut sats, mut coins) = (0u64, 0u64);
        for coin in state.utxo().values() {
            if coin.output.script_pubkey.to_hex_string() == *sc {
                sats += coin.output.value.to_sat();
                coins += 1;
            }
        }
        balances.insert(sc.clone(), json!({ "sats": sats, "coins": coins }));
    }
    let tip = state.tip();
    Ok(json!({
        "balances": balances,
        "hashes": hashes,
        "engine": {
            "crate": "sidestr-core", "version": "0.4.0", "source": "crates.io",
            "header_family": family,
            "family_crate": if family == "stock" { "sidestr-core" } else { "sidestr-header 0.3.1" },
        },
        "chain": state.document().id,
        "genesis_hash": state.genesis_hash().to_string(),
        "height": tip.height,
        "tip_hash": tip.hash.to_string(),
        "tip_time": tip.time,
        "blocks_dat_sha256": digest.to_string(),
        "blocks_dat_bytes": dat.len(),
        "txs": txs,
    }))
}

/// Txids of labelled transaction hex lines, by the `bitcoin` crate's own
/// deserialiser: a label whose hex is not exactly one transaction maps to null.
fn decode_file(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let mut out = serde_json::Map::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(label), Some(hex)) = (parts.next(), parts.next()) else { continue };
        let txid = bitcoin::consensus::encode::deserialize_hex::<bitcoin::Transaction>(hex)
            .ok()
            .map(|tx| Value::String(tx.compute_txid().to_string()))
            .unwrap_or(Value::Null);
        out.insert(label.to_string(), txid);
    }
    Ok(Value::Object(out))
}
