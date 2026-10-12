//! Fail-loud errors in the System One envelope.
//!
//! Every refusal leaves the proxy as `{"error":{"code","message"}}` with a
//! status the consumer's fail-open path can act on. The proxy never invents
//! an answer.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Everything that can go wrong between a consumer and a backend.
#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    /// The projection file cannot be used.
    #[error("{0}")]
    Config(String),
    /// The request body is not a JSON object.
    #[error("{0}")]
    InvalidRequest(String),
    /// Consumers were projected local; the active backend is not (ADR-2094 §5).
    #[error("consumers were projected local=true at boot; restart the container to switch to a cloud backend")]
    BackendLocalityChanged,
    /// A backend declared local sits on an off-LAN host.
    #[error("backend {0} is declared local but its host is not LAN/loopback")]
    BackendNotLocal(String),
    /// The key's env var names no host the proxy may send it to.
    #[error("{0} is not paired with host {1}; refusing to send a key there")]
    KeyHostNotAllowed(String, String),
    /// The backend needs a key the environment does not hold.
    #[error("{0} is unset")]
    NoKey(String),
    /// The backend did not answer the socket.
    #[error("{0}")]
    UpstreamUnreachable(String),
    /// The backend took longer than its `timeout_ms`.
    #[error("{0}")]
    UpstreamTimeout(String),
}

impl ProxyError {
    /// Stable machine-readable code.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(_) => "config",
            Self::InvalidRequest(_) => "invalid_request",
            Self::BackendLocalityChanged => "backend_locality_changed",
            Self::BackendNotLocal(_) => "backend_not_local",
            Self::KeyHostNotAllowed(..) => "key_host_not_allowed",
            Self::NoKey(_) => "no_key",
            Self::UpstreamUnreachable(_) => "upstream_unreachable",
            Self::UpstreamTimeout(_) => "upstream_timeout",
        }
    }

    /// HTTP status.
    #[must_use]
    pub fn status(&self) -> StatusCode {
        match self {
            Self::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Self::UpstreamUnreachable(_) => StatusCode::BAD_GATEWAY,
            Self::UpstreamTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            _ => StatusCode::SERVICE_UNAVAILABLE,
        }
    }
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "code": self.code(), "message": self.to_string() } });
        (self.status(), axum::Json(body)).into_response()
    }
}
