//! Level 2 against the reference (`siding/test/federation-test.mjs`, and
//! `siding new --signers … --key-files …` for the genesis): a 2-of-3
//! document, its derived challenge, a genesis and two blocks sealed by three
//! different pairs, byte-identical to what siding sealed with the same three
//! disposable keys and zero auxiliary randomness (`fixtures/fedtest`, written
//! by `tests/fedcheck.mjs`); then every refusal the reference test has, and
//! the ones the ADR-2101 review asked for.

mod common;

use std::collections::BTreeMap;

use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::Hash;
use bitcoin::key::TapTweak;
use bitcoin::secp256k1::{Keypair, Message, SecretKey, XOnlyPublicKey};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::{LeafVersion, TapNodeHash};
use bitcoin::{Block, ScriptBuf};
use common::TempDir;
use sidestr_core::block::{
    block_sighash_for, challenge_for_output_key, key_from_hex, pubkey_of, seal_block, secp,
    solution_of, template_id, verify_block_solution, virtual_txs, with_solution, BlockSolution,
    SolutionError, SpendPath, Stock,
};
use sidestr_core::chain::Chain;
use sidestr_core::document::ChainDocument;
use sidestr_core::federation::{
    assemble_witness, partial_signature, seal_federated, verify_partial, Federation,
    ScriptPathError,
};
use sidestr_core::state::{NextBlock, State};
use sidestr_core::Error;

