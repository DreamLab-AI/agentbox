//! The reference toolchain as oracle: `fixtures/oracle-vectors.json` was
//! written by siding's `tipEvent` and `relay.mjs makeEvents` over the schema
//! kernel's hash and secp256k1 (upstream commit
//! `2de40bdac4cba01be0864156a553d8287c22e279`) for the disposable
//! `sidestr:trial` signer key that `sidestr-core` carries in
//! `fixtures/trial/trial.key`, with zero BIP-340 auxiliary randomness.
//!
//! Two levels of proof:
//! - **verify-only**, always: every vector's id is the hash this crate
//!   computes and its signature verifies under this crate's BIP-340.
//! - **byte-identical**, when the sibling crate's trial key is on disk (it is
//!   in the workspace, not in this crate's package): the same event built and
//!   signed here has the same id **and** the same signature bytes.
//!
//! `upstream.*` in the fixture records what siding's `parseTip` and
//! `judgeMirror` returned for the same inputs, so the departures are pinned
//! too: `parseTip_stock` is `null` upstream and a `Tip` here.

use serde_json::Value;
use sidestr_core::parents::Family;
use sidestr_nostr::event::{Event, SecretKeySigner};
use sidestr_nostr::record::{parse_record, sign_pledge, Record};
use sidestr_nostr::round::{
    parse_partial, parse_pegout_psbt, parse_pegout_signed, parse_proposal, parse_sealed,
    sign_partial, sign_pegout_psbt, sign_pegout_signed, sign_proposal, sign_sealed, Partial,
    PegoutPsbt, PegoutSigned, Proposal,
};
use sidestr_nostr::tags::Outpoint;
use sidestr_nostr::tip::{judge_mirror, parse_tip, parse_tip_as, sign_tip, TipTemplate, Verdict};
use sidestr_nostr::tx::{
    parse_faucet_request, parse_transaction, sign_faucet_request, sign_transaction_event,
};

fn vectors() -> Value {
    serde_json::from_str(include_str!("../fixtures/oracle-vectors.json")).unwrap()
}

fn event(v: &Value, name: &str) -> Event {
    serde_json::from_value(v["events"][name].clone()).unwrap()
}

/// The sibling crate's disposable key, when the workspace is around us.
fn trial_signer() -> Option<SecretKeySigner> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../sidestr-core/fixtures/trial/trial.key"
    );
    let text = std::fs::read_to_string(path).ok()?;
    Some(SecretKeySigner::from_hex(&text).unwrap())
}

const AT: u64 = 1_790_100_000;
const CHAIN: &str = "sidestr:trial";

fn h(i: u8, bytes: usize) -> String {
    format!("{i:02x}").repeat(bytes)
}

#[test]
fn every_vector_verifies_under_this_crate() {
    let v = vectors();
    let names: Vec<&String> = v["events"].as_object().unwrap().keys().collect();
    assert_eq!(names.len(), 11);
    for n in names {
        let ev = event(&v, n);
        assert_eq!(ev.pubkey, v["pubkey"].as_str().unwrap(), "{n}");
        ev.verify().unwrap_or_else(|e| panic!("{n}: {e}"));
        assert_eq!(ev.to_unsigned().id(), ev.id, "{n}: id");
    }
}

#[test]
fn the_kernels_random_aux_signature_verifies_but_is_not_ours() {
    let v = vectors();
    let rand = event(&v, "tipRand");
    rand.verify().unwrap();
    let Some(signer) = trial_signer() else { return };
    let t = TipTemplate::new(CHAIN, 12, vec![h(1, 80), h(2, 80), h(3, 80)], vec![]).unwrap();
    let ours = sign_tip(&signer, &t, rand.created_at).unwrap();
    assert_eq!(ours.id, rand.id, "same fields, same id");
    assert_ne!(
        ours.sig, rand.sig,
        "random aux upstream, zero here: both valid"
    );
}

