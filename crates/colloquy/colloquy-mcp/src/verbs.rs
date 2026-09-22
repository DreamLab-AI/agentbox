//! The six verbs.
//!
//! cq's agent-facing surface is `query`, `propose`, `confirm`, `flag`,
//! `reflect` and `status`. Everything here is the dispatch from a tool call to
//! a [`KnowledgeStore`], plus the two places the verbs are opinionated:
//!
//! **`propose` does not confirm.** An agent proposing a unit does not become
//! its first confirmer. Self-confirmation would let one member manufacture the
//! evidence that promotion is gated on.
//!
//! **`reflect` checks coverage before it proposes.** cq describes reflection as
//! "surfacing existing KUs rather than creating duplicates", and that is the
//! whole value: the extraction itself is the calling model's job — it is the
//! thing with the transcript — while the store's job is to say what is already
//! known. A candidate with an existing match is reported, not written.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use colloquy_core::kind::UnitKind;
use colloquy_core::principal::{Attestation, MemberClass};
use colloquy_core::unit::{Insight, KnowledgeUnit, Severity, UnitContext};
use colloquy_core::{Timestamp, UnitId};
use colloquy_store::{KnowledgeStore, Query, StoreError};

/// Who this server acts as.
///
/// An MCP server runs inside one agent profile, so its caller's identity is
/// configuration rather than a per-call argument — which also means a caller
/// cannot claim to be someone else by passing a different id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    /// The member account: a `did:nostr` pubkey in deployment.
    pub member: String,
    /// The authorising principal. For an agent, whoever registered it.
    pub principal: String,
    /// Agent or human.
    pub class: MemberClass,
    /// Web-of-trust score, consulted only for a human principal.
    #[serde(default)]
    pub wot: f64,
}

impl Identity {
    /// An agent identity.
    pub fn agent(member: impl Into<String>, principal: impl Into<String>) -> Self {
        Self {
            member: member.into(),
            principal: principal.into(),
            class: MemberClass::Agent,
            wot: 0.0,
        }
    }

    /// The attestation this identity makes at `at`.
    pub fn attest(&self, at: Timestamp) -> Attestation {
        match self.class {
            MemberClass::Human => Attestation::human(self.member.clone(), self.wot, at),
            MemberClass::Agent => {
                Attestation::agent(self.member.clone(), self.principal.clone(), at)
            }
        }
    }

    /// The DID recorded as a unit's proposer.
    pub fn did(&self) -> &str {
        &self.member
    }
}

/// Arguments to `propose`.
#[derive(Debug, Clone, Deserialize)]
pub struct ProposeArgs {
    /// Ladder classification.
    pub kind: UnitKind,
    /// Domain tags.
    pub domain: Vec<String>,
    /// Short description for fast scanning.
    pub summary: String,
    /// Fuller explanation.
    #[serde(default)]
    pub detail: String,
    /// What to do about it.
    pub action: String,
    /// How badly it bites.
    #[serde(default)]
    pub severity: Severity,
    /// Where it applies.
    #[serde(default)]
    pub context: UnitContext,
}

/// One candidate learning handed to `reflect`.
#[derive(Debug, Clone, Deserialize)]
pub struct Candidate {
    /// Ladder classification.
    pub kind: UnitKind,
    /// Domain tags.
    pub domain: Vec<String>,
    /// Short description.
    pub summary: String,
    /// Fuller explanation.
    #[serde(default)]
    pub detail: String,
    /// What to do about it.
    pub action: String,
}

/// What `reflect` decided about one candidate.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Reflected {
    /// No existing unit covered it, so it was written.
    Proposed {
        /// The new unit's id.
        id: String,
        /// Its summary, echoed so the caller can report what it filed.
        summary: String,
    },
    /// An existing unit already covers it; nothing was written.
    AlreadyKnown {
        /// The unit that covers it.
        id: String,
        /// That unit's summary.
        summary: String,
        /// How closely it matched.
        relevance: f64,
    },
    /// It failed validation and was not written.
    Refused {
        /// The candidate's summary.
        summary: String,
        /// Why.
        reason: String,
    },
}