fn fixture(f: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/fixtures/fedtest/{f}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

struct Oracle {
    doc: ChainDocument,
    keys: Vec<SecretKey>,
    pubs: Vec<XOnlyPublicKey>,
    fed: Federation,
    expected: serde_json::Value,
}

fn oracle() -> Oracle {
    let expected: serde_json::Value = serde_json::from_str(&fixture("expected.json")).unwrap();
    let doc = ChainDocument::from_json(&fixture("chain.json")).unwrap();
    let keys: Vec<SecretKey> = (1..=3)
        .map(|i| key_from_hex(&fixture(&format!("signer{i}.key"))).unwrap())
        .collect();
    let pubs: Vec<XOnlyPublicKey> = keys.iter().map(pubkey_of).collect();
    let fed = Federation::for_document(&doc)
        .unwrap()
        .expect("a level 2 document");
    Oracle {
        doc,
        keys,
        pubs,
        fed,
        expected,
    }
}

fn hex_block(v: &serde_json::Value) -> Block {
    deserialize(&hex::decode(v.as_str().unwrap()).unwrap()).unwrap()
}

fn seal_with(o: &Oracle, block: &Block, which: &[usize]) -> Block {
    let mut sigs = BTreeMap::new();
    for &i in which {
        sigs.insert(
            o.pubs[i],
            partial_signature(&Stock, block, &o.fed, &o.keys[i], &[0u8; 32]).unwrap(),
        );
    }
    seal_federated(&Stock, block, &o.fed, &sigs).unwrap()
}

#[test]
fn federation_and_sealed_blocks_are_byte_identical_to_the_reference() {
    let o = oracle();
    let f = &o.expected["federation"];
    assert_eq!(
        o.pubs.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
        o.expected["signers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(o.fed.script.to_hex_string(), f["script"]);
    assert_eq!(o.fed.leaf_hash.to_string(), f["leafHash"]);
    assert_eq!(o.fed.internal_key.to_string(), f["internalKey"]);
    assert_eq!(o.fed.internal_key.to_string(), f["nums"]);
    assert_eq!(o.fed.output_key.to_string(), f["outputKey"]);
    assert_eq!(o.fed.challenge().to_hex_string(), f["challenge"]);
    assert_eq!(hex::encode(&o.fed.control_block), f["controlBlock"]);
    assert_eq!(o.fed.challenge().to_hex_string(), o.doc.challenge);

    // the genesis siding sealed with signers 1 and 3, zero aux
    let unsigned = State::build_genesis_for(&o.doc).unwrap();
    let genesis = seal_with(&o, &unsigned, &[0, 2]);
    assert_eq!(
        hex::encode(serialize(&genesis)),
        o.expected["genesis"]["hex"].as_str().unwrap()
    );
    assert_eq!(
        genesis.header.block_hash().to_string(),
        o.expected["genesis"]["hash"]
    );
    let witness = solution_of(&genesis).unwrap().witness;
    assert_eq!(witness.len(), 5);
    assert!(
        witness[1].is_empty(),
        "signer 2 did not sign: its slot is empty"
    );
    assert_eq!(witness[3], o.fed.script.to_bytes());
    assert_eq!(witness[4], o.fed.control_block);
    let mut state = State::from_genesis(o.doc.clone(), &genesis, None).unwrap();
    assert_eq!(
        state
            .coins(&ScriptBuf::from_hex(&o.doc.pegs[0].script).unwrap())
            .len(),
        1
    );

    // block 1 sealed by 2 and 3 in the reference is accepted here
    let b1 = hex_block(&o.expected["block1"]["hex"]);
    let r = state.add_block(&b1, None, None).unwrap();
    assert_eq!(
        (r.height, r.hash.to_string()),
        (1, o.expected["block1"]["hash"].as_str().unwrap().into())
    );
    assert!(matches!(
        verify_block_solution(&Stock, &b1, &o.fed.challenge()),
        Ok(BlockSolution::ScriptPath(m)) if m.signed == vec![false, true, true] && m.threshold == 2
    ));

    // block 2: the same sighash, the same partial from signer 1, the same sealed bytes with 1 and 2
    let b2 = &o.expected["block2"];
    let unsigned2 = hex_block(&b2["unsignedHex"]);
    let msg = block_sighash_for(
        &Stock,
        &unsigned2,
        &o.fed.challenge(),
        &SpendPath::ScriptPath {
            leaf_hash: o.fed.leaf_hash,
            annex: None,
            codesep_pos: 0xffff_ffff,
        },
    )
    .unwrap();
    assert_eq!(hex::encode(msg), b2["sighash"]);
    let p0 = partial_signature(&Stock, &unsigned2, &o.fed, &o.keys[0], &[0u8; 32]).unwrap();
    assert_eq!(hex::encode(p0.serialize()), b2["partial0"]);
    assert!(verify_partial(&Stock, &unsigned2, &o.fed, &o.pubs[0], &p0));
    assert!(!verify_partial(&Stock, &unsigned2, &o.fed, &o.pubs[1], &p0));
    let sealed2 = seal_with(&o, &unsigned2, &[0, 1]);
    assert_eq!(
        hex::encode(serialize(&sealed2)),
        b2["hex"].as_str().unwrap()
    );
    let r = state.add_block(&sealed2, None, None).unwrap();
    assert_eq!(
        (r.height, r.hash.to_string()),
        (2, b2["hash"].as_str().unwrap().into())
    );
    assert_eq!(
        state.height(),
        o.expected["height"].as_u64().unwrap() as u32
    );
    assert_eq!(state.federation(), Some(&o.fed));
}

#[test]
fn the_reference_refusals_and_the_reviews() {
    let o = oracle();
    let genesis = seal_with(&o, &State::build_genesis_for(&o.doc).unwrap(), &[0, 2]);
    let mut state = State::from_genesis(o.doc.clone(), &genesis, None).unwrap();
    let (b1, _, _) = state
        .build_next(&NextBlock {
            time: state.tip().time + 1,
            claims: vec![],
        })
        .unwrap();
    let challenge = o.fed.challenge();
    let judge = |b: &Block| verify_block_solution(&Stock, b, &challenge);
    let sig =
        |i: usize, b: &Block| partial_signature(&Stock, b, &o.fed, &o.keys[i], &[0u8; 32]).unwrap();
    let manual = |slots: Vec<Vec<u8>>, b: &Block| {
        let mut w: Vec<Vec<u8>> = slots.into_iter().rev().collect();
        w.push(o.fed.script.to_bytes());
        w.push(o.fed.control_block.clone());
        seal_block(&Stock, b, &w).unwrap()
    };
    let s = |i: usize, b: &Block| sig(i, b).serialize().to_vec();

    // produce() is refused on a federated chain
    let e = state
        .produce(&o.keys[0], &NextBlock::default(), None)
        .unwrap_err();
    assert!(matches!(e, Error::Federation(ref m) if m.contains("through the round")));
    // assembleWitness refuses fewer than k signatures
    let one: BTreeMap<_, _> = [(o.pubs[0], sig(0, &b1))].into_iter().collect();
    let e = assemble_witness(&o.fed, &one).unwrap_err().to_string();
    assert!(e.contains("1 of 2"), "{e}");
    // one signature is refused by the validator: NUMEQUAL is exact
    let one_sig = manual(vec![s(0, &b1), vec![], vec![]], &b1);
    assert_eq!(
        judge(&one_sig),
        Err(SolutionError::ScriptPath(ScriptPathError::SignatureCount {
            have: 1,
            need: 2
        }))
    );
    // extra signatures are refused: three valid signatures make NUMEQUAL fail
    let three = manual(vec![s(0, &b1), s(1, &b1), s(2, &b1)], &b1);
    assert_eq!(
        judge(&three),
        Err(SolutionError::ScriptPath(ScriptPathError::SignatureCount {
            have: 3,
            need: 2
        }))
    );
    // signatures in the wrong slots are refused
    let swapped = manual(vec![s(1, &b1), s(0, &b1), vec![]], &b1);
    assert_eq!(
        judge(&swapped),
        Err(SolutionError::ScriptPath(
            ScriptPathError::InvalidSignature { slot: 0 }
        ))
    );
    // a signature over a different block does not transfer
    let other = manual(vec![s(0, &genesis), s(1, &genesis), vec![]], &b1);
    assert!(matches!(
        judge(&other),
        Err(SolutionError::ScriptPath(
            ScriptPathError::InvalidSignature { .. }
        ))
    ));
    // wrong slot count: two slots for three signers
    let short = seal_block(
        &Stock,
        &b1,
        &[
            s(1, &b1),
            s(0, &b1),
            o.fed.script.to_bytes(),
            o.fed.control_block.clone(),
        ],
    )
    .unwrap();
    assert_eq!(
        judge(&short),
        Err(SolutionError::ScriptPath(ScriptPathError::SlotCount {
            have: 2,
            need: 3
        }))
    );
    // a malformed signature in a slot fails the script, not just the slot
    let bad_enc = manual(vec![s(0, &b1), vec![1u8; 63], vec![]], &b1);
    assert_eq!(
        judge(&bad_enc),
        Err(SolutionError::ScriptPath(
            ScriptPathError::BadSignatureEncoding { slot: 1 }
        ))
    );
    let explicit_default = manual(
        vec![[s(0, &b1), vec![0u8]].concat(), s(1, &b1), vec![]],
        &b1,
    );
    assert_eq!(
        judge(&explicit_default),
        Err(SolutionError::ScriptPath(
            ScriptPathError::BadSignatureEncoding { slot: 0 }
        ))
    );
    // control block: flipped parity is a commitment mismatch; a truncated one is malformed
    let good = seal_with(&o, &b1, &[0, 1]);
    let mut w = solution_of(&good).unwrap().witness;
    w[4][0] ^= 1;
    let flipped = seal_block(&Stock, &with_solution(&b1, &w).unwrap(), &w).unwrap();
    assert_eq!(
        judge(&flipped),
        Err(SolutionError::ScriptPath(ScriptPathError::Commitment))
    );
    let mut w = solution_of(&good).unwrap().witness;
    w[4].truncate(20);
    let truncated = seal_block(&Stock, &b1, &w).unwrap();
    assert_eq!(
        judge(&truncated),
        Err(SolutionError::ScriptPath(ScriptPathError::ControlBlock))
    );
    // a leaf that commits correctly but is not the template is refused by name, never "unverifiable"
    let op_true = ScriptBuf::from_bytes(vec![0x51]);
    let leaf = TapNodeHash::from_script(&op_true, LeafVersion::TapScript);
    let (out, parity) = o.fed.internal_key.tap_tweak(secp(), Some(leaf));
    let other_challenge = challenge_for_output_key(&out);
    let mut cb = vec![0xc0 | u8::from(parity)];
    cb.extend_from_slice(&o.fed.internal_key.serialize());
    let anyone = seal_block(&Stock, &b1, &[op_true.to_bytes(), cb]).unwrap();
    assert_eq!(
        verify_block_solution(&Stock, &anyone, &other_challenge),
        Err(SolutionError::ScriptPath(ScriptPathError::NotMultiA))
    );
    // an unknown leaf version with a correct commitment is refused, where the kernel would skip it
    let v = LeafVersion::from_consensus(0xc2).unwrap();
    let leaf = TapNodeHash::from_script(&o.fed.script, v);
    let (out, parity) = o.fed.internal_key.tap_tweak(secp(), Some(leaf));
    let mut cb = vec![0xc2 | u8::from(parity)];
    cb.extend_from_slice(&o.fed.internal_key.serialize());
    let future = seal_block(
        &Stock,
        &b1,
        &[vec![], s(1, &b1), s(0, &b1), o.fed.script.to_bytes(), cb],
    )
    .unwrap();
    assert_eq!(
        verify_block_solution(&Stock, &future, &challenge_for_output_key(&out)),
        Err(SolutionError::ScriptPath(ScriptPathError::LeafVersion(
            0xc2
        )))
    );
    // a key-path witness against the federation's challenge is judged as key path and refused
    let keyed = seal_block(&Stock, &b1, &[s(0, &b1)]).unwrap();
    assert!(matches!(judge(&keyed), Err(SolutionError::KeyPath(_))));
    assert_eq!(
        verify_block_solution(&Stock, &b1, &challenge),
        Err(SolutionError::NoSolution)
    );
    // a document whose challenge is not the derived one is refused
    let mut wrong: serde_json::Value = serde_json::from_str(&fixture("chain.json")).unwrap();
    wrong["challenge"] = serde_json::json!(format!("5120{}", "11".repeat(32)));
    let e = ChainDocument::from_json(&wrong.to_string())
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("is not the one 3 signers with threshold 2 derive"),
        "{e}"
    );
    // a partial from a key outside the federation is refused at signing
    assert!(
        partial_signature(&Stock, &b1, &o.fed, &common::signer("outsider"), &[0u8; 32]).is_err()
    );
    // and a correct block after all that is accepted
    assert_eq!(state.add_block(&good, None, None).unwrap().height, 1);
}

#[test]
fn consensus_accepts_annex_and_non_default_sighash_partials() {
    let o = oracle();
    let genesis = seal_with(&o, &State::build_genesis_for(&o.doc).unwrap(), &[1, 2]);
    let state = State::from_genesis(o.doc.clone(), &genesis, None).unwrap();
    let (b1, _, _) = state
        .build_next(&NextBlock {
            time: state.tip().time + 1,
            claims: vec![],
        })
        .unwrap();
    let challenge = o.fed.challenge();
    // a signer may use an explicit hash type: 65-byte signatures are consensus-valid, whatever policy emits
    let sign_as = |i: usize, b: &Block, hash_type: u8, annex: Option<&[u8]>| {
        let data = sidestr_core::block::block_data(&Stock, b);
        let v = virtual_txs(&data, &challenge, &[]);
        let msg = SighashCache::new(&v.to_sign)
            .taproot_signature_hash(
                0,
                &Prevouts::All(&[v.prevout]),
                annex.map(|a| Annex::new(a).unwrap()),
                Some((o.fed.leaf_hash, 0xffff_ffff)),
                TapSighashType::from_consensus_u8(hash_type).unwrap(),
            )
            .unwrap();
        let sig = secp()
            .sign_schnorr_with_aux_rand(
                &Message::from_digest(msg.to_byte_array()),
                &Keypair::from_secret_key(secp(), &o.keys[i]),
                &[0u8; 32],
            )
            .serialize()
            .to_vec();
        if hash_type == 0 {
            sig
        } else {
            [sig, vec![hash_type]].concat()
        }
    };
    for (ht0, ht1) in [(0x01u8, 0x00u8), (0x02, 0x83), (0x81, 0x03)] {
        let w = vec![
            vec![],
            sign_as(1, &b1, ht1, None),
            sign_as(0, &b1, ht0, None),
            o.fed.script.to_bytes(),
            o.fed.control_block.clone(),
        ];
        let sealed = seal_block(&Stock, &b1, &w).unwrap();
        assert!(
            verify_block_solution(&Stock, &sealed, &challenge).is_ok(),
            "hash types {ht0:#x} {ht1:#x}"
        );
    }
    // an annex: the signatures commit to it, and the validator reads it
    let annex = vec![0x50u8, 0xde, 0xad];
    let w = vec![
        sign_as(2, &b1, 0x00, Some(&annex)),
        vec![],
        sign_as(0, &b1, 0x00, Some(&annex)),
        o.fed.script.to_bytes(),
        o.fed.control_block.clone(),
        annex.clone(),
    ];
    let sealed = seal_block(&Stock, &b1, &w).unwrap();
    assert!(verify_block_solution(&Stock, &sealed, &challenge).is_ok());
    // the same signatures without the annex do not verify
    let mut without = w.clone();
    without.pop();
    let sealed = seal_block(&Stock, &b1, &without).unwrap();
    assert!(matches!(
        verify_block_solution(&Stock, &sealed, &challenge),
        Err(SolutionError::ScriptPath(
            ScriptPathError::InvalidSignature { .. }
        ))
    ));
}

#[test]
fn template_id_survives_sealing_and_the_block_hash_does_not() {
    let o = oracle();
    let unsigned = State::build_genesis_for(&o.doc).unwrap();
    let a = seal_with(&o, &unsigned, &[0, 1]);
    let b = seal_with(&o, &unsigned, &[1, 2]);
    let c = seal_with(&o, &unsigned, &[0, 2]);
    assert!(
        a.header.block_hash() != b.header.block_hash()
            && b.header.block_hash() != c.header.block_hash()
    );
    let id = |blk: &Block| template_id(&Stock, blk, &o.doc.id, None).unwrap();
    assert_eq!(id(&unsigned), id(&a));
    assert_eq!(id(&a), id(&b));
    assert_eq!(id(&b), id(&c));
    // scope matters: another chain id or genesis is another template
    assert_ne!(
        id(&unsigned),
        template_id(&Stock, &unsigned, "sidestr:other", None).unwrap()
    );
    assert_ne!(
        id(&unsigned),
        template_id(&Stock, &unsigned, &o.doc.id, Some(a.header.block_hash())).unwrap()
    );
    // and a template with different content is a different id
    let mut moved = unsigned.clone();
    moved.header.time += 1;
    assert_ne!(id(&unsigned), id(&moved));
}

#[test]
fn a_federated_chain_opens_with_a_seal_and_replays_without_one() {
    let o = oracle();
    let dir = TempDir::new("fed");
    let chain =
        Chain::open_sealed(o.doc.clone(), &dir.0, |g| Ok(seal_with(&o, g, &[0, 2]))).unwrap();
    assert_eq!(
        chain.state().genesis_hash().to_string(),
        o.expected["genesis"]["hash"]
    );
    let (b1, _, _) = chain
        .state()
        .build_next(&NextBlock {
            time: chain.state().tip().time + 1,
            claims: vec![],
        })
        .unwrap();
    let mut chain = chain;
    chain
        .add_block(&serialize(&seal_with(&o, &b1, &[1, 2])), None)
        .unwrap();
    // reopening does not need the seal, or any key
    let again = Chain::open_sealed(o.doc.clone(), &dir.0, |_| panic!("not needed")).unwrap();
    assert_eq!(again.state().height(), 1);
    let no_key = Chain::open(o.doc.clone(), &dir.0, None).unwrap();
    assert_eq!(no_key.state().tip(), again.state().tip());
    // and a fresh federated chain cannot be made with one key
    let empty = TempDir::new("fed-empty");
    assert!(matches!(
        Chain::open(o.doc.clone(), &empty.0, Some(&o.keys[0])),
        Err(Error::Federation(_))
    ));
}
