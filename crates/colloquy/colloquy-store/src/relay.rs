//! Tier 3 — the public store, over the Nostr relay.
//!
//! cq's global tier is "federated, content-addressed, public-readable". Here it
//! is the relay: units are addressable `38100` events, attestations are
//! append-only `38101`/`38102` events, and the store is a projection of
//! whatever the relay returns.
//!
//! # What is different about this tier
//!
//! **There is no authoritative row.** Every read is a reconstruction from an
//! event set, which means the answer depends on which relay you asked and what
//! it chose to return. That is a property of the substrate, not a defect, and
//! the type reflects it: there is no "update in place" here, only publishing
//! another event.
//!
//! **A pubkey is not a principal.** Evidence is only counted for members the
//! registry resolves — see [`colloquy_nostr::ledger`]. Publishing to a public
//! relay is free; being a principal is not.

use async_trait::async_trait;

use colloquy_core::confidence::Assessment;
use colloquy_core::principal::Attestation;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::validate::{validate, Limits};
use colloquy_core::{Timestamp, UnitId};
use colloquy_nostr::kinds::{KIND_CONFIRMATION, KIND_FLAG, KIND_KNOWLEDGE_UNIT};
use colloquy_nostr::ledger::{reconstruct, PrincipalResolver};
use colloquy_nostr::{confirmation_event, flag_event, unit_event};
use colloquy_nostr::event::{NostrEvent, UnsignedEvent};

use crate::query::{Hit, Query, Stats};
use crate::store::{
    keyword_relevance, summarise, KnowledgeStore, StoreError, StoredUnit, StorePolicies,
};

/// A relay subscription filter, in the subset this tier needs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Filter {
    /// Event kinds.
    pub kinds: Vec<u64>,
    /// Values for the `#d` tag filter.
    pub d: Vec<String>,
    /// Values for the `#t` tag filter.
    pub t: Vec<String>,
    /// Values for the `#e` tag filter.
    pub e: Vec<String>,
    /// Maximum events.
    pub limit: usize,
}

/// The relay operations this tier needs.
#[async_trait]
pub trait RelayBackend: Send + Sync {
    /// Sign and publish an event, returning its id.
    ///
    /// Signing lives behind this boundary because the identity does: a store
    /// should not be able to reach key material, and this crate never sees any.
    async fn publish(&self, event: UnsignedEvent) -> Result<String, String>;

    /// Fetch events matching a filter. Signatures must already be verified by
    /// the implementation — everything above here assumes accepted events.
    async fn fetch(&self, filter: &Filter) -> Result<Vec<NostrEvent>, String>;

    /// The pubkey this backend publishes as.
    fn pubkey(&self) -> &str;
}

/// How many events an unfiltered projection will pull.
const FETCH_CEILING: usize = 5_000;

/// The public tier.
#[derive(Debug)]
pub struct RelayStore<B: RelayBackend, R: PrincipalResolver + Send + Sync> {
    backend: B,
    registry: R,
    policies: StorePolicies,
    limits: Limits,
}

impl<B: RelayBackend, R: PrincipalResolver + Send + Sync> RelayStore<B, R> {
    /// Bind a store to a relay and a membership registry.
    pub fn new(backend: B, registry: R) -> Self {
        Self {
            backend,
            registry,
            policies: StorePolicies::default(),
            limits: Limits::default(),
        }
    }

    /// Override the assessment policies.
    pub fn with_policies(mut self, policies: StorePolicies) -> Self {
        self.policies = policies;
        self
    }

    /// Fetch a unit's `38100` event id, which attestations must reference.
    async fn event_id_of(&self, id: &UnitId) -> Result<Option<String>, StoreError> {
        let evs = self
            .backend
            .fetch(&Filter {
                kinds: vec![KIND_KNOWLEDGE_UNIT],
                d: vec![id.hex().to_string()],
                limit: 1,
                ..Filter::default()
            })
            .await
            .map_err(StoreError::Backend)?;
        Ok(evs.first().map(|e| e.id.clone()))
    }

