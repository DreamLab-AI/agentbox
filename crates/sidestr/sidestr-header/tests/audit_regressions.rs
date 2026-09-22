//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22 (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2-gpt6-astra.md).

use bitcoin::consensus::encode::serialize;
use sidestr_core::block::{key_from_hex, sign_block, HeaderFamily, SidestrBlock, Stock};
use sidestr_core::blockfile::{append_block, read_index, write_index, Index};
use sidestr_core::chain::ChainOf;
use sidestr_core::state::NextBlock;
use sidestr_core::{ChainDocument, State, StateOf};
use sidestr_header::{family, Blake2bV2, Blake2bV2Header};
use std::path::PathBuf;

/// A unique, self-removing directory under the system temp dir for the
/// mirrors a test writes; nothing here touches a path outside the crate or
/// the temp dir.
struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "sidestr-header-audit-{tag}-{}-{}",
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
/// `tests/fixtures/<name>`: `trial` (a stock document and its key),
/// `txbt4-siding` and `melchain` (snapshots of Melvin's public mirrors,
/// `blocks.json` announcing their tip), `v2-edge-headers.json` (28 v2
/// headers at the field extremes with the JS kernel's hash, signed prefix,
/// data and time; regenerate with `gen-v2-edge-headers.mjs`).
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}
fn doc(name: &str) -> ChainDocument {
    ChainDocument::from_json(&std::fs::read_to_string(fixture(name).join("chain.json")).unwrap())
        .unwrap()
}
fn trial_key() -> bitcoin::secp256k1::SecretKey {
    key_from_hex(&std::fs::read_to_string(fixture("trial").join("trial.key")).unwrap()).unwrap()
}

#[test]
fn v2_js_edge_headers() {
    let vectors: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture("v2-edge-headers.json")).unwrap()).unwrap();
    for v in vectors.as_array().unwrap() {
        let bytes = hex::decode(v["hex"].as_str().unwrap()).unwrap();
        let h = Blake2bV2Header::decode(&bytes).unwrap();
        assert_eq!(h.encode().as_slice(), bytes);
        assert_eq!(
            Blake2bV2.block_hash(&h).to_string(),
            v["hash"].as_str().unwrap()
        );
        assert_eq!(hex::encode(Blake2bV2.signed_prefix(&h)), v["prefix"]);
        assert_eq!(hex::encode(h.block_data(h.merkle_root)), v["data"]);
        assert_eq!(u64::from(h.time()), v["time"].as_u64().unwrap());
        let mut invalid = h;
        invalid.version &= 0x7fff_ffff;
        assert!(Blake2bV2.decode_header(&invalid.encode()).is_err());
        assert!(Blake2bV2
            .header_rules(&invalid, invalid.height)
            .iter()
            .any(|r| r.ok == Some(false)));
        println!(
            "{}: roundtrip/hash/prefix/data/time match JS; cleared bit31 refused",
            v["label"]
        );
    }
}

#[test]
fn document_family_mismatch() {
    let stock = doc("trial");
    let v2 = doc("txbt4-siding");
    println!("Stock + txbt4: {:?}", State::family_of(&v2));
    println!(
        "Blake2bV2 + tbtc4: {:?}",
        StateOf::<Blake2bV2>::family_of(&stock)
    );
    assert!(State::build_genesis_for(&v2).is_err());
    assert!(StateOf::<Blake2bV2>::build_genesis_for(&stock).is_err());
}

#[test]
fn stock_bit31_must_be_refused_in_decode_rules_and_replay() {
    let d = doc("trial");
    let k = trial_key();
    let g = State::genesis_block_for(&d, &k).unwrap();
    let mut s = State::from_genesis(d.clone(), &g, None).unwrap();
    let (mut b, _, _) = s
        .build_next(&NextBlock {
            time: s.tip().time + 1,
            claims: vec![],
        })
        .unwrap();
    b.header.version = bitcoin::block::Version::from_consensus(0xa000_0000u32 as i32);
    let b = sign_block(&Stock, &b, &d.challenge_script().unwrap(), &k, &[0; 32]).unwrap();
    let core_decode = Stock.decode_header(&serialize(&b.header));
    let header_decode = family::Stock.decode_header(&serialize(&b.header));
    println!(
        "bit31=1 core::Stock decode={} header::Stock decode={:?}",
        core_decode.is_ok(),
        header_decode
    );
    println!(
        "core block decode={}",
        bitcoin::Block::decode(&serialize(&b)).is_ok()
    );
    let typed = sidestr_header::StockHeader {
        version: 0xa000_0000,
        ..family::Stock.decode_header(&serialize(&g.header)).unwrap()
    };
    println!(
        "header::Stock typed header family rules: {:?}",
        family::Stock.header_rules(&typed, 1)
    );
    let result = s.add_block(&b, None, Some(b.header.time));
    println!("core rules/apply with bit31=1: {result:?}");
    let tmp = TempDir::new("stock-bit31");
    let dir = tmp.0.clone();
    std::fs::write(dir.join("blocks.dat"), []).unwrap();
    let mut idx = Index::new(&d.id);
    for (h, block) in [(0, &g), (1, &b)] {
        append_block(
            dir.join("blocks.dat"),
            &mut idx,
            h,
            &block.header.block_hash().to_string(),
            &serialize(block),
        )
        .unwrap();
    }
    write_index(dir.join("blocks.json"), &idx).unwrap();
    let replay = ChainOf::<Stock>::open(d, &dir, None).map(|c| c.state().height());
    println!("core replay: {replay:?}");
    assert!(
        core_decode.is_err() && result.is_err() && replay.is_err(),
        "stock bit31 accepted"
    );
}

