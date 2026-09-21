//! Integration tests: the real router, over real sockets, against a stub
//! engine and a stub embeddings service.
//!
//! The stubs are deliberately *behavioural* rather than canned. The embeddings
//! stub is a hashed bag-of-words encoder, so cosine similarity between a state
//! and an option rubric means what it means in production: shared vocabulary
//! ranks higher. That is what makes "115 options shortlist to the right eight"
//! a test of the façade rather than a test of a fixture.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::State as AxumState;
use axum::routing::{get, post};
use axum::{Json, Router};
use indexmap::IndexMap;
use serde_json::{json, Value};
use system_one_facade::config::Config;
use system_one_facade::server::router;
use system_one_facade::service::Facade;

const DIM: usize = 384;

/// Everything the stub engine was asked, for assertions.
#[derive(Default)]
struct Recorder {
    calls: Vec<Value>,
}

#[derive(Clone)]
struct EngineStub {
    recorder: Arc<Mutex<Recorder>>,
    max_len: usize,
    /// `None` declares that options do not share a head budget.
    head_max_len: Option<usize>,
    /// `None` declares that options are never truncated.
    option_max_len: Option<usize>,
    /// Whether each option is scored in its own sequence.
    independent: bool,
    /// Whether the independent scorer publishes its raw scores, or only a
    /// normalised distribution plus a confidence.
    report_raw_scores: bool,
    /// Whether to withhold `confidence` too, leaving no absolute scale at all.
    hide_scale: bool,
    /// When set, `/predict` fails with this status and body.
    fail: Option<(u16, String)>,
}

/// Hashed bag-of-words encoder: deterministic, and similar texts are similar.
fn encode(text: &str) -> Vec<f32> {
    let mut v = vec![0f32; DIM];
    for word in text.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
        if word.len() < 3 {
            continue;
        }
        let mut hash = 5381u64;
        for byte in word.bytes() {
            hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
        }
        v[(hash as usize) % DIM] += 1.0;
    }
    v
}

async fn embeddings(Json(body): Json<Value>) -> Json<Value> {
    let inputs: Vec<String> = match &body["input"] {
        Value::Array(items) => items
            .iter()
            .map(|i| i.as_str().unwrap_or("").to_string())
            .collect(),
        Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    };
    let data: Vec<Value> = inputs
        .iter()
        .enumerate()
        .map(|(index, text)| json!({"index": index, "embedding": encode(text), "object": "embedding"}))
        .collect();
    Json(json!({"object": "list", "data": data}))
}

async fn engine_models(AxumState(stub): AxumState<EngineStub>) -> Json<Value> {
    Json(json!({
        "data": [{
            "id": "laya-typed-decisions",
            "max_len": stub.max_len,
            "head_max_len": stub.head_max_len,
            "option_max_len": stub.option_max_len,
            "scores_options_independently": stub.independent,
        }]
    }))
}

async fn engine_health() -> Json<Value> {
    Json(json!({"status": "ok", "device": "cuda:0", "cpu_fallback": false, "model": "laya"}))
}

