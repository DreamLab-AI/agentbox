//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22 (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2-gpt6-astra.md).

use bitcoin::hashes::Hash;
use bitcoin::secp256k1::{Keypair, Message, SecretKey};
use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::TapLeafHash;
use bitcoin::{Amount, Block, Network, ScriptBuf, Witness};
use proptest::prelude::*;
use sidestr_core::block::{
    block_data, commitment_output, decode_witness, encode_witness, key_from_hex, pubkey_of,
    seal_block, secp, solution_of, template_id, verify_block_solution, virtual_txs, with_solution,
    Stock,
};
use sidestr_core::federation::{partial_signature, Federation};
use sidestr_core::marker::{record_script, Burn};
use sidestr_core::parent::{checkpoint_payment, claimable, find_pegin, pegout_payment, FoundPegin};
use sidestr_core::{resolve_parent, ChainDocument, State};

fn fixture(rel: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(rel)
}
fn fed_doc() -> ChainDocument {
    ChainDocument::from_json(include_str!("../fixtures/fedtest/chain.json")).unwrap()
}
fn keys() -> Vec<SecretKey> {
    (1..=3)
        .map(|i| {
            key_from_hex(
                &std::fs::read_to_string(format!(
                    "{}/fixtures/fedtest/signer{i}.key",
                    env!("CARGO_MANIFEST_DIR")
                ))
                .unwrap(),
            )
            .unwrap()
        })
        .collect()
}
fn block() -> Block {
    State::build_genesis_for(&fed_doc()).unwrap()
}

#[test]
fn new_federation_negative_cases_and_identity() {
    let d = fed_doc();
    let k = keys();
    let f = Federation::for_document(&d).unwrap().unwrap();
    let b = block();
    let sig = |i: usize| {
        partial_signature(&Stock, &b, &f, &k[i], &[0; 32])
            .unwrap()
            .serialize()
            .to_vec()
    };
    let good = vec![
        vec![],
        sig(1),
        sig(0),
        f.script.to_bytes(),
        f.control_block.clone(),
    ];
    for name in [
        "same-signer-two-slots",
        "wrong-internal-key",
        "wrong-leaf-hash",
    ] {
        let mut w = good.clone();
        match name {
            "same-signer-two-slots" => w[1] = sig(0),
            "wrong-internal-key" => w[4][1..].copy_from_slice(&pubkey_of(&k[0]).serialize()),
            _ => {
                let v = virtual_txs(&block_data(&Stock, &b), &f.challenge(), &[]);
                let msg = SighashCache::new(&v.to_sign)
                    .taproot_signature_hash(
                        0,
                        &Prevouts::All(&[v.prevout]),
                        None,
                        Some((TapLeafHash::from_byte_array([3; 32]), u32::MAX)),
                        TapSighashType::Default,
                    )
                    .unwrap();
                w[2] = secp()
                    .sign_schnorr_with_aux_rand(
                        &Message::from_digest(msg.to_byte_array()),
                        &Keypair::from_secret_key(secp(), &k[0]),
                        &[0; 32],
                    )
                    .serialize()
                    .to_vec();
            }
        }
        let sealed = seal_block(&Stock, &b, &w).unwrap();
        let r = verify_block_solution(&Stock, &sealed, &f.challenge());
        println!("{name}: {r:?}");
        assert!(r.is_err());
    }
    for name in [
        "duplicate",
        "threshold-zero",
        "threshold-n-plus-one",
        "17-signers",
        "wrong-challenge",
    ] {
        let mut bad = d.clone();
        match name {
            "duplicate" => {
                bad.signers.as_mut().unwrap()[2] = bad.signers.as_ref().unwrap()[0].clone()
            }
            "threshold-zero" => bad.threshold = Some(0),
            "threshold-n-plus-one" => bad.threshold = Some(4),
            "17-signers" => {
                bad.signers = Some(
                    (1..=17)
                        .map(|i| pubkey_of(&SecretKey::from_slice(&[i; 32]).unwrap()).to_string())
                        .collect(),
                )
            }
            _ => bad.challenge = format!("5120{}", pubkey_of(&k[0])),
        }
        let r = bad.validate();
        println!("document {name}: {r:?}");
        assert!(r.is_err());
    }
    let a = seal_block(&Stock, &b, &good).unwrap();
    let other = vec![
        sig(2),
        vec![],
        sig(0),
        f.script.to_bytes(),
        f.control_block.clone(),
    ];
    let c = seal_block(&Stock, &b, &other).unwrap();
    assert!(verify_block_solution(&Stock, &a, &f.challenge()).is_ok());
    assert!(verify_block_solution(&Stock, &c, &f.challenge()).is_ok());
    let ia = template_id(&Stock, &a, &d.id, None).unwrap();
    let ic = template_id(&Stock, &c, &d.id, None).unwrap();
    println!(
        "subset[0,1] template={} sealed={}",
        hex::encode(ia),
        a.header.block_hash()
    );
    println!(
        "subset[0,2] template={} sealed={}",
        hex::encode(ic),
        c.header.block_hash()
    );
    assert_eq!(ia, ic, "review requires stable template identity");
    assert_ne!(a.header.block_hash(), c.header.block_hash());
}

