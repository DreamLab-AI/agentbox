//! Byte-for-byte parity with the four Python scripts this crate replaces:
//! `tui-read-manifest.py`, `tui-write-manifest.py`, `model-routing-project.py`
//! and `provision-agent-stacks.py`.
//!
//! Every fixture under `tests/golden/` was produced by running the original
//! Python against the live `agentbox.toml` while that Python still existed.
//! The assertions below re-run the same inputs through the Rust binary and
//! compare **bytes**, not parsed values.
//!
//! Byte-parity is the right bar because these files have strict consumers:
//! agentic-qe reads `llm-config.json`, Claude Code reads each profile's
//! `settings.json`, and `agentbox.toml` is diffed by operators. A
//! semantically-equal-but-differently-ordered document would be a silent
//! behaviour change on every boot.

mod common;

use common::*;
use std::path::{Path, PathBuf};
use std::process::Command;

// ─── tui-read ────────────────────────────────────────────────────────────────

#[test]
fn tui_read_matches_python_on_the_live_manifest_and_every_fixture() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/tui/fixtures");
    let cases: Vec<(&str, PathBuf)> = vec![
        ("live", manifest()),
        ("valid-full", fixtures.join("valid-full.toml")),
        ("valid-minimal", fixtures.join("valid-minimal.toml")),
        ("valid-standalone", fixtures.join("valid-standalone.toml")),
    ];
    let s = Scratch::new("tui-read");
    for (label, src) in cases {
        let out = s.join(&format!("{label}.json"));
        run_ok(&["tui-read", src.to_str().unwrap(), out.to_str().unwrap()]);
        assert_same_bytes(
            &format!("tui-read {label}"),
            &std::fs::read(&out).unwrap(),
            &golden(&format!("tui-read.{label}.json")),
        );
    }
}

#[test]
fn tui_read_of_a_missing_manifest_is_the_all_defaults_state() {
    let s = Scratch::new("tui-read-missing");
    let out = s.join("state.json");
    run_ok(&[
        "tui-read",
        s.join("nope.toml").to_str().unwrap(),
        out.to_str().unwrap(),
    ]);
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
    assert_eq!(v["federation.mode"], "standalone");
    assert_eq!(v["adapters.beads"], "local-sqlite");
    assert_eq!(v["desktop.enabled"], false);
    assert_eq!(v["toolchains.claude"], true);
}

#[test]
fn tui_read_of_malformed_toml_exits_non_zero() {
    let s = Scratch::new("tui-read-bad");
    let bad = s.join("bad.toml");
    std::fs::write(&bad, "[broken\nnot = valid toml ]]").unwrap();
    let out = run(&[
        "tui-read",
        bad.to_str().unwrap(),
        s.join("s.json").to_str().unwrap(),
    ]);
    assert!(!out.status.success());
    assert!(!out.stderr.is_empty());
}

// ─── tui-write ───────────────────────────────────────────────────────────────

#[test]
fn tui_write_verbatim_matches_python_for_minimal_and_live_states() {
    let s = Scratch::new("tui-write");
    for (label, state) in [
        ("minimal-verbatim", "tui-write.minimal-state.json"),
        ("live-verbatim", "tui-write.live-state.json"),
    ] {
        let sp = s.join(&format!("{label}.state.json"));
        std::fs::write(&sp, golden(state)).unwrap();
        let op = s.join(&format!("{label}.toml"));
        run_ok(&["tui-write", sp.to_str().unwrap(), op.to_str().unwrap()]);
        assert_same_bytes(
            label,
            &std::fs::read(&op).unwrap(),
            &golden(&format!("tui-write.{label}.toml")),
        );
    }
}

#[test]
fn tui_write_merged_over_the_live_manifest_matches_python() {
    let s = Scratch::new("tui-write-merged");
    let sp = s.join("state.json");
    std::fs::write(&sp, golden("tui-write.live-state.json")).unwrap();
    let op = s.join("out.toml");
    run_ok(&[
        "tui-write",
        sp.to_str().unwrap(),
        op.to_str().unwrap(),
        manifest().to_str().unwrap(),
    ]);
    assert_same_bytes(
        "tui-write live-merged",
        &std::fs::read(&op).unwrap(),
        &golden("tui-write.live-merged.toml"),
    );
}

#[test]
fn tui_write_rejects_a_malformed_state_document() {
    let s = Scratch::new("tui-write-bad");
    let sp = s.join("bad.json");
    std::fs::write(&sp, "{ not valid json").unwrap();
    let out = run(&[
        "tui-write",
        sp.to_str().unwrap(),
        s.join("o.toml").to_str().unwrap(),
    ]);
    assert!(!out.status.success());
}

