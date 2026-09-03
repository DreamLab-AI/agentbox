//! `nostr-pod-bridge session-summary` — the SessionEnd hook that mirrors a
//! curated session digest to the operator's phone.
//!
//! Port of `config/hooks/nostr-session-summary.py`, the egress half of the Nostr
//! mobile bridge (the replacement for the retired Telegram/CTM mirror). On
//! SessionEnd it:
//!
//!   1. reads the session transcript Claude Code points us at,
//!   2. asks the **Z.AI / GLM** provider (the endpoint the `zai` consultant
//!      uses — ADR-011) to distil it into a curated digest: a short summary, the
//!      concrete actions, and the actionable questions — *not* the transcript,
//!   3. signs the kind-30840, dual-writes it to the Solid pod, and publishes it
//!      to the embedded relay for the live phone view.
//!
//! Step 3 used to be a `subprocess` hop into `nostr-pod-bridge summarise`. Now
//! that the hook *is* the bridge, it calls [`publish_session_summary`] directly:
//! one process, one key load, and the digest never crosses a pipe. The
//! `summarise` subcommand remains for external producers (see `main.rs`).
//!
//! ## Contract
//!
//! argv `session-summary`, the Claude Code hook payload as JSON on stdin,
//! nothing on stdout, diagnostics on stderr, and **always exit 0** — a missing
//! key, unreachable endpoint, or malformed transcript must never block session
//! teardown.
//!
//! ## Gating
//!
//! The hook self-disables (silent success) unless the bridge secrets and a Z.AI
//! key are present, so profiles without the mobile bridge configured do nothing.
//!
//! ## Privacy
//!
//! The transcript is sent to the Z.AI endpoint for summarisation — the one
//! external hop on this path. Operators under a strict outbound privacy policy
//! should leave `[sovereign_mesh.mobile_bridge]` disabled (the hook is not
//! registered then) or point `ZAI_URL` at a local GLM endpoint.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::envmap::EnvMap;
use crate::{publish_session_summary, BridgeConfig, SessionSummary};

/// Transcript turns past this many characters are trimmed (head + tail kept) so
/// the Z.AI prompt stays cheap regardless of how long the session ran.
pub const MAX_TRANSCRIPT_CHARS: usize = 50_000;
/// How much of the head is preserved when trimming.
pub const HEAD_CHARS: usize = 15_000;

/// Upper bound on the Z.AI summarisation call.
pub const ZAI_TIMEOUT: Duration = Duration::from_secs(180);

/// Default Z.AI base URL when `ZAI_URL` is unset.
const DEFAULT_ZAI_BASE: &str = "https://api.z.ai/api/paas/v4";
/// Default digest model when `AGENTBOX_ZAI_MODEL` is unset.
const DEFAULT_ZAI_MODEL: &str = "glm-5.3";

const SUMMARY_SYSTEM: &str = concat!(
    "You distil a coding-assistant session into a curated digest for the ",
    "operator's phone. Output ONLY a single JSON object, no prose, no markdown ",
    "fences. Schema: {\"summary\": string (2-4 sentences, what the session ",
    "accomplished), \"actions\": string[] (concrete changes made or started), ",
    "\"actionable_questions\": string[] (open questions that need an operator ",
    "decision; empty if none)}. Be concise; this is a notification, not a log."
);

fn log(msg: &str) {
    eprintln!("[nostr-session-summary] {msg}");
}

/// True only when every input the publish path requires is present.
///
/// The secret key is satisfied by **either** `AGENTBOX_BRIDGE_SK` or a readable
/// `AGENTBOX_BRIDGE_SK_FILE` (default `/run/secrets/nostr.key`). The Python
/// original only checked the env var, which SEC-003 deliberately scrubs before
/// `exec supervisord` — so post-SEC-003 the hook self-disabled in every real
/// container and the phone mirror never fired. Accepting the key file restores
/// the intended behaviour; the gate is otherwise unchanged.
pub fn bridge_configured(env: &EnvMap) -> bool {
    let sk_available = env.non_empty("AGENTBOX_BRIDGE_SK").is_some() || {
        let path = env.or("AGENTBOX_BRIDGE_SK_FILE", "/run/secrets/nostr.key");
        Path::new(&path).is_file()
    };
    sk_available
        && [
            "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
            "AGENTBOX_POD_ROOT",
            "AGENTBOX_ADMIN_PUBKEY",
        ]
        .iter()
        .all(|k| env.non_empty(k).is_some())
}

/// The Z.AI API key, from either accepted variable name.
pub fn zai_api_key(env: &EnvMap) -> &str {
    env.first(&["ZAI_ANTHROPIC_API_KEY", "ZAI_API_KEY"])
}

// ── Transcript flattening ────────────────────────────────────────────────────

/// Pull human-readable text out of a message's `content` (a string, or a list of
/// blocks of which only `type: "text"` and bare strings contribute).
pub fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(blocks)) => {
            let parts: Vec<&str> = blocks
                .iter()
                .filter_map(|block| match block {
                    Value::String(s) => Some(s.as_str()),
                    Value::Object(o) if o.get("type") == Some(&json!("text")) => {
                        o.get("text").and_then(Value::as_str)
                    }
                    _ => None,
                })
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .collect();
            parts.join(" ").trim().to_string()
        }
        _ => String::new(),
    }
}