/// How close an existing unit must be for a candidate to count as covered.
///
/// Set high on purpose. A false "already known" silently loses a learning,
/// which is the one failure mode reflection exists to prevent; a false
/// "propose" merely produces a near-duplicate that confirmation and
/// supersession can tidy up later.
pub const COVERAGE_THRESHOLD: f64 = 0.85;

/// Execute `query`.
pub async fn query(
    store: &impl KnowledgeStore,
    args: Value,
    now: Timestamp,
) -> Result<Value, StoreError> {
    let q: Query = serde_json::from_value(args).unwrap_or_default();
    let hits = store.query(&q, now).await?;
    Ok(serde_json::json!({
        "tier": format!("{:?}", store.tier()),
        "hits": hits.iter().map(|h| serde_json::json!({
            "id": h.unit.id.as_str(),
            "kind": h.unit.lifecycle.kind.as_str(),
            "status": h.assessment.status,
            "summary": h.unit.insight.summary,
            "detail": h.unit.insight.detail,
            "action": h.unit.insight.action,
            "domain": h.unit.domain,
            "confidence": h.assessment.confidence,
            "distinct_principals": h.assessment.distinct_principals,
            "flagging_principals": h.assessment.flagging_principals,
            "relevance": h.relevance,
            "rank": h.rank,
        })).collect::<Vec<_>>(),
    }))
}

/// Execute `propose`.
pub async fn propose(
    store: &impl KnowledgeStore,
    identity: &Identity,
    args: Value,
    now: Timestamp,
) -> Result<Value, StoreError> {
    let a: ProposeArgs = serde_json::from_value(args)
        .map_err(|e| StoreError::Invalid(format!("bad propose arguments: {e}")))?;
    let unit = build_unit(
        identity, a.kind, a.domain, a.summary, a.detail, a.action, now,
    )
    .with_context(a.context)
    .with_severity(a.severity);
    store.put(&unit, now).await?;
    Ok(serde_json::json!({
        "id": unit.id.as_str(),
        "status": unit.lifecycle.status,
        "note": "proposed, not confirmed: a proposer is never their own first confirmation",
    }))
}

fn build_unit(
    identity: &Identity,
    kind: UnitKind,
    domain: Vec<String>,
    summary: String,
    detail: String,
    action: String,
    now: Timestamp,
) -> KnowledgeUnit {
    KnowledgeUnit::propose(
        identity.did(),
        kind,
        domain,
        Insight::new(summary, detail, action),
        now,
    )
}

/// Execute `confirm` or `flag`.
pub async fn attest(
    store: &impl KnowledgeStore,
    identity: &Identity,
    args: Value,
    is_flag: bool,
    now: Timestamp,
) -> Result<Value, StoreError> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Invalid("`id` is required".into()))?;
    let id = UnitId::parse(id).map_err(|e| StoreError::Invalid(e.to_string()))?;
    let text = args
        .get("reason")
        .or_else(|| args.get("note"))
        .and_then(Value::as_str);

    let a = if is_flag {
        let reason = text.filter(|r| !r.trim().is_empty()).ok_or_else(|| {
            StoreError::Invalid("`reason` is required: a flag without one is unanswerable".into())
        })?;
        store.flag(&id, identity.attest(now), reason).await?
    } else {
        store.confirm(&id, identity.attest(now)).await?
    };

    Ok(serde_json::json!({
        "id": id.as_str(),
        "status": a.status,
        "confidence": a.confidence,
        "distinct_principals": a.distinct_principals,
        "flagging_principals": a.flagging_principals,
        "note": if is_flag {
            "flagged: the unit is disputed and still served. Only a signed decision retires it."
        } else {
            "confirmed"
        },
    }))
}

