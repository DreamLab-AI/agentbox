//! Custody X-1 step 1, W2 (bypass 3): the sovereign secret leaves `identity.env`
//! under `[security].role_isolation`, and every Rust reader of a ROLE variable
//! takes `<NAME>_FILE` first and refuses the bare variable under the flag.
//!
//! Flag off, everything is byte-identical to before.

use nostr_pod_bridge::bootstrap::*;
use nostr_pod_bridge::envmap::EnvMap;
use nostr_pod_bridge::identity::{env_privkey_hex, keypair_from_privkey_hex};
use nostr_pod_bridge::role_secret::FLAG_VAR;
use std::path::{Path, PathBuf};

/// BIP-340 test vector: privkey 3 → known even-y x-only pubkey.
const PRIV_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000003";
const EXPECTED_XONLY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
/// A second valid key, so a test can tell which source won.
const OTHER_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000007";

fn scratch_env(dir: &Path, extra: &[(&str, &str)]) -> EnvMap {
    let cfg = dir.join("agentbox.toml");
    std::fs::write(&cfg, "[sovereign_mesh]\nenabled = true\n").unwrap();
    let mut pairs: Vec<(String, String)> = vec![
        ("AGENTBOX_CONFIG".into(), cfg.display().to_string()),
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
        (
            "AGENTBOX_SECRETS_ROOT".into(),
            dir.join("secrets").display().to_string(),
        ),
        ("AGENTBOX_AGENT_ID".into(), "agentbox-core".into()),
    ];
    pairs.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    EnvMap::from_iter(pairs)
}

fn identity_env(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("run/identity.env")).unwrap()
}

fn exported_names(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| l.strip_prefix("export "))
        .filter_map(|l| l.split('=').next())
        .map(str::to_string)
        .collect()
}

fn mode(p: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).unwrap().permissions().mode() & 0o777
}

#[test]
fn flag_off_identity_env_is_byte_identical_and_no_key_file_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let env = scratch_env(dir.path(), &[("AGENTBOX_PRIVKEY_HEX", PRIV_HEX)]);
    run(&env).unwrap();
    let id = nostr_pod_bridge::identity::ensure_identity(
        "agentbox-core",
        &dir.path().join("identities"),
        &env,
    )
    .unwrap();
    assert_eq!(identity_env(dir.path()), render_runtime_env(&id));
    assert!(!dir.path().join("secrets/ab-identity/nostr.key").exists());
}

#[test]
fn flag_on_identity_env_carries_no_secret() {
    let dir = tempfile::tempdir().unwrap();
    let pin = dir.path().join("pin");
    std::fs::write(&pin, PRIV_HEX).unwrap();
    let env = scratch_env(
        dir.path(),
        &[
            (FLAG_VAR, "1"),
            ("AGENTBOX_PRIVKEY_HEX_FILE", pin.to_str().unwrap()),
        ],
    );
    run(&env).unwrap();
    let text = identity_env(dir.path());
    let names = exported_names(&text);
    assert!(!names.iter().any(|n| n == "AGENTBOX_NSEC"), "{names:?}");
    assert!(
        !names.iter().any(|n| n == "AGENTBOX_BRIDGE_SK"),
        "{names:?}"
    );
    let km = keypair_from_privkey_hex(PRIV_HEX).unwrap();
    assert!(
        !text.contains(&km.private_key_hex),
        "secret hex in identity.env"
    );
    assert!(!text.contains(&km.nsec), "nsec in identity.env");
    assert!(!text.contains("nsec1"), "any nsec in identity.env");
    // The public names stay, so every consumer of the DID and pubkey still works.
    for n in [
        "AGENTBOX_AGENT_ID",
        "AGENTBOX_NPUB",
        "AGENTBOX_PUBKEY_HEX",
        "AGENTBOX_X_ONLY_PUBKEY_HEX",
        "AGENTBOX_DID",
        "AGENTBOX_URN",
        "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
        "AGENTBOX_BRIDGE_SK_FILE",
    ] {
        assert!(names.iter().any(|x| x == n), "{n} missing: {names:?}");
    }
    assert!(text.contains(&format!("export AGENTBOX_DID=did:nostr:{EXPECTED_XONLY}")));
    assert_eq!(mode(&dir.path().join("run/identity.env")), 0o600);
}

