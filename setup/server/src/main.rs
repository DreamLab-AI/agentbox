use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Notify;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct FrontendAssets;

#[derive(Clone)]
struct AppState {
    config_path: PathBuf,
    schema_path: PathBuf,
    shutdown: Arc<Notify>,
    mgmt_api_url: String,
    mgmt_api_key: Option<String>,
    http: reqwest::Client,
}

#[derive(Serialize)]
struct ConfigResponse {
    toml_content: String,
    schema: serde_json::Value,
}

#[derive(Deserialize)]
struct SaveRequest {
    toml_content: String,
}

async fn get_config(State(state): State<AppState>) -> Result<Json<ConfigResponse>, StatusCode> {
    let toml_content = tokio::fs::read_to_string(&state.config_path)
        .await
        .unwrap_or_else(|_| include_str!("../../../agentbox.toml").to_string());

    let schema_str = tokio::fs::read_to_string(&state.schema_path)
        .await
        .unwrap_or_else(|_| "{}".to_string());

    let schema: serde_json::Value =
        serde_json::from_str(&schema_str).unwrap_or(serde_json::Value::Null);

    Ok(Json(ConfigResponse {
        toml_content,
        schema,
    }))
}

async fn save_config(
    State(state): State<AppState>,
    Json(req): Json<SaveRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    req.toml_content
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid TOML: {e}")))?;

    tokio::fs::write(&state.config_path, &req.toml_content)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Write failed: {e}"),
            )
        })?;

    Ok(StatusCode::OK)
}

async fn shutdown_handler(State(state): State<AppState>) -> StatusCode {
    state.shutdown.notify_one();
    StatusCode::OK
}

async fn proxy_to_mgmt_api(
    State(state): State<AppState>,
    method: Method,
    Path(path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    body: Body,
) -> Response {
    let url = format!("{}/{}", state.mgmt_api_url, path);

    let mut req = state.http.request(method, &url);

    if !params.is_empty() {
        req = req.query(&params);
    }

    if let Some(ref key) = state.mgmt_api_key {
        req = req.header("Authorization", format!("Bearer {key}"));
    }

    let body_bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    if !body_bytes.is_empty() {
        req = req
            .header("Content-Type", "application/json")
            .body(body_bytes);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            match resp.bytes().await {
                Ok(bytes) => (
                    status,
                    [(header::CONTENT_TYPE, content_type)],
                    bytes.to_vec(),
                )
                    .into_response(),
                Err(_) => StatusCode::BAD_GATEWAY.into_response(),
            }
        }
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json".to_string())],
            br#"{"error":"container_unreachable","message":"Management API is not responding. Is the agentbox container running?"}"#.to_vec(),
        )
            .into_response(),
    }
}

async fn serve_frontend(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match FrontendAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref())],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => match FrontendAssets::get("index.html") {
            Some(content) => {
                Html(String::from_utf8_lossy(&content.data).to_string()).into_response()
            }
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

fn load_mgmt_key() -> Option<String> {
    let paths = [
        PathBuf::from("/var/lib/agentbox/secrets/mgmt-key"),
        dirs::home_dir()
            .unwrap_or_default()
            .join(".agentbox/mgmt-key"),
    ];

    for path in &paths {
        if let Ok(key) = std::fs::read_to_string(path) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                return Some(key);
            }
        }
    }

    std::env::var("MANAGEMENT_API_KEY").ok()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    let config_path = args
        .get(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("agentbox.toml"));

    let schema_path = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("schema/agentbox.toml.schema.json"));

    let mgmt_port = std::env::var("AGENTBOX_MGMT_PORT")
        .unwrap_or_else(|_| "9090".to_string());

    let mgmt_api_url = format!("http://127.0.0.1:{mgmt_port}");
    let mgmt_api_key = load_mgmt_key();

    let shutdown = Arc::new(Notify::new());

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(3))
        .build()
        .expect("failed to create HTTP client");

    let state = AppState {
        config_path: config_path.clone(),
        schema_path,
        shutdown: shutdown.clone(),
        mgmt_api_url,
        mgmt_api_key,
        http,
    };

    let app = Router::new()
        .route("/api/config", get(get_config).post(save_config))
        .route("/api/shutdown", post(shutdown_handler))
        .route("/api/proxy/{*path}", any(proxy_to_mgmt_api))
        .fallback(serve_frontend)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind");
    let addr: SocketAddr = listener.local_addr().unwrap();

    let url = format!("http://{addr}");
    eprintln!("\x1b[1;33m┌─────────────────────────────────────────┐\x1b[0m");
    eprintln!("\x1b[1;33m│\x1b[0m  \x1b[1mAGENTBOX\x1b[0m Setup & Dashboard             \x1b[1;33m│\x1b[0m");
    eprintln!("\x1b[1;33m├─────────────────────────────────────────┤\x1b[0m");
    eprintln!("\x1b[1;33m│\x1b[0m  URL:    \x1b[4m{url}\x1b[0m");
    eprintln!("\x1b[1;33m│\x1b[0m  Config: {}\x1b[0m", config_path.display());
    eprintln!("\x1b[1;33m│\x1b[0m  Ctrl+C or Save & Exit to quit          \x1b[1;33m│\x1b[0m");
    eprintln!("\x1b[1;33m└─────────────────────────────────────────┘\x1b[0m");

    if open::that(&url).is_err() {
        eprintln!("  could not open browser — navigate to {url} manually");
    }

    let server = axum::serve(listener, app);
    tokio::select! {
        result = server => {
            if let Err(e) = result {
                eprintln!("server error: {e}");
            }
        }
        _ = shutdown.notified() => {
            eprintln!("\x1b[32m✓ save complete — shutting down\x1b[0m");
        }
        _ = tokio::signal::ctrl_c() => {
            eprintln!("\n\x1b[33m⚠ interrupted — no changes saved\x1b[0m");
        }
    }
}