#[test]
fn malformed_witness_and_push_boundaries() {
    for raw in [
        vec![],
        vec![0xfd],
        vec![0xfd, 0],
        vec![0xfe, 0, 0],
        vec![0xff],
        vec![8, 0],
        vec![1, 255],
        vec![1, 0xfe, 255, 255, 255, 255],
        vec![0, 1],
        vec![0xfd, 0, 0],
        vec![0xfd, 1, 1],
    ] {
        let r = decode_witness(&raw);
        println!("witness {} => {:?}", hex::encode(&raw), r);
        assert!(r.is_none());
    }
    let b = block();
    for payload in [75usize, 76, 255, 256] {
        let w = vec![vec![0x22; payload - 6]];
        let encoded = with_solution(&b, &w).unwrap();
        assert_eq!(solution_of(&encoded).unwrap().witness, w);
        let (index, script) = commitment_output(&encoded).unwrap();
        println!(
            "solution payload={payload} push prefix={}",
            hex::encode(&script.as_bytes()[38..41])
        );
        let mut bad = encoded.clone();
        let mut bytes = script.to_bytes();
        match payload {
            75 => bytes[38] += 1,
            76 | 255 => {
                bytes[39] = 255;
                if payload == 255 {
                    bytes.pop();
                }
            }
            _ => bytes[39] += 1,
        }
        bad.txdata[0].output[index].script_pubkey = ScriptBuf::from_bytes(bytes);
        assert!(solution_of(&bad).is_none());
        let mut trailing = encoded.clone();
        let mut bytes = script.to_bytes();
        bytes.push(0);
        trailing.txdata[0].output[index].script_pubkey = ScriptBuf::from_bytes(bytes);
        assert!(solution_of(&trailing).is_none());
        println!("payload={payload}: overclaimed length and trailing garbage refused");
    }
}
proptest! {
    #![proptest_config(ProptestConfig {cases:4096,failure_persistence:None,..ProptestConfig::default()})]
    #[test]
    fn witness_random_bytes_do_not_panic(raw in prop::collection::vec(any::<u8>(),0..2048)) {
        if let Some(items)=decode_witness(&raw) {prop_assert_eq!(encode_witness(&items),raw);}
    }
}

