//! End-to-end HTTP behaviour against a scripted stub server.
//!
//! The stub is forty lines of `tokio::net` rather than a mock framework,
//! because what is being tested is exactly the things a mock would fake: that a
//! bearer token reaches the wire, that a 429 is retried and a 500 is not, that
//! a deadline becomes a `Timeout` and not a `Transport`, and that a 200 of
//! nonsense is a `MalformedBody` naming the endpoint.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use system_one_client::core::{Question, Request};
use system_one_client::{ClientError, SystemOneClient};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// One scripted reply.
#[derive(Clone)]
struct Reply {
    status: u16,
    body: String,
    retry_after: Option<u64>,
}

impl Reply {
    fn ok(body: &str) -> Self {
        Self {
            status: 200,
            body: body.to_owned(),
            retry_after: None,
        }
    }

    fn status(status: u16, body: &str) -> Self {
        Self {
            status,
            body: body.to_owned(),
            retry_after: None,
        }
    }
}

/// A stub server that answers each connection with the next scripted reply and
/// records what it was asked.
struct Stub {
    base_url: String,
    seen: Arc<Mutex<Vec<String>>>,
}

impl Stub {
    /// Serve `replies` in order, repeating the last one if asked again.
    async fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let recorder = Arc::clone(&seen);

        tokio::spawn(async move {
            let mut index = 0usize;
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let reply = replies[index.min(replies.len() - 1)].clone();
                index += 1;
                let recorder = Arc::clone(&recorder);

                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 4096];
                    // One read is enough: every request this suite sends fits.
                    if let Ok(read) = socket.read(&mut buffer).await {
                        request.extend_from_slice(&buffer[..read]);
                    }
                    recorder
                        .lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(&request).to_string());

                    if reply.status == 0 {
                        // Status zero means "never answer": the client's deadline
                        // has to be what ends this.
                        tokio::time::sleep(Duration::from_secs(30)).await;
                        return;
                    }

                    let retry_after = reply
                        .retry_after
                        .map(|s| format!("Retry-After: {s}\r\n"))
                        .unwrap_or_default();
                    let head = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
                        reply.status,
                        reply.body.len(),
                        retry_after
                    );
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(reply.body.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        Self { base_url, seen }
    }

    fn requests(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

fn noul_request() -> Request {
    Request::new("laya-typed-decisions", "the operator asked to rebuild")
        .with_question("is_rebuild", Question::noul("is this a rebuild request?"))
}

const GOOD_BODY: &str = r#"{"model":"laya-typed-decisions",
  "answers":{"is_rebuild":{"type":"noul","noul":0.93}},
  "usage":{"input_tokens":41,"output_tokens":0},
  "sso":{"shortlisted":{},"windowed":{},"engine_ms":29,"facade_ms":37}}"#;

