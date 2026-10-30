//! End-to-end: a stub upstream on an ephemeral port, the proxy in front of it.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use system_one_proxy::config::Watched;
use system_one_proxy::server::{router, Proxy};

/// What the stub upstream saw.
#[derive(Default)]
struct Seen {
    authorization: Vec<Option<String>>,
    bodies: Vec<Value>,
}

async fn upstream(
    State(seen): State<Arc<Mutex<Seen>>>,
    headers: HeaderMap,
    body: Bytes,
) -> Json<Value> {
    let mut s = seen.lock().unwrap();
    s.authorization.push(
        headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string),
    );
    s.bodies.push(serde_json::from_slice(&body).unwrap());
    Json(
        json!({"model":"stub-model","answers":{"q":{"type":"noul","noul":0.5}},"usage":{"input_tokens":123,"output_tokens":0}}),
    )
}

async fn serve_stub() -> (SocketAddr, Arc<Mutex<Seen>>) {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let app = Router::new()
        .route("/v1/systemone", post(upstream))
        .with_state(Arc::clone(&seen));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (addr, seen)
}

fn projection(upstream: SocketAddr, active: &str, projected_local: Option<bool>) -> String {
    serde_json::to_string(&json!({
        "version": 1, "enabled": true, "bind": "127.0.0.1:0", "log": "",
        "active": active, "projected_local": projected_local,
        "backends": {
            // The stub is plain http on loopback, so it can only ever be a LOCAL backend here;
            // the cloud rules (https + paired host) are exercised against hosts that are never dialled.
            "stub": {"url": format!("http://{upstream}/v1/systemone"), "model": "the-backend-model", "key_env": "", "local": true, "timeout_ms": 2000},
            "subq": {"url": "https://api.subq.ai/v1/systemone", "model": "subq-snap-preview", "key_env": "SUBQ_API_KEY", "local": false, "timeout_ms": 2000, "usd_per_mtok_in": 0.05},
            "rogue": {"url": "https://api.evil.example/v1/systemone", "model": "x", "key_env": "SUBQ_API_KEY", "local": false},
            "fakelocal": {"url": "https://api.subq.ai/v1/systemone", "model": "x", "key_env": "", "local": true},
        }
    }))
    .unwrap()
}

