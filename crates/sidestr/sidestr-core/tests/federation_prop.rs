//! Property tests over the `multi_a` verifier (review §10, "signature
//! subsets … both output parities"): for every `n ≤ 6`, every `k ≤ n` and
//! every subset of signers, a sealed block verifies exactly when the subset
//! has `k` members; and over many chain ids both output-key parities occur
//! and verify.

use std::collections::BTreeMap;

use bitcoin::hashes::Hash;
use bitcoin::secp256k1::{Parity, SecretKey, XOnlyPublicKey};
use bitcoin::{Block, BlockHash, CompactTarget};
use proptest::prelude::*;
use sidestr_core::block::SolutionError;
use sidestr_core::block::{
    build_block, pubkey_of, seal_block, verify_block_solution, BlockSolution, BlockTemplate, Stock,
};
use sidestr_core::federation::{
    assemble_witness, partial_signature, seal_federated, Federation, ScriptPathError,
};

fn keys(n: usize) -> (Vec<SecretKey>, Vec<XOnlyPublicKey>) {
    let ks: Vec<SecretKey> = (1..=n)
        .map(|i| SecretKey::from_slice(&[i as u8; 32]).unwrap())
        .collect();
    let ps = ks.iter().map(pubkey_of).collect();
    (ks, ps)
}

fn template(salt: u32) -> Block {
    build_block(
        &Stock,
        &BlockTemplate {
            height: 0,
            prev: BlockHash::all_zeros(),
            time: 1_790_000_000 + salt,
            transactions: vec![],
            outputs: vec![],
            bits: CompactTarget::from_consensus(0x207f_ffff),
            marker: "sidestr genesis sidestr:prop".into(),
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, ..ProptestConfig::default() })]

    #[test]
    fn a_subset_seals_exactly_when_it_has_k_members(
        (n, k, mask) in (1usize..=6).prop_flat_map(|n| (Just(n), 1usize..=n, prop::collection::vec(any::<bool>(), n))),
        salt in 0u32..1000,
    ) {
        let (ks, ps) = keys(n);
        let fed = Federation::new(&format!("sidestr:prop-{salt}"), ps.clone(), k as u8).unwrap();
        let block = template(salt);
        let mut slots: Vec<Vec<u8>> = Vec::with_capacity(n);
        let mut signed = 0;
        for (i, on) in mask.iter().enumerate() {
            if *on {
                slots.push(partial_signature(&Stock, &block, &fed, &ks[i], &[0u8; 32]).unwrap().serialize().to_vec());
                signed += 1;
            } else {
                slots.push(vec![]);
            }
        }
        let mut w: Vec<Vec<u8>> = slots.into_iter().rev().collect();
        w.push(fed.script.to_bytes());
        w.push(fed.control_block.clone());
        let sealed = seal_block(&Stock, &block, &w).unwrap();
        let verdict = verify_block_solution(&Stock, &sealed, &fed.challenge());
        if signed == k {
            prop_assert!(matches!(&verdict, Ok(BlockSolution::ScriptPath(m)) if m.signed == mask && m.threshold == k as u8), "{verdict:?}");
        } else {
            prop_assert_eq!(verdict, Err(SolutionError::ScriptPath(ScriptPathError::SignatureCount { have: signed, need: k as u8 })));
        }
        // assembling from the same signatures picks the first k in leaf order and always verifies
        if signed >= k {
            let mut sigs = BTreeMap::new();
            for (i, on) in mask.iter().enumerate() {
                if *on { sigs.insert(ps[i], partial_signature(&Stock, &block, &fed, &ks[i], &[0u8; 32]).unwrap()); }
            }
            let a = assemble_witness(&fed, &sigs).unwrap();
            prop_assert_eq!(a.len(), n + 2);
            let sealed = seal_federated(&Stock, &block, &fed, &sigs).unwrap();
            prop_assert!(verify_block_solution(&Stock, &sealed, &fed.challenge()).is_ok());
        }
    }
}

#[test]
fn both_output_key_parities_occur_and_verify() {
    let (ks, ps) = keys(3);
    let block = template(7);
    let mut seen = [false, false];
    for i in 0..64u32 {
        let fed = Federation::new(&format!("sidestr:parity-{i}"), ps.clone(), 2).unwrap();
        seen[usize::from(fed.parity == Parity::Odd)] = true;
        assert_eq!(fed.control_block[0], 0xc0 | u8::from(fed.parity));
        let mut sigs = BTreeMap::new();
        for j in [i as usize % 3, (i as usize + 1) % 3] {
            sigs.insert(
                ps[j],
                partial_signature(&Stock, &block, &fed, &ks[j], &[0u8; 32]).unwrap(),
            );
        }
        let sealed = seal_federated(&Stock, &block, &fed, &sigs).unwrap();
        assert!(
            verify_block_solution(&Stock, &sealed, &fed.challenge()).is_ok(),
            "chain {i}"
        );
        // the wrong parity byte is a commitment mismatch, whichever parity is right
        let mut w = sidestr_core::block::solution_of(&sealed).unwrap().witness;
        w[4][0] ^= 1;
        let flipped = seal_block(&Stock, &block, &w).unwrap();
        assert_eq!(
            verify_block_solution(&Stock, &flipped, &fed.challenge()),
            Err(SolutionError::ScriptPath(ScriptPathError::Commitment))
        );
        let _ = sealed.header.block_hash();
    }
    assert_eq!(seen, [true, true], "both parities in 64 chain ids");
}