#[test]
fn parent_view_adversarial_inputs() {
    let d = fed_doc();
    let f = Federation::for_document(&d).unwrap().unwrap();
    let mut tx = block().txdata[0].clone();
    tx.input[0].witness = Witness::new();
    tx.output = vec![
        bitcoin::TxOut {
            value: Amount::from_sat(1),
            script_pubkey: f.challenge(),
        },
        bitcoin::TxOut {
            value: Amount::ZERO,
            script_pubkey: record_script(&format!(
                "pegin:{}:{}",
                d.id,
                f.challenge().to_hex_string()
            ))
            .unwrap(),
        },
    ];
    let valid = find_pegin(&tx, &d.id, 42, Some(Network::Testnet4)).unwrap();
    println!(
        "below dust=1sat discovery: amount={} vout={}",
        valid.amount, valid.vout
    );
    assert_eq!(valid.amount, 1);
    let mut nonreturn = tx.clone();
    let mut bytes = nonreturn.output[1].script_pubkey.to_bytes();
    bytes[0] = 0x51;
    nonreturn.output[1].script_pubkey = ScriptBuf::from_bytes(bytes);
    let r = find_pegin(&nonreturn, &d.id, 42, None);
    println!("marker not OP_RETURN: {r:?}");
    assert!(r.is_none());
    let r = find_pegin(&tx, "sidestr:other", 42, None);
    println!("marker for other chain: {r:?}");
    assert!(r.is_none());
    let mut two = tx.clone();
    two.output.push(bitcoin::TxOut {
        value: Amount::ZERO,
        script_pubkey: record_script(&format!("pegin:{}:51", d.id)).unwrap(),
    });
    let r = find_pegin(&two, &d.id, 42, None).unwrap();
    println!("two markers: selected first script={}", r.script);
    assert_eq!(r.script, f.challenge());
    let main = find_pegin(&tx, &d.id, 42, Some(Network::Bitcoin)).unwrap();
    println!(
        "same script: mainnet={} testnet={}",
        main.parent_address.unwrap(),
        valid.parent_address.unwrap()
    );
    let burn = Burn {
        txid: "11".repeat(32),
        vout: 0,
        script: "51".into(),
        value: 10000,
        height: 1,
    };
    let r = pegout_payment(&d.id, &burn, resolve_parent("tbtc4").unwrap());
    println!("nonstandard pegout: {r:?}");
    assert!(r.is_err());
    let r = checkpoint_payment(&"x".repeat(100), 1, &"00".repeat(32));
    println!("checkpoint >80: {r:?}");
    assert!(r.is_err());
}

#[test]
fn parent_confirmation_arithmetic_must_not_panic() {
    let p = FoundPegin {
        txid: "11".repeat(32),
        vout: 0,
        amount: 1,
        script: ScriptBuf::new(),
        height: u32::MAX,
        parent_address: None,
    };
    let r = std::panic::catch_unwind(|| claimable(&[p], u32::MAX, 6, |_, _| false));
    println!("claimable at max height panicked={}", r.is_err());
    assert!(r.is_ok());
}

/// Re-audit F1 (2026-09-22): `State::fees` summed untrusted output amounts
/// unchecked, so a transaction spending a known coin with outputs
/// `[u64::MAX, 1]` panicked with "attempt to add with overflow" at a public
/// boundary. Both the fee query and mempool admission must refuse, not panic.
#[test]
fn fees_and_submit_must_not_panic_on_overflowing_outputs() {
    let key = key_from_hex(&std::fs::read_to_string(fixture("trial/trial.key")).unwrap()).unwrap();
    let base =
        ChainDocument::from_json(&std::fs::read_to_string(fixture("trial/chain.json")).unwrap())
            .unwrap();
    let mut v = serde_json::to_value(&base).unwrap();
    v["pegs"] = serde_json::json!([{
        "txid": "00".repeat(32),
        "vout": 0,
        "amount": 100,
        "script": base.challenge
    }]);
    v.as_object_mut().unwrap().remove("genesisHash");
    let d = ChainDocument::from_json(&v.to_string()).unwrap();
    let g = State::genesis_block_for(&d, &key).unwrap();
    let mut s = State::from_genesis(d, &g, None).unwrap();
    let coinbase = &g.txdata[0];
    let mut tx = coinbase.clone();
    tx.input[0].previous_output = bitcoin::OutPoint {
        txid: coinbase.compute_txid(),
        vout: 0,
    };
    tx.output = vec![
        bitcoin::TxOut {
            value: Amount::from_sat(u64::MAX),
            script_pubkey: ScriptBuf::new(),
        },
        bitcoin::TxOut {
            value: Amount::from_sat(1),
            script_pubkey: ScriptBuf::new(),
        },
    ];
    assert_eq!(
        s.utxo()
            .get(&tx.input[0].previous_output)
            .map(|c| c.output.value.to_sat()),
        Some(100)
    );
    let fees = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.fees(&tx)));
    println!("fees with outputs [MAX, 1] on a 100-sat coin: {fees:?}");
    assert_eq!(
        fees.ok(),
        Some(None),
        "fees must return None without panicking"
    );
    let submitted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.submit(tx.clone())));
    println!(
        "submit of the same transaction: {:?}",
        submitted.as_ref().map(|r| r.is_err())
    );
    assert!(
        matches!(submitted, Ok(Err(_))),
        "submit must refuse without panicking"
    );
    // the same outputs on a coinless input: a non-coin input answers None before any sum
    let mut orphan = tx.clone();
    orphan.input[0].previous_output.vout = 7;
    assert_eq!(s.fees(&orphan), None);
    // an output total that overflows only across outputs, all under max money individually
    let mut spread = tx;
    let half = 1u64 << 63;
    spread.output = (0..3)
        .map(|_| bitcoin::TxOut {
            value: Amount::from_sat(half),
            script_pubkey: ScriptBuf::new(),
        })
        .collect();
    assert_eq!(s.fees(&spread), None);
    assert!(s.submit(spread).is_err());
}

