//! `agentbox-mcp hub` — one process per stateless MCP server, shared by every
//! Claude Code session over streamable HTTP (ADR-2034 §2).
//!
//! Each configured server is a stdio MCP child started lazily on first use
//! and kept alive. Clients `POST /<name>/mcp` with a JSON-RPC message (or
//! batch). The hub:
//!
//! * answers `initialize` itself from the child's cached initialize result
//!   (the child is initialised exactly once, by the hub), minting an
//!   `Mcp-Session-Id` for the client;
//! * forwards notifications and answers `202 Accepted`;
//! * forwards requests with a remapped id, awaits the child's reply and
//!   returns it as `application/json` with the client's original id;
//! * returns `405` to `GET` — it offers no server-initiated stream, which the
//!   streamable HTTP transport allows — and `200` to `DELETE`.
//!
//! Server-initiated requests from a child (sampling, roots) are answered
//! with a JSON-RPC "method not found" error; a shared child has no single
//! client to ask. Child notifications are dropped.
//!
//! The listener is loopback only. There is no authentication: this is the
//! same posture as the interaction plane's serve port, and the hub must never
//! be published.

pub mod child;
pub mod config;
pub mod rpc;

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use tracing::{info, warn};

use child::ChildServer;
use config::HubConfig;

/// Shared hub state.
pub struct Hub {
    pub servers: BTreeMap<String, Arc<ChildServer>>,
}

impl Hub {
    pub fn from_config(cfg: &HubConfig) -> Self {
        let servers = cfg
            .servers
            .iter()
            .map(|(name, spec)| (name.clone(), Arc::new(ChildServer::new(name.clone(), spec.clone()))))
            .collect();
        Self { servers }
    }
}

const SESSION_HEADER: &str = "mcp-session-id";

fn json_response(status: StatusCode, session: Option<&str>, body: Value) -> Response {
    let mut resp = (status, Json(body)).into_response();
    if let Some(s) = session {
        if let Ok(v) = HeaderValue::from_str(s) {
            resp.headers_mut().insert(SESSION_HEADER, v);
        }
    }
    resp
}

fn empty_response(status: StatusCode, session: Option<&str>) -> Response {
    let mut resp = status.into_response();
    if let Some(s) = session {
        if let Ok(v) = HeaderValue::from_str(s) {
            resp.headers_mut().insert(SESSION_HEADER, v);
        }
    }
    resp
}

async fn post_mcp(
    State(hub): State<Arc<Hub>>,
    Path(name): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(server) = hub.servers.get(&name) else {
        return json_response(
            StatusCode::NOT_FOUND,
            None,
            rpc::error_response(Value::Null, -32001, &format!("no hub server named {name:?}")),
        );
    };
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                None,
                rpc::error_response(Value::Null, -32700, &format!("parse error: {e}")),
            )
        }
    };
    let session = headers
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let (messages, batch) = match parsed {
        Value::Array(list) => (list, true),
        other => (vec![other], false),
    };
    if messages.is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            session.as_deref(),
            rpc::error_response(Value::Null, -32600, "empty batch"),
        );
    }

    let mut session = session;
    let mut replies = Vec::new();
    for msg in messages {
        match rpc::classify(&msg) {
            rpc::Kind::Initialize(id) => {
                let sid = session.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                session = Some(sid);
                match server.initialize_result().await {
                    Ok(result) => {
                        let requested = msg
                            .pointer("/params/protocolVersion")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        replies.push(rpc::initialize_reply(id, result, requested.as_deref()));
                    }
                    Err(e) => {
                        warn!(server = %name, "initialize failed: {e}");
                        replies.push(rpc::error_response(id, -32000, &format!("hub child unavailable: {e}")));
                    }
                }
            }
            rpc::Kind::Notification => {
                if let Err(e) = server.notify(&msg).await {
                    warn!(server = %name, "notification dropped: {e}");
                }
            }
            rpc::Kind::Request(id) => match server.request(&msg).await {
                Ok(mut reply) => {
                    if let Some(obj) = reply.as_object_mut() {
                        obj.insert("id".into(), id);
                    }
                    replies.push(reply);
                }
                Err(e) => replies.push(rpc::error_response(id, -32000, &format!("hub child error: {e}"))),
            },
            rpc::Kind::Response => {
                // A client answering a server-initiated request: we never
                // issue those, so there is nothing to route. Ignore.
            }
            rpc::Kind::Invalid(why) => {
                replies.push(rpc::error_response(Value::Null, -32600, &why));
            }
        }
    }

    if replies.is_empty() {
        return empty_response(StatusCode::ACCEPTED, session.as_deref());
    }
    let body = if batch { Value::Array(replies) } else { replies.remove(0) };
    json_response(StatusCode::OK, session.as_deref(), body)
}

async fn get_mcp() -> Response {
    // No server-initiated stream is offered; the transport spec allows 405.
    (
        StatusCode::METHOD_NOT_ALLOWED,
        [(header::ALLOW, "POST, DELETE")],
        "agentbox-mcp hub offers no GET stream; POST JSON-RPC to this endpoint",
    )
        .into_response()
}

async fn delete_mcp(State(hub): State<Arc<Hub>>, Path(name): Path<String>) -> Response {
    if hub.servers.contains_key(&name) {
        StatusCode::OK.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn health(State(hub): State<Arc<Hub>>) -> Response {
    let mut servers = serde_json::Map::new();
    for (name, s) in &hub.servers {
        servers.insert(name.clone(), s.status().await);
    }
    Json(json!({"ok": true, "servers": servers})).into_response()
}

pub fn router(hub: Arc<Hub>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/{name}/mcp", axum::routing::post(post_mcp).get(get_mcp).delete(delete_mcp))
        .with_state(hub)
}

/// Runs the hub until SIGTERM/SIGINT. `bind` overrides the config's bind.
pub async fn serve(config_path: &std::path::Path, bind: Option<String>) -> anyhow::Result<()> {
    let cfg = HubConfig::load(config_path)?;
    let bind = bind.unwrap_or_else(|| cfg.bind.clone());
    if !config::is_loopback_bind(&bind) {
        anyhow::bail!("refusing to bind {bind}: the hub is loopback-only (ADR-2034)");
    }
    let hub = Arc::new(Hub::from_config(&cfg));
    info!(bind = %bind, servers = hub.servers.len(), "agentbox-mcp hub starting");
    for name in hub.servers.keys() {
        info!(server = %name, "registered");
    }
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    let app = router(hub.clone());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    for (_, s) in hub.servers.iter() {
        s.shutdown().await;
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut sig) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
    }
    info!("shutdown signal received");
}