/// Execute `reflect`.
pub async fn reflect(
    store: &impl KnowledgeStore,
    identity: &Identity,
    args: Value,
    now: Timestamp,
) -> Result<Value, StoreError> {
    let candidates: Vec<Candidate> = serde_json::from_value(
        args.get("candidates")
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| StoreError::Invalid(format!("bad candidates: {e}")))?;

    let mut out = Vec::new();
    for c in candidates {
        let probe = Query::text(format!("{} {}", c.summary, c.action))
            .in_domain(c.domain.clone())
            .limit(1);
        let existing = store.query(&probe, now).await?;

        if let Some(hit) = existing.first() {
            if hit.relevance >= COVERAGE_THRESHOLD {
                out.push(Reflected::AlreadyKnown {
                    id: hit.unit.id.to_string(),
                    summary: hit.unit.insight.summary.clone(),
                    relevance: hit.relevance,
                });
                continue;
            }
        }

        let unit = build_unit(
            identity,
            c.kind,
            c.domain,
            c.summary.clone(),
            c.detail,
            c.action,
            now,
        );
        match store.put(&unit, now).await {
            Ok(()) => out.push(Reflected::Proposed {
                id: unit.id.to_string(),
                summary: c.summary,
            }),
            Err(e) => out.push(Reflected::Refused {
                summary: c.summary,
                reason: e.to_string(),
            }),
        }
    }

    let proposed = out
        .iter()
        .filter(|r| matches!(r, Reflected::Proposed { .. }))
        .count();
    Ok(serde_json::json!({
        "considered": out.len(),
        "proposed": proposed,
        "results": out,
    }))
}

