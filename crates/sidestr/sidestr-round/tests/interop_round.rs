//! Acceptance 2: `test/round-test.sh` with mixed engines. Three signers on
//! one box through the relay stand-in — {Rust, JS, JS} and then
//! {Rust, Rust, JS} on a throwaway 2-of-3 chain the reference makes (beside
//! `txbt4`, so the BLAKE2b family too): rotation, blocks sealed by a Rust
//! proposer with a JS co-signer's slot filled and by a JS proposer with a
//! Rust slot filled, one signer down tolerated, two halts, one back
//! resumes, and the Rust signer restarted on its journal neither forgets
//! nor double-signs. Needs `SIDESTR_SIDING`, `SCHEMA` and `BLAKETESTNODE`;
//! without them the test reports itself skipped and passes.
#![cfg(all(feature = "bin", feature = "relay"))]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use sidestr_core::block::{pubkey_of, verify_block_solution, BlockSolution, SidestrBlock};
use sidestr_core::federation::Federation;
use sidestr_header::Blake2bV2;
use sidestr_nostr::event::Event;
use sidestr_round::journal::{VoteEntry, VoteScope};
use sidestr_round::relay::RelayStandIn;
use support::interop::*;
use support::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Engine {
    Rust,
    Js,
}

/// Which slots each sealed block's witness carries, and who published it.
fn sealed_blocks(events: &[Event], fed: &Federation) -> Vec<(String, u32, Vec<bool>)> {
    events
        .iter()
        .filter(|e| e.kind == 23514)
        .filter_map(|e| {
            let h: u32 = sidestr_nostr::tags::first(&e.tags, "h")?.parse().ok()?;
            let block = <Blake2bV2 as sidestr_core::block::HeaderFamily>::Block::decode(
                &hex::decode(&e.content).ok()?,
            )
            .ok()?;
            match verify_block_solution(&Blake2bV2, &block, &fed.challenge()) {
                Ok(BlockSolution::ScriptPath(m)) => Some((e.pubkey.clone(), h, m.signed)),
                _ => None,
            }
        })
        .collect()
}

