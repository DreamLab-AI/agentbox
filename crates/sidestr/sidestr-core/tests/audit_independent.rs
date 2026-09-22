mod common;
use bitcoin::{consensus::deserialize, Block, ScriptBuf};
use common::*;
use serde_json::{json, Value};
use sidestr_core::{marker::*, parent::find_pegin, State};
use std::{fs, path::PathBuf, process::Command};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../probes")
}
fn raw(prefix: &[u8], data: &[u8]) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x6a], prefix, data].concat())
}
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
fn js(script: &str, args: &[PathBuf]) -> Value {
    let x = Command::new("node")
        .arg(root().join(script))
        .args(args)
        .output()
        .unwrap();
    assert!(x.status.success(), "{}", String::from_utf8_lossy(&x.stderr));
    serde_json::from_slice(&x.stdout).unwrap()
}
fn burns(s: &State) -> Value {
    json!(s.pegouts().iter().map(|b|json!({"txid":b.txid,"vout":b.vout,"value":b.value,"script":b.script,"height":b.height})).collect::<Vec<_>>())
}
#[test]
fn independent_differential() {
    fs::create_dir_all(root()).unwrap();
    let key = signer("independent");
    let me = challenge(&key);
    let mut d = doc(
        "independent",
        &key,
        vec![("a".repeat(64), 0, 5_000_000_000, me.clone())],
    );
    let base = root().join("baseline");
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
    let mut chain = sidestr_core::chain::Chain::open(d.clone(), &base, Some(&key)).unwrap();
    produce_to(&mut chain, &key, 101);
    d.genesis_hash = Some(chain.state().genesis_hash().to_string());
    fs::write(base.join("chain.json"), serde_json::to_vec(&d).unwrap()).unwrap();
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
        ("peginraw", peg_marker_data(&d.id, &me)),
        (
            "peginbom",
            [
                format!("pegin:{}:", d.id).into_bytes(),
                vec![0xef, 0xbb, 0xbf],
                b"abcd".to_vec(),
            ]
            .concat(),
        ),
        ("claim", format!("claim:{}:0", "b".repeat(64)).into_bytes()),
        (
            "ckpt",
            checkpoint_data(&d.id, 70000, &"d".repeat(64)).unwrap(),
        ),
        ("text", b"hello".to_vec()),
        (
            "bomclaim",
            [
                vec![0xef, 0xbb, 0xbf],
                format!("claim:{}:0", "b".repeat(64)).into_bytes(),
            ]
            .concat(),
        ),
        (
            "badbom",
            [vec![0xef, 0xbb, 0xbf], b"pegout:abcde".to_vec()].concat(),
        ),
        ("newline", b"pegout:abcd\n".to_vec()),
        (
            "newlineclaim",
            format!("claim:{}:0\n", "b".repeat(64)).into_bytes(),
        ),
        ("text76", vec![b'x'; 76]),
        ("text255", vec![b'x'; 255]),
        (
            "bom",
            [vec![0xef, 0xbb, 0xbf], b"pegout:abcd".to_vec()].concat(),
        ),
    ] {
        for (f, s) in forms(&data) {
            scripts.push((format!("{name}-{f}"), s));
        }
    }
    scripts.push((
        "bare-text".into(),
        ScriptBuf::from_bytes(b"pegout:".to_vec()),
    ));
    let mut inputs = vec![];
    let mut ours = vec![];
    for (name, s) in &scripts {
        let mut tx = State::build_genesis_for(&d).unwrap().txdata[0].clone();
        tx.output = vec![pay(100000, &me), pay(0, s)];
        let txid = tx.compute_txid().to_string();
        inputs.push(json!({"name":name,"hex":s.to_hex_string(),"id":d.id,"pay":me.to_hex_string(),"txid":txid}));
        let (cl, err) = parse_claims(&tx);
        let pegin=find_pegin(&tx,&d.id,42,None).map(|p|json!({"txid":p.txid,"vout":p.vout,"amount":p.amount,"script":p.script.to_hex_string(),"height":p.height,"parentAddress":p.parent_address}));
        ours.push(json!({"name":name,"data":op_return_data(s).map(hex::encode),"pegout":parse_pegout(s),"record":record_text(s),"pegin":pegin.into_iter().collect::<Vec<_>>(),"claim":{"claims":cl.iter().map(|c|json!({"index":c.index,"txid":c.txid,"vout":c.vout,"payout":{"index":c.payout.index,"value":c.payout.value,"scriptPubKey":c.payout.script_pubkey.to_hex_string()}})).collect::<Vec<_>>(),"errors":err},"ckpt":parse_checkpoint(s,&d.id).map(|(height,hash)|json!({"height":height,"hash":hash}))}));
    }
    let file = root().join("markers-input.json");
    fs::write(&file, serde_json::to_vec_pretty(&inputs).unwrap()).unwrap();
    let theirs = js("oracle.mjs", &[file]);
    fs::write(
        root().join("markers-rust.json"),
        serde_json::to_vec_pretty(&ours).unwrap(),
    )
    .unwrap();
    fs::write(
        root().join("markers-js.json"),
        serde_json::to_vec_pretty(&theirs).unwrap(),
    )
    .unwrap();
    for (a, b) in ours.iter().zip(theirs.as_array().unwrap()) {
        for field in ["data", "pegout", "record", "pegin", "claim", "ckpt"] {
            if a[field] != b[field] {
                println!(
                    "DIFF {} {field}: rust={} js={}",
                    a["name"], a[field], b[field]
                );
            }
        }
    }
    println!("marker cases compared={}", ours.len());
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
        "badbom-bare",
        "newline-bare",
    ];
    let mut groups: Vec<(String, Vec<ScriptBuf>)> = selected
        .iter()
        .map(|n| {
            (
                n.to_string(),
                vec![scripts
                    .iter()
                    .find(|(name, _)| name == n)
                    .unwrap()
                    .1
                    .clone()],
            )
        })
        .collect();
    groups.push((
        "all".into(),
        selected
            .iter()
            .map(|n| {
                scripts
                    .iter()
                    .find(|(name, _)| name == n)
                    .unwrap()
                    .1
                    .clone()
            })
            .collect(),
    ));
    groups.push((
        "accepted-mix".into(),
        selected
            .iter()
            .filter(|n| {
                ![
                    "ff-bare",
                    "peg41-p1",
                    "odd-p1",
                    "empty-bare",
                    "bom-bare",
                    "badbom-bare",
                    "newline-bare",
                ]
                .contains(n)
            })
            .map(|n| {
                scripts
                    .iter()
                    .find(|(name, _)| name == n)
                    .unwrap()
                    .1
                    .clone()
            })
            .collect(),
    ));
    let genesis = State::genesis_block_for(&d, &key).unwrap();
    let mut block_inputs = vec![];
    let mut rust_results = vec![];
    for (name, ss) in groups {
        let mut outputs: Vec<_> = ss.iter().map(|s| pay(20000, s)).collect();
        outputs.push(pay(coin.value - 20000 * ss.len() as u64 - 1000, &me));
        let tx = spend(&key, &coin, outputs);
        let bytes = hand_block(chain.state(), &key, vec![pay(1000, &me)], vec![tx]);
        let mut state = State::from_genesis(d.clone(), &genesis, None).unwrap();
        for e in chain.index().blocks.iter().skip(1) {
            let b: Block =
                deserialize(&sidestr_core::blockfile::read_block(chain.dat_path(), e).unwrap())
                    .unwrap();
            state.add_block(&b, None, None).unwrap();
        }
        let b: Block = deserialize(&bytes).unwrap();
        let result = state.add_block(&b, None, None);
        rust_results.push(json!({"name":name,"ok":result.is_ok(),"error":result.err().map(|e|e.to_string()),"pegouts":burns(&state),"claimed":state.claimed(&"b".repeat(64),0)}));
        block_inputs.push(json!({"name":name,"hex":hex::encode(bytes)}));
    }
    for (name, marker) in scripts
        .iter()
        .filter(|(name, _)| name.starts_with("claim-") || name.starts_with("bomclaim-"))
    {
        let bytes = hand_block(
            chain.state(),
            &key,
            vec![pay(100000, &me), pay(0, marker)],
            vec![],
        );
        let mut state = State::from_genesis(d.clone(), &genesis, None).unwrap();
        for e in chain.index().blocks.iter().skip(1) {
            let b: Block =
                deserialize(&sidestr_core::blockfile::read_block(chain.dat_path(), e).unwrap())
                    .unwrap();
            state.add_block(&b, None, None).unwrap();
        }
        let b: Block = deserialize(&bytes).unwrap();
        let result = state.add_block(&b, None, None);
        rust_results.push(json!({"name":name,"ok":result.is_ok(),"error":result.err().map(|e|e.to_string()),"pegouts":burns(&state),"claimed":state.claimed(&"b".repeat(64),0)}));
        block_inputs.push(json!({"name":name,"hex":hex::encode(bytes)}));
    }
    let file = root().join("blocks-input.json");
    fs::write(&file, serde_json::to_vec(&block_inputs).unwrap()).unwrap();
    let theirs = js("block-oracle.mjs", &[base, file]);
    fs::write(
        root().join("blocks-rust.json"),
        serde_json::to_vec_pretty(&rust_results).unwrap(),
    )
    .unwrap();
    fs::write(
        root().join("blocks-js.json"),
        serde_json::to_vec_pretty(&theirs).unwrap(),
    )
    .unwrap();
    for (a, b) in rust_results.iter().zip(theirs.as_array().unwrap()) {
        println!("BLOCK {} rust={} js={}", a["name"], a, b);
    }
}

#[test]
fn encoder_bounds() {
    for n in [0usize, 75, 76, 255, 256] {
        let r = record_script(&"x".repeat(n));
        println!(
            "record_script bytes={n} success={} roundtrip={}",
            r.is_ok(),
            r.as_ref().ok().and_then(|s| record_text(s)).as_deref() == Some(&"x".repeat(n))
        );
    }
    for n in [99999, 100000, u32::MAX] {
        let s = claim_marker(&"a".repeat(64), n);
        let mut tx = State::build_genesis_for(&doc("bounds", &signer("bounds"), vec![]))
            .unwrap()
            .txdata[0]
            .clone();
        tx.output = vec![pay(1, &ScriptBuf::from_hex("51").unwrap()), pay(0, &s)];
        println!(
            "claim_marker vout={n} prefix={} parsed={}",
            hex::encode(&s.as_bytes()[..3]),
            parse_claims(&tx).0.len()
        );
    }
    for n in [40usize, 125] {
        let s = pegout_marker(&"ab".repeat(n));
        println!(
            "pegout_marker script_bytes={n} prefix={} decoded={} parsed={}",
            hex::encode(&s.as_bytes()[..3]),
            op_return_data(&s).is_some(),
            parse_pegout(&s).is_some()
        );
    }
}