/// Execute `status`.
pub async fn status(store: &impl KnowledgeStore, now: Timestamp) -> Result<Value, StoreError> {
    let s = store.stats(now).await?;
    Ok(serde_json::json!({
        "tier": format!("{:?}", store.tier()),
        "units": s.units,
        "servable": s.servable,
        "disputed": s.disputed,
        "stale": s.stale,
        "distinct_principals": s.principals,
        "by_kind": s.by_kind.iter().map(|(k, n)| serde_json::json!({
            "kind": k.as_str(), "level": k.level(), "units": n,
        })).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_store::LocalStore;
    use serde_json::json;

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn me() -> Identity {
        Identity::agent("did:nostr:scribe", "did:nostr:operator")
    }

    fn other() -> Identity {
        Identity::agent("did:nostr:auditor", "did:nostr:another-operator")
    }

    async fn seeded() -> (LocalStore, String) {
        let store = LocalStore::in_memory();
        let v = propose(
            &store,
            &me(),
            json!({
                "kind": "workaround",
                "domain": ["payments", "http"],
                "summary": "Regenerated idempotency keys double-post a retry",
                "detail": "The client mints a fresh key per attempt.",
                "action": "Derive the key from the order id, never the attempt.",
                "severity": "high"
            }),
            t(0),
        )
        .await
        .unwrap();
        let id = v["id"].as_str().unwrap().to_string();
        (store, id)
    }

    #[tokio::test]
    async fn propose_files_a_draft_and_does_not_confirm_it() {
        let (store, id) = seeded().await;
        let s = status(&store, t(0)).await.unwrap();
        assert_eq!(s["units"], json!(1));
        assert_eq!(
            s["distinct_principals"],
            json!(0),
            "proposing is not confirming"
        );

        let stored = store
            .get(&UnitId::parse(&id).unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.unit.evidence.severity, Severity::High);
        assert_eq!(stored.unit.domain, vec!["http", "payments"]);
    }

    #[tokio::test]
    async fn query_returns_the_evidence_alongside_the_advice() {
        let (store, id) = seeded().await;
        attest(&store, &other(), json!({ "id": id }), false, t(1))
            .await
            .unwrap();

        let r = query(&store, json!({ "text": "idempotency" }), t(1))
            .await
            .unwrap();
        let hit = &r["hits"][0];
        assert_eq!(hit["id"], json!(id));
        assert_eq!(hit["distinct_principals"], json!(1));
        assert_eq!(hit["status"], json!("active"));
        assert!(hit["action"].as_str().unwrap().contains("order id"));
    }

    #[tokio::test]
    async fn a_flag_requires_a_reason() {
        let (store, id) = seeded().await;
        let err = attest(&store, &other(), json!({ "id": &id }), true, t(1))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("unanswerable"), "{err}");

        let ok = attest(
            &store,
            &other(),
            json!({ "id": &id, "reason": "the provider fixed this upstream" }),
            true,
            t(1),
        )
        .await
        .unwrap();
        assert_eq!(ok["status"], json!("disputed"));
        assert!(ok["note"].as_str().unwrap().contains("still served"));
    }

    #[tokio::test]
    async fn a_malformed_id_is_refused_before_it_reaches_the_store() {
        let (store, _) = seeded().await;
        let err = attest(&store, &other(), json!({ "id": "not-an-id" }), false, t(1))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("knowledge-unit id"), "{err}");
    }

    #[tokio::test]
    async fn reflect_files_what_is_new_and_reports_what_is_known() {
        let (store, _) = seeded().await;
        let r = reflect(
            &store,
            &me(),
            json!({ "candidates": [
                {
                    "kind": "workaround",
                    "domain": ["payments"],
                    "summary": "Regenerated idempotency keys double-post a retry",
                    "detail": "x",
                    "action": "Derive the key from the order id, never the attempt."
                },
                {
                    "kind": "pitfall",
                    "domain": ["telemetry"],
                    "summary": "Histogram buckets are fixed at registration",
                    "detail": "y",
                    "action": "Choose buckets before the first observation."
                }
            ]}),
            t(2),
        )
        .await
        .unwrap();

        assert_eq!(r["considered"], json!(2));
        assert_eq!(
            r["proposed"],
            json!(1),
            "the duplicate must not be filed again"
        );
        assert_eq!(r["results"][0]["outcome"], json!("already_known"));
        assert_eq!(r["results"][1]["outcome"], json!("proposed"));
    }

    #[tokio::test]
    async fn reflect_reports_a_refusal_rather_than_dropping_the_candidate() {
        let store = LocalStore::in_memory();
        let r = reflect(
            &store,
            &me(),
            json!({ "candidates": [{
                "kind": "pitfall",
                "domain": ["api"],
                "summary": "s",
                "detail": "x".repeat(3000),
                "action": "a"
            }]}),
            t(0),
        )
        .await
        .unwrap();
        assert_eq!(r["proposed"], json!(0));
        assert_eq!(r["results"][0]["outcome"], json!("refused"));
        assert!(r["results"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("embedding"));
    }

    #[tokio::test]
    async fn status_reports_the_ladder_by_level() {
        let (store, _) = seeded().await;
        let s = status(&store, t(0)).await.unwrap();
        let by_kind = s["by_kind"].as_array().unwrap();
        assert_eq!(by_kind.len(), 4);
        assert_eq!(by_kind[1]["kind"], json!("workaround"));
        assert_eq!(by_kind[1]["level"], json!(2));
        assert_eq!(by_kind[1]["units"], json!(1));
    }

    #[tokio::test]
    async fn a_human_identity_attests_as_its_own_principal() {
        let human = Identity {
            member: "did:nostr:alice".into(),
            principal: "did:nostr:alice".into(),
            class: MemberClass::Human,
            wot: 1.0,
        };
        let a = human.attest(t(0));
        assert_eq!(a.class, MemberClass::Human);
        assert_eq!(a.principal.as_str(), "did:nostr:alice");
        assert_eq!(a.wot, 1.0);
    }
}
