//! Shared by the ported siding tests: a throwaway chain in a temp dir, a
//! deterministic signer, and a taproot key-path spend of one of its coins.
#![allow(dead_code)]

use bitcoin::consensus::encode::serialize;
use bitcoin::hashes::{sha256, Hash};
use bitcoin::secp256k1::{Keypair, Message, SecretKey};
use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
use bitcoin::transaction::Version;
use bitcoin::{
    absolute::LockTime, Amount, Block, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Witness,
};
use sidestr_core::block::{
    build_block, challenge_for, pubkey_of, secp, sign_block, BlockTemplate, Stock,
};
use sidestr_core::chain::Chain;
use sidestr_core::document::{ChainDocument, Peg};
use sidestr_core::state::{CoinRef, State};

pub const TRIAL: &str = include_str!("../../fixtures/trial/chain.json");

/// A key that is the same on every run: tests must be reproducible.
pub fn signer(seed: &str) -> SecretKey {
    SecretKey::from_slice(
        &sha256::Hash::hash(format!("sidestr-core test key {seed}").as_bytes()).to_byte_array(),
    )
    .unwrap()
}

pub fn challenge(key: &SecretKey) -> ScriptBuf {
    challenge_for(&pubkey_of(key))
}

/// A throwaway document beside `tbtc4`, signed by `key`, with these pegs.
pub fn doc(name: &str, key: &SecretKey, pegs: Vec<(String, u32, u64, ScriptBuf)>) -> ChainDocument {
    let mut d = ChainDocument::from_json(TRIAL).unwrap();
    d.id = format!("sidestr:{name}");
    d.name = name.to_string();
    d.challenge = challenge(key).to_hex_string();
    d.signer = Some(pubkey_of(key).to_string());
    d.genesis_hash = None;
    d.pegs = pegs
        .into_iter()
        .map(|(txid, vout, amount, s)| Peg {
            txid,
            vout,
            amount,
            script: s.to_hex_string(),
            extra: Default::default(),
        })
        .collect();
    d
}

pub struct TempDir(pub std::path::PathBuf);
impl TempDir {
    pub fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "sidestr-{tag}-{}-{}",
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

pub fn open(doc: &ChainDocument, dir: &TempDir, key: &SecretKey) -> Chain {
    Chain::open(doc.clone(), &dir.0, Some(key)).unwrap()
}

/// Spend `coin` (paying `me`) with a BIP 341 key-path signature, SIGHASH_DEFAULT.
pub fn spend(key: &SecretKey, coin: &CoinRef, outputs: Vec<TxOut>) -> Transaction {
    let me = challenge(key);
    let mut tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: coin.outpoint,
            script_sig: ScriptBuf::new(),
            sequence: Sequence(0xffff_fffd),
            witness: Witness::new(),
        }],
        output: outputs,
    };
    let prevouts = [TxOut {
        value: Amount::from_sat(coin.value),
        script_pubkey: me,
    }];
    let msg = SighashCache::new(&tx)
        .taproot_key_spend_signature_hash(0, &Prevouts::All(&prevouts), TapSighashType::Default)
        .unwrap();
    let sig = secp().sign_schnorr_with_aux_rand(
        &Message::from_digest(msg.to_byte_array()),
        &Keypair::from_secret_key(secp(), key),
        &[0u8; 32],
    );
    tx.input[0].witness = Witness::from_slice(&[sig.serialize().to_vec()]);
    tx
}

pub fn pay(value: u64, script: &ScriptBuf) -> TxOut {
    TxOut {
        value: Amount::from_sat(value),
        script_pubkey: script.clone(),
    }
}

/// A mature coin of `key`'s: not a coinbase, or one old enough.
pub fn mature_coin(state: &State, key: &SecretKey) -> CoinRef {
    let mut coins: Vec<CoinRef> = state
        .coins(&challenge(key))
        .into_iter()
        .filter(|c| !c.coinbase || state.height() + 1 - c.height >= 100)
        .collect();
    coins.sort_by_key(|c| std::cmp::Reverse(c.value));
    coins.into_iter().next().expect("a mature coin")
}

/// A hand-built, signed block on the tip with these coinbase outputs and
/// transactions, as siding's tests build blocks straight into the validator.
pub fn hand_block(
    state: &State,
    key: &SecretKey,
    outputs: Vec<TxOut>,
    transactions: Vec<Transaction>,
) -> Vec<u8> {
    let tip = state.tip();
    let b = build_block(
        &Stock,
        &BlockTemplate {
            height: tip.height + 1,
            prev: tip.hash,
            time: tip.time + 1,
            transactions,
            outputs,
            bits: state.bits(),
            marker: "sidestr".into(),
        },
    );
    serialize(&sign_block(&Stock, &b, state.challenge(), key, &[0u8; 32]).unwrap())
}

pub fn produce_to(chain: &mut Chain, key: &SecretKey, height: u32) {
    while chain.state().height() < height {
        chain.produce(key, vec![]).unwrap();
    }
}

pub fn hex_block(b: &Block) -> String {
    hex::encode(serialize(b))
}
