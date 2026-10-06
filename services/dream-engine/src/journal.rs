//! Execution-journal client (ADR-2071 Phase 1): every side effect of a night
//! is recorded as a `tool.called` / `tool.completed` pair in the ADR-057
//! journal, through the management API's `POST /v1/exec/record`.
//!
//! **HTTP is mandatory, not a preference.** The events adapter caches the
//! audit-chain head in the management-api process and appends unlocked, so a
//! second writer (this binary, or a `node` subprocess) would fork `prev_hash`
//! and make `GET /v1/system/audit-chain` report tampering. The running
//! management API is the only chain-safe writer.
//!
//! **Fail-open, and says so.** The dream engine is fail-open at every
//! persistence point, and a management-api restart must not cancel the night.
//! A failed post is counted, never raised. After [`BREAKER_THRESHOLD`]
//! consecutive failures the session stops trying (so a hung API costs seconds,
//! not a timeout per side effect), and the stats land in the night-health file
//! so an unjournalled night is visible rather than silent. This buys
//! auditability, not enforcement: nothing here approves or denies anything.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

/// Harness name the journal records (`session-dream-engine-…` URNs).
pub const HARNESS: &str = "dream-engine";

/// Consecutive failures after which a session stops posting.
pub const BREAKER_THRESHOLD: u32 = 3;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Where the journal posts and with what credential.
#[derive(Debug, Clone)]
pub struct JournalConfig {
    /// Management API base URL, e.g. `http://127.0.0.1:9090`.
    pub base_url: String,
    /// Bearer key (`MANAGEMENT_API_KEY`). `None` posts unauthenticated, which
    /// the API rejects: the night still runs, and the failure is counted.
    pub api_key: Option<String>,
}

impl JournalConfig {
    /// `DREAM_JOURNAL=0` disables journalling. Otherwise the URL comes from
    /// `DREAM_JOURNAL_URL`, else `http://127.0.0.1:$MANAGEMENT_API_PORT`
    /// (default port 9090), and the key from `MANAGEMENT_API_KEY`.
    pub fn from_env() -> Option<Self> {
        if std::env::var("DREAM_JOURNAL").as_deref() == Ok("0") {
            return None;
        }
        let base_url = std::env::var("DREAM_JOURNAL_URL").unwrap_or_else(|_| {
            let port = std::env::var("MANAGEMENT_API_PORT").unwrap_or_else(|_| "9090".into());
            format!("http://127.0.0.1:{port}")
        });
        let api_key = std::env::var("MANAGEMENT_API_KEY")
            .ok()
            .filter(|k| !k.is_empty());
        Some(Self { base_url, api_key })
    }
}

/// Per-session counters, persisted into the night-health summary.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct JournalStats {
    pub session: String,
    pub enabled: bool,
    pub recorded: u32,
    pub failed: u32,
    /// Posts not attempted because the breaker had opened.
    pub skipped: u32,
    /// Side effects whose `tool.called` was recorded but whose
    /// `tool.completed` was not (a crash between the two leaves one).
    pub unpaired: u32,
}

/// A recorded `tool.called`, to be closed by [`Journal::completed`].
#[derive(Debug)]
#[must_use = "a called side effect must be closed with Journal::completed"]
pub struct Call {
    step: u32,
    tool: String,
    event_id: Option<String>,
    started: Instant,
}

/// One journal session: a single repo's cycle, or the night-level work.
pub struct Journal {
    client: Option<(reqwest::Client, JournalConfig)>,
    session: String,
    step: AtomicU32,
    recorded: AtomicU32,
    failed: AtomicU32,
    skipped: AtomicU32,
    open_calls: AtomicU32,
    consecutive_failures: AtomicU32,
    breaker_logged: AtomicBool,
}

impl Journal {
    /// A journal that records nothing (tests, `DREAM_JOURNAL=0`).
    pub fn disabled(session: &str) -> Self {
        Self::build(None, session)
    }

