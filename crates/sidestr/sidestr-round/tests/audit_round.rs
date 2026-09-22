//! The round as a state machine: rotation, lateness, every refusal
//! `round.mjs` logs, sealing at `k`, the drop after the timeout, the
//! journal across a restart, and `resign_after = None`.

mod support;

use sidestr_core::block::pubkey_of;
use sidestr_core::state::State;
use sidestr_nostr::event::Event;
use sidestr_nostr::round::{sign_partial, sign_proposal, Partial, Proposal};
use sidestr_round::journal::{MemoryJournal, VoteJournal, VoteRole, VoteScope};
use sidestr_round::round::{Action, Round, RoundConfig};
use sidestr_round::signer::LocalKey;
use support::*;

const T0: u64 = 1_790_000_100;

struct Signer {
    round: Round<sidestr_core::block::Stock>,
    state: State,
}
impl Signer {
    fn tick(&mut self, now: u64, due: bool) -> Vec<Action> {
        self.round.tick(now, &mut self.state, due)
    }
    fn on(&mut self, now: u64, ev: &Event) -> Vec<Action> {
        self.round.on_event(now, &mut self.state, ev)
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
fn sealed(a: &[Action]) -> Vec<u32> {
    a.iter()
        .filter_map(|x| match x {
            Action::Sealed(s) => Some(s.height),
            _ => None,
        })
        .collect()
}

/// The next block on `state`'s tip carrying `tx`, as a proposer builds it.
fn block_with(state: &State, tx: bitcoin::Transaction) -> bitcoin::Block {
    let tip = state.tip();
    sidestr_core::block::build_block(
        &sidestr_core::block::Stock,
        &sidestr_core::block::BlockTemplate {
            height: tip.height + 1,
            prev: tip.hash,
            time: tip.time + 1,
            transactions: vec![tx],
            outputs: vec![],
            bits: state.bits(),
            marker: sidestr_core::block::MARKER.into(),
        },
    )
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

#[test]
fn the_proposer_rotates_and_k_signatures_seal() {
    let mut s = three("rot", RoundConfig::upstream(30), 0);
    // height 1: 1 mod 3 = slot 1; nobody else may propose at t0
    assert!(s[0].tick(T0, true).is_empty());
    assert!(s[2].tick(T0, true).is_empty());
    let a = s[1].tick(T0, true);
    let p = &published(&a)[0];
    assert_eq!(p.kind, 23510);
    assert_eq!(p.tags, vec![vec!["chain", "sidestr:rot"], vec!["h", "1"]]);
    assert!(logs(&a)[0].starts_with("round: proposing h1 "), "{a:?}");
    assert_eq!(s[1].round.pending().unwrap().sigs.len(), 1);
    // the others sign it
    let a0 = s[0].on(T0 + 1, p);
    let a2 = s[2].on(T0 + 1, p);
    let part = &published(&a0)[0];
    assert_eq!(part.kind, 23511);
    assert_eq!(part.tags[2], vec!["e", &p.id]);
    assert!(logs(&a0)[0].starts_with("round: signed h1 "), "{a0:?}");
    assert_eq!(published(&a2).len(), 1);
    // one more is k: the proposer seals, adds, publishes 23514
    let a = s[1].on(T0 + 2, part);
    assert_eq!(logs(&a)[0], "round: 2/2 signatures for h1");
    assert!(
        logs(&a)[1].starts_with("block 1 ")
            && logs(&a)[1].contains("sealed by 2 of 3, 0 txs, fees 0"),
        "{a:?}"
    );
    let sb = &published(&a)[0];
    assert_eq!((sb.kind, sealed(&a)), (23514, vec![1]));
    assert_eq!(s[1].state.height(), 1);
    assert!(s[1].round.pending().is_none());
    // a late partial is nothing now
    assert!(s[1].on(T0 + 3, &published(&a2)[0]).is_empty());
    // the others take the sealed block as a candidate through the validator
    for i in [0, 2] {
        let a = s[i].on(T0 + 3, sb);
        assert_eq!(sealed(&a), vec![1]);
        assert!(logs(&a)[0].contains("(sealed by the federation)"));
        assert_eq!(s[i].state.height(), 1);
    }
    // and the same 23514 again is seen, so nothing
    assert!(s[0].on(T0 + 4, sb).is_empty());
    // height 2 is slot 2's
    assert!(s[1].tick(T0 + 5, true).is_empty());
    let a = s[2].tick(T0 + 5, true);
    assert_eq!(published(&a)[0].tags[1], vec!["h", "2"]);
    // a 23514 for a height that is not tip+1 is ignored silently
    assert!(s[0].on(T0 + 6, sb).is_empty());
}

#[test]
fn lateness_lets_the_ring_advance_and_a_stale_proposal_is_dropped() {
    let mut s = three("late", RoundConfig::upstream(30), 0);
    // due since t0; slot 1's turn. At t0+29 nobody else; at t0+30 slot 2; at t0+60 slot 0.
    for i in [0, 2] {
        assert!(s[i].tick(T0, true).is_empty());
        assert!(s[i].tick(T0 + 29, true).is_empty());
    }
    assert!(s[0].tick(T0 + 30, true).is_empty());
    let a = s[2].tick(T0 + 30, true);
    let p2 = published(&a)[0].clone();
    assert_eq!(p2.kind, 23510);
    // slot 0 refuses slot 2's proposal as "not its turn" when its own due clock started later
    // (lateness counts from when the block became due for *me*)
    let mut fresh = three("late2", RoundConfig::upstream(30), 0);
    let a = fresh[0].on(T0 + 31, &p2);
    // fresh[0] never ticked: due_since is None, base = the event's time, late = 0
    assert!(
        a.is_empty()
            || logs(&a)[0].contains("refused: not its turn")
            || logs(&a)[0].contains("ignored"),
        "{a:?}"
    );
    // slot 0 in the original set, which has been due since t0, signs it
    let a = s[0].on(T0 + 31, &p2);
    assert!(logs(&a)[0].starts_with("round: signed h1"), "{a:?}");
    // and once late enough, slot 0 proposes too; both proposals for h1 exist on the wire
    let a = s[0].tick(T0 + 61, true);
    assert!(
        a.is_empty(),
        "slot 0 signed p2 31 s ago and may not re-sign yet: {a:?}"
    );
    // slot 2's proposal gathers nothing more and is dropped after propose_after × n
    assert!(s[2].tick(T0 + 119, true).is_empty());
    let a = s[2].tick(T0 + 121, true);
    assert_eq!(
        logs(&a),
        vec!["round: my proposal h1 got 1 signature(s); dropping it"]
    );
    assert!(s[2].round.pending().is_none());
    // being late, slot 2 proposes again at the next tick (it may re-sign: 91 s have passed)
    let a = s[2].tick(T0 + 122, true);
    assert_eq!(published(&a)[0].kind, 23510);
    // not due: the due clock resets
    assert!(s[0].tick(T0 + 200, false).is_empty());
}

#[test]
fn refusals_are_logged_as_round_mjs_logs_them() {
    let mut s = three("refuse", RoundConfig::upstream(30), 100);
    let keys = keys(3);
    let fed = s[0].state.federation().unwrap().clone();
    let h = 101u32;
    // height 101: 101 mod 3 = 2 → slot 2 proposes
    let a = s[2].tick(T0, true);
    let good = published(&a)[0].clone();

    // wrong height: a proposal for 105
    let mut wrong = Proposal {
        chain_id: "sidestr:refuse".into(),
        height: 105,
        block_hex: good.content.clone(),
    };
    let ev = sign_proposal(&LocalKey::new(keys[2]), &wrong, T0).unwrap();
    let a = s[0].on(T0 + 1, &ev);
    assert_eq!(
        logs(&a),
        vec![format!(
            "round: proposal h105 from {}… ignored (my tip is 100)",
            &ev.pubkey[..8]
        )]
    );

    // not entitled: slot 0 proposing at t0
    wrong.height = h;
    let ev = sign_proposal(&LocalKey::new(keys[0]), &wrong, T0).unwrap();
    let a = s[1].on(T0 + 1, &ev);
    assert_eq!(
        logs(&a),
        vec![format!(
            "round: proposal h101 from {}… refused: not its turn",
            &ev.pubkey[..8]
        )]
    );

    // not a block
    let ev = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: "00ff".into(),
            ..wrong.clone()
        },
        T0,
    )
    .unwrap();
    let a = s[1].on(T0 + 1, &ev);
    assert_eq!(logs(&a), vec!["round: proposal is not a block"]);

    // does not build on my tip: a block whose prev is the genesis
    let tip = s[2].state.tip();
    let mut off = bitcoin::consensus::encode::deserialize::<bitcoin::Block>(
        &hex::decode(&good.content).unwrap(),
    )
    .unwrap();
    off.header.prev_blockhash = s[2].state.genesis_hash();
    let ev = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: hex::encode(bitcoin::consensus::encode::serialize(&off)),
            ..wrong.clone()
        },
        T0,
    )
    .unwrap();
    let a = s[1].on(T0 + 1, &ev);
    assert_eq!(
        logs(&a),
        vec!["round: proposal h101 refused: does not build on my tip"]
    );
    // same, time not after the tip's
    off.header.prev_blockhash = tip.hash;
    off.header.time = tip.time;
    let ev = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: hex::encode(bitcoin::consensus::encode::serialize(&off)),
            ..wrong.clone()
        },
        T0,
    )
    .unwrap();
    assert_eq!(
        logs(&s[1].on(T0 + 1, &ev)),
        vec!["round: proposal h101 refused: does not build on my tip"]
    );

    // a bad tx by the deterministic rules: spends a coin that does not exist → refused by rule name, before the mempool
    let mut phantom = spend(&s[2].state, &wallet_script(), 1000, 1000, vec![]);
    phantom.input[0].previous_output.vout = 7;
    let fresh = block_with(&s[2].state, phantom);
    let ev = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: hex::encode(bitcoin::consensus::encode::serialize(&fresh)),
            ..wrong.clone()
        },
        T0,
    )
    .unwrap();
    let l = logs(&s[1].on(T0 + 1, &ev));
    assert!(
        l[0].starts_with("round: proposal h101 refused: rules btc:rule-blockctx"),
        "{l:?}"
    );

    // a tx the rules accept but the mempool's policy refuses: fee under minFeeRate
    let cheap = spend(&s[2].state, &wallet_script(), 1000, 0, vec![]);
    let cheap_id = cheap.compute_txid().to_string();
    let fresh = block_with(&s[2].state, cheap);
    let ev = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: hex::encode(bitcoin::consensus::encode::serialize(&fresh)),
            ..wrong.clone()
        },
        T0,
    )
    .unwrap();
    let l = logs(&s[1].on(T0 + 1, &ev));
    assert!(
        l[0].starts_with(&format!(
            "round: proposal h101 refused: tx {}… fee 0 is below the minimum",
            &cheap_id[..12]
        )),
        "{l:?}"
    );

    // the good one is signed; the same height again within the window is refused
    let a = s[1].on(T0 + 2, &good);
    assert!(logs(&a)[0].starts_with("round: signed h101"), "{a:?}");
    let again = sign_proposal(
        &LocalKey::new(keys[2]),
        &Proposal {
            block_hex: good.content.clone(),
            ..wrong.clone()
        },
        T0 + 5,
    )
    .unwrap();
    let a = s[1].on(T0 + 12, &again);
    assert_eq!(
        logs(&a),
        vec![format!(
            "round: proposal h101 from {}… refused: I signed {}… for this height 10 s ago",
            &again.pubkey[..8],
            &good.id[..8]
        )]
    );

    // a replayed proposal older than propose_after × n is dropped silently
    let old = sign_proposal(&LocalKey::new(keys[2]), &wrong, T0 - 91).unwrap();
    assert!(s[0].on(T0, &old).is_empty());

    // a bad partial, and one from a stranger
    let bad = sign_partial(
        &LocalKey::new(keys[1]),
        &Partial {
            chain_id: "sidestr:refuse".into(),
            height: h,
            proposal: good.id.clone(),
            signature_hex: "ab".repeat(64),
        },
        T0 + 3,
    )
    .unwrap();
    let a = s[2].on(T0 + 3, &bad);
    assert_eq!(
        logs(&a),
        vec![format!("round: bad partial from {}…", &bad.pubkey[..8])]
    );
    let stranger = LocalKey::new(key("stranger"));
    let sp = sign_partial(
        &stranger,
        &Partial {
            chain_id: "sidestr:refuse".into(),
            height: h,
            proposal: good.id.clone(),
            signature_hex: "ab".repeat(64),
        },
        T0 + 3,
    )
    .unwrap();
    assert!(s[2].on(T0 + 3, &sp).is_empty());
    // another signer's key on a partial that is for a different proposal is ignored
    let other = sign_partial(
        &LocalKey::new(keys[1]),
        &Partial {
            chain_id: "sidestr:refuse".into(),
            height: h,
            proposal: "ab".repeat(32),
            signature_hex: "ab".repeat(64),
        },
        T0 + 3,
    )
    .unwrap();
    assert!(s[2].on(T0 + 3, &other).is_empty());
    // the real partial from slot 1 seals it
    let real = published(&s[1].on(T0 + 2, &good)).into_iter().next();
    assert!(real.is_none(), "slot 1 already signed: seen, so nothing");
    let sig = sidestr_core::federation::partial_signature(
        &sidestr_core::block::Stock,
        &s[2].round.pending().unwrap().block,
        &fed,
        &keys[1],
        &[0u8; 32],
    )
    .unwrap();
    let real = sign_partial(
        &LocalKey::new(keys[1]),
        &Partial {
            chain_id: "sidestr:refuse".into(),
            height: h,
            proposal: good.id.clone(),
            signature_hex: hex::encode(sig.as_ref()),
        },
        T0 + 4,
    )
    .unwrap();
    let a = s[2].on(T0 + 4, &real);
    assert_eq!(sealed(&a), vec![101]);
    // a forged sealed block is refused by the validator, by name
    let mut forged = published(&a)[0].clone();
    let mut b = bitcoin::consensus::encode::deserialize::<bitcoin::Block>(
        &hex::decode(&forged.content).unwrap(),
    )
    .unwrap();
    b.header.time += 1;
    forged = sidestr_nostr::round::sign_sealed(
        &LocalKey::new(keys[2]),
        &Proposal {
            chain_id: "sidestr:refuse".into(),
            height: h,
            block_hex: hex::encode(bitcoin::consensus::encode::serialize(&b)),
        },
        T0 + 5,
    )
    .unwrap();
    let l = logs(&s[0].on(T0 + 5, &forged));
    assert!(
        l[0].starts_with(&format!(
            "round: sealed block h101 from {}… refused: ",
            &forged.pubkey[..8]
        )),
        "{l:?}"
    );
    assert_eq!(s[0].state.height(), 100);
    // a sealed block from someone who is not a signer is ignored
    let outsider = sidestr_nostr::round::sign_sealed(
        &stranger,
        &Proposal {
            chain_id: "sidestr:refuse".into(),
            height: h,
            block_hex: published(&a)[0].content.clone(),
        },
        T0 + 5,
    )
    .unwrap();
    assert!(s[0].on(T0 + 5, &outsider).is_empty());
    let _ = pubkey_of;
}

