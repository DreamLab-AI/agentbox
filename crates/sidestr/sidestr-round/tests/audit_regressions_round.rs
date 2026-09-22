//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22
//! (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-round-0.1-gpt6-astra.md),
//! kept as regressions for the block round. Two of them passed at 0.1.0-pre
//! by asserting the defect and are inverted here to assert the fix:
//!
//! - C1, `audit_crash_and_torn_tail`: a torn tail followed by a new record
//!   no longer swallows the new authorisation on reload; the torn case
//!   observes what the clean control observes.
//! - C5, `audit_journal_failure_does_not_call_signer` (was
//!   `…_still_calls_signer`): a journal that cannot take the intent means
//!   the custody signer is never invoked.
//!
//! C4's boundary probe now agrees with `round.mjs` at the millisecond.
//! Fixture exports for the auditor's `wire.mjs` differential go to
//! `$SIDESTR_AUDIT_PROBES` when set, else a per-process temp directory.

mod support;

use std::collections::BTreeSet;

use sidestr_core::block::pubkey_of;
use sidestr_core::state::State;
use sidestr_nostr::event::Event;
use sidestr_nostr::round::{sign_proposal, Proposal};
use sidestr_round::journal::{
    FileJournal, MemoryJournal, VoteEntry, VoteJournal, VoteRole, VoteScope, VoteStage,
};
use sidestr_round::round::{Action, Round, RoundConfig};
use sidestr_round::signer::LocalKey;
use support::*;

/// Unix seconds, the events' clock.
const T0: u64 = 1_790_000_100;

/// The round's clock is milliseconds; events and fixtures are seconds.
fn ms(secs: u64) -> u64 {
    secs * 1000
}

struct Signer {
    round: Round<sidestr_core::block::Stock>,
    state: State,
}
impl Signer {
    fn tick(&mut self, now_ms: u64, due: bool) -> Vec<Action> {
        self.round.tick(now_ms, &mut self.state, due)
    }
    fn on(&mut self, now_ms: u64, ev: &Event) -> Vec<Action> {
        self.round.on_event(now_ms, &mut self.state, ev)
    }
}

fn logs(a: &[Action]) -> Vec<String> {
    a.iter()
        .filter_map(|x| match x {
            Action::Log(s) => {
                println!("AUDIT LOG {s}");
                Some(s.clone())
            }
            _ => None,
        })
        .collect()
}
fn published(a: &[Action]) -> Vec<Event> {
    a.iter()
        .filter_map(|x| match x {
            Action::Publish(e) => Some(e.clone()),
            _ => None,
        })
        .collect()
}

