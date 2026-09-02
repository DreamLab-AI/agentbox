//! Byte-for-byte parity with the inline `python3` sites lifted out of
//! `config/entrypoint-unified.sh`.
//!
//! Two shell conventions are asserted alongside the bytes, because the
//! entrypoint depends on both: which side prints the log line (the shell's
//! `&& echo` for most sites, the interpreter itself for two), and that
//! fail-open sites still exit 0 so a bad config never blocks boot.

mod common;

use common::*;
use std::process::Command;

// ─── entrypoint sites ────────────────────────────────────────────────────────

#[test]
fn nip98_projection_matches_python_bytes_and_log_line() {
    let s = Scratch::new("nip98");
    let out_path = s.join("sub/nip98-proxy-config.json");
    let out = run_ok(&[
        "nip98-config",
        "--manifest",
        manifest().to_str().unwrap(),
        "--out",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        golden_str("nip98.stdout.txt")
    );
    assert_same_bytes(
        "nip98-proxy-config.json",
        &std::fs::read(&out_path).unwrap(),
        &golden("nip98-proxy-config.json"),
    );
}

#[test]
fn nip98_removes_a_stale_config_when_the_section_is_absent() {
    let s = Scratch::new("nip98-absent");
    let m = s.join("m.toml");
    std::fs::write(&m, "[core]\nx = 1\n").unwrap();
    let out_path = s.join("cfg.json");
    std::fs::write(&out_path, "{}").unwrap();
    let out = run_ok(&[
        "nip98-config",
        "--manifest",
        m.to_str().unwrap(),
        "--out",
        out_path.to_str().unwrap(),
    ]);
    assert!(!out_path.exists());
    assert_eq!(
        String::from_utf8_lossy(&out.stdout).trim(),
        "[nip98-proxy] config section absent — removed stale config file"
    );
}

#[test]
fn model_routing_projection_matches_python_bytes() {
    let s = Scratch::new("routing");
    let ws = s.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    run_ok(&[
        "model-routing-project",
        "--manifest",
        golden_dir()
            .join("model-routing.manifest.toml")
            .to_str()
            .unwrap(),
        "--workspace",
        ws.to_str().unwrap(),
    ]);
    assert_same_bytes(
        "llm-config.json",
        &std::fs::read(ws.join(".agentic-qe/llm-config.json")).unwrap(),
        &golden("model-routing.llm-config.json"),
    );
}

#[test]
fn model_routing_preserves_unmanaged_keys_and_strips_api_keys() {
    let s = Scratch::new("routing-merge");
    let ws = s.join("ws");
    let aqe = ws.join(".agentic-qe");
    std::fs::create_dir_all(&aqe).unwrap();
    std::fs::write(
        aqe.join("llm-config.json"),
        r#"{"operatorKey": "keep me", "apiKey": "drop me", "defaultProvider": "stale"}"#,
    )
    .unwrap();
    run_ok(&[
        "model-routing-project",
        "--manifest",
        golden_dir()
            .join("model-routing.manifest.toml")
            .to_str()
            .unwrap(),
        "--workspace",
        ws.to_str().unwrap(),
    ]);
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(aqe.join("llm-config.json")).unwrap()).unwrap();
    assert_eq!(v["operatorKey"], "keep me");
    assert!(v.get("apiKey").is_none());
    assert_eq!(v["defaultProvider"], "claude-code");
    // Non-managed keys come first, in their original order.
    let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
    assert_eq!(keys[0], "operatorKey");
}

#[test]
fn model_routing_is_fail_open_on_an_unreadable_manifest() {
    let out = run(&["model-routing-project", "--manifest", "/nonexistent.toml"]);
    assert!(
        out.status.success(),
        "a projection failure must not block boot"
    );
}

#[test]
fn plugin_list_matches_python_stdout() {
    let out = run_ok(&["plugin-list", "--manifest", manifest().to_str().unwrap()]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        golden_str("plugin-list.stdout.txt")
    );
}

#[test]
fn consultants_gate_matches_python_stdout() {
    let out = run_ok(&[
        "toml-bool",
        "--manifest",
        manifest().to_str().unwrap(),
        "--path",
        "consultants.enabled",
    ]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        golden_str("consultants-gate.stdout.txt")
    );
}