/// Answer like laya: a choice picks the option sharing most words with the
/// state, a noul is high when the state mentions the question's subject.
async fn engine_predict(
    AxumState(stub): AxumState<EngineStub>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    stub.recorder.lock().unwrap().calls.push(body.clone());
    if let Some((status, message)) = &stub.fail {
        return (
            axum::http::StatusCode::from_u16(*status).unwrap(),
            message.clone(),
        )
            .into_response();
    }

    let state = body["state"].as_str().unwrap_or("").to_string();
    let state_vector = encode(&state);
    let mut answers = serde_json::Map::new();
    let questions = body["questions"].as_object().cloned().unwrap_or_default();
    for (name, question) in questions {
        let kind = question["type"].as_str().unwrap_or("noul");
        match kind {
            "choice" if stub.independent => {
                // A cross-encoder: each option is an hypothesis scored against
                // the state on its own, so the numbers are absolute and do not
                // compete for a fixed mass.
                let criteria = question["criteria"]
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                let raw: Vec<(String, f64)> = criteria
                    .iter()
                    .map(|(key, rubric)| {
                        let text = format!("{key} {}", rubric.as_str().unwrap_or(""));
                        let overlap = dot(&state_vector, &encode(&text));
                        (key.clone(), 1.0 - (-overlap / 3.0).exp())
                    })
                    .collect();
                let total: f64 = raw.iter().map(|(_, s)| s).sum::<f64>().max(1e-9);
                let best = raw
                    .iter()
                    .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                    .cloned()
                    .unwrap_or_default();
                let mut answer = serde_json::Map::new();
                answer.insert("type".into(), json!("choice"));
                answer.insert("choice".into(), json!(best.0));
                answer.insert(
                    "probabilities".into(),
                    Value::Object(
                        raw.iter()
                            .map(|(k, s)| (k.clone(), json!(s / total)))
                            .collect(),
                    ),
                );
                if !stub.hide_scale {
                    answer.insert("confidence".into(), json!(best.1));
                }
                if stub.report_raw_scores {
                    answer.insert(
                        "scores".into(),
                        Value::Object(raw.iter().map(|(k, s)| (k.clone(), json!(s))).collect()),
                    );
                }
                answers.insert(name, Value::Object(answer));
            }
            "choice" => {
                let criteria = question["criteria"]
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                let scores: Vec<(String, f64)> = criteria
                    .iter()
                    .map(|(key, rubric)| {
                        let text = format!("{key} {}", rubric.as_str().unwrap_or(""));
                        (key.clone(), dot(&state_vector, &encode(&text)) + 0.01)
                    })
                    .collect();
                let total: f64 = scores.iter().map(|(_, s)| s).sum();
                let probabilities: serde_json::Map<String, Value> = scores
                    .iter()
                    .map(|(k, s)| (k.clone(), json!(s / total)))
                    .collect();
                let best = scores
                    .iter()
                    .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                    .map(|(k, _)| k.clone())
                    .unwrap_or_default();
                let confidence = scores
                    .iter()
                    .find(|(k, _)| *k == best)
                    .map(|(_, s)| s / total);
                answers.insert(
                    name,
                    json!({
                        "type": "choice",
                        "choice": best,
                        "probabilities": probabilities,
                        "confidence": confidence,
                        "action": {"act_probability": 0.42},
                    }),
                );
            }
            "score" => {
                let labels = question["criteria"]
                    .as_array()
                    .map(|a| a.len())
                    .unwrap_or(3);
                let mut distribution = vec![0.0f64; labels];
                distribution[labels - 1] = 1.0;
                answers.insert(
                    name,
                    json!({"type": "score", "score": (labels - 1) as f64,
                           "distribution": distribution, "confidence": 0.7}),
                );
            }
            _ => {
                let instructions = question["instructions"].as_str().unwrap_or("");
                let overlap = dot(&encode(instructions), &state_vector);
                let noul = (overlap / 4.0).clamp(0.0, 1.0);
                answers.insert(name, json!({"type": "noul", "noul": noul}));
            }
        }
    }
    Json(json!({
        "answers": answers,
        "usage": {"input_tokens": 100 + state.len() as u64 / 4, "output_tokens": 0},
        "ms": 31
    }))
    .into_response()
}

fn dot(a: &[f32], b: &[f32]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (*x as f64) * (*y as f64))
        .sum()
}