fn three(name: &str, cfg: RoundConfig, premine: u32) -> Vec<Signer> {
    let keys = keys(3);
    let (doc, genesis) = federated_doc(name, &keys, 2, 5_000_000_000);
    let mut states: Vec<State> = (0..3).map(|_| state(&doc, &genesis)).collect();
    {
        let mut refs: Vec<&mut State> = states.iter_mut().collect();
        mine(&mut refs, &keys, premine);
    }
    states
        .into_iter()
        .zip(keys.iter())
        .map(|(state, k)| Signer {
            round: Round::new(
                &state,
                local(k),
                Box::new(MemoryJournal::new()),
                cfg.clone(),
            )
            .unwrap(),
            state,
        })
        .collect()
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

fn entry(scope: VoteScope, subject: &str, at_ms: u64) -> VoteEntry {
    VoteEntry {
        scope,
        role: VoteRole::Signed,
        subject: subject.into(),
        digest: "00".repeat(32),
        at: at_ms,
        stage: VoteStage::Signed,
        signature: None,
    }
}

/// Distinct authorisations in a journal: an intent and its signature are
/// one authorisation (same scope, same subject).
fn authorisations(entries: &[VoteEntry]) -> usize {
    entries
        .iter()
        .map(|e| (format!("{:?}", e.scope), e.subject.clone()))
        .collect::<BTreeSet<_>>()
        .len()
}

/// C1 inverted. A torn tail (`{"scope":`) left by a crash, then a
/// signature recorded on the strength of the repaired journal, then a
/// second crash before the caller publishes: on reload the new
/// authorisation is there, and a different template for the same height is
/// refused under `resign_after = None` — exactly what the clean control
/// observes (`loaded_entries=2 second_partial=0`). Then the two things the
/// auditor asked for and the original test did not exercise: an append
/// after recovery survives a reload, and a second crash after recovery is
/// repaired the same way.
#[test]
fn audit_crash_and_torn_tail() {
    use std::io::Write;
    let ks = keys(3);
    let (doc, genesis) = federated_doc("auditcrash", &ks, 2, 0);
    for torn in [false, true] {
        let path = audit_path(if torn { "torn.jsonl" } else { "clean.jsonl" });
        std::fs::write(&path, b"").unwrap();
        let mut j = FileJournal::open(&path).unwrap();
        j.record(&entry(VoteScope::Height(0), "earlier", ms(T0) - 1))
            .unwrap();
        drop(j);
        if torn {
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b"{\"scope\":")
                .unwrap();
        }
        let mut st = state(&doc, &genesis);
        let mut proposer_state = state(&doc, &genesis);
        let mut proposer = Round::new(
            &proposer_state,
            local(&ks[1]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = published(&proposer.tick(ms(T0), &mut proposer_state, true))[0].clone();
        let cfg = RoundConfig {
            propose_after: 30,
            resign_after: None,
        };
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(FileJournal::open(&path).unwrap()),
            cfg.clone(),
        )
        .unwrap();
        let actions = r.on_event(ms(T0 + 1), &mut st, &p);
        assert_eq!(published(&actions).len(), 1);
        // Crash after durable record and before caller transmits the returned action.
        drop(actions);
        drop(r);
        let loaded = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(loaded[0].subject, "earlier");
        let loaded_entries = authorisations(&loaded);
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(FileJournal::open(&path).unwrap()),
            cfg,
        )
        .unwrap();
        let mut block: bitcoin::Block =
            bitcoin::consensus::deserialize(&hex::decode(&p.content).unwrap()).unwrap();
        block.header.time += 1;
        let p2 = sign_proposal(
            &LocalKey::new(ks[1]),
            &Proposal {
                chain_id: doc.id.clone(),
                height: 1,
                block_hex: hex::encode(bitcoin::consensus::serialize(&block)),
            },
            T0 + 2,
        )
        .unwrap();
        let actions = r.on_event(ms(T0 + 2), &mut st, &p2);
        let count = published(&actions).len();
        let l = logs(&actions);
        println!(
            "AUDIT torn={torn} loaded_entries={loaded_entries} records={} second_partial={count} logs={l:?}",
            loaded.len()
        );
        assert_eq!(
            loaded_entries, 2,
            "the earlier height and the h1 authorisation both reload"
        );
        assert_eq!(
            loaded.len(),
            3,
            "earlier, then the h1 intent and its signature"
        );
        assert_eq!(loaded[1].stage, VoteStage::Intent);
        assert_eq!(loaded[2].stage, VoteStage::Signed);
        assert!(loaded[2].signature.is_some());
        assert_eq!(
            count, 0,
            "no second partial for h1 under resign_after = None"
        );
        assert!(l[0].contains("refused: I signed"), "{l:?}");
        drop(r);

        // append after recovery survives a reload
        let mut j = FileJournal::open(&path).unwrap();
        j.record(&entry(VoteScope::Height(2), "later", ms(T0 + 3)))
            .unwrap();
        drop(j);
        let e = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(e.len(), 4);
        assert_eq!(e[3].subject, "later");

        // a second crash after recovery: the same repair, the same append
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"sco")
            .unwrap();
        let before = std::fs::metadata(&path).unwrap().len();
        let mut j = FileJournal::open(&path).unwrap();
        assert!(
            std::fs::metadata(&path).unwrap().len() < before,
            "the torn suffix is cut back on open"
        );
        j.record(&entry(
            VoteScope::Height(3),
            "after second crash",
            ms(T0 + 4),
        ))
        .unwrap();
        drop(j);
        let e = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(e.len(), 5);
        assert_eq!(e[4].subject, "after second crash");
        // and every line of the file is a terminated, well-formed record
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.ends_with('\n'));
        assert_eq!(text.lines().count(), 5);
        for line in text.lines() {
            serde_json::from_str::<VoteEntry>(line).unwrap();
        }
    }
}

