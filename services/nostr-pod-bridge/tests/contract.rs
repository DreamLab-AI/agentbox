//! Coverage for `nostr_pod_bridge::contract` — the did:nostr Multikey document
//! and the ADR-124 gitmark/blocktrails substrate.
//!
//! Direct port of groups A, B and C of `tests/sovereign/test_sovereign_bootstrap_did.py`,
//! guarding the ADR-033 convergence and ADR-124 build-out against their hard
//! invariants:
//!
//!   I1. did:nostr:<hex> identity string unchanged (BIP-340 x-only even-y hex).
//!   I2. publicKeyMultibase == "fe70102" + same x-only hex; round-trips; 71 chars;
//!       no key bytes change.
//!   I4. Only the 2019 doc shape is superseded — the id string still governs.
//!
//! The auth path (NIP-98, I3) is deliberately NOT exercised here: it verifies the
//! raw event pubkey and never reads the DID-doc verificationMethod, so re-encoding
//! the VM cannot touch it. That property is covered by the NIP-98 verifier tests.

use nostr_pod_bridge::contract::*;
use nostr_pod_bridge::identity::{keypair_from_privkey_hex, Identity};
use nostr_pod_bridge::pyjson;
use std::path::{Path, PathBuf};

/// BIP-340 test vector: privkey 3 → known even-y x-only pubkey.
const PRIV_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000003";
const EXPECTED_XONLY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

fn identity() -> Identity {
    let km = keypair_from_privkey_hex(PRIV_HEX).unwrap();
    Identity {
        agent_id: "test-agent".to_string(),
        created_at: 1_700_000_000,
        private_key_hex: km.private_key_hex,
        public_key_hex: km.public_key_hex,
        x_only_pubkey_hex: km.x_only_pubkey_hex,
        nsec: km.nsec,
        npub: km.npub,
    }
}

fn doc_json(also: Option<Vec<String>>) -> serde_json::Value {
    serde_json::to_value(build_did_document(&identity(), also)).unwrap()
}

/// A real, git-init'd per-user pod with the contract substrate wired on.
fn pod_repo(dir: &Path) -> PathBuf {
    let pod = dir.join("npub1testpod");
    let id = identity();
    assert!(ensure_pod_git(&pod, &id));
    wire_pod_contract_substrate(&id, &pod).unwrap();
    pod
}

fn git_log(repo: &Path) -> Vec<String> {
    git(repo, &["log", "--format=%H"])
        .unwrap()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

// ─── A. build_did_document — canonical Multikey shape ────────────────────

#[test]
fn did_document_is_canonical_multikey_form() {
    let doc = doc_json(None);
    assert_eq!(
        doc["@context"],
        serde_json::json!([
            "https://www.w3.org/ns/cid/v1",
            "https://w3id.org/nostr/context"
        ])
    );
    assert_eq!(doc["id"], format!("did:nostr:{EXPECTED_XONLY}"));
    assert_eq!(doc["type"], "DIDNostr");
    assert_eq!(doc["verificationMethod"].as_array().unwrap().len(), 1);
    let vm = &doc["verificationMethod"][0];
    assert_eq!(vm["id"], format!("did:nostr:{EXPECTED_XONLY}#key1"));
    assert_eq!(vm["type"], "Multikey");
    assert_eq!(vm["controller"], format!("did:nostr:{EXPECTED_XONLY}"));
    assert_eq!(doc["authentication"], serde_json::json!(["#key1"]));
    assert_eq!(doc["assertionMethod"], serde_json::json!(["#key1"]));
    // omit-when-empty: no alsoKnownAs/service given ⇒ omitted entirely.
    assert!(doc.get("service").is_none());
    assert!(doc.get("alsoKnownAs").is_none());
}

#[test]
fn i2_public_key_multibase_round_trips() {
    let doc = doc_json(None);
    let mb = doc["verificationMethod"][0]["publicKeyMultibase"]
        .as_str()
        .unwrap();
    assert_eq!(mb, format!("fe70102{EXPECTED_XONLY}"));
    // The multibase body after the 7-char prefix IS the did:nostr body —
    // no key bytes change.
    assert_eq!(&mb[7..], &doc["id"].as_str().unwrap()["did:nostr:".len()..]);
    assert_eq!(mb.len(), 71);
}

#[test]
fn i1_i4_drops_2019_suite_keeps_id() {
    let blob = serde_json::to_string(&doc_json(None)).unwrap();
    assert!(!blob.contains("SchnorrSecp256k1VerificationKey2019"));
    assert!(!blob.contains("publicKeyHex"));
    assert!(!blob.contains("secp256k1-2019"));
    let doc = doc_json(None);
    let xonly = &doc["id"].as_str().unwrap()["did:nostr:".len()..];
    assert_eq!(xonly.len(), 64);
    assert_eq!(xonly, xonly.to_lowercase());
    assert_eq!(xonly, EXPECTED_XONLY);
}

#[test]
fn also_known_as_is_emitted_last_when_present() {
    let doc = doc_json(Some(vec!["http://localhost:8484/x/profile.json".into()]));
    assert_eq!(
        doc["alsoKnownAs"],
        serde_json::json!(["http://localhost:8484/x/profile.json"])
    );
    let rendered = pyjson::dumps_indent(&doc, 2);
    let keys: Vec<&str> = rendered
        .lines()
        .filter_map(|l| l.strip_prefix("  \""))
        .filter_map(|l| l.split('"').next())
        .collect();
    assert_eq!(*keys.last().unwrap(), "alsoKnownAs");
}

// ─── B. gitmark / blocktrails — 5-key gitmark; states[] = REAL pod SHAs ───

#[test]
fn gitmark_is_exactly_five_key_ground_truth() {
    let gm = serde_json::to_value(build_gitmark(&identity(), "deadbeef", "agentbox-pod")).unwrap();
    let keys: Vec<&str> = gm.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["@id", "genesis", "nick", "package", "repository"]);
    assert_eq!(gm["@id"], "gitmark:deadbeef:0");
    assert_eq!(gm["genesis"], "deadbeef");
    assert_eq!(gm["nick"], "test-agent");
    assert_eq!(gm["repository"], format!("did:nostr:{EXPECTED_XONLY}"));
}

