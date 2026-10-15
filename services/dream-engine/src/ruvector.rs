use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum RuVectorError {
    #[error("embedding error: {0}")]
    Embedding(String),
    #[error("database error: {0}")]
    Pool(#[from] sqlx::Error),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("validation: {0}")]
    Validation(String),
}

#[derive(Debug, Clone)]
pub struct RuVectorConfig {
    /// postgres://user:pass@host:port/db
    pub pg_url: String,
    pub xinference_url: String,
    /// e.g. "dream-cycle"
    pub namespace: String,
}

#[derive(Debug, Clone)]
pub struct DreamFinding {
    /// e.g. "2026-08-15-dream-machine"
    pub night_id: String,
    pub repo: String,
    pub date: String,
    pub deep: String,
    pub finding: String,
    /// "ACCEPT" | "REJECT" | "INCONCLUSIVE"
    pub verdict: String,
    pub witness: String,
    /// e.g. "hp-annexe-glm-5.3"
    pub source: String,
}

const EMBEDDING_MODEL: &str = "bge-small-en-v1.5";
const EMBEDDING_DIMS: usize = 384;

/// Refuse any embedding that is not exactly [`EMBEDDING_DIMS`] floats. Called
/// on the write path before a connection is opened, so a wrong-model or
/// truncated vector can never reach the HNSW index.
fn check_dims(embedding: &[f32]) -> Result<(), RuVectorError> {
    if embedding.len() != EMBEDDING_DIMS {
        return Err(RuVectorError::Validation(format!(
            "expected {} embedding dims, got {}",
            EMBEDDING_DIMS,
            embedding.len()
        )));
    }
    Ok(())
}

/// Whether a verdict clears the storage bar at all (everything except the
/// operational `BLOCKED-ENV` / `HANDOFF`).
pub fn stores(verdict: &str) -> bool {
    importance_for(verdict).is_some()
}

/// Decisive verdicts get high importance; INCONCLUSIVE nights are stored too
/// (at lower importance) — their operational lessons (evaluator traps, false
/// positives) are exactly what day-time agents need recalled. Only
/// BLOCKED-ENV is excluded: a broken harness is operational state, not
/// knowledge, and it already alerts via the dream inbox.
fn importance_for(verdict: &str) -> Option<f64> {
    match verdict.to_uppercase().as_str() {
        "ACCEPT" => Some(0.9),
        "REJECT" => Some(0.7),
        "INCONCLUSIVE" => Some(0.4),
        _ => None,
    }
}

/// Format an embedding vector as a ruvector literal: "[0.123,0.456,...]".
fn format_vector(embedding: &[f32]) -> String {
    let mut out = String::with_capacity(embedding.len() * 8 + 2);
    out.push('[');
    for (i, v) in embedding.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&v.to_string());
    }
    out.push(']');
    out
}

// --- xinference embeddings (OpenAI embeddings format) ---

#[derive(Serialize)]
struct EmbeddingRequest {
    model: String,
    input: String,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Option<Vec<EmbeddingData>>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

async fn fetch_embedding(cfg: &RuVectorConfig, text: &str) -> Result<Vec<f32>, RuVectorError> {
    let client = Client::builder().timeout(Duration::from_secs(30)).build()?;

    let body = EmbeddingRequest {
        model: EMBEDDING_MODEL.into(),
        input: text.into(),
    };

    let resp = client
        .post(format!("{}/v1/embeddings", cfg.xinference_url))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let raw = resp.text().await?;
    info!(bytes = raw.len(), http_status = %status, "xinference embedding response received");

    if !status.is_success() {
        return Err(RuVectorError::Embedding(format!(
            "HTTP {}: {}",
            status,
            &raw[..raw.len().min(500)]
        )));
    }

    let parsed: EmbeddingResponse = serde_json::from_str(&raw).map_err(|e| {
        RuVectorError::Embedding(format!("JSON parse error ({}B): {}", raw.len(), e))
    })?;

    if let Some(err) = parsed.error {
        return Err(RuVectorError::Embedding(format!("API error: {}", err)));
    }

    let data = parsed
        .data
        .and_then(|d| d.into_iter().next())
        .ok_or_else(|| RuVectorError::Embedding("no embedding data in response".into()))?;

    Ok(data.embedding)
}

/// Ensure the dream-cycle project row exists; return its id.
/// SELECT-first pattern: the id sequence has been out of sync before, so never
/// rely on the sequence — read the existing row and only INSERT when absent.
async fn ensure_project(pool: &sqlx::PgPool) -> Result<i32, RuVectorError> {
    if let Some((id,)) =
        sqlx::query_as::<_, (i32,)>("SELECT id FROM projects WHERE name = 'dream-cycle'")
            .fetch_optional(pool)
            .await?
    {
        return Ok(id);
    }

    let (id,): (i32,) = sqlx::query_as(
        "INSERT INTO projects \
         (name, path, description, total_entries, total_patterns, created_at, updated_at) \
         VALUES ('dream-cycle', '/dream-cycle', 'Nightly dream-machine findings', 0, 0, NOW(), NOW()) \
         RETURNING id",
    )
    .fetch_one(pool)
    .await?;

    Ok(id)
}

/// Persist a dream-cycle finding into RuVector.
///
/// Returns `Ok(false)` when skipped by the significance bar (verdict not
/// ACCEPT/REJECT), `Ok(true)` when stored.
pub async fn store_finding(cfg: &RuVectorConfig, f: &DreamFinding) -> Result<bool, RuVectorError> {
    // 1. Storage bar: everything except BLOCKED-ENV (operational, not knowledge).
    let Some(importance) = importance_for(&f.verdict) else {
        info!(
            verdict = %f.verdict,
            night_id = %f.night_id,
            "skipping finding (verdict is operational, not knowledge)"
        );
        return Ok(false);
    };

    // 2. Embedding from xinference, validated to exactly 384 floats.
    let embed_input = format!("{}: {}", f.deep, f.finding);
    let embedding = fetch_embedding(cfg, &embed_input).await?;
    check_dims(&embedding)?;
    let embedding_literal = format_vector(&embedding);
    let embedding_json = serde_json::json!(embedding);

    // 3. Connect (single connection, short acquire timeout).
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&cfg.pg_url)
        .await?;

