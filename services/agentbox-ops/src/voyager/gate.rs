//! Gate orchestration and retrieval for `voyager-gate`.

use super::bridge::{self, StorePayload, SKILLS_NAMESPACE};
use super::{
    body_line_count, check_evidence_age, current_max_version, emit_activity, inner_record,
    quarantine, step1_static_scan, step2_kernel_assertions, step3_examples, Context, Step,
};
use crate::distil::now_iso;
use crate::pyjson;
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};

/// The candidate skill as supplied on disk.
#[derive(Debug, Default)]
pub struct Candidate {
    pub name: String,
    pub scope: String,
    pub body_python: String,
    pub assertions: Vec<String>,
    pub examples: Vec<Value>,
    pub embed_text: String,
    pub signature: String,
    pub verified_by: String,
    pub max_evidence_age_s: Option<i64>,
}

impl Candidate {
    /// Reads the candidate JSON, applying the same defaults as the Python
    /// original (`scope` defaults to `generic`, `embed_text` to the name).
    pub fn from_json(v: &Value) -> Self {
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let name = s("name");
        let embed_text = match v.get("embed_text").and_then(Value::as_str) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => name.clone(),
        };
        Self {
            scope: match v.get("scope").and_then(Value::as_str) {
                Some(sc) if !sc.is_empty() => sc.to_string(),
                _ => "generic".to_string(),
            },
            body_python: s("body_python"),
            assertions: v
                .get("assertions")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            examples: v
                .get("examples")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            embed_text,
            signature: s("signature"),
            verified_by: s("verified_by"),
            max_evidence_age_s: v.get("max_evidence_age_s").and_then(Value::as_i64),
            name,
        }
    }
}

#[derive(Debug, Serialize)]
struct SkillRecord {
    skill_urn: String,
    ontology_type: &'static str,
    memory_type: &'static str,
    name: String,
    version: i64,
    signature: String,
    body_python: String,
    assertions: Vec<String>,
    examples: Vec<Value>,
    embed_text: String,
    scope: String,
    verified_by: String,
    verified_at: String,
    max_evidence_age_s: i64,
    source_agent: String,
    owner_did: String,
    action_urn: String,
    action_verb: &'static str,
    usage_count: u64,
}

/// Runs the full gate. Returns 0 when the skill is stored, 1 on rejection.
pub fn verification_gate(ctx: &Context, c: &Candidate) -> i32 {
    let started_at = now_iso();

    if c.name.is_empty() || c.body_python.is_empty() {
        pyjson::println_json(
            &Step::reject("invalid-candidate", "name and body_python are required.").as_json(),
        );
        return 1;
    }

    let lines = body_line_count(&c.body_python);
    if lines > ctx.max_body_lines {
        let step = Step::reject(
            "static-check-failed",
            format!(
                "body_python has {lines} lines; max is {}.",
                ctx.max_body_lines
            ),
        );
        pyjson::println_json(&step.as_json());
        quarantine(ctx, &c.name, &c.scope, &step, &c.signature);
        return 1;
    }

    let evidence = if c.verified_by.is_empty() {
        vec![]
    } else {
        vec![c.verified_by.clone()]
    };

    // Step 1 — static AST scan.
    let s1 = step1_static_scan(&c.body_python);
    if let Step::Reject { .. } = s1 {
        return fail(ctx, c, &s1, &started_at, &evidence);
    }

    // Step 2.5 then step 2 — evidence freshness, then a clean-kernel run.
    let age = check_evidence_age(ctx, &c.verified_by, Utc::now());
    if let Step::Reject { .. } = age {
        return fail(ctx, c, &age, &started_at, &evidence);
    }
    let s2 = step2_kernel_assertions(ctx, &c.body_python, &c.assertions);
    if let Step::Reject { .. } = s2 {
        return fail(ctx, c, &s2, &started_at, &evidence);
    }
    let kernel_trace_urn = format!(
        "urn:agentbox:activity:{}:trace-{}",
        ctx.scope,
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );

    // Step 3 — examples.
    let s3 = step3_examples(ctx, &c.body_python, &c.examples);
    if let Step::Reject { .. } = s3 {
        return fail(ctx, c, &s3, &started_at, &[kernel_trace_urn]);
    }

    // Admitted — mint the next version and store.
    let version = current_max_version(&c.name, &c.scope, ctx.dry_run) + 1;
    let skill_urn = format!("urn:agentbox:skill:{}:v{version}", c.name);

    let verify_activity_urn = emit_activity(
        ctx,
        "verify",
        &skill_urn,
        &started_at,
        &now_iso(),
        "ok",
        std::slice::from_ref(&kernel_trace_urn),
    );

    let verified_at = now_iso();
    let record = SkillRecord {
        skill_urn: skill_urn.clone(),
        ontology_type: "ex:VerifiedSkill",
        memory_type: "procedural",
        name: c.name.clone(),
        version,
        signature: c.signature.clone(),
        body_python: c.body_python.clone(),
        assertions: c.assertions.clone(),
        examples: c.examples.clone(),
        embed_text: c.embed_text.clone(),
        scope: c.scope.clone(),
        verified_by: kernel_trace_urn.clone(),
        verified_at: verified_at.clone(),
        max_evidence_age_s: ctx.max_evidence_age_s,
        source_agent: ctx.agent_did.clone(),
        owner_did: ctx.agent_did.clone(),
        action_urn: verify_activity_urn,
        action_verb: "verify",
        usage_count: 0,
    };

    let stored = bridge::memory_store(
        &StorePayload {
            namespace: SKILLS_NAMESPACE.into(),
            key: format!("skill:{}:{}:v{version}", c.scope, c.name),
            value: format!("{} | {}", c.embed_text, pyjson::dumps(&record)),
            source_type: "ex:VerifiedSkill".into(),
            upsert: true,
        },
        ctx.dry_run,
    );

    if !stored {
        pyjson::println_json(&Step::reject("store-failed", "RuVector write failed.").as_json());
        return 1;
    }

    emit_activity(
        ctx,
        "store",
        &skill_urn,
        &verified_at,
        &now_iso(),
        "ok",
        std::slice::from_ref(&kernel_trace_urn),
    );

    pyjson::println_json(&json!({"ok": true, "skill_urn": skill_urn, "version": version}));
    0
}