    /// A journal posting to `cfg`. A client that cannot be built degrades to
    /// disabled, logged once.
    pub fn new(cfg: JournalConfig, session: &str) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build();
        match client {
            Ok(c) => Self::build(Some((c, cfg)), session),
            Err(e) => {
                warn!(error = %e, "journal HTTP client unavailable — night runs unjournalled (fail-open)");
                Self::build(None, session)
            }
        }
    }

    /// Environment-configured journal; see [`JournalConfig::from_env`].
    pub fn from_env(session: &str) -> Self {
        match JournalConfig::from_env() {
            Some(cfg) => Self::new(cfg, session),
            None => Self::disabled(session),
        }
    }

    fn build(client: Option<(reqwest::Client, JournalConfig)>, session: &str) -> Self {
        Self {
            client,
            session: session_slug(session),
            step: AtomicU32::new(0),
            recorded: AtomicU32::new(0),
            failed: AtomicU32::new(0),
            skipped: AtomicU32::new(0),
            open_calls: AtomicU32::new(0),
            consecutive_failures: AtomicU32::new(0),
            breaker_logged: AtomicBool::new(false),
        }
    }

    /// The session slug the API mints its URN from.
    pub fn session(&self) -> &str {
        &self.session
    }

    /// Record the start of the session (`turn.started`).
    pub async fn turn_started(&self, payload: Value) {
        self.post("turn.started", None, "turn-started", None, payload)
            .await;
    }

    /// Record the end of the session (`turn.completed`).
    pub async fn turn_completed(&self, payload: Value) {
        self.post("turn.completed", None, "turn-completed", None, payload)
            .await;
    }

    /// Record that a side effect is about to happen. `tool` is a stable,
    /// dotted class name (`annexe.ssh`, `llm.call`, `git.push`); `detail` is
    /// what distinguishes this instance.
    pub async fn called(&self, tool: &str, detail: Value) -> Call {
        let step = self.step.fetch_add(1, Ordering::SeqCst) + 1;
        let payload = json!({ "tool": tool, "detail": detail });
        let event_id = self
            .post(
                "tool.called",
                Some(step),
                &format!("step-{step}-called"),
                None,
                payload,
            )
            .await;
        self.open_calls.fetch_add(1, Ordering::SeqCst);
        Call {
            step,
            tool: tool.to_string(),
            event_id,
            started: Instant::now(),
        }
    }

    /// Record the outcome of a side effect opened by [`Journal::called`].
    pub async fn completed(&self, call: Call, ok: bool, detail: Value) {
        self.open_calls.fetch_sub(1, Ordering::SeqCst);
        let payload = json!({
            "tool": call.tool,
            "ok": ok,
            "duration_ms": call.started.elapsed().as_millis() as u64,
            "detail": detail,
        });
        self.post(
            "tool.completed",
            Some(call.step),
            &format!("step-{}-completed", call.step),
            call.event_id.as_deref(),
            payload,
        )
        .await;
    }

    /// Counters for the night-health summary.
    pub fn stats(&self) -> JournalStats {
        JournalStats {
            session: self.session.clone(),
            enabled: self.client.is_some(),
            recorded: self.recorded.load(Ordering::SeqCst),
            failed: self.failed.load(Ordering::SeqCst),
            skipped: self.skipped.load(Ordering::SeqCst),
            unpaired: self.open_calls.load(Ordering::SeqCst),
        }
    }

    /// Post one event; returns its `event_id` on success. Never errors.
    async fn post(
        &self,
        event_type: &str,
        step: Option<u32>,
        key: &str,
        causation: Option<&str>,
        payload: Value,
    ) -> Option<String> {
        let (client, cfg) = self.client.as_ref()?;
        if self.consecutive_failures.load(Ordering::SeqCst) >= BREAKER_THRESHOLD {
            self.skipped.fetch_add(1, Ordering::SeqCst);
            if !self.breaker_logged.swap(true, Ordering::SeqCst) {
                warn!(session = %self.session, "journal breaker open — rest of this session runs unjournalled (fail-open)");
            }
            return None;
        }

        let mut body = json!({
            "session": self.session,
            "harness": HARNESS,
            "type": event_type,
            "turn": 0,
            "key": key,
            "payload": payload,
        });
        if let Some(s) = step {
            body["step"] = json!(s);
        }
        if let Some(c) = causation {
            body["causation"] = json!(c);
        }

        let url = format!("{}/v1/exec/record", cfg.base_url.trim_end_matches('/'));
        let mut req = client.post(&url).json(&body);
        if let Some(k) = &cfg.api_key {
            req = req.bearer_auth(k);
        }
        let outcome = match req.send().await {
            Ok(resp) if resp.status().is_success() => resp
                .json::<Value>()
                .await
                .ok()
                .and_then(|v| v.get("event_id").and_then(Value::as_str).map(str::to_owned))
                .ok_or_else(|| "response carried no event_id".to_string()),
            Ok(resp) => Err(format!("HTTP {}", resp.status())),
            Err(e) => Err(e.to_string()),
        };
        match outcome {
            Ok(id) => {
                self.recorded.fetch_add(1, Ordering::SeqCst);
                self.consecutive_failures.store(0, Ordering::SeqCst);
                Some(id)
            }
            Err(reason) => {
                self.failed.fetch_add(1, Ordering::SeqCst);
                let n = self.consecutive_failures.fetch_add(1, Ordering::SeqCst) + 1;
                warn!(session = %self.session, event = event_type, %reason, consecutive = n, "journal post failed (fail-open)");
                None
            }
        }
    }
}

impl Drop for Journal {
    fn drop(&mut self) {
        let s = self.stats();
        if s.enabled {
            info!(
                session = %s.session,
                recorded = s.recorded,
                failed = s.failed,
                skipped = s.skipped,
                unpaired = s.unpaired,
                "journal session closed"
            );
        }
    }
}

/// Session slug for a cycle: `<night_id>-<unix seconds>`, restricted to the
/// API's `[A-Za-z0-9._-]{1,160}`. The timestamp keeps a restarted attempt from
/// reusing a session whose sequence the API already holds.
pub fn session_for(night_id: &str, unix_secs: i64) -> String {
    session_slug(&format!("{night_id}-{unix_secs}"))
}

