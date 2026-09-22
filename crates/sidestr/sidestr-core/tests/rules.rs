//! Every rule the overlay adds or changes has an accepting and a rejecting
//! case (PRD-024 S2): proof of work against `powLimit`, the block signature,
//! the subsidy (coinbase ≤ fees + claims), the claim rule, the burn rule —
//! and the parent rules a tampered block trips on the way. Judged through
//! `State::judge`, which names every rule without applying anything.

mod common;

use bitcoin::block::Version;
use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::Hash;
use bitcoin::{Block, CompactTarget};
use common::*;
use sidestr_core::block::{block_sighash, seal_block, solution_of, with_solution, Stock};
use sidestr_core::marker::{claim_marker, pegout_marker};
use sidestr_core::rules::{validate_header, HeaderContext, Params};
use sidestr_core::state::State;

fn failed(state: &State, block: &Block) -> Vec<String> {
    let h = state.height() + 1;
    state.judge(h, block, Some(block.header.time)).0.failed()
}

fn assert_only(state: &State, block: &Block, rules: &[&str]) {
    let f = failed(state, block);
    for r in rules {
        assert!(
            f.iter().any(|x| x == r),
            "expected {r} to fail, failed: {f:?}"
        );
    }
}

#[test]
fn every_rule_accepts_and_refuses() {
    let key = signer("rules");
    let me = challenge(&key);
    let doc = doc(
        "rulestest",
        &key,
        vec![("a".repeat(64), 0, 5_000_000_000, me.clone())],
    );
    let dir = TempDir::new("rules");
    let mut chain = open(&doc, &dir, &key);
    produce_to(&mut chain, &key, 101);
    let state = chain.state();
    let you = challenge(&signer("you"));

    // accepting: a plain block passes every rule
    let good: Block = deserialize(&hand_block(state, &key, vec![], vec![])).unwrap();
    assert!(
        failed(state, &good).is_empty(),
        "{:?}",
        failed(state, &good)
    );

    // pow (SPEC 4.1): the header meets powLimit; no retarget, so bits never change
    let mut b = good.clone();
    b.header.bits = CompactTarget::from_consensus(0x0300_0001); // a target no hash meets, and not the chain's bits
    assert_only(
        state,
        &b,
        &["btc:rule-header-pow", "btc:rule-header-difficulty"],
    );
    let hdr = validate_header(
        &Stock,
        &Params::default(),
        &good.header,
        &HeaderContext {
            height: 102,
            prev: state.header_at(101),
            mtp_window: &[],
            now: Some(good.header.time),
        },
    );
    assert!(hdr.ok());
    let mut nonce_wrong = good.clone();
    nonce_wrong.header.nonce = nonce_wrong.header.nonce.wrapping_add(1);
    // with powLimit 7fff…, half of all nonces meet the target; find one that does not
    while bitcoin::Target::from_compact(nonce_wrong.header.bits)
        .is_met_by(nonce_wrong.header.block_hash())
    {
        nonce_wrong.header.nonce = nonce_wrong.header.nonce.wrapping_add(1);
    }
    assert_only(state, &nonce_wrong, &["btc:rule-header-pow"]);

    // signature (SPEC 4.2): the solution must satisfy the challenge for the block data
    let unsigned = {
        let mut b = good.clone();
        let (i, spk) = sidestr_core::block::commitment_output(&b)
            .map(|(i, s)| (i, s.to_owned()))
            .unwrap();
        b.txdata[0].output[i].script_pubkey =
            bitcoin::ScriptBuf::from_bytes(spk.as_bytes()[..38].to_vec());
        b
    };
    let stripped = seal_block(&Stock, &unsigned, &[]).unwrap_or(unsigned.clone());
    assert!(solution_of(&stripped).is_none() || solution_of(&stripped).unwrap().witness.is_empty());
    assert_only(state, &stripped, &["sidestr:rule-block-signature"]);
    let other_key = signer("impostor");
    let msg = block_sighash(&Stock, &unsigned, &me).unwrap();
    let sig = sidestr_core::block::secp().sign_schnorr_with_aux_rand(
        &bitcoin::secp256k1::Message::from_digest(msg),
        &bitcoin::secp256k1::Keypair::from_secret_key(sidestr_core::block::secp(), &other_key),
        &[0u8; 32],
    );
    let forged = seal_block(&Stock, &unsigned, &[sig.serialize().to_vec()]).unwrap();
    assert_only(state, &forged, &["sidestr:rule-block-signature"]);
    // a valid signature over different block data does not transfer
    let mut moved = good.clone();
    moved.header.time += 1;
    moved = seal_block(
        &Stock,
        &with_solution(&moved, &solution_of(&good).unwrap().witness).unwrap(),
        &solution_of(&good).unwrap().witness,
    )
    .unwrap();
    assert_only(state, &moved, &["sidestr:rule-block-signature"]);

    // subsidy (SPEC 4.3): the coinbase's outputs sum to at most fees plus claims
    let over: Block = deserialize(&hand_block(state, &key, vec![pay(1, &you)], vec![])).unwrap();
    assert_only(state, &over, &["btc:rule-blockctx-coinbase-amount"]);
    let coin = mature_coin(state, &key);
    let tx = spend(&key, &coin, vec![pay(coin.value - 1_000, &you)]);
    let exact: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(1_000, &me)],
        vec![tx.clone()],
    ))
    .unwrap();
    assert!(
        failed(state, &exact).is_empty(),
        "fees may be collected: {:?}",
        failed(state, &exact)
    );
    let greedy: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(1_001, &me)],
        vec![tx.clone()],
    ))
    .unwrap();
    assert_only(state, &greedy, &["btc:rule-blockctx-coinbase-amount"]);

    // claims (SPEC 6): a payout paired with its marker is a claim; alone it is subsidy
    let peg = "d".repeat(64);
    let claim: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(2_500_000_000, &you), pay(0, &claim_marker(&peg, 0))],
        vec![],
    ))
    .unwrap();
    assert!(failed(state, &claim).is_empty());
    let orphan_marker: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(0, &claim_marker(&peg, 0))],
        vec![],
    ))
    .unwrap();
    assert_only(
        state,
        &orphan_marker,
        &["sidestr:rule-claims", "btc:rule-blockctx-coinbase-amount"],
    );

    // burns (SPEC 7): at least pegoutMin, a 2–40 byte script, never in the coinbase
    let parent = format!("5120{}", "e9".repeat(32));
    let burn = spend(
        &key,
        &coin,
        vec![
            pay(50_000, &pegout_marker(&parent)),
            pay(coin.value - 50_000 - 1_000, &me),
        ],
    );
    let burning: Block =
        deserialize(&hand_block(state, &key, vec![pay(1_000, &me)], vec![burn])).unwrap();
    assert!(failed(state, &burning).is_empty());
    let small = spend(
        &key,
        &coin,
        vec![
            pay(9_999, &pegout_marker(&parent)),
            pay(coin.value - 9_999 - 1_000, &me),
        ],
    );
    let too_small: Block =
        deserialize(&hand_block(state, &key, vec![pay(1_000, &me)], vec![small])).unwrap();
    assert_only(state, &too_small, &["sidestr:rule-pegouts"]);
    let in_coinbase: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(0, &pegout_marker(&parent))],
        vec![],
    ))
    .unwrap();
    assert_only(state, &in_coinbase, &["sidestr:rule-pegouts"]);

    // the parent's rules the block still has to pass
    let mut bad_sig = exact.clone();
    bad_sig.txdata[1].input[0].witness = bitcoin::Witness::from_slice(&[vec![0u8; 64]]);
    let resigned = seal_block(&Stock, &with_solution(&bad_sig, &[]).unwrap(), &[]).unwrap();
    assert_only(state, &resigned, &["btc:rule-blockctx-scripts"]);
    // a coinbase coin (here a claim's payout) may not be spent before maturity
    let you_key = signer("you");
    chain
        .produce(
            &key,
            vec![sidestr_core::state::ClaimRequest {
                txid: "e".repeat(64),
                vout: 0,
                amount: 100_000_000,
                script: you.clone(),
            }],
        )
        .unwrap();
    let state = chain.state();
    let immature = state
        .coins(&you)
        .into_iter()
        .find(|c| c.coinbase && state.height() + 1 - c.height < 100)
        .unwrap();
    let early = spend(&you_key, &immature, vec![pay(immature.value - 1_000, &me)]);
    let premature: Block =
        deserialize(&hand_block(state, &key, vec![pay(1_000, &me)], vec![early])).unwrap();
    assert_only(state, &premature, &["btc:rule-blockctx-coinbase-maturity"]);
    let good: Block = deserialize(&hand_block(state, &key, vec![], vec![])).unwrap();
    let coin = mature_coin(state, &key);
    let tx = spend(&key, &coin, vec![pay(coin.value - 1_000, &you)]);
    let exact: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(1_000, &me)],
        vec![tx.clone()],
    ))
    .unwrap();
    let mut stale = good.clone();
    stale.header.time = state.tip().time.saturating_sub(10_000);
    assert_only(state, &stale, &["btc:rule-header-mtp"]);
    let mut future = good.clone();
    future.header.time = good.header.time + 20_000;
    let f = state.judge(102, &future, Some(good.header.time)).0.failed();
    assert!(
        f.contains(&"btc:rule-header-time-future".to_string()),
        "{f:?}"
    );
    let mut old_version = good.clone();
    old_version.header.version = Version::from_consensus(1);
    assert_only(state, &old_version, &["btc:rule-header-version"]);
    let mut wrong_root = good.clone();
    wrong_root.header.merkle_root = bitcoin::TxMerkleNode::all_zeros();
    assert_only(state, &wrong_root, &["btc:rule-block-merkle-root"]);
    let mut double: Block = deserialize(&hand_block(
        state,
        &key,
        vec![pay(2_000, &me)],
        vec![tx.clone(), tx.clone()],
    ))
    .unwrap();
    assert_only(
        state,
        &double,
        &[
            "btc:rule-block-tx-duplicates",
            "btc:rule-blockctx-inputs-available",
        ],
    );
    double.txdata.truncate(2);
    // a block whose coinbase carries no witness commitment while a transaction has a witness
    let mut no_commit = exact.clone();
    no_commit.txdata[0].output.pop();
    assert_only(
        state,
        &no_commit,
        &[
            "btc:rule-blockctx-witness-commitment",
            "sidestr:rule-block-signature",
        ],
    );
    // and the strict height read decides which height a block claims
    let mut h0 = good.clone();
    h0.txdata[0].input[0].script_sig =
        bitcoin::ScriptBuf::from_bytes(vec![0x00, 0x07, b's', b'i', b'd', b'e', b's', b't', b'r']);
    assert!(
        sidestr_core::block::block_height(&Stock, &h0).unwrap() == 0
            && !failed(state, &h0).is_empty()
    );
    let _ = serialize(&good);
}
