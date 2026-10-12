//! HTTP ingress: the routes the consumers call and the one operators read.
//!
//! `POST /v1/systemone` is the consumer door. The body is forwarded as the
//! consumer sent it, with two exceptions that are the whole point of the
//! proxy: `model` is overwritten with the active backend's own, and any
//! `Authorization` the consumer sent is dropped in favour of the backend's
//! key (or nothing, for a local backend). The upstream status and body come
//! back verbatim, so a consumer's fail-open logic sees exactly what the vendor
//! said.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::config::{Backend, Projection, Watched};
use crate::error::ProxyError;
use crate::key::credential;

/// Per-backend counters since the proxy started.
#[derive(Default)]
pub struct Counters {
    /// Requests forwarded (or refused before forwarding).
    pub requests: AtomicU64,
    /// Upstream answered 2xx.
    pub ok: AtomicU64,
    /// Anything else, including proxy-side refusals.
    pub errors: AtomicU64,
    /// Wall time summed over forwarded requests.
    pub total_ms: AtomicU64,
    /// `usage.input_tokens` summed from upstream answers.
    pub input_tokens: AtomicU64,
}

impl Counters {
    fn snapshot(&self, usd_per_mtok_in: f64) -> Value {
        let toks = self.input_tokens.load(Ordering::Relaxed);
        let reqs = self.requests.load(Ordering::Relaxed);
        let ms = self.total_ms.load(Ordering::Relaxed);
        json!({
            "requests": reqs,
            "ok": self.ok.load(Ordering::Relaxed),
            "errors": self.errors.load(Ordering::Relaxed),
            "total_ms": ms,
            "mean_ms": if reqs == 0 { 0 } else { ms / reqs },
            "input_tokens": toks,
            "estimated_usd": (toks as f64) / 1_000_000.0 * usd_per_mtok_in,
        })
    }
}

/// Shared handler state.
pub struct Proxy {
    watched: Watched,
    http: reqwest::Client,
    counters: Mutex<BTreeMap<String, Arc<Counters>>>,
    log_failed: AtomicU64,
    log_lock: Mutex<()>,
    started: Instant,
}

/// `Arc<Proxy>` as axum state.
pub type Shared = Arc<Proxy>;

impl Proxy {
    /// Build the state over a loaded projection.
    pub fn new(watched: Watched) -> Result<Proxy, ProxyError> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("system-one-proxy/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ProxyError::Config(format!("http client: {e}")))?;
        Ok(Proxy {
            watched,
            http,
            counters: Mutex::new(BTreeMap::new()),
            log_failed: AtomicU64::new(0),
            log_lock: Mutex::new(()),
            started: Instant::now(),
        })
    }

    /// The latest projection.
    #[must_use]
    pub fn projection(&self) -> Projection {
        self.watched.current()
    }

    fn counters_for(&self, name: &str) -> Arc<Counters> {
        let mut map = self.counters.lock().unwrap_or_else(|e| e.into_inner());
        Arc::clone(map.entry(name.to_string()).or_default())
    }

    fn log_line(&self, log: &str, line: &Value) {
        if log.is_empty() {
            return;
        }
        let _guard = self.log_lock.lock().unwrap_or_else(|e| e.into_inner());
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            if let Some(parent) = std::path::Path::new(log).parent() {
                std::fs::create_dir_all(parent)?;
            }
            rotate_request_log(log)?;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log)?;
            writeln!(f, "{line}")
        };
        if let Err(e) = write() {
            if self.log_failed.fetch_add(1, Ordering::Relaxed) == 0 {
                tracing::warn!(error = %e, log, "request log unwritable; continuing without it");
            }
        }
    }
}

/// Build the router. Used by `main` and, unchanged, by the integration tests.
pub fn router(proxy: Shared) -> Router {
    Router::new()
        .route("/v1/systemone", post(systemone))
        .route("/v1/models", get(models))
        .route("/v1/backend", get(backend))
        .route("/health", get(health))
        .fallback(not_found)
        .with_state(proxy)
}

/// The ADR-2094 §5 rule: consumers told "local" at boot must never reach a cloud backend.
fn locality_ok(p: &Projection, b: &Backend) -> Result<(), ProxyError> {
    if p.projected_local == Some(true) && !b.local {
        return Err(ProxyError::BackendLocalityChanged);
    }
    Ok(())
}

