//! Known-answer tests: the Rust mirror-child derivation equals
//! `config/hooks/nostr-live-mirror.cjs:200-221` byte for byte.
//!
//! Every expected value was computed three ways and agreed:
//! Node `crypto.createHmac('sha256', Buffer.from(sk, 'hex')).update(tag)` (the
//! hook's own code), Python `hmac.new(..., hashlib.sha256)`, and, for the
//! public halves, `@noble/curves` secp256k1. All secrets are synthetic.

use nostr_pod_bridge::identity::keypair_from_privkey_hex;
use nostr_pod_bridge::mirror_key::{child_secret, child_xonly_pubkey_hex, DEFAULT_TAG};

const SK_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SK_1: &str = "0000000000000000000000000000000000000000000000000000000000000001";
/// Scalar 6: its public point has ODD y, so `identity` persists `n - 6`.
const SK_6: &str = "0000000000000000000000000000000000000000000000000000000000000006";

/// (operator sk, tag, child_sk, child x-only pubkey)
const VECTORS: &[(&str, &str, &str, &str)] = &[
    (
        SK_A,
        "agentbox-mirror-v1",
        "a25935d1bb6782faa0ceaca1dce34bb23bf45a507e8e19b8973de836cbdcab72",
        // == CHILD_RECIPIENT in tests/sovereign/egress-boundary.test.js
        "175704cfcc83cb41eb05259fe87888b54dfb48a5c98e3d04cad7f9865a07a33a",
    ),
    (
        SK_1,
        "agentbox-mirror-v1",
        "8994e826d6a81c6948f07435a64c3980058a5222a671eddf7eb86df24317ed90",
        "debff6f0a565f739eca2d9f16713293a6defee7520155ca778bb2d5885fbf5ee",
    ),
    (
        SK_6,
        "agentbox-mirror-v1",
        "552675162b3174ac842e4e05c552d864c6309fe0f226235dd8ed50f6b23650ad",
        "6bc396e3a4fefb4d49f668a7729ef216605d3d74ed7d59da6fe256b233f4cbc9",
    ),
];

#[test]
fn child_secret_matches_the_javascript_byte_for_byte() {
    for (sk, tag, want_sk, _) in VECTORS {
        let got = child_secret(sk, Some(tag)).unwrap();
        assert_eq!(hex::encode(got), *want_sk, "child_sk for sk=…{}", &sk[60..]);
    }
}

#[test]
fn child_pubkey_matches_the_javascript_fixture() {
    for (sk, tag, _, want_pub) in VECTORS {
        assert_eq!(child_xonly_pubkey_hex(sk, Some(tag)).unwrap(), *want_pub);
    }
}

#[test]
fn absent_or_blank_tag_is_the_default_tag() {
    assert_eq!(DEFAULT_TAG, "agentbox-mirror-v1");
    let want = child_secret(SK_A, Some(DEFAULT_TAG)).unwrap();
    assert_eq!(child_secret(SK_A, None).unwrap(), want);
    assert_eq!(child_secret(SK_A, Some("")).unwrap(), want);
    assert_eq!(child_secret(SK_A, Some("  ")).unwrap(), want);
}

#[test]
fn a_custom_tag_rotates_the_child() {
    // AGENTBOX_MIRROR_KEY_TAG=agentbox-mirror-v2, same three-way agreement.
    let v2 = child_secret(SK_A, Some("agentbox-mirror-v2")).unwrap();
    assert_eq!(
        hex::encode(v2),
        "aa4502a0d54eb3923b929f13e9d6b1320e09f498e51b9cf28247e619e97c9b19"
    );
    let v2_1 = child_secret(SK_1, Some("agentbox-mirror-v2")).unwrap();
    assert_eq!(
        hex::encode(v2_1),
        "8a25c28746ae28c80fe3009e301695c5cd253d51ea2561220989113e4e4422e7"
    );
}

#[test]
fn hex_case_does_not_change_the_child() {
    // The hook accepts /^[0-9a-f]{64}$/i and Buffer.from(hex) is case-blind.
    assert_eq!(
        child_secret(&SK_A.to_uppercase(), None).unwrap(),
        child_secret(SK_A, None).unwrap()
    );
}

/// The hazard this module documents: keying on the even-y-normalised scalar
/// that `identity` persists would hand the phone a different key.
#[test]
fn odd_y_key_must_use_the_raw_env_hex_not_the_normalised_scalar() {
    let normalised = keypair_from_privkey_hex(SK_6).unwrap().private_key_hex;
    assert_ne!(normalised, SK_6, "scalar 6 must have odd y for this test to mean anything");
    assert_ne!(
        child_secret(&normalised, None).unwrap(),
        child_secret(SK_6, None).unwrap(),
    );
    assert_eq!(
        hex::encode(child_secret(SK_6, None).unwrap()),
        "552675162b3174ac842e4e05c552d864c6309fe0f226235dd8ed50f6b23650ad"
    );
}

#[test]
fn malformed_operator_keys_are_refused() {
    for bad in ["", "abc", &"a".repeat(63), &"a".repeat(65), &"g".repeat(64)] {
        assert!(child_secret(bad, None).is_err(), "accepted {bad:?}");
    }
}
