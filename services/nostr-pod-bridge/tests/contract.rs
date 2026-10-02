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

// ─── B. gitmark / blocktrails — 5-key gitmark; §5.2 blocktrails ───────────

/// Commits the S3 fixtures were emitted for (`tests/fixtures/blocktrail-s3`).
const GENESIS: &str = "9adc596cfd1100333393a12f2f41b2d820f16d0b";
const TIP: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const TXID0: &str = "51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf";
const TXID1: &str = "a3f0c2b1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";

/// The blocktrails/spec git-mark profile §5.2 field set, in its order.
const SECTION_5_2_KEYS: [&str; 7] = [
    "@type",
    "version",
    "profile",
    "pubkeyBase",
    "chain",
    "states",
    "txo",
];

/// Output of solid-pod-rs up/blocktrails-verify 97582a8 (`emit.rs` beside it).
fn s3_fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/blocktrail-s3")
            .join(name),
    )
    .unwrap()
}

/// What the bridge writes to disk for `value`, byte for byte.
fn written<T: serde::Serialize>(value: &T) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.json");
    nostr_pod_bridge::identity::write_json(&path, value).unwrap();
    std::fs::read_to_string(path).unwrap()
}

fn anchor_uris() -> Vec<String> {
    vec![
        format!("txo:gitmark:{TXID0}:0?amount=1000000&commit={GENESIS}"),
        format!("txo:gitmark:{TXID1}:0?amount=999000&commit={TIP}"),
    ]
}

fn write_txo_json(repo: &Path, body: &str) {
    let path = repo.join(TXO_JSON_PATH);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

#[test]
fn gitmark_is_exactly_five_key_ground_truth() {
    let gm = serde_json::to_value(build_gitmark(&identity(), "deadbeef", "agentbox-pod")).unwrap();
    let keys: Vec<&str> = gm.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["@id", "genesis", "nick", "package", "repository"]);
    assert_eq!(gm["@id"], "gitmark:deadbeef:0");
    assert_eq!(gm["genesis"], "gitmark:deadbeef:0");
    assert_eq!(gm["nick"], "test-agent");
    assert_eq!(gm["repository"], format!("did:nostr:{EXPECTED_XONLY}"));
}

#[test]
fn blocktrail_has_exactly_the_section_5_2_field_set() {
    for txo in [Vec::new(), read_marks(&anchor_uris())] {
        let bt = serde_json::to_value(build_blocktrail(
            &identity(),
            vec![GENESIS.into(), TIP.into()],
            txo,
        ))
        .unwrap();
        let keys: Vec<&str> = bt.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, SECTION_5_2_KEYS);
        assert_eq!(bt["@type"], "Blocktrail");
        assert_eq!(bt["version"], "0.0.3");
        assert_eq!(bt["profile"], "gitmark");
        assert_eq!(bt["pubkeyBase"], format!("02{EXPECTED_XONLY}"));
        assert_eq!(bt["chain"], "gitmark");
        for state in bt["states"].as_array().unwrap() {
            assert!(nostr_pod_bridge::blocktrail::is_gitmark_commit(
                state.as_str().unwrap()
            ));
        }
        for uri in bt["txo"].as_array().unwrap() {
            assert!(uri.as_str().unwrap().starts_with("txo:gitmark:"));
        }
    }
    // Nothing of the earlier shape survives in a freshly built trail.
    let blob = serde_json::to_string(&build_blocktrail(&identity(), vec![GENESIS.into()], vec![]))
        .unwrap();
    assert!(!blob.contains("\"@id\"") && !blob.contains("\"genesis\""));
}

fn read_marks(uris: &[String]) -> Vec<nostr_pod_bridge::blocktrail::BlocktrailTxo> {
    let dir = tempfile::tempdir().unwrap();
    write_txo_json(dir.path(), &serde_json::to_string(uris).unwrap());
    read_anchor_marks(dir.path())
}

#[test]
fn pubkey_base_is_the_identity_as_a_full_compressed_point() {
    let base = pod_pubkey_base(&identity());
    assert_eq!(base.len(), 66);
    assert_eq!(base, format!("02{EXPECTED_XONLY}"));
    // A public_key_hex that does not parse falls back to lift_x (02 + x).
    let mut broken = identity();
    broken.public_key_hex = "zz".into();
    assert_eq!(pod_pubkey_base(&broken), base);
}

#[test]
fn golden_gitmark_json_matches_solid_pod_rs_s3_byte_for_byte() {
    assert_eq!(
        written(&build_gitmark(&identity(), GENESIS, "agentbox-pod")),
        s3_fixture("gitmark.json")
    );
}

