//! Voyager VerificationGate + RuVector write — the logic behind `voyager-gate`.
//!
//! Ported from `mcp/voyager/verify-and-store.py`, referenced by
//! `ontology/code-harness.ttl`. A candidate skill is admitted only after a
//! static AST scan, a clean-kernel assertion run, and an example execution;
//! rejections are quarantined for audit.
//!
//! ADR-019 §Mechanism 2, PRD-008 §3.5 / §7 Phase 2b, DDD-005 invariants I08-I15.
//!
//! Note on `signature`: it is the skill's *function type signature*
//! (`def foo(...) -> ...`), never a cryptographic one.

pub mod bridge;
pub mod gate;

use crate::distil::{now_iso, sha256_12, truncate_chars};
use crate::pyjson;
use bridge::{StorePayload, ACTIVITIES_NAMESPACE, REJECTED_NAMESPACE, SKILLS_NAMESPACE};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};

pub const DEFAULT_MAX_EVIDENCE_AGE_S: i64 = 3600;
pub const DEFAULT_MAX_BODY_LINES: usize = 80;

/// A gate step's verdict.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Pass,
    Reject { reason: String, detail: String },
}

impl Step {
    pub fn reject(reason: &str, detail: impl Into<String>) -> Self {
        Self::Reject {
            reason: reason.to_string(),
            detail: detail.into(),
        }
    }

    pub fn is_pass(&self) -> bool {
        matches!(self, Self::Pass)
    }

