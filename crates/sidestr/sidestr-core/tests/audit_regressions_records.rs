//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22 (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2.1-gpt6-astra.md).
//!
//! The auditor's probe (`audit_independent.rs`) *printed* what each engine
//! derived from identical bytes and left the discrepancies in the report;
//! this file keeps its corpus and asserts the corrected behaviour:
//!
//! - **F1** — a leading UTF-8 byte-order mark is dropped exactly where the
//!   reference text-decodes (burn recognition and parsing, claims, the
//!   peg-in remainder's hex-form decision, records) and nowhere else. The
//!   `bom-*`, `badbom-*`, `bomclaim-*` and `peginbom-*` cases pin the
//!   recorded lists and the named rules.
//! - **F3** — `try_claim_marker` and `try_pegout_marker` refuse what the
//!   parsers would not read back; the unchecked constructors never truncate.
//! - the differential itself: with the reference checkouts named
//!   (`SIDESTR_SIDING`, `SCHEMA`, `BLAKETESTNODE`, run through
//!   `tests/xcheck.mjs markers|blocks`) every marker case derives the same
//!   data, burn, peg-in, claim and checkpoint in both engines, and every
//!   block yields the same verdict, burn list and claim membership. Records
//!   differ only by the documented length-check departure (**F2**): the
//!   reference reads text past a push whose length is wrong or not minimal;
//!   this port returns `None` there.
//!
//! F4 (the wallet's parent record) is pinned in `sidestr-wallet`.

mod common;

use bitcoin::{consensus::deserialize, Block, ScriptBuf, Transaction, TxOut};
use common::*;
use serde_json::{json, Value};
use sidestr_core::marker::*;
use sidestr_core::parent::find_pegin;
use sidestr_core::{ChainDocument, State};

const BOM: &[u8] = b"\xef\xbb\xbf";

fn raw(prefix: &[u8], data: &[u8]) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x6a], prefix, data].concat())
}

/// The five push forms the auditor ran every payload through: a bare
/// length, `OP_PUSHDATA1`, `OP_PUSHDATA2` (outside the marker grammar), a
/// length one too many, and a second push after the first.
fn forms(data: &[u8]) -> Vec<(&'static str, ScriptBuf)> {
    vec![
        ("bare", raw(&[data.len() as u8], data)),
        ("p1", raw(&[0x4c, data.len() as u8], data)),
        ("p2", raw(&[0x4d, data.len() as u8, 0], data)),
        ("mismatch", raw(&[(data.len() + 1) as u8], data)),
        (
            "two",
            ScriptBuf::from_bytes(
                [raw(&[data.len() as u8], data).to_bytes(), vec![1, 65]].concat(),
            ),
        ),
    ]
}

/// The auditor's 101-case marker corpus for a chain `d` paying `me`.
fn corpus(d: &ChainDocument, me: &ScriptBuf) -> Vec<(String, ScriptBuf)> {
    let claim = format!("claim:{}:0", "b".repeat(64)).into_bytes();
    let mut scripts = vec![];
    for (name, data) in [
        ("peg34", format!("pegout:{}", "ab".repeat(34)).into_bytes()),
        ("peg35", format!("pegout:{}", "ab".repeat(35)).into_bytes()),
        ("peg40", format!("pegout:{}", "ab".repeat(40)).into_bytes()),
        ("peg41", format!("pegout:{}", "ab".repeat(41)).into_bytes()),
        ("odd", b"pegout:abcde".to_vec()),
        ("empty", b"pegout:".to_vec()),
        ("ff", [b"pegout:".to_vec(), vec![b'a'; 248]].concat()),
        (
            "pegin",
            format!("pegin:{}:{}", d.id, me.to_hex_string()).into_bytes(),
        ),
        ("peginraw", peg_marker_data(&d.id, me)),
        (
            "peginbom",
            [
                format!("pegin:{}:", d.id).into_bytes(),
                BOM.to_vec(),
                b"abcd".to_vec(),
            ]
            .concat(),
        ),
        ("claim", claim.clone()),
        (
            "ckpt",
            checkpoint_data(&d.id, 70000, &"d".repeat(64)).unwrap(),
        ),
        ("text", b"hello".to_vec()),
        ("bomclaim", [BOM.to_vec(), claim.clone()].concat()),
        ("badbom", [BOM.to_vec(), b"pegout:abcde".to_vec()].concat()),
        ("newline", b"pegout:abcd\n".to_vec()),
        ("newlineclaim", [claim, b"\n".to_vec()].concat()),
        ("text76", vec![b'x'; 76]),
        ("text255", vec![b'x'; 255]),
        ("bom", [BOM.to_vec(), b"pegout:abcd".to_vec()].concat()),
    ] {
        for (f, s) in forms(&data) {
            scripts.push((format!("{name}-{f}"), s));
        }
    }
    scripts.push((
        "bare-text".into(),
        ScriptBuf::from_bytes(b"pegout:".to_vec()),
    ));
    assert_eq!(scripts.len(), 101);
    scripts
}

