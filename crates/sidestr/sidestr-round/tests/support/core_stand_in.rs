//! A Bitcoin Core stand-in for the peg-out round: the JSON-RPC calls
//! `pegoutround.mjs`, `bin/siding.mjs produce` and `sidestr-core`'s
//! `CoreRpc` make, answered from an in-memory UTXO set of peg coins, with
//! every "wallet" holding one signer's key. Enough to drive both engines
//! through a PSBT round on one box; nothing else Core does.

use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::psbt::Psbt;
use bitcoin::{Address, Amount, Network, OutPoint, ScriptBuf, Transaction, TxOut};
use serde_json::{json, Value};
use sidestr_core::federation::Federation;
use sidestr_core::marker::{parse_pegout_marker, Burn};
use sidestr_round::pegout::{
    build_pegout_psbt, combine_pegout_psbts, finalize_pegout_psbt, prevouts_of, sign_pegout_psbt,
    verify_pegout_transaction, PegCoin,
};
use sidestr_round::signer::LocalKey;

pub struct Sent {
    pub tx: Transaction,
    pub prevouts: Vec<TxOut>,
}

pub struct CoreStandIn {
    pub url: String,
    pub cookie: std::path::PathBuf,
    utxos: Arc<Mutex<BTreeMap<OutPoint, TxOut>>>,
    sent: Arc<Mutex<Vec<Sent>>>,
}

struct Inner {
    fed: Federation,
    chain_id: String,
    network: Network,
    wallets: BTreeMap<String, LocalKey>,
    utxos: Arc<Mutex<BTreeMap<OutPoint, TxOut>>>,
    sent: Arc<Mutex<Vec<Sent>>>,
}

fn btc(sats: u64) -> f64 {
    sats as f64 / 1e8
}

impl Inner {
    fn coins(&self) -> Vec<PegCoin> {
        self.utxos
            .lock()
            .unwrap()
            .iter()
            .map(|(o, t)| PegCoin {
                outpoint: *o,
                value: t.value.to_sat(),
            })
            .collect()
    }