#[test]
fn genesis_without_solution_must_not_validate() {
    let mut d = fed_doc();
    let g = block();
    d.genesis_hash = Some(g.header.block_hash().to_string());
    println!("unsigned genesis solution={:?}", solution_of(&g));
    let r = State::from_genesis(d, &g, None).map(|s| (s.height(), s.utxo().len()));
    println!("unsigned genesis with matching document hash: {r:?}");
    assert!(r.is_err());
}

#[test]
fn departures_execute_at_the_boundary() {
    let mut d = ChainDocument::from_json(include_str!("../fixtures/trial/chain.json")).unwrap();
    let k = key_from_hex(include_str!("../fixtures/trial/trial.key")).unwrap();
    for name in ["assets", "pool", "evm"] {
        let mut bad = d.clone();
        bad.rules = Some(vec![name.into()]);
        let r = bad.validate();
        println!("unsupported overlay {name}: {r:?}");
        assert!(r.is_err());
    }
    assert_eq!(
        sidestr_core::marker::record_text(&ScriptBuf::from_hex("6a0261").unwrap()),
        None
    );
    println!("record_text(6a0261)=None; JS receipt parent_oracle returns a");
    d.genesis_hash = None;
    let mut s = State::with_key(d.clone(), &k).unwrap();
    let claims = vec![sidestr_core::state::ClaimRequest {
        txid: "33".repeat(32),
        vout: 0,
        amount: 10000,
        script: d.challenge_script().unwrap(),
    }];
    let req = sidestr_core::state::NextBlock {
        time: s.tip().time + 1,
        claims,
    };
    let (unsigned, _, _) = s.build_next(&req).unwrap();
    let good = sidestr_core::block::sign_block(
        &Stock,
        &unsigned,
        &d.challenge_script().unwrap(),
        &k,
        &[0; 32],
    )
    .unwrap();
    let mut bad = good.clone();
    let i = solution_of(&bad).unwrap().index;
    let mut spk = bad.txdata[0].output[i].script_pubkey.to_bytes();
    let n = spk.len();
    spk[n - 1] ^= 1;
    bad.txdata[0].output[i].script_pubkey = ScriptBuf::from_bytes(spk);
    let r = s.add_block(&bad, None, Some(good.header.time));
    assert!(r.is_err());
    assert!(!s.claimed(&"33".repeat(32), 0));
    println!("failed claim candidate: {r:?}; claim remains unrecorded");
    s.add_block(&good, None, Some(good.header.time)).unwrap();
    assert!(s.claimed(&"33".repeat(32), 0));
    println!("valid retry accepted; claim committed");
    let req = sidestr_core::state::NextBlock {
        time: s.tip().time + 1,
        claims: vec![],
    };
    let mut twin = State::with_key(d, &k).unwrap();
    twin.add_block(&good, None, Some(good.header.time)).unwrap();
    let (_, a) = s.produce(&k, &req, None).unwrap();
    let (_, b) = twin.produce(&k, &req, None).unwrap();
    assert_eq!(a, b);
    println!("identical state/key/next-block inputs produced identical blocks");
}
