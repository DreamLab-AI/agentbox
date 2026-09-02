//! ExpeL post-task lesson extractor — the logic behind `expel-distil`.
//!
//! Ported from `mcp/expel/distil.py`, which sits on the `claude-flow hooks
//! post-task` hot path and whose stdout is parsed downstream by
//! `management-api/lib/kg-proposal-extractor.js`. Every stdout line is
//! therefore rendered through [`crate::pyjson`] so the bytes match CPython's
//! `json.dumps` exactly.
//!
//! ADR-019 §Mechanism 1, PRD-008 §3.4 / §7 Track B, DDD-005 invariants I08-I12.

use crate::pyjson;
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const LESSONS_NAMESPACE: &str = "code-harness-lessons";
pub const ACTIVITIES_NAMESPACE: &str = "code-harness-activities";
pub const DEFAULT_OUTBOX: &str = "/var/lib/agentbox/code-harness/traces-outbox";

/// PRD-008 C4: no lesson is distilled from fewer than three tool calls.
pub const MIN_TRACES: usize = 3;
/// Record-size cap on the evidence list, and the extraction-prompt window.
pub const TRACE_CAP: usize = 10;

// ---------------------------------------------------------------------------
// Identity (ADR-013 addendum)
// ---------------------------------------------------------------------------

/// Resolves the agent DID: explicit override, then `AGENTBOX_AGENT_DID`, then
/// `AGENTBOX_AGENT_PUBKEY`, then the documented dev-mode fallback.
pub fn resolve_did(override_did: &str, env_did: &str, env_pubkey: &str) -> String {
    if !override_did.is_empty() {
        return override_did.to_string();
    }
    if !env_did.is_empty() {
        return env_did.to_string();
    }
    if !env_pubkey.is_empty() {
        return format!("did:nostr:{env_pubkey}");
    }
    "did:nostr:local".to_string()
}

/// The URN scope is the hex-pubkey tail of the DID.
pub fn scope_of(did: &str) -> String {
    let scope = did.replace("did:nostr:", "");
    if scope.is_empty() {
        "local".to_string()
    } else {
        scope
    }
}

pub fn sha256_12(data: &str) -> String {
    let digest = Sha256::digest(data.as_bytes());
    hex::encode(digest)[..12].to_string()
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// `urn:agentbox:memory:<scope>:lesson-<sha256-12>`
pub fn mint_lesson_urn(scope: &str, content: &str) -> String {
    format!("urn:agentbox:memory:{scope}:lesson-{}", sha256_12(content))
}

/// `urn:agentbox:activity:<scope>:distil-<short-id>`
pub fn mint_activity_urn(scope: &str) -> String {
    format!("urn:agentbox:activity:{scope}:distil-{}", short_id())
}

// ---------------------------------------------------------------------------
// Privacy filter (ADR-008 / ADR-019 D04)
// ---------------------------------------------------------------------------
//
// The Python original tried `from lib import privacy_filter` and fell back to
// these regexes. No such module exists anywhere in the image, so the fallback
// *is* the deployed behaviour and this port reproduces it exactly.

fn redact_jwt() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}").unwrap()
    })
}

fn redact_b64() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9+/=]{32,}").unwrap())
}

/// Applies redaction. `None` signals a filter failure, which is fail-closed.
pub fn apply_privacy_filter(text: &str) -> Option<String> {
    let out = redact_jwt().replace_all(text, "[REDACTED_JWT]");
    Some(
        redact_b64()
            .replace_all(&out, "[REDACTED_SECRET]")
            .into_owned(),
    )
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/// Field order matches the Python dict literal, which the downstream JS parser
/// does not depend on but the byte-comparison tests do.
#[derive(Debug, Serialize)]
pub struct ActivityRecord {
    pub activity_urn: String,
    pub ontology_type: &'static str,
    pub memory_type: &'static str,
    pub verb: String,
    pub subject_did: String,
    pub object_urn: String,
    pub started_at: String,
    pub ended_at: String,
    pub outcome: String,
    pub evidence: Vec<String>,
    pub owner_did: String,
    pub action_verb: String,
}

#[derive(Debug, Serialize)]
pub struct LessonRecord {
    pub lesson_urn: String,
    pub ontology_type: &'static str,
    pub memory_type: &'static str,
    pub rule: String,
    pub scope: String,
    pub evidence_trajectory_id: String,
    pub evidence_traces: Vec<String>,
    pub confidence: f64,
    pub active: bool,
    pub version: u32,
    pub source_agent: String,
    pub owner_did: String,
    pub action_urn: String,
    pub action_verb: &'static str,
    pub created_at: String,
    pub contradiction_count: u32,
    pub evidence_claim: String,
}

#[derive(Debug, Serialize)]
pub struct StorePayload {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub source_type: String,
    pub upsert: bool,
}

/// Truncates on character boundaries, as Python's `s[:n]` slicing does.
pub fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn now_iso() -> String {
    Utc::now()
        .to_rfc3339_opts(SecondsFormat::Micros, true)
        .replace('Z', "+00:00")
}

// ---------------------------------------------------------------------------
// RuVector write
// ---------------------------------------------------------------------------

/// Writes one record via the `claude-flow mcp call` bridge (never raw SQL —
/// ADR-015). Returns success; failures are reported on stderr as JSON events.
pub fn memory_store(payload: &StorePayload, dry_run: bool) -> bool {
    if dry_run {
        pyjson::println_json(&serde_json::json!({ "DRY_RUN_memory_store": payload }));
        return true;
    }

    let result = std::process::Command::new("claude-flow")
        .args([
            "mcp",
            "call",
            "mcp__ruvector__memory_store",
            &pyjson::dumps(payload),
        ])
        .output();

    match result {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            pyjson::eprintln_json(&serde_json::json!({
                "event": "RuVectorWriteFailed",
                "namespace": payload.namespace,
                "key": payload.key,
                "stderr": truncate_chars(&stderr, 500),
            }));
            false
        }
        Err(err) => {
            pyjson::eprintln_json(&serde_json::json!({
                "event": "RuVectorWriteException",
                "error": err.to_string(),
            }));
            false
        }
    }
}

