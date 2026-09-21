//! HTTP ingress: the three routes the estate actually calls.
//!
//! `POST /v1/systemone` is byte-compatible with what
//! `config/hooks/lib/skill-route.cjs` and the `jev-compaction` plugin already
//! send to TypeSafe, because neither consumer may be edited to accommodate a
//! local backend. `GET /health` is the compose healthcheck. `GET /v1/models`
//! publishes the engine's real budget so operators can see what the façade is
//! fitting into.
//!
//! Nothing in this module can produce an answer. Every path that is not a
//! successful engine call ends in `{"error":{"code","message"}}`.

use std::sync::Arc;
use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use system_one_core::wire::{Answer, Question, Request};

use crate::error::FacadeError;
use crate::service::Facade;

/// Shared handler state.
pub type Shared = Arc<Facade>;

/// Build the router. Used by `main` and, unchanged, by the integration tests.
pub fn router(facade: Shared) -> Router {
    Router::new()
        .route("/v1/systemone", post(systemone))
        .route("/health", get(health))
        .route("/v1/models", get(models))
        .fallback(not_found)
        .with_state(facade)
}

/// Compare two secrets without leaking their common prefix length.
fn secret_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

/// Enforce bearer auth when, and only when, `SSO_API_KEY` is set.
///
/// With no key configured the façade is on loopback or a trusted LAN segment
/// and the header is accepted but not required — both consumers always send
/// one, so refusing it would be gratuitous.
fn authorise(facade: &Facade, headers: &HeaderMap) -> Result<(), FacadeError> {
    let Some(expected) = facade.config().api_key.as_deref() else {
        return Ok(());
    };
    let presented = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("bearer "))
        })
        .unwrap_or("");
    if secret_eq(presented, expected) {
        Ok(())
    } else {
        Err(FacadeError::Unauthorized)
    }
}

async fn systemone(State(facade): State<Shared>, headers: HeaderMap, body: String) -> Response {
    let started = Instant::now();
    if let Err(e) = authorise(&facade, &headers) {
        return e.into_response();
    }
    // `Request::parse` is the standard's own front door: it deserialises the
    // raw shape, converts it to the typed one and validates it, so a malformed
    // question is refused here in exactly the terms every other System One
    // implementation refuses it.
    let request: Request = match Request::parse(&body) {
        Ok(r) => r,
        Err(e) => return FacadeError::from(e).into_response(),
    };
    let questions = request.questions.len();
    let options: usize = request
        .questions
        .values()
        .map(|q| match q {
            Question::Choice { criteria, .. } => criteria.len(),
            _ => 0,
        })
        .sum();

    match facade.answer(request).await {
        Ok(response) => {
            // The log records shape and outcome, never the prompt: the whole
            // point of a local judge is that turn text does not travel, and a
            // log file is travel.
            tracing::info!(
                outcome = "answered",
                questions,
                options,
                shortlisted = response.sso.as_ref().map_or(0, |s| s.shortlisted.len()),
                windowed = response.sso.as_ref().map_or(0, |s| s.windowed.len()),
                input_tokens = response.usage.input_tokens,
                engine_ms = response.sso.as_ref().map_or(0, |s| s.engine_ms),
                facade_ms = response.sso.as_ref().map_or(0, |s| s.facade_ms),
                choices = ?response
                    .answers
                    .iter()
                    .filter_map(|(name, a)| match a {
                        Answer::Choice { choice, .. } => Some(format!("{name}={choice}")),
                        _ => None,
                    })
                    .collect::<Vec<_>>(),
                "request served"
            );
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            tracing::warn!(
                outcome = "failed",
                code = e.code(),
                questions,
                options,
                facade_ms = started.elapsed().as_millis() as u64,
                "request refused"
            );
            e.into_response()
        }
    }
}