/// A parent transaction paying `me` at output 0 with `marker` at output 1,
/// as the auditor's in-memory parent presents it to both engines.
fn parent_tx(d: &ChainDocument, me: &ScriptBuf, marker: &ScriptBuf) -> Transaction {
    let mut tx = State::build_genesis_for(d).unwrap().txdata[0].clone();
    tx.output = vec![pay(100000, me), pay(0, marker)];
    tx
}

fn pick<'a>(scripts: &'a [(String, ScriptBuf)], name: &str) -> &'a ScriptBuf {
    &scripts.iter().find(|(n, _)| n == name).unwrap().1
}

fn burn_list(s: &State) -> Value {
    json!(s
        .pegouts()
        .iter()
        .map(|b| json!({"txid":b.txid,"vout":b.vout,"value":b.value,"script":b.script,"height":b.height}))
        .collect::<Vec<_>>())
}

/// Everything this port derives from one marker script, in the shape
/// `xcheck.mjs markers` reports for the reference.
fn derived(d: &ChainDocument, me: &ScriptBuf, name: &str, s: &ScriptBuf) -> Value {
    let tx = parent_tx(d, me, s);
    let (claims, errors) = parse_claims(&tx);
    let pegin = find_pegin(&tx, &d.id, 42, None).map(|p| {
        json!({"txid":p.txid,"vout":p.vout,"amount":p.amount,"script":p.script.to_hex_string(),"height":p.height,"parentAddress":p.parent_address})
    });
    json!({
        "name": name,
        "data": op_return_data(s).map(hex::encode),
        "pegout": parse_pegout(s),
        "record": record_text(s),
        "pegin": pegin.into_iter().collect::<Vec<_>>(),
        "claim": {
            "claims": claims.iter().map(|c| json!({"index":c.index,"txid":c.txid,"vout":c.vout,"payout":{"index":c.payout.index,"value":c.payout.value,"scriptPubKey":c.payout.script_pubkey.to_hex_string()}})).collect::<Vec<_>>(),
            "errors": errors,
        },
        "ckpt": parse_checkpoint(s, &d.id).map(|(height, hash)| json!({"height":height,"hash":hash})),
    })
}