async fn spawn(app: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

/// A port nothing is listening on, for the engine-down case.
async fn dead_port() -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

struct Harness {
    base: String,
    engine: Arc<Mutex<Recorder>>,
    client: reqwest::Client,
}

impl Harness {
    async fn post(&self, body: Value, bearer: Option<&str>) -> (u16, Value) {
        let mut request = self
            .client
            .post(format!("{}/v1/systemone", self.base))
            .json(&body);
        if let Some(token) = bearer {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        let response = request.send().await.unwrap();
        let status = response.status().as_u16();
        let text = response.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }

    async fn post_raw(&self, body: &str) -> (u16, Value) {
        let response = self
            .client
            .post(format!("{}/v1/systemone", self.base))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let text = response.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }

    async fn get(&self, path: &str) -> (u16, Value) {
        let response = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap();
        let status = response.status().as_u16();
        let text = response.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }

    fn engine_calls(&self) -> Vec<Value> {
        self.engine.lock().unwrap().calls.clone()
    }
}

/// Build engine stub, embeddings stub and façade, and return a driver.
async fn harness(stub: EngineStub, tune: impl FnOnce(&mut Config)) -> Harness {
    let recorder = stub.recorder.clone();
    let engine_addr = spawn(
        Router::new()
            .route("/v1/models", get(engine_models))
            .route("/health", get(engine_health))
            .route("/predict", post(engine_predict))
            .with_state(stub),
    )
    .await;
    let embed_addr = spawn(Router::new().route("/v1/embeddings", post(embeddings))).await;

    let mut cfg = Config {
        engine_url: format!("http://127.0.0.1:{}", engine_addr.port()),
        embeddings_url: format!("http://127.0.0.1:{}/v1/embeddings", embed_addr.port()),
        cache_path: None,
        ..Config::default()
    };
    tune(&mut cfg);

    let facade_addr = spawn(router(Arc::new(Facade::new(cfg)))).await;
    Harness {
        base: format!("http://127.0.0.1:{}", facade_addr.port()),
        engine: recorder,
        client: reqwest::Client::new(),
    }
}

fn stub() -> EngineStub {
    EngineStub {
        recorder: Arc::new(Mutex::new(Recorder::default())),
        max_len: 512,
        head_max_len: Some(192),
        option_max_len: Some(48),
        independent: false,
        report_raw_scores: false,
        hide_scale: false,
        fail: None,
    }
}

/// An engine declaring the openjev shape: 4k context, no shared head, no
/// per-option cap, every option scored in its own sequence.
fn independent_stub() -> EngineStub {
    EngineStub {
        max_len: 4096,
        head_max_len: None,
        option_max_len: None,
        independent: true,
        report_raw_scores: true,
        ..stub()
    }
}

/// 115 skill-shaped candidates, one of which is unmistakably about Rust.
fn many_skills() -> IndexMap<String, String> {
    let mut criteria = IndexMap::new();
    for i in 0..114 {
        criteria.insert(
            format!("skill-{i:03}"),
            format!(
                "Handles subject {i} in this repository, covering topic{i} workflows and \
                 artefact{i} maintenance end to end, with reporting and review. NOT for \
                 topic{} work, which belongs to skill-{:03} instead.",
                i + 1,
                i + 1
            ),
        );
    }
    criteria.insert(
        "rust-engineer".to_string(),
        "Ports Python glue, CLIs and evaluators to Rust, publishes crates, and replaces \
         hand-rolled cryptography with audited crates. Use when the request is a Rust port, \
         a cargo workspace or a crate release. NOT for thin wrappers over Python-only \
         modules such as bpy or torch, which stay in Python."
            .to_string(),
    );
    criteria.insert(
        "none".to_string(),
        "No skill applies: a conversational reply, a follow-up on work already in progress, \
         or a trivial edit any assistant handles without specialised guidance."
            .to_string(),
    );
    criteria
}

#[tokio::test]
async fn a_115_option_choice_is_shortlisted_compressed_and_re_expanded() {
    let h = harness(stub(), |_| {}).await;
    let criteria = many_skills();
    let (status, body) = h
        .post(
            json!({
                "model": "laya-latest",
                "state": {"user_request":
                    "Port this python cargo glue to rust and publish the crate, replacing the \
                     hand-rolled crypto with audited crates"},
                "questions": {"skill": {
                    "type": "choice",
                    "instructions": "Which skill should handle `user_request`?",
                    "criteria": criteria,
                }}
            }),
            Some("ignored-when-unset"),
        )
        .await;

    assert_eq!(status, 200, "{body}");
    let answer = &body["answers"]["skill"];

    // §2 hard rule: probabilities cover ALL original options.
    let probabilities = answer["probabilities"].as_object().unwrap();
    assert_eq!(
        probabilities.len(),
        criteria.len(),
        "every original option is reported"
    );
    for key in criteria.keys() {
        assert!(probabilities.contains_key(key), "missing option {key}");
    }
    // §2 hard rule: the choice is one of the caller's own keys.
    let choice = answer["choice"].as_str().unwrap();
    assert!(
        criteria.contains_key(choice),
        "choice {choice} is not a caller key"
    );
    assert_eq!(
        choice, "rust-engineer",
        "the shortlist kept the right option"
    );
    // §10.7: laya's action metadata survives re-expansion.
    assert_eq!(answer["action"]["act_probability"], 0.42);

    // Shortlisted-away options are exactly 0.0, and the mass still sums to 1.
    let zeroes = probabilities
        .values()
        .filter(|v| v.as_f64() == Some(0.0))
        .count();
    assert!(
        zeroes > 100,
        "most options were shortlisted away, got {zeroes} zeroes"
    );
    let total: f64 = probabilities.values().map(|v| v.as_f64().unwrap()).sum();
    assert!((total - 1.0).abs() < 1e-9, "probability mass is {total}");

    // The honesty channel says what happened.
    let sso = &body["sso"];
    assert_eq!(sso["shortlisted"]["skill"]["from"], criteria.len());
    assert!(sso["shortlisted"]["skill"]["to"].as_u64().unwrap() <= 8);
    // Core's shape: the compression report rides inside `shortlisted` (§10.1).
    let compressed = &sso["shortlisted"]["skill"]["compressed_option_tokens"];
    assert!(
        compressed["max"].as_u64().unwrap() <= 48,
        "no option exceeds the engine's own per-option ceiling: {compressed}"
    );
    assert!(compressed["mean"].as_f64().unwrap() > 0.0);
    assert!(
        sso["windowed"].get("skill").is_none(),
        "one short turn needs no windowing"
    );

    // §2: usage is what the ENGINE consumed, not what the caller sent.
    assert!(body["usage"]["input_tokens"].as_u64().unwrap() > 0);

    // And the engine never saw more than the shortlist, nor an amputated rubric.
    let calls = h.engine_calls();
    assert_eq!(calls.len(), 1, "one question over one window is one call");
    let sent = calls[0]["questions"]["skill"]["criteria"]
        .as_object()
        .unwrap();
    assert!(sent.len() <= 8, "engine received {} options", sent.len());
    assert!(
        sent.contains_key("none"),
        "the decline option is always retained"
    );
    for rubric in sent.values() {
        let text = rubric.as_str().unwrap();
        assert!(
            system_one_core::tokens::estimate_tokens(text) <= 44,
            "rubric over the per-option budget: {text}"
        );
    }
}

#[tokio::test]
async fn an_oversized_state_is_windowed_and_noul_takes_the_maximum() {
    // A compaction-shaped request: one large state, several noul questions.
    let mut engine = stub();
    engine.max_len = 256;
    let h = harness(engine, |cfg| cfg.window_k = 2).await;

    let mut history = String::new();
    for i in 0..300 {
        history.push_str(&format!(
            "step{i} ran a routine tool call and returned output {i}. "
        ));
    }
    // The fact each question hunts for sits in exactly one window.
    history.push_str(
        "Finally the assistant executed the zebrafish migration script against the staging \
         database and recorded the zebrafish checksum.",
    );

    let (status, body) = h
        .post(
            json!({
                "state": {"context": "compacting a conversation", "history": history},
                "questions": {
                    "call_t1": {"type": "noul", "instructions":
                        "The zebrafish migration script against the staging database must stay verbatim."},
                    "call_t2": {"type": "noul", "instructions":
                        "The routine step7 tool call output must stay verbatim."}
                }
            }),
            None,
        )
        .await;

    assert_eq!(status, 200, "{body}");
    let sso = &body["sso"];
    let windows = sso["windowed"]["call_t1"]["windows"].as_u64().unwrap();
    assert!(
        windows > 2,
        "a 25k-shaped state splits into many windows, got {windows}"
    );
    assert_eq!(sso["windowed"]["call_t1"]["selected"], 2, "window_k = 2");
    assert_eq!(sso["windowed"]["call_t2"]["selected"], 2);

    for name in ["call_t1", "call_t2"] {
        let noul = body["answers"][name]["noul"].as_f64().unwrap();
        assert!(
            (0.0..=1.0).contains(&noul),
            "{name} noul out of range: {noul}"
        );
    }
    // The zebrafish question found its evidence in one window; the max rule is
    // what stops the other window from voting it down.
    assert!(
        body["answers"]["call_t1"]["noul"].as_f64().unwrap() > 0.0,
        "windowed noul lost the fact it was asked about"
    );

    // Every engine call carried a state inside the engine's own budget.
    let calls = h.engine_calls();
    assert!(
        calls.len() >= 2,
        "windows were asked separately, got {} calls",
        calls.len()
    );
    for call in &calls {
        let state = call["state"].as_str().unwrap();
        assert!(
            system_one_core::tokens::estimate_tokens(state) <= 256,
            "a window exceeded the engine budget"
        );
        assert_eq!(call["truncate_left"], true, "recency is kept (§10.5)");
    }
}

#[tokio::test]
async fn an_engine_that_is_down_fails_loud_and_never_answers() {
    let port = dead_port().await;
    let h = harness(stub(), move |cfg| {
        cfg.engine_url = format!("http://127.0.0.1:{port}");
    })
    .await;

    let (status, body) = h
        .post(
            json!({"state": "a request that will not be judged",
                   "questions": {"q": {"type": "noul", "instructions": "something is true"}}}),
            None,
        )
        .await;

    assert_eq!(status, 502);
    assert_eq!(body["error"]["code"], "engine_unavailable");
    assert!(body.get("answers").is_none(), "no answer was fabricated");

    let (status, health) = h.get("/health").await;
    assert_eq!(
        status, 503,
        "a healthcheck must go red when the only model is gone"
    );
    assert_eq!(health["status"], "degraded");
}

#[tokio::test]
async fn the_engines_head_budget_refusal_becomes_options_unfittable() {
    let mut engine = stub();
    engine.fail = Some((
        500,
        "ValueError: question 'skill' options exceed head_max_len=192".to_string(),
    ));
    let h = harness(engine, |_| {}).await;

    let (status, body) = h
        .post(
            json!({"state": "anything at all",
                   "questions": {"skill": {"type": "choice", "instructions": "which",
                       "criteria": {"a": "rubric a", "b": "rubric b"}}}}),
            None,
        )
        .await;

    assert_eq!(status, 422);
    assert_eq!(body["error"]["code"], "options_unfittable");
}

#[tokio::test]
async fn options_that_cannot_be_fitted_locally_are_refused_not_guessed() {
    // A head budget that holds the instructions but not two compressed
    // options: contract §3.1 step 5, the shortlist cannot reach its floor.
    let mut engine = stub();
    engine.head_max_len = Some(40);
    let h = harness(engine, |_| {}).await;

    let (status, body) = h
        .post(
            json!({"state": "a turn about rust ports and cargo workspaces",
                   "questions": {"skill": {"type": "choice",
                       "instructions": "Which skill?",
                       "criteria": many_skills()}}}),
            None,
        )
        .await;

    assert_eq!(status, 422, "{body}");
    assert_eq!(body["error"]["code"], "options_unfittable");
    assert!(
        h.engine_calls().is_empty(),
        "the engine was never asked to guess"
    );
}

#[tokio::test]
async fn instructions_that_exhaust_the_head_are_a_different_refusal() {
    // Core distinguishes "your options do not fit" from "your instructions
    // alone do not fit", and the distinction is the operator's next action:
    // shorten the question, not the option list.
    let mut engine = stub();
    engine.head_max_len = Some(12);
    let h = harness(engine, |_| {}).await;

    let (status, body) = h
        .post(
            json!({"state": "a turn about rust ports and cargo workspaces",
                   "questions": {"skill": {"type": "choice",
                       "instructions": "Which skill should handle this request, honouring each option's stated boundaries?",
                       "criteria": many_skills()}}}),
            None,
        )
        .await;

    assert_eq!(status, 422, "{body}");
    assert_eq!(body["error"]["code"], "question_too_large");
    assert!(h.engine_calls().is_empty());
}

#[tokio::test]
async fn auth_is_enforced_when_a_key_is_set_and_ignored_when_it_is_not() {
    let open = harness(stub(), |_| {}).await;
    let body = json!({"state": "x", "questions": {"q": {"type": "noul", "instructions": "y"}}});
    assert_eq!(open.post(body.clone(), None).await.0, 200);
    assert_eq!(open.post(body.clone(), Some("anything")).await.0, 200);

    let closed = harness(stub(), |cfg| cfg.api_key = Some("s3cret".into())).await;
    assert_eq!(closed.post(body.clone(), Some("s3cret")).await.0, 200);
    let (status, refused) = closed.post(body.clone(), Some("wrong")).await;
    assert_eq!(status, 401);
    assert_eq!(refused["error"]["code"], "unauthorized");
    assert_eq!(closed.post(body, None).await.0, 401);
}

#[tokio::test]
async fn malformed_requests_are_refused_with_a_reason() {
    let h = harness(stub(), |_| {}).await;

    let (status, body) = h.post_raw("{not json").await;
    assert_eq!(status, 400);
    assert_eq!(body["error"]["code"], "invalid_request");

    let (status, body) = h.post(json!({"state": "x", "questions": {}}), None).await;
    assert_eq!(status, 400);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("carries no questions"),
        "core's own wording, so every System One implementation refuses it alike: {body}"
    );

    let (status, body) = h
        .post(
            json!({"state": "x", "questions": {"q": {"type": "vibes", "instructions": "y"}}}),
            None,
        )
        .await;
    assert_eq!(status, 400, "{body}");

    let (status, body) = h
        .post(
            json!({"state": "x", "questions": {"q": {"type": "choice", "instructions": "y",
                   "criteria": {"only": "one option is not a choice"}}}}),
            None,
        )
        .await;
    assert_eq!(status, 400);
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("at least 2"));

    let (status, body) = h.get("/v1/nonsense").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"]["code"], "not_found");
}