/// Common rejection path: report, quarantine, record the failed activity.
fn fail(ctx: &Context, c: &Candidate, step: &Step, started_at: &str, evidence: &[String]) -> i32 {
    pyjson::println_json(&step.as_json());
    quarantine(ctx, &c.name, &c.scope, step, &c.signature);
    emit_activity(
        ctx,
        "verify",
        &format!("urn:agentbox:skill:{}:v?", c.name),
        started_at,
        &now_iso(),
        "error",
        evidence,
    );
    1
}

/// Retrieves a stored skill by URN, or the highest version of a name.
pub fn retrieve_skill(urn: &str, name: &str, scope: &str, dry_run: bool) -> i32 {
    if !urn.is_empty() {
        // Skill URNs are unscoped (`urn:agentbox:skill:<name>:v<n>`), so
        // resolve by searching on the name and matching the stored URN.
        let parts: Vec<&str> = urn.split(':').collect();
        if parts.len() >= 5 {
            let r_name = parts[3];
            for r in
                bridge::memory_search(SKILLS_NAMESPACE, &format!("skill:{r_name}"), 20, dry_run)
            {
                let Some(inner) = inner_record(&r) else {
                    continue;
                };
                if inner.get("skill_urn").and_then(Value::as_str) == Some(urn) {
                    pyjson::println_json(&json!({"ok": true, "record": inner}));
                    return 0;
                }
            }
        }
        pyjson::println_json(&json!({"ok": false, "reason": format!("URN {urn} not found.")}));
        return 1;
    }

    if !name.is_empty() {
        let mut best: Option<Value> = None;
        let mut best_v = -1i64;
        for r in bridge::memory_search(SKILLS_NAMESPACE, name, 20, dry_run) {
            let Some(inner) = inner_record(&r) else {
                continue;
            };
            if inner.get("name").and_then(Value::as_str) != Some(name) {
                continue;
            }
            if !scope.is_empty() && inner.get("scope").and_then(Value::as_str) != Some(scope) {
                continue;
            }
            let v = inner.get("version").and_then(Value::as_i64).unwrap_or(0);
            if v > best_v {
                best_v = v;
                best = Some(inner);
            }
        }
        return match best {
            Some(record) => {
                pyjson::println_json(&json!({"ok": true, "record": record}));
                0
            }
            None => {
                pyjson::println_json(
                    &json!({"ok": false, "reason": format!("No active skill named '{name}' found.")}),
                );
                1
            }
        };
    }

    pyjson::println_json(
        &json!({"ok": false, "reason": "Provide --retrieve-skill <urn> or --name <name>."}),
    );
    2
}
