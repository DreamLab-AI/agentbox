//! End-to-end: run the built binary against a mock façade.
//!
//! The unit tests cover parsing; this covers the thing that actually ships —
//! argument handling, the request that goes on the wire, and the files written.

use std::process::Command;
use std::time::Duration;

use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn bin() -> std::path::PathBuf {
    // target/debug/deps/<test> -> target/debug/<bin>
    let mut p = std::env::current_exe().expect("test binary path");
    p.pop();
    if p.ends_with("deps") {
        p.pop();
    }
    p.join("explainer-loom-draft")
}

/// A façade that advertises a model and answers with `content`.
async fn facade(content: &str, served_mode: &str) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "data": [{ "id": "test-model" }] })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "test-model",
            "choices": [{ "finish_reason": "stop", "message": { "content": content } }],
            "usage": { "prompt_tokens": 5, "completion_tokens": 9 },
            "loom": { "served_mode": served_mode }
        })))
        .mount(&server)
        .await;
    server
}

struct Fixture {
    _dir: tempfile::TempDir,
    packet: std::path::PathBuf,
    system: std::path::PathBuf,
    template: std::path::PathBuf,
    out: std::path::PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path();
    std::fs::write(p.join("packet.json"), r#"{"section":"Overview"}"#).unwrap();
    std::fs::write(p.join("system.txt"), "You are a drafting assistant.").unwrap();
    std::fs::write(p.join("template.txt"), "Packet: {{evidence_packet}}").unwrap();
    Fixture {
        packet: p.join("packet.json"),
        system: p.join("system.txt"),
        template: p.join("template.txt"),
        out: p.join("packet.out.json"),
        _dir: dir,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn drafts_a_packet_and_writes_result_and_receipt() {
    let good = r#"{"status":"draft","reader_text":"The system does X.","claims":[{"id":"c1"}]}"#;
    let server = facade(good, "passthrough").await;
    let f = fixture();

    let out = tokio::task::spawn_blocking({
        let (bin, base) = (bin(), format!("{}/v1", server.uri()));
        let (packet, system, template) =
            (f.packet.clone(), f.system.clone(), f.template.clone());
        move || {
            Command::new(bin)
                .args(["--packet", packet.to_str().unwrap()])
                .args(["--system", system.to_str().unwrap()])
                .args(["--template", template.to_str().unwrap()])
                .args(["--base", &base])
                .output()
                .expect("run binary")
        }
    })
    .await
    .unwrap();

    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let written: Value =
        serde_json::from_str(&std::fs::read_to_string(&f.out).expect("output written")).unwrap();
    assert_eq!(written["result"]["status"], "draft");
    assert_eq!(written["result"]["reader_text"], "The system does X.");
    assert_eq!(written["receipt"]["served_mode"], "passthrough");
    assert_eq!(written["receipt"]["completion_tokens"], 9);
    assert_eq!(written["receipt"]["attempt"], 1);

    // The request must have declined the scaffold: the subject is a codebase.
    let sent: Value = server.received_requests().await.unwrap()
        .iter()
        .find(|r| r.url.path().ends_with("/chat/completions"))
        .expect("a chat request")
        .body_json()
        .unwrap();
    assert_eq!(sent["loom_options"], json!({ "verbatim": false, "scaffold": false }));
    assert_eq!(sent["chat_template_kwargs"]["enable_thinking"], false);
    assert_eq!(sent["model"], "test-model", "--model auto resolved from /models");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_facade_that_grounded_the_request_anyway_fails_the_draft() {
    // ADR-139: grounding a codebase question yields an answer about the wrong
    // subject. Better no file than a confidently wrong section.
    let good = r#"{"status":"draft","reader_text":"about blockchain Nodes","claims":[]}"#;
    let server = facade(good, "grounded").await;
    let f = fixture();

    let out = tokio::task::spawn_blocking({
        let (bin, base) = (bin(), format!("{}/v1", server.uri()));
        let (packet, system, template) =
            (f.packet.clone(), f.system.clone(), f.template.clone());
        move || {
            Command::new(bin)
                .args(["--packet", packet.to_str().unwrap()])
                .args(["--system", system.to_str().unwrap()])
                .args(["--template", template.to_str().unwrap()])
                .args(["--base", &base])
                .output()
                .expect("run binary")
        }
    })
    .await
    .unwrap();

    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("did not pass the request through"), "stderr: {stderr}");
    assert!(!f.out.exists(), "no draft file should be written");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unparsable_answer_saves_the_raw_body_for_diagnosis() {
    let server = facade("I'd rather write prose than JSON.", "passthrough").await;
    let f = fixture();

    let out = tokio::task::spawn_blocking({
        let (bin, base) = (bin(), format!("{}/v1", server.uri()));
        let (packet, system, template) =
            (f.packet.clone(), f.system.clone(), f.template.clone());
        move || {
            Command::new(bin)
                .args(["--packet", packet.to_str().unwrap()])
                .args(["--system", system.to_str().unwrap()])
                .args(["--template", template.to_str().unwrap()])
                .args(["--base", &base])
                .output()
                .expect("run binary")
        }
    })
    .await
    .unwrap();

    assert!(!out.status.success());
    let raw = f.out.with_extension("raw.json");
    assert!(raw.exists(), "raw body must be kept: a bad prompt is fixed by reading it");
    let body: Value = serde_json::from_str(&std::fs::read_to_string(raw).unwrap()).unwrap();
    assert_eq!(body["choices"][0]["message"]["content"], "I'd rather write prose than JSON.");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_batch_skips_packets_that_already_have_output() {
    let good = r#"{"status":"draft","reader_text":"t","claims":[]}"#;
    let server = facade(good, "passthrough").await;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    std::fs::write(p.join("a.json"), "{}").unwrap();
    std::fs::write(p.join("b.json"), "{}").unwrap();
    std::fs::write(p.join("system.txt"), "sys").unwrap();
    std::fs::write(p.join("template.txt"), "{{evidence_packet}}").unwrap();
    let drafts = p.join("drafts");
    std::fs::create_dir_all(&drafts).unwrap();
    // `a` is already done from an interrupted run.
    std::fs::write(drafts.join("a.out.json"), "{}").unwrap();

    let out = tokio::task::spawn_blocking({
        let (bin, base) = (bin(), format!("{}/v1", server.uri()));
        let p = p.to_path_buf();
        move || {
            Command::new(bin)
                .args(["--batch", p.to_str().unwrap()])
                .args(["--system", p.join("system.txt").to_str().unwrap()])
                .args(["--template", p.join("template.txt").to_str().unwrap()])
                .args(["--base", &base])
                .output()
                .expect("run binary")
        }
    })
    .await
    .unwrap();

    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("a.json: exists, skipped"), "stdout: {stdout}");
    assert!(stdout.contains("batch complete: 1 drafted, 0 failed"), "stdout: {stdout}");
    assert!(drafts.join("b.out.json").exists());
    // Only `b` was drafted; `a` cost nothing.
    let chats = server.received_requests().await.unwrap()
        .iter()
        .filter(|r| r.url.path().ends_with("/chat/completions"))
        .count();
    assert_eq!(chats, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unresolved_template_field_fails_before_spending_a_call() {
    let server = facade("{}", "passthrough").await;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    std::fs::write(p.join("packet.json"), "{}").unwrap();
    std::fs::write(p.join("system.txt"), "sys").unwrap();
    std::fs::write(p.join("template.txt"), "{{evidence_packet}} {{chapter_title}}").unwrap();

    let out = tokio::task::spawn_blocking({
        let (bin, base) = (bin(), format!("{}/v1", server.uri()));
        let p = p.to_path_buf();
        move || {
            Command::new(bin)
                .args(["--packet", p.join("packet.json").to_str().unwrap()])
                .args(["--system", p.join("system.txt").to_str().unwrap()])
                .args(["--template", p.join("template.txt").to_str().unwrap()])
                .args(["--base", &base])
                .output()
                .expect("run binary")
        }
    })
    .await
    .unwrap();

    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("{{chapter_title}}"), "stderr: {stderr}");
    let chats = server.received_requests().await.unwrap()
        .iter()
        .filter(|r| r.url.path().ends_with("/chat/completions"))
        .count();
    assert_eq!(chats, 0, "a 15-minute call must not be spent on a broken prompt");
}

#[tokio::test(flavor = "multi_thread")]
async fn timeout_flag_is_accepted() {
    // Guards the CLI surface the skill documents.
    let out = tokio::task::spawn_blocking(|| {
        Command::new(bin()).arg("--help").output().expect("run binary")
    })
    .await
    .unwrap();
    let help = String::from_utf8_lossy(&out.stdout);
    for flag in ["--packet", "--batch", "--out-dir", "--base", "--model", "--max-tokens",
                 "--system", "--template", "--review", "--timeout"] {
        assert!(help.contains(flag), "--help omits {flag}");
    }
    let _ = Duration::from_secs(1);
}