async fn serve_proxy(file: &std::path::Path) -> (SocketAddr, Arc<Proxy>) {
    let proxy = Arc::new(Proxy::new(Watched::load(file).unwrap()).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(Arc::clone(&proxy));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (addr, proxy)
}

fn tmpfile(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("sop-it-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

#[tokio::test]
async fn forwards_with_model_overwritten_and_consumer_key_dropped() {
    let (up, seen) = serve_stub().await;
    let f = tmpfile("a.json");
    std::fs::write(&f, projection(up, "stub", Some(false))).unwrap();
    let (addr, _p) = serve_proxy(&f).await;
    let client = reqwest::Client::new();
    let r = client
        .post(format!("http://{addr}/v1/systemone"))
        .bearer_auth("consumer-key-must-not-leak")
        .json(&json!({"model":"jev-latest","state":"hello","questions":{"q":{"type":"noul","instructions":"?"}}}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["x-system-one-backend"], "stub");
    assert_eq!(r.headers()["x-system-one-model"], "the-backend-model");
    assert_eq!(r.headers()["x-system-one-usd-per-mtok-in"], "0");
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["usage"]["input_tokens"], 123);
    let s = seen.lock().unwrap();
    assert_eq!(
        s.authorization,
        vec![None],
        "a local backend gets no key, and never the consumer's"
    );
    assert_eq!(s.bodies[0]["model"], "the-backend-model");
    assert_eq!(s.bodies[0]["state"], "hello");
}

#[tokio::test]
async fn locality_rule_refuses_cloud_when_consumers_were_told_local() {
    let (up, _seen) = serve_stub().await;
    let f = tmpfile("b.json");
    std::fs::write(&f, projection(up, "subq", Some(true))).unwrap();
    let (addr, _p) = serve_proxy(&f).await;
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/v1/systemone"))
        .json(&json!({"questions":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 503);
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["code"],
        "backend_locality_changed"
    );
}

#[tokio::test]
async fn key_host_pairing_and_missing_key() {
    let (up, _seen) = serve_stub().await;
    let f = tmpfile("c.json");
    std::fs::write(&f, projection(up, "rogue", Some(false))).unwrap();
    let (addr, _p) = serve_proxy(&f).await;
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/v1/systemone"))
        .json(&json!({"questions":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["code"],
        "key_host_not_allowed"
    );
    // a local-declared backend on a public host is refused before any dial
    std::fs::write(&f, projection(up, "fakelocal", Some(false))).unwrap();
    bump(&f);
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/v1/systemone"))
        .json(&json!({"questions":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["code"],
        "backend_not_local"
    );
    // subq with no key in the environment is refused rather than called keyless
    std::env::remove_var("SUBQ_API_KEY");
    std::env::remove_var("SUBQ_API_KEY_FILE");
    std::fs::write(&f, projection(up, "subq", Some(false))).unwrap();
    bump(&f);
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/v1/systemone"))
        .json(&json!({"questions":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.json::<Value>().await.unwrap()["error"]["code"], "no_key");
}

#[tokio::test]
async fn reload_counters_models_and_invalid_body() {
    let (up, seen) = serve_stub().await;
    let f = tmpfile("d.json");
    std::fs::write(&f, projection(up, "subq", Some(false))).unwrap();
    let (addr, _p) = serve_proxy(&f).await;
    let client = reqwest::Client::new();
    let m: Value = client
        .get(format!("http://{addr}/v1/models"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(m["data"][0]["id"], "subq-snap-preview");
    assert_eq!(m["data"][0]["owned_by"], "subq");
    // switch to the stub by rewriting the file (cloud → local is allowed)
    std::fs::write(&f, projection(up, "stub", Some(false))).unwrap();
    bump(&f);
    let r = client
        .post(format!("http://{addr}/v1/systemone"))
        .body("{not json")
        .header("content-type", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    for _ in 0..2 {
        let r = client
            .post(format!("http://{addr}/v1/systemone"))
            .json(&json!({"questions":{"a":{},"b":{}}}))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
    }
    assert_eq!(seen.lock().unwrap().bodies.len(), 2);
    let b: Value = client
        .get(format!("http://{addr}/v1/backend"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(b["active"], "stub");
    assert_eq!(b["counters"]["stub"]["ok"], 2);
    assert_eq!(b["counters"]["stub"]["errors"], 1);
    assert_eq!(b["counters"]["stub"]["input_tokens"], 246);
    let h: Value = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(h["ok"], true);
    let nf = client
        .get(format!("http://{addr}/nope"))
        .send()
        .await
        .unwrap();
    assert_eq!(nf.status(), 404);
}

/// Move the file's mtime forward so the watcher sees a change within one test.
fn bump(f: &std::path::Path) {
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
    std::fs::File::options()
        .write(true)
        .open(f)
        .unwrap()
        .set_modified(later)
        .unwrap();
}

#[tokio::test]
async fn browser_shaped_requests_are_refused_before_any_upstream_call() {
    // The proxy can listen on the private docker network, which a browser sidecar
    // shares; a page could POST to it without a preflight. Refuse what only a
    // browser sends: any Origin, or a non-JSON content type (a "simple" request).
    let (up, seen) = serve_stub().await;
    let f = tmpfile("browser.json");
    std::fs::write(&f, projection(up, "stub", Some(false))).unwrap();
    let (addr, _p) = serve_proxy(&f).await;
    let client = reqwest::Client::new();
    let body = r#"{"model":"x","state":"s","questions":{"q":{"type":"noul","instructions":"?"}}}"#;
    for (origin, ctype) in [
        (Some("https://example.com"), "application/json"),
        (Some("null"), "application/json"),
        (None, "text/plain;charset=UTF-8"),
        (None, "application/x-www-form-urlencoded"),
    ] {
        let mut rq = client
            .post(format!("http://{addr}/v1/systemone"))
            .header("content-type", ctype)
            .body(body);
        if let Some(o) = origin {
            rq = rq.header("origin", o);
        }
        let r = rq.send().await.unwrap();
        assert_eq!(r.status(), 403, "{origin:?} {ctype}");
    }
    // A JSON request with a charset parameter, and one with no content type, still pass.
    for ctype in [Some("application/json; charset=utf-8"), None] {
        let mut rq = client.post(format!("http://{addr}/v1/systemone")).body(body);
        if let Some(c) = ctype {
            rq = rq.header("content-type", c);
        }
        assert_eq!(rq.send().await.unwrap().status(), 200, "{ctype:?}");
    }
    assert_eq!(seen.lock().unwrap().bodies.len(), 2, "refused requests never reach the backend");
}
