//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22 (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2-gpt6-astra.md).

mod common;

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
use sidestr_core::marker::{
    looks_like_pegout, op_return_data, parse_pegout, pegout_marker, record_script, record_text,
    Burn,
};
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

/// An `OP_RETURN` whose push prefix is exactly `prefix`, then `data`; the
/// length is the caller's to get right or wrong.
fn op_return_raw(prefix: &[u8], data: &[u8]) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x6a][..], prefix, data].concat())
}

/// The reference engine over a directory, when the checkouts are named;
/// `None` when they are not (the pure half of a test still runs).
fn reference(
    cmd: &str,
    chain_file: &std::path::Path,
    dir: &std::path::Path,
    extra: Option<&std::path::Path>,
) -> Option<serde_json::Value> {
    if ["SIDESTR_SIDING", "SCHEMA", "BLAKETESTNODE"]
        .iter()
        .any(|v| std::env::var(v).is_err())
    {
        eprintln!(
            "skipped the reference cross-check: set SIDESTR_SIDING, SCHEMA and BLAKETESTNODE"
        );
        return None;
    }
    let mut c = std::process::Command::new("node");
    c.arg(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/xcheck.mjs"))
        .arg(cmd)
        .arg(chain_file)
        .arg(dir);
    if let Some(e) = extra {
        c.arg(e);
    }
    let out = c.output().expect("node");
    assert!(
        out.status.success(),
        "reference engine failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Some(serde_json::from_slice(&out.stdout).expect("json from the reference engine"))
}

/// Re-audit F2 (2026-09-22, found by running the reference beside sidestr-round):
/// a burn whose marker needs `OP_PUSHDATA1` (a parent script of 35 to 40
/// bytes: 77 to 87 bytes of payload) was **silently not recorded** by the
/// burn rule, because `looks_like_pegout` read the `pegout:` prefix at byte 2,
/// where a direct push's data starts, and the rule `continue`d past any
/// output it did not recognise. The reference (`overlay.mjs`
/// `sidestr:rule-pegouts`) decodes the push first and then looks for the
/// prefix, so it recorded the burn — and it also *refused* a block whose
/// `OP_PUSHDATA1` marker starts `pegout:` but does not parse, where this port
/// accepted it. Neither engine failed loudly: the divergence surfaced as an
/// unpaid burn. This test pins every push form the reference accepts against
/// the reference itself, when the checkouts are named.
#[test]
fn pushdata1_burns_are_recorded_and_refused_exactly_as_the_reference() {
    use common::*;
    let key = signer("pushdata");
    let me = challenge(&key);
    let mut doc = doc(
        "pushdata",
        &key,
        vec![("a".repeat(64), 0, 5_000_000_000, me.clone())],
    );
    let dir = TempDir::new("pushdata");
    let mut chain = open(&doc, &dir, &key);
    doc.genesis_hash = Some(chain.state().genesis_hash().to_string());
    let chain_file = dir.0.join("chain.json");
    std::fs::write(&chain_file, serde_json::to_string(&doc).unwrap()).unwrap();
    produce_to(&mut chain, &key, 101);

    // the five push forms a burn may arrive in
    let s34 = format!("5120{}", "e9".repeat(32)); // 75-byte payload: direct push 0x4b
    let s35 = "ab".repeat(35); // 77 bytes: OP_PUSHDATA1 0x4d
    let s40 = "ef".repeat(40); // 87 bytes: OP_PUSHDATA1 0x57 (the largest burn)
    let m34 = pegout_marker(&s34);
    let m35 = pegout_marker(&s35);
    let m40 = pegout_marker(&s40);
    assert!(
        m34.to_hex_string().starts_with("6a4b")
            && m35.to_hex_string().starts_with("6a4c4d")
            && m40.to_hex_string().starts_with("6a4c57")
    );
    // the reference's own `pegoutMarker` writes the length as a bare byte even above 75: for a
    // 40-byte script that is `6a 57 …`, OP_7 to Bitcoin, yet its `opReturnData` reads it back
    let bare40 = op_return_raw(&[0x57], format!("pegout:{}", "cd".repeat(40)).as_bytes());
    // and its `opReturnData` takes a non-minimal OP_PUSHDATA1 for a short payload as well
    let nonmin = op_return_raw(&[0x4c, 0x0b], b"pegout:abcd");
    for m in [&m34, &m35, &m40, &bare40, &nonmin] {
        assert!(
            looks_like_pegout(&bitcoin::TxOut {
                value: Amount::ZERO,
                script_pubkey: m.clone()
            }),
            "{m}"
        );
        assert!(parse_pegout(m).is_some(), "{m}");
    }
    let coin = mature_coin(chain.state(), &key);
    let burn = spend(
        &key,
        &coin,
        vec![
            pay(20_000, &m34),
            pay(20_000, &m35),
            pay(20_000, &m40),
            pay(20_000, &bare40),
            pay(20_000, &nonmin),
            pay(coin.value - 100_000 - 2_000, &me),
        ],
    );
    let txid = burn.compute_txid().to_string();
    chain
        .submit(&bitcoin::consensus::encode::serialize(&burn))
        .unwrap();
    let r = chain.produce(&key, vec![]).unwrap();
    assert_eq!(r.txs, 2);
    let ours = chain.state().pegouts();
    let expect: Vec<Burn> = [
        s34.as_str(),
        s35.as_str(),
        s40.as_str(),
        &"cd".repeat(40),
        "abcd",
    ]
    .iter()
    .enumerate()
    .map(|(vout, script)| Burn {
        txid: txid.clone(),
        vout: vout as u32,
        script: script.to_string(),
        value: 20_000,
        height: r.height,
    })
    .collect();
    println!(
        "rust pegouts after the block: {:?}",
        ours.iter()
            .map(|b| (b.vout, b.script.len() / 2))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        ours, expect,
        "every push form the reference accepts is recorded"
    );
    if let Some(v) = reference("replay", &chain_file, &dir.0, None) {
        assert_eq!(v["height"], r.height, "{v}");
        let theirs: Vec<Burn> = v["pegouts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| Burn {
                txid: b["txid"].as_str().unwrap().to_string(),
                vout: b["vout"].as_u64().unwrap() as u32,
                script: b["script"].as_str().unwrap().to_string(),
                value: b["value"].as_u64().unwrap(),
                height: b["height"].as_u64().unwrap() as u32,
            })
            .collect();
        println!(
            "js pegouts after the block: {:?}",
            theirs
                .iter()
                .map(|b| (b.vout, b.script.len() / 2))
                .collect::<Vec<_>>()
        );
        assert_eq!(theirs, ours, "the reference records the same burns");
    }

    // a marker that starts `pegout:` in OP_PUSHDATA1 form but does not parse (76 bytes: odd hex)
    // refuses the block by name in both engines
    let coin = mature_coin(chain.state(), &key);
    let malformed = op_return_raw(
        &[0x4c, 0x4c],
        format!("pegout:{}", "a".repeat(69)).as_bytes(),
    );
    assert_eq!(op_return_data(&malformed).map(<[u8]>::len), Some(76));
    assert!(looks_like_pegout(&bitcoin::TxOut {
        value: Amount::ZERO,
        script_pubkey: malformed.clone()
    }));
    assert!(parse_pegout(&malformed).is_none());
    let bad = spend(
        &key,
        &coin,
        vec![pay(20_000, &malformed), pay(coin.value - 21_000, &me)],
    );
    let bytes = hand_block(chain.state(), &key, vec![pay(1_000, &me)], vec![bad]);
    let verdict = chain.add_block(&bytes, None);
    println!("rust verdict on the malformed OP_PUSHDATA1 burn: {verdict:?}");
    assert!(
        matches!(&verdict, Err(sidestr_core::Error::Rejected { rules, .. }) if rules.contains(&"sidestr:rule-pegouts".to_string())),
        "a pegout: marker that does not parse refuses the block: {verdict:?}"
    );
    let hex_file = dir.0.join("malformed.hex");
    std::fs::write(&hex_file, hex::encode(&bytes)).unwrap();
    if let Some(v) = reference("add", &chain_file, &dir.0, Some(&hex_file)) {
        println!(
            "js verdict on the malformed OP_PUSHDATA1 burn: {}",
            v["verdict"]
        );
        assert_eq!(v["verdict"]["ok"], false, "{v}");
        assert!(
            v["verdict"]["error"]
                .as_str()
                .unwrap()
                .contains("sidestr:rule-pegouts"),
            "{v}"
        );
        assert_eq!(v["height"], r.height);
    }
    assert_eq!(
        chain.state().height(),
        r.height,
        "the refused block left no trace"
    );
}

/// The push boundaries of the marker grammar, form by form: what the
/// reference's `opReturnData` and `recordText` accept, and so what this port
/// accepts — including the forms Bitcoin would not call a push (see the
/// crate's departures).
#[test]
fn op_return_push_boundaries_match_the_reference() {
    let payload = |n: usize| "x".repeat(n).into_bytes();
    let direct = |n: usize| op_return_raw(&[n as u8], &payload(n));
    let pushdata1 = |n: usize| op_return_raw(&[0x4c, n as u8], &payload(n));
    // direct: the byte is a length, whatever opcode it would be to Bitcoin (0x4c is the one exception)
    for n in [0usize, 1, 75, 77, 80, 87, 255] {
        assert_eq!(
            op_return_data(&direct(n)).map(<[u8]>::len),
            Some(n),
            "direct {n}"
        );
    }
    assert_eq!(
        op_return_data(&direct(76)),
        None,
        "a bare 0x4c is read as OP_PUSHDATA1, as the reference reads it"
    );
    // OP_PUSHDATA1: any length 0..=255, minimal or not
    for n in [0usize, 1, 75, 76, 80, 81, 255] {
        assert_eq!(
            op_return_data(&pushdata1(n)).map(<[u8]>::len),
            Some(n),
            "pushdata1 {n}"
        );
    }
    // length and data disagree; a second push; OP_PUSHDATA2; not OP_RETURN
    assert_eq!(op_return_data(&op_return_raw(&[0x02], b"abc")), None);
    assert_eq!(op_return_data(&op_return_raw(&[0x02], b"a")), None);
    assert_eq!(
        op_return_data(&ScriptBuf::from_bytes(vec![0x6a, 0x01, 0x41, 0x01, 0x42])),
        None
    );
    assert_eq!(
        op_return_data(&op_return_raw(&[0x4d, 0x01, 0x00], b"a")),
        None
    );
    assert_eq!(op_return_data(&op_return_raw(&[0x4c], b"")), None);
    assert_eq!(op_return_data(&ScriptBuf::from_bytes(vec![0x6a])), None);
    assert_eq!(
        op_return_data(&ScriptBuf::from_bytes(vec![0x51, 0x01, 0x41])),
        None
    );
    // records (SPEC 12.1) are stricter: minimal only, at most 255
    assert_eq!(record_text(&direct(75)).map(|t| t.len()), Some(75));
    assert_eq!(record_text(&pushdata1(76)).map(|t| t.len()), Some(76));
    assert_eq!(record_text(&pushdata1(255)).map(|t| t.len()), Some(255));
    assert_eq!(
        record_text(&direct(77)),
        None,
        "a bare length byte above 75 is not a record"
    );
    assert_eq!(
        record_text(&pushdata1(75)),
        None,
        "a non-minimal OP_PUSHDATA1 is not a record"
    );
    // the burn grammar on top: 2..=40 bytes of lower hex, so payloads of 11..=87 bytes, odd only
    for n in [2usize, 34, 35, 40] {
        assert!(
            parse_pegout(&pegout_marker(&"ab".repeat(n))).is_some(),
            "{n} bytes"
        );
    }
    for n in [0usize, 1, 41, 100] {
        assert!(
            parse_pegout(&pegout_marker(&"ab".repeat(n))).is_none(),
            "{n} bytes"
        );
    }
    assert!(
        parse_pegout(&op_return_raw(
            &[0x4c, 0x57],
            format!("pegout:{}", "AB".repeat(40)).as_bytes()
        ))
        .is_none(),
        "upper hex"
    );
    assert!(
        parse_pegout(&op_return_raw(
            &[0x4c, 0x50],
            format!("pegout:{}", "a".repeat(73)).as_bytes()
        ))
        .is_none(),
        "80 bytes, odd hex"
    );
    // looks-like follows the decoded payload, not byte 2
    let out = |s: &ScriptBuf| bitcoin::TxOut {
        value: Amount::ZERO,
        script_pubkey: s.clone(),
    };
    assert!(looks_like_pegout(&out(&op_return_raw(
        &[0x4c, 0x4c],
        format!("pegout:{}", "a".repeat(69)).as_bytes()
    ))));
    assert!(looks_like_pegout(&out(&op_return_raw(
        &[0x0a],
        b"pegout:zzz"
    ))));
    assert!(
        !looks_like_pegout(&out(&op_return_raw(&[0x4c, 0x0b], b"pegout:zzz"))),
        "length and data disagree: not even a push"
    );
    assert!(!looks_like_pegout(&out(&op_return_raw(&[0x05], b"claim"))));
}
