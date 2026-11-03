//! Direct AQE registration must follow the toolchain gate in both harnesses.
mod common;
use common::*;

#[test]
fn enabled_repairs_stale_executable_and_disabled_removes_only_aqe() {
    let scratch = Scratch::new("aqe-cutover");
    let file = scratch.join("mcp.json");
    std::fs::write(&file, r#"{"mcpServers":{"other":{"command":"keep"},"agentic-qe":{"command":"/nix/store/retired/aqe","args":["old"],"type":"http","url":"http://stale","env":{"CUSTOM":"preserved"}}}}"#).unwrap();
    run_ok(&[
        "mcp-reconcile-aqe",
        "--file",
        file.to_str().unwrap(),
        "--provider",
        "claude-code",
    ]);
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let qe = &value["mcpServers"]["agentic-qe"];
    assert_eq!(qe["command"], "aqe");
    assert_eq!(qe["args"], serde_json::json!(["mcp"]));
    assert_eq!(qe["type"], "stdio");
    assert!(qe.get("url").is_none());
    assert_eq!(qe["env"]["AQE_MEMORY_BACKEND"], "memory");
    assert_eq!(qe["env"]["AQE_WORKERS_ENABLED"], "false");
    assert_eq!(qe["env"]["AQE_EMBEDDER_ENDPOINT"], "");
    assert_eq!(qe["env"]["AQE_EMBEDDER_TOKEN"], "");
    assert_eq!(qe["env"]["AQE_LLM_PROVIDER"], "claude-code");
    run_ok(&[
        "mcp-reconcile-aqe",
        "--file",
        file.to_str().unwrap(),
        "--disabled",
    ]);
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert!(value["mcpServers"].get("agentic-qe").is_none());
    assert_eq!(value["mcpServers"]["other"]["command"], "keep");
}

#[test]
fn codex_gets_direct_tools_and_keeps_unrelated_config() {
    let scratch = Scratch::new("aqe-codex");
    let file = scratch.join("config.toml");
    std::fs::write(
        &file,
        "model = 'existing-model'\n[mcp_servers.agentbox-memory]\ncommand = 'memory-server'\n",
    )
    .unwrap();
    let args = [
        "mcp-reconcile-aqe",
        "--codex",
        "--file",
        file.to_str().unwrap(),
    ];
    run_ok(&args);
    let value: toml::Value = toml::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(value["model"].as_str(), Some("existing-model"));
    assert_eq!(
        value["mcp_servers"]["agentbox-memory"]["command"].as_str(),
        Some("memory-server")
    );
    assert_eq!(
        value["mcp_servers"]["agentic-qe"]["command"].as_str(),
        Some("aqe")
    );
    assert_eq!(
        value["mcp_servers"]["agentic-qe"]["env"]["AQE_MEMORY_BACKEND"].as_str(),
        Some("memory")
    );
    run_ok(&[
        "mcp-reconcile-aqe",
        "--codex",
        "--file",
        file.to_str().unwrap(),
        "--disabled",
    ]);
    let value: toml::Value = toml::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert!(value["mcp_servers"].get("agentic-qe").is_none());
    assert_eq!(value["model"].as_str(), Some("existing-model"));
    std::fs::write(&file, "malformed = [").unwrap();
    assert!(!run(&args).status.success());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "malformed = [");
}

#[test]
fn malformed_json_server_maps_are_preserved() {
    let scratch = Scratch::new("aqe-invalid");
    let file = scratch.join("mcp.json");
    for text in ["[]", r#"{"mcpServers":[]}"#, "not-json"] {
        std::fs::write(&file, text).unwrap();
        assert!(
            !run(&["mcp-reconcile-aqe", "--file", file.to_str().unwrap()])
                .status
                .success()
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), text);
    }
}

#[test]
fn codex_retains_comments_and_unmanaged_aqe_policy() {
    let scratch = Scratch::new("aqe-codex-preserve");
    let file = scratch.join("config.toml");
    let before = "# operator rationale\nmodel = 'existing-model' # exact spelling\n\n[mcp_servers.agentic-qe] # QE tools\ncommand = 'old' # managed transport\ntool_timeout_sec = 120 # operator deadline\nstartup_timeout_sec = 90\nrequired = true\nenabled_tools = ['bounded-tool']\n[mcp_servers.agentic-qe.env]\nCUSTOM = 'retain' # operator environment\nAQE_MEMORY_BACKEND = 'sqlite' # host-managed memory\n";
    std::fs::write(&file, before).unwrap();
    let args = [
        "mcp-reconcile-aqe",
        "--codex",
        "--file",
        file.to_str().unwrap(),
    ];
    run_ok(&args);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.starts_with("# operator rationale\nmodel = 'existing-model' # exact spelling\n"));
    for comment in [
        "# QE tools",
        "# managed transport",
        "# operator deadline",
        "# operator environment",
        "# host-managed memory",
    ] {
        assert!(text.contains(comment), "lost {comment}");
    }
    let parsed: toml::Value = toml::from_str(&text).unwrap();
    let qe = &parsed["mcp_servers"]["agentic-qe"];
    assert_eq!(qe["tool_timeout_sec"].as_integer(), Some(120));
    assert_eq!(qe["startup_timeout_sec"].as_integer(), Some(90));
    assert_eq!(qe["required"].as_bool(), Some(true));
    assert_eq!(qe["enabled_tools"][0].as_str(), Some("bounded-tool"));
    assert_eq!(qe["env"]["CUSTOM"].as_str(), Some("retain"));
    assert_eq!(qe["env"]["AQE_MEMORY_BACKEND"].as_str(), Some("memory"));
    run_ok(&args);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        text,
        "second projection is byte-idempotent"
    );
}

#[test]
fn codex_inline_tables_keep_custom_values_and_invalid_env_is_preserved() {
    let scratch = Scratch::new("aqe-codex-inline");
    let file = scratch.join("config.toml");
    std::fs::write(&file, "# inline operator config\nmcp_servers = { agentic-qe = { command = 'old', env = { CUSTOM = 'retain' }, tool_timeout_sec = 120 }, other = { command = 'keep' } }\n").unwrap();
    let args = [
        "mcp-reconcile-aqe",
        "--codex",
        "--file",
        file.to_str().unwrap(),
    ];
    run_ok(&args);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.starts_with("# inline operator config"));
    let parsed: toml::Value = toml::from_str(&text).unwrap();
    assert_eq!(
        parsed["mcp_servers"]["agentic-qe"]["env"]["CUSTOM"].as_str(),
        Some("retain")
    );
    assert_eq!(
        parsed["mcp_servers"]["other"]["command"].as_str(),
        Some("keep")
    );
    let invalid = "[mcp_servers.agentic-qe]\ncommand = 'old'\nenv = 'invalid'\n";
    std::fs::write(&file, invalid).unwrap();
    assert!(!run(&args).status.success());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), invalid);
}