async fn scenario(tag: &str, layout: [Engine; 3]) {
    let Some(u) = skip_unless_upstream() else {
        return;
    };
    let scratch = Scratch::new(tag);
    let relay = RelayStandIn::start("127.0.0.1:0").await.unwrap();
    let relay_url = relay.url();
    let ks = keys(3);
    let pubs: Vec<String> = ks.iter().map(|k| pubkey_of(k).to_string()).collect();
    let key_paths: Vec<_> = (1..=3).map(|i| scratch.path(&format!("k{i}"))).collect();
    for (p, k) in key_paths.iter().zip(&ks) {
        write_key(p, k);
    }
    let chain = scratch.path("chain.json");
    let g = scratch.path("g");
    // the reference makes the 2-of-3 document and seals the genesis with keys 1 and 2 (round-test.sh)
    let out = js_run(
        &u,
        &[
            "new",
            "--name",
            &format!("rt{tag}"),
            "--prefix",
            "rt",
            "--signers",
            &pubs.join(","),
            "--threshold",
            "2",
            "--key-files",
            &format!("{},{}", key_paths[0].display(), key_paths[1].display()),
            "--out",
            &chain.display().to_string(),
            "--dir",
            &g.display().to_string(),
        ],
    );
    assert!(out.contains("\"threshold\": 2"), "{out}");
    let doc =
        sidestr_core::document::ChainDocument::from_json(&std::fs::read_to_string(&chain).unwrap())
            .unwrap();
    let fed = Federation::for_document(&doc).unwrap().unwrap();
    let ports: Vec<u16> = (0..3).map(|_| free_port()).collect();
    let dirs: Vec<_> = (1..=3).map(|i| scratch.path(&format!("d{i}"))).collect();
    for d in &dirs {
        copy_chain(&g, d);
    }
    let start = |i: usize, attempt: u32| -> Proc {
        let name = format!("signer {} ({:?})", i + 1, layout[i]);
        let log = scratch.path(&format!("p{}-{attempt}.log", i + 1));
        match layout[i] {
            Engine::Js => js_signer(
                &u,
                &name,
                &chain,
                &dirs[i],
                &key_paths[i],
                ports[i],
                &relay_url,
                &[],
                log,
            ),
            Engine::Rust => rust_signer(
                &name,
                &chain,
                &dirs[i],
                &key_paths[i],
                ports[i],
                &relay_url,
                &[],
                log,
            ),
        }
    };
    let rust: BTreeSet<String> = (0..3)
        .filter(|i| layout[*i] == Engine::Rust)
        .map(|i| pubs[i].clone())
        .collect();
    let js: BTreeSet<String> = (0..3)
        .filter(|i| layout[*i] == Engine::Js)
        .map(|i| pubs[i].clone())
        .collect();
    let mut procs: Vec<Proc> = (0..3).map(|i| start(i, 1)).collect();
    tokio::time::sleep(Duration::from_secs(6)).await;
    for p in &procs {
        assert!(
            p.log().contains("level 2: signer"),
            "{} did not start as a signer:\n{}",
            p.name,
            p.log()
        );
    }
    let fail = |what: &str, procs: &[Proc]| -> ! {
        for p in procs {
            eprintln!("--- {} ---\n{}", p.name, p.tail(12));
        }
        panic!("{what}");
    };

    // mining until height 4 (up to 120 s)
    if !wait_for(120, || tip(ports[0]) >= 4).await {
        fail("no block 4 in 120 s", &procs);
    }
    let (h2, h3) = (tip(ports[1]), tip(ports[2]));
    eprintln!("  tips: 1={} 2={h2} 3={h3}", tip(ports[0]));
    assert!(
        h2 >= 3 && h3 >= 3,
        "the other signers did not follow: 2={h2} 3={h3}"
    );

    // proposals came from more than one signer (rotation), and the mix is real: sealed blocks whose
    // witness carries a slot of the other engine, in both directions
    let events = relay.events();
    let proposers: BTreeSet<String> = events
        .iter()
        .filter(|e| e.kind == 23510)
        .map(|e| e.pubkey.clone())
        .collect();
    assert!(
        proposers.len() >= 2,
        "only one signer ever proposed: {proposers:?}"
    );
    let sealed = sealed_blocks(&events, &fed);
    assert!(!sealed.is_empty(), "no sealed block on the relay verifies");
    let slot_of = |pk: &str| pubs.iter().position(|p| p == pk).unwrap();
    let rust_seal_with_js = sealed.iter().any(|(by, _, slots)| {
        rust.contains(by)
            && slots
                .iter()
                .enumerate()
                .any(|(i, s)| *s && js.contains(&pubs[i]))
    });
    let js_seal_with_rust = sealed.iter().any(|(by, _, slots)| {
        js.contains(by)
            && slots
                .iter()
                .enumerate()
                .any(|(i, s)| *s && rust.contains(&pubs[i]))
    });
    eprintln!(
        "  sealed blocks on the relay: {:?}",
        sealed
            .iter()
            .map(|(by, h, s)| (slot_of(by) + 1, h, s.clone()))
            .collect::<Vec<_>>()
    );
    // a JS co-signature on a Rust proposal: in the witness when the seal needed it, or — with two Rust
    // signers answering each other first, so the first k in leaf order never include JS — as a JS 23511
    // that references a Rust 23510: JS validated the Rust proposal and signed it
    let js_signed_rust_proposal = events.iter().any(|p| {
        p.kind == 23511
            && js.contains(&p.pubkey)
            && sidestr_nostr::tags::first(&p.tags, "e").is_some_and(|e| {
                events
                    .iter()
                    .any(|q| q.kind == 23510 && q.id == e && rust.contains(&q.pubkey))
            })
    });
    assert!(
        js_seal_with_rust,
        "no block sealed by a JS proposer carries a Rust co-signature: {sealed:?}"
    );
    assert!(
        rust_seal_with_js || js_signed_rust_proposal,
        "JS never co-signed a Rust proposal: {sealed:?}"
    );
    eprintln!(
        "  JS on Rust proposals: {}",
        if rust_seal_with_js {
            "in a sealed witness"
        } else {
            "as a 23511 on a Rust 23510 (the seal took the other Rust slot first)"
        }
    );

    // signer 3 down: 2 of 3 keep going
    procs[2].kill();
    tokio::time::sleep(Duration::from_secs(1)).await;
    let h0 = tip(ports[0]);
    if !wait_for(60, || tip(ports[0]) >= h0 + 2).await {
        fail(
            &format!("the chain did not advance with 2 of 3 (from {h0} in 60 s)"),
            &procs,
        );
    }
    eprintln!("  advanced {h0} -> {}", tip(ports[0]));

    // signer 2 down too: 1 of 3 halts
    procs[1].kill();
    tokio::time::sleep(Duration::from_secs(1)).await;
    let h0 = tip(ports[0]);
    tokio::time::sleep(Duration::from_secs(30)).await;
    let h = tip(ports[0]);
    assert_eq!(h, h0, "the chain advanced with one signer ({h0} -> {h})");
    eprintln!("  held at {h0} for 30 s");
    if procs[0].log().contains("dropping it") {
        eprintln!("  (signer 1's lone proposal was dropped)");
    }

    // signer 2 back: the chain resumes
    procs[1] = start(1, 2);
    if !wait_for(60, || tip(ports[0]) >= h0 + 2).await {
        fail(
            &format!("the chain did not resume ({h0} -> {})", tip(ports[0])),
            &procs,
        );
    }
    eprintln!("  resumed {h0} -> {}", tip(ports[0]));

    // the Rust signer restarted on its journal: it loads what it signed, keeps following, and every
    // signature it ever published is in the journal with no two within the window at one height
    let r = (0..3).find(|i| layout[*i] == Engine::Rust).unwrap();
    procs[r].kill();
    tokio::time::sleep(Duration::from_secs(1)).await;
    procs[r] = start(r, 2);
    tokio::time::sleep(Duration::from_secs(3)).await;
    let log = procs[r].log();
    let loaded: usize = log
        .lines()
        .find_map(|l| {
            l.split("journal ")
                .nth(1)
                .and_then(|s| s.split('(').nth(1))
                .and_then(|s| s.split(' ').next())
                .and_then(|n| n.parse().ok())
        })
        .unwrap_or(0);
    assert!(
        loaded > 0,
        "the restarted signer loaded no journal entries:\n{log}"
    );
    let h0 = tip(ports[r]);
    if !wait_for(60, || tip(ports[r]) > h0).await {
        fail("the restarted Rust signer did not continue", &procs);
    }
    let journal: Vec<VoteEntry> = std::fs::read_to_string(dirs[r].join("votes.jsonl"))
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let subjects: BTreeSet<&str> = journal.iter().map(|e| e.subject.as_str()).collect();
    let events = relay.events();
    let mine_partials: Vec<&Event> = events
        .iter()
        .filter(|e| e.kind == 23511 && e.pubkey == pubs[r])
        .collect();
    let mine_proposals: Vec<&Event> = events
        .iter()
        .filter(|e| e.kind == 23510 && e.pubkey == pubs[r])
        .collect();
    assert!(!mine_partials.is_empty() || !mine_proposals.is_empty());
    for p in &mine_partials {
        let e = sidestr_nostr::tags::first(&p.tags, "e").unwrap();
        assert!(
            subjects.contains(e),
            "a published partial {}… is not in the journal",
            &p.id[..12]
        );
    }
    for p in &mine_proposals {
        assert!(
            subjects.contains(p.id.as_str()),
            "a published proposal {}… is not in the journal",
            &p.id[..12]
        );
    }
    let mut by_height: BTreeMap<u32, Vec<&VoteEntry>> = BTreeMap::new();
    for e in &journal {
        if let VoteScope::Height(h) = e.scope {
            by_height.entry(h).or_default().push(e);
        }
    }
    for (h, votes) in &by_height {
        let mut v = votes.clone();
        v.sort_by_key(|e| e.at);
        for w in v.windows(2) {
            if w[0].subject != w[1].subject {
                assert!(
                    w[1].at - w[0].at > 8,
                    "h{h}: two authorisations {} s apart, inside the 8 s window",
                    w[1].at - w[0].at
                );
            }
        }
    }
    eprintln!(
        "  journal: {} entries over {} heights, every published signature journalled",
        journal.len(),
        by_height.len()
    );
    eprintln!("=== passed ({layout:?}): 2-of-3 blocks through the round, rotation, mixed sealing both ways, one signer down tolerated, two halts, one back resumes, Rust restart on its journal");
    for p in &mut procs {
        p.kill();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rust_js_js() {
    scenario("rjj", [Engine::Rust, Engine::Js, Engine::Js]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rust_rust_js() {
    scenario("rrj", [Engine::Rust, Engine::Rust, Engine::Js]).await;
}
