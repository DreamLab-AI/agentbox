//! The two families through `sidestr-core` (feature `core`).
//!
//! - **Stock, two codecs, one genesis.** `sidestr_header::family::Stock` seals
//!   the trial fixture's genesis to the same bytes `sidestr_core::Stock` does
//!   — the bytes siding wrote (`fixtures/trial`, key disposable).
//! - **BLAKE2b, a live chain as oracle (PRD-024 S1).** `sidestr:txbt4-siding`
//!   is Melvin Carvalho's first sidestr chain, beside the BLAKE2b testnet4,
//!   mirrored at `https://melvin.me/public/siding/`. `fixtures/txbt4-siding`
//!   is that mirror as fetched on **2026-09-22 13:12 UTC**: 229 blocks,
//!   height 0 to **228**, tip
//!   `26218a8d85e6c06b5c7064781771f8271dc25d2bb2825c4b01b40ea3cd0f21ae`,
//!   including 16 blocks with a real spend (every one signed with hash type
//!   `0x21`, Knots' unified sighash), a `pegout:` burn at 133 and a `claim:`
//!   at 134. `ChainOf::<Blake2bV2>::open` replays it from the genesis to that
//!   tip with every rule on. `SIDESTR_LIVE=1` replays the mirror as it is
//!   now, and `melchain` beside it, to whatever tip each announces.

use std::path::PathBuf;

use bitcoin::consensus::encode::serialize;
use bitcoin::hashes::{sha256, Hash};
use bitcoin::secp256k1::{Keypair, Message, SecretKey};
use bitcoin::transaction::Version;
use bitcoin::{absolute::LockTime, Amount, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Witness};
use sidestr_core::block::{
    block_height, challenge_for, key_from_hex, pubkey_of, secp, solution_of, HeaderFamily,
    SidestrBlock,
};
use sidestr_core::chain::ChainOf;
use sidestr_core::document::ChainDocument;
use sidestr_core::sighash::{unified_taproot_sighash, UnifiedTaproot, SIGHASH_UNIFIED};
use sidestr_core::state::{CoinRef, NextBlock, StateOf};
use sidestr_core::{Error, State};
use sidestr_header::{family, Blake2bV2};

const SIDING_TIP_HEIGHT: u32 = 228;
const SIDING_TIP_HASH: &str = "26218a8d85e6c06b5c7064781771f8271dc25d2bb2825c4b01b40ea3cd0f21ae";