#[test]
fn tui_write_to_an_unwritable_directory_exits_non_zero() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc_geteuid() } == 0 {
        return; // root bypasses the permission check, as the pytest skip noted
    }
    let s = Scratch::new("tui-write-locked");
    let locked = s.join("locked");
    std::fs::create_dir_all(&locked).unwrap();
    let sp = s.join("state.json");
    std::fs::write(&sp, golden("tui-write.minimal-state.json")).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
    let out = run(&[
        "tui-write",
        sp.to_str().unwrap(),
        locked.join("out.toml").to_str().unwrap(),
    ]);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!out.status.success());
}

extern "C" {
    #[link_name = "geteuid"]
    fn libc_geteuid() -> u32;
}

// ─── provision-agent-stacks ──────────────────────────────────────────────────

#[test]
fn provision_stacks_matches_python_for_every_generated_artefact() {
    // The generated settings.json embeds absolute workspace paths, so the
    // replay has to use the same directory the capture did.
    let ws = PathBuf::from("/tmp/abm-golden-stacks-ws");
    let _ = std::fs::remove_dir_all(&ws);
    std::fs::create_dir_all(&ws).unwrap();
    let out = Command::new(BIN)
        .arg("provision-stacks")
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("WORKSPACE", &ws)
        .env("SKILLS_TREE", "/opt/agentbox/skills")
        .env("AGENTBOX_CONFIG", manifest())
        .env("SHARED_PROJECTS_ROOT", "/projects")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "provision-stacks failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    for (produced, name) in [
        (
            ws.join(".agentbox/stack-manifest.json"),
            "stacks.stack-manifest.json",
        ),
        (
            ws.join("profiles/claude-core/.claude/settings.json"),
            "stacks.claude-core.settings.json",
        ),
        (
            ws.join("profiles/claude-core/README.md"),
            "stacks.claude-core.README.md",
        ),
        (
            ws.join("profiles/claude-core/.env"),
            "stacks.claude-core.env",
        ),
        (
            ws.join("profiles/codex/README.md"),
            "stacks.codex.README.md",
        ),
    ] {
        assert_same_bytes(name, &std::fs::read(&produced).unwrap(), &golden(name));
    }

    // Shared-mount symlinks and the no-claude-settings contract.
    assert!(
        std::fs::symlink_metadata(ws.join("profiles/claude-core/projects"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(!ws.join("profiles/codex/.claude/settings.json").exists());
    assert!(ws.join("profiles/codex/.codex").is_dir());
}

#[test]
fn provision_stacks_is_idempotent_across_reruns() {
    let s = Scratch::new("stacks-idem");
    let ws = s.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let go = || {
        Command::new(BIN)
            .arg("provision-stacks")
            .env_clear()
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .env("WORKSPACE", &ws)
            .env("SKILLS_TREE", "/opt/agentbox/skills")
            .env("AGENTBOX_CONFIG", manifest())
            .env("SHARED_PROJECTS_ROOT", "/projects")
            .status()
            .unwrap()
    };
    assert!(go().success());
    let first = std::fs::read(ws.join(".agentbox/stack-manifest.json")).unwrap();
    assert!(go().success());
    assert_eq!(
        std::fs::read(ws.join(".agentbox/stack-manifest.json")).unwrap(),
        first
    );
}

// ─── state helpers used by scripts/start-agentbox.sh ─────────────────────────

#[test]
fn state_helpers_round_trip_the_wizard_contract() {
    let s = Scratch::new("state");
    let f = s.join("state.json");
    std::fs::write(&f, golden("tui-write.minimal-state.json")).unwrap();
    let fp = f.to_str().unwrap();

    let got = run_ok(&["state-get", fp, "federation.mode"]);
    assert_eq!(String::from_utf8_lossy(&got.stdout).trim(), "standalone");
    let got = run_ok(&["state-get", fp, "desktop.enabled"]);
    assert_eq!(String::from_utf8_lossy(&got.stdout).trim(), "false");
    let got = run_ok(&["state-get", fp, "absent.key"]);
    assert_eq!(String::from_utf8_lossy(&got.stdout), "\n");

    run_ok(&["state-set", fp, "federation.mode", "client"]);
    run_ok(&["state-set-bool", fp, "desktop.enabled", "true"]);
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
    assert_eq!(v["federation.mode"], "client");
    assert_eq!(v["desktop.enabled"], true);
}