#[tokio::test]
async fn a_successful_call_parses_and_carries_the_bearer_token() {
    let stub = Stub::start(vec![Reply::ok(GOOD_BODY)]).await;
    let client = SystemOneClient::builder(&stub.base_url)
        .bearer_token(Some("shibboleth".to_owned()))
        .build()
        .unwrap();

    let response = client.predict(&noul_request()).await.expect("a response");
    assert_eq!(response.answers["is_rebuild"].as_noul(), Some(0.93));
    assert_eq!(response.usage.input_tokens, 41);
    assert_eq!(response.sso.unwrap().engine_ms, 29);

    let sent = stub.requests();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].starts_with("POST /v1/systemone "), "{}", sent[0]);
    assert!(sent[0].contains("authorization: Bearer shibboleth"));
    assert!(sent[0].contains(r#""type":"noul""#));
}

#[tokio::test]
async fn no_token_means_no_authorization_header() {
    let stub = Stub::start(vec![Reply::ok(GOOD_BODY)]).await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();
    client.predict(&noul_request()).await.unwrap();
    assert!(!stub.requests()[0].to_lowercase().contains("authorization:"));
}

#[tokio::test]
async fn a_429_is_retried_within_the_bound_and_then_succeeds() {
    let stub = Stub::start(vec![
        Reply::status(
            429,
            r#"{"error":{"code":"rate_limited","message":"slow down"}}"#,
        ),
        Reply::ok(GOOD_BODY),
    ])
    .await;
    let client = SystemOneClient::builder(&stub.base_url)
        .max_retries(2)
        .backoff(Duration::from_millis(1))
        .build()
        .unwrap();

    let response = client.predict(&noul_request()).await.expect("a response");
    assert_eq!(response.answers["is_rebuild"].as_noul(), Some(0.93));
    assert_eq!(stub.requests().len(), 2, "one retry, not more");
}

#[tokio::test]
async fn retries_are_bounded_and_the_last_status_is_reported() {
    let stub = Stub::start(vec![Reply::status(
        529,
        r#"{"error":{"code":"overloaded","message":"model busy"}}"#,
    )])
    .await;
    let client = SystemOneClient::builder(&stub.base_url)
        .max_retries(2)
        .backoff(Duration::from_millis(1))
        .build()
        .unwrap();

    let err = client.predict(&noul_request()).await.unwrap_err();
    match err {
        ClientError::Status {
            status,
            code,
            attempts,
            ..
        } => {
            assert_eq!(status, 529);
            assert_eq!(code.as_deref(), Some("overloaded"));
            assert_eq!(attempts, 3); // the first try plus two retries
        }
        other => panic!("expected a status error, got {other:?}"),
    }
    assert_eq!(stub.requests().len(), 3);
}

#[tokio::test]
async fn a_500_is_not_retried() {
    let stub = Stub::start(vec![Reply::status(
        500,
        r#"{"error":{"code":"engine_unavailable","message":"laya-engine did not answer"}}"#,
    )])
    .await;
    let client = SystemOneClient::builder(&stub.base_url)
        .max_retries(5)
        .backoff(Duration::from_millis(1))
        .build()
        .unwrap();

    let err = client.predict(&noul_request()).await.unwrap_err();
    assert_eq!(err.code(), Some("engine_unavailable"));
    assert!(!err.is_retryable());
    assert_eq!(stub.requests().len(), 1, "a 500 is a bug, not congestion");
}

#[tokio::test]
async fn a_retry_after_header_is_honoured() {
    let stub = Stub::start(vec![
        Reply {
            status: 429,
            body: "{}".to_owned(),
            retry_after: Some(1),
        },
        Reply::ok(GOOD_BODY),
    ])
    .await;
    let client = SystemOneClient::builder(&stub.base_url)
        .max_retries(1)
        .backoff(Duration::from_millis(1))
        .build()
        .unwrap();

    let started = std::time::Instant::now();
    client.predict(&noul_request()).await.expect("a response");
    assert!(
        started.elapsed() >= Duration::from_millis(900),
        "Retry-After was ignored: waited {:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_deadline_becomes_a_timeout_not_a_transport_error() {
    let stub = Stub::start(vec![Reply {
        status: 0,
        body: String::new(),
        retry_after: None,
    }])
    .await;
    let client = SystemOneClient::builder(&stub.base_url)
        .timeout(Duration::from_millis(120))
        .build()
        .unwrap();

    let err = client.predict(&noul_request()).await.unwrap_err();
    assert!(
        matches!(err, ClientError::Timeout { timeout_ms: 120 }),
        "{err:?}"
    );
    assert!(err.is_retryable());
}

#[tokio::test]
async fn a_refused_connection_is_a_transport_error() {
    // Bind and drop, so the port is almost certainly closed.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);

    let client = SystemOneClient::builder(format!("http://{address}"))
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();

    let err = client.predict(&noul_request()).await.unwrap_err();
    assert!(matches!(err, ClientError::Transport { .. }), "{err:?}");
}

#[tokio::test]
async fn a_200_that_is_not_a_system_one_response_is_a_malformed_body() {
    let stub = Stub::start(vec![Reply::ok("<html>hello from a reverse proxy</html>")]).await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();

    let err = client.predict(&noul_request()).await.unwrap_err();
    match err {
        ClientError::MalformedBody { url, snippet, .. } => {
            assert!(url.ends_with("/v1/systemone"));
            assert!(snippet.contains("reverse proxy"));
        }
        other => panic!("expected a malformed body, got {other:?}"),
    }
}

#[tokio::test]
async fn an_unanswerable_request_never_leaves_the_process() {
    let stub = Stub::start(vec![Reply::ok(GOOD_BODY)]).await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();

    let broken = Request::new("m", "state")
        .with_question("pick", Question::choice("pick", [("only", "one option")]));
    let err = client.predict(&broken).await.unwrap_err();

    assert!(matches!(err, ClientError::InvalidRequest { .. }), "{err:?}");
    assert!(stub.requests().is_empty(), "it was sent anyway");
}

#[tokio::test]
async fn raw_prediction_preserves_fields_the_typed_response_does_not_model() {
    let body = r#"{"model":"laya-typed-decisions",
      "answers":{"is_rebuild":{"type":"noul","noul":0.93,"engine_private":{"layer":7}}},
      "usage":{"input_tokens":41,"output_tokens":0}}"#;
    let stub = Stub::start(vec![Reply::ok(body)]).await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();

    let raw = client.predict_raw(&noul_request()).await.unwrap();
    assert_eq!(raw["answers"]["is_rebuild"]["engine_private"]["layer"], 7);
}

#[tokio::test]
async fn the_models_endpoint_reports_the_engine_budget() {
    let stub = Stub::start(vec![Reply::ok(
        r#"{"data":[{"id":"laya-typed-decisions","max_len":512,"head_max_len":192}]}"#,
    )])
    .await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();

    let models = client.models().await.expect("models");
    assert_eq!(models.data[0].id, "laya-typed-decisions");
    assert_eq!(models.data[0].max_len, Some(512));
    assert_eq!(models.data[0].head_max_len, Some(192));
    assert!(stub.requests()[0].starts_with("GET /v1/models "));
}

#[tokio::test]
async fn a_hosted_endpoint_without_published_limits_still_parses() {
    let stub = Stub::start(vec![Reply::ok(r#"{"data":[{"id":"jev-latest"}]}"#)]).await;
    let client = SystemOneClient::new(&stub.base_url).unwrap();

    let models = client.models().await.expect("models");
    assert_eq!(models.data[0].max_len, None);
}
