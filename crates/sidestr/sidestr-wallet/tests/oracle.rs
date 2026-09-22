//! The oracle: a spend and a burn built by the wallet on a throwaway chain
//! are accepted by `sidestr-core`'s rules (`State::submit`, then mined) and
//! by siding's `Siding.submit()` — the reference producer's `POST /tx` path
//! — with the same txid, fee and size; and a tampered signature is refused
//! by both. The reference half needs the checkouts named by
//! `SIDESTR_SIDING`, `SCHEMA` and `BLAKETESTNODE`; without them it reports
//! itself skipped and the Rust half still runs.
//!
//! Byte equality with `siding send` is not the bar: `spend.mjs` signs with
//! the schema kernel's unified sighash (`0x21`), which `sidestr-core`
//! refuses, and this crate signs plain BIP 341 `SIGHASH_DEFAULT`, which
//! both engines accept. Acceptance by both is the oracle.

use std::path::{Path, PathBuf};
use std::process::Command;

use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::{sha256, Hash};
use bitcoin::secp256k1::SecretKey;
use bitcoin::Transaction;
use sidestr_core::block::{challenge_for, pubkey_of};
use sidestr_core::document::{ChainDocument, Peg};
use sidestr_core::marker::parse_peg_marker;
use sidestr_core::state::{NextBlock, State};
use sidestr_wallet::burn::{build_burn, BurnRequest};
use sidestr_wallet::coins::from_state;
use sidestr_wallet::key::address_for;
use sidestr_wallet::pegin::{build_pegin, scan_pegin};
use sidestr_wallet::spend::{build_spend, SpendRequest};
use sidestr_wallet::{Permissive, PlainKey, SpendSigner};

const TB_P2TR: &str = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";

/// Keys that are the same on every run: tests must be reproducible. Not
/// secrets: anyone can derive them, and the chain they seal is throwaway.
fn key(seed: &str) -> SecretKey {
    SecretKey::from_slice(
        &sha256::Hash::hash(format!("sidestr-wallet oracle key {seed}").as_bytes()).to_byte_array(),
    )
    .unwrap()
}

/// A throwaway chain beside tbtc4 whose genesis pegs two coins to the wallet.
fn document(signer: &SecretKey, wallet: &dyn SpendSigner) -> ChainDocument {
    let mut d = ChainDocument::from_json(&format!(
        r#"{{"id":"sidestr:walletoracle","name":"walletoracle","parent":"tbtc4",
        "comment":"throwaway: the sidestr-wallet oracle chain; coins with no value",
        "challenge":"{}","powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "addressPrefix":"wo","pegConfirmations":6,"refundBlocks":10000,"pegoutBlocks":144,
        "pegoutMin":10000,"minFeeRate":1,"genesisTime":1790076612,"pegs":[],"signer":"{}"}}"#,
        challenge_for(&pubkey_of(signer)).to_hex_string(),
        pubkey_of(signer)
    ))
    .unwrap();
    for (n, amount) in [(0u32, 700_000u64), (1, 300_000)] {
        d.pegs.push(Peg {
            txid: "a".repeat(64),
            vout: n,
            amount,
            script: wallet.script().to_hex_string(),
            extra: Default::default(),
        });
    }
    d
}

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "sidestr-wallet-oracle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn js(cmd: &str, chain: &Path, dir: &Path, key: &Path, arg: &str) -> serde_json::Value {
    let out = Command::new("node")
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/xcheck-wallet.mjs"))
        .arg(cmd)
        .arg(chain)
        .arg(dir)
        .arg(key)
        .arg(arg)
        .output()
        .expect("node");
    assert!(
        out.status.success(),
        "reference engine failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("json from the reference engine")
}