#[tokio::test]
async fn health_and_models_publish_the_engines_real_budget() {
    let mut engine = stub();
    engine.max_len = 1024;
    engine.head_max_len = Some(512);
    let h = harness(engine, |_| {}).await;

    let (status, health) = h.get("/health").await;
    assert_eq!(status, 200);
    assert_eq!(health["status"], "ok");
    assert_eq!(health["engine"]["device"], "cuda:0");
    assert_eq!(health["capabilities"]["max_len"], 1024);

    let (status, models) = h.get("/v1/models").await;
    assert_eq!(status, 200);
    let model = &models["data"][0];
    assert_eq!(model["id"], "laya-typed-decisions");
    assert_eq!(
        model["head_max_len"], 512,
        "the budget is the engine's, never hard-coded"
    );
    assert_eq!(model["sso"]["option_token_budget"], 44);
    assert_eq!(model["sso"]["window_k"], 2);
    assert_eq!(model["sso"]["shortlisting"], "budget");
    assert_eq!(model["sso"]["shortlist_k"], 8);
    assert_eq!(model["scores_options_independently"], false);
    assert!(
        model["sso"]["none_threshold"].is_null(),
        "a shared-head engine gets no decline threshold, and says so"
    );
}

#[tokio::test]
async fn a_small_choice_is_passed_through_whole() {
    let h = harness(stub(), |_| {}).await;
    let (status, body) = h
        .post(
            json!({"state": {"user_request": "which of these two"},
                   "questions": {"skill": {"type": "choice", "instructions": "pick",
                       "criteria": {"alpha": "the first option", "beta": "the second option"}}}}),
            None,
        )
        .await;

    assert_eq!(status, 200, "{body}");
    // `shortlisted` is always reported for a choice, because it is also where
    // core's shape carries the compression accounting; from == to is how it
    // says that nothing was dropped.
    assert_eq!(
        body["sso"]["shortlisted"]["skill"]["from"], 2,
        "both options were offered"
    );
    assert_eq!(
        body["sso"]["shortlisted"]["skill"]["to"], 2,
        "and both were judged: nothing was shortlisted away"
    );
    assert_eq!(
        body["answers"]["skill"]["probabilities"]
            .as_object()
            .unwrap()
            .len(),
        2
    );
}

