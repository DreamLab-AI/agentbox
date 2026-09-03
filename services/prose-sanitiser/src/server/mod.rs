//! HTTP service exposing the cleaning pipeline.
//!
//! The agent skill and any web app can call this instead of running the CLIs
//! locally. Hardening mirrors the CLIs: input size caps, the binary-as-text
//! guard, atomic writes, a loopback-only bind by default and an optional bearer
//! key. Intended for a trusted network; put it behind a reverse proxy if it is
//! reachable from untrusted clients.
//!
//! Routes:
//! - `GET  /health`       -> `{"ok": true, "version": ...}`
//! - `GET  /capabilities` -> which optional tools / pixel backends are present
//! - `GET  /openapi.json` -> the generated OpenAPI 3.0.3 spec
//! - `POST /inspect`      -> `{"file": <base64>, "name": "x.png"}` -> findings
//! - `POST /clean`        -> `{"file": ..., "options": {...}}` -> cleaned bytes

pub mod openapi;

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::Engine;
use serde_json::{json, Map, Value};

use crate::common::io::max_input_bytes;
use crate::common::surrogate;
use crate::common::{env_nonempty, looks_binary, to_pretty_json, which};
use crate::container::{clean_container, inspect_container};
use crate::dispatch::{classify_bytes, Kind};
use crate::image::{clean_image, inspect_image, CleanImageOptions, PixelRemover};
use crate::text::{clean_text, inspect_text, CleanOptions};

/// The advertised version.
pub fn version() -> &'static str {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| env_nonempty("WATERMARKS_SERVER_VERSION").unwrap_or_else(|| "dev".into()))
}

/// A newtype so the OpenAPI module can read the version without a cycle.
pub struct Version;

impl Version {
    pub fn as_str(&self) -> &'static str {
        version()
    }
}

pub const VERSION: Version = Version;

/// The clean options the service accepts, and whether each is a boolean.
pub const ALLOWED_CLEAN_OPTIONS: &[(&str, bool)] = &[
    ("nfkc", true),
    ("aggressive_homoglyphs", true),
    ("keep_non_ai_metadata", true),
    ("also_layer_a_text", true),
    ("remove_pixel", false),
    ("strip_all_metadata", true),
];

/// Body cap for the JSON envelope. Base64 inflates by 4/3, so the decoded file
/// stays well under the input cap for the same envelope cap.
pub fn max_body_bytes() -> usize {
    let cap = max_input_bytes() as usize;
    cap + (cap >> 1)
}

/// Runtime state: the bearer token, when one is configured.
#[derive(Clone, Default)]
pub struct ServerState {
    pub api_key: Option<String>,
}

/// Which optional tools and heavy backends are present.
pub fn capabilities() -> Value {
    json!({
        "version": version(),
        "tools": {
            "c2patool": which("c2patool").is_some(),
            "exiftool": which("exiftool").is_some(),
            "qpdf": which("qpdf").is_some(),
        },
        "pixel_backends": {
            "ctrlregen": env_nonempty("NOAI_WATERMARK_DIR").is_some(),
            "diffusion": env_nonempty("MARKDIFFUSION_DIR").is_some(),
        },
        "scorers": {"synthid": env_nonempty("REVERSE_SYNTHID_DIR").is_some()},
        "harnesses": {"markllm": env_nonempty("MARKLLM_DIR").is_some()},
    })
}

/// Every response is pretty-printed JSON with a no-store cache header, as the
/// Python's `_respond` produced.
fn respond(status: StatusCode, payload: Value) -> Response {
    let body = to_pretty_json(&payload);
    (
        status,
        [
            ("content-type", "application/json; charset=utf-8"),
            ("cache-control", "no-store"),
        ],
        body,
    )
        .into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
    respond(status, json!({"ok": false, "error": message}))
}

fn authorised(state: &ServerState, headers: &HeaderMap) -> bool {
    let Some(key) = &state.api_key else {
        return true;
    };
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(|value| value == format!("Bearer {key}"))
        .unwrap_or(false)
}

/// Reduce a client-supplied filename to a bare basename safe for temp use.
///
/// A name like `../../x` would otherwise let a write escape the request temp
/// dir. Windows separators are folded too, and `.`/`..`/empty fall back to a
/// neutral name.
pub fn safe_name(name: &str) -> String {
    let normalised = name.replace('\\', "/");
    let base = normalised.rsplit('/').next().unwrap_or("");
    if base.is_empty() || base == "." || base == ".." {
        return "input".to_string();
    }
    base.to_string()
}

/// Join `part` under `dir`, refusing anything that escapes it.
///
/// Defence in depth: even if a caller slips a separator through, the write can
/// never land outside the request temp dir.
pub fn tmp_path(dir: &Path, part: &str) -> Result<PathBuf, String> {
    let path = dir.join(part);
    if path.parent() != Some(dir) {
        return Err("unsafe filename".to_string());
    }
    Ok(path)
}

