//! Unit coverage for `nostr_pod_bridge::identity` — BIP-340 keypair
//! derivation, the persisted identity file, and the legacy-npub migration.
//!
//! Ported from `tests/sovereign/test_sovereign_bootstrap_did.py` (key half) plus
//! the cases the Python suite never covered.

use nostr_bbs_core::nip19::{decode_npub, decode_nsec};
use nostr_pod_bridge::envmap::EnvMap;
use nostr_pod_bridge::identity::*;
use std::path::{Path, PathBuf};

/// BIP-340 test vector: secret key 3 has an even-y public key.
const PRIV_THREE: &str = "0000000000000000000000000000000000000000000000000000000000000003";
const XONLY_THREE: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

/// The smallest scalar whose public key has an ODD y (verified against the
/// Python original's `ecdsa` derivation), so the canonical form is `n - 6`.
const PRIV_SIX: &str = "0000000000000000000000000000000000000000000000000000000000000006";
const XONLY_SIX: &str = "fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556";
const NEG_SIX: &str = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd036413b";

fn env_of(pairs: &[(&str, &str)]) -> EnvMap {
    EnvMap::from_iter(pairs.iter().copied())
}

#[test]
fn derives_the_bip340_x_only_vector() {
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    assert_eq!(km.x_only_pubkey_hex, XONLY_THREE);
    assert_eq!(km.private_key_hex, PRIV_THREE);
    // public_key_hex is the 64-byte SEC1 X ‖ Y form; X is the x-only key.
    assert_eq!(km.public_key_hex.len(), 128);
    assert!(km.public_key_hex.starts_with(XONLY_THREE));
}

#[test]
fn odd_y_secret_is_negated_to_the_canonical_even_y_scalar() {
    let km = keypair_from_privkey_hex(PRIV_SIX).unwrap();
    // Same identity (x is unchanged by negation) …
    assert_eq!(km.x_only_pubkey_hex, XONLY_SIX);
    // … but the persisted scalar is n-6, the one a BIP-340 signer holds.
    assert_eq!(km.private_key_hex, NEG_SIX);
    // Re-deriving from the canonical scalar is a fixed point.
    let again = keypair_from_privkey_hex(NEG_SIX).unwrap();
    assert_eq!(again.private_key_hex, NEG_SIX);
    assert_eq!(again.x_only_pubkey_hex, XONLY_SIX);
    // Canonical form always has even y.
    let y_last = u8::from_str_radix(&km.public_key_hex[126..128], 16).unwrap();
    assert_eq!(y_last & 1, 0);
}

#[test]
fn npub_encodes_the_32_byte_x_only_key_not_the_sec1_form() {
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    assert!(km.npub.starts_with("npub1"));
    // PRD-010 C2: the decoded payload must be the x-only key.
    assert_eq!(decode_npub(&km.npub).unwrap(), XONLY_THREE);
    assert_eq!(decode_nsec(&km.nsec).unwrap(), PRIV_THREE);
}

#[test]
fn rejects_malformed_secret_keys() {
    assert!(keypair_from_privkey_hex("nothex").is_err());
    assert!(keypair_from_privkey_hex("00ff").is_err());
    assert!(keypair_from_privkey_hex(&"0".repeat(64)).is_err()); // zero scalar
}

#[test]
fn env_privkey_prefers_hex_over_nsec() {
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    let env = env_of(&[
        ("AGENTBOX_PRIVKEY_HEX", PRIV_THREE),
        ("AGENTBOX_NSEC", &km.nsec),
    ]);
    assert_eq!(env_privkey_hex(&env).as_deref(), Some(PRIV_THREE));
}

#[test]
fn env_privkey_decodes_nsec_when_hex_absent() {
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    let env = env_of(&[("AGENTBOX_NSEC", &km.nsec)]);
    assert_eq!(env_privkey_hex(&env).as_deref(), Some(PRIV_THREE));
}

#[test]
fn env_privkey_ignores_blank_and_malformed_values() {
    assert!(env_privkey_hex(&env_of(&[])).is_none());
    assert!(env_privkey_hex(&env_of(&[("AGENTBOX_PRIVKEY_HEX", "   ")])).is_none());
    // Wrong HRP: an npub is not a secret key.
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    assert!(env_privkey_hex(&env_of(&[("AGENTBOX_NSEC", &km.npub)])).is_none());
}

#[test]
fn identity_file_field_order_matches_the_python_writer() {
    let dir = tempfile::tempdir().unwrap();
    let env = env_of(&[("AGENTBOX_PRIVKEY_HEX", PRIV_THREE)]);
    ensure_identity("agentbox-core", dir.path(), &env).unwrap();

    let text = std::fs::read_to_string(dir.path().join("agentbox-core.json")).unwrap();
    let keys: Vec<&str> = text
        .lines()
        .filter_map(|l| l.trim().strip_prefix('"'))
        .filter_map(|l| l.split('"').next())
        .collect();
    assert_eq!(
        keys,
        [
            "agent_id",
            "created_at",
            "private_key_hex",
            "public_key_hex",
            "x_only_pubkey_hex",
            "nsec",
            "npub"
        ]
    );
    assert!(
        text.ends_with("}\n"),
        "file must end with a trailing newline"
    );
}