// ───────────────────────────────────────────────────────────────────────────
// The second engine shape: no shared head, no per-option cap, independent
// scoring. Every assertion below is against the *declaration*, never against
// an engine's name — swapping the name in `independent_stub` would change
// nothing.
// ───────────────────────────────────────────────────────────────────────────

/// Post a 116-option routing question to a harness, with optional levers.
async fn route(h: &Harness, prompt: &str, sso: Option<Value>) -> (u16, Value) {
    let mut body = json!({
        "model": "openjev",
        "state": {"user_request": prompt},
        "questions": {"skill": {"type": "choice",
            "instructions": "Which skill should handle `user_request`?",
            "criteria": many_skills()}},
    });
    if let Some(sso) = sso {
        body["sso"] = sso;
    }
    h.post(body, None).await
}

#[tokio::test]
async fn an_unbounded_engine_judges_every_option_with_uncompressed_rubrics() {
    let h = harness(independent_stub(), |_| {}).await;
    let (status, body) = route(
        &h,
        "please port this python evaluator to rust and publish the crate",
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");

    // 1. Nothing was dropped: with no head budget, a shortlist would be the
    //    façade answering a narrower question than the caller asked.
    let sent = &h.engine_calls()[0]["questions"]["skill"]["criteria"];
    assert_eq!(
        sent.as_object().unwrap().len(),
        116,
        "all 116 options reach an engine with no head budget"
    );
    assert_eq!(body["sso"]["shortlisted"]["skill"]["from"], 116);
    assert_eq!(body["sso"]["shortlisted"]["skill"]["to"], 116);
    assert_eq!(body["sso"]["hypotheses_scored"], 116);

    // 2. Nothing was compressed: the rubric the judge read is the rubric the
    //    caller wrote, including its NOT-for clause.
    let rust = sent["rust-engineer"].as_str().unwrap();
    assert_eq!(rust, many_skills()["rust-engineer"]);
    assert!(rust.contains("NOT for thin wrappers"));

    // 3. The capability record is published, so the adaptation is auditable.
    let caps = &body["sso"]["capabilities"];
    assert_eq!(caps["max_len"], 4096);
    assert!(caps["head_max_len"].is_null());
    assert!(caps["option_max_len"].is_null());
    assert_eq!(caps["scores_options_independently"], true);

    // 4. Every §2 hard rule still holds.
    let answer = &body["answers"]["skill"];
    assert_eq!(answer["choice"], "rust-engineer");
    assert_eq!(answer["probabilities"].as_object().unwrap().len(), 116);
    let sum: f64 = answer["probabilities"]
        .as_object()
        .unwrap()
        .values()
        .map(|v| v.as_f64().unwrap())
        .sum();
    assert!((sum - 1.0).abs() < 1e-6, "sum={sum}");
    assert!(body["usage"]["input_tokens"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn the_decline_threshold_decides_and_is_reported() {
    let h = harness(independent_stub(), |_| {}).await;
    let prompt = "please port this python evaluator to rust and publish the crate";

    // A bar nothing can clear: the judge declines rather than routing.
    let (status, high) = route(&h, prompt, Some(json!({"none_threshold": 0.999}))).await;
    assert_eq!(status, 200, "{high}");
    assert_eq!(high["answers"]["skill"]["choice"], "none");
    let decline = &high["sso"]["decline"]["skill"];
    assert_eq!(decline["threshold"], 0.999);
    assert_eq!(decline["applied"], true);
    assert_eq!(decline["fired"], true);
    assert!(decline["best_score"].as_f64().unwrap() < 0.999);

    // The same request under a bar the best option clears routes instead.
    let (_, low) = route(&h, prompt, Some(json!({"none_threshold": 0.0}))).await;
    assert_eq!(low["answers"]["skill"]["choice"], "rust-engineer");
    assert_eq!(low["sso"]["decline"]["skill"]["fired"], false);
    assert_eq!(low["sso"]["decline"]["skill"]["threshold"], 0.0);

    // And the reported best score is the same either way: the threshold moves,
    // the measurement does not.
    assert!(
        (decline["best_score"].as_f64().unwrap()
            - low["sso"]["decline"]["skill"]["best_score"]
                .as_f64()
                .unwrap())
        .abs()
            < 1e-9
    );
}

#[tokio::test]
async fn a_threshold_sweep_only_ever_turns_routes_into_declines() {
    let h = harness(independent_stub(), |_| {}).await;
    let mut declined_from: Option<f64> = None;
    for step in 0..=10 {
        let threshold = f64::from(step) / 10.0;
        let (status, body) = route(
            &h,
            "port this python cli to rust",
            Some(json!({"none_threshold": threshold})),
        )
        .await;
        assert_eq!(status, 200, "{body}");
        let fired = body["sso"]["decline"]["skill"]["fired"].as_bool().unwrap();
        match (fired, declined_from) {
            (true, None) => declined_from = Some(threshold),
            (false, Some(at)) => panic!("decline un-fired at {threshold} after firing at {at}"),
            _ => {}
        }
    }
    assert!(
        declined_from.is_some(),
        "some threshold in [0, 1] must decline, or the sweep measures nothing"
    );
}

#[tokio::test]
async fn the_facades_default_threshold_applies_when_the_request_says_nothing() {
    let h = harness(independent_stub(), |cfg| {
        cfg.none_threshold = 0.95;
    })
    .await;
    let (_, body) = route(&h, "port this python cli to rust", None).await;
    assert_eq!(body["sso"]["decline"]["skill"]["threshold"], 0.95);

    let (_, models) = h.get("/v1/models").await;
    assert_eq!(models["data"][0]["sso"]["none_threshold"], 0.95);
    assert_eq!(models["data"][0]["sso"]["shortlisting"], "cost-control");
    assert!(
        models["data"][0]["sso"]["shortlist_k"].is_null(),
        "null is the honest way to say `all of them`"
    );
}

#[tokio::test]
async fn a_shared_head_engine_gets_no_threshold_at_all() {
    // The laya-shaped engine's probabilities are shares of one mass, so a fixed
    // bar would mean something different for every request. Nothing is applied
    // and nothing is reported.
    let h = harness(stub(), |_| {}).await;
    let (status, body) = route(
        &h,
        "port this python cli to rust",
        Some(json!({"none_threshold": 0.9})),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(body["sso"]["decline"].is_null());
    assert_eq!(body["sso"]["capabilities"]["option_max_len"], 48);
    let kept = body["sso"]["shortlisted"]["skill"]["to"].as_u64().unwrap();
    assert!(
        (2..=8).contains(&kept),
        "a 192-token head still shortlists for budget, not for cost: {kept}"
    );
}

#[tokio::test]
async fn a_cost_limit_shortlists_for_latency_and_says_so() {
    let h = harness(independent_stub(), |cfg| {
        cfg.cost_shortlist_k = Some(12);
    })
    .await;
    let (status, body) = route(&h, "port this python cli to rust", None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["sso"]["shortlisted"]["skill"]["to"], 12);
    assert_eq!(body["sso"]["hypotheses_scored"], 12);
    // The pinned decline option survives a cost cut, or the judge loses its
    // ability to say "nothing applies" the moment latency is tuned.
    let sent = &h.engine_calls()[0]["questions"]["skill"]["criteria"];
    assert!(sent.get("none").is_some());
    // Still honest over every original option.
    assert_eq!(
        body["answers"]["skill"]["probabilities"]
            .as_object()
            .unwrap()
            .len(),
        116
    );

    // A per-request override wins over the deployment's lever.
    let (_, tighter) = route(
        &h,
        "port this python cli to rust",
        Some(json!({"shortlist_k": 4})),
    )
    .await;
    assert_eq!(tighter["sso"]["shortlisted"]["skill"]["to"], 4);
}

#[tokio::test]
async fn an_engine_with_no_absolute_scale_fails_loud_rather_than_guessing() {
    let mut engine = independent_stub();
    engine.report_raw_scores = false;
    engine.hide_scale = true;
    let h = harness(engine, |_| {}).await;
    let (status, body) = route(&h, "port this python cli to rust", None).await;
    assert_eq!(status, 502, "{body}");
    assert_eq!(body["error"]["code"], "engine_error");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("absolute score"));
}

#[tokio::test]
async fn confidence_alone_is_enough_of_an_absolute_scale() {
    // An engine that publishes only a normalised distribution and the winner's
    // own score still supports a threshold: the scale is recoverable.
    let mut engine = independent_stub();
    engine.report_raw_scores = false;
    let h = harness(engine, |_| {}).await;
    let (status, body) = route(
        &h,
        "port this python cli to rust",
        Some(json!({"none_threshold": 0.999})),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["answers"]["skill"]["choice"], "none");
    assert_eq!(body["sso"]["decline"]["skill"]["applied"], true);
}

#[tokio::test]
async fn windowing_stays_live_on_an_unbounded_engine() {
    // No head budget does not mean no context limit: a 25k-token compaction
    // state still has to be windowed against max_len.
    let h = harness(independent_stub(), |_| {}).await;
    let transcript =
        "the operator asked about deployment. the assistant replied at length. ".repeat(1200);
    let (status, body) = h
        .post(
            json!({"model": "openjev",
                   "state": {"transcript": transcript},
                   "questions": {"stale": {"type": "noul",
                       "instructions": "is the deployment discussion finished?"}}}),
            None,
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let windowed = &body["sso"]["windowed"]["stale"];
    assert!(
        windowed["windows"].as_u64().unwrap() > 1,
        "a 25k-token state does not fit 4096 tokens: {windowed}"
    );
    assert_eq!(windowed["selected"], 2);
    assert!(body["answers"]["stale"]["noul"].is_number());
}