/// Emits an Activity record. These carry only URN references — never trace
/// bodies — so they bypass redaction by design.
#[allow(clippy::too_many_arguments)]
pub fn emit_activity(
    did: &str,
    scope: &str,
    verb: &str,
    object_urn: &str,
    started_at: &str,
    ended_at: &str,
    outcome: &str,
    evidence_urns: &[String],
    dry_run: bool,
) {
    let activity_urn = mint_activity_urn(scope);
    let record = ActivityRecord {
        activity_urn: activity_urn.clone(),
        ontology_type: "ex:Activity",
        memory_type: "episodic",
        verb: verb.to_string(),
        subject_did: did.to_string(),
        object_urn: object_urn.to_string(),
        started_at: started_at.to_string(),
        ended_at: ended_at.to_string(),
        outcome: outcome.to_string(),
        evidence: evidence_urns.to_vec(),
        owner_did: did.to_string(),
        action_verb: verb.to_string(),
    };

    let local = activity_urn
        .rsplit(':')
        .next()
        .unwrap_or(&activity_urn)
        .to_string();
    let payload = StorePayload {
        namespace: ACTIVITIES_NAMESPACE.to_string(),
        key: format!("activity:{scope}:{local}"),
        value: format!("{activity_urn} | {}", pyjson::dumps(&record)),
        source_type: "ex:Activity".to_string(),
        upsert: true,
    };
    memory_store(&payload, dry_run);
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

/// One raw lesson as the extractor prompt asks the model to emit it.
#[derive(Debug, Clone, Serialize)]
pub struct RawLesson {
    pub rule: String,
    pub scope: String,
    pub evidence_claim: String,
}

/// The extraction prompt template. Kept verbatim so the wired-up model call
/// and the documented contract in `references/extraction-prompt.md` agree.
pub const EXTRACTION_PROMPT_TEMPLATE: &str = concat!(
    "SYSTEM: You are a post-task lesson extractor. Analyse the trajectory below and\n",
    "emit 0-N generalisable rules in the form \"IF <scope-condition> THEN\n",
    "<action-rule>\". Rules must be scope-specific (cite the task type or skill),\n",
    "must reference a concrete observed outcome from the trajectory (stdout,\n",
    "assertion result, test pass/fail), and must be concise (max 200 characters per\n",
    "rule). Output a JSON list of objects with fields: rule (string), scope (string),\n",
    "evidence_claim (string — one sentence citing the observed outcome). Output an\n",
    "empty list [] if no generalisable rule can be grounded in the trajectory.\n",
    "\n",
    "USER:\n",
    "task_summary: {task_summary}\n",
    "success: {success}\n",
    "tool_calls:\n",
    "{tool_calls_json}\n",
);

pub fn render_prompt(task_summary: &str, success: bool, tool_calls: &[Value]) -> String {
    EXTRACTION_PROMPT_TEMPLATE
        .replace("{task_summary}", task_summary)
        .replace("{success}", if success { "true" } else { "false" })
        .replace("{tool_calls_json}", &pyjson::dumps_indent(&tool_calls, 2))
}

/// Calls the LLM extractor.
///
/// The model call is not wired in this environment — the Python original
/// carried the same documented stub, emitting `LLMCallNotWired` on stderr and
/// returning no lessons as the safe default. That behaviour is preserved
/// verbatim; wiring a model here changes runtime behaviour, not this port.
pub fn call_llm_extractor(dry_run: bool) -> Vec<RawLesson> {
    if dry_run {
        return vec![RawLesson {
            rule:
                "IF task uses expel-lesson-extractor THEN verify trace URNs resolve before storing"
                    .to_string(),
            scope: "expel-lesson-extractor".to_string(),
            evidence_claim: "Dry-run example — no LLM call made.".to_string(),
        }];
    }
    pyjson::eprintln_json(&serde_json::json!({
        "event": "LLMCallNotWired",
        "detail": "LLM extractor stub: returning empty lesson list. Wire model call to activate.",
    }));
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn did_resolution_follows_the_documented_precedence() {
        assert_eq!(
            resolve_did("did:nostr:aa", "did:nostr:bb", "cc"),
            "did:nostr:aa"
        );
        assert_eq!(resolve_did("", "did:nostr:bb", "cc"), "did:nostr:bb");
        assert_eq!(resolve_did("", "", "cc"), "did:nostr:cc");
        assert_eq!(resolve_did("", "", ""), "did:nostr:local");
    }

    #[test]
    fn scope_strips_the_did_prefix_and_defaults_to_local() {
        assert_eq!(scope_of("did:nostr:abc123"), "abc123");
        assert_eq!(scope_of("did:nostr:"), "local");
    }

    #[test]
    fn lesson_urn_is_content_addressed_and_stable() {
        let a = mint_lesson_urn("scope1", "some:rule:traj");
        let b = mint_lesson_urn("scope1", "some:rule:traj");
        assert_eq!(a, b, "the same content must mint the same URN");
        assert_ne!(a, mint_lesson_urn("scope1", "other:rule:traj"));
        assert!(a.starts_with("urn:agentbox:memory:scope1:lesson-"));
        assert_eq!(a.rsplit('-').next().unwrap().len(), 12);
    }

    #[test]
    fn sha256_12_matches_python_hashlib() {
        // python3 -c "import hashlib;print(hashlib.sha256(b'abc').hexdigest()[:12])"
        assert_eq!(sha256_12("abc"), "ba7816bf8f01");
    }

    #[test]
    fn activity_urns_are_unique_per_call() {
        assert_ne!(mint_activity_urn("s"), mint_activity_urn("s"));
    }

    #[test]
    fn jwt_shaped_tokens_are_redacted() {
        let jwt =
            "eyJhbGciOiJIUzI1NiJ9xxxx.eyJzdWIiOiIxMjM0NTY3ODkwIn0yy.SflKxwRJSMeKKF2QT4fwpMeJf36P";
        let out = apply_privacy_filter(jwt).unwrap();
        assert!(out.contains("[REDACTED_JWT]"), "got {out}");
    }

    #[test]
    fn long_base64_runs_are_redacted() {
        let secret = "A".repeat(40);
        // `=` is inside the base64 character class, so `token=` is swallowed
        // by the same run — the filter is deliberately over-eager.
        assert_eq!(
            apply_privacy_filter(&format!("token={secret}")).unwrap(),
            "[REDACTED_SECRET]"
        );
        // A separator outside the class keeps the surrounding text.
        assert_eq!(
            apply_privacy_filter(&format!("token: {secret}")).unwrap(),
            "token: [REDACTED_SECRET]"
        );
    }

    #[test]
    fn short_strings_survive_redaction_untouched() {
        assert_eq!(apply_privacy_filter("hello world").unwrap(), "hello world");
    }

    #[test]
    fn truncation_is_character_safe() {
        assert_eq!(truncate_chars("abcdef", 3), "abc");
        assert_eq!(truncate_chars("héllo", 2), "hé");
        assert_eq!(truncate_chars("ab", 10), "ab");
    }

    #[test]
    fn timestamps_use_the_python_utc_offset_form() {
        let ts = now_iso();
        assert!(ts.ends_with("+00:00"), "got {ts}");
        assert!(!ts.contains('Z'));
    }

    #[test]
    fn activity_record_serialises_in_the_python_field_order() {
        let rec = ActivityRecord {
            activity_urn: "urn:a".into(),
            ontology_type: "ex:Activity",
            memory_type: "episodic",
            verb: "distil".into(),
            subject_did: "did:nostr:x".into(),
            object_urn: "urn:o".into(),
            started_at: "t0".into(),
            ended_at: "t1".into(),
            outcome: "ok".into(),
            evidence: vec!["urn:e".into()],
            owner_did: "did:nostr:x".into(),
            action_verb: "distil".into(),
        };
        let json = pyjson::dumps(&rec);
        assert!(json.starts_with(r#"{"activity_urn": "urn:a", "ontology_type": "ex:Activity""#));
        assert!(json.ends_with(r#""action_verb": "distil"}"#));
    }

    #[test]
    fn dry_run_extraction_returns_the_documented_example() {
        let lessons = call_llm_extractor(true);
        assert_eq!(lessons.len(), 1);
        assert_eq!(lessons[0].scope, "expel-lesson-extractor");
    }

    #[test]
    fn prompt_renders_every_placeholder() {
        let p = render_prompt("summary here", true, &[serde_json::json!({"a": 1})]);
        assert!(p.contains("task_summary: summary here"));
        assert!(p.contains("success: true"));
        assert!(p.contains("\"a\": 1"));
        assert!(
            !p.contains("{task_summary}"),
            "placeholders must all be substituted"
        );
        assert!(!p.contains("{tool_calls_json}"));
    }
}