/// C4. The reference measures `Date.now()` milliseconds: `mayReSign`
/// relaxes at 30 001 ms after the signature (not at 30 000), a replayed
/// proposal is ignored once `now/1000 − created_at > P·n`, and a proposer's
/// own proposal is dropped at 90 001 ms. Whole seconds and the millisecond
/// boundaries both, as `wire.mjs` sampled them (R8).
#[test]
fn audit_round_boundaries_and_validation() {
    let ks = keys(3);
    let (doc, g) = federated_doc("auditbound", &ks, 2, 0);
    let mut st = state(&doc, &g);
    let (b, _, _) = st
        .build_next(&sidestr_core::state::NextBlock {
            time: T0 as u32,
            claims: vec![],
        })
        .unwrap();
    let template = Proposal {
        chain_id: doc.id.clone(),
        height: 1,
        block_hex: hex::encode(bitcoin::consensus::serialize(&b)),
    };
    // whole seconds, as the original probe sampled: 29 and 30 refused, 31 signed
    for delta in [29u64, 30, 31] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(&LocalKey::new(ks[1]), &template, T0).unwrap();
        assert_eq!(published(&r.on_event(ms(T0), &mut st, &p)).len(), 1);
        let p2 = sign_proposal(&LocalKey::new(ks[1]), &template, T0 + delta).unwrap();
        let a = r.on_event(ms(T0 + delta), &mut st, &p2);
        println!(
            "AUDIT resign delta={delta} partials={} logs={:?}",
            published(&a).len(),
            logs(&a)
        );
        assert_eq!(published(&a).len(), usize::from(delta > 30));
    }
    // the millisecond: JS mayReSign is `now - signed.at > proposeAfter * 1000`
    for delta_ms in [29_000u64, 30_000, 30_001, 30_999, 31_000] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(&LocalKey::new(ks[1]), &template, T0).unwrap();
        assert_eq!(published(&r.on_event(ms(T0), &mut st, &p)).len(), 1);
        let p2 = sign_proposal(&LocalKey::new(ks[1]), &template, T0 + delta_ms / 1000).unwrap();
        let a = r.on_event(ms(T0) + delta_ms, &mut st, &p2);
        let js = delta_ms > 30_000;
        println!(
            "AUDIT MAY_RESIGN delta_ms={delta_ms} JS={js} Rust={}",
            !published(&a).is_empty()
        );
        assert_eq!(published(&a).len(), usize::from(js), "delta_ms={delta_ms}");
    }
    // a replayed proposal: JS `Date.now() / 1000 - ev.created_at > proposeAfter * n`
    for delta_ms in [90_000u64, 90_001] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(&LocalKey::new(ks[1]), &template, T0).unwrap();
        let a = r.on_event(ms(T0) + delta_ms, &mut st, &p);
        println!(
            "AUDIT replay age_ms={delta_ms} partials={}",
            published(&a).len()
        );
        assert_eq!(published(&a).len(), usize::from(delta_ms == 90_000));
    }
    for (label, k, h) in [("outsider", key("outsider"), 1), ("tip+2", ks[2], 2)] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(
            &LocalKey::new(k),
            &Proposal {
                height: h,
                ..template.clone()
            },
            T0,
        )
        .unwrap();
        let a = r.on_event(ms(T0), &mut st, &p);
        println!(
            "AUDIT validation {label} partials={} logs={:?}",
            published(&a).len(),
            logs(&a)
        );
        assert!(published(&a).is_empty());
    }
    // my own proposal: JS `Date.now() - pending.at > proposeAfter * 1000 * n`
    let mut r = Round::new(
        &st,
        local(&ks[1]),
        Box::new(MemoryJournal::new()),
        RoundConfig::upstream(30),
    )
    .unwrap();
    r.tick(ms(T0), &mut st, true);
    assert!(r.tick(ms(T0) + 90_000, &mut st, true).is_empty());
    assert!(r.pending().is_some(), "JS elapsed_ms=90000 pending=true");
    let a = r.tick(ms(T0) + 90_001, &mut st, true);
    println!(
        "AUDIT DROP at 90000=false at 90001=true logs={:?}",
        logs(&a)
    );
    assert!(r.pending().is_none(), "JS elapsed_ms=90001 pending=false");
}

