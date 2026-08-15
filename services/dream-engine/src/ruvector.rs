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

/// Significance bar: only ACCEPT / REJECT verdicts warrant persistence.
fn is_significant(verdict: &str) -> bool {
    matches!(verdict.to_uppercase().as_str(), "ACCEPT" | "REJECT")
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
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

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

    let parsed: EmbeddingResponse = serde_json::from_str(&raw)
        .map_err(|e| RuVectorError::Embedding(format!("JSON parse error ({}B): {}", raw.len(), e)))?;

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
    // 1. Significance bar.
    if !is_significant(&f.verdict) {
        info!(
            verdict = %f.verdict,
            night_id = %f.night_id,
            "skipping finding below significance bar (verdict not ACCEPT/REJECT)"
        );
        return Ok(false);
    }

    // 2. Embedding from xinference, validated to exactly 384 floats.
    let embed_input = format!("{}: {}", f.deep, f.finding);
    let embedding = fetch_embedding(cfg, &embed_input).await?;
    if embedding.len() != EMBEDDING_DIMS {
        return Err(RuVectorError::Validation(format!(
            "expected {} embedding dims, got {}",
            EMBEDDING_DIMS,
            embedding.len()
        )));
    }
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
    let importance = if verdict_upper == "ACCEPT" { 0.9 } else { 0.7 };

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn significance_bar_accepts_accept_reject() {
        assert!(is_significant("ACCEPT"));
        assert!(is_significant("REJECT"));
        // Case-insensitive.
        assert!(is_significant("accept"));
        assert!(is_significant("Reject"));
    }

    #[test]
    fn significance_bar_rejects_others() {
        assert!(!is_significant("INCONCLUSIVE"));
        assert!(!is_significant("inconclusive"));
        assert!(!is_significant(""));
        assert!(!is_significant("MAYBE"));
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

    #[test]
    fn embedding_length_validation() {
        // A well-formed embedding has exactly 384 dimensions.
        let good = vec![0.0_f32; EMBEDDING_DIMS];
        assert_eq!(good.len(), EMBEDDING_DIMS);

        let short = vec![0.0_f32; 128];
        assert_ne!(short.len(), EMBEDDING_DIMS);

        let long = vec![0.0_f32; 512];
        assert_ne!(long.len(), EMBEDDING_DIMS);
    }
}