/// Trim a flattened transcript to `max_chars`, keeping `head_chars` of the head
/// and the remainder from the tail with an explicit marker between them.
fn trim_transcript(joined: String, max_chars: usize, head_chars: usize) -> String {
    if joined.chars().count() <= max_chars {
        return joined;
    }
    let chars: Vec<char> = joined.chars().collect();
    let tail = max_chars.saturating_sub(head_chars);
    let head: String = chars[..head_chars.min(chars.len())].iter().collect();
    let tail: String = chars[chars.len().saturating_sub(tail)..].iter().collect();
    format!("{head}\n\n...[transcript trimmed]...\n\n{tail}")
}

/// Flatten a Claude Code JSONL transcript to compact `ROLE: text` turns.
///
/// Every kind of noise the format admits is skipped silently: blank lines,
/// unparseable lines, records with no `message` object, roles other than
/// user/assistant, and turns whose content flattens to nothing.
pub fn extract_transcript_with(path: &Path, max_chars: usize, head_chars: usize) -> Result<String> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading transcript {}", path.display()))?;
    let turns: Vec<String> = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|rec| {
            let message = rec.get("message")?.as_object()?.clone();
            let role = message.get("role")?.as_str()?.to_string();
            if role != "user" && role != "assistant" {
                return None;
            }
            let text = content_text(message.get("content"));
            (!text.is_empty()).then(|| format!("{}: {text}", role.to_uppercase()))
        })
        .collect();
    Ok(trim_transcript(turns.join("\n\n"), max_chars, head_chars))
}

/// [`extract_transcript_with`] at the production limits.
pub fn extract_transcript(path: &Path) -> Result<String> {
    extract_transcript_with(path, MAX_TRANSCRIPT_CHARS, HEAD_CHARS)
}

// ── Z.AI digest ──────────────────────────────────────────────────────────────

/// Concatenate the `text` blocks of an Anthropic-shaped response body.
pub fn anthropic_text(body: &Value) -> String {
    let Some(blocks) = body.get("content").and_then(Value::as_array) else {
        return String::new();
    };
    blocks
        .iter()
        .filter(|b| b.get("type") == Some(&json!("text")))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<String>()
        .trim()
        .to_string()
}

/// Best-effort extraction of the first JSON object from model output.
///
/// Handles a fenced block (```json … ``` or a bare ``` … ```) and prose either
/// side of the object; anything trailing the first complete value is ignored,
/// exactly as CPython's `JSONDecoder.raw_decode` does.
pub fn parse_json_object(text: &str) -> Result<Map<String, Value>> {
    let mut text = text.trim();
    if let Some(rest) = text.strip_prefix("```") {
        // CPython: text.split("```", 2)[1] — the span between the first two
        // fences, with an optional `json` language tag stripped off the front.
        let body = rest.split("```").next().unwrap_or("");
        text = body.strip_prefix("json").unwrap_or(body).trim();
    }
    let start = text
        .find('{')
        .ok_or_else(|| anyhow!("no JSON object in Z.AI response"))?;
    let value: Value = serde_json::Deserializer::from_str(&text[start..])
        .into_iter::<Value>()
        .next()
        .ok_or_else(|| anyhow!("no JSON object in Z.AI response"))?
        .context("no JSON object in Z.AI response")?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(anyhow!("Z.AI response top-level is not an object")),
    }
}

/// The fully resolved Z.AI request this hook issues, split out so the URL,
/// model, and header construction are testable without a network round trip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZaiRequest {
    pub url: String,
    pub api_key: String,
    pub body: Value,
}

/// Build the Z.AI `/v1/messages` request for `transcript`.
pub fn build_zai_request(env: &EnvMap, transcript: &str) -> ZaiRequest {
    let base = env.first(&["ZAI_URL"]).trim_end_matches('/').to_string();
    let base = if base.is_empty() {
        DEFAULT_ZAI_BASE.to_string()
    } else {
        base
    };
    ZaiRequest {
        url: format!("{base}/v1/messages"),
        api_key: zai_api_key(env).to_string(),
        body: json!({
            "model": env.or("AGENTBOX_ZAI_MODEL", DEFAULT_ZAI_MODEL),
            "max_tokens": 1500,
            "system": SUMMARY_SYSTEM,
            "messages": [{"role": "user", "content": transcript}],
        }),
    }
}

/// Ask Z.AI to distil `transcript` into a digest object.
pub async fn summarise_via_zai(env: &EnvMap, transcript: &str) -> Result<Map<String, Value>> {
    let req = build_zai_request(env, transcript);
    let client = reqwest::Client::builder()
        .timeout(ZAI_TIMEOUT)
        .build()
        .context("building the Z.AI HTTP client")?;
    let response = client
        .post(&req.url)
        .header("content-type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", &req.api_key)
        .header("authorization", format!("Bearer {}", req.api_key))
        .json(&req.body)
        .send()
        .await
        .with_context(|| format!("POST {}", req.url))?
        .error_for_status()
        .context("Z.AI returned an error status")?;
    let body: Value = response.json().await.context("parsing the Z.AI response")?;
    parse_json_object(&anthropic_text(&body))
}

