//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22
//! (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-round-0.1-gpt6-astra.md),
//! kept as regressions for the peg-out round. One passed at 0.1.0-pre by
//! asserting the defect and is inverted here:
//!
//! - C2, `audit_never_resign_restart_self_proposal`: a signer restarted on
//!   its journal with `resign_after = None` no longer proposes a second
//!   23512 for a burn it already authorised. The guard is one durable
//!   per-burn record shared by the co-signer path, the proposer path and
//!   the transition between them; the tests after it cover the transition
//!   and the disjoint-input retry the upstream policy still permits.
//!
//! The "extra output" probe is named for what it establishes: an extra
//! **non-change** output is refused; change back to the federation is
//! accepted, as `pegoutround.mjs psbtPaysBurn` accepts it.

mod support;

use std::cell::Cell;
use std::rc::Rc;

use bitcoin::secp256k1::{schnorr::Signature, XOnlyPublicKey};
use bitcoin::OutPoint;
use sidestr_core::block::pubkey_of;
use sidestr_core::federation::Federation;
use sidestr_core::marker::Burn;
use sidestr_nostr::event::{SignRequest, Signer as EventSigner};
use sidestr_nostr::round::{sign_pegout_psbt, PegoutPsbt};
use sidestr_nostr::tags::Outpoint;
use sidestr_round::journal::{FileJournal, MemoryJournal, VoteJournal, VoteScope};
use sidestr_round::pegout::*;
use sidestr_round::signer::{BlockSigner, LocalKey, PartialRequest, PegoutSignRequest};
use support::*;

/// Unix seconds, the events' clock.
const T0: u64 = 1_790_000_100;
const CHAIN: &str = "sidestr:pegout";

