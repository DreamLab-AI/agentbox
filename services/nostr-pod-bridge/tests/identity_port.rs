//! End-to-end: the real binary in `serve-identity` mode on a real unix socket,
//! driven by the real `sign-request` client.
//!
//! The authorisation input is the peer uid from `SO_PEERCRED`. This harness
//! runs as one uid and cannot switch (the container sets no-new-privileges),
//! so the "uid not in the ACL" case runs a second port whose ACL omits the
//! test's own uid: the refusal comes through the real peer-cred read, not a
//! mock. Policy across several uids is covered by the unit tests in
//! `identity_port::port`.

use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const BIN: &str = env!("CARGO_BIN_EXE_nostr-pod-bridge");
const CORE: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const JJ: &str = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

struct Server {
    child: Child,
    dir: tempfile::TempDir,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    fn sock(&self) -> PathBuf {
        self.dir.path().join("run/identity.sock")
    }
    fn receipt_lines(&self) -> Vec<Value> {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(self.dir.path().join("receipts")) {
            for e in rd {
                for l in std::fs::read_to_string(e.unwrap().path()).unwrap().lines() {
                    out.push(serde_json::from_str(l).unwrap());
                }
            }
        }
        out
    }
}

fn own_ids() -> (u32, u32) {
    // The test's own uid/gid: a file we create is owned by us.
    let f = tempfile::NamedTempFile::new().unwrap();
    let md = std::fs::metadata(f.path()).unwrap();
    (md.uid(), md.gid())
}

fn acl_for(uid: u32) -> String {
    json!({
        "version": 1,
        "keys": {
            "core": {"file": "core.key", "required": true, "mirror_root": true,
                     "nip98_url_prefixes": ["manifest:integrations.solid_pod_rs.base_url"],
                     "relays": ["ws://127.0.0.1:7777"]},
            "junkiejarvis": {"file": "junkiejarvis.key"}
        },
        "callers": {
            uid.to_string(): {"name": "test", "ops": {
                "pubkey": {"keys": ["core", "junkiejarvis"]},
                "nip98": {"keys": ["core"]},
                "sign_event": {"keys": ["core"], "kinds": [38410]},
                "forum_event": {"keys": ["junkiejarvis"], "kinds": [1]},
                "nip42_auth": {"keys": ["core"]},
                "mirror_key": {}
            }}
        }
    })
    .to_string()
}

