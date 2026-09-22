//! The peg-out round as a state machine: the payer ring, every refusal
//! `pegoutround.mjs` logs, the fee cap, a co-signature that is not one,
//! finalisation verified under BIP 342, one signature per burn across a
//! restart, and the drop after the timeout.

mod support;

use std::collections::BTreeMap;

use bitcoin::OutPoint;
use sidestr_core::block::pubkey_of;
use sidestr_core::federation::Federation;
use sidestr_core::marker::Burn;
use sidestr_nostr::round::{sign_pegout_psbt, sign_pegout_signed, PegoutPsbt, PegoutSigned};
use sidestr_nostr::tags::Outpoint;
use sidestr_round::journal::{MemoryJournal, VoteJournal, VoteRole, VoteScope};
use sidestr_round::pegout::*;
use sidestr_round::signer::LocalKey;
use support::*;

const T0: u64 = 1_790_000_100;
const CHAIN: &str = "sidestr:pegout";

fn fed() -> Federation {
    Federation::new(CHAIN, keys(3).iter().map(pubkey_of).collect(), 2).unwrap()
}
fn burn(height: u32, value: u64) -> Burn {
    Burn {
        txid: format!("{:02x}", height).repeat(32),
        vout: 0,
        script: format!("5120{}", "e9".repeat(32)),
        value,
        height,
    }
}
fn coins() -> Vec<PegCoin> {
    vec![
        PegCoin {
            outpoint: OutPoint {
                txid: "aa".repeat(32).parse().unwrap(),
                vout: 0,
            },
            value: 60_000,
        },
        PegCoin {
            outpoint: OutPoint {
                txid: "bb".repeat(32).parse().unwrap(),
                vout: 1,
            },
            value: 1_000_000,
        },
    ]
}
fn round(i: usize, cfg: PegoutConfig, journal: Box<dyn VoteJournal>) -> PegoutRound {
    PegoutRound::new(
        fed(),
        CHAIN,
        local(&keys(3)[i]),
        journal,
        cfg,
        PegoutLedger::default(),
    )
    .unwrap()
}
fn cfg() -> PegoutConfig {
    PegoutConfig::upstream(30, Some(bitcoin::Network::Testnet4))
}
fn logs(a: &[PegoutAction]) -> Vec<String> {
    a.iter()
        .filter_map(|x| match x {
            PegoutAction::Log(s) => Some(s.clone()),
            _ => None,
        })
        .collect()
}
fn published(a: &[PegoutAction]) -> Vec<sidestr_nostr::Event> {
    a.iter()
        .filter_map(|x| match x {
            PegoutAction::Publish(e) => Some(e.clone()),
            _ => None,
        })
        .collect()
}
fn broadcast(a: &[PegoutAction]) -> Vec<FinalisedPegout> {
    a.iter()
        .filter_map(|x| match x {
            PegoutAction::Broadcast(f) => Some(f.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_payer_proposes_a_cosigner_checks_and_signs_and_k_finalises() {
    let b = burn(7, 20_000); // 7 mod 3 = 1: slot 1 pays
    let mut r0 = round(0, cfg(), Box::new(MemoryJournal::new()));
    let mut r1 = round(1, cfg(), Box::new(MemoryJournal::new()));
    let mut r2 = round(2, cfg(), Box::new(MemoryJournal::new()));
    assert!(r0.tick(T0, std::slice::from_ref(&b), &coins()).is_empty());
    let a = r1.tick(T0, std::slice::from_ref(&b), &coins());
    let p = published(&a)[0].clone();
    assert_eq!(p.kind, 23512);
    assert_eq!(
        p.tags,
        vec![
            vec!["chain", CHAIN],
            vec!["d", &burn_key(&b)],
            vec!["h", "7"]
        ]
    );
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposed payment of {}… (20000 sats)",
            &burn_key(&b)[..16]
        )]
    );
    // the PSBT is what upstream's psbtPaysBurn accepts, funded from the largest coin
    let psbt = psbt_from_base64(&p.content).unwrap();
    assert_eq!(psbt.unsigned_tx.input.len(), 1);
    assert_eq!(
        psbt.inputs[0].witness_utxo.as_ref().unwrap().value.to_sat(),
        1_000_000
    );
    assert_eq!(psbt.unsigned_tx.output.len(), 3, "pay, marker, change");
    assert!(psbt.unsigned_tx.output[1].script_pubkey.is_op_return());
    assert_eq!(psbt.inputs[0].tap_scripts.len(), 1);
    assert_eq!(psbt.inputs[0].tap_key_origins.len(), 3);
    assert_eq!(
        psbt.inputs[0].tap_script_sigs.len(),
        1,
        "the payer's own signature"
    );
    // slot 0 co-signs; slot 2 too
    let a0 = r0.on_event(T0 + 1, &p, std::slice::from_ref(&b));
    let s0 = published(&a0)[0].clone();
    assert_eq!(
        (s0.kind, s0.tags[2].clone()),
        (23513, vec!["e".to_string(), p.id.clone()])
    );
    assert_eq!(
        logs(&a0),
        vec![format!(
            "peg-out round: signed payment of {}… proposed by {}…",
            &burn_key(&b)[..16],
            &p.pubkey[..8]
        )]
    );
    let a2 = r2.on_event(T0 + 1, &p, std::slice::from_ref(&b));
    assert_eq!(published(&a2).len(), 1);
    // with k the payer finalises and hands the transaction over
    let a = r1.on_event(T0 + 2, &s0, std::slice::from_ref(&b));
    assert_eq!(
        logs(&a)[0],
        format!("peg-out round: 2/2 signatures for {}…", &burn_key(&b)[..16])
    );
    let f = &broadcast(&a)[0];
    assert!(
        logs(&a)[1].starts_with(&format!(
            "peg-out {}…: paid 20000 sats to tb1p",
            &burn_key(&b)[..16]
        )),
        "{:?}",
        logs(&a)
    );
    assert_eq!(f.record.signers.len(), 2);
    assert_eq!(f.record.parent_txid, f.tx.compute_txid().to_string());
    // and it verifies under BIP 342 against the federation's descriptor leaf
    let prevouts = prevouts_of(&psbt).unwrap();
    let spends = verify_pegout_transaction(&f.tx, &prevouts).unwrap();
    assert_eq!(
        spends[0].signed,
        vec![true, true, false],
        "the first k in leaf order"
    );
    assert_eq!(f.tx.output[0].value.to_sat(), 20_000);
    // the third signature is now nothing; the record is kept on the caller's word
    assert!(r1
        .on_event(T0 + 3, &published(&a2)[0], std::slice::from_ref(&b))
        .is_empty());
    r1.mark_paid(&burn_key(&b), f.record.clone());
    assert!(r1
        .tick(T0 + 4, std::slice::from_ref(&b), &coins())
        .is_empty());
    assert!(r1.ledger().paid.contains_key(&burn_key(&b)));
    let json = serde_json::to_string(r1.ledger()).unwrap();
    assert!(json.contains("\"parentTxid\""), "{json}");
}

#[test]
fn lateness_moves_the_payer_ring_and_a_stale_proposal_is_dropped() {
    let b = burn(7, 20_000);
    let mut r2 = round(2, cfg(), Box::new(MemoryJournal::new()));
    assert!(r2.tick(T0, std::slice::from_ref(&b), &coins()).is_empty());
    assert!(r2
        .tick(T0 + 29, std::slice::from_ref(&b), &coins())
        .is_empty());
    let a = r2.tick(T0 + 30, std::slice::from_ref(&b), &coins());
    assert_eq!(published(&a)[0].kind, 23512);
    assert!(r2
        .tick(T0 + 89, std::slice::from_ref(&b), &coins())
        .is_empty());
    let a = r2.tick(T0 + 121, std::slice::from_ref(&b), &coins());
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: dropping my proposal for {}… (1 signature(s))",
            &burn_key(&b)[..16]
        )]
    );
    assert!(r2.pending().is_empty());
    // nothing to fund it with: the failure is logged and the burn waits a full ring
    let a = r2.tick(T0 + 122, std::slice::from_ref(&b), &[]);
    assert!(
        logs(&a)[0].starts_with("peg-out round: peg-out: insufficient peg coins"),
        "{a:?}"
    );
    assert!(r2
        .tick(T0 + 200, std::slice::from_ref(&b), &coins())
        .is_empty());
    assert_eq!(
        published(&r2.tick(T0 + 213, std::slice::from_ref(&b), &coins())).len(),
        1
    );
}