/// The round's clock is milliseconds; events and fixtures are seconds.
fn ms(secs: u64) -> u64 {
    secs * 1000
}

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
/// Coins that share no outpoint with [`coins`]: a retry funded from them
/// spends disjoint inputs.
fn other_coins() -> Vec<PegCoin> {
    let mut other = coins();
    for c in &mut other {
        c.outpoint.txid = "cc".repeat(32).parse().unwrap();
    }
    other
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
fn never() -> PegoutConfig {
    PegoutConfig {
        resign_after: None,
        ..cfg()
    }
}
fn logs(a: &[PegoutAction]) -> Vec<String> {
    a.iter()
        .filter_map(|x| match x {
            PegoutAction::Log(s) => {
                println!("AUDIT LOG {s}");
                Some(s.clone())
            }
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
/// A 23512 from `from` carrying `psbt` for the height-7 burn.
fn proposal_event(psbt: &bitcoin::psbt::Psbt, from: &LocalKey, at: u64) -> sidestr_nostr::Event {
    let b = burn(7, 20_000);
    sign_pegout_psbt(
        from,
        &PegoutPsbt {
            chain_id: CHAIN.into(),
            burn: Outpoint {
                txid: b.txid.clone(),
                vout: 0,
            },
            height: 7,
            psbt: psbt.to_string(),
        },
        at,
    )
    .unwrap()
}

/// Where the probes write: `$SIDESTR_AUDIT_PROBES`, else a temp directory
/// of this process. Never a path inside the repository.
fn audit_path(name: &str) -> std::path::PathBuf {
    let dir = std::env::var_os("SIDESTR_AUDIT_PROBES")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("sidestr-round-audit-{}", std::process::id()))
        });
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

/// C2 inverted (the auditor's `AUDIT COUNTEREXAMPLE` line observed a
/// second 23512 with disjoint inputs and a verifying signature). Slot 1
/// proposes a payment for the height-7 burn, journals it to a file and
/// exits. Restarted with the same `None` policy and offered different
/// parent coins, it proposes nothing for that burn at `T0 + 90` nor ever;
/// the one guard governs `tick` as it governs `on_proposal`.
#[test]
fn audit_never_resign_restart_self_proposal() {
    let path = audit_path("peg-restart.jsonl");
    std::fs::write(&path, b"").unwrap();
    let b = burn(7, 20_000);
    let mut r = round(1, never(), Box::new(FileJournal::open(&path).unwrap()));
    let p1 = published(&r.tick(ms(T0), std::slice::from_ref(&b), &coins()))[0].clone();
    assert_eq!(p1.kind, 23512);
    drop(r);
    let journal = FileJournal::open(&path).unwrap().entries().unwrap();
    assert_eq!(journal.len(), 2, "the intent and the signature record");
    assert!(journal
        .iter()
        .all(|e| e.scope == VoteScope::Burn(burn_key(&b))));
    let mut r = round(1, never(), Box::new(FileJournal::open(&path).unwrap()));
    assert_eq!(r.authorised().count(), 1);
    for dt in [90u64, 1_000, 1_000_000] {
        let a = r.tick(ms(T0 + dt), std::slice::from_ref(&b), &other_coins());
        assert!(
            published(&a).is_empty(),
            "no second proposal for the same burn at T0+{dt}: {a:?}"
        );
        assert!(r.pending().is_empty());
    }
    // and the same guard refuses another signer's proposal for that burn, as before
    let theirs = build_pegout_psbt(&fed(), CHAIN, &b, &other_coins(), 2).unwrap();
    let ev = proposal_event(&theirs, &LocalKey::new(keys(3)[2]), T0 + 200);
    assert!(r
        .on_event(ms(T0 + 200), &ev, std::slice::from_ref(&b))
        .is_empty());
    let first = psbt_from_base64(&p1.content).unwrap();
    println!(
        "AUDIT resign_after=None restart same_burn={} first_txid={} second_proposal=none",
        burn_key(&b),
        first.unsigned_tx.compute_txid()
    );
}

/// The co-signer-to-proposer transition. Slot 0 co-signs slot 1's PSBT for
/// the height-7 burn; once it is late enough to stand in as payer (60 s)
/// it must not propose its own payment for that burn under `None` — in the
/// same process and after a restart on its journal. Under upstream's
/// policy it proposes only after the `propose_after × n` throttle, as
/// `pegoutround.mjs` does (`proposed.set(key_, Date.now())` on co-sign,
/// checked by `tick`).
#[test]
fn audit_a_cosigner_does_not_become_the_proposer_for_a_burn_it_signed() {
    let path = audit_path("peg-transition.jsonl");
    std::fs::write(&path, b"").unwrap();
    let b = burn(7, 20_000);
    let theirs = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    let ev = proposal_event(&theirs, &LocalKey::new(keys(3)[1]), T0);

    // resign_after = None: never, in-process
    let mut r0 = round(0, never(), Box::new(FileJournal::open(&path).unwrap()));
    assert_eq!(
        published(&r0.on_event(ms(T0), &ev, std::slice::from_ref(&b))).len(),
        1
    );
    for dt in [60u64, 90, 1_000_000] {
        let a = r0.tick(ms(T0 + dt), std::slice::from_ref(&b), &other_coins());
        assert!(published(&a).is_empty(), "T0+{dt}: {a:?}");
    }
    drop(r0);
    // and after a restart on the journal
    let mut r0 = round(0, never(), Box::new(FileJournal::open(&path).unwrap()));
    assert_eq!(r0.authorised().count(), 1);
    r0.tick(ms(T0 + 100), std::slice::from_ref(&b), &other_coins());
    for dt in [160u64, 190, 1_000_000] {
        let a = r0.tick(ms(T0 + dt), std::slice::from_ref(&b), &other_coins());
        assert!(published(&a).is_empty(), "restart, T0+{dt}: {a:?}");
    }

    // upstream's policy: the throttle, then a proposal of its own
    let mut r0 = round(0, cfg(), Box::new(MemoryJournal::new()));
    assert_eq!(
        published(&r0.on_event(ms(T0), &ev, std::slice::from_ref(&b))).len(),
        1
    );
    assert!(r0
        .tick(ms(T0 + 60), std::slice::from_ref(&b), &other_coins())
        .is_empty());
    assert!(r0
        .tick(ms(T0 + 89), std::slice::from_ref(&b), &other_coins())
        .is_empty());
    let a = r0.tick(ms(T0 + 90), std::slice::from_ref(&b), &other_coins());
    let p = published(&a);
    assert_eq!(p.len(), 1, "{a:?}");
    assert_eq!(p[0].kind, 23512);
    assert_eq!(r0.authorised().count(), 1, "one burn, re-authorised");
}

/// The disjoint-input retry under upstream's policy: the proposer restarts
/// on its journal, is offered other coins, and may propose again only once
/// `propose_after × n` has passed since its last authorisation — the same
/// throttle `pegoutround.mjs` applies to its own retries — and the retry
/// carries a verifying signature over disjoint inputs. Under `None` the
/// retry never happens (the test above).
#[test]
fn audit_upstream_policy_permits_a_disjoint_input_retry_after_the_ring() {
    let path = audit_path("peg-retry.jsonl");
    std::fs::write(&path, b"").unwrap();
    let b = burn(7, 20_000);
    let mut r = round(1, cfg(), Box::new(FileJournal::open(&path).unwrap()));
    let p1 = published(&r.tick(ms(T0), std::slice::from_ref(&b), &coins()))[0].clone();
    drop(r);
    let mut r = round(1, cfg(), Box::new(FileJournal::open(&path).unwrap()));
    assert!(r
        .tick(ms(T0 + 89), std::slice::from_ref(&b), &other_coins())
        .is_empty());
    let a = r.tick(ms(T0 + 90), std::slice::from_ref(&b), &other_coins());
    let p2 = published(&a)[0].clone();
    let first = psbt_from_base64(&p1.content).unwrap();
    let second = psbt_from_base64(&p2.content).unwrap();
    assert_ne!(
        first.unsigned_tx.compute_txid(),
        second.unsigned_tx.compute_txid()
    );
    assert!(first.unsigned_tx.input.iter().all(|i| second
        .unsigned_tx
        .input
        .iter()
        .all(|j| i.previous_output != j.previous_output)));
    let verified = verify_pegout_signatures(&second, &fed()).unwrap();
    assert!(verified.iter().all(|v| v.contains(&pubkey_of(&keys(3)[1]))));
    drop(r);
    let journal = FileJournal::open(&path).unwrap().entries().unwrap();
    assert_eq!(journal.len(), 4, "two authorisations, two records each");
    println!(
        "AUDIT upstream policy retry same_burn={} first_txid={} second_txid={} disjoint_inputs=true valid_second_signature=true at=T0+90",
        burn_key(&b),
        first.unsigned_tx.compute_txid(),
        second.unsigned_tx.compute_txid()
    );
}

/// `psbtPaysBurn`'s change policy, named for what it establishes: a missing
/// marker is refused, an extra output to anything but the federation is
/// refused, and an extra output returning value to the federation's
/// challenge (change) is accepted, as `pegoutround.mjs` accepts it.
#[test]
fn audit_missing_marker_and_extra_non_change_output_are_refused_change_to_the_peg_is_not() {
    let b = burn(7, 20_000);
    let good = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    for mode in ["missing_marker", "extra_foreign_output", "extra_peg_change"] {
        let mut psbt = good.clone();
        if mode == "missing_marker" {
            psbt.unsigned_tx.output.remove(1);
            psbt.outputs.remove(1);
        } else {
            psbt.unsigned_tx.output.push(bitcoin::TxOut {
                value: bitcoin::Amount::from_sat(1),
                script_pubkey: if mode == "extra_peg_change" {
                    fed().challenge()
                } else {
                    wallet_script()
                },
            });
            psbt.outputs.push(Default::default());
        }
        let reason = check_pegout_psbt(&psbt, &fed(), CHAIN, &b, 100_000);
        println!("AUDIT pegout mutation={mode} refusal={reason:?}");
        assert_eq!(reason.is_none(), mode == "extra_peg_change");
    }
}

/// A custody signer that counts how often it is asked for a peg-out input.
struct Counting {
    key: LocalKey,
    calls: Rc<Cell<usize>>,
}
impl EventSigner for Counting {
    fn pubkey_hex(&self) -> sidestr_nostr::Result<String> {
        EventSigner::pubkey_hex(&self.key)
    }
    fn sign(&self, r: &SignRequest<'_>) -> sidestr_nostr::Result<[u8; 64]> {
        EventSigner::sign(&self.key, r)
    }
}
impl BlockSigner for Counting {
    fn pubkey(&self) -> XOnlyPublicKey {
        BlockSigner::pubkey(&self.key)
    }
    fn sign_partial(&self, r: &PartialRequest<'_>) -> sidestr_round::Result<Signature> {
        self.key.sign_partial(r)
    }
    fn sign_pegout_input(&self, r: &PegoutSignRequest<'_>) -> sidestr_round::Result<Signature> {
        self.calls.set(self.calls.get() + 1);
        self.key.sign_pegout_input(r)
    }
}
struct Broken;
impl VoteJournal for Broken {
    fn record(&mut self, _: &sidestr_round::journal::VoteEntry) -> sidestr_round::Result<()> {
        Err(sidestr_round::Error::Journal("audit failure".into()))
    }
    fn entries(&self) -> sidestr_round::Result<Vec<sidestr_round::journal::VoteEntry>> {
        Ok(vec![])
    }
}

/// C5 on the peg-out path: the intent is persisted before the custody
/// signer is invoked, on both paths. A journal that refuses the intent
/// means zero `sign_pegout_input` invocations and nothing published, for a
/// co-signer and for a proposer.
#[test]
fn audit_journal_failure_does_not_call_the_pegout_signer() {
    let b = burn(7, 20_000);
    let theirs = build_pegout_psbt(&fed(), CHAIN, &b, &coins(), 2).unwrap();
    let ev = proposal_event(&theirs, &LocalKey::new(keys(3)[1]), T0);
    let calls = Rc::new(Cell::new(0));
    let mut co = PegoutRound::new(
        fed(),
        CHAIN,
        Box::new(Counting {
            key: LocalKey::new(keys(3)[0]),
            calls: calls.clone(),
        }),
        Box::new(Broken),
        cfg(),
        PegoutLedger::default(),
    )
    .unwrap();
    let a = co.on_event(ms(T0), &ev, std::slice::from_ref(&b));
    println!(
        "AUDIT peg-out journal write failure: sign_pegout_input calls={} Publish actions={} logs={:?}",
        calls.get(),
        published(&a).len(),
        logs(&a)
    );
    assert_eq!(calls.get(), 0);
    assert!(published(&a).is_empty());
    assert_eq!(
        logs(&a),
        vec![format!(
            "peg-out round: proposal for {}… not signed: journal: audit failure",
            &burn_key(&b)[..16]
        )]
    );
    let calls = Rc::new(Cell::new(0));
    let mut payer = PegoutRound::new(
        fed(),
        CHAIN,
        Box::new(Counting {
            key: LocalKey::new(keys(3)[1]),
            calls: calls.clone(),
        }),
        Box::new(Broken),
        cfg(),
        PegoutLedger::default(),
    )
    .unwrap();
    let a = payer.tick(ms(T0), std::slice::from_ref(&b), &coins());
    assert_eq!(calls.get(), 0);
    assert!(published(&a).is_empty());
    assert!(payer.pending().is_empty());
}

/// The wire fixture for the auditor's `wire.mjs` differential (R7): a
/// Rust 23512 and 23513 on the same PSBT the reference is given.
#[test]
fn audit_export_peg_wire() {
    let b = burn(7, 20_000);
    let mut payer = round(1, cfg(), Box::new(MemoryJournal::new()));
    let mut co = round(0, cfg(), Box::new(MemoryJournal::new()));
    let p = published(&payer.tick(ms(T0), std::slice::from_ref(&b), &coins()))[0].clone();
    let part = published(&co.on_event(ms(T0), &p, std::slice::from_ref(&b)))[0].clone();
    let psbt = psbt_from_base64(&p.content).unwrap();
    let fixture = serde_json::json!({"chain":CHAIN,"burn":{"txid":b.txid,"vout":b.vout,"script":b.script,"value":b.value,"height":b.height},"events":[p,part],"outputs":psbt.unsigned_tx.output.iter().map(|o|serde_json::json!({"value":o.value.to_sat() as f64/1e8,"scriptPubKey":{"hex":o.script_pubkey.to_hex_string()}})).collect::<Vec<_>>(),"inputs":psbt.inputs.iter().map(|i|serde_json::json!({"witness_utxo":{"scriptPubKey":{"hex":i.witness_utxo.as_ref().unwrap().script_pubkey.to_hex_string()}}})).collect::<Vec<_>>()});
    std::fs::write(
        audit_path("wire-peg.json"),
        serde_json::to_vec_pretty(&fixture).unwrap(),
    )
    .unwrap();
    println!("AUDIT exported 2 Rust pegout events on identical PSBT fixtures");
}