    fn call(&self, wallet: Option<&str>, method: &str, params: &[Value]) -> Result<Value, String> {
        let p = |i: usize| params.get(i).cloned().unwrap_or(Value::Null);
        Ok(match method {
            "getblockcount" => json!(0),
            "getblockhash" => json!("00".repeat(32)),
            "getblock" => json!({"hash": "00".repeat(32), "height": 0, "time": 0, "tx": []}),
            "gettxout" => Value::Null,
            "lockunspent" => json!(true),
            "decodescript" => {
                let s = ScriptBuf::from_bytes(
                    hex::decode(p(0).as_str().unwrap_or("")).map_err(|e| e.to_string())?,
                );
                json!({"address": Address::from_script(&s, self.network).map_err(|e| e.to_string())?.to_string()})
            }
            "decodepsbt" => {
                let psbt =
                    Psbt::from_str(p(0).as_str().unwrap_or("")).map_err(|e| e.to_string())?;
                json!({
                    "tx": {"txid": psbt.unsigned_tx.compute_txid().to_string(), "vout": psbt.unsigned_tx.output.iter().enumerate().map(|(n, o)| json!({"n": n, "value": btc(o.value.to_sat()), "scriptPubKey": {"hex": o.script_pubkey.to_hex_string()}})).collect::<Vec<_>>()},
                    "inputs": psbt.inputs.iter().map(|i| json!({"witness_utxo": i.witness_utxo.as_ref().map(|u| json!({"amount": btc(u.value.to_sat()), "scriptPubKey": {"hex": u.script_pubkey.to_hex_string()}}))})).collect::<Vec<_>>(),
                })
            }
            "walletcreatefundedpsbt" => {
                let outs = p(1);
                let outs = outs.as_array().ok_or("outputs")?;
                let mut pay: Option<(String, u64)> = None;
                let mut data: Option<Vec<u8>> = None;
                for o in outs {
                    for (k, v) in o.as_object().ok_or("output")? {
                        if k == "data" {
                            data = Some(
                                hex::decode(v.as_str().ok_or("data")?)
                                    .map_err(|e| e.to_string())?,
                            );
                        } else {
                            let amount = v
                                .as_str()
                                .map(|s| s.parse::<f64>().unwrap_or(0.0))
                                .or_else(|| v.as_f64())
                                .ok_or("amount")?;
                            pay = Some((k.clone(), (amount * 1e8).round() as u64));
                        }
                    }
                }
                let (addr, value) = pay.ok_or("no payment output")?;
                let data = data.ok_or("no data output")?;
                let script = Address::from_str(&addr)
                    .map_err(|e| e.to_string())?
                    .require_network(self.network)
                    .map_err(|e| e.to_string())?
                    .script_pubkey();
                let marker = ScriptBuf::new_op_return(
                    &bitcoin::script::PushBytesBuf::try_from(data).map_err(|_| "data too long")?,
                );
                let side = parse_pegout_marker(&marker, &self.chain_id)
                    .ok_or("the data is not this chain's peg-out marker")?;
                let fee_rate = p(3)["fee_rate"].as_u64().unwrap_or(1);
                let burn = Burn {
                    txid: side,
                    vout: 0,
                    script: script.to_hex_string(),
                    value,
                    height: 0,
                };
                let psbt =
                    build_pegout_psbt(&self.fed, &self.chain_id, &burn, &self.coins(), fee_rate)
                        .map_err(|e| e.to_string())?;
                let fee = psbt.fee().map(|f| f.to_sat()).unwrap_or(0);
                json!({"psbt": psbt.to_string(), "fee": btc(fee), "changepos": if psbt.unsigned_tx.output.len() > 2 { 2 } else { -1 }})
            }
            "walletprocesspsbt" => {
                let name = wallet.ok_or("no wallet")?;
                let key = self.wallets.get(name).ok_or("unknown wallet")?;
                let mut psbt =
                    Psbt::from_str(p(0).as_str().unwrap_or("")).map_err(|e| e.to_string())?;
                sign_pegout_psbt(&mut psbt, &self.fed, &self.chain_id, "stand-in", key)
                    .map_err(|e| e.to_string())?;
                json!({"psbt": psbt.to_string(), "complete": false})
            }
            "combinepsbt" => {
                let list: Vec<Psbt> = p(0)
                    .as_array()
                    .ok_or("psbts")?
                    .iter()
                    .map(|v| Psbt::from_str(v.as_str().unwrap_or("")).map_err(|e| e.to_string()))
                    .collect::<Result<_, _>>()?;
                json!(combine_pegout_psbts(&list)
                    .map_err(|e| e.to_string())?
                    .to_string())
            }
            "finalizepsbt" => {
                let psbt =
                    Psbt::from_str(p(0).as_str().unwrap_or("")).map_err(|e| e.to_string())?;
                match finalize_pegout_psbt(&psbt, &self.fed).map_err(|e| e.to_string())? {
                    Some(tx) => json!({"complete": true, "hex": hex::encode(serialize(&tx))}),
                    None => json!({"complete": false, "psbt": psbt.to_string()}),
                }
            }
            "sendrawtransaction" => {
                let tx: Transaction = deserialize(
                    &hex::decode(p(0).as_str().unwrap_or("")).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                let mut utxos = self.utxos.lock().unwrap();
                let prevouts: Vec<TxOut> = tx
                    .input
                    .iter()
                    .map(|i| {
                        utxos
                            .get(&i.previous_output)
                            .cloned()
                            .ok_or(format!("missing-inputs: {}", i.previous_output))
                    })
                    .collect::<Result<_, _>>()?;
                verify_pegout_transaction(&tx, &prevouts)
                    .map_err(|e| format!("non-mandatory-script-verify-flag ({e})"))?;
                for i in &tx.input {
                    utxos.remove(&i.previous_output);
                }
                let txid = tx.compute_txid();
                for (n, o) in tx.output.iter().enumerate() {
                    if o.script_pubkey == self.fed.challenge() {
                        utxos.insert(
                            OutPoint {
                                txid,
                                vout: n as u32,
                            },
                            o.clone(),
                        );
                    }
                }
                self.sent.lock().unwrap().push(Sent { tx, prevouts });
                json!(txid.to_string())
            }
            "listunspent" => {
                let utxos = self.utxos.lock().unwrap();
                Value::Array(utxos.iter().map(|(o, t)| json!({"txid": o.txid.to_string(), "vout": o.vout, "scriptPubKey": t.script_pubkey.to_hex_string(), "amount": btc(t.value.to_sat()), "confirmations": 6, "spendable": true, "safe": true})).collect())
            }
            "listtransactions" => {
                let sent = self.sent.lock().unwrap();
                Value::Array(sent.iter().map(|s| json!({"category": "send", "txid": s.tx.compute_txid().to_string(), "confirmations": 1})).collect())
            }
            "gettransaction" => {
                let want = p(0).as_str().unwrap_or("").to_string();
                let sent = self.sent.lock().unwrap();
                let s = sent
                    .iter()
                    .find(|s| s.tx.compute_txid().to_string() == want)
                    .ok_or("Invalid or non-wallet transaction id")?;
                json!({"txid": want, "confirmations": 1, "hex": hex::encode(serialize(&s.tx)),
                       "decoded": {"txid": want, "vout": s.tx.output.iter().enumerate().map(|(n, o)| json!({"n": n, "value": btc(o.value.to_sat()), "scriptPubKey": {"hex": o.script_pubkey.to_hex_string()}})).collect::<Vec<_>>()}})
            }
            other => return Err(format!("Method not found: {other}")),
        })
    }
}

impl CoreStandIn {
    /// Serve on a free port; `wallets` name → signer key; `peg_coins` the
    /// federation's coins on the parent.
    pub fn start(
        fed: Federation,
        chain_id: &str,
        network: Network,
        wallets: Vec<(String, LocalKey)>,
        peg_coins: Vec<(OutPoint, u64)>,
        cookie: std::path::PathBuf,
    ) -> Self {
        std::fs::write(&cookie, "__cookie__:stand-in\n").unwrap();
        let utxos: Arc<Mutex<BTreeMap<OutPoint, TxOut>>> = Arc::new(Mutex::new(
            peg_coins
                .into_iter()
                .map(|(o, v)| {
                    (
                        o,
                        TxOut {
                            value: Amount::from_sat(v),
                            script_pubkey: fed.challenge(),
                        },
                    )
                })
                .collect(),
        ));
        let sent = Arc::new(Mutex::new(Vec::new()));
        let inner = Arc::new(Inner {
            fed,
            chain_id: chain_id.into(),
            network,
            wallets: wallets.into_iter().collect(),
            utxos: utxos.clone(),
            sent: sent.clone(),
        });
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", server.server_addr());
        std::thread::spawn(move || {
            for mut req in server.incoming_requests() {
                let path = req.url().to_string();
                let wallet = path
                    .strip_prefix("/wallet/")
                    .map(|w| w.trim_end_matches('/').to_string());
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let id = v["id"].clone();
                let method = v["method"].as_str().unwrap_or("").to_string();
                let params: Vec<Value> = v["params"].as_array().cloned().unwrap_or_default();
                let reply = match inner.call(wallet.as_deref(), &method, &params) {
                    Ok(r) => json!({"result": r, "error": Value::Null, "id": id}),
                    Err(e) => {
                        json!({"result": Value::Null, "error": {"code": -1, "message": e}, "id": id})
                    }
                };
                let _ = req.respond(
                    tiny_http::Response::from_string(reply.to_string()).with_header(
                        tiny_http::Header::from_bytes("content-type", "application/json").unwrap(),
                    ),
                );
            }
        });
        Self {
            url,
            cookie,
            utxos,
            sent,
        }
    }

    pub fn sent(&self) -> usize {
        self.sent.lock().unwrap().len()
    }

    /// Every broadcast transaction with its prevouts, verified again here.
    pub fn verified_payments(&self) -> Vec<(Transaction, Vec<sidestr_core::federation::MultiA>)> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    s.tx.clone(),
                    verify_pegout_transaction(&s.tx, &s.prevouts).expect("verifies"),
                )
            })
            .collect()
    }

    pub fn utxo_count(&self) -> usize {
        self.utxos.lock().unwrap().len()
    }

    pub fn prevouts_for(&self, psbt: &Psbt) -> Vec<TxOut> {
        prevouts_of(psbt).unwrap()
    }
}