    // 4. Ensure the project row.
    let project_id = ensure_project(&pool).await?;

    // 5. Build key / value / metadata.
    let key = format!("dream-{}", f.night_id);
    let verdict_upper = f.verdict.to_uppercase();

    let value = serde_json::json!({
        "repo": f.repo,
        "date": f.date,
        "deep": f.deep,
        "finding": f.finding,
        "verdict": f.verdict,
        "witness": f.witness,
        "source": f.source,
    });

    let metadata = serde_json::json!({
        "importance": importance,
        "tags": ["dream-cycle", f.deep, verdict_upper.to_lowercase()],
        "memory_type": "semantic",
        "source": f.source,
    });

    // 6. Upsert on id. Runtime queries only — no DATABASE_URL at build time.
    sqlx::query(
        "INSERT INTO memory_entries \
         (id, project_id, namespace, key, value, embedding, embedding_json, metadata, source_type, access_count, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::ruvector, $7::jsonb, $8::jsonb, $9, 0, NOW(), NOW()) \
         ON CONFLICT (id) DO UPDATE SET \
           value = $5::jsonb, \
           embedding = $6::ruvector, \
           embedding_json = $7::jsonb, \
           metadata = $8::jsonb, \
           updated_at = NOW()",
    )
    .bind(&key)
    .bind(project_id)
    .bind(&cfg.namespace)
    .bind(&key)
    .bind(&value)
    .bind(&embedding_literal)
    .bind(&embedding_json)
    .bind(&metadata)
    .bind("dream-cycle")
    .execute(&pool)
    .await?;

    info!(
        key = %key,
        namespace = %cfg.namespace,
        project = project_id,
        "stored {} in {} (project {})",
        key,
        cfg.namespace,
        project_id
    );

    Ok(true)
}

// --- dream-core seam ---

use dream_core::seams::{BoxFut, MemoryRecord, MemorySink, SinkError};

/// `MemoryRecord.kind` carries the deep slot (it is a host-chosen label), and
/// `MemoryRecord.body` this JSON payload, so the row stored in RuVector keeps
/// every field it had before the extraction (`witness`, `source`, `date`) even
/// though the seam's record has no slot for them.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Payload {
    finding: String,
    witness: String,
    source: String,
    date: String,
}

/// The seam record for a finding.
pub fn record_for(f: &DreamFinding) -> MemoryRecord {
    MemoryRecord {
        key: format!("dream-{}", f.night_id),
        kind: f.deep.clone(),
        repo: f.repo.clone(),
        night_id: f.night_id.clone(),
        verdict: f.verdict.clone(),
        body: serde_json::to_string(&Payload {
            finding: f.finding.clone(),
            witness: f.witness.clone(),
            source: f.source.clone(),
            date: f.date.clone(),
        })
        .unwrap_or_default(),
    }
}

/// Invert [`record_for`].
fn finding_from(rec: &MemoryRecord) -> Result<DreamFinding, SinkError> {
    let p: Payload = serde_json::from_str(&rec.body)
        .map_err(|e| SinkError(format!("unreadable dream payload: {e}")))?;
    Ok(DreamFinding {
        night_id: rec.night_id.clone(),
        repo: rec.repo.clone(),
        date: p.date,
        deep: rec.kind.clone(),
        finding: p.finding,
        verdict: rec.verdict.clone(),
        witness: p.witness,
        source: p.source,
    })
}