    /// The `{"ok": false, "reason": ..., "detail": ...}` shape printed on stdout.
    pub fn as_json(&self) -> Value {
        match self {
            Self::Pass => json!({"ok": true}),
            Self::Reject { reason, detail } => {
                json!({"ok": false, "reason": reason, "detail": detail})
            }
        }
    }
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// Identity and configuration for one gate run.
pub struct Context {
    pub agent_did: String,
    pub scope: String,
    pub max_evidence_age_s: i64,
    pub max_body_lines: usize,
    pub dry_run: bool,
}

impl Context {
    pub fn new(
        agent_did: String,
        max_evidence_age_s: i64,
        max_body_lines: usize,
        dry_run: bool,
    ) -> Self {
        let scope = crate::distil::scope_of(&agent_did);
        Self {
            agent_did,
            scope,
            max_evidence_age_s,
            max_body_lines,
            dry_run,
        }
    }
}

#[derive(Debug, Serialize)]
struct ActivityRecord {
    activity_urn: String,
    ontology_type: &'static str,
    memory_type: &'static str,
    verb: String,
    subject_did: String,
    object_urn: String,
    started_at: String,
    ended_at: String,
    outcome: String,
    evidence: Vec<String>,
    owner_did: String,
    action_verb: String,
}

/// Emits an Activity record and returns its URN.
pub fn emit_activity(
    ctx: &Context,
    verb: &str,
    object_urn: &str,
    started_at: &str,
    ended_at: &str,
    outcome: &str,
    evidence: &[String],
) -> String {
    let activity_urn = format!("urn:agentbox:activity:{}:verify-{}", ctx.scope, short_id());
    let record = ActivityRecord {
        activity_urn: activity_urn.clone(),
        ontology_type: "ex:Activity",
        memory_type: "episodic",
        verb: verb.to_string(),
        subject_did: ctx.agent_did.clone(),
        object_urn: object_urn.to_string(),
        started_at: started_at.to_string(),
        ended_at: ended_at.to_string(),
        outcome: outcome.to_string(),
        evidence: evidence.to_vec(),
        owner_did: ctx.agent_did.clone(),
        action_verb: verb.to_string(),
    };
    let local = activity_urn
        .rsplit(':')
        .next()
        .unwrap_or_default()
        .to_string();
    bridge::memory_store(
        &StorePayload {
            namespace: ACTIVITIES_NAMESPACE.into(),
            key: format!("activity:{}:{}", ctx.scope, local),
            value: format!("{activity_urn} | {}", pyjson::dumps(&record)),
            source_type: "ex:Activity".into(),
            upsert: true,
        },
        ctx.dry_run,
    );
    activity_urn
}

/// Counts lines the way Python's `body.count("\n") + 1` does.
pub fn body_line_count(body: &str) -> usize {
    body.matches('\n').count() + 1
}

/// Step 1 — static AST scan through `sandbox_check.py`.
pub fn step1_static_scan(body_python: &str) -> Step {
    step1_static_scan_with(&bridge::sandbox_check_path(), body_python)
}

/// Step 1 against an explicit scanner path.
pub fn step1_static_scan_with(script: &std::path::Path, body_python: &str) -> Step {
    if !script.exists() {
        return Step::reject(
            "configuration-error",
            format!(
                "sandbox_check.py not found at {}. Ensure mcp/code-interpreter/ is installed.",
                script.display()
            ),
        );
    }
    let scan = match bridge::run_sandbox_check(script, body_python) {
        Ok(s) => s,
        Err(e) => return Step::reject("static-check-error", e),
    };
    match scan.exit_code {
        1 => Step::reject(
            "static-check-failed",
            format!(
                "Banned APIs detected: {}. {}",
                pyjson::dumps(scan.payload.get("banned").unwrap_or(&json!([]))),
                scan.payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ),
        ),
        2 => Step::reject(
            "static-check-error",
            scan.payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Parse error in sandbox_check.py"),
        ),
        _ => Step::Pass,
    }
}

/// Step 2.5 — the evidence trace named by `verified_by` must exist and be fresh.
pub fn check_evidence_age(ctx: &Context, verified_by: &str, now: DateTime<Utc>) -> Step {
    if ctx.dry_run {
        return Step::Pass;
    }
    let parts: Vec<&str> = verified_by.split(':').collect();
    if parts.len() < 5 {
        return Step::Pass;
    }
    let key = format!("activity:{}:{}", parts[3], parts[4]);
    let Some(record) = bridge::memory_retrieve(&key, ACTIVITIES_NAMESPACE, false) else {
        return Step::reject(
            "stale-evidence",
            format!("verified_by URN {verified_by} not found in code-harness-activities."),
        );
    };

    let stamp = record
        .get("created_at")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            let value = record.get("value").and_then(Value::as_str)?;
            let tail = value.rsplit(" | ").next()?;
            let inner: Value = serde_json::from_str(tail).ok()?;
            inner
                .get("started_at")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let Some(stamp) = stamp.filter(|s| !s.is_empty()) else {
        return Step::Pass;
    };
    let Ok(ts) = DateTime::parse_from_rfc3339(&stamp.replace('Z', "+00:00")) else {
        return Step::reject(
            "stale-evidence",
            format!("Cannot parse trace timestamp: {stamp}"),
        );
    };
    let age = (now - ts.with_timezone(&Utc)).num_seconds();
    if age > ctx.max_evidence_age_s {
        return Step::reject(
            "stale-evidence",
            format!(
                "verified_by trace is {age}s old; max is {}s.",
                ctx.max_evidence_age_s
            ),
        );
    }
    Step::Pass
}

/// Step 2 — reset the kernel, run the body, then every assertion.
pub fn step2_kernel_assertions(ctx: &Context, body_python: &str, assertions: &[String]) -> Step {
    if !bridge::kernel_reset(ctx.dry_run) {
        return Step::reject(
            "kernel-reset-failed",
            "kernel.reset returned error; cannot guarantee clean state.",
        );
    }

    let body_result = bridge::kernel_exec(body_python, 60, ctx.dry_run);
    if let Some(exc) = exception_of(&body_result) {
        return Step::reject(
            "assertion-failed",
            format!("Function body raised {}: {}", exc.0, exc.1),
        );
    }

    for assertion in assertions {
        let result = bridge::kernel_exec(assertion, 30, ctx.dry_run);
        if let Some(exc) = exception_of(&result) {
            return Step::reject(
                "assertion-failed",
                format!(
                    "Assertion `{}` raised {}: {}",
                    truncate_chars(assertion, 80),
                    exc.0,
                    exc.1
                ),
            );
        }
    }
    Step::Pass
}

fn exception_of(result: &Value) -> Option<(String, String)> {
    let exc = result.get("exception")?;
    if exc.is_null() {
        return None;
    }
    Some((
        exc.get("type")
            .and_then(Value::as_str)
            .unwrap_or("None")
            .to_string(),
        exc.get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    ))
}

/// Step 3 — call the skill once per documented example.
pub fn step3_examples(ctx: &Context, body_python: &str, examples: &[Value]) -> Step {
    for ex in examples {
        let input_repr = ex.get("input_repr").and_then(Value::as_str).unwrap_or("");
        let Some(fn_name) = bridge::extract_fn_name(body_python) else {
            return Step::reject(
                "example-mismatch",
                "Cannot extract function name from body_python.",
            );
        };
        let call = format!("_ex_result = {fn_name}({input_repr})\nprint(repr(_ex_result))");
        let result = bridge::kernel_exec(&call, 30, ctx.dry_run);
        if let Some(exc) = exception_of(&result) {
            return Step::reject(
                "example-mismatch",
                format!("Example call raised {}: {}", exc.0, exc.1),
            );
        }
    }
    Step::Pass
}

/// Highest stored version for `(name, scope)`; 0 when the skill is new.
pub fn current_max_version(name: &str, scope: &str, dry_run: bool) -> i64 {
    bridge::memory_search(
        SKILLS_NAMESPACE,
        &format!("skill:{scope}:{name}"),
        20,
        dry_run,
    )
    .iter()
    .filter_map(inner_record)
    .filter(|inner| {
        inner.get("name").and_then(Value::as_str) == Some(name)
            && inner.get("scope").and_then(Value::as_str) == Some(scope)
    })
    .filter_map(|inner| version_of(&inner))
    .max()
    .unwrap_or(0)
}

/// Recovers the JSON tail of a `"<embed_text> | <json>"` stored value.
pub fn inner_record(r: &Value) -> Option<Value> {
    let value = r.get("value").and_then(Value::as_str).unwrap_or("");
    let tail = match value.split_once(" | ") {
        Some((_, tail)) => tail,
        None => value,
    };
    serde_json::from_str(tail).ok()
}

fn version_of(inner: &Value) -> Option<i64> {
    match inner.get("version")? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Writes a rejection record for audit.
pub fn quarantine(ctx: &Context, name: &str, scope: &str, step: &Step, signature: &str) {
    let Step::Reject { reason, detail } = step else {
        return;
    };
    let ts = now_iso();
    let record = json!({
        "name": name,
        "scope": scope,
        "reason": reason,
        "detail": detail,
        "rejected_at": ts,
        "candidate_signature": signature,
        "owner_did": ctx.agent_did,
        "action_verb": "reject",
    });
    bridge::memory_store(
        &StorePayload {
            namespace: REJECTED_NAMESPACE.into(),
            key: format!("rejected:{name}:{}", sha256_12(&format!("{name}:{ts}"))),
            value: format!("Rejected {name}: {reason} | {}", pyjson::dumps(&record)),
            source_type: "ex:VerifiedSkillRejected".into(),
            upsert: false,
        },
        ctx.dry_run,
    );
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
