//! Structured, fail-loud errors.
//!
//! Every failure leaves the façade as `{"error":{"code","message"}}` with a
//! status code the consumer can act on. The façade never invents an answer: a
//! consumer's fail-open path (the routing table, the built-in compaction) is
//! correct only if it can tell that nothing was judged.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Everything that can go wrong between ingress and an answer.
#[derive(Debug, thiserror::Error)]
pub enum FacadeError {
    /// The request body is not a valid System One request.
    #[error("{0}")]
    InvalidRequest(String),
    /// `SSO_API_KEY` is set and the bearer token is absent or wrong.
    #[error("missing or invalid bearer token")]
    Unauthorized,
    /// A choice question cannot be reduced to something the engine can read.
    #[error("{0}")]
    OptionsUnfittable(String),
    /// A question's own head cost exceeds the engine budget; no state would fit.
    #[error("{0}")]
    QuestionTooLarge(String),
    /// The engine did not answer the socket.
    #[error("{0}")]
    EngineUnavailable(String),
    /// The engine answered, but not with something usable.
    #[error("{0}")]
    EngineError(String),
    /// The engine took longer than the configured budget.
    #[error("{0}")]
    EngineTimeout(String),
    /// The embeddings service is required for this request and did not answer.
    #[error("{0}")]
    EmbeddingsUnavailable(String),
    /// The façade's own answer failed the protocol's response invariant.
    ///
    /// Raised by [`system_one_core::validate::validate_response`] against what
    /// this server was about to return. It means a façade bug, and the right
    /// response to a façade bug is a 500 and a loud log, not a plausible
    /// answer that quietly breaks the contract §2 guarantee.
    #[error("{0}")]
    ContractViolation(String),
}

impl From<system_one_core::ValidationError> for FacadeError {
    fn from(error: system_one_core::ValidationError) -> Self {
        Self::InvalidRequest(error.to_string())
    }
}

impl From<system_one_core::Error> for FacadeError {
    fn from(error: system_one_core::Error) -> Self {
        Self::InvalidRequest(error.to_string())
    }
}

impl From<system_one_core::BudgetError> for FacadeError {
    fn from(error: system_one_core::BudgetError) -> Self {
        use system_one_core::BudgetError;
        match error {
            // Fewer than two options is the caller's error, not the engine's.
            BudgetError::TooFewOptions { .. } => Self::InvalidRequest(error.to_string()),
            // The instructions alone exhaust the head: no state could ever fit.
            BudgetError::NoHeadroom { .. } => Self::QuestionTooLarge(error.to_string()),
            _ => Self::OptionsUnfittable(error.to_string()),
        }
    }
}

impl From<system_one_core::ExpandError> for FacadeError {
    fn from(error: system_one_core::ExpandError) -> Self {
        // Re-expansion fails when the engine answered with something the
        // façade never offered. Guessing which option was meant is exactly the
        // behaviour the contract forbids.
        Self::EngineError(format!(
            "the engine's answer could not be re-expanded: {error}"
        ))
    }
}

impl From<system_one_core::AggregateError> for FacadeError {
    fn from(error: system_one_core::AggregateError) -> Self {
        Self::EngineError(format!(
            "per-window answers could not be aggregated: {error}"
        ))
    }
}

impl From<system_one_core::ResponseError> for FacadeError {
    fn from(error: system_one_core::ResponseError) -> Self {
        Self::ContractViolation(format!(
            "the façade built a response that violates the System One contract: {error}"
        ))
    }
}

impl FacadeError {
    /// The stable machine-readable code carried in the error envelope.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::Unauthorized => "unauthorized",
            Self::OptionsUnfittable(_) => "options_unfittable",
            Self::QuestionTooLarge(_) => "question_too_large",
            Self::EngineUnavailable(_) => "engine_unavailable",
            Self::EngineError(_) => "engine_error",
            Self::EngineTimeout(_) => "engine_timeout",
            Self::EmbeddingsUnavailable(_) => "embeddings_unavailable",
            Self::ContractViolation(_) => "contract_violation",
        }
    }

    /// HTTP status for this failure.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::OptionsUnfittable(_) | Self::QuestionTooLarge(_) => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::EngineUnavailable(_) | Self::EmbeddingsUnavailable(_) => StatusCode::BAD_GATEWAY,
            Self::EngineError(_) => StatusCode::BAD_GATEWAY,
            Self::EngineTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            Self::ContractViolation(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for FacadeError {
    fn into_response(self) -> Response {
        let body = json!({"error": {"code": self.code(), "message": self.to_string()}});
        tracing::warn!(code = self.code(), message = %self, "request failed");
        (self.status(), axum::Json(body)).into_response()
    }
}

/// Result alias for façade operations.
pub type Result<T> = std::result::Result<T, FacadeError>;
