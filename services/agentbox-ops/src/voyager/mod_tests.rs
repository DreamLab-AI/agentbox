//! Unit tests for the Voyager gate, split out to keep `mod.rs` under the
//! repository's 500-line-per-file limit.

use super::gate::{retrieve_skill, verification_gate, Candidate};
use super::*;
use serde_json::json;

fn ctx() -> Context {
    Context::new(
        "did:nostr:abc123".into(),
        DEFAULT_MAX_EVIDENCE_AGE_S,
        DEFAULT_MAX_BODY_LINES,
        true,
    )
}

#[test]
fn the_context_derives_its_scope_from_the_did() {
    assert_eq!(ctx().scope, "abc123");
    assert_eq!(Context::new("did:nostr:".into(), 1, 1, true).scope, "local");
}

#[test]
fn body_lines_are_counted_the_python_way() {
    assert_eq!(body_line_count("one line"), 1);
    assert_eq!(body_line_count("a\nb"), 2);
    // Python counts newlines and adds one, so a trailing newline does count.
    assert_eq!(body_line_count("a\nb\n"), 3);
}

#[test]
fn a_rejection_renders_the_documented_json_shape() {
    let step = Step::reject("static-check-failed", "too long");
    assert_eq!(
        step.as_json(),
        json!({"ok": false, "reason": "static-check-failed", "detail": "too long"})
    );
    assert!(!step.is_pass());
    assert!(Step::Pass.is_pass());
}

#[test]
fn a_candidate_takes_the_documented_defaults() {
    let c = Candidate::from_json(&json!({"name": "solve", "body_python": "def solve(): pass"}));
    assert_eq!(c.scope, "generic", "scope defaults to generic");
    assert_eq!(c.embed_text, "solve", "embed_text defaults to the name");
    assert!(c.assertions.is_empty());
    assert!(c.examples.is_empty());
}

#[test]
fn a_candidate_keeps_its_explicit_fields() {
    let c = Candidate::from_json(&json!({
        "name": "solve", "scope": "maths", "body_python": "def solve(): pass",
        "assertions": ["assert solve() is None"], "embed_text": "solves things",
        "signature": "def solve() -> None", "verified_by": "urn:agentbox:activity:s:trace-1",
        "examples": [{"input_repr": "", "expected_output_repr": "None"}],
        "max_evidence_age_s": 60
    }));
    assert_eq!(c.scope, "maths");
    assert_eq!(c.embed_text, "solves things");
    assert_eq!(c.assertions, vec!["assert solve() is None"]);
    assert_eq!(c.examples.len(), 1);
    assert_eq!(c.max_evidence_age_s, Some(60));
}

#[test]
fn a_candidate_missing_its_body_is_rejected_before_any_gate_runs() {
    assert_eq!(
        verification_gate(&ctx(), &Candidate::from_json(&json!({"name": "x"}))),
        1
    );
    assert_eq!(
        verification_gate(
            &ctx(),
            &Candidate::from_json(&json!({"body_python": "def f(): pass"}))
        ),
        1
    );
}

#[test]
fn an_oversized_body_is_rejected_on_the_line_budget() {
    let big = (0..200)
        .map(|i| format!("x = {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let c = Candidate::from_json(&json!({"name": "big", "body_python": big}));
    assert_eq!(verification_gate(&ctx(), &c), 1);
}

#[test]
fn a_body_at_exactly_the_limit_passes_the_line_budget() {
    let exact = (0..DEFAULT_MAX_BODY_LINES)
        .map(|i| format!("x = {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(body_line_count(&exact), DEFAULT_MAX_BODY_LINES);
}

#[test]
fn a_missing_sandbox_check_is_a_configuration_error_not_a_pass() {
    let step = step1_static_scan_with(
        std::path::Path::new("/tmp/definitely/not/here.py"),
        "def f(): pass",
    );
    match step {
        Step::Reject { reason, .. } => assert_eq!(reason, "configuration-error"),
        Step::Pass => panic!("a missing scanner must never admit a skill"),
    }
}

#[test]
fn a_dry_run_skips_the_evidence_freshness_check() {
    assert!(check_evidence_age(&ctx(), "urn:agentbox:activity:s:trace-1", Utc::now()).is_pass());
}

#[test]
fn a_malformed_evidence_urn_is_not_treated_as_stale() {
    let live = Context::new("did:nostr:abc".into(), 3600, 80, false);
    assert!(check_evidence_age(&live, "too:short", Utc::now()).is_pass());
}

#[test]
fn the_inner_record_is_recovered_from_the_pipe_delimited_value() {
    let r = json!({"value": "some embed text | {\"name\": \"solve\", \"version\": 3}"});
    let inner = inner_record(&r).unwrap();
    assert_eq!(inner["name"], "solve");
    assert_eq!(inner["version"], 3);
}

#[test]
fn a_value_without_a_delimiter_is_parsed_whole() {
    let r = json!({"value": "{\"name\": \"solve\"}"});
    assert_eq!(inner_record(&r).unwrap()["name"], "solve");
}

#[test]
fn a_non_json_value_yields_no_record() {
    assert!(inner_record(&json!({"value": "not json"})).is_none());
    assert!(inner_record(&json!({})).is_none());
}

#[test]
fn a_new_skill_starts_at_version_zero_when_nothing_is_stored() {
    assert_eq!(current_max_version("brand-new", "generic", true), 0);
}

#[test]
fn retrieval_without_a_urn_or_name_is_an_argument_error() {
    assert_eq!(retrieve_skill("", "", "", true), 2);
}

#[test]
fn retrieving_an_unknown_urn_reports_not_found() {
    assert_eq!(
        retrieve_skill("urn:agentbox:skill:nope:v1", "", "", true),
        1
    );
}

#[test]
fn retrieving_an_unknown_name_reports_not_found() {
    assert_eq!(retrieve_skill("", "nope", "", true), 1);
}

#[test]
fn quarantine_is_a_no_op_for_a_passing_step() {
    // Must not panic, and must write nothing.
    quarantine(&ctx(), "name", "scope", &Step::Pass, "sig");
}

#[test]
fn an_activity_urn_is_minted_per_emission() {
    let c = ctx();
    let a = emit_activity(&c, "verify", "urn:o", "t0", "t1", "ok", &[]);
    let b = emit_activity(&c, "verify", "urn:o", "t0", "t1", "ok", &[]);
    assert!(a.starts_with("urn:agentbox:activity:abc123:verify-"));
    assert_ne!(a, b);
}
