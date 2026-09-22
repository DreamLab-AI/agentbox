//! Peg-outs (SPEC 7) at the chain level and the parent-side markers, no
//! parent node needed: a throwaway chain, burns accepted and refused, the
//! record the chain keeps. A port of `siding/test/pegout-test.mjs` (the fake
//! parent RPC half is `parent.mjs`'s and is not ported: no parent view in 0.1).

mod common;

use bitcoin::consensus::encode::serialize;
use bitcoin::ScriptBuf;
use common::*;
use sidestr_core::marker::{
    op_return_data, parse_pegout, parse_pegout_marker, parse_pegouts, pegout_marker,
    pegout_marker_data,
};
use sidestr_core::Error;

#[test]
fn pegouts() {
    let key = signer("pegout");
    let me = challenge(&key);
    let doc = doc(
        "pegouttest",
        &key,
        vec![("a".repeat(64), 0, 5_000_000_000, me.clone())],
    );
    let dir = TempDir::new("pegout");
    let mut chain = open(&doc, &dir, &key);
    produce_to(&mut chain, &key, 101);
    let parent = format!("5120{}", "e9".repeat(32));
    assert!(
        parse_pegout(&pegout_marker(&parent)).as_deref() == Some(parent.as_str())
            && pegout_marker(&parent).to_hex_string().starts_with("6a4b"),
        "the marker is OP_RETURN pegout:<script> and parses back"
    );
    assert!(
        parse_pegout(&pegout_marker("00")).is_none()
            && parse_pegout(&pegout_marker(&"ab".repeat(41))).is_none(),
        "a script outside 2..40 bytes is not a peg-out"
    );

    let coin = mature_coin(chain.state(), &key);
    let e = chain
        .submit(&serialize(&spend(
            &key,
            &coin,
            vec![
                pay(9_999, &pegout_marker(&parent)),
                pay(coin.value - 9_999 - 1_000, &me),
            ],
        )))
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("at least 10000"),
        "submit refuses a burn below pegoutMin: {e}"
    );
    let not_a_script = ScriptBuf::from_bytes([&[0x6a, 0x09][..], b"pegout:zz"].concat());
    let e = chain
        .submit(&serialize(&spend(
            &key,
            &coin,
            vec![pay(20_000, &not_a_script), pay(coin.value - 21_000, &me)],
        )))
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("2 to 40 bytes"),
        "submit refuses a pegout: marker that is not a script: {e}"
    );
    let burn = spend(
        &key,
        &coin,
        vec![
            pay(50_000, &pegout_marker(&parent)),
            pay(coin.value - 50_000 - 1_000, &me),
        ],
    );
    let burn_txid = burn.compute_txid();
    assert_eq!(
        chain.submit(&serialize(&burn)).unwrap().txid,
        burn_txid,
        "submit accepts a burn of 50000 sats"
    );
    let before = chain.state().utxo().len();
    let r = chain.produce(&key, vec![]).unwrap();
    let after: u64 = chain
        .state()
        .utxo()
        .values()
        .map(|c| c.output.value.to_sat())
        .sum();
    assert!(
        r.txs == 2 && chain.state().utxo().len() == before + 1 && !chain.state().utxo().contains_key(&bitcoin::OutPoint { txid: burn_txid, vout: 0 }),
        "the block with the burn validates and the burn is not a coin (spent 1, change 1, fee coinbase 1)"
    );
    let p = chain.state().pegouts();
    assert!(
        p.len() == 1
            && p[0].txid == burn_txid.to_string()
            && p[0].vout == 0
            && p[0].script == parent
            && p[0].value == 50_000
            && p[0].height == r.height,
        "the chain records the burn: txid, vout, script, value, height"
    );
    assert_eq!(
        parse_pegouts(&burn, &burn_txid.to_string(), r.height).len(),
        1,
        "parse_pegouts reads it from the transaction"
    );
    assert_eq!(
        after,
        5_000_000_000 - 50_000,
        "50000 sats left the supply (fees went to the signer)"
    );

    // a hand-built block whose coinbase carries a burn is refused by the validator
    let bytes = hand_block(
        chain.state(),
        &key,
        vec![pay(0, &pegout_marker(&parent))],
        vec![],
    );
    match chain.add_block(&bytes, None) {
        Err(Error::Rejected { rules, .. }) => assert!(
            rules.contains(&"sidestr:rule-pegouts".to_string()),
            "{rules:?}"
        ),
        other => panic!("validator: a burn in the coinbase must be refused, got {other:?}"),
    }
    // a hand-built block carrying a burn below the minimum, or a malformed one, is refused too
    let coin = mature_coin(chain.state(), &key);
    let small = spend(
        &key,
        &coin,
        vec![
            pay(9_999, &pegout_marker(&parent)),
            pay(coin.value - 9_999 - 1_000, &me),
        ],
    );
    let bytes = hand_block(chain.state(), &key, vec![pay(1_000, &me)], vec![small]);
    assert!(
        matches!(chain.add_block(&bytes, None), Err(Error::Rejected { rules, .. }) if rules.contains(&"sidestr:rule-pegouts".to_string()))
    );
    let bad = spend(
        &key,
        &coin,
        vec![pay(20_000, &not_a_script), pay(coin.value - 21_000, &me)],
    );
    let bytes = hand_block(chain.state(), &key, vec![pay(1_000, &me)], vec![bad]);
    assert!(
        matches!(chain.add_block(&bytes, None), Err(Error::Rejected { rules, .. }) if rules.contains(&"sidestr:rule-pegouts".to_string()))
    );
    let r = chain.produce(&key, vec![]).unwrap();
    assert_eq!(
        r.height,
        chain.state().tip().height,
        "and an ordinary block after that still produces"
    );

    // the parent-side record
    let data = pegout_marker_data(&doc.id, &burn_txid.to_string()).unwrap();
    let spk = ScriptBuf::from_bytes([&[0x6a, data.len() as u8][..], &data].concat());
    assert!(data.len() <= 80 && op_return_data(&spk).is_some());
    assert_eq!(
        parse_pegout_marker(&spk, &doc.id).as_deref(),
        Some(burn_txid.to_string().as_str()),
        "the parent marker parses back to the sidechain txid"
    );
    assert_eq!(parse_pegout_marker(&spk, "sidestr:other"), None);
}