/// Engine-backed health. Degraded is a 503, because a healthcheck that stays
/// green while the only model is unreachable is worse than no healthcheck.
async fn health(State(facade): State<Shared>) -> Response {
    let engine = facade.engine().health().await;
    let capabilities = facade.engine().capabilities().await;
    let cache = json!({
        "embeddings": facade.embedder().cache().len(),
        "compressed_rubrics": facade.embedder().cache().text_len(),
    });
    match (engine, capabilities) {
        (Ok(engine), Ok(capabilities)) => {
            let cpu_fallback = engine.cpu_fallback.unwrap_or(false);
            (
                StatusCode::OK,
                Json(json!({
                    "status": if cpu_fallback { "ok-degraded" } else { "ok" },
                    "model": facade.config().model,
                    "engine": engine,
                    "capabilities": capabilities,
                    "cache": cache,
                })),
            )
                .into_response()
        }
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "degraded",
                "model": facade.config().model,
                "engine_url": facade.engine().base_url(),
                "error": {"code": e.code(), "message": e.to_string()},
                "cache": cache,
            })),
        )
            .into_response(),
    }
}

/// What the engine declared, and what the façade therefore does about it.
///
/// Both halves matter to an operator: the capability fields say what the engine
/// is, and the `sso` fields say which adaptations are consequently live. A
/// `shortlist_k` of `null` against `head_max_len: null` is the honest statement
/// that every option is being judged.
async fn models(State(facade): State<Shared>) -> Response {
    let cfg = facade.config();
    match facade.engine().capabilities().await {
        Ok(capabilities) => {
            let bounded = capabilities.is_head_bounded();
            (
                StatusCode::OK,
                Json(json!({
                    "object": "list",
                    "data": [{
                        "id": cfg.model,
                        "object": "model",
                        "owned_by": "sovereign-system-one",
                        "max_len": capabilities.max_len,
                        "head_max_len": capabilities.head_max_len,
                        "option_max_len": capabilities.option_max_len,
                        "scores_options_independently":
                            capabilities.scores_options_independently,
                        "sso": {
                            // On an unbounded engine a shortlist is a latency
                            // lever, so `null` means "all options offered".
                            "shortlist_k": if bounded {
                                Some(cfg.shortlist_k)
                            } else {
                                cfg.cost_shortlist_k
                            },
                            "shortlisting": if bounded { "budget" } else { "cost-control" },
                            "window_k": cfg.window_k,
                            "option_token_budget": facade.option_cap(capabilities),
                            "none_threshold": capabilities
                                .scores_options_independently
                                .then_some(cfg.none_threshold),
                            "none_key": cfg.none_key,
                        },
                    }]
                })),
            )
                .into_response()
        }
        Err(e) => e.into_response(),
    }
}

async fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": {
            "code": "not_found",
            "message": "the façade serves POST /v1/systemone, GET /health and GET /v1/models"
        }})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn headers(value: Option<&str>) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(v) = value {
            h.insert(axum::http::header::AUTHORIZATION, v.parse().unwrap());
        }
        h
    }

    #[test]
    fn auth_is_enforced_only_when_a_key_is_configured() {
        let open = Facade::new(Config::default());
        assert!(authorise(&open, &headers(None)).is_ok());
        assert!(authorise(&open, &headers(Some("Bearer anything"))).is_ok());

        let closed = Facade::new(Config {
            api_key: Some("s3cret".into()),
            ..Config::default()
        });
        assert!(authorise(&closed, &headers(Some("Bearer s3cret"))).is_ok());
        assert!(authorise(&closed, &headers(Some("bearer s3cret"))).is_ok());
        assert!(authorise(&closed, &headers(Some("Bearer wrong"))).is_err());
        assert!(authorise(&closed, &headers(Some("s3cret"))).is_err());
        assert!(authorise(&closed, &headers(None)).is_err());
    }

    #[test]
    fn secret_comparison_handles_length_differences() {
        assert!(secret_eq("abc", "abc"));
        assert!(!secret_eq("abc", "abcd"));
        assert!(!secret_eq("", "a"));
        assert!(secret_eq("", ""));
    }
}
