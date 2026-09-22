//! Peg-in claims (SPEC 6) at the chain level, no parent needed: a throwaway
//! chain in a temp dir, the real rules, state and block builder. Checks what
//! the producer emits and what the validator accepts and refuses. A port of
//! `siding/test/claims-test.mjs`.

mod common;

use bitcoin::ScriptBuf;
use common::*;
use sidestr_core::marker::{claim_marker, parse_claims};
use sidestr_core::state::ClaimRequest;
use sidestr_core::Error;

#[test]
fn claims() {
    let key = signer("claims");
    let me = challenge(&key);
    let peg0 = "a".repeat(64);
    let peg1 = "b".repeat(64);
    let peg2 = "c".repeat(64);
    let doc = doc(
        "claimtest",
        &key,
        vec![(peg0, 0, 5_000_000_000, me.clone())],
    );
    let dir = TempDir::new("claims");
    let mut chain = open(&doc, &dir, &key);
    let s = |c: &sidestr_core::chain::Chain| c.state().coins(&me);
    assert!(
        s(&chain).len() == 1 && s(&chain)[0].value == 5_000_000_000,
        "genesis minted the document peg"
    );
    assert_eq!(
        chain.produce(&key, vec![]).unwrap().height,
        1,
        "an empty block produces"
    );
    let you = challenge(&signer("you"));
    let claim = |txid: &str, vout: u32, amount: u64, script: &ScriptBuf| ClaimRequest {
        txid: txid.into(),
        vout,
        amount,
        script: script.clone(),
    };
    let r = chain
        .produce(&key, vec![claim(&peg1, 0, 2_500_000_000, &you)])
        .unwrap();
    assert!(r.height == 2 && r.claims == 1, "a claim block produces");
    let yours = chain.state().coins(&you);
    assert!(
        yours.len() == 1 && yours[0].value == 2_500_000_000 && yours[0].coinbase,
        "the claim paid the named script the peg amount, as a coinbase output"
    );
    assert!(
        chain.state().claimed(&peg1, 0) && !chain.state().claimed(&peg2, 0),
        "the outpoint is now claimed"
    );
    let cb = bitcoin::Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: bitcoin::absolute::LockTime::ZERO,
        input: vec![],
        output: vec![pay(2_500_000_000, &you), pay(0, &claim_marker(&peg1, 0))],
    };
    let (claims, _) = parse_claims(&cb);
    assert!(
        claims.len() == 1 && claims[0].txid == peg1 && claims[0].payout.value == 2_500_000_000,
        "parse_claims pairs payout and marker"
    );
    let e = chain
        .produce(&key, vec![claim(&peg1, 0, 2_500_000_000, &you)])
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("already claimed"),
        "the producer refuses to claim an outpoint twice: {e}"
    );

    // hand-built blocks straight into the validator
    let refuse = |chain: &mut sidestr_core::chain::Chain,
                  name: &str,
                  outputs: Vec<bitcoin::TxOut>,
                  rule: &str| {
        let bytes = hand_block(chain.state(), &key, outputs, vec![]);
        match chain.add_block(&bytes, None) {
            Err(Error::Rejected { rules, .. }) => assert!(
                rules.iter().any(|r| r == rule),
                "{name}: refused by {rules:?}, expected {rule}"
            ),
            other => panic!("{name}: expected a refusal, got {other:?}"),
        }
    };
    refuse(
        &mut chain,
        "a duplicate claim from another block",
        vec![pay(2_500_000_000, &you), pay(0, &claim_marker(&peg1, 0))],
        "sidestr:rule-claims",
    );
    refuse(
        &mut chain,
        "coinbase value without a claim marker",
        vec![pay(100_000_000, &you)],
        "btc:rule-blockctx-coinbase-amount",
    );
    refuse(
        &mut chain,
        "a marker with no payout before it",
        vec![pay(0, &claim_marker(&peg2, 0)), pay(100_000_000, &you)],
        "sidestr:rule-claims",
    );
    refuse(
        &mut chain,
        "two markers sharing one payout",
        vec![
            pay(100_000_000, &you),
            pay(0, &claim_marker(&peg2, 0)),
            pay(0, &claim_marker(&peg2, 1)),
        ],
        "sidestr:rule-claims",
    );
    refuse(
        &mut chain,
        "the same outpoint twice in one block",
        vec![
            pay(100_000_000, &you),
            pay(0, &claim_marker(&peg2, 0)),
            pay(100_000_000, &you),
            pay(0, &claim_marker(&peg2, 0)),
        ],
        "sidestr:rule-claims",
    );
    let good = hand_block(
        chain.state(),
        &key,
        vec![pay(100_000_000, &you), pay(0, &claim_marker(&peg2, 0))],
        vec![],
    );
    chain.add_block(&good, None).unwrap();
    assert!(
        chain.state().claimed(&peg2, 0) && chain.state().coins(&you).len() == 2,
        "a well-formed claim block from outside is accepted"
    );
    let r = chain.produce(&key, vec![]).unwrap();
    assert_eq!(
        r.height,
        chain.state().tip().height,
        "and an ordinary block after all that still produces"
    );
    let tip = chain.state().tip().height;
    assert!(
        chain
            .state()
            .coins(&you)
            .iter()
            .all(|c| c.coinbase && tip + 1 - c.height < 100),
        "the two claimed coins are immature coinbases until maturity"
    );

    // --- fees: the producer refuses less than minFeeRate sat/vB (policy from chain.json) ---
    produce_to(&mut chain, &key, 101); // mature the genesis coin
    let genesis_coin = chain
        .state()
        .coins(&me)
        .into_iter()
        .find(|c| c.height == 0)
        .unwrap();
    let spend_with_fee = |fee: u64| {
        bitcoin::consensus::encode::serialize(&spend(
            &key,
            &genesis_coin,
            vec![pay(genesis_coin.value - fee, &you)],
        ))
    };
    let vs = sidestr_core::state::State::vsize(
        &bitcoin::consensus::encode::deserialize(&spend_with_fee(0)).unwrap(),
    );
    let e = chain.submit(&spend_with_fee(0)).unwrap_err().to_string();
    assert!(
        e.contains("below the minimum"),
        "submit refuses a zero-fee transaction ({vs} vB needs {vs} sats): {e}"
    );
    let e = chain
        .submit(&spend_with_fee(vs - 1))
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("below the minimum"),
        "submit refuses one sat short: {e}"
    );
    let r = chain.submit(&spend_with_fee(vs)).unwrap();
    assert!(
        r.fee == vs && r.vsize == vs,
        "submit accepts exactly the minimum"
    );
    // and the block carrying it pays the fee to the signer
    let r = chain.produce(&key, vec![]).unwrap();
    assert!(r.txs == 2 && r.fees == vs);
    assert!(chain
        .state()
        .coins(&me)
        .iter()
        .any(|c| c.value == vs && c.height == r.height));
    // a resubmission of the same bytes is a duplicate only while it waits; once mined, its input is spent
    let e = chain.submit(&spend_with_fee(vs)).unwrap_err().to_string();
    assert!(e.contains("is not an unspent coin"), "{e}");
}