/// The reference engine through `tests/xcheck.mjs`, when the checkouts are
/// named; `None` when they are not (the Rust half of a test still runs).
fn reference(
    cmd: &str,
    chain_file: &std::path::Path,
    dir: &std::path::Path,
    extra: &std::path::Path,
) -> Option<Value> {
    if ["SIDESTR_SIDING", "SCHEMA", "BLAKETESTNODE"]
        .iter()
        .any(|v| std::env::var(v).is_err())
    {
        eprintln!(
            "skipped the reference cross-check: set SIDESTR_SIDING, SCHEMA and BLAKETESTNODE"
        );
        return None;
    }
    let out = std::process::Command::new("node")
        .arg(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/xcheck.mjs"))
        .arg(cmd)
        .arg(chain_file)
        .arg(dir)
        .arg(extra)
        .output()
        .expect("node");
    assert!(
        out.status.success(),
        "reference engine failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Some(serde_json::from_slice(&out.stdout).expect("json from the reference engine"))
}

/// F1, burns: `EF BB BF pegout:abcd` names `abcd` in both push forms the
/// grammar reads; `EF BB BF pegout:abcde` looks like a burn and does not
/// parse, so the rule refuses it; a second BOM is text.
#[test]
fn bom_burns_parse_as_the_reference_parses_them() {
    let out = |s: &ScriptBuf| TxOut {
        value: bitcoin::Amount::from_sat(20000),
        script_pubkey: s.clone(),
    };
    let good = [BOM, b"pegout:abcd"].concat();
    let bad = [BOM, b"pegout:abcde"].concat();
    for (form, s) in forms(&good) {
        match form {
            "bare" | "p1" => {
                assert_eq!(parse_pegout(&s).as_deref(), Some("abcd"), "{form}");
                assert!(looks_like_pegout(&out(&s)), "{form}");
            }
            _ => {
                assert!(
                    parse_pegout(&s).is_none() && !looks_like_pegout(&out(&s)),
                    "{form}"
                );
            }
        }
    }
    for (form, s) in forms(&bad) {
        assert!(parse_pegout(&s).is_none(), "{form}");
        assert_eq!(
            looks_like_pegout(&out(&s)),
            matches!(form, "bare" | "p1"),
            "{form}"
        );
    }
    let twice = raw(&[17], &[BOM, BOM, b"pegout:abcd"].concat());
    assert!(!looks_like_pegout(&out(&twice)) && parse_pegout(&twice).is_none());
    // the recorded list, not just the parse
    let tx = Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: bitcoin::absolute::LockTime::ZERO,
        input: vec![],
        output: vec![out(&raw(&[14], &good)), out(&raw(&[0x4c, 14], &good))],
    };
    let burns = parse_pegouts(&tx, &"1".repeat(64), 9);
    assert_eq!(burns.len(), 2);
    assert!(burns
        .iter()
        .all(|b| b.script == "abcd" && b.value == 20000 && b.height == 9));
    assert_eq!((burns[0].vout, burns[1].vout), (0, 1));
}

/// F1, claims: `EF BB BF claim:<txid>:0` is the claim `<txid>:0`.
#[test]
fn bom_claims_parse_as_the_reference_parses_them() {
    let key = signer("bomclaim");
    let me = challenge(&key);
    let d = doc("bomclaim", &key, vec![]);
    let peg = "b".repeat(64);
    let data = [BOM, format!("claim:{peg}:0").as_bytes()].concat();
    for (form, s) in forms(&data) {
        let (claims, errors) = parse_claims(&parent_tx(&d, &me, &s));
        assert!(errors.is_empty(), "{form}");
        if matches!(form, "bare" | "p1") {
            assert_eq!(claims.len(), 1, "{form}");
            assert_eq!(
                (claims[0].txid.as_str(), claims[0].vout, claims[0].index),
                (peg.as_str(), 0, 1)
            );
            assert_eq!(claims[0].payout.script_pubkey, me);
        } else {
            assert!(claims.is_empty(), "{form}");
        }
    }
}

/// F1, peg-ins: `pegin:<id>:` + `EF BB BF` + `abcd` names the script `abcd`
/// (the BOM is dropped for the hex-form decision), so both engines derive
/// the same payout script from one parent transaction; a raw remainder
/// keeps every byte.
#[test]
fn bom_pegins_name_the_script_the_reference_names() {
    let key = signer("bompegin");
    let me = challenge(&key);
    let d = doc("bompegin", &key, vec![]);
    let data = [format!("pegin:{}:", d.id).as_bytes(), BOM, b"abcd"].concat();
    for (form, s) in forms(&data) {
        let found = find_pegin(&parent_tx(&d, &me, &s), &d.id, 42, None);
        if matches!(form, "bare" | "p1") {
            let p = found.expect(form);
            assert_eq!(p.script.to_hex_string(), "abcd", "{form}");
            assert_eq!((p.vout, p.amount, p.height), (0, 100000, 42));
        } else {
            assert!(found.is_none(), "{form}");
        }
    }
    let rawform = [format!("pegin:{}:", d.id).as_bytes(), BOM, b"abc"].concat();
    let p = find_pegin(
        &parent_tx(&d, &me, &raw(&[rawform.len() as u8], &rawform)),
        &d.id,
        42,
        None,
    )
    .unwrap();
    assert_eq!(p.script.to_hex_string(), "efbbbf616263");
}

/// F1, records: `recordText` drops a leading BOM; the strict length check
/// (F2) stays.
#[test]
fn bom_records_read_as_the_reference_reads_them() {
    for (form, s) in forms(&[BOM, b"hello"].concat()) {
        assert_eq!(
            record_text(&s).as_deref(),
            if form == "bare" { Some("hello") } else { None },
            "{form}"
        );
    }
    let long = [BOM, &[b'x'; 100][..]].concat();
    assert_eq!(
        record_text(&raw(&[0x4c, 103], &long)).as_deref(),
        Some("x".repeat(100).as_str())
    );
    assert_eq!(record_text(&raw(&[0x4c, 104], &long)), None); // F2: length wrong
    assert_eq!(
        record_text(&record_script("hello").unwrap()).as_deref(),
        Some("hello")
    );
}

/// F3: the checked constructors refuse what the parsers would not read
/// back; the unchecked ones are documented as such and never truncate.
#[test]
fn encoder_bounds() {
    for n in [0usize, 75, 76, 255] {
        let s = record_script(&"x".repeat(n)).unwrap();
        assert_eq!(record_text(&s).as_deref(), Some("x".repeat(n).as_str()));
    }
    assert!(record_script(&"x".repeat(256)).is_err());
    let key = signer("bounds");
    let d = doc("bounds", &key, vec![]);
    let one = ScriptBuf::from_hex("51").unwrap();
    for n in [99_999u32, 100_000, u32::MAX] {
        let checked = try_claim_marker(&"a".repeat(64), n);
        let s = claim_marker(&"a".repeat(64), n);
        let parsed = parse_claims(&parent_tx(&d, &one, &s)).0.len();
        if n <= CLAIM_VOUT_MAX {
            assert_eq!(checked.unwrap(), s);
            assert_eq!(parsed, 1);
        } else {
            assert!(checked.is_err(), "vout {n}");
            assert_eq!(parsed, 0, "vout {n}");
        }
    }
    for n in [40usize, 125] {
        let s = pegout_marker(&"ab".repeat(n));
        let checked = try_pegout_marker(&"ab".repeat(n));
        if n <= 40 {
            assert_eq!(checked.unwrap(), s);
            assert!(op_return_data(&s).is_some() && parse_pegout(&s).is_some());
        } else {
            assert!(checked.is_err());
            // 257 bytes: a whole OP_PUSHDATA2 push, not `4c 01`
            assert_eq!(&s.as_bytes()[..4], &[0x6a, 0x4d, 0x01, 0x01]);
            assert!(op_return_data(&s).is_none() && parse_pegout(&s).is_none());
        }
    }
}

/// The auditor's differential, asserted: identical block bytes yield
/// identical verdicts, burn lists and claim membership in both engines,
/// the BOM corpus included; and every marker case derives the same lists,
/// records excepted only where F2 says so.
#[test]
fn identical_bytes_derive_identical_records_in_both_engines() {
    let key = signer("independent");
    let me = challenge(&key);
    let mut d = doc(
        "independent",
        &key,
        vec![("a".repeat(64), 0, 5_000_000_000, me.clone())],
    );
    let dir = TempDir::new("records");
    let base = dir.0.join("baseline");
    let mut chain = sidestr_core::chain::Chain::open(d.clone(), &base, Some(&key)).unwrap();
    produce_to(&mut chain, &key, 101);
    d.genesis_hash = Some(chain.state().genesis_hash().to_string());
    let chain_file = base.join("chain.json");
    std::fs::write(&chain_file, serde_json::to_vec(&d).unwrap()).unwrap();
    let scripts = corpus(&d, &me);

    // --- the marker parsers ---------------------------------------------
    let ours: Vec<Value> = scripts
        .iter()
        .map(|(name, s)| derived(&d, &me, name, s))
        .collect();
    // F1 pinned without the reference
    let by = |n: &str| ours.iter().find(|v| v["name"] == n).unwrap();
    for n in ["bom-bare", "bom-p1"] {
        assert_eq!(by(n)["pegout"], json!("abcd"), "{n}");
    }
    for n in ["badbom-bare", "badbom-p1"] {
        assert_eq!(by(n)["pegout"], Value::Null, "{n}");
    }
    for n in ["bomclaim-bare", "bomclaim-p1"] {
        assert_eq!(
            by(n)["claim"]["claims"][0]["txid"],
            json!("b".repeat(64)),
            "{n}"
        );
    }
    for n in ["peginbom-bare", "peginbom-p1"] {
        assert_eq!(by(n)["pegin"][0]["script"], json!("abcd"), "{n}");
    }
    assert_eq!(by("bom-bare")["record"], json!("pegout:abcd"));
    assert_eq!(
        by("bomclaim-bare")["record"],
        json!(format!("claim:{}:0", "b".repeat(64)))
    );

    let inputs: Vec<Value> = scripts
        .iter()
        .map(|(name, s)| {
            json!({"name":name,"hex":s.to_hex_string(),"id":d.id,"pay":me.to_hex_string(),"txid":parent_tx(&d, &me, s).compute_txid().to_string()})
        })
        .collect();
    let markers_file = dir.0.join("markers.json");
    std::fs::write(&markers_file, serde_json::to_vec(&inputs).unwrap()).unwrap();
    if let Some(theirs) = reference(
        "markers",
        &chain_file,
        &dir.0.join("markers-dir"),
        &markers_file,
    ) {
        let theirs = theirs.as_array().unwrap();
        assert_eq!(theirs.len(), ours.len());
        let mut f2 = vec![];
        for (a, b) in ours.iter().zip(theirs) {
            assert_eq!(a["name"], b["name"]);
            let name = a["name"].as_str().unwrap();
            for field in ["data", "pegout", "pegin", "claim", "ckpt"] {
                assert_eq!(
                    a[field], b[field],
                    "{name} {field}: rust={} js={}",
                    a[field], b[field]
                );
            }
            if a["record"] != b["record"] {
                // F2, the documented departure: the reference reads text past
                // a push whose length is wrong or not minimal; this port
                // returns None. Nothing else may differ.
                let departure = a["record"].is_null()
                    && (name.ends_with("-mismatch")
                        || name.ends_with("-two")
                        || name == "text76-bare");
                assert!(
                    departure,
                    "{name} record: rust={} js={}",
                    a["record"], b["record"]
                );
                f2.push(name.to_string());
            }
        }
        println!(
            "marker cases compared={} identical except the F2 record departure on {}",
            ours.len(),
            f2.len()
        );
        assert!(f2
            .iter()
            .all(|n| !n.contains("bom") || n.ends_with("-mismatch") || n.ends_with("-two")));
    }

    // --- whole blocks ----------------------------------------------------
    let coin = mature_coin(chain.state(), &key);
    let selected = [
        "peg34-bare",
        "peg35-p1",
        "peg40-p1",
        "peg40-bare",
        "peg34-p1",
        "ff-bare",
        "peg34-p2",
        "peg34-two",
        "peg34-mismatch",
        "peg41-p1",
        "odd-p1",
        "empty-bare",
        "bare-text",
        "bom-bare",
        "bom-p1",
        "badbom-bare",
        "badbom-p1",
        "newline-bare",
    ];
    let refused = [
        "ff-bare",
        "peg41-p1",
        "odd-p1",
        "empty-bare",
        "badbom-bare",
        "badbom-p1",
        "newline-bare",
    ];
    let mut groups: Vec<(String, Vec<ScriptBuf>)> = selected
        .iter()
        .map(|n| (n.to_string(), vec![pick(&scripts, n).clone()]))
        .collect();
    groups.push((
        "all".into(),
        selected.iter().map(|n| pick(&scripts, n).clone()).collect(),
    ));
    groups.push((
        "accepted-mix".into(),
        selected
            .iter()
            .filter(|n| !refused.contains(n))
            .map(|n| pick(&scripts, n).clone())
            .collect(),
    ));
    let genesis = State::genesis_block_for(&d, &key).unwrap();
    let replayed = || {
        let mut state = State::from_genesis(d.clone(), &genesis, None).unwrap();
        for e in chain.index().blocks.iter().skip(1) {
            let b: Block =
                deserialize(&sidestr_core::blockfile::read_block(chain.dat_path(), e).unwrap())
                    .unwrap();
            state.add_block(&b, None, None).unwrap();
        }
        state
    };
    let peg = "b".repeat(64);
    let mut block_inputs = vec![];
    let mut rust = vec![];
    let mut offer = |name: &str, bytes: Vec<u8>| {
        let mut state = replayed();
        let b: Block = deserialize(&bytes).unwrap();
        let result = state.add_block(&b, None, None);
        rust.push(json!({"name":name,"ok":result.is_ok(),"error":result.err().map(|e|e.to_string()),"pegouts":burn_list(&state),"claimed":state.claimed(&peg,0)}));
        block_inputs
            .push(json!({"name":name,"hex":hex::encode(bytes),"claim":{"txid":peg,"vout":0}}));
    };
    for (name, ss) in &groups {
        let mut outputs: Vec<_> = ss.iter().map(|s| pay(20000, s)).collect();
        outputs.push(pay(coin.value - 20000 * ss.len() as u64 - 1000, &me));
        let tx = spend(&key, &coin, outputs);
        offer(
            name,
            hand_block(chain.state(), &key, vec![pay(1000, &me)], vec![tx]),
        );
    }
    for (name, marker) in scripts
        .iter()
        .filter(|(n, _)| n.starts_with("claim-") || n.starts_with("bomclaim-"))
    {
        offer(
            name,
            hand_block(
                chain.state(),
                &key,
                vec![pay(100000, &me), pay(0, marker)],
                vec![],
            ),
        );
    }
    // F1 pinned without the reference: the recorded list and the named rule
    let by = |n: &str| rust.iter().find(|v| v["name"] == n).unwrap();
    for n in ["bom-bare", "bom-p1"] {
        let r = by(n);
        assert_eq!(r["ok"], json!(true), "{n}");
        assert_eq!(r["pegouts"].as_array().unwrap().len(), 1, "{n}");
        assert_eq!(r["pegouts"][0]["script"], json!("abcd"), "{n}");
        assert_eq!(r["pegouts"][0]["value"], json!(20000), "{n}");
        assert_eq!(r["pegouts"][0]["height"], json!(102), "{n}");
    }
    for n in ["badbom-bare", "badbom-p1"] {
        let r = by(n);
        assert_eq!(r["ok"], json!(false), "{n}");
        assert_eq!(
            r["error"],
            json!("block 102 failed: sidestr:rule-pegouts"),
            "{n}"
        );
        assert_eq!(r["pegouts"].as_array().unwrap().len(), 0, "{n}");
    }
    for n in ["bomclaim-bare", "bomclaim-p1"] {
        let r = by(n);
        assert_eq!(r["ok"], json!(true), "{n}");
        assert_eq!(r["claimed"], json!(true), "{n}");
    }
    for n in ["bomclaim-p2", "bomclaim-mismatch", "bomclaim-two"] {
        assert_eq!(
            by(n)["error"],
            json!("block 102 failed: btc:rule-blockctx-coinbase-amount"),
            "{n}"
        );
    }
    assert_eq!(by("accepted-mix")["pegouts"].as_array().unwrap().len(), 7);
    assert_eq!(
        by("all")["error"],
        json!("block 102 failed: sidestr:rule-pegouts")
    );

    let blocks_file = dir.0.join("blocks.json");
    std::fs::write(&blocks_file, serde_json::to_vec(&block_inputs).unwrap()).unwrap();
    if let Some(theirs) = reference("blocks", &chain_file, &base, &blocks_file) {
        let theirs = theirs.as_array().unwrap();
        assert_eq!(theirs.len(), rust.len());
        for (a, b) in rust.iter().zip(theirs) {
            assert_eq!(a, b, "block {}: rust={a} js={b}", a["name"]);
        }
        println!("blocks compared={} identical", rust.len());
    }
}