/// Decode the `{file, name}` envelope.
fn decode_input(body: &Value) -> Result<(Vec<u8>, String), String> {
    let raw = body
        .get("file")
        .and_then(Value::as_str)
        .ok_or("missing string field 'file' (base64-encoded bytes)")?;
    let name = match body.get("name") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(_) => return Err("'name' must be a string".to_string()),
    };
    let data = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|_| "'file' is not valid base64".to_string())?;
    Ok((data, safe_name(&name)))
}

fn suffix_of(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned())
}

async fn health(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if !authorised(&state, &headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    respond(StatusCode::OK, json!({"ok": true, "version": version()}))
}

async fn capabilities_route(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if !authorised(&state, &headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let mut payload = Map::new();
    payload.insert("ok".into(), json!(true));
    if let Some(map) = capabilities().as_object() {
        for (key, value) in map {
            payload.insert(key.clone(), value.clone());
        }
    }
    respond(StatusCode::OK, Value::Object(payload))
}

async fn openapi_route(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if !authorised(&state, &headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    respond(
        StatusCode::OK,
        openapi::openapi_spec(state.api_key.is_some()),
    )
}

/// Parse the request body, mapping an oversize or malformed body to its status.
// The Err variant is a whole axum Response; boxing it would buy nothing
// here, since the caller returns it immediately.
#[allow(clippy::result_large_err)]
fn read_json(body: &Bytes) -> Result<Value, Response> {
    if body.len() > max_body_bytes() {
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "invalid request body"));
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(map)) => Ok(Value::Object(map)),
        _ => Err(error(StatusCode::BAD_REQUEST, "invalid request body")),
    }
}