#[test]
fn golden_unanchored_blocktrails_json_matches_solid_pod_rs_s3_byte_for_byte() {
    let bt = build_blocktrail(&identity(), vec![GENESIS.into(), TIP.into()], Vec::new());
    assert_eq!(written(&bt), s3_fixture("blocktrails-unanchored.json"));
}

#[test]
fn golden_anchored_blocktrails_json_matches_solid_pod_rs_s3_byte_for_byte() {
    let marks = read_marks(&anchor_uris());
    assert_eq!(marks.len(), 2);
    let bt = build_blocktrail(&identity(), vec![GENESIS.into(), TIP.into()], marks);
    assert_eq!(written(&bt), s3_fixture("blocktrails-anchored.json"));
}

/// The S3 walker (`blocktrail::verify_blocktrail`) was run on the exact bytes
/// the golden test above pins the bridge to; its report is the fixture. With
/// no marks it is the confirmation-only reading: the trail parses as a
/// non-legacy git-mark trail, no commitment is checked, no mark fails, and the
/// walk names why there is nothing to check.
#[test]
fn s3_walker_accepts_the_unanchored_trail_in_confirmed_mode() {
    let bt = build_blocktrail(&identity(), vec![GENESIS.into(), TIP.into()], Vec::new());
    assert_eq!(written(&bt), s3_fixture("blocktrails-unanchored.json"));

    let parsed: nostr_pod_bridge::blocktrail::Blocktrail =
        serde_json::from_str(&s3_fixture("blocktrails-unanchored.json")).unwrap();
    assert_eq!(parsed, bt);
    assert!(parsed.is_gitmark() && !parsed.is_legacy());

    let report: serde_json::Value =
        serde_json::from_str(&s3_fixture("walk-unanchored.json")).unwrap();
    assert_eq!(report["commitmentsChecked"], false);
    assert_eq!(report["marks"], serde_json::json!([]));
    assert_eq!(report["walkError"], "the trail has 0 marks and 2 states");
    // An empty trail verifies nothing, so solid-pod-rs never rates it above
    // partial; what matters is that nothing in it fails.
    assert_eq!(report["verdict"], "partial");
}

#[test]
fn s3_walker_verifies_the_anchored_trail_mark_by_mark() {
    let report: serde_json::Value =
        serde_json::from_str(&s3_fixture("walk-anchored.json")).unwrap();
    assert_eq!(report["commitmentsChecked"], true);
    assert_eq!(report["verdict"], "verified");
    let marks = report["marks"].as_array().unwrap();
    assert_eq!(marks.len(), 2);
    assert!(marks
        .iter()
        .all(|m| m["status"] == "verified" && m["commits"] == true));
    assert_eq!(marks[1]["linksToPrev"], true);
}

#[test]
fn read_anchor_marks_ignores_what_a_verifier_would_have_to_guess_at() {
    let dir = tempfile::tempdir().unwrap();
    assert!(
        read_anchor_marks(dir.path()).is_empty(),
        "no txo.json, no marks"
    );
    for bad in [
        "not json".to_string(),
        serde_json::json!([format!("txo:gitmark:{TXID0}:0?amount=5")]).to_string(),
        serde_json::json!([
            format!("txo:gitmark:{TXID0}:0?commit={GENESIS}"),
            format!("txo:tbtc4:{TXID1}:0?commit={TIP}")
        ])
        .to_string(),
        serde_json::json!([format!("txo:sidestr:gitmark:{TXID0}:0?commit={GENESIS}")]).to_string(),
    ] {
        write_txo_json(dir.path(), &bad);
        assert!(
            read_anchor_marks(dir.path()).is_empty(),
            "{bad} read as marks"
        );
    }
}

#[test]
fn blocktrail_states_are_real_pod_commit_shas() {
    let dir = tempfile::tempdir().unwrap();
    let pod = pod_repo(dir.path());
    let bt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("blocktrails.json")).unwrap())
            .unwrap();
    let gm: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("gitmark.json")).unwrap()).unwrap();
    let log = git_log(&pod);
    let states = bt["states"].as_array().unwrap();
    assert!(!states.is_empty(), "blocktrails states[] must not be empty");
    for sha in states {
        let sha = sha.as_str().unwrap();
        assert!(
            log.contains(&sha.to_string()),
            "{sha} is not a real pod commit"
        );
        assert_eq!(sha.len(), 40);
    }
    assert_eq!(
        gm["genesis"],
        format!("gitmark:{}:0", states[0].as_str().unwrap())
    );
    assert_eq!(bt["txo"], serde_json::json!([]));
    assert_eq!(bt["pubkeyBase"], format!("02{EXPECTED_XONLY}"));
}