async fn systemone(State(proxy): State<Shared>, body: Bytes) -> Response {
    let started = Instant::now();
    let p = proxy.projection();
    let name = p.active.clone();
    let b = p.selected().clone();
    let counters = proxy.counters_for(&name);
    counters.requests.fetch_add(1, Ordering::Relaxed);

    let outcome = forward(&proxy, &p, &name, &b, &body).await;
    let ms = started.elapsed().as_millis() as u64;
    counters.total_ms.fetch_add(ms, Ordering::Relaxed);

    let (status, questions, input_tokens, response) = match outcome {
        Ok((status, upstream, questions)) => {
            let input_tokens = serde_json::from_slice::<Value>(&upstream)
                .ok()
                .and_then(|v| v.get("usage")?.get("input_tokens")?.as_u64())
                .unwrap_or(0);
            if status.is_success() {
                counters.ok.fetch_add(1, Ordering::Relaxed);
                counters
                    .input_tokens
                    .fetch_add(input_tokens, Ordering::Relaxed);
            } else {
                counters.errors.fetch_add(1, Ordering::Relaxed);
            }
            let mut resp = (status, upstream).into_response();
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            (status, questions, input_tokens, resp)
        }
        Err(e) => {
            counters.errors.fetch_add(1, Ordering::Relaxed);
            tracing::warn!(backend = %name, code = e.code(), ms, "request refused");
            (e.status(), 0, 0, e.into_response())
        }
    };
    let mut response = response;
    if let Ok(v) = HeaderValue::from_str(&name) {
        response.headers_mut().insert("x-system-one-backend", v);
    }
    if let Ok(v) = HeaderValue::from_str(&b.model) {
        response.headers_mut().insert("x-system-one-model", v);
    }
    if let Ok(v) = HeaderValue::from_str(&b.usd_per_mtok_in.to_string()) {
        response
            .headers_mut()
            .insert("x-system-one-usd-per-mtok-in", v);
    }
    tracing::info!(backend = %name, model = %b.model, status = status.as_u16(), ms, input_tokens, questions, "request served");
    proxy.log_line(
        &p.log,
        &json!({
            "ts": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            "backend": name, "model": b.model, "status": status.as_u16(), "ms": ms,
            "input_tokens": input_tokens, "local": b.local, "questions": questions,
        }),
    );
    response
}

/// Forward one body; returns (status, body, question count).
async fn forward(
    proxy: &Proxy,
    p: &Projection,
    name: &str,
    b: &Backend,
    body: &Bytes,
) -> Result<(StatusCode, Bytes, usize), ProxyError> {
    let mut v: Value = serde_json::from_slice(body)
        .map_err(|e| ProxyError::InvalidRequest(format!("body is not JSON: {e}")))?;
    let Some(obj) = v.as_object_mut() else {
        return Err(ProxyError::InvalidRequest(
            "body must be a JSON object".into(),
        ));
    };
    let questions = obj
        .get("questions")
        .and_then(Value::as_object)
        .map_or(0, |q| q.len());
    locality_ok(p, b)?;
    let key = credential(name, b)?;
    obj.insert("model".into(), Value::String(b.model.clone()));

    let mut req = proxy
        .http
        .post(&b.url)
        .header(header::CONTENT_TYPE, "application/json")
        .timeout(Duration::from_millis(b.timeout_ms))
        .body(serde_json::to_vec(&v).expect("a Value serialises"));
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            ProxyError::UpstreamTimeout(format!("{name} did not answer within {} ms", b.timeout_ms))
        } else {
            ProxyError::UpstreamUnreachable(format!("{name}: {e}"))
        }
    })?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| ProxyError::UpstreamUnreachable(format!("{name}: reading body: {e}")))?;
    Ok((status, bytes, questions))
}

async fn models(State(proxy): State<Shared>) -> Response {
    let p = proxy.projection();
    Json(json!({
        "object": "list",
        "data": [{ "id": p.selected().model, "object": "model", "owned_by": p.active }],
    }))
    .into_response()
}

async fn backend(State(proxy): State<Shared>) -> Response {
    let p = proxy.projection();
    let b = p.selected();
    let per_backend: BTreeMap<String, Value> = {
        let map = proxy.counters.lock().unwrap_or_else(|e| e.into_inner());
        map.iter()
            .map(|(n, c)| {
                (
                    n.clone(),
                    c.snapshot(p.backends.get(n).map_or(0.0, |b| b.usd_per_mtok_in)),
                )
            })
            .collect()
    };
    Json(json!({
        "active": p.active,
        "model": b.model,
        "url": b.url,
        "local": b.local,
        "projected_local": p.projected_local,
        "projected_at": p.projected_at,
        "usd_per_mtok_in": b.usd_per_mtok_in,
        "locality_ok": locality_ok(&p, b).is_ok(),
        "uptime_s": proxy.started.elapsed().as_secs(),
        "projection": proxy.watched.path().display().to_string(),
        "backends": p.backends.keys().collect::<Vec<_>>(),
        "counters": per_backend,
    }))
    .into_response()
}

async fn health(State(proxy): State<Shared>) -> Response {
    let p = proxy.projection();
    Json(json!({ "ok": true, "backend": p.active, "local": p.selected().local })).into_response()
}

async fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": { "code": "not_found", "message": "no such route" } })),
    )
        .into_response()
}

// Bound metadata logs to 10 MiB plus three archives, including long-lived
// workspace volumes. Supervisor separately bounds the daemon's stdout logs.
fn rotate_request_log(log: &str) -> std::io::Result<()> {
    const MAX_BYTES: u64 = 10 * 1024 * 1024;
    if std::fs::metadata(log).map(|m| m.len()).unwrap_or(0) < MAX_BYTES {
        return Ok(());
    }
    for n in (1..=3).rev() {
        let source = if n == 1 {
            log.to_string()
        } else {
            format!("{log}.{}", n - 1)
        };
        match std::fs::rename(source, format!("{log}.{n}")) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[cfg(test)]
mod log_tests {
    #[test]
    fn request_logs_retain_only_three_archives() {
        let dir = std::env::temp_dir().join(format!("sop-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("requests.jsonl");
        let log = path.to_str().unwrap();
        for _ in 0..5 {
            std::fs::File::create(&path)
                .unwrap()
                .set_len(10 * 1024 * 1024)
                .unwrap();
            super::rotate_request_log(log).unwrap();
        }
        assert!(!path.exists());
        for n in 1..=3 {
            assert!(dir.join(format!("requests.jsonl.{n}")).exists());
        }
        assert!(!dir.join("requests.jsonl.4").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
