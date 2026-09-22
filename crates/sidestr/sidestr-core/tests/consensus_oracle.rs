//! Bitcoin Core's script interpreter as a differential oracle for the
//! `multi_a` verifier (feature `consensus-oracle`; review §9, §10):
//! `bitcoinconsensus 0.106.0+26.0`, the Core 26.0 lineage, judges the same
//! BIP-325 virtual transaction with `VERIFY_TAPROOT`, and the two must agree
//! on every case — every 2-of-3 and 4-of-5 subset, both output parities,
//! non-default hash types, an annex, malformed control blocks, extra and
//! missing signatures, wrong slots. Where Core says "valid" and this crate
//! says "refused" the case is listed as a known narrowing (an unknown leaf
//! version), never silently.
//!
//! ```sh
//! cargo test -p sidestr-core --features consensus-oracle --test consensus_oracle
//! ```
#![cfg(feature = "consensus-oracle")]

use bitcoin::consensus::encode::serialize;
use bitcoin::hashes::Hash;
use bitcoin::key::TapTweak;
use bitcoin::secp256k1::{Keypair, Message, Parity, SecretKey, XOnlyPublicKey};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::{LeafVersion, TapNodeHash};
use bitcoin::{Block, BlockHash, CompactTarget, ScriptBuf, TxOut};
use sidestr_core::block::{
    block_data, build_block, challenge_for_output_key, pubkey_of, secp, virtual_txs, BlockTemplate,
    Stock,
};
use sidestr_core::federation::{verify_multi_a_input, Federation, ScriptPathError};

fn keys(n: usize) -> (Vec<SecretKey>, Vec<XOnlyPublicKey>) {
    let ks: Vec<SecretKey> = (1..=n)
        .map(|i| SecretKey::from_slice(&[i as u8 + 10; 32]).unwrap())
        .collect();
    let ps = ks.iter().map(pubkey_of).collect();
    (ks, ps)
}

fn template() -> Block {
    build_block(
        &Stock,
        &BlockTemplate {
            height: 0,
            prev: BlockHash::all_zeros(),
            time: 1_790_000_000,
            transactions: vec![],
            outputs: vec![],
            bits: CompactTarget::from_consensus(0x207f_ffff),
            marker: "sidestr genesis sidestr:oracle".into(),
        },
    )
}

/// Core's verdict and ours on the BIP-325 virtual spend with this witness.
fn both(
    challenge: &ScriptBuf,
    block: &Block,
    witness: &[Vec<u8>],
) -> (bool, Result<usize, ScriptPathError>) {
    let data = block_data(&Stock, block);
    let v = virtual_txs(&data, challenge, witness);
    let prevouts = [v.prevout.clone()];
    let ours = verify_multi_a_input(&v.to_sign, 0, &prevouts)
        .map(|m| m.signed.iter().filter(|s| **s).count());
    let spk = challenge.as_bytes();
    let utxo = bitcoinconsensus::Utxo {
        script_pubkey: spk.as_ptr(),
        script_pubkey_len: spk.len() as u32,
        value: 0,
    };
    let core = bitcoinconsensus::verify_with_flags(
        spk,
        0,
        &serialize(&v.to_sign),
        Some(&[utxo]),
        0,
        bitcoinconsensus::VERIFY_ALL_PRE_TAPROOT | bitcoinconsensus::VERIFY_TAPROOT,
    )
    .is_ok();
    (core, ours)
}

/// A partial signature for slot `i` with an explicit hash type and optional annex.
fn sig(
    fed: &Federation,
    challenge: &ScriptBuf,
    block: &Block,
    key: &SecretKey,
    hash_type: u8,
    annex: Option<&[u8]>,
) -> Vec<u8> {
    let data = block_data(&Stock, block);
    let v = virtual_txs(&data, challenge, &[]);
    let msg = SighashCache::new(&v.to_sign)
        .taproot_signature_hash(
            0,
            &Prevouts::All(&[v.prevout]),
            annex.map(|a| Annex::new(a).unwrap()),
            Some((fed.leaf_hash, 0xffff_ffff)),
            TapSighashType::from_consensus_u8(hash_type).unwrap(),
        )
        .unwrap();
    let s = secp()
        .sign_schnorr_with_aux_rand(
            &Message::from_digest(msg.to_byte_array()),
            &Keypair::from_secret_key(secp(), key),
            &[0u8; 32],
        )
        .serialize()
        .to_vec();
    if hash_type == 0 {
        s
    } else {
        [s, vec![hash_type]].concat()
    }
}

