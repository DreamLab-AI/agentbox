//! Error types shared across `ontology-tools`.

use std::path::PathBuf;
use thiserror::Error;

/// Top-level error type for all `ontology-tools` operations.
#[derive(Debug, Error)]
pub enum OntologyToolsError {
    #[error("I/O error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("file not found: {0}")]
    FileNotFound(PathBuf),

    #[error("unknown field: {0}")]
    UnknownField(String),

    #[error("Perplexity API error: {0}")]
    PerplexityApi(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("git rollback failed: {0}")]
    GitRollback(String),

    #[error("{0}")]
    Other(String),
}

impl OntologyToolsError {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, OntologyToolsError>;
