use k256::schnorr::{Signature, VerifyingKey};
use nostr_bbs_core::keys::signing_key_from_bytes;
use nostr_bbs_core::event::{sign_event, NostrEvent, UnsignedEvent};
use nostr_receipt::*;

/// The signing primitive under `nostr-bbs-core` reproduces the official BIP-340 vectors
/// (bitcoin/bips, bip-0340/test-vectors.csv), signing and verification both.
#[test]
fn bip340_official_vectors() {
    let csv = include_str!("vectors/bip340.csv");
    let mut checked = 0;
    for line in csv.lines().skip(1) {
        let c: Vec<&str> = line.split(',').collect();
        let (sk, pk, aux, msg, sig, expect) = (c[1], c[2], c[3], c[4], c[5], c[6] == "TRUE");
        let msg = hex::decode(msg).unwrap();
        let sig_bytes = hex::decode(sig).unwrap();
        if !sk.is_empty() {
            let key = signing_key_from_bytes(&hex::decode(sk).unwrap().try_into().unwrap()).unwrap();
            let aux: [u8; 32] = hex::decode(aux).unwrap().try_into().unwrap();
            let produced = key.sign_raw(&msg, &aux).unwrap();
            assert_eq!(hex::encode_upper(produced.to_bytes()), sig.to_uppercase(), "vector {}", c[0]);
            assert_eq!(hex::encode_upper(key.verifying_key().to_bytes()), pk.to_uppercase(), "vector {}", c[0]);
        }
        let verified = VerifyingKey::from_slice(&hex::decode(pk).unwrap())
            .ok()
            .zip(Signature::try_from(sig_bytes.as_slice()).ok())
            .is_some_and(|(vk, s)| vk.verify_raw(&msg, &s).is_ok());
        assert_eq!(verified, expect, "vector {} ({})", c[0], c.get(7).unwrap_or(&""));
        checked += 1;
    }
    assert_eq!(checked, 19);
}

fn signer() -> KeySigner {
    KeySigner::from_secret_hex("b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef").unwrap()
}

fn mech() -> Mechanism {
    Mechanism { name: "gaussian".into(), sigma: 1.5, clip: 1.0, epsilon: 6.129, delta: 1e-5 }
}

fn disclosure() -> Receipt {
    Receipt {
        memory: sha256_hex(b"memory v1"),
        mechanism: mech(),
        body: Body::Disclosure {
            query_hash: salted_hash(b"salt", "Is X a supplier of Y?"),
            answer_hash: sha256_hex(b"True"),
            requester: Some(did_nostr(&"11".repeat(32))),
        },
        prev: None,
        created_at: 1_762_600_000,
    }
}

fn revocation(prev: &str) -> Receipt {
    Receipt {
        memory: sha256_hex(b"memory v1"),
        mechanism: mech(),
        body: Body::Revocation { document_hash: sha256_hex(b"(X, supplies, Y)") },
        prev: Some(prev.to_string()),
        created_at: 1_762_600_100,
    }
}

#[test]
fn issue_and_verify_round_trip() {
    let s = signer();
    let d = issue(&disclosure(), &s).unwrap();
    let v = verify(&d).unwrap();
    assert_eq!(v.receipt, disclosure());
    assert_eq!(v.issuer, did_nostr(&s.pubkey_hex()));
    assert_eq!(d.kind, KIND_DISCLOSURE);
    assert!(matches(&v, b"salt", "Is X a supplier of Y?", "True"));
    assert!(!matches(&v, b"salt", "Is X a supplier of Y?", "False"));
    assert!(!matches(&v, b"other salt", "Is X a supplier of Y?", "True"));

    let r = issue(&revocation(&d.id), &s).unwrap();
    let rv = verify(&r).unwrap();
    assert_eq!(rv.receipt, revocation(&d.id));
    assert_eq!(r.kind, KIND_REVOCATION);
    assert!(!matches(&rv, b"salt", "Is X a supplier of Y?", "True"));
}

