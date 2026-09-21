//! bge-small embeddings with a persistent, corruption-tolerant cache.
//!
//! The router asks the same Choice over the same ~115 skill descriptions on
//! every turn, and those descriptions change only when the image is rebuilt.
//! Embedding them per turn would put ~115 sentence encodes on the critical
//! path of every prompt, so the cache is not an optimisation, it is the
//! difference between a viable façade and an unusable one.
//!
//! The cache is JSONL: one self-contained record per line, appended under a
//! lock. That shape is why corruption is survivable — a torn or garbled line
//! is skipped on load and re-embedded, and a wholly unreadable file starts an
//! empty cache rather than taking the process down.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{FacadeError, Result};

/// A cached embedding vector, shared by reference.
pub type Vector = Arc<Vec<f32>>;

/// One cache line.
///
/// A line carries a vector (`v`), a text (`t`), or both. Rubric compression
/// (contract §10.1) is cached *beside* the embedding of the same option string
/// precisely because the two are derived from one input and are invalidated
/// together: a rubric that changes must lose both.
#[derive(Serialize, Deserialize)]
struct Record {
    k: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    v: Vec<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    t: Option<String>,
}

/// SHA-256 cache key over `model\0text`.
pub fn cache_key(model: &str, text: &str) -> String {
    let mut h = Sha256::new();
    h.update(model.as_bytes());
    h.update([0u8]);
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

/// Process-wide embedding cache with an optional JSONL backing file.
#[derive(Debug)]
pub struct EmbedCache {
    mem: RwLock<HashMap<String, Vector>>,
    texts: RwLock<HashMap<String, Arc<str>>>,
    path: Option<PathBuf>,
    writer: Mutex<()>,
}

impl EmbedCache {
    /// Load a cache from `path`, tolerating a missing, truncated or corrupt file.
    pub fn load(path: Option<&Path>) -> Self {
        let mut mem = HashMap::new();
        let mut texts: HashMap<String, Arc<str>> = HashMap::new();
        let mut skipped = 0usize;
        if let Some(p) = path {
            match std::fs::read_to_string(p) {
                Ok(text) => {
                    for line in text.lines() {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<Record>(line) {
                            Ok(r) if !r.v.is_empty() || r.t.is_some() => {
                                if let Some(t) = r.t {
                                    texts.insert(r.k.clone(), Arc::from(t.as_str()));
                                }
                                if !r.v.is_empty() {
                                    mem.insert(r.k, Arc::new(r.v));
                                }
                            }
                            _ => skipped += 1,
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => tracing::warn!(path = %p.display(), error = %e,
                    "embedding cache unreadable; starting empty"),
            }
            if skipped > 0 {
                tracing::warn!(path = %p.display(), skipped, "discarded corrupt embedding cache lines");
            }
        }
        Self {
            mem: RwLock::new(mem),
            texts: RwLock::new(texts),
            path: path.map(PathBuf::from),
            writer: Mutex::new(()),
        }
    }

    /// Embedding entries currently held in memory.
    pub fn len(&self) -> usize {
        self.mem.read().map(|m| m.len()).unwrap_or(0)
    }

    /// Whether the cache holds no embeddings.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Compressed-rubric entries currently held in memory.
    pub fn text_len(&self) -> usize {
        self.texts.read().map(|m| m.len()).unwrap_or(0)
    }

    fn get(&self, key: &str) -> Option<Vector> {
        self.mem.read().ok()?.get(key).cloned()
    }

    /// Read a cached text (a compressed rubric) by key.
    pub fn get_text(&self, key: &str) -> Option<Arc<str>> {
        self.texts.read().ok()?.get(key).cloned()
    }

    /// Store compressed rubrics, persisting them beside the embeddings.
    pub fn put_texts(&self, entries: &[(String, Arc<str>)]) {
        if entries.is_empty() {
            return;
        }
        if let Ok(mut texts) = self.texts.write() {
            for (k, v) in entries {
                texts.insert(k.clone(), v.clone());
            }
        }
        let records: Vec<Record> = entries
            .iter()
            .map(|(k, v)| Record {
                k: k.clone(),
                v: Vec::new(),
                t: Some(v.to_string()),
            })
            .collect();
        self.append(&records);
    }

    fn put(&self, entries: &[(String, Vector)]) {
        if entries.is_empty() {
            return;
        }
        if let Ok(mut mem) = self.mem.write() {
            for (k, v) in entries {
                mem.insert(k.clone(), v.clone());
            }
        }
        let records: Vec<Record> = entries
            .iter()
            .map(|(k, v)| Record {
                k: k.clone(),
                v: v.as_ref().clone(),
                t: None,
            })
            .collect();
        self.append(&records);
    }

    /// Append records under the writer lock. Persistence is best-effort.
    fn append(&self, records: &[Record]) {
        let Some(path) = &self.path else { return };
        let _guard = self.writer.lock();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut buf = String::new();
        for record in records {
            if let Ok(line) = serde_json::to_string(record) {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            // Persistence is best-effort: a read-only volume costs speed, never correctness.
            Ok(mut f) => {
                if let Err(e) = f.write_all(buf.as_bytes()) {
                    tracing::warn!(error = %e, "embedding cache write failed");
                }
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "embedding cache unopenable")
            }
        }
    }
}

/// Client for an OpenAI-shaped `/v1/embeddings` endpoint.
#[derive(Debug)]
pub struct Embedder {
    http: reqwest::Client,
    url: String,
    model: String,
    dim: usize,
    batch: usize,
    cache: EmbedCache,
}

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Deserialize)]
struct EmbedItem {
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedItem>,
}

impl Embedder {
    /// Build an embedder from resolved configuration.
    pub fn new(cfg: &crate::config::Config) -> Self {
        let http = reqwest::Client::builder()
            .timeout(cfg.embeddings_timeout)
            .build()
            .expect("reqwest client");
        Self {
            http,
            url: cfg.embeddings_url.clone(),
            model: cfg.embeddings_model.clone(),
            dim: cfg.embeddings_dim,
            batch: cfg.embeddings_batch,
            cache: EmbedCache::load(cfg.cache_path.as_deref()),
        }
    }

    /// The cache, for reporting.
    pub fn cache(&self) -> &EmbedCache {
        &self.cache
    }

    /// Embed every text, serving what it can from cache.
    ///
    /// Returns one vector per input, in input order. Duplicated inputs cost one
    /// encode. Any transport, status or dimensionality failure is surfaced as
    /// [`FacadeError::EmbeddingsUnavailable`] — never as a zero vector, which
    /// would silently rank everything equal.
    pub async fn embed_many(&self, texts: &[String]) -> Result<Vec<Vector>> {
        let keys: Vec<String> = texts.iter().map(|t| cache_key(&self.model, t)).collect();
        let mut have: HashMap<String, Vector> = HashMap::new();
        let mut missing: Vec<(String, String)> = Vec::new();
        for (key, text) in keys.iter().zip(texts) {
            if have.contains_key(key) {
                continue;
            }
            match self.cache.get(key) {
                Some(v) => {
                    have.insert(key.clone(), v);
                }
                None => {
                    if !missing.iter().any(|(k, _)| k == key) {
                        missing.push((key.clone(), text.clone()));
                    }
                }
            }
        }

        if !missing.is_empty() {
            let batches: Vec<Vec<(String, String)>> =
                missing.chunks(self.batch).map(|c| c.to_vec()).collect();
            let results =
                futures::future::try_join_all(batches.iter().map(|b| self.encode_batch(b))).await?;
            let mut fresh: Vec<(String, Vector)> = Vec::new();
            for batch in results {
                fresh.extend(batch);
            }
            self.cache.put(&fresh);
            for (k, v) in fresh {
                have.insert(k, v);
            }
        }

        keys.iter()
            .map(|k| {
                have.get(k).cloned().ok_or_else(|| {
                    FacadeError::EmbeddingsUnavailable("embeddings response was incomplete".into())
                })
            })
            .collect()
    }

    async fn encode_batch(&self, batch: &[(String, String)]) -> Result<Vec<(String, Vector)>> {
        let inputs: Vec<String> = batch.iter().map(|(_, t)| t.clone()).collect();
        let res = self
            .http
            .post(&self.url)
            .json(&EmbedRequest {
                model: &self.model,
                input: &inputs,
            })
            .send()
            .await
            .map_err(|e| {
                FacadeError::EmbeddingsUnavailable(format!(
                    "embeddings request to {} failed: {e}",
                    self.url
                ))
            })?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(FacadeError::EmbeddingsUnavailable(format!(
                "embeddings endpoint returned {status}: {}",
                body.chars().take(200).collect::<String>()
            )));
        }
        let parsed: EmbedResponse = res.json().await.map_err(|e| {
            FacadeError::EmbeddingsUnavailable(format!(
                "embeddings response was not usable JSON: {e}"
            ))
        })?;
        if parsed.data.len() != batch.len() {
            return Err(FacadeError::EmbeddingsUnavailable(format!(
                "embeddings endpoint returned {} vectors for {} inputs",
                parsed.data.len(),
                batch.len()
            )));
        }
        // The estate's Xinference endpoint numbers `index` globally when it
        // merges concurrent requests into one internal batch, so a 32-input
        // request can come back indexed 4..35 (measured 2026-09-20 against
        // bge-small on 192.168.2.132:9997). Honouring those numbers would
        // scatter vectors onto the wrong texts and silently mis-rank every
        // option — far worse than ignoring them. So the indices are trusted
        // only when they are a genuine permutation of this batch; otherwise
        // input order wins, which is what an OpenAI-shaped endpoint promises.
        let indices: Vec<usize> = parsed
            .data
            .iter()
            .enumerate()
            .map(|(i, item)| item.index.unwrap_or(i))
            .collect();
        let mut seen: Vec<bool> = vec![false; batch.len()];
        let permutation = indices
            .iter()
            .all(|index| *index < batch.len() && !std::mem::replace(&mut seen[*index], true));
        if !permutation {
            tracing::debug!(
                batch = batch.len(),
                "embeddings endpoint returned indices that are not a permutation; using input order"
            );
        }

        let mut out = Vec::with_capacity(batch.len());
        for (i, item) in parsed.data.into_iter().enumerate() {
            let slot = if permutation { indices[i] } else { i };
            let (key, _) = batch.get(slot).ok_or_else(|| {
                FacadeError::EmbeddingsUnavailable(format!(
                    "embeddings returned more vectors than inputs at position {slot}"
                ))
            })?;
            if self.dim > 0 && item.embedding.len() != self.dim {
                return Err(FacadeError::EmbeddingsUnavailable(format!(
                    "expected {}-dim embeddings, got {}",
                    self.dim,
                    item.embedding.len()
                )));
            }
            out.push((key.clone(), Arc::new(item.embedding)));
        }
        Ok(out)
    }
}

/// Cosine similarity, 0 when either vector has no magnitude.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na <= 0.0 || nb <= 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_is_one_for_identical_vectors() {
        let v = vec![0.3f32, -0.7, 1.0];
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }

    #[test]
    fn corrupt_cache_lines_are_discarded_not_fatal() {
        let dir = std::env::temp_dir().join(format!("sso-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("embeddings.jsonl");
        let good = serde_json::to_string(&Record {
            k: "aa".into(),
            v: vec![1.0, 2.0],
            t: None,
        })
        .unwrap();
        std::fs::write(&path, format!("{good}\n{{not json\n\n{{\"k\":\"bb\"}}\n")).unwrap();
        let cache = EmbedCache::load(Some(&path));
        assert_eq!(cache.len(), 1);
        assert!(cache.get("aa").is_some());
        // And it still accepts writes afterwards.
        cache.put(&[("cc".to_string(), Arc::new(vec![3.0f32]))]);
        assert_eq!(EmbedCache::load(Some(&path)).len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compressed_rubrics_persist_beside_their_embeddings() {
        let dir = std::env::temp_dir().join(format!("sso-textcache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("embeddings.jsonl");
        let cache = EmbedCache::load(Some(&path));
        cache.put(&[("k1".to_string(), Arc::new(vec![0.5f32]))]);
        cache.put_texts(&[("k1".to_string(), Arc::from("front-loaded rubric"))]);
        let reloaded = EmbedCache::load(Some(&path));
        assert_eq!(reloaded.len(), 1, "vector survived");
        assert_eq!(reloaded.text_len(), 1, "text survived");
        assert_eq!(
            reloaded.get_text("k1").as_deref(),
            Some("front-loaded rubric")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keys_are_model_scoped() {
        assert_ne!(cache_key("a", "x"), cache_key("b", "x"));
        assert_eq!(cache_key("a", "x"), cache_key("a", "x"));
    }
}