fn start(acl: &str, flag: &str, gid: Option<u32>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    std::fs::create_dir(p.join("run")).unwrap();
    std::fs::set_permissions(p.join("run"), std::fs::Permissions::from_mode(0o755)).unwrap();
    // With the flag off nothing is provisioned: an off path that read the ACL
    // or a key would fail on the missing file.
    if flag == "1" {
        std::fs::create_dir(p.join("keys")).unwrap();
        std::fs::write(p.join("keys/core.key"), CORE).unwrap();
        std::fs::write(p.join("keys/junkiejarvis.key"), JJ).unwrap();
        std::fs::write(p.join("acl.json"), acl).unwrap();
    }
    std::fs::write(
        p.join("agentbox.toml"),
        "[integrations.solid_pod_rs]\nbase_url = \"https://pods.example\"\n",
    )
    .unwrap();
    let mut cmd = Command::new(BIN);
    cmd.arg("serve-identity")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("RUST_LOG", "warn")
        .env("AGENTBOX_ROLE_ISOLATION", flag)
        .env("AGENTBOX_IDENTITY_ACL", p.join("acl.json"))
        .env("AGENTBOX_IDENTITY_KEY_DIR", p.join("keys"))
        .env("AGENTBOX_IDENTITY_SOCK", p.join("run/identity.sock"))
        .env("AGENTBOX_IDENTITY_RECEIPT_DIR", p.join("receipts"))
        .env("AGENTBOX_CONFIG", p.join("agentbox.toml"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(g) = gid {
        cmd.env("AGENTBOX_IDENTITY_SOCK_GID", g.to_string());
    }
    let child = cmd.spawn().unwrap();
    let s = Server { child, dir };
    if flag == "1" {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !s.sock().exists() {
            assert!(Instant::now() < deadline, "socket never appeared");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    s
}

fn call(sock: &Path, op: &str, stdin: &str) -> (i32, Value) {
    let mut c = Command::new(BIN)
        .args(["sign-request", op])
        .env_clear()
        .env("AGENTBOX_IDENTITY_SOCK", sock)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    c.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let out = c.wait_with_output().unwrap();
    let v = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    (out.status.code().unwrap_or(-1), v)
}

fn core_xonly() -> String {
    nostr_pod_bridge::identity::keypair_from_privkey_hex(CORE)
        .unwrap()
        .x_only_pubkey_hex
}

#[test]
fn the_rehearsal_c_contract_holds_against_the_real_port() {
    let (uid, gid) = own_ids();
    let s = start(&acl_for(uid), "1", Some(gid));
    let sock = s.sock();
    let before = s.receipt_lines().len();

    let (rc, v) = call(&sock, "pubkey", r#"{"key":"core"}"#);
    assert_eq!(rc, 0, "{v}");
    assert_eq!(v["pubkey"], core_xonly());
    assert_eq!(v["did"], format!("did:nostr:{}", core_xonly()));

    let (rc, v) = call(
        &sock,
        "nip98",
        r#"{"key":"core","method":"PUT","url":"https://pods.example/.agentbox-rehearsal/x1-probe","payload_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}"#,
    );
    assert_eq!(rc, 0, "{v}");
    assert!(v["header"].as_str().unwrap().starts_with("Nostr "));

    let (rc, v) = call(
        &sock,
        "forum_event",
        r#"{"key":"junkiejarvis","kind":1,"content":"x1 role-isolation rehearsal probe (dry run, not published)","dry_run":true}"#,
    );
    assert_eq!(rc, 0, "{v}");
    assert_eq!(v["event"]["kind"], 1);
    let ev: nostr_bbs_core::NostrEvent = serde_json::from_value(v["event"].clone()).unwrap();
    assert!(nostr_bbs_core::verify_event(&ev));

    let (rc, v) = call(
        &sock,
        "nip42_auth",
        r#"{"key":"core","relay":"ws://127.0.0.1:7777","challenge":"ch-1"}"#,
    );
    assert_eq!(rc, 0, "{v}");
    assert_eq!(v["event"]["kind"], 22242);

    for (op, body) in [
        ("dm_unwrap", r#"{"envelope":{}}"#),
        (
            "nip98",
            r#"{"key":"core","method":"GET","url":"https://not-allowlisted.invalid/x"}"#,
        ),
        ("sign", r#"{"event":{"kind":1,"content":"x","tags":[]}}"#),
    ] {
        let (rc, v) = call(&sock, op, body);
        assert_eq!(rc, 1, "{op} not refused: {v}");
        assert_eq!(v["refused"]["op"], op);
        assert!(v["refused"]["reason"].is_string());
    }
    // One receipt line per call, as (c) counts them.
    assert_eq!(s.receipt_lines().len() - before, 7);
}

#[test]
fn a_uid_outside_the_acl_is_refused_through_the_real_peer_credentials() {
    let (uid, _) = own_ids();
    let s = start(&acl_for(uid.wrapping_add(7919)), "1", None);
    for (op, body) in [
        ("pubkey", "{}"),
        (
            "nip98",
            r#"{"method":"GET","url":"https://pods.example/x"}"#,
        ),
        ("sign_event", r#"{"kind":38410}"#),
        ("mirror_key", "{}"),
    ] {
        let (rc, v) = call(&s.sock(), op, body);
        assert_eq!(rc, 1, "{op}: {v}");
        let reason = v["refused"]["reason"].as_str().unwrap();
        assert!(
            reason.contains(&format!("uid {uid} is not in the identity-port ACL")),
            "{reason}"
        );
    }
    let lines = s.receipt_lines();
    assert_eq!(lines.len(), 4);
    assert!(lines
        .iter()
        .all(|l| l["decision"] == "refuse" && l["uid"] == uid && l.get("event_id").is_none()));
    // pid and exe come from the peer credentials too (audit only).
    assert!(lines.iter().all(|l| l["pid"].as_i64().unwrap_or(0) > 0));
}

#[test]
fn malformed_stdin_is_forwarded_and_refused() {
    let (uid, _) = own_ids();
    let s = start(&acl_for(uid), "1", None);
    let (rc, v) = call(&s.sock(), "sign_event", "this is not json");
    assert_eq!(rc, 1, "{v}");
    assert!(v["refused"]["reason"]
        .as_str()
        .unwrap()
        .contains("params must be a JSON object"));
    let (rc, v) = call(&s.sock(), "sign_event", r#"{"kind":38410,"author":"me"}"#);
    assert_eq!(rc, 1, "{v}");
    assert_eq!(s.receipt_lines().len(), 2);
}

#[test]
fn no_socket_exits_2_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let (rc, v) = call(&dir.path().join("absent.sock"), "pubkey", "{}");
    assert_eq!(rc, 2);
    assert!(v["unavailable"]["reason"]
        .as_str()
        .unwrap()
        .contains("cannot connect"));
}

#[test]
fn socket_mode_and_group_and_no_secret_on_argv_or_environ() {
    let (uid, gid) = own_ids();
    let s = start(&acl_for(uid), "1", Some(gid));
    let m = std::fs::metadata(s.sock()).unwrap();
    assert_eq!(m.permissions().mode() & 0o7777, 0o660);
    assert_eq!(m.gid(), gid);
    assert_eq!(m.uid(), uid);

    let pid = s.child.id();
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap();
    let environ = std::fs::read(format!("/proc/{pid}/environ")).unwrap();
    for hay in [&cmdline, &environ] {
        let h = String::from_utf8_lossy(hay).to_ascii_lowercase();
        assert!(!h.contains(CORE) && !h.contains(JJ));
    }
    assert_eq!(
        String::from_utf8_lossy(&cmdline)
            .split('\0')
            .filter(|a| !a.is_empty())
            .count(),
        2
    );

    // Every response, admitted or refused, is free of both secrets.
    for (op, body) in [
        ("pubkey", "{}"),
        ("pubkey", r#"{"key":"junkiejarvis"}"#),
        (
            "nip98",
            r#"{"method":"GET","url":"https://pods.example/x"}"#,
        ),
        ("sign_event", r#"{"kind":38410}"#),
        ("forum_event", r#"{"kind":1}"#),
        (
            "nip42_auth",
            r#"{"relay":"ws://127.0.0.1:7777","challenge":"c"}"#,
        ),
        ("mirror_key", "{}"),
        ("nope", "{}"),
    ] {
        let (_, v) = call(&s.sock(), op, body);
        let t = v.to_string().to_ascii_lowercase();
        assert!(!t.contains(CORE) && !t.contains(JJ), "{op} leaked a secret");
    }
    // This ACL grants mirror_key without `secret`: public half only.
    let (_, v) = call(&s.sock(), "mirror_key", "{}");
    assert_eq!(
        v["pubkey"],
        nostr_pod_bridge::mirror_key::child_xonly_pubkey_hex(CORE, None).unwrap()
    );
    assert!(v.get("secret_hex").is_none());
}

#[test]
fn a_world_writable_socket_directory_is_refused() {
    let (uid, _) = own_ids();
    let s = start(&acl_for(uid), "1", None);
    let p = s.dir.path();
    std::fs::set_permissions(p.join("run"), std::fs::Permissions::from_mode(0o777)).unwrap();
    let out = Command::new(BIN)
        .arg("serve-identity")
        .env_clear()
        .env("AGENTBOX_ROLE_ISOLATION", "1")
        .env("AGENTBOX_IDENTITY_ACL", p.join("acl.json"))
        .env("AGENTBOX_IDENTITY_KEY_DIR", p.join("keys"))
        .env("AGENTBOX_IDENTITY_SOCK", p.join("run/identity.sock"))
        .env("AGENTBOX_IDENTITY_RECEIPT_DIR", p.join("receipts"))
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("world-writable"));
}

#[test]
fn with_the_flag_off_serve_identity_reads_nothing_and_binds_nothing() {
    let (uid, _) = own_ids();
    let mut s = start(&acl_for(uid), "0", None);
    let status = s.child.wait().unwrap();
    assert!(status.success());
    assert!(!s.sock().exists());
    assert!(!s.dir.path().join("receipts").exists());
}

#[test]
fn the_checked_in_acl_loads_and_grants_what_the_rehearsal_needs() {
    use nostr_pod_bridge::identity_port::acl::{
        Acl, OP_FORUM_EVENT, OP_NIP42_AUTH, OP_NIP98, OP_PUBKEY,
    };
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/custody/identity-port-acl.json");
    let manifest: toml::Value = toml::from_str(
        &std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agentbox.toml"))
            .unwrap(),
    )
    .unwrap();
    let acl = Acl::load(&path, Some(&manifest)).unwrap();
    assert!(acl.unresolved.is_empty(), "{:?}", acl.unresolved);
    for op in [OP_PUBKEY, OP_NIP98, OP_FORUM_EVENT, OP_NIP42_AUTH] {
        assert!(acl.grant(1000, op).is_some(), "devuser lacks {op}");
    }
    assert!(acl.grant(1000, OP_FORUM_EVENT).unwrap().kinds.contains(&1));
    assert!(!acl.keys["core"].url_prefixes.is_empty());
    assert!(acl.keys["core"].relays.contains("ws://127.0.0.1:7777"));
    // The gateway gets the child's public half only.
    assert!(!acl.grant(961, "mirror_key").unwrap().secret);
}
