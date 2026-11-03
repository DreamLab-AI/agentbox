//! Malformed but parseable user configurations must not be replaced.
mod common;
use common::*;
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn set_server_refuses_non_object_config_without_losing_bytes() {
    let scratch = Scratch::new("mcp-set-shape");
    let file = scratch.join("config.json");
    for text in [
        "[]",
        r#"{"mcpServers":[],"operator":"retain"}"#,
        r#"{"mcpServers":null}"#,
    ] {
        std::fs::write(&file, text).unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_agentbox-manifest"))
            .args([
                "mcp-set-server",
                "--file",
                file.to_str().unwrap(),
                "--name",
                "fixture",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"command":"keep"}"#)
            .unwrap();
        assert!(!child.wait_with_output().unwrap().status.success());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), text);
    }
}

#[test]
fn mirror_refuses_non_object_destination_without_losing_bytes() {
    let scratch = Scratch::new("mcp-mirror-shape");
    let from = scratch.join("source.json");
    let to = scratch.join("destination.json");
    std::fs::write(&from, r#"{"mcpServers":{"fixture":{"command":"keep"}}}"#).unwrap();
    for text in [
        "[]",
        r#"{"mcpServers":[],"operator":"retain"}"#,
        r#"{"mcpServers":null}"#,
    ] {
        std::fs::write(&to, text).unwrap();
        assert!(!run(&[
            "mcp-mirror-server",
            "--from",
            from.to_str().unwrap(),
            "--to",
            to.to_str().unwrap(),
            "--name",
            "fixture"
        ])
        .status
        .success());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), text);
    }
}