/// The wire fixture and the 126-case entitlement table for the auditor's
/// `wire.mjs` differential (R7, R8). The table is the same at the
/// millisecond: lateness is `⌊(at − base) / 1000 / P⌋` in both engines.
#[test]
fn audit_export_wire_and_entitlement() {
    let ks = keys(3);
    let (doc, g) = federated_doc("auditwire", &ks, 2, 5_000_000_000);
    let mut s = three("auditwire", RoundConfig::upstream(30), 0);
    let p = published(&s[1].tick(ms(T0), true))[0].clone();
    let part = published(&s[0].on(ms(T0), &p))[0].clone();
    let sealed = published(&s[1].on(ms(T0), &part))[0].clone();
    let mut table = vec![];
    for h in 1..=6 {
        let mut st = state(&doc, &g);
        mine(&mut [&mut st], &ks, h - 1);
        for slot in 0..3 {
            for late in [-1i64, 0, 29, 30, 59, 60, 90] {
                let receiver = (0..3).find(|i| *i != slot && *i != h as usize % 3).unwrap();
                let mut r = Round::new(
                    &st,
                    local(&ks[receiver]),
                    Box::new(MemoryJournal::new()),
                    RoundConfig::upstream(30),
                )
                .unwrap();
                r.tick(ms(T0), &mut st, true);
                // Invalid block distinguishes "not its turn" from "proposal is not a block" without signing.
                let at = (T0 as i64 + late) as u64;
                let ev = sign_proposal(
                    &LocalKey::new(ks[slot]),
                    &Proposal {
                        chain_id: doc.id.clone(),
                        height: h,
                        block_hex: "00".into(),
                    },
                    at,
                )
                .unwrap();
                let a = r.on_event(ms(at), &mut st, &ev);
                let entitled = logs(&a) == ["round: proposal is not a block"];
                // the reference expression, evaluated here: slot − turn mod n ≤ ⌊late / P⌋, never negative
                let expected = (slot as i64 + 3 - (h as i64 % 3)) % 3 <= (late.max(0) / 30);
                assert_eq!(entitled, expected, "h={h} slot={slot} late={late}");
                table.push(
                    serde_json::json!({"height":h,"slot":slot,"late":late,"entitled":entitled}),
                );
            }
        }
    }
    assert_eq!(table.len(), 126);
    std::fs::write(audit_path("wire-block.json"),serde_json::to_vec_pretty(&serde_json::json!({"doc":serde_json::from_str::<serde_json::Value>(&doc.to_json().unwrap()).unwrap(),"keys":ks.iter().map(|k|hex::encode(k.secret_bytes())).collect::<Vec<_>>(),"genesis":hex::encode(bitcoin::consensus::serialize(&g)),"events":[p,part,sealed],"entitlement":table})).unwrap()).unwrap();
    println!(
        "AUDIT exported 3 Rust block events; entitlement cases={}",
        table.len()
    );
}