    /// Pull a unit and everything said about it.
    async fn project(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        let Some(event_id) = self.event_id_of(id).await? else {
            return Ok(None);
        };
        let mut events = self
            .backend
            .fetch(&Filter {
                kinds: vec![KIND_KNOWLEDGE_UNIT],
                d: vec![id.hex().to_string()],
                limit: 1,
                ..Filter::default()
            })
            .await
            .map_err(StoreError::Backend)?;
        events.extend(
            self.backend
                .fetch(&Filter {
                    kinds: vec![KIND_CONFIRMATION, KIND_FLAG],
                    e: vec![event_id.clone()],
                    limit: FETCH_CEILING,
                    ..Filter::default()
                })
                .await
                .map_err(StoreError::Backend)?,
        );

        let rec = reconstruct(&events, &self.registry);
        Ok(rec.units.get(&event_id).map(|unit| StoredUnit {
            unit: unit.clone(),
            ledger: rec.ledgers.get(&event_id).cloned().unwrap_or_default(),
        }))
    }

    async fn attest(
        &self,
        id: &UnitId,
        who: Attestation,
        flag: Option<&str>,
    ) -> Result<Assessment, StoreError> {
        let event_id = self
            .event_id_of(id)
            .await?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        let unit_author = self
            .backend
            .fetch(&Filter {
                kinds: vec![KIND_KNOWLEDGE_UNIT],
                d: vec![id.hex().to_string()],
                limit: 1,
                ..Filter::default()
            })
            .await
            .map_err(StoreError::Backend)?
            .first()
            .map(|e| e.pubkey.clone())
            .unwrap_or_default();

        let ev = match flag {
            None => confirmation_event(&event_id, &unit_author, id, &who.member, who.at, ""),
            Some(reason) => flag_event(&event_id, &unit_author, id, &who.member, who.at, reason),
        };
        self.backend.publish(ev).await.map_err(StoreError::Backend)?;

        let su = self
            .project(id)
            .await?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        Ok(su.assess(&self.policies.confirmation, &self.policies.staleness, who.at))
    }
}

#[async_trait]
impl<B: RelayBackend, R: PrincipalResolver + Send + Sync> KnowledgeStore for RelayStore<B, R> {
    fn tier(&self) -> Tier {
        Tier::Public
    }

    async fn put(&self, unit: &KnowledgeUnit, now: Timestamp) -> Result<(), StoreError> {
        validate(unit, &self.limits).map_err(|errs| {
            StoreError::Invalid(
                errs.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        })?;
        self.backend
            .publish(unit_event(unit, self.backend.pubkey(), now))
            .await
            .map_err(StoreError::Backend)?;
        Ok(())
    }

    async fn get(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        self.project(id).await
    }

    async fn query(&self, q: &Query, now: Timestamp) -> Result<Vec<Hit>, StoreError> {
        let mut events = self
            .backend
            .fetch(&Filter {
                kinds: vec![KIND_KNOWLEDGE_UNIT],
                t: q.domain.clone(),
                limit: FETCH_CEILING,
                ..Filter::default()
            })
            .await
            .map_err(StoreError::Backend)?;

        let unit_event_ids: Vec<String> = events.iter().map(|e| e.id.clone()).collect();
        if !unit_event_ids.is_empty() {
            events.extend(
                self.backend
                    .fetch(&Filter {
                        kinds: vec![KIND_CONFIRMATION, KIND_FLAG],
                        e: unit_event_ids,
                        limit: FETCH_CEILING,
                        ..Filter::default()
                    })
                    .await
                    .map_err(StoreError::Backend)?,
            );
        }

        let rec = reconstruct(&events, &self.registry);
        let mut hits = Vec::new();
        for (event_id, unit) in &rec.units {
            let mut su = StoredUnit {
                unit: unit.clone(),
                ledger: rec.ledgers.get(event_id).cloned().unwrap_or_default(),
            };
            let a = su.materialise(&self.policies.confirmation, &self.policies.staleness, now);
            if !q.admits(&su.unit, &a) {
                continue;
            }
            let relevance = keyword_relevance(&q.text, &su.unit);
            if relevance == 0.0 && !q.text.is_empty() {
                continue;
            }
            hits.push(Hit::new(su.unit, a, relevance));
        }
        hits.sort_by(|a, b| {
            b.rank
                .partial_cmp(&a.rank)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.unit.id.cmp(&b.unit.id))
        });
        hits.truncate(q.limit);
        Ok(hits)
    }

