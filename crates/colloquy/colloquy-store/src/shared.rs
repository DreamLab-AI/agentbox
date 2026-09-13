//! Tier 2 — the shared store, over vector memory.
//!
//! cq's remote tier is "Postgres + pgvector, org-scoped, hybrid keyword +
//! semantic". In this estate that is the RuVector sidecar, reached through the
//! memory MCP tools. Those tools are the deployment's business, not this
//! crate's, so the backend is a trait: [`VectorBackend`]. What lives here is the
//! mapping, which is where the mistakes are.
//!
//! # Two things the mapping has to get right
//!
//! **What gets embedded.** The payload stored under a key is the whole
//! [`StoredUnit`] — unit, ledger and all — because retrieval by key returns
//! everything. The text handed to the embedding model is only
//! [`crate::store::searchable_text`], which `colloquy_core::validate` already
//! bounds to the model's window. So nothing is ever silently unsearchable: the
//! validated string and the embedded string are the same string.
//!
//! **Bulk writes degrade the index.** Vector indexes in this estate lose recall
//! under bulk churn and have to be rebuilt serially afterwards. [`SharedStore`]
//! does not hide that: [`SharedStore::bulk_put`] exists precisely so a caller
//! has one obvious place to notice they are about to need a rebuild, rather
//! than discovering it after a thousand single `put` calls.

use async_trait::async_trait;

use colloquy_core::confidence::Assessment;
use colloquy_core::principal::Attestation;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::validate::{validate, Limits};
use colloquy_core::{Timestamp, UnitId};

use crate::query::{Hit, Query, Stats};
use crate::store::{
    searchable_text, summarise, KnowledgeStore, StoreError, StoredUnit, StorePolicies,
};

/// The vector-memory operations the shared tier needs.
///
/// Deliberately four methods and no more: anything richer would leak the
/// backing store's shape into the mapping, which is what the adapter contract
/// exists to prevent.
#[async_trait]
pub trait VectorBackend: Send + Sync {
    /// Write `payload` under `key`, embedding `text` for semantic search.
    async fn upsert(&self, namespace: &str, key: &str, text: &str, payload: &str) -> Result<(), String>;

    /// Fetch a payload by key. Returns the whole value, not an embedded prefix.
    async fn get(&self, namespace: &str, key: &str) -> Result<Option<String>, String>;

    /// Semantic search. Returns `(key, payload, similarity)` ordered by
    /// descending similarity.
    async fn search(
        &self,
        namespace: &str,
        text: &str,
        limit: usize,
    ) -> Result<Vec<(String, String, f64)>, String>;

    /// Every `(key, payload)` in the namespace, up to `limit`.
    async fn list(&self, namespace: &str, limit: usize) -> Result<Vec<(String, String)>, String>;
}

/// How many units `stats` and unfiltered queries will walk.
const LIST_CEILING: usize = 10_000;

/// The shared tier.
#[derive(Debug)]
pub struct SharedStore<B: VectorBackend> {
    backend: B,
    namespace: String,
    policies: StorePolicies,
    limits: Limits,
}

impl<B: VectorBackend> SharedStore<B> {
    /// Bind a store to a namespace.
    ///
    /// The namespace is its own, never an existing one grown a schema: mixing
    /// units into a namespace that a recall band is measured against moves the
    /// band, and then neither number means anything.
    pub fn new(backend: B, namespace: impl Into<String>) -> Self {
        Self {
            backend,
            namespace: namespace.into(),
            policies: StorePolicies::default(),
            limits: Limits::default(),
        }
    }

    /// Override the assessment policies.
    pub fn with_policies(mut self, policies: StorePolicies) -> Self {
        self.policies = policies;
        self
    }

    /// The namespace this store writes to.
    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    async fn read(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        let raw = self
            .backend
            .get(&self.namespace, id.as_str())
            .await
            .map_err(StoreError::Backend)?;
        raw.map(|r| serde_json::from_str(&r).map_err(|e| StoreError::Corrupt(e.to_string())))
            .transpose()
    }

    async fn write(&self, su: &StoredUnit) -> Result<(), StoreError> {
        let payload = serde_json::to_string(su).map_err(|e| StoreError::Backend(e.to_string()))?;
        self.backend
            .upsert(
                &self.namespace,
                su.unit.id.as_str(),
                &searchable_text(&su.unit),
                &payload,
            )
            .await
            .map_err(StoreError::Backend)
    }