#[test]
fn refusals_are_logged_as_pegoutround_mjs_logs_them() {
    let ks = keys(3);
    let b = burn(7, 20_000);
    let key = burn_key(&b);
    let mut r0 = round(0, cfg(), Box::new(MemoryJournal::new()));
    let payer = LocalKey::new(ks[1]);
    let good = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    let ev = |psbt: &str, from: &LocalKey, at: u64| {
        sign_pegout_psbt(
            from,
            &PegoutPsbt {
                chain_id: CHAIN.into(),
                burn: Outpoint {
                    txid: b.txid.clone(),
                    vout: 0,
                },
                height: 7,
                psbt: psbt.into(),
            },
            at,
        )
        .unwrap()
    };
    // not a burn I know
    let a = r0.on_event(T0, &ev(&good.to_string(), &payer, T0), &[]);
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposal for {}… ignored: not a burn I know",
            &key[..16]
        )]
    );
    // not the payer yet (slot 2 at t0)
    let a = r0.on_event(
        T0,
        &ev(&good.to_string(), &LocalKey::new(ks[2]), T0),
        std::slice::from_ref(&b),
    );
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: {}… is not the payer for {}… yet",
            &pubkey_of(&ks[2]).to_string()[..8],
            &key[..16]
        )]
    );
    // a stranger is silent
    assert!(r0
        .on_event(
            T0,
            &ev(&good.to_string(), &LocalKey::new(key_("stranger")), T0),
            std::slice::from_ref(&b)
        )
        .is_empty());
    // not a PSBT
    let a = r0.on_event(
        T0,
        &ev("cHNidP8BAA==", &payer, T0 + 1),
        std::slice::from_ref(&b),
    );
    assert!(
        logs(&a)[0].starts_with("peg-out round: peg-out: not a PSBT"),
        "{a:?}"
    );
    // pays the wrong amount / no marker / something else / a fee over the cap / not from the peg
    let mut wrong = good.clone();
    wrong.unsigned_tx.output[0].value = bitcoin::Amount::from_sat(19_999);
    let a = r0.on_event(
        T0,
        &ev(&wrong.to_string(), &payer, T0 + 2),
        std::slice::from_ref(&b),
    );
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposal for {}… refused: does not pay the burn with its marker",
            &key[..16]
        )]
    );
    let mut extra = good.clone();
    extra.unsigned_tx.output[2].script_pubkey = wallet_script();
    let a = r0.on_event(
        T0,
        &ev(&extra.to_string(), &payer, T0 + 3),
        std::slice::from_ref(&b),
    );
    assert_eq!(logs(&a), vec![format!("peg-out round: proposal for {}… refused: pays something besides the burn and change to the peg", &key[..16])]);
    let mut greedy = good.clone();
    greedy.unsigned_tx.output[2].value = bitcoin::Amount::from_sat(1_000);
    let a = r0.on_event(
        T0,
        &ev(&greedy.to_string(), &payer, T0 + 4),
        std::slice::from_ref(&b),
    );
    assert!(
        logs(&a)[0].contains("refused: fee 979000 sats is over this signer's cap of 100000"),
        "{a:?}"
    );
    let mut foreign = good.clone();
    foreign.inputs[0]
        .witness_utxo
        .as_mut()
        .unwrap()
        .script_pubkey = wallet_script();
    let a = r0.on_event(
        T0,
        &ev(&foreign.to_string(), &payer, T0 + 5),
        std::slice::from_ref(&b),
    );
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposal for {}… refused: spends something that is not the peg",
            &key[..16]
        )]
    );
    // the good one is signed; the same burn again within the window is silent; after it, signed again (upstream)
    let g = ev(&good.to_string(), &payer, T0 + 6);
    let a = r0.on_event(T0 + 6, &g, std::slice::from_ref(&b));
    assert_eq!(published(&a).len(), 1);
    let g2 = ev(&good.to_string(), &payer, T0 + 7);
    assert!(r0
        .on_event(T0 + 20, &g2, std::slice::from_ref(&b))
        .is_empty());
    let g3 = ev(&good.to_string(), &payer, T0 + 8);
    assert_eq!(
        published(&r0.on_event(T0 + 36, &g3, std::slice::from_ref(&b))).len(),
        1
    );
    // with resign_after = None, never
    let mut never = round(
        0,
        PegoutConfig {
            resign_after: None,
            ..cfg()
        },
        Box::new(MemoryJournal::new()),
    );
    assert_eq!(
        published(&never.on_event(T0, &g, std::slice::from_ref(&b))).len(),
        1
    );
    assert!(never
        .on_event(T0 + 1_000_000, &g3, std::slice::from_ref(&b))
        .is_empty());

    // the payer refuses a 23513 that is not a signature over its proposal
    let mut r1 = round(1, cfg(), Box::new(MemoryJournal::new()));
    let p = published(&r1.tick(T0, std::slice::from_ref(&b), &coins()))[0].clone();
    let mine = psbt_from_base64(&p.content).unwrap();
    let co = LocalKey::new(ks[0]);
    let signed = |psbt: &bitcoin::psbt::Psbt| {
        sign_pegout_signed(
            &co,
            &PegoutSigned {
                chain_id: CHAIN.into(),
                burn: Outpoint {
                    txid: b.txid.clone(),
                    vout: 0,
                },
                request: p.id.clone(),
                psbt: psbt.to_string(),
            },
            T0 + 1,
        )
        .unwrap()
    };
    // unsigned: no signature by its author
    let a = r1.on_event(T0 + 1, &signed(&mine), std::slice::from_ref(&b));
    assert!(logs(&a)[0].ends_with("no signature by its author"), "{a:?}");
    // signed by the wrong key for the claimed author
    let mut forged = mine.clone();
    sign_pegout_psbt_fn(&mut forged, &LocalKey::new(ks[2]));
    let mut relabelled = forged.clone();
    let sig = relabelled.inputs[0]
        .tap_script_sigs
        .remove(&(pubkey_of(&ks[2]), fed().leaf_hash))
        .unwrap();
    relabelled.inputs[0]
        .tap_script_sigs
        .insert((pubkey_of(&ks[0]), fed().leaf_hash), sig);
    let a = r1.on_event(T0 + 1, &signed(&relabelled), std::slice::from_ref(&b));
    assert!(logs(&a)[0].contains("does not verify"), "{a:?}");
    // a different transaction
    let mut other = mine.clone();
    other.unsigned_tx.lock_time = bitcoin::absolute::LockTime::from_height(1).unwrap();
    let a = r1.on_event(T0 + 1, &signed(&other), std::slice::from_ref(&b));
    assert!(logs(&a)[0].ends_with("a different transaction"), "{a:?}");
    // the honest one finalises
    let mut ok = mine.clone();
    sign_pegout_psbt_fn(&mut ok, &co);
    let a = r1.on_event(T0 + 2, &signed(&ok), std::slice::from_ref(&b));
    assert_eq!(broadcast(&a).len(), 1);
    let _ = BTreeMap::<u8, u8>::new();
}