fn live_blocks() -> (ChainDocument, Vec<Vec<u8>>) {
    let src = fixture("txbt4-siding");
    let bytes = std::fs::read(src.join("blocks.dat")).unwrap();
    let idx = read_index(src.join("blocks.json")).unwrap().unwrap();
    let blocks = idx
        .blocks
        .iter()
        .map(|e| bytes[e.offset as usize + 8..e.offset as usize + 8 + e.size as usize].to_vec())
        .collect();
    (doc("txbt4-siding"), blocks)
}
fn before(d: &ChainDocument, blocks: &[Vec<u8>], height: usize) -> StateOf<Blake2bV2> {
    let g = <Blake2bV2 as HeaderFamily>::Block::decode(&blocks[0]).unwrap();
    let mut s = StateOf::<Blake2bV2>::from_genesis(d.clone(), &g, None).unwrap();
    for b in &blocks[1..height] {
        s.add_block_bytes(b, None, Some(1_790_100_000)).unwrap();
    }
    s
}
#[test]
fn mid_chain_mutations() {
    let (d, blocks) = live_blocks();
    let height = 133;
    for kind in [
        "witness",
        "coinbase",
        "time",
        "prev-two-back",
        "clear-bit31",
    ] {
        let mut s = before(&d, &blocks, height);
        let mut b = <Blake2bV2 as HeaderFamily>::Block::decode(&blocks[height]).unwrap();
        match kind {
            "witness" => {
                let mut w = b.txdata[1].input[0].witness.to_vec();
                w[0][0] ^= 1;
                b.txdata[1].input[0].witness = bitcoin::Witness::from_slice(&w);
            }
            "coinbase" => {
                let mut sig = b.txdata[0].input[0].script_sig.to_bytes();
                let i = sig.len() - 1;
                sig[i] ^= 1;
                b.txdata[0].input[0].script_sig = bitcoin::ScriptBuf::from_bytes(sig);
            }
            "time" => b.header.time_on_wire ^= 1,
            "prev-two-back" => {
                b.header.prev_block_hash = sidestr_header::BlockHash::from_hex(
                    &before(&d, &blocks, height - 1).tip().hash.to_string(),
                )
                .unwrap();
            }
            _ => b.header.version &= 0x7fff_ffff,
        }
        let result = s.add_block(&b, None, Some(1_790_100_000));
        println!(
            "height={height} mutation={kind}: {result:?}; retained_height={}",
            s.height()
        );
        assert!(result.is_err());
        assert_eq!(s.height(), 132);
    }
    let mut s = before(&d, &blocks, height);
    let result = s.add_block_bytes(&blocks[height + 1], None, Some(1_790_100_000));
    println!("reorder block134 before133: {result:?}");
    assert!(result.is_err());
    let tmp = TempDir::new("truncated-v2");
    let dir = tmp.0.clone();
    std::fs::copy(
        fixture("txbt4-siding").join("blocks.json"),
        dir.join("blocks.json"),
    )
    .unwrap();
    let mut dat = std::fs::read(fixture("txbt4-siding").join("blocks.dat")).unwrap();
    dat.pop();
    std::fs::write(dir.join("blocks.dat"), dat).unwrap();
    let result = ChainOf::<Blake2bV2>::open(d, &dir, None).map(|c| c.state().height());
    println!("truncate last byte: {result:?}");
    assert!(result.is_err());
}

#[test]
fn replay_must_check_dat_record_framing() {
    let tmp = TempDir::new("framing-v2");
    let dir = tmp.0.clone();
    let src = fixture("txbt4-siding");
    let idx = read_index(src.join("blocks.json")).unwrap().unwrap();
    std::fs::copy(src.join("blocks.json"), dir.join("blocks.json")).unwrap();
    let mut dat = std::fs::read(src.join("blocks.dat")).unwrap();
    let offset = idx.blocks[133].offset as usize;
    dat[offset..offset + 4].copy_from_slice(&999u32.to_le_bytes());
    dat[offset + 4..offset + 8].copy_from_slice(&0u32.to_le_bytes());
    std::fs::write(dir.join("blocks.dat"), dat).unwrap();
    let result =
        ChainOf::<Blake2bV2>::open(doc("txbt4-siding"), &dir, None).map(|c| c.state().height());
    println!("record133 dat height=999 size=0; JSON index unchanged; replay={result:?}");
    assert!(result.is_err(), "corrupt dat framing was accepted");
}