#[test]
fn spend_and_burn_pass_core_rules_and_siding_submit() {
    let signer = key("signer");
    let wallet = PlainKey::new(key("wallet"));
    let mut doc = document(&signer, &wallet);
    let mut chain = State::with_key(doc.clone(), &signer).unwrap();
    doc.genesis_hash = Some(chain.genesis_hash().to_string());
    let t0 = doc.genesis_time;
    for i in 1..=100 {
        chain
            .produce(
                &signer,
                &NextBlock {
                    time: t0 + i,
                    claims: vec![],
                },
                None,
            )
            .unwrap();
    }

    // --- Rust: a two-input spend, mined; a burn of the change, mined ---
    let coins = from_state(&chain, &wallet.script());
    assert_eq!(coins.len(), 2);
    let you = address_for(&PlainKey::new(key("you")).pubkey(), "wo").unwrap();
    let spend = build_spend(
        &SpendRequest {
            chain: &doc,
            coins: &coins,
            tip_height: chain.height(),
            to: &you,
            amount: 800_000,
            fee: None,
        },
        &wallet,
        &Permissive,
    )
    .unwrap();
    assert_eq!(spend.inputs, 2);
    let bad_check = {
        let mut bad = spend.tx.clone();
        let mut w: Vec<Vec<u8>> = bad.input[0].witness.iter().map(<[u8]>::to_vec).collect();
        w[0][10] ^= 1;
        bad.input[0].witness = bitcoin::Witness::from_slice(&w);
        chain.submit(bad).unwrap_err()
    };
    let ok = chain.submit(spend.tx.clone()).unwrap();
    assert_eq!(
        (ok.txid, ok.fee, ok.vsize, ok.dup),
        (spend.txid, spend.fee, spend.vsize, false)
    );
    let (mined, block) = chain
        .produce(
            &signer,
            &NextBlock {
                time: t0 + 101,
                claims: vec![],
            },
            None,
        )
        .unwrap();
    assert_eq!(
        (mined.height, block.txdata.len(), mined.fees),
        (101, 2, spend.fee)
    );

    let coins = from_state(&chain, &wallet.script());
    assert_eq!(coins.len(), 1);
    assert_eq!(coins[0].value, spend.change);
    let burn = build_burn(
        &BurnRequest {
            chain: &doc,
            coins: &coins,
            tip_height: chain.height(),
            to: TB_P2TR,
            amount: 10_000,
            fee: None,
        },
        &wallet,
        &Permissive,
    )
    .unwrap();
    chain.submit(burn.tx.clone()).unwrap();
    let (mined, _) = chain
        .produce(
            &signer,
            &NextBlock {
                time: t0 + 102,
                claims: vec![],
            },
            None,
        )
        .unwrap();
    assert_eq!(mined.height, 102);
    let burns = chain.pegouts();
    assert_eq!(burns.len(), 1);
    assert_eq!((burns[0].value, burns[0].height), (10_000, 102));
    assert_eq!(
        burns[0].script,
        sidestr_core::address::address_to_script(TB_P2TR)
            .unwrap()
            .to_hex_string()
    );

    // a tampered signature is refused by name (the negative control for the oracle);
    // siding sees it after the real spend was mined, so it may refuse the coin rather than the signature
    let mut bad = spend.tx.clone();
    let mut w: Vec<Vec<u8>> = bad.input[0].witness.iter().map(<[u8]>::to_vec).collect();
    w[0][10] ^= 1;
    bad.input[0].witness = bitcoin::Witness::from_slice(&w);
    let bad_hex = bitcoin::consensus::encode::serialize_hex(&bad);
    assert!(
        bad_check
            .to_string()
            .contains("invalid key-path schnorr signature"),
        "{bad_check}"
    );

    // --- the peg-in shape: decodes with rust-bitcoin, marker parses under sidestr-core ---
    let p = build_pegin(&doc, TB_P2TR, 250_000, &wallet.script().to_hex_string()).unwrap();
    let tx: Transaction = deserialize(&serialize(&p.transaction(vec![], None))).unwrap();
    assert_eq!(
        parse_peg_marker(&tx.output[1].script_pubkey, &doc.id).unwrap(),
        wallet.script()
    );
    assert_eq!(scan_pegin(&tx, &doc.id).unwrap().amount, 250_000);

    // --- siding: the same document, the same genesis, the same transactions ---
    if ["SIDESTR_SIDING", "SCHEMA", "BLAKETESTNODE"]
        .iter()
        .any(|v| std::env::var(v).is_err())
    {
        eprintln!("skipped the reference half: set SIDESTR_SIDING, SCHEMA and BLAKETESTNODE");
        return;
    }
    let tmp = TempDir::new();
    let chain_file = tmp.0.join("chain.json");
    let key_file = tmp.0.join("signer.key");
    let dir = tmp.0.join("state");
    std::fs::write(&chain_file, doc.to_json().unwrap()).unwrap();
    std::fs::write(
        &key_file,
        format!("{}\n", hex::encode(signer.secret_bytes())),
    )
    .unwrap();

    let setup = js("setup", &chain_file, &dir, &key_file, "100");
    assert_eq!(
        setup["genesisHash"],
        doc.genesis_hash.clone().unwrap(),
        "{setup}"
    );
    assert_eq!(
        (setup["height"].as_u64(), setup["coins"].as_u64()),
        (Some(100), Some(2)),
        "{setup}"
    );

    let r = js("submit", &chain_file, &dir, &key_file, &spend.hex);
    assert_eq!(r["ok"], true, "siding refused the spend: {r}");
    assert_eq!(r["txid"], spend.txid.to_string(), "{r}");
    assert_eq!(
        (r["fee"].as_u64(), r["vsize"].as_u64()),
        (Some(spend.fee), Some(spend.vsize)),
        "{r}"
    );
    assert_eq!(
        (r["height"].as_u64(), r["txs"].as_u64()),
        (Some(101), Some(2)),
        "{r}"
    );

    let r = js("submit", &chain_file, &dir, &key_file, &burn.hex);
    assert_eq!(r["ok"], true, "siding refused the burn: {r}");
    assert_eq!(r["txid"], burn.txid.to_string(), "{r}");
    assert_eq!(r["height"].as_u64(), Some(102), "{r}");

    let r = js("submit", &chain_file, &dir, &key_file, &bad_hex);
    assert_eq!(r["ok"], false, "siding accepted a tampered signature: {r}");
    assert!(
        r["error"].as_str().unwrap().contains("schnorr")
            || r["error"].as_str().unwrap().contains("not an unspent coin"),
        "{r}"
    );
}