/// Every single-field alteration of a signed receipt is rejected.
#[test]
fn tampering_is_rejected() {
    let s = signer();
    let good = issue(&disclosure(), &s).unwrap();
    let other = KeySigner::from_secret_hex(&"03".repeat(32)).unwrap();
    let mut cases: Vec<(&str, NostrEvent)> = Vec::new();
    let mut e = good.clone();
    e.content.push('!');
    cases.push(("content", e));
    let mut e = good.clone();
    e.created_at += 1;
    cases.push(("created_at", e));
    let mut e = good.clone();
    e.kind = KIND_REVOCATION;
    cases.push(("kind", e));
    let mut e = good.clone();
    e.tags[5][1] = sha256_hex(b"False");
    cases.push(("answer tag", e));
    let mut e = good.clone();
    e.tags.retain(|t| t[0] != "requester");
    cases.push(("removed tag", e));
    let mut e = good.clone();
    e.pubkey = other.pubkey_hex();
    cases.push(("pubkey", e));
    let mut e = good.clone();
    let mut sig = hex::decode(&e.sig).unwrap();
    sig[10] ^= 1;
    e.sig = hex::encode(sig);
    cases.push(("signature bit", e));
    let mut e = good.clone();
    e.id = "00".repeat(32);
    cases.push(("id", e));
    for (what, e) in cases {
        assert!(verify(&e).is_err(), "tampered {what} was accepted");
    }
    assert!(verify(&good).is_ok());
}

/// A correctly signed event that is not a well-formed receipt is rejected by the schema check.
#[test]
fn validly_signed_non_receipts_are_rejected() {
    let s = signer();
    let good = issue(&disclosure(), &s).unwrap();
    let resign = |mutate: &dyn Fn(&mut UnsignedEvent)| -> NostrEvent {
        let mut u = UnsignedEvent { pubkey: good.pubkey.clone(), created_at: good.created_at, kind: good.kind, tags: good.tags.clone(), content: good.content.clone() };
        mutate(&mut u);
        let key = signing_key_from_bytes(&hex::decode("b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef").unwrap().try_into().unwrap()).unwrap();
        sign_event(u, &key).unwrap()
    };
    let cases: Vec<(&str, NostrEvent)> = vec![
        ("wrong version", resign(&|u| u.tags[0][1] = "2".into())),
        ("missing memory", resign(&|u| u.tags.retain(|t| t[0] != "memory"))),
        ("repeated answer", resign(&|u| u.tags.push(vec!["answer".into(), "ab".repeat(32)]))),
        ("non-hex query", resign(&|u| u.tags[4][1] = "zz".repeat(32))),
        ("negative epsilon", resign(&|u| u.tags[3][1] = "-1".into())),
        ("bad requester", resign(&|u| u.tags[6][1] = "did:nostr:NPUB".into())),
        ("other kind", resign(&|u| u.kind = 1)),
        ("misleading content", resign(&|u| u.content = "Nothing was released.".into())),
    ];
    for (what, e) in cases {
        assert!(matches!(verify(&e), Err(Error::Schema(_))), "{what} was accepted");
    }
}

/// The shared did:nostr grammar: the same fixtures run against agentbox's JS URI mint.
#[test]
fn did_nostr_grammar_fixtures() {
    let f: serde_json::Value = serde_json::from_str(include_str!("../fixtures/did-nostr.json")).unwrap();
    for s in f["valid"].as_array().unwrap() {
        assert!(parse_did_nostr(s.as_str().unwrap()).is_ok(), "rejected valid {s}");
    }
    for s in f["invalid"].as_array().unwrap() {
        assert!(parse_did_nostr(s.as_str().unwrap()).is_err(), "accepted invalid {s}");
    }
}

/// An external signer is checked: a program returning someone else's signature is refused.
#[test]
fn command_signer_output_is_verified() {
    let cmd = CommandSigner { command: vec!["cat".into()], pubkey: signer().pubkey_hex() };
    assert!(issue(&disclosure(), &cmd).is_err(), "an unsigned echo was accepted");
}