/// A proposal the reference `makeRound` emitted (written by `wire.mjs` to
/// `$SIDESTR_AUDIT_PROBES/js-proposal.json`) gets a Rust 23511 whose
/// signature core's `verify_partial` accepts. Skipped when the fixture is
/// not there.
#[test]
fn audit_import_js_proposal() {
    let path = audit_path("js-proposal.json");
    if !path.exists() {
        println!("AUDIT JS proposal not generated yet; run again after wire.mjs");
        return;
    }
    let p: Event = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let ks = keys(3);
    let (doc, g) = federated_doc("auditwire", &ks, 2, 5_000_000_000);
    let mut st = state(&doc, &g);
    let mut r = Round::new(
        &st,
        local(&ks[0]),
        Box::new(MemoryJournal::new()),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = r.on_event(ms(T0), &mut st, &p);
    let partial = published(&a)[0].clone();
    let b: bitcoin::Block =
        bitcoin::consensus::deserialize(&hex::decode(&p.content).unwrap()).unwrap();
    let sig =
        bitcoin::secp256k1::schnorr::Signature::from_slice(&hex::decode(partial.content).unwrap())
            .unwrap();
    assert!(sidestr_core::federation::verify_partial(
        &sidestr_core::block::Stock,
        &b,
        st.federation().unwrap(),
        &pubkey_of(&ks[0]),
        &sig
    ));
    println!("AUDIT valid JS proposal -> Rust 23511 -> core verify_partial=true");
}

/// A custody signer that counts how often it is asked.
mod counting {
    use bitcoin::secp256k1::{schnorr::Signature, XOnlyPublicKey};
    use sidestr_nostr::event::{SignRequest, Signer as EventSigner};
    use sidestr_round::signer::{BlockSigner, LocalKey, PartialRequest, PegoutSignRequest};
    use std::cell::Cell;
    use std::rc::Rc;

    pub struct Counting {
        pub key: LocalKey,
        pub calls: Rc<Cell<usize>>,
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
            self.calls.set(self.calls.get() + 1);
            self.key.sign_partial(r)
        }
        fn sign_pegout_input(&self, r: &PegoutSignRequest<'_>) -> sidestr_round::Result<Signature> {
            self.calls.set(self.calls.get() + 1);
            self.key.sign_pegout_input(r)
        }
    }

    /// A journal that refuses every write.
    pub struct Broken;
    impl sidestr_round::journal::VoteJournal for Broken {
        fn record(&mut self, _: &sidestr_round::journal::VoteEntry) -> sidestr_round::Result<()> {
            Err(sidestr_round::Error::Journal("audit failure".into()))
        }
        fn entries(&self) -> sidestr_round::Result<Vec<sidestr_round::journal::VoteEntry>> {
            Ok(vec![])
        }
    }

    /// A journal that takes the intent and refuses the signature record.
    pub struct HalfBroken(pub Vec<sidestr_round::journal::VoteEntry>);
    impl sidestr_round::journal::VoteJournal for HalfBroken {
        fn record(&mut self, e: &sidestr_round::journal::VoteEntry) -> sidestr_round::Result<()> {
            if e.stage == sidestr_round::journal::VoteStage::Intent {
                self.0.push(e.clone());
                Ok(())
            } else {
                Err(sidestr_round::Error::Journal(
                    "audit failure after signing".into(),
                ))
            }
        }
        fn entries(&self) -> sidestr_round::Result<Vec<sidestr_round::journal::VoteEntry>> {
            Ok(self.0.clone())
        }
    }
}

