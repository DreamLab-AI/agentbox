//! `expel-distil` — ExpeL post-task lesson extractor.
//!
//! Replaces `mcp/expel/distil.py`, invoked by `claude-flow hooks post-task`
//! when `[features.expel_lesson_extraction].enabled = true`. stdout stays
//! byte-compatible with the Python original because
//! `management-api/lib/kg-proposal-extractor.js` parses it.
//!
//! Exit codes: 0 success (lessons written, or cleanly skipped), 1
//! unrecoverable error, 2 argument error.

use agentbox_ops::distil::*;
use agentbox_ops::pyjson;
use clap::Parser;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(name = "expel-distil", about = "ExpeL post-task lesson extractor")]
struct Args {
    /// Unique ID for the completed task trajectory.
    #[arg(long = "trajectory-id")]
    trajectory_id: String,
    /// Terminal outcome of the task.
    #[arg(long, value_parser = ["true", "false"])]
    outcome: String,
    /// Comma-separated ExecutionTrace URNs.
    #[arg(long = "trace-urns")]
    trace_urns: String,
    /// Override agent DID (did:nostr:<hex>).
    #[arg(long = "agent-did", default_value = "")]
    agent_did: String,
    /// Print what would be stored without writing to RuVector.
    #[arg(long = "dry-run")]
    dry_run: bool,
}

struct Ctx {
    did: String,
    scope: String,
    dry_run: bool,
}

fn main() {
    let args = Args::parse();
    let did = resolve_did(
        &args.agent_did,
        &std::env::var("AGENTBOX_AGENT_DID").unwrap_or_default(),
        &std::env::var("AGENTBOX_AGENT_PUBKEY").unwrap_or_default(),
    );
    let ctx = Ctx {
        scope: scope_of(&did),
        did,
        dry_run: args.dry_run,
    };

    let trace_urns: Vec<String> = args
        .trace_urns
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();

    std::process::exit(distil(
        &ctx,
        &args.trajectory_id,
        args.outcome == "true",
        &trace_urns,
    ));
}

fn skip(
    ctx: &Ctx,
    trajectory_id: &str,
    reason: String,
    started_at: &str,
    traces: &[String],
) -> i32 {
    pyjson::println_json(&json!({
        "event": "LessonSkipped", "reason": reason, "trajectory_id": trajectory_id,
    }));
    emit_activity(
        &ctx.did,
        &ctx.scope,
        "distil",
        &format!("urn:agentbox:activity:{}:{trajectory_id}", ctx.scope),
        started_at,
        &now_iso(),
        "skip",
        traces,
        ctx.dry_run,
    );
    0
}