    /// Write many units in one pass.
    ///
    /// Returns the number written. **After this returns, the namespace's vector
    /// index needs a serial, non-concurrent rebuild** — a bulk write is exactly
    /// the churn that degrades recall, and the rebuild is not something this
    /// crate can do on the caller's behalf.
    pub async fn bulk_put(&self, units: &[KnowledgeUnit], now: Timestamp) -> Result<usize, StoreError> {
        let mut n = 0;
        for u in units {
            self.put(u, now).await?;
            n += 1;
        }
        Ok(n)
    }

    async fn attest(
        &self,
        id: &UnitId,
        who: Attestation,
        flag: Option<&str>,
    ) -> Result<Assessment, StoreError> {
        let mut su = self
            .read(id)
            .await?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        let at = who.at;
        if flag.is_some() {
            su.ledger.flag(who);
        } else {
            su.ledger.confirm(who);
        }
        let a = su.materialise(&self.policies.confirmation, &self.policies.staleness, at);
        self.write(&su).await?;
        Ok(a)
    }
}

#[async_trait]
impl<B: VectorBackend> KnowledgeStore for SharedStore<B> {
    fn tier(&self) -> Tier {
        Tier::Shared
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
        // Preserve any existing ledger, exactly as the local tier does.
        let ledger = self.read(&unit.id).await?.map(|s| s.ledger).unwrap_or_default();
        let mut su = StoredUnit {
            unit: unit.clone(),
            ledger,
        };
        su.materialise(&self.policies.confirmation, &self.policies.staleness, now);
        self.write(&su).await
    }

    async fn get(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        self.read(id).await
    }

