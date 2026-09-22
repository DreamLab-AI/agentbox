//! Shared by the tests: a throwaway k-of-n chain beside a stock parent,
//! sealed in-process, with deterministic keys; blocks mined through the
//! federation without a round, so a test can start at any height.
#![allow(dead_code)]

use std::collections::BTreeMap;

use bitcoin::hashes::{sha256, Hash};
use bitcoin::secp256k1::SecretKey;
use bitcoin::{Amount, ScriptBuf, TxOut};
use sidestr_core::block::{pubkey_of, Stock};
use sidestr_core::document::{ChainDocument, Peg};
use sidestr_core::federation::{partial_signature, seal_federated, Federation};
use sidestr_core::state::{NextBlock, State};
use sidestr_round::signer::LocalKey;

/// A key that is the same on every run.
pub fn key(seed: &str) -> SecretKey {
    SecretKey::from_slice(
        &sha256::Hash::hash(format!("sidestr-round test key {seed}").as_bytes()).to_byte_array(),
    )
    .unwrap()
}

pub fn keys(n: usize) -> Vec<SecretKey> {
    (0..n).map(|i| key(&format!("signer {i}"))).collect()
}

/// A wallet key whose script the genesis pegs coins to.
pub fn wallet() -> SecretKey {
    key("wallet")
}

pub fn wallet_script() -> ScriptBuf {
    sidestr_core::block::challenge_for(&pubkey_of(&wallet()))
}

/// A `k`-of-`n` document beside `tbtc4` (stock family), pegging `peg_sats`
/// to the wallet script, with the genesis sealed by the first `k` keys.
pub fn federated_doc(
    name: &str,
    keys: &[SecretKey],
    k: u8,
    peg_sats: u64,
) -> (ChainDocument, bitcoin::Block) {
    let pubs: Vec<_> = keys.iter().map(pubkey_of).collect();
    let fed = Federation::new(&format!("sidestr:{name}"), pubs.clone(), k).unwrap();
    let json = format!(
        r#"{{"id":"sidestr:{name}","name":"{name}","parent":"tbtc4","challenge":"{}",
            "powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","addressPrefix":"rt",
            "genesisTime":1790000000,"pegs":[],"signers":[{}],"threshold":{k},"pegoutMin":10000,"minFeeRate":1}}"#,
        fed.challenge().to_hex_string(),
        pubs.iter()
            .map(|p| format!("\"{p}\""))
            .collect::<Vec<_>>()
            .join(",")
    );
    let mut doc = ChainDocument::from_json(&json).unwrap();
    if peg_sats > 0 {
        doc.pegs.push(Peg {
            txid: "a".repeat(64),
            vout: 0,
            amount: peg_sats,
            script: wallet_script().to_hex_string(),
            extra: Default::default(),
        });
    }
    let genesis = State::build_genesis_for(&doc).unwrap();
    let sealed = seal_with(
        &fed,
        &genesis,
        keys,
        &(0..usize::from(k)).collect::<Vec<_>>(),
    );
    let s = State::from_genesis(doc.clone(), &sealed, None).unwrap();
    doc.genesis_hash = Some(s.genesis_hash().to_string());
    (doc, sealed)
}

pub fn seal_with(
    fed: &Federation,
    block: &bitcoin::Block,
    keys: &[SecretKey],
    which: &[usize],
) -> bitcoin::Block {
    let mut sigs = BTreeMap::new();
    for &i in which {
        sigs.insert(
            pubkey_of(&keys[i]),
            partial_signature(&Stock, block, fed, &keys[i], &[0u8; 32]).unwrap(),
        );
    }
    seal_federated(&Stock, block, fed, &sigs).unwrap()
}

pub fn state(doc: &ChainDocument, genesis: &bitcoin::Block) -> State {
    State::from_genesis(doc.clone(), genesis, None).unwrap()
}

/// Mine `count` empty blocks through the federation, one second apart,
/// sealed by the first two keys, on every state given (they stay in step).
pub fn mine(states: &mut [&mut State], keys: &[SecretKey], count: u32) -> Vec<bitcoin::Block> {
    let mut out = Vec::new();
    for _ in 0..count {
        let first = &states[0];
        let fed = first.federation().unwrap().clone();
        let t = first.tip().time + 1;
        let (block, _, _) = first
            .build_next(&NextBlock {
                time: t,
                claims: vec![],
            })
            .unwrap();
        let sealed = seal_with(&fed, &block, keys, &[0, 1]);
        for s in states.iter_mut() {
            s.add_block(&sealed, None, None).unwrap();
        }
        out.push(sealed);
    }
    out
}

pub fn local(k: &SecretKey) -> Box<LocalKey> {
    Box::new(LocalKey::new(*k))
}

/// A key-path spend of one wallet coin: `amount` to `to`, the rest minus
/// `fee` back to the wallet (BIP 341, SIGHASH_DEFAULT).
pub fn spend(
    state: &State,
    to: &ScriptBuf,
    amount: u64,
    fee: u64,
    extra: Vec<TxOut>,
) -> bitcoin::Transaction {
    use bitcoin::secp256k1::{Keypair, Message};
    use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
    use bitcoin::{absolute::LockTime, OutPoint, Sequence, TxIn, Witness};
    let me = wallet_script();
    let coin = state
        .coins(&me)
        .into_iter()
        .find(|c| !c.coinbase || state.height() + 1 - c.height >= 100)
        .expect("a mature coin");
    let mut output = vec![TxOut {
        value: Amount::from_sat(amount),
        script_pubkey: to.clone(),
    }];
    output.extend(extra);
    let extra_sum: u64 = output.iter().skip(1).map(|o| o.value.to_sat()).sum();
    output.push(TxOut {
        value: Amount::from_sat(coin.value - amount - extra_sum - fee),
        script_pubkey: me.clone(),
    });
    let mut tx = bitcoin::Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: coin.outpoint.txid,
                vout: coin.outpoint.vout,
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
            witness: Witness::new(),
        }],
        output,
    };
    let prev = [TxOut {
        value: Amount::from_sat(coin.value),
        script_pubkey: me,
    }];
    let msg = SighashCache::new(&tx)
        .taproot_key_spend_signature_hash(0, &Prevouts::All(&prev), TapSighashType::Default)
        .unwrap();
    let kp = Keypair::from_secret_key(sidestr_core::block::secp(), &wallet());
    let sig = sidestr_core::block::secp().sign_schnorr_with_aux_rand(
        &Message::from_digest(msg.to_byte_array()),
        &kp,
        &[0u8; 32],
    );
    tx.input[0].witness = Witness::from_slice(&[sig.as_ref().to_vec()]);
    tx
}

#[cfg(all(feature = "bin", feature = "relay"))]
pub mod core_stand_in;
#[cfg(all(feature = "bin", feature = "relay"))]
pub mod interop;