#[test]
fn toml_bool_is_fail_open_on_a_missing_manifest() {
    let out = run_ok(&[
        "toml-bool",
        "--manifest",
        "/nonexistent.toml",
        "--path",
        "a.b",
    ]);
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "0");
}

// ─── .mcp.json chain ─────────────────────────────────────────────────────────

/// Apply the nine `.mcp.json` mutations in entrypoint order against one seed
/// file, asserting byte-parity after each — the same way the boot sequence
/// stacks them, so an ordering regression shows up at the step that caused it.
#[test]
fn mcp_upsert_chain_matches_python_at_every_step() {
    let s = Scratch::new("mcp");
    let f = s.join("mcp.json");
    std::fs::write(&f, golden("mcp.seed.json")).unwrap();
    let fp = f.to_str().unwrap();

    let set = |name: &str, spec: &str| {
        use std::io::Write;
        use std::process::Stdio;
        let mut child = Command::new(BIN)
            .args(["mcp-set-server", "--file", fp, "--name", name])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(spec.as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success(), "set-server {name}");
    };

    set(
        "browser-gpu",
        r#"{"type":"sse","url":"http://browsercontainer:8931/sse"}"#,
    );
    check(&f, "mcp.after-browser-gpu.json");

    run_ok(&[
        "mcp-reconcile-aqe",
        "--file",
        fp,
        "--provider",
        "claude-code",
    ]);
    check(&f, "mcp.after-agentic-qe.json");

    set(
        "ontology-bridge",
        r#"{"command":"node","args":["/opt/agentbox/mcp/servers/ontology-bridge.js"],"type":"stdio","env":{"VISIONCLAW_API_URL":"http://visionclaw-server:4000","VISIONCLAW_DEV_TOKEN":"","AGENTBOX_PUBKEY":"","AGENTBOX_ONTOLOGY_DIRECT_LOAD":"false","NODE_PATH":"/opt/agentbox/mcp/servers/node_modules"}}"#,
    );
    check(&f, "mcp.after-ontology-bridge.json");

    set(
        "precedent-bridge",
        r#"{"command":"node","args":["/opt/agentbox/mcp/servers/precedent-bridge.js"],"type":"stdio","env":{"AGENTBOX_POD_ROOT":"/var/lib/agentbox","NODE_PATH":"/opt/agentbox/mcp/servers/node_modules"}}"#,
    );
    check(&f, "mcp.after-precedent-bridge.json");

    set(
        "harness-bridge",
        r#"{"command":"node","args":["/opt/agentbox/mcp/servers/harness-bridge.js"],"type":"stdio","env":{"NODE_PATH":"/opt/agentbox/mcp/servers/node_modules"}}"#,
    );
    check(&f, "mcp.after-harness-bridge.json");

    set(
        "email-gateway",
        r#"{"type":"http","url":"http://email-mcp-gateway:8765/mcp","headers":{"Authorization":"Bearer tok-123"}}"#,
    );
    check(&f, "mcp.after-email-gateway.json");

    set(
        "perplexity",
        r#"{"command":"node","args":["/opt/agentbox/mcp/perplexity/node_modules/@perplexity-ai/mcp-server/dist/index.js"],"type":"stdio","env":{"PERPLEXITY_API_KEY":"pk-1"}}"#,
    );
    check(&f, "mcp.after-perplexity.json");

    set(
        "ruvnet-brain",
        r#"{"command":"node","args":["/opt/agentbox/mcp/ruvnet-brain/server.js"],"type":"stdio","env":{"RUVECTOR_PG_CONNINFO":"host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector","XINFERENCE_ENDPOINT":"http://xinference:9997","EMBEDDING_MODEL":"bge-small-en-v1.5","RUVNET_BRAIN_NAMESPACE":"ruvnet-kb","NODE_PATH":"/opt/agentbox/mcp/ruvnet-brain/node_modules","NODE_NO_WARNINGS":"1"}}"#,
    );
    check(&f, "mcp.after-ruvnet-brain.json");

    run_ok(&[
        "mcp-protect-namespace",
        "--file",
        fp,
        "--namespace",
        "ruvnet-kb",
    ]);
    check(&f, "mcp.after-protect-ns.json");
}