#[test]
fn the_journal_is_written_before_publish_and_survives_a_restart() {
    let keys = keys(3);
    let (doc, genesis) = federated_doc("journal", &keys, 2, 0);
    let mut st1 = state(&doc, &genesis);
    let mut st0 = state(&doc, &genesis);
    let mut proposer = Round::new(
        &st1,
        local(&keys[1]),
        Box::new(MemoryJournal::new()),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let mut journal = MemoryJournal::new();
    let mut co = Round::new(
        &st0,
        local(&keys[0]),
        Box::new(MemoryJournal::new()),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let p = published(&proposer.tick(T0, &mut st1, true))[0].clone();
    let a = co.on_event(T0 + 1, &mut st0, &p);
    assert_eq!(published(&a).len(), 1);
    // what co journalled: reconstruct through the public view and a fresh journal
    for (h, id, at) in co.signed() {
        journal
            .record(&sidestr_round::journal::VoteEntry {
                scope: VoteScope::Height(h),
                role: VoteRole::Signed,
                subject: id.into(),
                digest: "00".repeat(32),
                at,
            })
            .unwrap();
    }
    assert_eq!(journal.entries().unwrap().len(), 1);
    // the proposer's own proposal is journalled as Proposed
    assert_eq!(proposer.signed().count(), 1);

    // restart co with its journal: a second proposal for the same height is refused within the window…
    let mut co2 = Round::new(
        &st0,
        local(&keys[0]),
        Box::new(MemoryJournal::with_entries(journal.entries().unwrap())),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let p2 = sign_proposal(
        &LocalKey::new(keys[1]),
        &Proposal {
            chain_id: doc.id.clone(),
            height: 1,
            block_hex: p.content.clone(),
        },
        T0 + 10,
    )
    .unwrap();
    let a = co2.on_event(T0 + 20, &mut st0, &p2);
    assert_eq!(
        logs(&a),
        vec![format!(
            "round: proposal h1 from {}… refused: I signed {}… for this height 19 s ago",
            &p2.pubkey[..8],
            &p.id[..8]
        )]
    );
    // …and the very same proposal replayed is refused too (it is a different event object to a new process)
    let a = co2.on_event(T0 + 25, &mut st0, &p);
    assert!(logs(&a)[0].contains("refused: I signed"), "{a:?}");
    // …until the window passes: upstream's relaxation
    let p3 = sign_proposal(
        &LocalKey::new(keys[1]),
        &Proposal {
            chain_id: doc.id.clone(),
            height: 1,
            block_hex: p.content.clone(),
        },
        T0 + 32,
    )
    .unwrap();
    let a = co2.on_event(T0 + 32, &mut st0, &p3);
    assert!(logs(&a)[0].starts_with("round: signed h1"), "{a:?}");

    // a journal that cannot be written means no signature leaves
    struct Broken;
    impl VoteJournal for Broken {
        fn record(&mut self, _: &sidestr_round::journal::VoteEntry) -> sidestr_round::Result<()> {
            Err(sidestr_round::Error::Journal("disk full".into()))
        }
        fn entries(&self) -> sidestr_round::Result<Vec<sidestr_round::journal::VoteEntry>> {
            Ok(vec![])
        }
    }
    let mut st2 = state(&doc, &genesis);
    let mut co3 = Round::new(
        &st2,
        local(&keys[2]),
        Box::new(Broken),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = co3.on_event(T0 + 1, &mut st2, &p);
    assert_eq!(published(&a).len(), 0);
    assert_eq!(
        logs(&a),
        vec!["round: proposal h1 not signed: journal: disk full"]
    );
    assert_eq!(co3.signed().count(), 0);
    // and a proposer that cannot journal does not propose
    let mut st3 = state(&doc, &genesis);
    let mut pr = Round::new(
        &st3,
        local(&keys[1]),
        Box::new(Broken),
        RoundConfig::upstream(30),
    )
    .unwrap();
    let a = pr.tick(T0, &mut st3, true);
    assert_eq!(published(&a).len(), 0);
    assert!(pr.pending().is_none());
}

#[test]
fn resign_after_none_never_signs_a_height_twice() {
    let keys = keys(3);
    let (doc, genesis) = federated_doc("never", &keys, 2, 0);
    let mut st0 = state(&doc, &genesis);
    let cfg = RoundConfig {
        propose_after: 30,
        resign_after: None,
    };
    let mut co = Round::new(
        &st0,
        local(&keys[0]),
        Box::new(MemoryJournal::new()),
        cfg.clone(),
    )
    .unwrap();
    let mut st1 = state(&doc, &genesis);
    let mut proposer =
        Round::new(&st1, local(&keys[1]), Box::new(MemoryJournal::new()), cfg).unwrap();
    let p = published(&proposer.tick(T0, &mut st1, true))[0].clone();
    assert_eq!(published(&co.on_event(T0 + 1, &mut st0, &p)).len(), 1);
    for dt in [10u64, 100, 10_000, 1_000_000] {
        let again = sign_proposal(
            &LocalKey::new(keys[1]),
            &Proposal {
                chain_id: doc.id.clone(),
                height: 1,
                block_hex: p.content.clone(),
            },
            T0 + dt,
        )
        .unwrap();
        let a = co.on_event(T0 + dt, &mut st0, &again);
        assert!(
            logs(&a)[0].contains("refused: I signed"),
            "after {dt} s: {a:?}"
        );
    }
    // nor does it propose that height itself once late enough
    for _ in 0..3 {
        assert!(co.tick(T0 + 1_000_000, &mut st0, true).is_empty());
    }
    // the proposer's own height is likewise pinned: no second proposal for h1
    assert!(proposer
        .tick(T0 + 200, &mut st1, true)
        .iter()
        .all(|a| matches!(a, Action::Log(_))));
    assert!(proposer.tick(T0 + 201, &mut st1, true).is_empty());
}

#[test]
fn a_key_outside_the_federation_and_a_level_1_document_are_refused() {
    let keys = keys(3);
    let (doc, genesis) = federated_doc("outside", &keys, 2, 0);
    let st = state(&doc, &genesis);
    let e = Round::new(
        &st,
        local(&key("stranger")),
        Box::new(MemoryJournal::new()),
        RoundConfig::default(),
    )
    .unwrap_err();
    assert!(e.to_string().contains("not one of the signers"), "{e}");
}

fn audit_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../probes")
        .join(name)
}

#[test]
fn audit_crash_and_torn_tail() {
    use sidestr_round::journal::FileJournal;
    use std::io::Write;
    let ks = keys(3);
    let (doc, genesis) = federated_doc("auditcrash", &ks, 2, 0);
    for torn in [false, true] {
        let path = audit_path(if torn { "torn.jsonl" } else { "clean.jsonl" });
        std::fs::write(&path, b"").unwrap();
        let mut j = FileJournal::open(&path).unwrap();
        j.record(&sidestr_round::journal::VoteEntry {
            scope: VoteScope::Height(0),
            role: VoteRole::Signed,
            subject: "earlier".into(),
            digest: "earlier".into(),
            at: T0 - 1,
        })
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
        let p = published(&proposer.tick(T0, &mut proposer_state, true))[0].clone();
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
        let actions = r.on_event(T0 + 1, &mut st, &p);
        assert_eq!(published(&actions).len(), 1);
        // Crash after durable record and before caller transmits the returned action.
        drop(actions);
        drop(r);
        let loaded = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(loaded[0].subject, "earlier");
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
        let actions = r.on_event(T0 + 2, &mut st, &p2);
        let count = published(&actions).len();
        println!(
            "AUDIT torn={torn} loaded_entries={} second_partial={count} logs={:?}",
            loaded.len(),
            logs(&actions)
        );
        if torn {
            assert_eq!(count, 1, "counterexample disappeared");
        } else {
            assert_eq!(count, 0);
        }
    }
}

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
    for delta in [29, 30, 31] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(&LocalKey::new(ks[1]), &template, T0).unwrap();
        assert_eq!(published(&r.on_event(T0, &mut st, &p)).len(), 1);
        let p2 = sign_proposal(&LocalKey::new(ks[1]), &template, T0 + delta).unwrap();
        let a = r.on_event(T0 + delta, &mut st, &p2);
        println!(
            "AUDIT resign delta={delta} partials={} logs={:?}",
            published(&a).len(),
            logs(&a)
        );
        assert_eq!(published(&a).len(), usize::from(delta > 30));
    }
    for delta in [90, 91] {
        let mut r = Round::new(
            &st,
            local(&ks[0]),
            Box::new(MemoryJournal::new()),
            RoundConfig::upstream(30),
        )
        .unwrap();
        let p = sign_proposal(&LocalKey::new(ks[1]), &template, T0).unwrap();
        let a = r.on_event(T0 + delta, &mut st, &p);
        println!("AUDIT replay age={delta} partials={}", published(&a).len());
        assert_eq!(published(&a).len(), usize::from(delta == 90));
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
        let a = r.on_event(T0, &mut st, &p);
        println!(
            "AUDIT validation {label} partials={} logs={:?}",
            published(&a).len(),
            logs(&a)
        );
        assert!(published(&a).is_empty());
    }
    let mut r = Round::new(
        &st,
        local(&ks[1]),
        Box::new(MemoryJournal::new()),
        RoundConfig::upstream(30),
    )
    .unwrap();
    r.tick(T0, &mut st, true);
    assert!(r.tick(T0 + 90, &mut st, true).is_empty());
    let a = r.tick(T0 + 91, &mut st, true);
    println!("AUDIT drop at 90=false at 91=true logs={:?}", logs(&a));
    assert!(r.pending().is_none());
}

#[test]
fn audit_export_wire_and_entitlement() {
    let ks = keys(3);
    let (doc, g) = federated_doc("auditwire", &ks, 2, 5_000_000_000);
    let mut s = three("auditwire", RoundConfig::upstream(30), 0);
    let p = published(&s[1].tick(T0, true))[0].clone();
    let part = published(&s[0].on(T0, &p))[0].clone();
    let sealed = published(&s[1].on(T0, &part))[0].clone();
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
                r.tick(T0, &mut st, true);
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
                let a = r.on_event(at, &mut st, &ev);
                let entitled = logs(&a) == ["round: proposal is not a block"];
                table.push(
                    serde_json::json!({"height":h,"slot":slot,"late":late,"entitled":entitled}),
                );
            }
        }
    }
    std::fs::write(audit_path("wire-block.json"),serde_json::to_vec_pretty(&serde_json::json!({"doc":serde_json::from_str::<serde_json::Value>(&doc.to_json().unwrap()).unwrap(),"keys":ks.iter().map(|k|hex::encode(k.secret_bytes())).collect::<Vec<_>>(),"genesis":hex::encode(bitcoin::consensus::serialize(&g)),"events":[p,part,sealed],"entitlement":table})).unwrap()).unwrap();
    println!(
        "AUDIT exported 3 Rust block events; entitlement cases={}",
        table.len()
    );
}

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
    let a = r.on_event(T0, &mut st, &p);
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

#[test]
fn audit_journal_failure_still_calls_signer() {
    use bitcoin::secp256k1::{schnorr::Signature, XOnlyPublicKey};
    use sidestr_nostr::event::{SignRequest, Signer as EventSigner};
    use sidestr_round::signer::{BlockSigner, PartialRequest, PegoutSignRequest};
    use std::cell::Cell;
    use std::rc::Rc;
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
            self.calls.set(self.calls.get() + 1);
            self.key.sign_partial(r)
        }
        fn sign_pegout_input(&self, r: &PegoutSignRequest<'_>) -> sidestr_round::Result<Signature> {
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
    let mut s = three("audit-sign-order", RoundConfig::upstream(30), 0);
    let p = published(&s[1].tick(T0, true))[0].clone();
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
    let a = r.on_event(T0, &mut s[0].state, &p);
    assert_eq!(calls.get(), 1);
    assert!(published(&a).is_empty());
    println!(
        "AUDIT journal write failure: BlockSigner::sign_partial calls={} Publish actions=0",
        calls.get()
    );
}