fn sign_pegout_psbt_fn(psbt: &mut bitcoin::psbt::Psbt, k: &LocalKey) {
    sign_pegout_psbt_(psbt, k);
}
fn sign_pegout_psbt_(psbt: &mut bitcoin::psbt::Psbt, k: &LocalKey) {
    sidestr_round::pegout::sign_pegout_psbt(psbt, &fed(), CHAIN, "x", k).unwrap();
}
fn key_(seed: &str) -> bitcoin::secp256k1::SecretKey {
    key(seed)
}

#[test]
fn one_signature_per_burn_is_journalled_before_publish_and_survives_a_restart() {
    let ks = keys(3);
    let b = burn(7, 20_000);
    let key = burn_key(&b);
    let good = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    let payer = LocalKey::new(ks[1]);
    let p = sign_pegout_psbt(
        &payer,
        &PegoutPsbt {
            chain_id: CHAIN.into(),
            burn: Outpoint {
                txid: b.txid.clone(),
                vout: 0,
            },
            height: 7,
            psbt: good.to_string(),
        },
        T0,
    )
    .unwrap();
    let mut journal = MemoryJournal::new();
    let mut r0 = round(0, cfg(), Box::new(MemoryJournal::new()));
    assert_eq!(
        published(&r0.on_event(T0, &p, std::slice::from_ref(&b))).len(),
        1
    );
    journal
        .record(&sidestr_round::journal::VoteEntry {
            scope: VoteScope::Burn(key.clone()),
            role: VoteRole::Signed,
            subject: p.id.clone(),
            digest: good.unsigned_tx.compute_txid().to_string(),
            at: T0,
        })
        .unwrap();
    let mut again = round(
        0,
        cfg(),
        Box::new(MemoryJournal::with_entries(journal.entries().unwrap())),
    );
    let p2 = sign_pegout_psbt(
        &payer,
        &PegoutPsbt {
            chain_id: CHAIN.into(),
            burn: Outpoint {
                txid: b.txid.clone(),
                vout: 0,
            },
            height: 7,
            psbt: good.to_string(),
        },
        T0 + 5,
    )
    .unwrap();
    assert!(
        again
            .on_event(T0 + 10, &p2, std::slice::from_ref(&b))
            .is_empty(),
        "within the window after a restart: silent, as upstream"
    );
    assert!(
        again
            .on_event(T0 + 31, &p2, std::slice::from_ref(&b))
            .is_empty(),
        "the same event again is seen, whatever the time"
    );
    let p3 = sign_pegout_psbt(
        &payer,
        &PegoutPsbt {
            chain_id: CHAIN.into(),
            burn: Outpoint {
                txid: b.txid.clone(),
                vout: 0,
            },
            height: 7,
            psbt: good.to_string(),
        },
        T0 + 6,
    )
    .unwrap();
    assert_eq!(
        published(&again.on_event(T0 + 31, &p3, std::slice::from_ref(&b))).len(),
        1,
        "after the window: upstream's relaxation"
    );
    // and a journal that cannot be written means no signature leaves
    struct Broken;
    impl VoteJournal for Broken {
        fn record(&mut self, _: &sidestr_round::journal::VoteEntry) -> sidestr_round::Result<()> {
            Err(sidestr_round::Error::Journal("disk full".into()))
        }
        fn entries(&self) -> sidestr_round::Result<Vec<sidestr_round::journal::VoteEntry>> {
            Ok(vec![])
        }
    }
    let mut broken = round(0, cfg(), Box::new(Broken));
    let a = broken.on_event(T0, &p, std::slice::from_ref(&b));
    assert_eq!(published(&a).len(), 0);
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposal for {}… not signed: journal: disk full",
            &key[..16]
        )]
    );
    let mut broken_payer = round(1, cfg(), Box::new(Broken));
    let a = broken_payer.tick(T0, std::slice::from_ref(&b), &coins());
    assert_eq!(published(&a).len(), 0);
    assert!(broken_payer.pending().is_empty());
}

#[test]
fn a_burn_larger_than_one_coin_takes_two_and_change_under_dust_goes_to_the_fee() {
    let b = burn(4, 1_050_000);
    let psbt = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    assert_eq!(psbt.unsigned_tx.input.len(), 2);
    assert_eq!(psbt.unsigned_tx.output.len(), 3);
    let tiny = burn(4, 1_059_100);
    let psbt = build_pegout_psbt(&fed(), CHAIN, &tiny, &coins(), 2).unwrap();
    assert_eq!(
        psbt.unsigned_tx.output.len(),
        2,
        "no change output under dust"
    );
    assert!(check_pegout_psbt(&psbt, &fed(), CHAIN, &tiny, 100_000).is_none());
    assert!(build_pegout_psbt(&fed(), CHAIN, &burn(4, 2_000_000), &coins(), 2).is_err());
}
