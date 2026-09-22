//! Tier 1 — the local store: a file, an append log, and no network.
//!
//! cq's local tier is "private, offline-capable, keyword only". This is that:
//! an append-only JSON-lines log that is replayed on open, with the live state
//! held in memory. Append-only matters for the same reason it does on the
//! relay — a correction to a unit must not be able to erase the evidence
//! others accumulated against the version it replaced.
//!
//! The file is optional. Without one the store is purely in-memory, which is
//! what a throwaway agent profile wants.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

use colloquy_core::confidence::Assessment;
use colloquy_core::principal::Attestation;
use colloquy_core::unit::{KnowledgeUnit, Tier};
use colloquy_core::validate::{validate, Limits};
use colloquy_core::{Timestamp, UnitId};

use crate::query::{Hit, Query, Stats};
use crate::store::{
    keyword_relevance, summarise, KnowledgeStore, StoreError, StorePolicies, StoredUnit,
};

/// One line of the append log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Record {
    /// A unit was written or rewritten.
    Put { unit: Box<KnowledgeUnit> },
    /// Someone confirmed a unit.
    Confirm { id: UnitId, who: Box<Attestation> },
    /// Someone flagged a unit.
    Flag {
        id: UnitId,
        who: Box<Attestation>,
        reason: String,
    },
}

/// The offline, private tier.
#[derive(Debug)]
pub struct LocalStore {
    state: RwLock<BTreeMap<UnitId, StoredUnit>>,
    path: Option<PathBuf>,
    policies: StorePolicies,
    limits: Limits,
}

impl LocalStore {
    /// An in-memory store with no file behind it.
    pub fn in_memory() -> Self {
        Self {
            state: RwLock::new(BTreeMap::new()),
            path: None,
            policies: StorePolicies::default(),
            limits: Limits::default(),
        }
    }

    /// Open a store backed by `path`, replaying it if it exists.
    ///
    /// A line that fails to parse stops the replay with [`StoreError::Corrupt`]
    /// rather than being skipped: a partially replayed log is a store that
    /// silently disagrees with its own file, which is worse than one that
    /// refuses to open.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        let mut store = Self {
            state: RwLock::new(BTreeMap::new()),
            path: Some(path.clone()),
            policies: StorePolicies::default(),
            limits: Limits::default(),
        };
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let text = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| StoreError::Backend(e.to_string()))?;
            let mut state = BTreeMap::new();
            for (n, line) in text.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                let rec: Record = serde_json::from_str(line)
                    .map_err(|e| StoreError::Corrupt(format!("line {}: {e}", n + 1)))?;
                apply(&mut state, rec);
            }
            store.state = RwLock::new(state);
        }
        Ok(store)
    }

    /// Override the assessment policies.
    pub fn with_policies(mut self, policies: StorePolicies) -> Self {
        self.policies = policies;
        self
    }

    /// Override the validation limits.
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    async fn append(&self, rec: &Record) -> Result<(), StoreError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let line = serde_json::to_string(rec).map_err(|e| StoreError::Backend(e.to_string()))?;
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        f.write_all(line.as_bytes())
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        f.write_all(b"\n")
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        Ok(())
    }

    async fn attest(
        &self,
        id: &UnitId,
        who: Attestation,
        flag: Option<&str>,
    ) -> Result<Assessment, StoreError> {
        let rec = match flag {
            None => Record::Confirm {
                id: id.clone(),
                who: Box::new(who.clone()),
            },
            Some(reason) => Record::Flag {
                id: id.clone(),
                who: Box::new(who.clone()),
                reason: reason.to_string(),
            },
        };

        let mut state = self.state.write().await;
        let su = state
            .get_mut(id)
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        let at = who.at;
        if flag.is_some() {
            su.ledger.flag(who);
        } else {
            su.ledger.confirm(who);
        }
        let a = su.materialise(&self.policies.confirmation, &self.policies.staleness, at);
        drop(state);

        self.append(&rec).await?;
        Ok(a)
    }
}

