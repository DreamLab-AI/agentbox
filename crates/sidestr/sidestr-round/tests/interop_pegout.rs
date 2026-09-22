//! Acceptance 3: the peg-out round, mixed. A throwaway 2-of-3 chain beside
//! `tbtc4` with coins, {Rust, JS, Rust} signers and a Bitcoin Core stand-in
//! every signer's peg wallet talks to. Burns are mined by the round; the
//! payer proposes a PSBT — JS through `walletcreatefundedpsbt`, Rust
//! through `build_pegout_psbt` — the others co-sign, the payer finalises and
//! broadcasts, and each finalised parent transaction is verified here with
//! `sidestr-core`'s BIP-342 verifier against the federation's leaf. Both
//! directions must occur. Needs the reference checkouts; skipped otherwise.
#![cfg(all(feature = "bin", feature = "relay"))]

mod support;

use std::collections::BTreeSet;
use std::time::Duration;

use bitcoin::hashes::Hash;
use bitcoin::{Amount, OutPoint, TxOut};
use sidestr_core::block::pubkey_of;
use sidestr_core::chain::Chain;
use sidestr_core::marker::{parse_pegout_marker, pegout_marker};
use sidestr_core::state::NextBlock;
use sidestr_nostr::event::SecretKeySigner;
use sidestr_nostr::tx::sign_transaction_event;
use sidestr_round::relay::{publish_one, unix_now, RelayStandIn};
use sidestr_round::signer::LocalKey;
use support::core_stand_in::CoreStandIn;
use support::interop::*;
use support::*;

/// The parent script the burns name: a P2TR output to a real key (34 bytes,
/// as the live chain's burns are). A 35-byte script would push the marker
/// as `OP_PUSHDATA1`, which `sidestr-core`'s `looks_like_pegout` does not
/// recognise while the reference does — reported, not worked around here.
fn parent_script() -> String {
    sidestr_core::block::challenge_for(&pubkey_of(&key("parent"))).to_hex_string()
}

