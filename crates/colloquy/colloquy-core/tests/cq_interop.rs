//! Interoperability with cq's published knowledge-unit example.
//!
//! The JSON below is the canonical `knowledge_unit.json` from cq's
//! `docs/architecture.md`, byte for byte. It is checked in as a fixture rather
//! than paraphrased, because the claim this crate makes — that a unit written
//! here is readable there — is only worth anything if it is tested against the
//! standard's own artefact rather than against our reading of it.
//!
//! Two assertions matter:
//!
//! 1. cq's example parses into our types with nothing lost.
//! 2. Re-serialising it produces a document whose every cq-defined field is
//!    unchanged, so a round trip through this crate is not a lossy rewrite.

use colloquy_core::kind::UnitKind;
use colloquy_core::unit::{KnowledgeUnit, RelationKind, Severity, Tier, UnitStatus};
use serde_json::Value;

/// cq `docs/architecture.md` — the canonical knowledge unit.
const CQ_EXAMPLE: &str = r#"{
  "id": "ku_a1b2c3d4e5f6",
  "version": "1.0.0",
  "domain": ["api", "payments", "error-handling"],
  "insight": {
    "summary": "Short description for fast scanning",
    "detail": "Fuller explanation of the issue",
    "action": "What the agent should do about it"
  },
  "context": {
    "language": ["typescript", "python"],
    "frameworks": [],
    "environment": "server-side",
    "pattern": "api-integration"
  },
  "evidence": {
    "severity": "high",
    "confidence": 0.94,
    "confirmations": 847,
    "contributing_orgs": 312,
    "first_observed": "2025-01-15T09:32:00Z",
    "last_confirmed": "2026-02-28T14:17:00Z",
    "last_queried_at": "2026-03-10T08:00:00Z"
  },
  "provenance": {
    "proposer_did": "did:keri:EXq5YqaL6L48pf0fu7IUhL0JRaU2_RxFP0AL43wYn148",
    "graduation_history": [
      {
        "from": "local",
        "to": "remote",
        "approved_by": "human:alice@acme.dev",
        "timestamp": "2025-01-20T11:00:00Z"
      }
    ]
  },
  "lifecycle": {
    "status": "active",
    "kind": "pitfall",
    "staleness_policy": "confirm_or_decay_after_90d",
    "superseded_by": null,
    "related": [{"id": "ku_f7g8h9i0j1k2", "type": "extends"}]
  }
}"#;

#[test]
fn the_cq_example_parses_into_our_types() {
    let u: KnowledgeUnit = serde_json::from_str(CQ_EXAMPLE).expect("cq's own example must parse");

    assert_eq!(u.id.as_str(), "ku_a1b2c3d4e5f6");
    assert_eq!(u.version, "1.0.0");
    assert_eq!(u.domain, vec!["api", "payments", "error-handling"]);
    assert_eq!(u.insight.summary, "Short description for fast scanning");

    assert_eq!(u.context.language, vec!["typescript", "python"]);
    assert!(u.context.frameworks.is_empty());
    assert_eq!(u.context.environment.as_deref(), Some("server-side"));
    assert_eq!(u.context.pattern.as_deref(), Some("api-integration"));

    assert_eq!(u.evidence.severity, Severity::High);
    assert_eq!(u.evidence.confirmations, 847);
    assert_eq!(u.evidence.contributing_orgs, 312);
    assert_eq!(
        u.evidence.first_observed.to_rfc3339(),
        "2025-01-15T09:32:00Z"
    );
    assert_eq!(
        u.evidence.last_confirmed.to_rfc3339(),
        "2026-02-28T14:17:00Z"
    );
    assert!(u.evidence.last_queried_at.is_some());

    assert!(u.provenance.proposer_did.starts_with("did:keri:"));
    let g = &u.provenance.graduation_history[0];
    assert_eq!((g.from, g.to), (Tier::Local, Tier::Shared));
    assert_eq!(g.approved_by, "human:alice@acme.dev");
    assert_eq!(
        g.authorising_event, None,
        "a cq-written graduation carries no signed decision, and that is legal"
    );

    assert_eq!(u.lifecycle.status, UnitStatus::Active);
    assert_eq!(u.lifecycle.kind, UnitKind::Pitfall);
    assert_eq!(u.lifecycle.staleness_policy, "confirm_or_decay_after_90d");
    assert_eq!(u.lifecycle.superseded_by, None);
    assert_eq!(u.lifecycle.related[0].kind, RelationKind::Extends);

    // The unit's tier is read from its history, not stored twice.
    assert_eq!(u.tier(), Tier::Shared);
}

#[test]
fn a_round_trip_preserves_every_cq_defined_field() {
    let u: KnowledgeUnit = serde_json::from_str(CQ_EXAMPLE).unwrap();
    let ours: Value = serde_json::from_str(&serde_json::to_string(&u).unwrap()).unwrap();
    let theirs: Value = serde_json::from_str(CQ_EXAMPLE).unwrap();

    // `superseded_by: null` is the one shape we normalise: cq writes the key
    // with a null, we omit it. Both deserialise to None, so the difference is
    // not observable in the data model — assert that and nothing more.
    let mut theirs_norm = theirs.clone();
    theirs_norm["lifecycle"]
        .as_object_mut()
        .unwrap()
        .remove("superseded_by");

    assert_eq!(
        ours, theirs_norm,
        "a round trip through colloquy-core must not rewrite a cq unit"
    );
}

#[test]
fn our_additive_fields_do_not_appear_unless_used() {
    let u: KnowledgeUnit = serde_json::from_str(CQ_EXAMPLE).unwrap();
    let json = serde_json::to_string(&u).unwrap();
    assert!(
        !json.contains("authorising_event"),
        "the signed-decision field must stay absent for cq-sourced units: {json}"
    );
}

#[test]
fn a_disputed_unit_is_still_legible_to_a_cq_reader_as_a_status_it_can_reject() {
    // Our added status serialises to a token cq does not define. A cq consumer
    // will fail to parse it rather than silently misread it as `active`, which
    // is the correct failure: an implementation that does not model dispute
    // should not be told a disputed unit is fine.
    let json = serde_json::to_string(&UnitStatus::Disputed).unwrap();
    assert_eq!(json, "\"disputed\"");
    assert!(serde_json::from_str::<UnitStatus>("\"active\"").is_ok());
}
