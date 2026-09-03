//! Coverage for `nostr_pod_bridge::session_summary` — the SessionEnd digest hook.
//!
//! Direct port of `tests/sovereign/test_nostr_session_summary.py`. The crypto and
//! signing live in `publish_session_summary` (covered by the lib's own unit
//! tests); these cases own the glue that Rust does not get for free: env gating,
//! transcript flattening, Z.AI request construction and robust JSON extraction,
//! digest defaulting, and the best-effort orchestration that must never block
//! session teardown.
//!
//! Groups mirror the Python suite: A gating, B/C transcript, D/E model output,
//! F request construction, G digest assembly, H orchestration.

use nostr_pod_bridge::envmap::EnvMap;
use nostr_pod_bridge::session_summary::*;
use serde_json::{json, Map, Value};
use std::path::Path;

const SK: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn required_env() -> Vec<(String, String)> {
    [
        ("AGENTBOX_BRIDGE_SK", SK),
        ("AGENTBOX_BRIDGE_RECIPIENT_PUBKEY", &"a".repeat(64)),
        ("AGENTBOX_POD_ROOT", "/var/lib/solid/pods"),
        ("AGENTBOX_ADMIN_PUBKEY", &"b".repeat(64)),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn env_with(extra: &[(&str, &str)]) -> EnvMap {
    let mut pairs = required_env();
    pairs.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    EnvMap::from_iter(pairs)
}

fn write_jsonl(dir: &Path, records: &[Value]) -> std::path::PathBuf {
    let path = dir.join("transcript.jsonl");
    let body: String = records
        .iter()
        .map(|r| format!("{}\n", serde_json::to_string(r).unwrap()))
        .collect();
    std::fs::write(&path, body).unwrap();
    path
}

// ═══ A. bridge_configured — admin/env gating ════════════════════════════

#[test]
fn bridge_configured_true_when_all_present() {
    assert!(bridge_configured(&env_with(&[])));
}

#[test]
fn bridge_configured_false_when_any_is_missing() {
    for missing in [
        "AGENTBOX_BRIDGE_SK",
        "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
        "AGENTBOX_POD_ROOT",
        "AGENTBOX_ADMIN_PUBKEY",
    ] {
        let env: EnvMap = required_env()
            .into_iter()
            .filter(|(k, _)| k != missing)
            // Point the SK file at a path that cannot exist so dropping the
            // env var genuinely removes the key.
            .chain([(
                "AGENTBOX_BRIDGE_SK_FILE".to_string(),
                "/nonexistent/nostr.key".to_string(),
            )])
            .collect();
        assert!(!bridge_configured(&env), "{missing} should have gated");
    }
}

#[test]
fn bridge_configured_treats_empty_string_as_unset() {
    let env = env_with(&[
        ("AGENTBOX_ADMIN_PUBKEY", ""),
        ("AGENTBOX_BRIDGE_SK_FILE", "/nonexistent/nostr.key"),
    ]);
    assert!(!bridge_configured(&env));
}

#[test]
fn bridge_configured_accepts_the_sec003_key_file_without_the_env_var() {
    let dir = tempfile::tempdir().unwrap();
    let key_file = dir.path().join("nostr.key");
    std::fs::write(&key_file, SK).unwrap();
    let env: EnvMap = required_env()
        .into_iter()
        .filter(|(k, _)| k != "AGENTBOX_BRIDGE_SK")
        .chain([(
            "AGENTBOX_BRIDGE_SK_FILE".to_string(),
            key_file.display().to_string(),
        )])
        .collect();
    assert!(bridge_configured(&env));
}

#[test]
fn zai_key_falls_back_between_both_names() {
    let env = env_with(&[("ZAI_ANTHROPIC_API_KEY", ""), ("ZAI_API_KEY", "fallback")]);
    assert_eq!(zai_api_key(&env), "fallback");
    assert_eq!(zai_api_key(&env_with(&[])), "");
}

// ═══ B. content_text ════════════════════════════════════════════════════

#[test]
fn content_text_plain_string() {
    assert_eq!(content_text(Some(&json!("  hello world  "))), "hello world");
}

#[test]
fn content_text_text_blocks_concatenated() {
    let content = json!([
        {"type": "text", "text": "first"},
        {"type": "tool_use", "name": "Edit"},
        {"type": "text", "text": "second"},
    ]);
    assert_eq!(content_text(Some(&content)), "first second");
}

#[test]
fn content_text_bare_strings_in_list() {
    assert_eq!(content_text(Some(&json!(["a", "b"]))), "a b");
}

#[test]
fn content_text_non_list_non_string_is_empty() {
    assert_eq!(
        content_text(Some(&json!({"type": "text", "text": "x"}))),
        ""
    );
    assert_eq!(content_text(Some(&Value::Null)), "");
    assert_eq!(content_text(None), "");
}

// ═══ C. extract_transcript ══════════════════════════════════════════════

#[test]
fn extract_transcript_flattens_user_and_assistant() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_jsonl(
        dir.path(),
        &[
            json!({"message": {"role": "user", "content": "fix the bug"}}),
            json!({"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}}),
        ],
    );
    assert_eq!(
        extract_transcript(&path).unwrap(),
        "USER: fix the bug\n\nASSISTANT: done"
    );
}

#[test]
fn extract_transcript_skips_noise() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.jsonl");
    std::fs::write(
        &path,
        concat!(
            "\n",
            "not json at all\n",
            "{\"no_message\": true}\n",
            "{\"message\": {\"role\": \"system\", \"content\": \"x\"}}\n",
            "{\"message\": {\"role\": \"user\", \"content\": \"\"}}\n",
            "{\"message\": {\"role\": \"user\", \"content\": \"kept\"}}\n",
        ),
    )
    .unwrap();
    assert_eq!(extract_transcript(&path).unwrap(), "USER: kept");
}

#[test]
fn extract_transcript_trims_long_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let big = "A".repeat(500);
    let path = write_jsonl(
        dir.path(),
        &[json!({"message": {"role": "user", "content": big}})],
    );
    let out = extract_transcript_with(&path, 200, 60).unwrap();
    assert!(out.contains("...[transcript trimmed]..."));
    assert!(out.chars().count() < 500);
    assert!(out.starts_with("USER: AAA"));
}

#[test]
fn extract_transcript_leaves_short_sessions_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_jsonl(
        dir.path(),
        &[json!({"message": {"role": "user", "content": "hi"}})],
    );
    assert_eq!(extract_transcript_with(&path, 200, 60).unwrap(), "USER: hi");
}

