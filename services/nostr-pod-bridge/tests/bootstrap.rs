//! Coverage for `nostr_pod_bridge::bootstrap` — pod provisioning, `identity.env`,
//! and the end-to-end `bootstrap` subcommand.
//!
//! The Python original (`scripts/sovereign-bootstrap.py`) had no test for any of
//! this: `tests/sovereign/test_sovereign_bootstrap_did.py` stopped at the DID and
//! contract layers. These cases pin the filesystem contract every consumer of
//! `identity.env` and the pod layout depends on.

use nostr_pod_bridge::bootstrap::*;
use nostr_pod_bridge::envmap::EnvMap;
use nostr_pod_bridge::identity::{keypair_from_privkey_hex, Identity};
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

// ─── D. pod provisioning ─────────────────────────────────────────────────

#[test]
fn ensure_acl_provisions_the_canonical_hex_pod() {
    let dir = tempfile::tempdir().unwrap();
    let pods = dir.path().join("pods");
    let id = identity();
    ensure_acl(&pods, &id, &EnvMap::default()).unwrap();

    let pod_dir = pods.join(EXPECTED_XONLY);
    for sub in POD_SUBDIRS {
        assert!(pod_dir.join(sub).is_dir(), "missing {sub}");
    }
    // Both WAC locations, Turtle only.
    let wac = build_wac_turtle(EXPECTED_XONLY);
    assert_eq!(
        std::fs::read_to_string(pods.join(format!("{EXPECTED_XONLY}.acl"))).unwrap(),
        wac
    );
    assert_eq!(std::fs::read_to_string(pod_dir.join(".acl")).unwrap(), wac);
    assert!(wac.contains(&format!("acl:agent <did:nostr:{EXPECTED_XONLY}>")));

    // npub → hex compatibility symlink (the pod-directory naming fix).
    let link = pods.join(&id.npub);
    assert!(link.is_symlink());
    assert_eq!(
        std::fs::read_link(&link).unwrap(),
        Path::new(EXPECTED_XONLY)
    );
}

#[test]
fn ensure_acl_writes_profile_and_did_with_the_configured_port() {
    let dir = tempfile::tempdir().unwrap();
    let pods = dir.path().join("pods");
    let env = EnvMap::from_iter([("SOLID_POD_PORT", "9999")]);
    ensure_acl(&pods, &identity(), &env).unwrap();

    let pod_dir = pods.join(EXPECTED_XONLY);
    let web_id = format!("http://localhost:9999/{EXPECTED_XONLY}/profile.json");
    let profile: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod_dir.join("profile.json")).unwrap())
            .unwrap();
    assert_eq!(profile["webId"], web_id);
    assert_eq!(profile["id"], format!("did:nostr:{EXPECTED_XONLY}"));

    let did_doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(pod_dir.join("did-nostr.json")).unwrap())
            .unwrap();
    assert_eq!(did_doc["alsoKnownAs"], serde_json::json!([web_id]));
}

#[test]
fn acl_json_key_order_matches_the_python_writer() {
    let dir = tempfile::tempdir().unwrap();
    let pods = dir.path().join("pods");
    ensure_acl(&pods, &identity(), &EnvMap::default()).unwrap();
    let acl: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(pods.join(EXPECTED_XONLY).join(".acl.json")).unwrap(),
    )
    .unwrap();
    let keys: Vec<&str> = acl
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["@context", "owner", "rules"]);
    let rule_keys: Vec<&str> = acl["rules"][0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(rule_keys, ["@type", "agent", "mode", "accessTo", "default"]);
}

#[test]
fn git_provenance_alias_points_at_the_pod_directory() {
    let dir = tempfile::tempdir().unwrap();
    let pods = dir.path().join("pods");
    std::fs::create_dir_all(&pods).unwrap();
    ensure_git_provenance_alias(&pods, &identity());
    let alias = dir.path().join(EXPECTED_XONLY);
    assert!(alias.is_symlink());
    assert_eq!(
        std::fs::read_link(&alias).unwrap(),
        PathBuf::from("pods").join(EXPECTED_XONLY)
    );
    // Idempotent.
    ensure_git_provenance_alias(&pods, &identity());
    assert!(alias.is_symlink());
}

#[test]
fn git_provenance_alias_rejects_a_non_hex_pubkey() {
    let dir = tempfile::tempdir().unwrap();
    let pods = dir.path().join("pods");
    std::fs::create_dir_all(&pods).unwrap();
    let mut id = identity();
    id.x_only_pubkey_hex = "NOT-HEX".to_string();
    ensure_git_provenance_alias(&pods, &id);
    assert!(!dir.path().join("NOT-HEX").exists());
}

// ─── E. identity.env ─────────────────────────────────────────────────────