    async fn query(&self, q: &Query, now: Timestamp) -> Result<Vec<Hit>, StoreError> {
        // An empty query is a browse, not a search: asking a vector index for
        // the nearest neighbours of "" returns arbitrary rows.
        let raw = if q.text.is_empty() {
            self.backend
                .list(&self.namespace, LIST_CEILING)
                .await
                .map_err(StoreError::Backend)?
                .into_iter()
                .map(|(k, p)| (k, p, 1.0))
                .collect()
        } else {
            self.backend
                .search(&self.namespace, &q.text, q.limit.max(1) * 4)
                .await
                .map_err(StoreError::Backend)?
        };

        let mut hits = Vec::new();
        for (_, payload, similarity) in raw {
            let mut su: StoredUnit =
                serde_json::from_str(&payload).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let a = su.materialise(&self.policies.confirmation, &self.policies.staleness, now);
            if !q.admits(&su.unit, &a) {
                continue;
            }
            hits.push(Hit::new(su.unit, a, similarity.clamp(0.0, 1.0)));
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
        let rows = self
            .backend
            .list(&self.namespace, LIST_CEILING)
            .await
            .map_err(StoreError::Backend)?;
        let mut units = Vec::with_capacity(rows.len());
        for (_, payload) in rows {
            units.push(
                serde_json::from_str::<StoredUnit>(&payload)
                    .map_err(|e| StoreError::Corrupt(e.to_string()))?,
            );
        }
        Ok(summarise(units.iter(), &self.policies, now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::{Insight, UnitStatus};
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    /// A backend that records what it was asked to embed, so the mapping's
    /// most important property can actually be asserted.
    #[derive(Debug, Default)]
    struct FakeVectors {
        rows: Mutex<BTreeMap<String, (String, String)>>, // key -> (embedded text, payload)
    }

    #[async_trait]
    impl VectorBackend for FakeVectors {
        async fn upsert(&self, _ns: &str, key: &str, text: &str, payload: &str) -> Result<(), String> {
            self.rows
                .lock()
                .unwrap()
                .insert(key.to_string(), (text.to_string(), payload.to_string()));
            Ok(())
        }

        async fn get(&self, _ns: &str, key: &str) -> Result<Option<String>, String> {
            Ok(self.rows.lock().unwrap().get(key).map(|(_, p)| p.clone()))
        }

        async fn search(
            &self,
            _ns: &str,
            text: &str,
            limit: usize,
        ) -> Result<Vec<(String, String, f64)>, String> {
            // Crude stand-in for cosine similarity: word overlap. Enough to
            // exercise the mapping, and honest about being a fake.
            let want: Vec<String> = text.to_lowercase().split_whitespace().map(str::to_string).collect();
            let mut out: Vec<(String, String, f64)> = self
                .rows
                .lock()
                .unwrap()
                .iter()
                .map(|(k, (t, p))| {
                    let hay = t.to_lowercase();
                    let hits = want.iter().filter(|w| hay.contains(w.as_str())).count();
                    (k.clone(), p.clone(), hits as f64 / want.len().max(1) as f64)
                })
                .filter(|(_, _, s)| *s > 0.0)
                .collect();
            out.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
            out.truncate(limit);
            Ok(out)
        }

        async fn list(&self, _ns: &str, limit: usize) -> Result<Vec<(String, String)>, String> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .take(limit)
                .map(|(k, (_, p))| (k.clone(), p.clone()))
                .collect())
        }
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

    fn store() -> SharedStore<FakeVectors> {
        SharedStore::new(FakeVectors::default(), "colloquy")
    }

    #[tokio::test]
    async fn the_embedded_text_is_the_validated_text_and_the_payload_is_everything() {
        let s = store();
        let u = unit("did:nostr:a", "idempotency keys must be stable");
        s.put(&u, t(0)).await.unwrap();

        let rows = s.backend.rows.lock().unwrap().clone();
        let (embedded, payload) = rows.get(u.id.as_str()).unwrap();
        assert_eq!(*embedded, searchable_text(&u), "embedded text must be the bounded one");
        let su: StoredUnit = serde_json::from_str(payload).unwrap();
        assert_eq!(su.unit, u, "payload must carry the whole unit");
        assert!(payload.contains("ledger"), "and its ledger");
    }

    #[tokio::test]
    async fn a_namespace_is_its_own() {
        assert_eq!(store().namespace(), "colloquy");
    }

    #[tokio::test]
    async fn search_ranks_by_relevance_and_evidence_together() {
        let s = store();
        let weak = unit("did:nostr:a", "idempotency keys must be stable");
        let strong = unit("did:nostr:b", "idempotency keys must be stable");
        s.put(&weak, t(0)).await.unwrap();
        s.put(&strong, t(0)).await.unwrap();
        for p in ["x", "y", "z"] {
            s.confirm(&strong.id, Attestation::agent(p, format!("did:nostr:{p}"), t(1)))
                .await
                .unwrap();
        }

        let hits = s.query(&Query::text("idempotency"), t(1)).await.unwrap();
        assert_eq!(hits[0].unit.id, strong.id);
    }

    #[tokio::test]
    async fn an_empty_query_lists_rather_than_searching_nothing() {
        let s = store();
        s.put(&unit("did:nostr:a", "one"), t(0)).await.unwrap();
        s.put(&unit("did:nostr:b", "two"), t(0)).await.unwrap();
        assert_eq!(s.query(&Query::default(), t(0)).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn flagging_disputes_a_unit_and_it_stays_retrievable() {
        let s = store();
        let u = unit("did:nostr:a", "contested advice");
        s.put(&u, t(0)).await.unwrap();
        s.confirm(&u.id, Attestation::agent("m", "did:nostr:p", t(1)))
            .await
            .unwrap();
        let a = s
            .flag(&u.id, Attestation::agent("c", "did:nostr:q", t(2)), "wrong")
            .await
            .unwrap();
        assert_eq!(a.status, UnitStatus::Disputed);
        assert_eq!(s.query(&Query::text("contested"), t(2)).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_rewrite_preserves_the_ledger_here_too() {
        let s = store();
        let u = unit("did:nostr:a", "first wording of the advice");
        s.put(&u, t(0)).await.unwrap();
        s.flag(&u.id, Attestation::agent("c", "did:nostr:q", t(1)), "doubt")
            .await
            .unwrap();
        s.put(&u, t(2)).await.unwrap();
        assert_eq!(s.get(&u.id).await.unwrap().unwrap().ledger.flags.len(), 1);
    }

    #[tokio::test]
    async fn bulk_put_writes_everything_and_is_the_one_place_to_notice_the_rebuild() {
        let s = store();
        let units: Vec<_> = (0..25)
            .map(|i| unit(&format!("did:nostr:{i}"), &format!("unit number {i}")))
            .collect();
        assert_eq!(s.bulk_put(&units, t(0)).await.unwrap(), 25);
        assert_eq!(s.stats(t(0)).await.unwrap().units, 25);
    }

    #[tokio::test]
    async fn a_corrupt_payload_is_reported_not_skipped() {
        let s = store();
        s.backend
            .rows
            .lock()
            .unwrap()
            .insert("ku_000000000000".into(), ("text".into(), "{not json".into()));
        assert!(matches!(s.stats(t(0)).await, Err(StoreError::Corrupt(_))));
    }
}