fn distil(ctx: &Ctx, trajectory_id: &str, outcome: bool, trace_urns: &[String]) -> i32 {
    let started_at = now_iso();

    // Gate 1 — trajectory length (PRD-008 C4).
    if trace_urns.len() < MIN_TRACES {
        return skip(
            ctx,
            trajectory_id,
            format!(
                "Trajectory has {} traces (minimum {MIN_TRACES} required).",
                trace_urns.len()
            ),
            &started_at,
            trace_urns,
        );
    }

    // Gather trace bodies from the outbox; URNs with no body become stubs.
    let outbox =
        std::env::var("CODE_HARNESS_TRACES_OUTBOX").unwrap_or_else(|_| DEFAULT_OUTBOX.to_string());
    let mut tool_calls_raw: Vec<Value> = Vec::new();
    for urn in trace_urns.iter().take(TRACE_CAP) {
        let local = urn.rsplit(':').next().unwrap_or(urn);
        let candidate = std::path::Path::new(&outbox).join(format!("{local}.json"));
        if candidate.exists() {
            match std::fs::read_to_string(&candidate)
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            {
                Some(v) => tool_calls_raw.push(v),
                None => tool_calls_raw.push(json!({"trace_urn": urn, "error": "unreadable"})),
            }
        } else {
            tool_calls_raw.push(json!({"trace_urn": urn, "note": "trace body not in outbox"}));
        }
    }

    // Gate 2 — privacy filter over trace bodies. Fail-closed (ADR-019 D04).
    let mut tool_calls_filtered: Vec<Value> = Vec::new();
    for entry in &tool_calls_raw {
        let Some(filtered) = apply_privacy_filter(&pyjson::dumps(entry)) else {
            pyjson::eprintln_json(&json!({
                "event": "LessonRedactionFailed",
                "reason": "PrivacyFilterPort unavailable; lesson dropped (fail-closed per ADR-019 D04).",
                "trajectory_id": trajectory_id,
            }));
            emit_activity(
                &ctx.did,
                &ctx.scope,
                "distil",
                &format!("urn:agentbox:activity:{}:{trajectory_id}", ctx.scope),
                &started_at,
                &now_iso(),
                "error",
                trace_urns,
                ctx.dry_run,
            );
            return 1;
        };
        match serde_json::from_str::<Value>(&filtered) {
            Ok(v) => tool_calls_filtered.push(v),
            Err(_) => {
                tool_calls_filtered.push(json!({"filtered_text": truncate_chars(&filtered, 500)}))
            }
        }
    }

    // Gate 3 — LLM extraction.
    let task_summary = format!(
        "Trajectory {trajectory_id}; outcome: {}; trace count: {}.",
        if outcome { "success" } else { "failure" },
        trace_urns.len()
    );
    let _prompt = render_prompt(&task_summary, outcome, &tool_calls_filtered);
    let raw_lessons = call_llm_extractor(ctx.dry_run);

    if raw_lessons.is_empty() {
        return skip(
            ctx,
            trajectory_id,
            "LLM returned empty lesson list.".to_string(),
            &started_at,
            trace_urns,
        );
    }

    // Gates 4-6 — evidence grounding, confidence floor, volume cap.
    let min_confidence: f64 = std::env::var("EXPEL_MIN_CONFIDENCE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.6);
    let max_lessons: usize = std::env::var("EXPEL_MAX_LESSONS_PER_TASK")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let mut lessons: Vec<LessonRecord> = Vec::new();
    for raw in &raw_lessons {
        let rule = raw.rule.trim();
        let scope = raw.scope.trim();
        if rule.is_empty() || trace_urns.is_empty() {
            continue;
        }
        let Some(filtered_rule) = apply_privacy_filter(rule) else {
            pyjson::eprintln_json(&json!({
                "event": "LessonRedactionFailed",
                "reason": "PrivacyFilterPort unavailable during rule redaction.",
                "rule_prefix": truncate_chars(rule, 50),
            }));
            continue;
        };
        let filtered_claim = apply_privacy_filter(&raw.evidence_claim).unwrap_or_default();
        let content = format!("{scope}:{filtered_rule}:{trajectory_id}");

        lessons.push(LessonRecord {
            lesson_urn: mint_lesson_urn(&ctx.scope, &content),
            ontology_type: "ex:DistilledLesson",
            memory_type: "semantic",
            rule: truncate_chars(&filtered_rule, 200),
            scope: scope.to_string(),
            evidence_trajectory_id: trajectory_id.to_string(),
            evidence_traces: trace_urns.iter().take(TRACE_CAP).cloned().collect(),
            confidence: min_confidence,
            active: true,
            version: 1,
            source_agent: ctx.did.clone(),
            owner_did: ctx.did.clone(),
            action_urn: mint_activity_urn(&ctx.scope),
            action_verb: "distil",
            created_at: started_at.clone(),
            contradiction_count: 0,
            evidence_claim: truncate_chars(&filtered_claim, 300),
        });
    }

    lessons.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    lessons.truncate(max_lessons);

    let mut written: Vec<String> = Vec::new();
    for record in &lessons {
        let short_key = record.lesson_urn.rsplit(':').next().unwrap_or_default();
        let payload = StorePayload {
            namespace: LESSONS_NAMESPACE.to_string(),
            key: format!("lesson:{}:{short_key}", record.scope),
            // Rule first so the embedding sees the semantic signal.
            value: format!("{} | {}", record.rule, pyjson::dumps(record)),
            source_type: "ex:DistilledLesson".to_string(),
            upsert: true,
        };
        if memory_store(&payload, ctx.dry_run) {
            written.push(record.lesson_urn.clone());
            pyjson::println_json(&json!({
                "event": "LessonStored",
                "lesson_urn": record.lesson_urn,
                "scope": record.scope,
                "confidence": record.confidence,
            }));
        } else {
            pyjson::eprintln_json(&json!({
                "event": "LessonWriteFailed", "lesson_urn": record.lesson_urn,
            }));
        }
    }

    emit_activity(
        &ctx.did,
        &ctx.scope,
        "distil",
        &format!("urn:agentbox:activity:{}:{trajectory_id}", ctx.scope),
        &started_at,
        &now_iso(),
        if written.is_empty() { "skip" } else { "ok" },
        trace_urns,
        ctx.dry_run,
    );

    pyjson::println_json(&json!({
        "event": "DistilComplete",
        "trajectory_id": trajectory_id,
        "lessons_written": written.len(),
        "lesson_urns": written,
    }));
    0
}