/// Fold one record into the live state.
fn apply(state: &mut BTreeMap<UnitId, StoredUnit>, rec: Record) {
    match rec {
        Record::Put { unit } => {
            // Replacing a unit keeps its ledger: evidence belongs to the unit's
            // identity, not to a particular wording of it.
            let ledger = state
                .get(&unit.id)
                .map(|s| s.ledger.clone())
                .unwrap_or_default();
            state.insert(
                unit.id.clone(),
                StoredUnit {
                    unit: *unit,
                    ledger,
                },
            );
        }
        Record::Confirm { id, who } => {
            if let Some(s) = state.get_mut(&id) {
                s.ledger.confirm(*who);
            }
        }
        Record::Flag { id, who, .. } => {
            if let Some(s) = state.get_mut(&id) {
                s.ledger.flag(*who);
            }
        }
    }
}

#[async_trait]
impl KnowledgeStore for LocalStore {
    fn tier(&self) -> Tier {
        Tier::Local
    }

    async fn put(&self, unit: &KnowledgeUnit, _now: Timestamp) -> Result<(), StoreError> {
        validate(unit, &self.limits).map_err(|errs| {
            StoreError::Invalid(
                errs.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        })?;
        let rec = Record::Put {
            unit: Box::new(unit.clone()),
        };
        {
            let mut state = self.state.write().await;
            apply(&mut state, rec.clone());
        }
        self.append(&rec).await
    }

    async fn get(&self, id: &UnitId) -> Result<Option<StoredUnit>, StoreError> {
        Ok(self.state.read().await.get(id).cloned())
    }

    async fn query(&self, q: &Query, now: Timestamp) -> Result<Vec<Hit>, StoreError> {
        let state = self.state.read().await;
        let mut hits: Vec<Hit> = state
            .values()
            .filter_map(|su| {
                let a = su.assess(&self.policies.confirmation, &self.policies.staleness, now);
                if !q.admits(&su.unit, &a) {
                    return None;
                }
                let relevance = keyword_relevance(&q.text, &su.unit);
                if relevance == 0.0 && !q.text.is_empty() {
                    return None;
                }
                // Hand back a unit whose evidence block reflects the ledger,
                // rather than the draft numbers it was written with.
                let mut materialised = su.clone();
                materialised.materialise(
                    &self.policies.confirmation,
                    &self.policies.staleness,
                    now,
                );
                Some(Hit::new(materialised.unit, a, relevance))
            })
            .collect();

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

    async fn flag(
        &self,
        id: &UnitId,
        who: Attestation,
        reason: &str,
    ) -> Result<Assessment, StoreError> {
        self.attest(id, who, Some(reason)).await
    }

    async fn stats(&self, now: Timestamp) -> Result<Stats, StoreError> {
        let state = self.state.read().await;
        Ok(summarise(state.values(), &self.policies, now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::kind::UnitKind;
    use colloquy_core::unit::{Insight, UnitStatus};

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn unit(proposer: &str, summary: &str, domain: &[&str]) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            proposer,
            UnitKind::Workaround,
            domain.to_vec(),
            Insight::new(summary, "detail text", "action text"),
            t(0),
        )
    }

    #[tokio::test]
    async fn a_unit_round_trips_and_is_found_by_keyword() {
        let s = LocalStore::in_memory();
        let u = unit(
            "did:nostr:a",
            "idempotency key regenerated on retry",
            &["payments"],
        );
        s.put(&u, t(0)).await.unwrap();

        assert_eq!(s.get(&u.id).await.unwrap().unwrap().unit, u);
        let hits = s.query(&Query::text("idempotency"), t(0)).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].unit.id, u.id);

        assert!(s
            .query(&Query::text("unrelated"), t(0))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn an_invalid_unit_is_refused_with_every_reason() {
        let s = LocalStore::in_memory();
        let mut u = unit("did:nostr:a", "s", &["api"]);
        u.insight.detail = "x".repeat(3_000);
        let err = s.put(&u, t(0)).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("embedding model"), "{msg}");
        assert!(s.get(&u.id).await.unwrap().is_none(), "nothing was written");
    }

    #[tokio::test]
    async fn confirming_moves_a_draft_to_active_and_flagging_disputes_it() {
        let s = LocalStore::in_memory();
        let u = unit("did:nostr:a", "summary here", &["api"]);
        s.put(&u, t(0)).await.unwrap();

        let a = s
            .confirm(&u.id, Attestation::agent("m", "did:nostr:one", t(1)))
            .await
            .unwrap();
        assert_eq!(a.status, UnitStatus::Active);
        assert_eq!(
            s.get(&u.id).await.unwrap().unwrap().unit.lifecycle.status,
            UnitStatus::Active
        );

        let a = s
            .flag(
                &u.id,
                Attestation::agent("c", "did:nostr:two", t(2)),
                "stale",
            )
            .await
            .unwrap();
        assert_eq!(a.status, UnitStatus::Disputed);

        // Disputed is still served — that is the whole point.
        assert_eq!(s.query(&Query::default(), t(2)).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn attesting_to_an_absent_unit_says_so() {
        let s = LocalStore::in_memory();
        let id = unit("did:nostr:a", "x", &["api"]).id;
        let err = s
            .confirm(&id, Attestation::agent("m", "did:nostr:p", t(0)))
            .await;
        assert!(matches!(err, Err(StoreError::NotFound(_))));
    }

    #[tokio::test]
    async fn rewriting_a_unit_preserves_the_evidence_against_it() {
        let s = LocalStore::in_memory();
        let u = unit("did:nostr:a", "first wording", &["api"]);
        s.put(&u, t(0)).await.unwrap();
        s.confirm(&u.id, Attestation::agent("m", "did:nostr:p", t(1)))
            .await
            .unwrap();
        s.flag(&u.id, Attestation::agent("c", "did:nostr:q", t(2)), "wrong")
            .await
            .unwrap();

        // The same unit id, written again.
        s.put(&u, t(3)).await.unwrap();
        let su = s.get(&u.id).await.unwrap().unwrap();
        assert_eq!(su.ledger.confirmations.len(), 1);
        assert_eq!(su.ledger.flags.len(), 1, "a rewrite must not erase a flag");
    }

    #[tokio::test]
    async fn ranking_puts_the_better_evidenced_unit_first() {
        let s = LocalStore::in_memory();
        let weak = unit("did:nostr:a", "retry handling advice", &["api"]);
        let strong = unit("did:nostr:b", "retry handling advice", &["api"]);
        s.put(&weak, t(0)).await.unwrap();
        s.put(&strong, t(0)).await.unwrap();
        for p in ["x", "y", "z"] {
            s.confirm(
                &strong.id,
                Attestation::agent(p, format!("did:nostr:{p}"), t(1)),
            )
            .await
            .unwrap();
        }
        s.confirm(&weak.id, Attestation::agent("w", "did:nostr:w", t(1)))
            .await
            .unwrap();

        let hits = s.query(&Query::text("retry"), t(1)).await.unwrap();
        assert_eq!(hits[0].unit.id, strong.id);
        assert!(hits[0].rank > hits[1].rank);
    }

    #[tokio::test]
    async fn the_log_replays_into_the_same_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("colloquy.jsonl");

        let u = unit("did:nostr:a", "persisted unit", &["api"]);
        {
            let s = LocalStore::open(&path).await.unwrap();
            s.put(&u, t(0)).await.unwrap();
            s.confirm(&u.id, Attestation::agent("m", "did:nostr:p", t(1)))
                .await
                .unwrap();
            s.flag(&u.id, Attestation::agent("c", "did:nostr:q", t(2)), "doubt")
                .await
                .unwrap();
        }

        let reopened = LocalStore::open(&path).await.unwrap();
        let su = reopened.get(&u.id).await.unwrap().unwrap();
        assert_eq!(su.unit, u);
        assert_eq!(su.ledger.confirmations.len(), 1);
        assert_eq!(su.ledger.flags.len(), 1);
    }

    #[tokio::test]
    async fn a_corrupt_log_refuses_to_open_rather_than_half_loading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("colloquy.jsonl");
        tokio::fs::write(&path, "{\"op\":\"put\",\"unit\":{}}\nnot json\n")
            .await
            .unwrap();
        assert!(matches!(
            LocalStore::open(&path).await,
            Err(StoreError::Corrupt(_))
        ));
    }

    #[tokio::test]
    async fn stats_report_the_ladder_and_the_principals() {
        let s = LocalStore::in_memory();
        let u = unit("did:nostr:a", "a unit", &["api"]);
        s.put(&u, t(0)).await.unwrap();
        for p in ["x", "y"] {
            s.confirm(&u.id, Attestation::agent(p, format!("did:nostr:{p}"), t(1)))
                .await
                .unwrap();
        }
        let st = s.stats(t(1)).await.unwrap();
        assert_eq!((st.units, st.servable, st.principals), (1, 1, 2));
        assert_eq!(st.by_kind[1], (UnitKind::Workaround, 1));
    }
}