// ── Provenance ───────────────────────────────────────────────────────────────

/// BIP-340 x-only pubkey hex for the activity URN scope, using the same
/// precedence the live mirror (`config/hooks/nostr-live-mirror.cjs`) applies, so
/// the SessionEnd digest and the per-turn stream mint the IDENTICAL
/// `urn:agentbox:activity` reference for a session. Falls back to the all-zero
/// dev pubkey.
fn activity_scope_pubkey(env: &EnvMap) -> String {
    let mut candidate = env
        .first(&[
            "AGENTBOX_AGENT_PUBKEY",
            "AGENTBOX_PUBKEY",
            "AGENTBOX_ADMIN_PUBKEY",
        ])
        .to_string();
    if candidate.is_empty() {
        let did = env.first(&["AGENTBOX_AGENT_DID", "AGENTBOX_DID"]);
        candidate = did.strip_prefix("did:nostr:").unwrap_or("").to_string();
    }
    let lc = candidate.to_lowercase();
    if lc.len() == 64 && lc.bytes().all(|c| c.is_ascii_hexdigit()) {
        lc
    } else {
        "0".repeat(64)
    }
}

/// Mint the session's `urn:agentbox:activity` provenance reference (REC-9,
/// PRD-019 / ADR-037 D5) so the digest carries the SAME reference the live
/// mirror embeds. Byte-identical to the canonical minter
/// `management-api/lib/uris.js` (ADR-013): content-address the sorted, minified
/// JSON of `{surface, session_id}` with SHA-256 and take the first 12 hex chars.
///
/// Fail-open: returns `None` when there is no session id.
pub fn mint_activity_urn(env: &EnvMap, session_id: &str) -> Option<String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return None;
    }
    // Sorted keys, no whitespace — matching json.dumps(sort_keys=True,
    // separators=(",", ":")). Both values are plain strings, so serde_json's
    // escaping already matches CPython's for this payload.
    let canon = format!(
        "{{\"session_id\":{},\"surface\":\"session\"}}",
        Value::String(sid.to_string())
    );
    let digest = hex::encode(Sha256::digest(canon.as_bytes()));
    Some(format!(
        "urn:agentbox:activity:{}:sha256-12-{}",
        activity_scope_pubkey(env),
        &digest[..12]
    ))
}

// ── Orchestration ────────────────────────────────────────────────────────────

/// Assemble the digest published as the kind-30840, applying the defaults the
/// Python original applied: the hook's session id is authoritative, and the
/// three digest fields always exist even when the model omitted them.
pub fn build_digest(
    env: &EnvMap,
    mut digest: Map<String, Value>,
    session_id: &str,
) -> Result<SessionSummary> {
    digest.insert("session_id".into(), json!(session_id));
    digest.entry("summary").or_insert_with(|| json!(""));
    digest.entry("actions").or_insert_with(|| json!([]));
    digest
        .entry("actionable_questions")
        .or_insert_with(|| json!([]));
    if let Some(urn) = mint_activity_urn(env, session_id) {
        digest.insert("activity_urn".into(), json!(urn));
    }
    serde_json::from_value(Value::Object(digest)).context("assembling the session digest")
}

/// The work `run` performs once every gate has passed. Separated so the gating
/// and the failure-swallowing in [`run`] stay legible.
async fn mirror(env: &EnvMap, session_id: &str, transcript_path: &Path) -> Result<bool> {
    let transcript = extract_transcript(transcript_path)?;
    if transcript.trim().is_empty() {
        return Ok(false);
    }
    let digest = summarise_via_zai(env, &transcript).await?;
    let summary = build_digest(env, digest, session_id)?;
    let cfg = BridgeConfig::from_env(env)?;
    publish_session_summary(&cfg, &summary).await?;
    Ok(true)
}

/// `nostr-pod-bridge session-summary` — read the hook payload from `stdin` and
/// mirror the session. Always returns `Ok(())`: every failure is logged and
/// swallowed so session teardown is never blocked.
pub async fn run(env: &EnvMap, stdin: &str) -> Result<()> {
    let Ok(payload) = serde_json::from_str::<Value>(stdin) else {
        return Ok(()); // no hook payload; nothing to do
    };

    if !bridge_configured(env) {
        return Ok(()); // mobile bridge not configured for this profile
    }
    if zai_api_key(env).is_empty() {
        log("Z.AI key not set; skipping session summary");
        return Ok(());
    }

    let session_id = payload
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("unknown");
    let transcript_path = payload.get("transcript_path").and_then(Value::as_str);
    let Some(path) = transcript_path.map(Path::new).filter(|p| p.exists()) else {
        log("no transcript path in hook payload; skipping");
        return Ok(());
    };

    match mirror(env, session_id, path).await {
        Ok(true) => log(&format!("session {session_id} mirrored to phone")),
        Ok(false) => {}
        Err(e) => log(&format!("session summary failed (non-fatal): {e:#}")),
    }
    Ok(())
}