    async fn confirm(&self, id: &UnitId, who: Attestation) -> Result<Assessment, StoreError> {
        self.attest(id, who, None).await
    }

    async fn flag(&self, id: &UnitId, who: Attestation, reason: &str) -> Result<Assessment, StoreError> {
        self.attest(id, who, Some(reason)).await
    }

    async fn stats(&self, now: Timestamp) -> Result<Stats, StoreError> {
        let hits = self
            .query(
                &Query {
                    limit: FETCH_CEILING,
                    include_gap_signals: true,
                    ..Query::default()
                },
                now,
            )
            .await?;
        let stored: Vec<StoredUnit> = hits
            .into_iter()
            .map(|h| StoredUnit {
                unit: h.unit,
                ledger: Default::default(),
            })
            .collect();
        let mut stats = summarise(stored.iter(), &self.policies, now);
        // The projection above discards ledgers, so the principal count has to
        // come from the units' own materialised evidence rather than be
        // recomputed from attestations that are no longer in hand.
        stats.principals = stored
            .iter()
            .map(|s| s.unit.evidence.contributing_orgs as usize)
            .max()
            .unwrap_or(0);
        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::{Insight, UnitStatus};
    use colloquy_nostr::ledger::StaticRegistry;
    use std::sync::Mutex;

    /// An in-memory relay: publish appends, fetch filters.
    #[derive(Debug, Default)]
    struct FakeRelay {
        events: Mutex<Vec<NostrEvent>>,
        pubkey: String,
        next: Mutex<usize>,
    }

    impl FakeRelay {
        fn new(pubkey: &str) -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                pubkey: pubkey.to_string(),
                next: Mutex::new(0),
            }
        }
    }

    #[async_trait]
    impl RelayBackend for FakeRelay {
        async fn publish(&self, event: UnsignedEvent) -> Result<String, String> {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            let id = format!("ev{n}");
            self.events.lock().unwrap().push(NostrEvent {
                id: id.clone(),
                pubkey: event.pubkey,
                created_at: event.created_at,
                kind: event.kind,
                tags: event.tags,
                content: event.content,
                sig: "0".repeat(128),
            });
            Ok(id)
        }

        async fn fetch(&self, f: &Filter) -> Result<Vec<NostrEvent>, String> {
            let has = |ev: &NostrEvent, name: &str, want: &[String]| {
                want.is_empty()
                    || ev
                        .tags
                        .iter()
                        .any(|t| t.len() >= 2 && t[0] == name && want.contains(&t[1]))
            };
            Ok(self
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|ev| f.kinds.is_empty() || f.kinds.contains(&ev.kind))
                .filter(|ev| has(ev, "d", &f.d) && has(ev, "t", &f.t) && has(ev, "e", &f.e))
                .take(f.limit.max(1))
                .cloned()
                .collect())
        }

        fn pubkey(&self) -> &str {
            &self.pubkey
        }
    }

    fn pk(seed: &str) -> String {
        format!("{seed:0>64}")
    }

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn unit(proposer: &str, summary: &str) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            proposer,
            UnitKind::Workaround,
            ["payments"],
            Insight::new(summary, "detail", "action"),
            t(0),
        )
    }

    fn registry() -> StaticRegistry {
        let mut r = StaticRegistry::default();
        for a in ["one", "two", "three"] {
            r.register_agent(pk(a), format!("did:nostr:{a}"));
        }
        for a in ["s1", "s2", "s3"] {
            r.register_agent(pk(a), "did:nostr:single-operator");
        }
        r
    }

    fn store() -> RelayStore<FakeRelay, StaticRegistry> {
        RelayStore::new(FakeRelay::new(&pk("author")), registry())
    }

    #[tokio::test]
    async fn a_published_unit_projects_back() {
        let s = store();
        let u = unit("did:nostr:a", "idempotency advice");
        s.put(&u, t(0)).await.unwrap();
        let su = s.get(&u.id).await.unwrap().unwrap();
        assert_eq!(su.unit, u);
        assert_eq!(s.tier(), Tier::Public);
    }

    #[tokio::test]
    async fn confirmations_from_registered_members_accrue() {
        let s = store();
        let u = unit("did:nostr:a", "idempotency advice");
        s.put(&u, t(0)).await.unwrap();
        for a in ["one", "two"] {
            s.confirm(&u.id, Attestation::agent(pk(a), format!("did:nostr:{a}"), t(1)))
                .await
                .unwrap();
        }
        let su = s.get(&u.id).await.unwrap().unwrap();
        let a = su.assess(&Default::default(), &Default::default(), t(1));
        assert_eq!(a.distinct_principals, 2);
        assert_eq!(a.status, UnitStatus::Active);
    }

    #[tokio::test]
    async fn a_swarm_on_the_public_relay_still_collapses_to_one_principal() {
        let s = store();
        let u = unit("did:nostr:a", "idempotency advice");
        s.put(&u, t(0)).await.unwrap();
        for a in ["s1", "s2", "s3"] {
            s.confirm(&u.id, Attestation::agent(pk(a), "did:nostr:single-operator", t(1)))
                .await
                .unwrap();
        }
        let a = s
            .get(&u.id)
            .await
            .unwrap()
            .unwrap()
            .assess(&Default::default(), &Default::default(), t(1));
        assert_eq!(a.confirmations, 3);
        assert_eq!(a.distinct_principals, 1);
    }

    #[tokio::test]
    async fn an_unregistered_publisher_buys_nothing() {
        let s = store();
        let u = unit("did:nostr:a", "idempotency advice");
        s.put(&u, t(0)).await.unwrap();
        for i in 0..30 {
            s.confirm(&u.id, Attestation::agent(pk(&format!("x{i}")), "did:nostr:self", t(1)))
                .await
                .unwrap();
        }
        let a = s
            .get(&u.id)
            .await
            .unwrap()
            .unwrap()
            .assess(&Default::default(), &Default::default(), t(1));
        assert_eq!(a.distinct_principals, 0, "publishing is free; being counted is not");
    }

    #[tokio::test]
    async fn a_flag_disputes_a_public_unit_without_removing_it() {
        let s = store();
        let u = unit("did:nostr:a", "contested public advice");
        s.put(&u, t(0)).await.unwrap();
        s.confirm(&u.id, Attestation::agent(pk("one"), "did:nostr:one", t(1)))
            .await
            .unwrap();
        let a = s
            .flag(
                &u.id,
                Attestation::agent(pk("two"), "did:nostr:two", t(2)),
                "superseded upstream",
            )
            .await
            .unwrap();
        assert_eq!(a.status, UnitStatus::Disputed);
        assert_eq!(s.query(&Query::text("contested"), t(2)).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn querying_an_absent_unit_is_not_an_error() {
        let s = store();
        let id = unit("did:nostr:a", "never published").id;
        assert!(s.get(&id).await.unwrap().is_none());
        assert!(matches!(
            s.confirm(&id, Attestation::agent(pk("one"), "did:nostr:one", t(0))).await,
            Err(StoreError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn domain_filtering_uses_the_relay_indexed_t_tag() {
        let s = store();
        s.put(&unit("did:nostr:a", "payments advice"), t(0)).await.unwrap();
        assert_eq!(
            s.query(&Query::default().in_domain(["payments"]), t(0)).await.unwrap().len(),
            1
        );
        assert_eq!(
            s.query(&Query::default().in_domain(["telemetry"]), t(0)).await.unwrap().len(),
            0
        );
    }
}