/// RuVector as a `dream_core` memory.
///
/// **Documented exception to "memory goes through the MCP tools":** this
/// engine writes `memory_entries` by direct SQL. It is a Rust daemon outside
/// the MCP hook path and it embeds client-side, so the write mirrors what the
/// MCP embedding pipeline does: `bge-small-en-v1.5` via Xinference, asserted to
/// be exactly 384 dimensions on every write ([`check_dims`], before any SQL).
#[derive(Debug, Clone)]
pub struct RuVectorSink {
    cfg: RuVectorConfig,
}

impl RuVectorSink {
    /// A sink writing with `cfg`.
    pub fn new(cfg: RuVectorConfig) -> Self {
        Self { cfg }
    }
}

impl MemorySink for RuVectorSink {
    fn record<'a>(&'a self, rec: &'a MemoryRecord) -> BoxFut<'a, Result<(), SinkError>> {
        Box::pin(async move {
            let f = finding_from(rec)?;
            store_finding(&self.cfg, &f)
                .await
                .map(|_| ())
                .map_err(|e| SinkError(e.to_string()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn importance_tiers() {
        assert_eq!(importance_for("ACCEPT"), Some(0.9));
        assert_eq!(importance_for("Reject"), Some(0.7));
        assert_eq!(importance_for("inconclusive"), Some(0.4));
        // Operational verdicts are not knowledge.
        assert_eq!(importance_for("BLOCKED-ENV"), None);
        assert_eq!(importance_for(""), None);
    }

    #[test]
    fn vector_formatting() {
        assert_eq!(format_vector(&[]), "[]");
        assert_eq!(format_vector(&[1.0]), "[1]");
        assert_eq!(format_vector(&[0.5, 0.25, 0.125]), "[0.5,0.25,0.125]");
    }

    #[test]
    fn vector_formatting_shape() {
        // A three-element vector renders as bracketed, comma-separated, no spaces.
        let s = format_vector(&[0.1, 0.2, 0.3]);
        assert!(s.starts_with('['));
        assert!(s.ends_with(']'));
        assert_eq!(s.matches(',').count(), 2);
        assert!(!s.contains(' '));
    }

    /// The write path refuses any vector that is not 384 floats, and the
    /// model name is pinned: a silent model swap would otherwise corrupt the
    /// shared HNSW index.
    #[test]
    fn embedding_length_validation() {
        assert_eq!(EMBEDDING_MODEL, "bge-small-en-v1.5");
        assert_eq!(EMBEDDING_DIMS, 384);
        assert!(check_dims(&vec![0.0_f32; 384]).is_ok());
        for bad in [0usize, 128, 383, 385, 512, 1024] {
            assert!(
                matches!(
                    check_dims(&vec![0.0_f32; bad]),
                    Err(RuVectorError::Validation(_))
                ),
                "{bad} dims must be refused"
            );
        }
    }

    fn finding(verdict: &str) -> DreamFinding {
        DreamFinding {
            night_id: "2026-10-01-agentbox".into(),
            repo: "agentbox".into(),
            date: "2026-10-01".into(),
            deep: "hooks".into(),
            finding: "a concrete result".into(),
            verdict: verdict.into(),
            witness: "abcd1234".into(),
            source: "hp-annexe-glm-5.3".into(),
        }
    }

    /// Nothing the row stored before the extraction is lost crossing the seam.
    #[test]
    fn the_seam_record_round_trips_every_stored_field() {
        let f = finding("ACCEPT");
        let rec = record_for(&f);
        assert_eq!(rec.key, "dream-2026-10-01-agentbox");
        assert_eq!(rec.kind, "hooks");
        let back = finding_from(&rec).unwrap();
        assert_eq!(back.night_id, f.night_id);
        assert_eq!(back.repo, f.repo);
        assert_eq!(back.date, f.date);
        assert_eq!(back.deep, f.deep);
        assert_eq!(back.finding, f.finding);
        assert_eq!(back.verdict, f.verdict);
        assert_eq!(back.witness, f.witness);
        assert_eq!(back.source, f.source);
    }

    #[test]
    fn a_corrupt_payload_is_a_sink_error_not_a_panic() {
        let mut rec = record_for(&finding("REJECT"));
        rec.body = "not json".into();
        assert!(finding_from(&rec).is_err());
    }

    #[test]
    fn operational_verdicts_do_not_clear_the_storage_bar() {
        assert!(stores("ACCEPT") && stores("REJECT") && stores("INCONCLUSIVE"));
        assert!(!stores("BLOCKED-ENV") && !stores("HANDOFF"));
    }
}