#[test]
fn env_key_overwrites_a_persisted_identity() {
    let dir = tempfile::tempdir().unwrap();
    let generated = ensure_identity("a", dir.path(), &env_of(&[])).unwrap();
    let pinned = ensure_identity(
        "a",
        dir.path(),
        &env_of(&[("AGENTBOX_PRIVKEY_HEX", PRIV_THREE)]),
    )
    .unwrap();
    assert_ne!(generated.x_only_pubkey_hex, pinned.x_only_pubkey_hex);
    assert_eq!(pinned.x_only_pubkey_hex, XONLY_THREE);
}

#[test]
fn persisted_identity_is_reused_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let first = ensure_identity("a", dir.path(), &env_of(&[])).unwrap();
    let second = ensure_identity("a", dir.path(), &env_of(&[])).unwrap();
    assert_eq!(first.private_key_hex, second.private_key_hex);
    assert_eq!(first.created_at, second.created_at);
}

#[test]
fn generated_identity_is_valid_and_even_y() {
    let dir = tempfile::tempdir().unwrap();
    let id = ensure_identity("agentbox-core", dir.path(), &env_of(&[])).unwrap();
    assert_eq!(id.agent_id, "agentbox-core");
    assert_eq!(id.x_only_pubkey_hex.len(), 64);
    assert_eq!(decode_npub(&id.npub).unwrap(), id.x_only_pubkey_hex);
    assert_eq!(id.did(), format!("did:nostr:{}", id.x_only_pubkey_hex));
}

/// A pre-fix identity file: npub bech32-encodes the 64-byte SEC1 pubkey.
fn legacy_file(dir: &Path) -> PathBuf {
    let km = keypair_from_privkey_hex(PRIV_THREE).unwrap();
    let legacy_npub = {
        // Reproduce the old bug: encode 64 bytes under the npub HRP. The
        // NIP-19 encoder refuses that, so build it through bech32 directly.
        use bech32::{Bech32, Hrp};
        bech32::encode::<Bech32>(
            Hrp::parse("npub").unwrap(),
            &hex::decode(&km.public_key_hex).unwrap(),
        )
        .unwrap()
    };
    let path = dir.join("legacy.json");
    let value = serde_json::json!({
        "agent_id": "legacy",
        "created_at": 1_700_000_000u64,
        "npub": legacy_npub,
        "nsec": km.nsec,
        "private_key_hex": km.private_key_hex,
        "public_key_hex": km.public_key_hex,
        "extra_operator_field": "kept",
    });
    write_json(&path, &value).unwrap();
    path
}

#[test]
fn migrates_a_legacy_sec1_npub_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let path = legacy_file(dir.path());
    let before = std::fs::read_to_string(&path).unwrap();
    assert!(!before.contains("x_only_pubkey_hex"));

    let id = ensure_identity("legacy", dir.path(), &env_of(&[])).unwrap();
    assert_eq!(id.x_only_pubkey_hex, XONLY_THREE);
    assert_eq!(decode_npub(&id.npub).unwrap(), XONLY_THREE);
    // No key bytes change: the secret is still the one that was persisted.
    assert_eq!(id.private_key_hex, PRIV_THREE);
    // created_at is preserved, not reset.
    assert_eq!(id.created_at, 1_700_000_000);
}

#[test]
fn migration_preserves_unknown_fields_and_key_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = legacy_file(dir.path());
    ensure_identity("legacy", dir.path(), &env_of(&[])).unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    let keys: Vec<&str> = text
        .lines()
        .filter_map(|l| l.trim().strip_prefix('"'))
        .filter_map(|l| l.split('"').next())
        .collect();
    // Existing keys keep their positions (CPython dict.update semantics);
    // only the genuinely new x_only_pubkey_hex is appended.
    assert_eq!(
        keys,
        [
            "agent_id",
            "created_at",
            "npub",
            "nsec",
            "private_key_hex",
            "public_key_hex",
            "extra_operator_field",
            "x_only_pubkey_hex"
        ]
    );
    assert!(text.contains("\"extra_operator_field\": \"kept\""));
}

#[test]
fn migration_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = legacy_file(dir.path());
    ensure_identity("legacy", dir.path(), &env_of(&[])).unwrap();
    let once = std::fs::read_to_string(&path).unwrap();
    ensure_identity("legacy", dir.path(), &env_of(&[])).unwrap();
    assert_eq!(once, std::fs::read_to_string(&path).unwrap());
}

#[test]
fn a_current_identity_file_is_not_rewritten() {
    let dir = tempfile::tempdir().unwrap();
    let env = env_of(&[("AGENTBOX_PRIVKEY_HEX", PRIV_THREE)]);
    ensure_identity("a", dir.path(), &env).unwrap();
    let path = dir.path().join("a.json");
    let before = std::fs::read_to_string(&path).unwrap();

    ensure_identity("a", dir.path(), &env_of(&[])).unwrap();
    assert_eq!(before, std::fs::read_to_string(&path).unwrap());
}