#[test]
fn saved_live_mirrors_all_rule_counts() {
    for name in ["txbt4-siding", "melchain"] {
        let dir = fixture(name);
        let d = ChainDocument::from_json(&std::fs::read_to_string(dir.join("chain.json")).unwrap())
            .unwrap();
        let index = read_index(dir.join("blocks.json")).unwrap().unwrap();
        let data = std::fs::read(dir.join("blocks.dat")).unwrap();
        let get = |i: usize| {
            let e = &index.blocks[i];
            <Blake2bV2 as HeaderFamily>::Block::decode(
                &data[e.offset as usize + 8..e.offset as usize + 8 + e.size as usize],
            )
            .unwrap()
        };
        let mut s = StateOf::<Blake2bV2>::from_genesis(
            d,
            &get(0),
            Some(index.blocks[0].hash.parse().unwrap()),
        )
        .unwrap();
        let mut counts = std::collections::BTreeMap::<String, [usize; 3]>::new();
        for i in 1..index.blocks.len() {
            let b = get(i);
            let (v, _) = s.judge(i as u32, &b, Some(sidestr_core::chain::now()));
            for r in v.results {
                counts.entry(r.rule).or_default()[match r.ok {
                    Some(true) => 0,
                    Some(false) => 1,
                    None => 2,
                }] += 1;
            }
            s.add_block(
                &b,
                Some(index.blocks[i].hash.parse().unwrap()),
                Some(sidestr_core::chain::now()),
            )
            .unwrap();
        }
        let last = index.blocks.last().unwrap();
        assert_eq!(s.tip().hash.to_string(), last.hash);
        assert_eq!(s.height() as i64, index.to);
        println!(
            "{name}: announced={} replayed={} hash={} genesis=trusted-hash",
            index.to,
            s.height(),
            s.tip().hash
        );
        for (rule, [pass, fail, skip]) in counts {
            println!("{name} {rule} pass={pass} fail={fail} skip={skip}");
            assert_eq!(fail, 0);
        }
    }
}

#[test]
fn signed_prefix_and_template_metadata_boundary() {
    let mut d = doc("trial");
    d.parent = "txbt4".into();
    d.genesis_hash = None;
    let key = trial_key();
    let g = StateOf::<Blake2bV2>::genesis_block_for(&d, &key).unwrap();
    let c = d.challenge_script().unwrap();
    let original = sidestr_core::block::block_data(&Blake2bV2, &g);
    let id = |b: &<Blake2bV2 as HeaderFamily>::Block| {
        sidestr_core::block::template_id(&Blake2bV2, b, &d.id, None).unwrap()
    };
    for field in [
        "nonce",
        "nonce2",
        "nonce3",
        "extranonce",
        "time_offset",
        "mm_rhs",
    ] {
        let mut b = g.clone();
        match field {
            "nonce" => b.header.nonce ^= 1,
            "nonce2" => b.header.nonce2 ^= 1,
            "nonce3" => b.header.nonce3 ^= 1,
            "extranonce" => b.header.extranonce[0] ^= 1,
            "time_offset" => b.header.time_offset ^= 1,
            _ => b.header.mm_rhs[0] ^= 1,
        }
        assert_eq!(sidestr_core::block::block_data(&Blake2bV2, &b), original);
        assert!(sidestr_core::block::verify_block_solution(&Blake2bV2, &b, &c).is_ok());
        println!(
            "field={field} signature-valid=true template_same={}",
            id(&g) == id(&b)
        );
        assert_eq!(id(&g) == id(&b), field == "nonce");
    }
    let mut b = g.clone();
    b.txdata[0].output.push(bitcoin::TxOut {
        value: bitcoin::Amount::ZERO,
        script_pubkey: sidestr_core::marker::record_script("audit metadata").unwrap(),
    });
    assert_ne!(sidestr_core::block::block_data(&Blake2bV2, &b), original);
    assert!(sidestr_core::block::verify_block_solution(&Blake2bV2, &b, &c).is_err());
    println!("ordinary coinbase metadata change: committed, original signature refused");
}

#[test]
fn v2_genesis_with_bit31_clear_must_be_refused() {
    let (mut d, blocks) = live_blocks();
    let mut g = <Blake2bV2 as HeaderFamily>::Block::decode(&blocks[0]).unwrap();
    g.header.version &= 0x7fff_ffff;
    d.genesis_hash = Some(Blake2bV2.block_hash(&g.header).to_string());
    println!(
        "v2 bit31 clear decode={:?}",
        Blake2bV2.decode_header(&g.header.encode())
    );
    println!(
        "v2 bit31 clear family rules={:?}",
        Blake2bV2.header_rules(&g.header, 0)
    );
    let r = StateOf::<Blake2bV2>::from_genesis(d, &g, None).map(|s| s.height());
    println!("v2 bit31 clear typed genesis with matching document hash={r:?}");
    assert!(r.is_err());
}