#[test]
fn blocktrail_shape() {
    let bt = serde_json::to_value(build_blocktrail("g0", vec!["g0".into(), "s1".into()])).unwrap();
    assert_eq!(bt["@type"], "Blocktrail");
    assert_eq!(bt["profile"], "gitmark");
    assert_eq!(bt["genesis"], "g0");
    assert_eq!(bt["states"], serde_json::json!(["g0", "s1"]));
    // L0 honest-or-caught: the single-use-seal seam is present but empty.
    assert_eq!(bt["txo"], serde_json::json!([]));
}

#[test]
fn blocktrail_states_are_real_pod_commit_shas() {
    let dir = tempfile::tempdir().unwrap();
    let pod = pod_repo(dir.path());
    let bt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("blocktrails.json")).unwrap())
            .unwrap();
    let log = git_log(&pod);
    let states = bt["states"].as_array().unwrap();
    assert!(!states.is_empty(), "blocktrails states[] must not be empty");
    for sha in states {
        let sha = sha.as_str().unwrap();
        assert!(
            log.contains(&sha.to_string()),
            "{sha} is not a real pod commit"
        );
    }
    assert_eq!(bt["genesis"], states[0]);
}

// ─── C. write_agent_repo_identity — pod-git root layout ──────────────────

#[test]
fn agent_did_json_and_key_at_pod_git_root() {
    let dir = tempfile::tempdir().unwrap();
    let pod = pod_repo(dir.path());
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("agent.did.json")).unwrap())
            .unwrap();
    assert_eq!(doc["type"], "DIDNostr");
    assert_eq!(
        doc["verificationMethod"][0]["publicKeyMultibase"],
        format!("fe70102{EXPECTED_XONLY}")
    );
    assert_eq!(
        git(&pod, &["config", "nostr.privkey"]).unwrap(),
        identity().private_key_hex
    );
    assert!(pod.join("gitmark.json").exists());
    assert!(pod.join("blocktrails.json").exists());
}

#[test]
fn write_agent_repo_identity_inits_pod_git_when_missing() {
    let dir = tempfile::tempdir().unwrap();
    let pod = dir.path().join("fresh-pod");
    std::fs::create_dir(&pod).unwrap();
    assert!(!pod.join(".git").exists());
    write_agent_repo_identity(&identity(), &pod).unwrap();
    assert!(pod.join(".git").exists());
    assert!(pod.join("agent.did.json").exists());
}

#[test]
fn idempotent_on_rerun() {
    let dir = tempfile::tempdir().unwrap();
    let pod = pod_repo(dir.path());
    wire_pod_contract_substrate(&identity(), &pod).unwrap();
    let bt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("blocktrails.json")).unwrap())
            .unwrap();
    let log = git_log(&pod);
    for sha in bt["states"].as_array().unwrap() {
        assert!(log.contains(&sha.as_str().unwrap().to_string()));
    }
}