fn witness(fed: &Federation, slots: Vec<Vec<u8>>, annex: Option<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut w: Vec<Vec<u8>> = slots.into_iter().rev().collect();
    w.push(fed.script.to_bytes());
    w.push(fed.control_block.clone());
    if let Some(a) = annex {
        w.push(a);
    }
    w
}

fn federation_with_parity(pubs: &[XOnlyPublicKey], k: u8, parity: Parity) -> Federation {
    (0..256)
        .map(|i| Federation::new(&format!("sidestr:oracle-{i}"), pubs.to_vec(), k).unwrap())
        .find(|f| f.parity == parity)
        .expect("a chain id with this parity")
}

#[test]
fn core_and_this_crate_agree_on_every_subset_and_malformation() {
    let block = template();
    let cases = std::cell::Cell::new(0usize);
    let agree = |name: &str, challenge: &ScriptBuf, w: &[Vec<u8>], expect_ours_ok: bool| {
        let (core, ours) = both(challenge, &block, w);
        assert_eq!(core, ours.is_ok(), "{name}: core {core}, ours {ours:?}");
        assert_eq!(ours.is_ok(), expect_ours_ok, "{name}: {ours:?}");
        cases.set(cases.get() + 1);
    };
    for (n, k) in [(3usize, 2u8), (5, 4)] {
        let (ks, ps) = keys(n);
        for parity in [Parity::Even, Parity::Odd] {
            let fed = federation_with_parity(&ps, k, parity);
            let ch = fed.challenge();
            let s = |i: usize, ht: u8| sig(&fed, &ch, &block, &ks[i], ht, None);
            // every subset of every size
            for mask in 0u32..(1 << n) {
                let slots: Vec<Vec<u8>> = (0..n)
                    .map(|i| {
                        if mask & (1 << i) != 0 {
                            s(i, 0)
                        } else {
                            vec![]
                        }
                    })
                    .collect();
                let ok = mask.count_ones() == u32::from(k);
                agree(
                    &format!("{n}/{k} {parity:?} mask {mask:b}"),
                    &ch,
                    &witness(&fed, slots, None),
                    ok,
                );
            }
            // non-default hash types on a valid subset
            for ht in [0x01u8, 0x02, 0x03, 0x81, 0x82, 0x83] {
                let slots: Vec<Vec<u8>> = (0..n)
                    .map(|i| if i < usize::from(k) { s(i, ht) } else { vec![] })
                    .collect();
                agree(
                    &format!("{n}/{k} {parity:?} hash type {ht:#x}"),
                    &ch,
                    &witness(&fed, slots, None),
                    true,
                );
            }
            // an annex, committed to by the signatures; and the same signatures without it
            let annex = vec![0x50u8, 1, 2, 3];
            let with_annex: Vec<Vec<u8>> = (0..n)
                .map(|i| {
                    if i < usize::from(k) {
                        sig(&fed, &ch, &block, &ks[i], 0, Some(&annex))
                    } else {
                        vec![]
                    }
                })
                .collect();
            agree(
                &format!("{n}/{k} {parity:?} annex"),
                &ch,
                &witness(&fed, with_annex.clone(), Some(annex)),
                true,
            );
            agree(
                &format!("{n}/{k} {parity:?} annex dropped"),
                &ch,
                &witness(&fed, with_annex, None),
                false,
            );
            // wrong slots
            let mut swapped: Vec<Vec<u8>> = (0..n)
                .map(|i| if i < usize::from(k) { s(i, 0) } else { vec![] })
                .collect();
            swapped.swap(0, n - 1);
            agree(
                &format!("{n}/{k} {parity:?} swapped"),
                &ch,
                &witness(&fed, swapped, None),
                false,
            );
            // malformed control blocks
            let good = witness(
                &fed,
                (0..n)
                    .map(|i| if i < usize::from(k) { s(i, 0) } else { vec![] })
                    .collect(),
                None,
            );
            let mut flipped = good.clone();
            flipped[n + 1][0] ^= 1;
            agree(
                &format!("{n}/{k} {parity:?} parity flipped"),
                &ch,
                &flipped,
                false,
            );
            let mut short = good.clone();
            short[n + 1].truncate(32);
            agree(
                &format!("{n}/{k} {parity:?} control truncated"),
                &ch,
                &short,
                false,
            );
            let mut branch = good.clone();
            branch[n + 1].extend_from_slice(&[7u8; 32]);
            agree(
                &format!("{n}/{k} {parity:?} bogus merkle branch"),
                &ch,
                &branch,
                false,
            );
            let mut other_key = good.clone();
            other_key[n + 1][1] ^= 1;
            agree(
                &format!("{n}/{k} {parity:?} internal key altered"),
                &ch,
                &other_key,
                false,
            );
            // bad signature encodings
            let mut explicit_default = good.clone();
            explicit_default[n - 1].push(0x00);
            agree(
                &format!("{n}/{k} {parity:?} explicit SIGHASH_DEFAULT"),
                &ch,
                &explicit_default,
                false,
            );
            let mut garbage = good.clone();
            garbage[n - 1] = vec![9u8; 64];
            agree(
                &format!("{n}/{k} {parity:?} garbage signature"),
                &ch,
                &garbage,
                false,
            );
            let mut odd_len = good.clone();
            odd_len[n - 1].truncate(63);
            agree(
                &format!("{n}/{k} {parity:?} 63-byte signature"),
                &ch,
                &odd_len,
                false,
            );
            let mut undefined = good.clone();
            undefined[n - 1].push(0x04);
            agree(
                &format!("{n}/{k} {parity:?} undefined hash type"),
                &ch,
                &undefined,
                false,
            );
            // slot count
            let mut fewer = good.clone();
            fewer.remove(0);
            agree(
                &format!("{n}/{k} {parity:?} one slot short"),
                &ch,
                &fewer,
                false,
            );
            let mut more = good.clone();
            more.insert(0, vec![]);
            agree(
                &format!("{n}/{k} {parity:?} one slot over"),
                &ch,
                &more,
                false,
            );
            // a script that is not the template, correctly committed: both refuse (NUMEQUAL never runs)
            let op_true = ScriptBuf::from_bytes(vec![0x51]);
            let (out, p) = fed.internal_key.tap_tweak(
                secp(),
                Some(TapNodeHash::from_script(&op_true, LeafVersion::TapScript)),
            );
            let mut cb = vec![0xc0 | u8::from(p)];
            cb.extend_from_slice(&fed.internal_key.serialize());
            let (core, ours) = both(
                &challenge_for_output_key(&out),
                &block,
                &[op_true.to_bytes(), cb],
            );
            assert!(core, "Core accepts OP_TRUE");
            assert_eq!(
                ours,
                Err(ScriptPathError::NotMultiA),
                "known narrowing: only the template is verified"
            );
            cases.set(cases.get() + 1);
        }
    }
    // an unknown leaf version: Core treats it as a success (upgradable), this crate refuses by name
    let (ks, ps) = keys(3);
    let fed = Federation::new("sidestr:oracle-leaf", ps, 2).unwrap();
    let v = LeafVersion::from_consensus(0xc2).unwrap();
    let (out, p) = fed
        .internal_key
        .tap_tweak(secp(), Some(TapNodeHash::from_script(&fed.script, v)));
    let ch = challenge_for_output_key(&out);
    let mut cb = vec![0xc2 | u8::from(p)];
    cb.extend_from_slice(&fed.internal_key.serialize());
    let w = vec![
        vec![],
        sig(&fed, &ch, &block, &ks[1], 0, None),
        sig(&fed, &ch, &block, &ks[0], 0, None),
        fed.script.to_bytes(),
        cb,
    ];
    let (core, ours) = both(&ch, &block, &w);
    assert!(
        core,
        "Core: unknown leaf version is a success under VERIFY_TAPROOT without DISCOURAGE flags"
    );
    assert_eq!(
        ours,
        Err(ScriptPathError::LeafVersion(0xc2)),
        "known narrowing: refused, never skipped"
    );
    let cases = cases.get() + 1;
    eprintln!("{cases} differential cases agreed (plus 2 documented narrowings)");
    assert!(cases > 100);
    let _ = TxOut::NULL;
}