#[test]
fn protect_namespace_is_idempotent_and_silent_the_second_time() {
    let s = Scratch::new("protect");
    let f = s.join("mcp.json");
    std::fs::write(&f, golden("mcp.after-ruvnet-brain.json")).unwrap();
    let fp = f.to_str().unwrap();
    let first = run_ok(&[
        "mcp-protect-namespace",
        "--file",
        fp,
        "--namespace",
        "ruvnet-kb",
    ]);
    assert!(String::from_utf8_lossy(&first.stdout).contains("protected namespace ruvnet-kb"));
    let before = std::fs::read(&f).unwrap();
    let second = run_ok(&[
        "mcp-protect-namespace",
        "--file",
        fp,
        "--namespace",
        "ruvnet-kb",
    ]);
    assert!(second.stdout.is_empty());
    assert_eq!(std::fs::read(&f).unwrap(), before);
}

#[test]
fn reconcile_aqe_without_a_provider_removes_the_stale_key() {
    let s = Scratch::new("aqe-off");
    let f = s.join("mcp.json");
    std::fs::write(&f, golden("mcp.after-agentic-qe.json")).unwrap();
    run_ok(&["mcp-reconcile-aqe", "--file", f.to_str().unwrap()]);
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
    assert!(v["mcpServers"]["agentic-qe"]["env"]
        .get("AQE_LLM_PROVIDER")
        .is_none());
}

#[test]
fn deregister_fork_matches_python_bytes_and_log_line() {
    let s = Scratch::new("dereg");
    let f = s.join("claude.json");
    std::fs::write(&f, golden("mcp.seed.json")).unwrap();
    let out = run_ok(&["mcp-deregister-fork", "--file", f.to_str().unwrap()]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        golden_str("dereg.stdout.txt")
    );
    check(&f, "dereg.after.json");
}

#[test]
fn deregister_fork_is_a_silent_no_op_on_a_corrupt_file() {
    let s = Scratch::new("dereg-bad");
    let f = s.join("claude.json");
    std::fs::write(&f, "{ not json").unwrap();
    let out = run_ok(&["mcp-deregister-fork", "--file", f.to_str().unwrap()]);
    assert!(out.stdout.is_empty());
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "{ not json");
}

#[test]
fn plugin_register_matches_python_bytes_and_log_line() {
    let s = Scratch::new("plugin-reg");
    let f = s.join("ip.json");
    std::fs::write(&f, "{\n  \"plugins\": {\n    \"other@mp\": []\n  }\n}").unwrap();
    let out = run_ok(&[
        "plugin-register",
        "--file",
        f.to_str().unwrap(),
        "--key",
        "skill-creator@claude-plugins-official",
        "--install-path",
        "/ip",
        "--message",
        "[bootstrap] Pre-installed skill-creator from claude-plugins-official",
        "--now",
        "FROZEN",
    ]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        golden_str("plugin-register.stdout.txt")
    );
    check(&f, "plugin-register.after.json");
}

#[test]
fn plugin_register_is_idempotent() {
    let s = Scratch::new("plugin-reg-2");
    let f = s.join("ip.json");
    std::fs::write(&f, golden("plugin-register.after.json")).unwrap();
    let before = std::fs::read(&f).unwrap();
    let out = run_ok(&[
        "plugin-register",
        "--file",
        f.to_str().unwrap(),
        "--key",
        "skill-creator@claude-plugins-official",
        "--install-path",
        "/ip",
        "--message",
        "msg",
        "--now",
        "OTHER",
    ]);
    assert!(out.stdout.is_empty());
    assert_eq!(std::fs::read(&f).unwrap(), before);
}

#[test]
fn embedding_dim_reads_the_vector_length_from_stdin() {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(BIN)
        .arg("embedding-dim")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let body = format!(
        r#"{{"data":[{{"embedding":[{}]}}]}}"#,
        (0..384).map(|_| "0.1").collect::<Vec<_>>().join(",")
    );
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(body.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "384");
}

#[test]
fn embedding_dim_exits_non_zero_on_a_response_without_a_vector() {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(BIN)
        .arg("embedding-dim")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(b"{}").unwrap();
    assert!(!child.wait_with_output().unwrap().status.success());
}