fn fixtures(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "sidestr-header-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn with_mirror(tag: &str, src: &std::path::Path) -> Self {
        let t = Self::new(tag);
        for f in ["blocks.dat", "blocks.json"] {
            std::fs::copy(src.join(f), t.0.join(f)).unwrap();
        }
        t
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn doc_at(dir: &std::path::Path) -> ChainDocument {
    ChainDocument::from_json(&std::fs::read_to_string(dir.join("chain.json")).unwrap()).unwrap()
}

fn signer(seed: &str) -> SecretKey {
    SecretKey::from_slice(
        &sha256::Hash::hash(format!("sidestr-header test key {seed}").as_bytes()).to_byte_array(),
    )
    .unwrap()
}

/// A txbt4 document signed by `key`, with one peg.
fn txbt4_doc(name: &str, key: &SecretKey, peg: u64) -> ChainDocument {
    let me = challenge_for(&pubkey_of(key));
    let mut d = doc_at(&fixtures("txbt4-siding"));
    d.id = format!("sidestr:{name}");
    d.name = name.to_string();
    d.challenge = me.to_hex_string();
    d.signer = Some(pubkey_of(key).to_string());
    d.genesis_hash = None;
    d.magic = None;
    d.pegs.truncate(1);
    d.pegs[0].amount = peg;
    d.pegs[0].script = me.to_hex_string();
    d.extra.clear();
    d
}

/// A key-path spend of `coin` with hash type `hash_type`: BIP 341 for 0x00,
/// Knots' unified message when the 0x20 bit is set — as siding's wallet
/// signs on a BLAKE2b chain.
fn spend(key: &SecretKey, coin: &CoinRef, outputs: Vec<TxOut>, hash_type: u8) -> Transaction {
    let me = challenge_for(&pubkey_of(key));
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
    // an undefined type has no message: sign the BIP 341 default one, so the verifier's refusal is by type
    let unified = (hash_type & SIGHASH_UNIFIED != 0)
        .then(|| {
            unified_taproot_sighash(&tx, 0, &prevouts, hash_type, None, UnifiedTaproot::KeyPath)
                .ok()
        })
        .flatten();
    let msg = if let Some(m) = unified {
        m
    } else {
        bitcoin::sighash::SighashCache::new(&tx)
            .taproot_key_spend_signature_hash(
                0,
                &bitcoin::sighash::Prevouts::All(&prevouts),
                bitcoin::sighash::TapSighashType::Default,
            )
            .unwrap()
            .to_byte_array()
    };
    let sig = secp()
        .sign_schnorr_with_aux_rand(
            &Message::from_digest(msg),
            &Keypair::from_secret_key(secp(), key),
            &[0u8; 32],
        )
        .serialize()
        .to_vec();
    let item = if hash_type == 0 {
        sig
    } else {
        [sig, vec![hash_type]].concat()
    };
    tx.input[0].witness = Witness::from_slice(&[item]);
    tx
}

fn pay(value: u64, script: &ScriptBuf) -> TxOut {
    TxOut {
        value: Amount::from_sat(value),
        script_pubkey: script.clone(),
    }
}

#[test]
fn stock_family_seals_the_trial_genesis_to_the_reference_bytes() {
    let dir = fixtures("trial");
    let doc = doc_at(&dir);
    let key = key_from_hex(&std::fs::read_to_string(dir.join("trial.key")).unwrap()).unwrap();
    let dat = std::fs::read(dir.join("blocks.dat")).unwrap();
    let size = u32::from_le_bytes(dat[4..8].try_into().unwrap()) as usize;
    let reference = &dat[8..8 + size];
    let ours = StateOf::<family::Stock>::genesis_block_for(&doc, &key).unwrap();
    let cores = State::genesis_block_for(&doc, &key).unwrap();
    assert_eq!(ours.encode(), reference);
    assert_eq!(serialize(&cores), reference);
    assert_eq!(
        family::Stock.block_hash(&ours.header).to_string(),
        doc.genesis_hash.clone().unwrap()
    );
    // and the state over this crate's header replays the same file to the same tip
    let tmp = TempDir::with_mirror("trial", &dir);
    let chain = ChainOf::<family::Stock>::open(doc.clone(), &tmp.0, None).unwrap();
    let core = ChainOf::<sidestr_core::Stock>::open(doc, &tmp.0, None).unwrap();
    assert_eq!(chain.state().tip(), core.state().tip());
    assert_eq!(chain.state().tip().height, 0);
}

#[test]
fn blake2b_txbt4_siding_replays_from_genesis_to_the_recorded_tip() {
    let src = fixtures("txbt4-siding");
    let doc = doc_at(&src);
    assert_eq!(doc.parent().unwrap().alias, "txbt4");
    let tmp = TempDir::with_mirror("siding", &src);
    let chain = ChainOf::<Blake2bV2>::open(doc.clone(), &tmp.0, None).unwrap();
    let state = chain.state();
    assert_eq!(
        state.genesis_hash().to_string(),
        doc.genesis_hash.clone().unwrap()
    );
    let tip = state.tip();
    assert_eq!(tip.height, SIDING_TIP_HEIGHT);
    assert_eq!(tip.hash.to_string(), SIDING_TIP_HASH);
    assert_eq!(chain.index().blocks.last().unwrap().hash, SIDING_TIP_HASH);
    // the headers are v2 and carry their heights
    let h = state.header_at(SIDING_TIP_HEIGHT).unwrap();
    assert_eq!(h.height, SIDING_TIP_HEIGHT);
    assert_eq!(h.version, 0xa000_0000);
    // SPEC 7: the burn at 133 is on record; SPEC 6: the claim at 134 is on record
    let burns = state.pegouts();
    assert_eq!(burns.len(), 1);
    assert_eq!(burns[0].height, 133);
    assert_eq!(burns[0].value, 100_000);
    assert!(state.claimed(
        "75cfc58eed7a8e202343d305005582f2bc98a494986243bcb9e0e4f2e6a31e4c",
        0
    ));
    // the supply is the four pegs, plus the one claim's payout, less the one burn — nothing else mints or destroys
    let supply: u64 = state.utxo().values().map(|c| c.output.value.to_sat()).sum();
    let pegs: u64 = doc.pegs.iter().map(|p| p.amount).sum();
    assert_eq!(supply, pegs + 2_500_000_000 - 100_000);
    // a stock validator refuses the document, by name
    assert!(matches!(
        ChainOf::<sidestr_core::Stock>::open(doc, &tmp.0, None),
        Err(Error::UnsupportedFamily(sidestr_core::Family::Blake2b))
    ));
}

#[test]
fn blake2b_rules_refuse_tampered_headers_and_stock_sighash_refuses_unified() {
    let src = fixtures("txbt4-siding");
    let tmp = TempDir::with_mirror("siding-rules", &src);
    let chain = ChainOf::<Blake2bV2>::open(doc_at(&src), &tmp.0, None).unwrap();
    let state = chain.state();
    // take block 133 (the burn) as it was replayed, re-judge it at its height against the state before it:
    // easiest is a fresh state replayed to 132
    let dat = std::fs::read(src.join("blocks.dat")).unwrap();
    let index = sidestr_core::blockfile::read_index(src.join("blocks.json"))
        .unwrap()
        .unwrap();
    let block_at = |h: usize| {
        let e = &index.blocks[h];
        let at = e.offset as usize + 8;
        <Blake2bV2 as HeaderFamily>::Block::decode(&dat[at..at + e.size as usize]).unwrap()
    };
    let genesis = block_at(0);
    let mut s = StateOf::<Blake2bV2>::from_genesis(doc_at(&src), &genesis, None).unwrap();
    for h in 1..133 {
        s.add_block(&block_at(h), None, None).unwrap();
    }
    let good = block_at(133);
    assert!(s.judge(133, &good, None).0.failed().is_empty());
    let failed = |b: &<Blake2bV2 as HeaderFamily>::Block| s.judge(133, b, None).0.failed();
    let mut wrong_height = good.clone();
    wrong_height.header.height = 134;
    assert!(failed(&wrong_height).contains(&"knots:rule-header-height".to_string()));
    let mut flags = good.clone();
    flags.header.flags = 0x40;
    assert!(failed(&flags).contains(&"knots:rule-header-flags-reserved".to_string()));
    let mut count = good.clone();
    count.header.tx_count = 3;
    assert!(failed(&count).contains(&"knots:rule-block-txcount".to_string()));
    // the spend in 133 is signed with the unified sighash; a BIP 341 reading refuses it
    let tx = &good.txdata[1];
    let sig = &tx.input[0].witness[0];
    assert_eq!((sig.len(), sig[64]), (65, 0x21));
    let prevout = s.utxo()[&tx.input[0].previous_output].output.clone();
    assert!(
        sidestr_core::block::verify_key_path_input(tx, 0, std::slice::from_ref(&prevout)).is_err()
    );
    assert!(sidestr_core::sighash::verify_taproot_key_path(
        tx,
        0,
        &[prevout],
        sidestr_core::sighash::SighashRules::KnotsUnified
    )
    .is_ok());
    assert_eq!(block_height(&Blake2bV2, &good).unwrap(), 133);
    assert_eq!(solution_of(&good).unwrap().witness[0].len(), 64);
    assert_eq!(state.height(), SIDING_TIP_HEIGHT);
}

#[test]
fn blake2b_chain_produces_and_replays_with_unified_and_default_spends() {
    let key = signer("txbt4-producer");
    let me = challenge_for(&pubkey_of(&key));
    let you = challenge_for(&pubkey_of(&signer("you")));
    let doc = txbt4_doc("hdr-txbt4", &key, 1_000_000_000);
    let dir = TempDir::new("produce");
    let mut chain = ChainOf::<Blake2bV2>::open(doc.clone(), &dir.0, Some(&key)).unwrap();
    assert_eq!(chain.state().coins(&me)[0].value, 1_000_000_000);
    // the peg is a coinbase output: mature at 100, as on the live chain (first spend at 103)
    while chain.state().height() < 100 {
        chain.produce(&key, vec![]).unwrap();
    }
    let coin = chain.state().coins(&me)[0].clone();
    assert!(coin.coinbase && coin.height == 0);
    // a unified-sighash spend (as siding signs on this family) and a SIGHASH_DEFAULT one both enter the mempool
    let a = spend(
        &key,
        &coin,
        vec![
            pay(500_000_000, &you),
            pay(coin.value - 500_000_000 - 1_000, &me),
        ],
        0x21,
    );
    chain.submit(&serialize(&a)).unwrap();
    let r = chain.produce(&key, vec![]).unwrap();
    assert_eq!((r.height, r.txs, r.fees), (101, 2, 1_000));
    let coin = chain.state().coins(&you)[0].clone();
    let you_key = signer("you");
    let b = spend(&you_key, &coin, vec![pay(coin.value - 1_000, &me)], 0x00);
    chain.submit(&serialize(&b)).unwrap();
    // an undefined unified type is refused at the door, by the sighash rule and not for want of a coin
    let change = chain
        .state()
        .coins(&me)
        .into_iter()
        .find(|c| !c.coinbase)
        .unwrap();
    let bad = spend(&key, &change, vec![pay(change.value - 1_000, &you)], 0x24);
    let e = chain.submit(&serialize(&bad)).unwrap_err().to_string();
    assert!(e.contains("sighash type"), "{e}");
    chain.produce(&key, vec![]).unwrap();
    let tip = chain.state().tip();
    assert_eq!(tip.height, 102);
    // every header is the 164-byte v2 layout, hashed by the BLAKE2b pipeline, and carries its height
    let h = chain.state().header_at(102).unwrap();
    assert_eq!((h.height, h.tx_count, h.encode().len()), (102, 2, 164));
    assert_eq!(h.hash().to_string(), tip.hash.to_string());
    // a fresh validator, no key, replays the file to the same tip
    let again = ChainOf::<Blake2bV2>::open(doc.clone(), &dir.0, None).unwrap();
    assert_eq!(again.state().tip(), tip);
    // the stock family with a stock document from the same code path also produces
    let sdoc = {
        let mut d = doc.clone();
        d.parent = "tbtc4".into();
        d
    };
    let mut st = StateOf::<family::Stock>::with_key(sdoc, &key).unwrap();
    let (added, block) = st.produce(&key, &NextBlock::default(), None).unwrap();
    assert_eq!((added.height, block.encode().len() > 80), (1, true));
}

/// `SIDESTR_LIVE=1`: fetch Melvin's mirrors as they are now and replay each
/// to the tip its index announces. Needs the network; ignored otherwise.
#[test]
#[ignore = "set SIDESTR_LIVE=1: fetches https://melvin.me/public/{siding,melchain}/"]
fn blake2b_live_mirrors_replay_to_their_announced_tips() {
    if std::env::var("SIDESTR_LIVE").is_err() {
        eprintln!("skipped: SIDESTR_LIVE is not set");
        return;
    }
    for name in ["siding", "melchain"] {
        let dir = TempDir::new(&format!("live-{name}"));
        for f in ["chain.json", "blocks.json", "blocks.dat"] {
            let url = format!("https://melvin.me/public/{name}/{f}");
            let body = ureq::get(&url)
                .call()
                .unwrap_or_else(|e| panic!("{url}: {e}"))
                .body_mut()
                .with_config()
                .limit(64 << 20)
                .read_to_vec()
                .unwrap();
            std::fs::write(dir.0.join(f), body).unwrap();
        }
        let doc = doc_at(&dir.0);
        let chain = ChainOf::<Blake2bV2>::open(doc.clone(), &dir.0, None).unwrap();
        let last = chain.index().blocks.last().unwrap().clone();
        let tip = chain.state().tip();
        assert_eq!((tip.height, tip.hash.to_string()), (last.height, last.hash));
        eprintln!(
            "{}: replayed {} blocks to {} {}",
            doc.id,
            chain.index().blocks.len(),
            tip.height,
            tip.hash
        );
    }
}