fn session_slug(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .take(160)
        .collect();
    if s.is_empty() {
        "session".into()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A one-route stub of the management API: records every JSON body and
    /// answers 201 with a synthetic event id (or `status` for every request).
    async fn stub_api(status: u16) -> (String, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let sink = sink.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    // Read headers, then exactly Content-Length body bytes.
                    let body = loop {
                        let n = sock.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        let text = String::from_utf8_lossy(&buf).to_string();
                        if let Some(idx) = text.find("\r\n\r\n") {
                            let len = text[..idx]
                                .lines()
                                .find_map(|l| {
                                    let (k, v) = l.split_once(':')?;
                                    k.eq_ignore_ascii_case("content-length")
                                        .then(|| v.trim().parse::<usize>().ok())?
                                })
                                .unwrap_or(0);
                            if buf.len() >= idx + 4 + len {
                                break buf[idx + 4..idx + 4 + len].to_vec();
                            }
                        }
                    };
                    let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                    let n = {
                        let mut g = sink.lock().unwrap();
                        g.push(v);
                        g.len()
                    };
                    let resp_body = format!(
                        "{{\"event_id\":\"urn:agentbox:meta:exec-{n}\",\"seq\":{}}}",
                        n - 1
                    );
                    let resp = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                        resp_body.len(),
                        resp_body
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        (format!("http://{addr}"), seen)
    }

    fn cfg(url: &str) -> JournalConfig {
        JournalConfig {
            base_url: url.into(),
            api_key: Some("k".into()),
        }
    }

    #[tokio::test]
    async fn pairs_share_step_and_link_by_causation() {
        let (url, seen) = stub_api(201).await;
        let j = Journal::new(cfg(&url), "2026-09-30-VisionFlow-1");
        j.turn_started(json!({ "repo": "VisionFlow" })).await;
        let c = j
            .called("annexe.ssh", json!({ "op": "retention-sweep" }))
            .await;
        j.completed(c, true, json!({})).await;
        j.turn_completed(json!({ "verdict": "ACCEPT" })).await;

        let got = seen.lock().unwrap().clone();
        let types: Vec<&str> = got.iter().map(|v| v["type"].as_str().unwrap()).collect();
        assert_eq!(
            types,
            [
                "turn.started",
                "tool.called",
                "tool.completed",
                "turn.completed"
            ]
        );
        assert!(got
            .iter()
            .all(|v| v["session"] == "2026-09-30-VisionFlow-1" && v["harness"] == HARNESS));
        assert_eq!(got[1]["step"], got[2]["step"]);
        assert_eq!(got[2]["causation"], "urn:agentbox:meta:exec-2");
        assert_eq!(got[2]["payload"]["tool"], "annexe.ssh");
        assert_eq!(got[2]["payload"]["ok"], true);
        let s = j.stats();
        assert_eq!((s.recorded, s.failed, s.skipped, s.unpaired), (4, 0, 0, 0));
    }

    #[tokio::test]
    async fn api_down_is_fail_open_and_trips_the_breaker() {
        // Bind then drop: the port is closed, so every connect is refused.
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap().port()
        };
        let j = Journal::new(cfg(&format!("http://127.0.0.1:{port}")), "down");
        let t0 = Instant::now();
        for i in 0..10 {
            let c = j.called("llm.call", json!({ "i": i })).await;
            j.completed(c, true, json!({})).await;
        }
        let s = j.stats();
        assert_eq!(s.recorded, 0);
        assert_eq!(s.failed, BREAKER_THRESHOLD);
        assert_eq!(s.skipped, 20 - BREAKER_THRESHOLD);
        assert_eq!(s.unpaired, 0);
        assert!(
            t0.elapsed() < Duration::from_secs(10),
            "a down API must not stall the night"
        );
    }

    #[tokio::test]
    async fn rejected_posts_count_as_failures() {
        let (url, _seen) = stub_api(401).await;
        let j = Journal::new(cfg(&url), "unauth");
        let c = j.called("git.push", json!({})).await;
        j.completed(c, false, json!({})).await;
        assert_eq!(j.stats().failed, 2);
        assert_eq!(j.stats().recorded, 0);
    }

    #[tokio::test]
    async fn disabled_journal_records_nothing_and_never_blocks() {
        let j = Journal::disabled("off");
        let c = j.called("ledger.append", json!({})).await;
        j.completed(c, true, json!({})).await;
        let s = j.stats();
        assert!(!s.enabled);
        assert_eq!((s.recorded, s.failed, s.skipped), (0, 0, 0));
    }

    #[tokio::test]
    async fn an_unclosed_call_is_counted_unpaired() {
        let j = Journal::disabled("crash");
        let _c = j.called("annexe.clone", json!({})).await;
        assert_eq!(j.stats().unpaired, 1);
    }

    #[test]
    fn session_slugs_fit_the_api_pattern() {
        assert_eq!(
            session_for("2026-09-30-VisionFlow", 1759200000),
            "2026-09-30-VisionFlow-1759200000"
        );
        assert_eq!(session_slug("night/2026:09 30"), "night-2026-09-30");
        assert_eq!(session_slug(""), "session");
        assert_eq!(session_slug(&"x".repeat(400)).len(), 160);
    }
}