/// C5 inverted (was `audit_journal_failure_still_calls_signer`, which
/// observed one `sign_partial` invocation). The intent is persisted before
/// the custody signer is invoked: when that write fails the signer is
/// never called and nothing is published. When the *signature* record
/// fails instead, the signer was called once, the signature is not
/// published, and the height counts as signed from then on — a co-signer
/// and a proposer alike.
#[test]
fn audit_journal_failure_does_not_call_signer() {
    use counting::{Broken, Counting, HalfBroken};
    use std::cell::Cell;
    use std::rc::Rc;
    let mut s = three("audit-sign-order", RoundConfig::upstream(30), 0);
    let p = published(&s[1].tick(ms(T0), true))[0].clone();

    // the intent cannot be written: the signer is not asked
    let calls = Rc::new(Cell::new(0));
    let mut r = Round::new(
        &s[0].state,
        Box::new(Counting {
            key: LocalKey::new(keys(3)[0]),
            calls: calls.clone(),
        }),
        Box::new(Broken),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = r.on_event(ms(T0), &mut s[0].state, &p);
    println!(
        "AUDIT journal write failure: BlockSigner::sign_partial calls={} Publish actions={} logs={:?}",
        calls.get(),
        published(&a).len(),
        logs(&a)
    );
    assert_eq!(calls.get(), 0, "the custody signer is not invoked");
    assert!(published(&a).is_empty());
    assert_eq!(
        logs(&a),
        vec!["round: proposal h1 not signed: journal: audit failure"]
    );
    assert_eq!(r.signed().count(), 0);
    // nor for a proposer
    let calls = Rc::new(Cell::new(0));
    let (doc, genesis) = federated_doc("audit-sign-order", &keys(3), 2, 5_000_000_000);
    let mut st = state(&doc, &genesis);
    let mut pr = Round::new(
        &st,
        Box::new(Counting {
            key: LocalKey::new(keys(3)[1]),
            calls: calls.clone(),
        }),
        Box::new(Broken),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = pr.tick(ms(T0), &mut st, true);
    assert_eq!(calls.get(), 0);
    assert!(published(&a).is_empty());
    assert!(pr.pending().is_none());

    // the signature record cannot be written: signed once, published never, counted as signed
    let calls = Rc::new(Cell::new(0));
    let mut r = Round::new(
        &s[2].state,
        Box::new(Counting {
            key: LocalKey::new(keys(3)[2]),
            calls: calls.clone(),
        }),
        Box::new(HalfBroken(vec![])),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = r.on_event(ms(T0), &mut s[2].state, &p);
    assert_eq!(calls.get(), 1);
    assert!(published(&a).is_empty());
    assert_eq!(
        logs(&a),
        vec!["round: proposal h1 signed but not published: journal: audit failure after signing"]
    );
    assert_eq!(
        r.signed().count(),
        1,
        "an intent counts as an authorisation"
    );
    let p2 = sign_proposal(
        &LocalKey::new(keys(3)[1]),
        &Proposal {
            chain_id: "sidestr:audit-sign-order".into(),
            height: 1,
            block_hex: p.content.clone(),
        },
        T0 + 5,
    )
    .unwrap();
    let a = r.on_event(ms(T0 + 5), &mut s[2].state, &p2);
    assert!(logs(&a)[0].contains("refused: I signed"), "{a:?}");
    assert_eq!(calls.get(), 1, "not asked again within the window");
}

/// Verification pass of 2026-09-22 (the round's second independent check,
/// `verify_journal_rollback.rs`): a failed append on a second live handle
/// rolled the file back to that handle's cached length and destroyed four
/// acknowledged intents. Now a second handle is refused at `open` (exclusive
/// advisory lock), and a failed append rolls back to the length measured on
/// the file immediately before the write, never to a cached one.
#[test]
fn a_second_live_handle_is_refused_and_rollback_is_measured_not_cached() {
    let path = audit_path("verify-shared-journal");
    let _ = std::fs::remove_file(&path);
    let mut first = FileJournal::open(&path).unwrap();
    for h in 1..=4 {
        first
            .record(&entry(
                VoteScope::Height(h),
                &"ab".repeat(32),
                1_790_000_100_731,
            ))
            .unwrap();
    }
    let second = FileJournal::open(&path);
    match second {
        Err(sidestr_round::error::Error::Journal(m)) => {
            assert!(m.contains("held by another handle"), "{m}")
        }
        other => panic!("a second live handle must be refused: {other:?}"),
    }
    let four = std::fs::metadata(&path).unwrap().len();
    // the same handle keeps working and every entry survives
    first
        .record(&entry(
            VoteScope::Height(5),
            &"ab".repeat(32),
            1_790_000_100_732,
        ))
        .unwrap();
    assert_eq!(first.entries().unwrap().len(), 5);
    drop(first);
    // once the first handle is gone the file opens again, intact
    let reopened = FileJournal::open(&path).unwrap();
    assert_eq!(reopened.entries().unwrap().len(), 5);
    assert!(std::fs::metadata(&path).unwrap().len() > four);
}