#[test]
fn the_stock_tip_is_byte_identical_and_parses_where_upstream_returns_null() {
    let v = vectors();
    let theirs = event(&v, "tipStock");
    assert!(
        v["upstream"]["parseTip_stock"].is_null(),
        "upstream parseTip rejects stock headers"
    );
    let tip = parse_tip(&theirs).unwrap();
    assert_eq!(
        (tip.tip, tip.family, tip.headers_hex.len()),
        (12, Some(Family::Stock), 3)
    );
    assert_eq!(
        tip.mirrors,
        ["https://a.example/siding", "https://b.example/siding"]
    );
    assert_eq!(tip.headers_hex[2], h(3, 80));
    if let Some(signer) = trial_signer() {
        let t = TipTemplate::new(
            CHAIN,
            12,
            vec![h(1, 80), h(2, 80), h(3, 80)],
            vec![
                "https://a.example/siding/".into(),
                "https://b.example/siding".into(),
            ],
        )
        .unwrap();
        let ours = sign_tip(&signer, &t, AT).unwrap();
        assert_eq!(ours, theirs, "tags, content, id and signature");
        assert_eq!(
            serde_json::to_value(&ours).unwrap(),
            v["events"]["tipStock"]
        );
    }
}

#[test]
fn the_v2_tip_matches_upstream_parse_and_judgement() {
    let v = vectors();
    let theirs = event(&v, "tipV2");
    let up = &v["upstream"]["parseTip_v2"];
    let tip = parse_tip_as(&theirs, Family::Blake2b).unwrap();
    assert_eq!(parse_tip(&theirs).unwrap(), tip);
    assert_eq!(tip.tip as u64, up["tip"].as_u64().unwrap());
    assert_eq!(tip.chain_id, up["chainId"].as_str().unwrap());
    assert_eq!(tip.pubkey, up["pubkey"].as_str().unwrap());
    assert_eq!(tip.id, up["id"].as_str().unwrap());
    let up_headers: Vec<&str> = up["headersHex"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap())
        .collect();
    assert_eq!(tip.headers_hex, up_headers);
    let up_mirrors: Vec<&str> = up["mirrors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap())
        .collect();
    assert_eq!(tip.mirrors, up_mirrors);

    let judge = |name: &str, verdict: Verdict| {
        let j = &v["upstream"][name];
        assert_eq!(
            verdict.ok().map(Value::from).unwrap_or(Value::Null),
            j["ok"],
            "{name}"
        );
        assert_eq!(verdict.to_string(), j["note"].as_str().unwrap(), "{name}");
    };
    judge(
        "judge_match",
        judge_mirror(Some(&tip), 12, Some(&h(3, 164))),
    );
    judge(
        "judge_behind",
        judge_mirror(Some(&tip), 11, Some(&h(2, 164))),
    );
    judge(
        "judge_wrong",
        judge_mirror(Some(&tip), 12, Some(&h(9, 164))),
    );
    judge(
        "judge_ahead",
        judge_mirror(Some(&tip), 13, Some(&h(3, 164))),
    );
    judge("judge_none", judge_mirror(None, 12, Some(&h(3, 164))));

    if let Some(signer) = trial_signer() {
        let t = TipTemplate::new(
            CHAIN,
            12,
            vec![h(1, 164), h(2, 164), h(3, 164)],
            vec!["https://a.example/siding/".into()],
        )
        .unwrap();
        assert_eq!(sign_tip(&signer, &t, AT).unwrap(), theirs);
    }
}

#[test]
fn transaction_and_faucet_events_are_byte_identical() {
    let v = vectors();
    let tx = event(&v, "tx");
    assert_eq!(
        parse_transaction(&tx, Some(CHAIN)).unwrap().tx_hex,
        tx.content
    );
    let faucet = event(&v, "faucet");
    assert_eq!(
        parse_faucet_request(&faucet, Some(CHAIN))
            .unwrap()
            .destination,
        faucet.content
    );
    if let Some(signer) = trial_signer() {
        assert_eq!(
            sign_transaction_event(&signer, CHAIN, &tx.content, AT).unwrap(),
            tx
        );
        assert_eq!(
            sign_faucet_request(&signer, CHAIN, &faucet.content, AT).unwrap(),
            faucet
        );
    }
}

#[test]
fn round_events_are_byte_identical() {
    let v = vectors();
    let proposal = event(&v, "proposal");
    let partial = event(&v, "partial");
    let sealed = event(&v, "sealed");
    let psbt = event(&v, "psbt");
    let psbt_signed = event(&v, "psbtSigned");
    let p = parse_proposal(&proposal, Some(CHAIN)).unwrap();
    assert_eq!((p.height, p.block_hex.len()), (7, 180));
    let s = parse_partial(&partial, Some(CHAIN)).unwrap();
    assert_eq!((s.height, s.proposal.as_str()), (7, proposal.id.as_str()));
    assert_eq!(parse_sealed(&sealed, None).unwrap().block_hex, p.block_hex);
    let q = parse_pegout_psbt(&psbt, Some(CHAIN)).unwrap();
    assert_eq!(
        (q.burn.clone(), q.height, q.psbt.as_str()),
        (
            Outpoint {
                txid: "ab".repeat(32),
                vout: 1
            },
            7,
            "cHNidP8BAA=="
        )
    );
    let r = parse_pegout_signed(&psbt_signed, Some(CHAIN)).unwrap();
    assert_eq!(
        (r.burn, r.request.as_str()),
        (q.burn.clone(), psbt.id.as_str())
    );
    if let Some(signer) = trial_signer() {
        assert_eq!(
            sign_proposal(
                &signer,
                &Proposal {
                    chain_id: CHAIN.into(),
                    height: 7,
                    block_hex: "00".repeat(90)
                },
                AT
            )
            .unwrap(),
            proposal
        );
        assert_eq!(
            sign_partial(
                &signer,
                &Partial {
                    chain_id: CHAIN.into(),
                    height: 7,
                    proposal: proposal.id.clone(),
                    signature_hex: "ab".repeat(64)
                },
                AT
            )
            .unwrap(),
            partial
        );
        assert_eq!(
            sign_sealed(
                &signer,
                &Proposal {
                    chain_id: CHAIN.into(),
                    height: 7,
                    block_hex: "00".repeat(90)
                },
                AT
            )
            .unwrap(),
            sealed
        );
        assert_eq!(
            sign_pegout_psbt(
                &signer,
                &PegoutPsbt {
                    chain_id: CHAIN.into(),
                    burn: q.burn.clone(),
                    height: 7,
                    psbt: "cHNidP8BAA==".into()
                },
                AT
            )
            .unwrap(),
            psbt
        );
        assert_eq!(
            sign_pegout_signed(
                &signer,
                &PegoutSigned {
                    chain_id: CHAIN.into(),
                    burn: q.burn,
                    request: psbt.id.clone(),
                    psbt: "cHNidP8BAA==".into()
                },
                AT
            )
            .unwrap(),
            psbt_signed
        );
    }
}

#[test]
fn a_33502_with_junk_content_is_ambiguous_not_a_pledge() {
    // the oracle's 33502 carries content that is hex but not a transaction: upstream would
    // hand it to verifyPledge and fail there; here the envelope says so without a parent view
    let v = vectors();
    let ev = event(&v, "pledge");
    match parse_record(&ev).unwrap() {
        Record::Ambiguous(a) => {
            assert_eq!(
                a.outpoint,
                Outpoint {
                    txid: "ab".repeat(32),
                    vout: 0
                }
            );
            assert!(a.reason.contains("not a transaction"), "{}", a.reason);
        }
        other => panic!("{other:?}"),
    }
    // building the same envelope here is refused up front for the same reason
    if let Some(signer) = trial_signer() {
        assert!(sign_pledge(
            &signer,
            CHAIN,
            &Outpoint {
                txid: "ab".repeat(32),
                vout: 0
            },
            &ev.content,
            AT
        )
        .is_err());
    }
}