#[test]
fn flag_on_secret_goes_to_the_key_file_and_the_identity_file_only() {
    let dir = tempfile::tempdir().unwrap();
    let pin = dir.path().join("pin");
    std::fs::write(&pin, PRIV_HEX).unwrap();
    let env = scratch_env(
        dir.path(),
        &[
            (FLAG_VAR, "1"),
            ("AGENTBOX_PRIVKEY_HEX_FILE", pin.to_str().unwrap()),
        ],
    );
    run(&env).unwrap();
    let key = dir.path().join("secrets/ab-identity/nostr.key");
    let km = keypair_from_privkey_hex(PRIV_HEX).unwrap();
    assert_eq!(std::fs::read_to_string(&key).unwrap(), km.private_key_hex);
    assert_eq!(mode(&key), 0o400);
    let text = identity_env(dir.path());
    assert!(text.contains(&format!("export AGENTBOX_BRIDGE_SK_FILE={}", key.display())));
    let doc: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(dir.path().join("identities/agentbox-core.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(doc["private_key_hex"], km.private_key_hex.as_str());
    assert_eq!(doc["nsec"], km.nsec.as_str());
}

#[test]
fn flag_on_rerun_replaces_the_key_file_and_never_follows_a_symlink() {
    let dir = tempfile::tempdir().unwrap();
    let victim = dir.path().join("victim");
    std::fs::write(&victim, "precious").unwrap();
    std::fs::create_dir_all(dir.path().join("secrets/ab-identity")).unwrap();
    std::os::unix::fs::symlink(&victim, dir.path().join("secrets/ab-identity/nostr.key")).unwrap();
    let pin = dir.path().join("pin");
    std::fs::write(&pin, PRIV_HEX).unwrap();
    let env = scratch_env(
        dir.path(),
        &[
            (FLAG_VAR, "1"),
            ("AGENTBOX_PRIVKEY_HEX_FILE", pin.to_str().unwrap()),
        ],
    );
    run(&env).unwrap();
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "precious");
    let key = dir.path().join("secrets/ab-identity/nostr.key");
    assert!(!key.is_symlink());
    run(&env).unwrap(); // a 0400 file from the previous boot is replaced, not an error
    assert_eq!(mode(&key), 0o400);
}

#[test]
fn operator_pin_file_wins_over_the_env_var_with_the_flag_off() {
    let dir = tempfile::tempdir().unwrap();
    let pin = dir.path().join("pin");
    std::fs::write(&pin, format!("{OTHER_HEX}\n")).unwrap();
    let env: EnvMap = [
        ("AGENTBOX_PRIVKEY_HEX", PRIV_HEX),
        ("AGENTBOX_PRIVKEY_HEX_FILE", pin.to_str().unwrap()),
    ]
    .into_iter()
    .collect();
    assert_eq!(env_privkey_hex(&env).as_deref(), Some(OTHER_HEX));
}

#[test]
fn operator_pin_env_var_is_honoured_with_the_flag_off() {
    let env: EnvMap = [("AGENTBOX_PRIVKEY_HEX", PRIV_HEX)].into_iter().collect();
    assert_eq!(env_privkey_hex(&env).as_deref(), Some(PRIV_HEX));
}

#[test]
fn operator_pin_env_vars_are_ignored_under_the_flag() {
    let km = keypair_from_privkey_hex(PRIV_HEX).unwrap();
    let env: EnvMap = [
        (FLAG_VAR, "1"),
        ("AGENTBOX_PRIVKEY_HEX", PRIV_HEX),
        ("AGENTBOX_NSEC", km.nsec.as_str()),
    ]
    .into_iter()
    .collect();
    assert_eq!(env_privkey_hex(&env), None);
}

#[test]
fn nsec_file_is_decoded_under_the_flag() {
    let dir = tempfile::tempdir().unwrap();
    let km = keypair_from_privkey_hex(PRIV_HEX).unwrap();
    let f: PathBuf = dir.path().join("nsec");
    std::fs::write(&f, &km.nsec).unwrap();
    let env: EnvMap = [(FLAG_VAR, "1"), ("AGENTBOX_NSEC_FILE", f.to_str().unwrap())]
        .into_iter()
        .collect();
    assert_eq!(
        env_privkey_hex(&env).as_deref(),
        Some(km.private_key_hex.as_str())
    );
}

#[test]
fn bridge_configured_ignores_the_bare_sk_under_the_flag() {
    use nostr_pod_bridge::session_summary::bridge_configured;
    let base = [
        ("AGENTBOX_BRIDGE_RECIPIENT_PUBKEY", EXPECTED_XONLY),
        ("AGENTBOX_POD_ROOT", "/pods"),
        ("AGENTBOX_ADMIN_PUBKEY", EXPECTED_XONLY),
        ("AGENTBOX_BRIDGE_SK", PRIV_HEX),
        ("AGENTBOX_BRIDGE_SK_FILE", "/nonexistent/nostr.key"),
    ];
    let off: EnvMap = base.into_iter().collect();
    assert!(
        bridge_configured(&off),
        "flag off: the env var still counts"
    );
    let on: EnvMap = base.into_iter().chain([(FLAG_VAR, "1")]).collect();
    assert!(!bridge_configured(&on), "flag on: only the file counts");
}
