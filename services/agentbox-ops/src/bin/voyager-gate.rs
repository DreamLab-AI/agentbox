//! `voyager-gate` — Voyager VerificationGate + RuVector write.
//!
//! Replaces `mcp/voyager/verify-and-store.py`, referenced from
//! `ontology/code-harness.ttl`.
//!
//! Exit codes: 0 success (skill stored or retrieved), 1 gate rejection,
//! 2 argument or configuration error.

use agentbox_ops::pyjson;
use agentbox_ops::voyager::gate::{retrieve_skill, verification_gate, Candidate};
use agentbox_ops::voyager::{Context, DEFAULT_MAX_BODY_LINES, DEFAULT_MAX_EVIDENCE_AGE_S};
use clap::Parser;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(
    name = "voyager-gate",
    about = "Voyager VerificationGate + RuVector write"
)]
struct Args {
    /// Path to the candidate VerifiedSkill JSON.
    #[arg(long, value_name = "FILE", conflicts_with = "retrieve_skill")]
    candidate: Option<String>,
    /// Retrieve a skill by URN; pass an empty value to use --name instead.
    #[arg(long = "retrieve-skill", value_name = "URN", num_args = 0..=1, default_missing_value = "")]
    retrieve_skill: Option<String>,
    /// Skill name for --retrieve-skill lookup.
    #[arg(long, default_value = "")]
    name: String,
    /// Scope filter for --retrieve-skill --name.
    #[arg(long, default_value = "")]
    scope: String,
    /// Override agent DID (did:nostr:<hex>).
    #[arg(long = "agent-did", default_value = "")]
    agent_did: String,
    /// Print without writing to RuVector.
    #[arg(long = "dry-run")]
    dry_run: bool,
}

fn env_i64(key: &str, fallback: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn main() {
    let a = Args::parse();

    if let Some(urn) = a.retrieve_skill.as_deref() {
        std::process::exit(retrieve_skill(urn, &a.name, &a.scope, a.dry_run));
    }

    let Some(path) = a.candidate.as_deref() else {
        pyjson::println_json(&json!({
            "ok": false,
            "reason": "Provide --candidate <file> or --retrieve-skill <urn>.",
        }));
        std::process::exit(2);
    };

    let candidate_json: Value = match std::fs::read_to_string(path)
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))
    {
        Ok(v) => v,
        Err(detail) => {
            pyjson::println_json(&json!({
                "ok": false, "reason": "invalid-candidate", "detail": detail,
            }));
            std::process::exit(2);
        }
    };

    let candidate = Candidate::from_json(&candidate_json);
    let did = agentbox_ops::distil::resolve_did(
        &a.agent_did,
        &std::env::var("AGENTBOX_AGENT_DID").unwrap_or_default(),
        &std::env::var("AGENTBOX_AGENT_PUBKEY").unwrap_or_default(),
    );
    let ctx = Context::new(
        did,
        env_i64(
            "VOYAGER_MAX_EVIDENCE_AGE_S",
            candidate
                .max_evidence_age_s
                .unwrap_or(DEFAULT_MAX_EVIDENCE_AGE_S),
        ),
        env_i64(
            "VOYAGER_MAX_SKILL_BODY_LINES",
            DEFAULT_MAX_BODY_LINES as i64,
        ) as usize,
        a.dry_run,
    );

    std::process::exit(verification_gate(&ctx, &candidate));
}