#[test]
fn identity_env_exports_the_expected_variables_in_order() {
    let id = identity();
    let rendered = render_runtime_env(&id);
    let names: Vec<&str> = rendered
        .lines()
        .filter_map(|l| l.strip_prefix("export "))
        .filter_map(|l| l.split('=').next())
        .collect();
    assert_eq!(
        names,
        [
            "AGENTBOX_AGENT_ID",
            "AGENTBOX_NPUB",
            "AGENTBOX_NSEC",
            "AGENTBOX_PUBKEY_HEX",
            "AGENTBOX_X_ONLY_PUBKEY_HEX",
            "AGENTBOX_DID",
            "AGENTBOX_URN",
            "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
            "AGENTBOX_BRIDGE_SK",
        ]
    );
    assert!(rendered.contains(&format!("export AGENTBOX_DID=did:nostr:{EXPECTED_XONLY}")));
    assert!(rendered.contains("export AGENTBOX_URN=urn:agentbox:agent:test-agent"));
    assert!(rendered.contains(&format!("export AGENTBOX_BRIDGE_SK={}", id.private_key_hex)));
    assert!(rendered.ends_with('\n'), "must end with a trailing newline");
}

#[test]
fn identity_env_is_written_at_mode_0600() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    write_runtime_env(&identity(), dir.path()).unwrap();
    let path = dir.path().join("identity.env");
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

// ─── F. run() — the manifest gate and the full provisioning pass ─────────

fn scratch_env(dir: &Path, extra: &[(&str, &str)]) -> EnvMap {
    let mut pairs: Vec<(String, String)> = vec![
        (
            "AGENTBOX_IDENTITY_ROOT".into(),
            dir.join("identities").display().to_string(),
        ),
        (
            "SOLID_POD_ROOT".into(),
            dir.join("solid").display().to_string(),
        ),
        (
            "AGENTBOX_RUN_ROOT".into(),
            dir.join("run").display().to_string(),
        ),
    ];
    pairs.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    EnvMap::from_iter(pairs)
}

fn manifest(dir: &Path, enabled: bool) -> PathBuf {
    let path = dir.join("agentbox.toml");
    std::fs::write(&path, format!("[sovereign_mesh]\nenabled = {enabled}\n")).unwrap();
    path
}

#[test]
fn run_is_a_no_op_when_the_sovereign_mesh_is_disabled() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = manifest(dir.path(), false);
    let env = scratch_env(
        dir.path(),
        &[("AGENTBOX_CONFIG", &cfg.display().to_string())],
    );
    run(&env).unwrap();
    assert!(!dir.path().join("identities").exists());
    assert!(!dir.path().join("run").exists());
}

#[test]
fn run_fails_loudly_when_the_manifest_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let env = scratch_env(
        dir.path(),
        &[("AGENTBOX_CONFIG", "/nonexistent/agentbox.toml")],
    );
    assert!(run(&env).is_err());
}

#[test]
fn run_provisions_every_artefact_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = manifest(dir.path(), true);
    let env = scratch_env(
        dir.path(),
        &[
            ("AGENTBOX_CONFIG", &cfg.display().to_string()),
            ("AGENTBOX_PRIVKEY_HEX", PRIV_HEX),
            ("AGENTBOX_AGENT_ID", "agentbox-core"),
        ],
    );
    run(&env).unwrap();

    let pods = dir.path().join("solid/pods");
    assert!(dir.path().join("identities/agentbox-core.json").is_file());
    assert!(dir.path().join("run/identity.env").is_file());
    assert!(pods.join(EXPECTED_XONLY).join(".acl").is_file());
    assert!(pods.join(EXPECTED_XONLY).join("did-nostr.json").is_file());
    // Pod git repo + contract substrate landed on the canonical hex dir.
    assert!(pods.join(EXPECTED_XONLY).join(".git").exists());
    assert!(pods.join(EXPECTED_XONLY).join("agent.did.json").is_file());
    assert!(pods.join(EXPECTED_XONLY).join("gitmark.json").is_file());
    // Data-root alias.
    assert!(dir.path().join("solid").join(EXPECTED_XONLY).is_symlink());

    let env_text = std::fs::read_to_string(dir.path().join("run/identity.env")).unwrap();
    assert!(env_text.contains(&format!(
        "export AGENTBOX_X_ONLY_PUBKEY_HEX={EXPECTED_XONLY}"
    )));
}

#[test]
fn run_honours_an_explicit_agent_repo_root() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = manifest(dir.path(), true);
    let repo = dir.path().join("elsewhere");
    let env = scratch_env(
        dir.path(),
        &[
            ("AGENTBOX_CONFIG", &cfg.display().to_string()),
            ("AGENTBOX_PRIVKEY_HEX", PRIV_HEX),
            ("AGENTBOX_AGENT_REPO_ROOT", &repo.display().to_string()),
        ],
    );
    run(&env).unwrap();
    assert!(repo.join("agent.did.json").is_file());
    assert!(!dir
        .path()
        .join("solid/pods")
        .join(EXPECTED_XONLY)
        .join("agent.did.json")
        .exists());
}