async fn inspect_route(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorised(&state, &headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let body = match read_json(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let (data, name) = match decode_input(&body) {
        Ok(pair) => pair,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message),
    };
    match handle_inspect(&data, &name) {
        Ok(payload) => respond(StatusCode::OK, payload),
        Err(HandlerError::BadRequest(message)) => error(StatusCode::BAD_REQUEST, &message),
        Err(HandlerError::Internal(message)) => {
            eprintln!("error handling /inspect: {message}");
            error(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
        }
    }
}

async fn clean_route(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorised(&state, &headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let body = match read_json(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let (data, name) = match decode_input(&body) {
        Ok(pair) => pair,
        Err(message) => return error(StatusCode::BAD_REQUEST, &message),
    };
    match handle_clean(&data, &name, &body) {
        Ok(payload) => respond(StatusCode::OK, payload),
        Err(HandlerError::BadRequest(message)) => error(StatusCode::BAD_REQUEST, &message),
        Err(HandlerError::Internal(message)) => {
            eprintln!("error handling /clean: {message}");
            error(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
        }
    }
}

async fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "not found")
}

/// A handler failure, split by the status it maps to.
#[derive(Debug)]
pub enum HandlerError {
    BadRequest(String),
    Internal(String),
}

/// Inspect bytes, routing by the name's extension then the magic bytes.
pub fn handle_inspect(data: &[u8], name: &str) -> Result<Value, HandlerError> {
    let kind = classify_bytes(data, suffix_of(name).as_deref());
    let dir = tempfile::Builder::new()
        .prefix("wm-inspect-")
        .tempdir()
        .map_err(|error| HandlerError::Internal(error.to_string()))?;
    let path = tmp_path(dir.path(), if name.is_empty() { "input" } else { name })
        .map_err(HandlerError::BadRequest)?;
    std::fs::write(&path, data).map_err(|error| HandlerError::Internal(error.to_string()))?;

    let report = match kind {
        Kind::Text => {
            if looks_binary(data).is_some() {
                return Err(HandlerError::BadRequest(
                    "refusing to inspect bytes that look like a binary container as text".into(),
                ));
            }
            inspect_text(&surrogate::decode(data), false, false).to_json()
        }
        Kind::Image => inspect_image(&path, None)
            .map_err(|error| HandlerError::Internal(error.to_string()))?
            .to_json(),
        Kind::Container => inspect_container(&path)
            .map_err(|error| HandlerError::Internal(error.to_string()))?
            .to_json(),
    };

    let suspicious = report
        .get("suspicious_total")
        .and_then(Value::as_u64)
        .map(|total| total > 0)
        .unwrap_or(false)
        || report
            .get("has_c2pa")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        || report
            .get("has_ai_metadata")
            .and_then(Value::as_bool)
            .unwrap_or(false);

    Ok(json!({
        "ok": true,
        "kind": kind.as_str(),
        "report": report,
        "suspicious": suspicious,
    }))
}

/// Clean bytes, returning the cleaned bytes base64-encoded plus a report.
pub fn handle_clean(data: &[u8], name: &str, body: &Value) -> Result<Value, HandlerError> {
    let kind = classify_bytes(data, suffix_of(name).as_deref());
    let options = match body.get("options") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => {
            return Err(HandlerError::BadRequest(
                "'options' must be an object".into(),
            ))
        }
    };
    for key in options.keys() {
        if !ALLOWED_CLEAN_OPTIONS.iter().any(|(name, _)| name == key) {
            return Err(HandlerError::BadRequest(format!("unknown option: {key}")));
        }
    }
    let flag = |key: &str| options.get(key).and_then(Value::as_bool).unwrap_or(false);

    let dir = tempfile::Builder::new()
        .prefix("wm-clean-")
        .tempdir()
        .map_err(|error| HandlerError::Internal(error.to_string()))?;
    let source = tmp_path(dir.path(), if name.is_empty() { "input" } else { name })
        .map_err(HandlerError::BadRequest)?;
    std::fs::write(&source, data).map_err(|error| HandlerError::Internal(error.to_string()))?;

    let (cleaned_bytes, mut report) = match kind {
        Kind::Text => {
            if looks_binary(data).is_some() {
                return Err(HandlerError::BadRequest(
                    "refusing to clean bytes that look like a binary container as text".into(),
                ));
            }
            let units = surrogate::decode(data);
            let (cleaned, stats) = clean_text(
                &units,
                CleanOptions {
                    nfkc: flag("nfkc"),
                    aggressive_homoglyphs: flag("aggressive_homoglyphs"),
                    ..CleanOptions::default()
                },
            );
            let length = cleaned.len();
            (
                surrogate::encode(&cleaned),
                json!({"kind": "text", "stats": stats.to_json(), "length": length}),
            )
        }
        Kind::Image => {
            let dest = dir.path().join("out.png");
            let mut strip_all = !flag("keep_non_ai_metadata");
            if let Some(explicit) = options.get("strip_all_metadata").and_then(Value::as_bool) {
                strip_all = explicit;
            }
            let remove_pixel = match options.get("remove_pixel") {
                None | Some(Value::Null) => None,
                Some(Value::String(value)) => {
                    Some(PixelRemover::parse(value).ok_or_else(|| {
                        HandlerError::BadRequest(
                            "remove_pixel must be one of: ctrlregen, diffusion".into(),
                        )
                    })?)
                }
                Some(_) => {
                    return Err(HandlerError::BadRequest(
                        "remove_pixel must be one of: ctrlregen, diffusion".into(),
                    ))
                }
            };
            let result = clean_image(
                &source,
                &dest,
                &CleanImageOptions {
                    strip_all_metadata: strip_all,
                    remove_pixel,
                    ..CleanImageOptions::default()
                },
            )
            .map_err(HandlerError::Internal)?;
            let bytes =
                std::fs::read(&dest).map_err(|error| HandlerError::Internal(error.to_string()))?;
            (bytes, merge_kind("image", result))
        }
        Kind::Container => {
            let suffix = suffix_of(name)
                .map(|ext| format!(".{ext}"))
                .unwrap_or_default();
            let dest =
                tmp_path(dir.path(), &format!("out{suffix}")).map_err(HandlerError::BadRequest)?;
            let also_layer_a = options
                .get("also_layer_a_text")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let result =
                clean_container(&source, &dest, also_layer_a).map_err(HandlerError::Internal)?;
            let bytes =
                std::fs::read(&dest).map_err(|error| HandlerError::Internal(error.to_string()))?;
            (bytes, merge_kind("container", result))
        }
    };

    // The temp paths are an implementation detail, never a response field.
    // `shift_remove`, not `remove`: under `preserve_order` the latter is a
    // swap-remove, which would drag the last two keys forward and reorder the
    // report relative to the Python's `dict.pop`.
    if let Some(map) = report.as_object_mut() {
        map.shift_remove("input");
        map.shift_remove("output");
    }

    Ok(json!({
        "ok": true,
        "kind": kind.as_str(),
        "cleaned": base64::engine::general_purpose::STANDARD.encode(&cleaned_bytes),
        "report": report,
    }))
}

/// `{"kind": kind, **result}` — the Python's dict-splat ordering.
fn merge_kind(kind: &str, result: Value) -> Value {
    let mut map = Map::new();
    map.insert("kind".into(), json!(kind));
    if let Some(fields) = result.as_object() {
        for (key, value) in fields {
            map.insert(key.clone(), value.clone());
        }
    }
    Value::Object(map)
}

/// Build the router.
pub fn app(state: ServerState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/capabilities", get(capabilities_route))
        .route("/openapi.json", get(openapi_route))
        .route("/inspect", post(inspect_route))
        .route("/clean", post(clean_route))
        .fallback(not_found)
        .with_state(Arc::new(state))
}

#[cfg(test)]
mod tests;