/// A burn of `value` sats from the wallet's coin `c` (as `/coins` lists it).
fn burn_tx(c: &serde_json::Value, value: u64) -> bitcoin::Transaction {
    use bitcoin::secp256k1::{Keypair, Message};
    use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
    use bitcoin::{absolute::LockTime, ScriptBuf, Sequence, TxIn, Witness};
    let (txid, vout) = c["outpoint"].as_str().unwrap().split_once(':').unwrap();
    let coin_value = c["value"].as_u64().unwrap();
    let me = wallet_script();
    let fee = 1_000;
    let mut tx = bitcoin::Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: txid.parse().unwrap(),
                vout: vout.parse().unwrap(),
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
            witness: Witness::new(),
        }],
        output: vec![
            TxOut {
                value: Amount::from_sat(value),
                script_pubkey: pegout_marker(&parent_script()),
            },
            TxOut {
                value: Amount::from_sat(coin_value - value - fee),
                script_pubkey: me.clone(),
            },
        ],
    };
    let prev = [TxOut {
        value: Amount::from_sat(coin_value),
        script_pubkey: me,
    }];
    let msg = SighashCache::new(&tx)
        .taproot_key_spend_signature_hash(0, &Prevouts::All(&prev), TapSighashType::Default)
        .unwrap();
    let kp = Keypair::from_secret_key(sidestr_core::block::secp(), &wallet());
    let sig = sidestr_core::block::secp().sign_schnorr_with_aux_rand(
        &Message::from_digest(msg.to_byte_array()),
        &kp,
        &[0u8; 32],
    );
    tx.input[0].witness = Witness::from_slice(&[sig.as_ref().to_vec()]);
    tx
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_burn_is_paid_by_a_psbt_round_proposed_by_js_and_by_rust() {
    let Some(u) = skip_unless_upstream() else {
        return;
    };
    let scratch = Scratch::new("pegout");
    let relay = RelayStandIn::start("127.0.0.1:0").await.unwrap();
    let ks = keys(3);
    let pubs: Vec<String> = ks.iter().map(|k| pubkey_of(k).to_string()).collect();
    let (mut doc, genesis) = federated_doc("pegoutinterop", &ks, 2, 5_000_000_000);
    doc.genesis_hash = None;
    let fed = sidestr_core::federation::Federation::for_document(&doc)
        .unwrap()
        .unwrap();
    // the genesis and 100 blocks, sealed here, so the wallet's coin is mature when the signers start
    let g = scratch.path("g");
    {
        let mut chain = Chain::open_sealed(doc.clone(), &g, |_| Ok(genesis.clone())).unwrap();
        for _ in 0..100 {
            let t = chain.state().tip().time + 1;
            let (b, _, _) = chain
                .state()
                .build_next(&NextBlock {
                    time: t,
                    claims: vec![],
                })
                .unwrap();
            let sealed = seal_with(&fed, &b, &ks, &[0, 1]);
            chain
                .add_block(&bitcoin::consensus::encode::serialize(&sealed), None)
                .unwrap();
        }
        doc.genesis_hash = Some(chain.state().genesis_hash().to_string());
    }
    let chain_path = scratch.path("chain.json");
    std::fs::write(&chain_path, doc.to_json().unwrap()).unwrap();
    let key_paths: Vec<_> = (1..=3).map(|i| scratch.path(&format!("k{i}"))).collect();
    for (p, k) in key_paths.iter().zip(&ks) {
        write_key(p, k);
    }
    let dirs: Vec<_> = (1..=3).map(|i| scratch.path(&format!("d{i}"))).collect();
    for d in &dirs {
        copy_chain(&g, d);
    }
    let core = CoreStandIn::start(
        fed.clone(),
        &doc.id,
        bitcoin::Network::Testnet4,
        (0..3)
            .map(|i| (format!("w{}", i + 1), LocalKey::new(ks[i])))
            .collect(),
        (0..4u32)
            .map(|i| {
                (
                    OutPoint {
                        txid: format!("{:02x}", 0xc0 + i).repeat(32).parse().unwrap(),
                        vout: i,
                    },
                    1_000_000,
                )
            })
            .collect(),
        scratch.path("cookie"),
    );
    let ports: Vec<u16> = (0..3).map(|_| free_port()).collect();
    let parent_args = |w: &str| -> Vec<String> {
        vec![
            "--parent-rpc".into(),
            core.url.clone(),
            "--parent-cookie".into(),
            core.cookie.display().to_string(),
            "--parent-wallet".into(),
            w.into(),
            "--parent-poll".into(),
            "3".into(),
            "--parent-from".into(),
            "1".into(),
        ]
    };
    let a1 = parent_args("w1");
    let a2 = parent_args("w2");
    let a3 = parent_args("w3");
    fn s(v: &[String]) -> Vec<&str> {
        v.iter().map(String::as_str).collect()
    }
    let procs = [
        rust_signer(
            "signer 1 (Rust)",
            &chain_path,
            &dirs[0],
            &key_paths[0],
            ports[0],
            &relay.url(),
            &s(&a1),
            scratch.path("p1.log"),
        ),
        js_signer(
            &u,
            "signer 2 (JS)",
            &chain_path,
            &dirs[1],
            &key_paths[1],
            ports[1],
            &relay.url(),
            &s(&a2),
            scratch.path("p2.log"),
        ),
        rust_signer(
            "signer 3 (Rust)",
            &chain_path,
            &dirs[2],
            &key_paths[2],
            ports[2],
            &relay.url(),
            &s(&a3),
            scratch.path("p3.log"),
        ),
    ];
    let fail = |what: &str| -> ! {
        for p in &procs {
            eprintln!("--- {} ---\n{}", p.name, p.tail(15));
        }
        panic!("{what}");
    };
    tokio::time::sleep(Duration::from_secs(6)).await;
    for p in &procs {
        assert!(
            p.log().contains("level 2: signer"),
            "{} did not start:\n{}",
            p.name,
            p.log()
        );
    }
    if !wait_for(60, || tip(ports[0]) >= 101).await {
        fail("the round did not seal a block on the Rust-made chain");
    }
    let rust: BTreeSet<&str> = [pubs[0].as_str(), pubs[2].as_str()].into();
    let js_pub = pubs[1].as_str();
    let throwaway = SecretKeySigner::from_bytes(&[9u8; 32]).unwrap();
    let mut burns: Vec<String> = Vec::new();
    let (mut js_proposed, mut rust_proposed) = (false, false);
    for n in 1..=6 {
        // a mature coin of the wallet's, as the Rust signer lists it; burn 20 000 sats to the parent script
        let coins: Vec<serde_json::Value> = serde_json::from_str(
            &http_get(&format!(
                "http://127.0.0.1:{}/coins/{}",
                ports[0],
                wallet_script().to_hex_string()
            ))
            .unwrap(),
        )
        .unwrap();
        let h = tip(ports[0]) as u64;
        let coin = coins
            .iter()
            .find(|c| {
                !c["coinbase"].as_bool().unwrap() || h + 1 - c["height"].as_u64().unwrap() >= 100
            })
            .cloned()
            .unwrap_or_else(|| fail("no mature wallet coin"));
        let tx = burn_tx(&coin, 20_000);
        let hex = hex::encode(bitcoin::consensus::encode::serialize(&tx));
        let key = format!("{}:0", tx.compute_txid());
        // over the relay (every signer's mempool) and to the Rust signer's /tx
        let ev = sign_transaction_event(&throwaway, &doc.id, &hex, unix_now()).unwrap();
        publish_one(&relay.url(), &ev, Duration::from_secs(5)).await;
        let posted = http_post(&format!("http://127.0.0.1:{}/tx", ports[0]), &hex).unwrap();
        assert!(posted.contains("\"txid\""), "{posted}");
        burns.push(key.clone());
        if !wait_for(60, || {
            status(ports[0])["pegouts"]["burned"].as_u64() == Some(n)
        })
        .await
        {
            fail(&format!("burn {n} was not mined"));
        }
        if !wait_for(90, || core.sent() >= n as usize).await {
            fail(&format!("burn {n} was not paid on the parent in 90 s"));
        }
        let events = relay.events();
        let proposal = events
            .iter()
            .filter(|e| {
                e.kind == 23512 && sidestr_nostr::tags::first(&e.tags, "d") == Some(key.as_str())
            })
            .min_by_key(|e| e.created_at)
            .unwrap_or_else(|| fail("no 23512 for the burn"));
        let cosigners: BTreeSet<&str> = events
            .iter()
            .filter(|e| {
                e.kind == 23513
                    && sidestr_nostr::tags::first(&e.tags, "e") == Some(proposal.id.as_str())
            })
            .map(|e| e.pubkey.as_str())
            .collect();
        let by = if proposal.pubkey == js_pub {
            "JS"
        } else {
            "Rust"
        };
        eprintln!(
            "  burn {n} {}… proposed by signer {} ({by}), co-signed by {:?}",
            &key[..16],
            pubs.iter().position(|p| *p == proposal.pubkey).unwrap() + 1,
            cosigners
                .iter()
                .map(|c| pubs.iter().position(|p| p == c).unwrap() + 1)
                .collect::<Vec<_>>()
        );
        if proposal.pubkey == js_pub {
            assert!(
                cosigners.iter().any(|c| rust.contains(c)),
                "a JS proposal without a Rust co-signature"
            );
            js_proposed = true;
        } else {
            assert!(
                cosigners.contains(js_pub),
                "a Rust proposal without the JS co-signature"
            );
            rust_proposed = true;
        }
        if js_proposed && rust_proposed {
            break;
        }
    }
    assert!(
        js_proposed && rust_proposed,
        "both directions must occur: js={js_proposed} rust={rust_proposed}"
    );
    // every payment the parent took verifies under BIP 342 against tr(NUMS, multi_a(2, …)), pays a
    // burn we made with its marker, and was paid exactly once
    let payments = core.verified_payments();
    assert_eq!(
        payments.len(),
        burns.len(),
        "one payment per burn: {} payments for {} burns",
        payments.len(),
        burns.len()
    );
    let mut paid = BTreeSet::new();
    for (tx, spends) in &payments {
        for m in spends {
            assert_eq!(m.threshold, 2);
            assert_eq!(m.signed.iter().filter(|s| **s).count(), 2);
            assert_eq!(m.signers, fed.signers);
        }
        let side = tx
            .output
            .iter()
            .find_map(|o| parse_pegout_marker(&o.script_pubkey, &doc.id))
            .expect("the marker");
        assert!(
            burns.contains(&format!("{side}:0")),
            "pays a burn we did not make"
        );
        assert!(tx
            .output
            .iter()
            .any(|o| o.script_pubkey.to_hex_string() == parent_script()
                && o.value.to_sat() == 20_000));
        assert!(paid.insert(side), "a burn paid twice");
    }
    // every signer's ledger agrees with the parent: the payer records at broadcast, the others when
    // their next parent poll reconciles the wallet history (`--parent-poll 3`)
    let want = burns.len() as u64;
    let all_paid = || {
        ports
            .iter()
            .all(|p| status(*p)["pegouts"]["paid"].as_u64() == Some(want))
    };
    if !wait_for(30, all_paid).await {
        for (i, p) in ports.iter().enumerate() {
            eprintln!("signer {}'s ledger: {}", i + 1, status(*p)["pegouts"]);
        }
        fail("the ledgers did not all reconcile to the parent");
    }
    eprintln!("=== passed: {} burns paid by the PSBT round, proposed by JS and by Rust, co-signed across engines, verified under BIP 342", burns.len());
    drop(procs);
}