#[test]
fn bootstrap_carries_recorded_marks_one_state_per_mark() {
    let dir = tempfile::tempdir().unwrap();
    let pod = dir.path().join("marked-pod");
    let id = identity();
    assert!(ensure_pod_git(&pod, &id));
    write_txo_json(&pod, &serde_json::to_string_pretty(&anchor_uris()).unwrap());
    let txo_before = std::fs::read(pod.join(TXO_JSON_PATH)).unwrap();
    wire_pod_contract_substrate(&id, &pod).unwrap();

    let bt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("blocktrails.json")).unwrap())
            .unwrap();
    assert_eq!(bt["txo"], serde_json::json!(anchor_uris()));
    assert_eq!(bt["states"], serde_json::json!([GENESIS, TIP]));
    assert_eq!(bt["chain"], "gitmark");
    // The marks file is git-mark's; the bridge only reads it.
    assert_eq!(std::fs::read(pod.join(TXO_JSON_PATH)).unwrap(), txo_before);
}

/// The old-shape pod files stay as they are until a bootstrap rewrites them:
/// every contract entry point other than the bootstrap ritual is read-only on
/// the repository, and only `contract.rs` names the two files.
#[test]
fn old_shape_pod_files_are_rewritten_only_by_bootstrap() {
    let dir = tempfile::tempdir().unwrap();
    let pod = dir.path().join("old-pod");
    let id = identity();
    assert!(ensure_pod_git(&pod, &id));
    let old_gitmark = format!(
        "{{\n  \"@id\": \"gitmark:{GENESIS}:0\",\n  \"genesis\": \"{GENESIS}\",\n  \"nick\": \
         \"test-agent\",\n  \"package\": \"agentbox-pod\",\n  \"repository\": \
         \"did:nostr:{EXPECTED_XONLY}\"\n}}\n"
    );
    let old_trail = format!(
        "{{\n  \"@type\": \"Blocktrail\",\n  \"profile\": \"gitmark\",\n  \"genesis\": \
         \"{GENESIS}\",\n  \"states\": [\n    \"{GENESIS}\"\n  ],\n  \"txo\": []\n}}\n"
    );
    std::fs::write(pod.join("gitmark.json"), &old_gitmark).unwrap();
    std::fs::write(pod.join("blocktrails.json"), &old_trail).unwrap();
    git(&pod, &["add", "gitmark.json", "blocktrails.json"]).unwrap();
    git(&pod, &["commit", "-q", "-m", "old shape"]).unwrap();
    let head = git(&pod, &["rev-parse", "HEAD"]).unwrap();

    // Every non-bootstrap entry point, run against the old-shape pod.
    let _ = build_gitmark(&id, GENESIS, "agentbox-pod");
    let _ = build_blocktrail(&id, vec![GENESIS.into()], read_anchor_marks(&pod));
    let _ = pod_pubkey_base(&id);
    assert!(ensure_pod_git(&pod, &id));
    assert_eq!(
        std::fs::read_to_string(pod.join("gitmark.json")).unwrap(),
        old_gitmark
    );
    assert_eq!(
        std::fs::read_to_string(pod.join("blocktrails.json")).unwrap(),
        old_trail
    );
    assert_eq!(git(&pod, &["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(git(&pod, &["status", "--porcelain"]).unwrap(), "");

    // The bootstrap ritual is what rewrites them, into the §5.2 shape.
    write_agent_repo_identity(&id, &pod).unwrap();
    let bt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod.join("blocktrails.json")).unwrap())
            .unwrap();
    let keys: Vec<&str> = bt.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, SECTION_5_2_KEYS);

    // Only contract.rs names the files, and only bootstrap.rs calls into the
    // ritual that writes them.
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut sources: Vec<(String, String)> = std::fs::read_dir(&src_dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .map(|p| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            (name, std::fs::read_to_string(&p).unwrap())
        })
        .collect();
    sources.retain(|(name, _)| name != "contract.rs");
    assert!(sources.iter().any(|(n, _)| n == "bootstrap.rs"));
    for (name, src) in &sources {
        assert!(
            !src.contains("\"gitmark.json\"") && !src.contains("\"blocktrails.json\""),
            "{name} names a pod contract file"
        );
        let ritual = src.contains("write_agent_repo_identity(")
            || src.contains("wire_pod_contract_substrate(");
        assert_eq!(ritual, name == "bootstrap.rs", "{name} reaches the ritual");
    }
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

/// The trail is described as marks, trails and anchors (blocktrails/spec
/// ef54a08); "single-use seal" is not this design's term and stays out.
#[test]
fn docs_do_not_speak_of_single_use_seals() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for entry in std::fs::read_dir(src_dir).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
        for term in ["single-use seal", "single-use-seal"] {
            assert!(!text.contains(term), "{} says {term}", path.display());
        }
    }
}