// ═══ D. anthropic_text ══════════════════════════════════════════════════

#[test]
fn anthropic_text_joins_text_blocks() {
    let body = json!({"content": [
        {"type": "text", "text": "part1 "},
        {"type": "thinking", "text": "ignored"},
        {"type": "text", "text": "part2"},
    ]});
    assert_eq!(anthropic_text(&body), "part1 part2");
}

#[test]
fn anthropic_text_empty_when_no_list() {
    assert_eq!(anthropic_text(&json!({"content": "string-not-list"})), "");
    assert_eq!(anthropic_text(&json!({})), "");
}

// ═══ E. parse_json_object ═══════════════════════════════════════════════

#[test]
fn parse_json_object_plain() {
    let got = parse_json_object(r#"{"summary": "ok", "actions": []}"#).unwrap();
    assert_eq!(got["summary"], "ok");
    assert_eq!(got["actions"], json!([]));
}

#[test]
fn parse_json_object_strips_json_fence() {
    let got = parse_json_object("```json\n{\"summary\": \"fenced\"}\n```").unwrap();
    assert_eq!(got["summary"], "fenced");
}

#[test]
fn parse_json_object_strips_bare_fence() {
    let got = parse_json_object("```\n{\"summary\": \"bare\"}\n```").unwrap();
    assert_eq!(got["summary"], "bare");
}

#[test]
fn parse_json_object_ignores_surrounding_prose() {
    let got =
        parse_json_object(r#"Here is your digest: {"summary": "after prose"} hope that helps"#)
            .unwrap();
    assert_eq!(got["summary"], "after prose");
}

#[test]
fn parse_json_object_raises_without_object() {
    let err = parse_json_object("there is nothing structured here").unwrap_err();
    assert!(err.to_string().contains("no JSON object"));
}

#[test]
fn parse_json_object_raises_on_array_only_output() {
    let err = parse_json_object("[1, 2, 3]").unwrap_err();
    assert!(err.to_string().contains("no JSON object"));
}

// ═══ F. build_zai_request — request construction ════════════════════════

#[test]
fn zai_request_collapses_a_trailing_slash_and_appends_v1_messages() {
    let env = env_with(&[
        ("ZAI_URL", "https://glm.local/api/"),
        ("ZAI_ANTHROPIC_API_KEY", "secret-key"),
        ("AGENTBOX_ZAI_MODEL", "glm-5.3"),
    ]);
    let req = build_zai_request(&env, "USER: hi\n\nASSISTANT: done");
    assert_eq!(req.url, "https://glm.local/api/v1/messages");
    assert_eq!(req.api_key, "secret-key");
    assert_eq!(req.body["model"], "glm-5.3");
    assert_eq!(req.body["max_tokens"], 1500);
    assert_eq!(
        req.body["messages"][0]["content"],
        "USER: hi\n\nASSISTANT: done"
    );
    assert!(req.body["system"]
        .as_str()
        .unwrap()
        .contains("curated digest"));
}

#[test]
fn zai_request_defaults_model_and_endpoint() {
    let req = build_zai_request(&env_with(&[("ZAI_API_KEY", "k")]), "transcript");
    assert_eq!(req.url, "https://api.z.ai/api/paas/v4/v1/messages");
    assert_eq!(req.body["model"], "glm-5.3");
}

// ═══ G. build_digest — defaulting and provenance ════════════════════════

#[test]
fn digest_defaults_the_three_fields_and_takes_the_hook_session_id() {
    let mut raw = Map::new();
    raw.insert("summary".into(), json!("did work"));
    raw.insert("session_id".into(), json!("model-invented-id"));
    let s = build_digest(&env_with(&[]), raw, "sess-42").unwrap();
    assert_eq!(s.session_id, "sess-42"); // authoritative id from the hook
    assert_eq!(s.summary, "did work");
    assert!(s.actions.is_empty());
    assert!(s.actionable_questions.is_empty());
}

#[test]
fn digest_preserves_model_supplied_actions() {
    let mut raw = Map::new();
    raw.insert("summary".into(), json!("s"));
    raw.insert("actions".into(), json!(["edited x"]));
    raw.insert("actionable_questions".into(), json!(["ship it?"]));
    let s = build_digest(&env_with(&[]), raw, "sess").unwrap();
    assert_eq!(s.actions, ["edited x"]);
    assert_eq!(s.actionable_questions, ["ship it?"]);
}

#[test]
fn activity_urn_is_scoped_and_content_addressed() {
    let pubkey = "c".repeat(64);
    let env = env_with(&[("AGENTBOX_AGENT_PUBKEY", &pubkey)]);
    let urn = mint_activity_urn(&env, "sess-42").unwrap();
    assert!(urn.starts_with(&format!("urn:agentbox:activity:{pubkey}:sha256-12-")));
    assert_eq!(urn.rsplit("sha256-12-").next().unwrap().len(), 12);
    // Deterministic for the same session, distinct across sessions.
    assert_eq!(urn, mint_activity_urn(&env, "sess-42").unwrap());
    assert_ne!(urn, mint_activity_urn(&env, "sess-43").unwrap());
}

#[test]
fn activity_urn_derives_the_scope_from_a_did_and_falls_back_to_zeroes() {
    // The DID is only consulted when no explicit pubkey variable is set, so the
    // fixture's AGENTBOX_ADMIN_PUBKEY must be absent for this branch to fire.
    let hex = "d".repeat(64);
    let did_only = EnvMap::from_iter([("AGENTBOX_DID", format!("did:nostr:{hex}"))]);
    assert!(mint_activity_urn(&did_only, "s").unwrap().contains(&hex));

    // Explicit pubkey variables outrank the DID, in the live mirror's order.
    let both = EnvMap::from_iter([
        ("AGENTBOX_ADMIN_PUBKEY".to_string(), "b".repeat(64)),
        ("AGENTBOX_DID".to_string(), format!("did:nostr:{hex}")),
    ]);
    assert!(mint_activity_urn(&both, "s")
        .unwrap()
        .contains(&"b".repeat(64)));
    // Nothing usable in the environment ⇒ the all-zero dev pubkey.
    let bare = EnvMap::default();
    assert!(mint_activity_urn(&bare, "s")
        .unwrap()
        .contains(&"0".repeat(64)));
    // A malformed candidate is rejected rather than passed through.
    let bad = EnvMap::from_iter([("AGENTBOX_AGENT_PUBKEY", "not-a-pubkey")]);
    assert!(mint_activity_urn(&bad, "s")
        .unwrap()
        .contains(&"0".repeat(64)));
}

#[test]
fn activity_urn_is_none_without_a_session_id() {
    assert!(mint_activity_urn(&env_with(&[]), "   ").is_none());
}

#[test]
fn digest_carries_the_activity_urn() {
    let env = env_with(&[("AGENTBOX_AGENT_PUBKEY", &"e".repeat(64))]);
    let mut raw = Map::new();
    raw.insert("summary".into(), json!("s"));
    let s = build_digest(&env, raw, "sess").unwrap();
    assert!(s
        .activity_urn
        .unwrap()
        .starts_with("urn:agentbox:activity:"));
}

// ═══ H. run — orchestration (best-effort, never fails) ══════════════════

#[tokio::test]
async fn run_returns_ok_on_invalid_stdin() {
    assert!(run(&env_with(&[]), "not json").await.is_ok());
}

#[tokio::test]
async fn run_short_circuits_when_the_bridge_is_unconfigured() {
    // No ZAI key would also gate, so point ZAI at a key to prove the bridge
    // gate is the one that fires: an unreachable pod root would otherwise
    // surface as a publish error, and this must stay silent.
    let env = EnvMap::from_iter([("ZAI_API_KEY", "k")]);
    let payload = r#"{"session_id": "s", "transcript_path": "/x"}"#;
    assert!(run(&env, payload).await.is_ok());
}

#[tokio::test]
async fn run_short_circuits_without_a_zai_key() {
    let payload = r#"{"session_id": "s", "transcript_path": "/x"}"#;
    assert!(run(&env_with(&[]), payload).await.is_ok());
}

#[tokio::test]
async fn run_short_circuits_on_a_missing_transcript() {
    let env = env_with(&[("ZAI_API_KEY", "k")]);
    let payload = r#"{"session_id": "s", "transcript_path": "/does/not/exist"}"#;
    assert!(run(&env, payload).await.is_ok());
}

#[tokio::test]
async fn run_returns_ok_on_an_empty_transcript() {
    let dir = tempfile::tempdir().unwrap();
    // No user/assistant turns ⇒ nothing to summarise, and crucially no Z.AI
    // call: an unreachable endpoint here would hang the test if we made one.
    let path = write_jsonl(
        dir.path(),
        &[json!({"message": {"role": "tool", "content": "x"}})],
    );
    let env = env_with(&[("ZAI_API_KEY", "k"), ("ZAI_URL", "http://127.0.0.1:1")]);
    let payload = json!({"session_id": "s", "transcript_path": path}).to_string();
    assert!(run(&env, &payload).await.is_ok());
}

#[tokio::test]
async fn run_swallows_an_unreachable_zai_endpoint() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_jsonl(
        dir.path(),
        &[json!({"message": {"role": "user", "content": "x"}})],
    );
    // Port 1 refuses immediately — a fast, deterministic transport failure.
    let env = env_with(&[("ZAI_API_KEY", "k"), ("ZAI_URL", "http://127.0.0.1:1")]);
    let payload = json!({"session_id": "s", "transcript_path": path}).to_string();
    assert!(run(&env, &payload).await.is_ok());
}
