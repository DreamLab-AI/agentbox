//! Agentbox's host projection must preserve the generic CLI's argv and stdin.
#![cfg(unix)]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "visioncraft-host-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).expect("fixture directory");
        let stub = path.join("visioncraft");
        fs::write(&stub, "#!/bin/sh\nprintf '%s\\0' \"$@\" > \"$ARGS_OUT\"\nwhile IFS= read -r line; do printf '%s\\n' \"$line\"; done > \"$STDIN_OUT\"\nexit 124\n")
            .expect("stub");
        fs::set_permissions(stub, fs::Permissions::from_mode(0o755)).expect("executable stub");
        Self(path)
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_agentbox-manifest"));
        command
            .arg("deepsec-gate")
            .env_clear()
            .env("PATH", format!("{}:/usr/bin:/bin", self.0.display()))
            .env("AGENTBOX_CONFIG", self.0.join("agentbox.toml"))
            .env("ARGS_OUT", self.0.join("args"))
            .env("STDIN_OUT", self.0.join("stdin"));
        command
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn projects_policy_then_preserves_argv_stdin_and_exit() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("agentbox.toml"), "[security.deepsec]\nenabled = true\nagent = 'codex'\nbatch_size = 3\nfail_on = 'HIGH'\nai_api_key_env = 'PRIVATE_TEST_KEY'\n")
        .expect("manifest");
    let mut child = fixture
        .command()
        .args([
            "--files-from",
            "-",
            "--report-dir",
            "dir with spaces;$(false)",
            "--fail-on",
            "LOW",
        ])
        .env("DEEPSEC_GATE_BATCH_SIZE", "8")
        .env("PRIVATE_TEST_KEY", "secret-must-not-appear-in-policy")
        .stdin(Stdio::piped())
        .spawn()
        .expect("host command");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(b"src/a.rs\n")
        .expect("input");
    assert_eq!(child.wait().expect("exit").code(), Some(124));
    let bytes = fs::read(fixture.0.join("args")).expect("argv");
    let args: Vec<_> = bytes
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();
    assert_eq!(&args[..2], ["deepsec", "--policy-json"]);
    let policy: serde_json::Value = serde_json::from_str(&args[2]).expect("typed policy");
    assert_eq!(policy["agent"], "codex");
    assert_eq!(policy["enabled"], true);
    assert_eq!(policy["batch_size"], 8);
    assert_eq!(policy["fail_on"], "HIGH");
    assert_eq!(policy["ai_api_key_env"], "PRIVATE_TEST_KEY");
    assert!(policy["policy_source"]
        .as_str()
        .expect("source")
        .ends_with("agentbox.toml"));
    assert_eq!(
        &args[3..],
        [
            "--files-from",
            "-",
            "--report-dir",
            "dir with spaces;$(false)",
            "--fail-on",
            "LOW"
        ]
    );
    assert!(!args.join(" ").contains("secret-must-not-appear-in-policy"));
    assert_eq!(
        fs::read(fixture.0.join("stdin")).expect("forwarded stdin"),
        b"src/a.rs\n"
    );
}

#[test]
fn malformed_manifest_and_invalid_typed_override_do_not_launch() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("agentbox.toml"),
        "[private\nsecret = 'must-not-leak'",
    )
    .expect("manifest");
    let output = fixture
        .command()
        .arg("--dry-run")
        .output()
        .expect("command");
    assert_eq!(output.status.code(), Some(78));
    assert!(!String::from_utf8_lossy(&output.stderr).contains("must-not-leak"));
    assert!(!fixture.0.join("args").exists());
    fs::write(fixture.0.join("agentbox.toml"), "").expect("manifest");
    let output = fixture
        .command()
        .arg("--dry-run")
        .env("DEEPSEC_GATE_ENABLED", "unknown")
        .output()
        .expect("command");
    assert_eq!(output.status.code(), Some(78));
    assert!(!fixture.0.join("args").exists());
}

#[test]
fn missing_binary_is_unavailable_without_legacy_fallback() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("agentbox.toml"), "").expect("manifest");
    fs::remove_file(fixture.0.join("visioncraft")).expect("remove stub");
    let output = fixture
        .command()
        .env("PATH", &fixture.0)
        .arg("--dry-run")
        .output()
        .expect("command");
    assert_eq!(output.status.code(), Some(78));
    assert!(String::from_utf8_lossy(&output.stderr).contains("visioncraft"));
}

#[test]
fn explicit_missing_manifest_refuses_before_executor() {
    let fixture = Fixture::new();
    let output = fixture
        .command()
        .arg("--dry-run")
        .output()
        .expect("command");
    assert_eq!(output.status.code(), Some(78));
    assert!(!fixture.0.join("args").exists());
}

#[test]
fn caller_cannot_replace_host_policy_json() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("agentbox.toml"),
        "[security.deepsec]\nenabled = false",
    )
    .expect("manifest");
    let output = fixture
        .command()
        .args(["--policy-json", "{\"enabled\":true}"])
        .output()
        .expect("command");
    assert_eq!(output.status.code(), Some(78));
    assert!(!fixture.0.join("args").exists());
}
