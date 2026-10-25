//! The opt-in Jev option for AB-23-S1-01 — prioritise a dream hypothesis before the
//! expensive candidate evaluation.
//!
//! # Where
//!
//! `engine.rs` step 7 parses the report's verdict; step 8 applies the emitted patch on an
//! isolated worktree and re-runs every required evaluator against it (AB-23.5). That is the
//! costly part of a night. This module sits between the two: one System One request carrying
//! the hypothesis, the change surface and the evaluator catalogue, two typed questions:
//!
//! * `usefulness` — Score, four levels: how likely the proposed improvement is to be a real,
//!   useful change rather than a generic refactor;
//! * `problem_supported` — Noul: is the problem statement supported by the evidence in the
//!   report?
//!
//! # Authority
//!
//! The signals are **annotation**: they are written to `<night>/jev-triage.json` and logged.
//! They never reach the gate. A high `usefulness` never means ACCEPT; the deterministic gate
//! (`dream_gate::gate::decide`) still sees only evaluator receipts, the protected-path guard
//! and the human merge gate stays. The single action available is a *deferral*: when
//! `AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW` is set and `problem_supported` is below it, the
//! candidate is not built, the candidate state stays `NotAttempted`, and the gate vetoes an
//! ACCEPT claim as *unproven* — the same state a night with no patch already reaches. The
//! default is unset, which means **never defer**.
//!
//! # Flag and egress
//!
//! `AGENTBOX_JEV_DREAM_TRIAGE=1`, off by default; off ⇒ no request is built and nothing leaves
//! the process. Endpoint resolution follows `guides/jev-option-contract.md` §2: the ADR-2139
//! loopback proxy (`AGENTBOX_SYSTEM_ONE_PROXY=1` with `AGENTBOX_SYSTEM_ONE_ENDPOINT` +
//! `AGENTBOX_SYSTEM_ONE_MODEL`, no Authorization header), else `api.typesafe.ai` with
//! `TYPESAFE_API_KEY`, else unavailable. `AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY=1` refuses
//! anything not declared local (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1`). The wire format is the
//! one `crates/system-one/system-one-client` speaks; that crate is a workspace path
//! dependency and this service builds from `services/dream-engine` alone, so the handful of
//! lines of request building live here rather than adding a cross-tree dependency.
//!
//! # Fallback
//!
//! Flag off, no endpoint, transport error, timeout, non-2xx, unparsable body, a missing answer
//! or an out-of-range value all resolve to [`Outcome::Fallback`]. [`consider`] then returns
//! `false` (do not defer) and writes nothing, so the night proceeds exactly as it did before.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::time::Duration;
use tracing::{info, warn};

/// Stable version of the two questions; written into every record.
pub const QUESTION_SET_VERSION: &str = "ab23-dream-triage/1";
/// Name of the annotation file inside a night directory.
pub const RECORD_FILE: &str = "jev-triage.json";
/// A night is a batch job, not an interactive turn, but the call still has a hard deadline and no retry.
pub const TIMEOUT: Duration = Duration::from_secs(15);

const FLAG: &str = "AGENTBOX_JEV_DREAM_TRIAGE";
const DEFAULT_URL: &str = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL: &str = "jev-latest";
const REPORT_CHARS: usize = 4000;

const USEFULNESS_LEVELS: [&str; 4] = [
    "Generic: a refactor, rename or tidy-up with no demonstrated problem behind it.",
    "Weak: a real but minor improvement, or a problem the evidence only hints at.",
    "Plausible: a concrete problem is evidenced and the change targets it.",
    "Strong: a clearly evidenced defect or gap, and the change is the obvious remedy.",
];

/// A reason the option fell back. Closed vocabulary, logged alone — never request content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reason {
    FlagOff,
    NoEndpoint,
    LocalOnly,
    Timeout,
    Network,
    Http(u16),
    Malformed,
}

impl Reason {
    /// The log token (`flag-off`, `no-endpoint`, `local-only`, `timeout`, `network`, `http-<code>`, `malformed`).
    pub fn token(&self) -> String {
        match self {
            Reason::FlagOff => "flag-off".into(),
            Reason::NoEndpoint => "no-endpoint".into(),
            Reason::LocalOnly => "local-only".into(),
            Reason::Timeout => "timeout".into(),
            Reason::Network => "network".into(),
            Reason::Http(c) => format!("http-{c}"),
            Reason::Malformed => "malformed".into(),
        }
    }
}

/// The resolved destination of a request.
#[derive(Debug, Clone, PartialEq)]
pub struct Endpoint {
    pub url: String,
    pub model: String,
    /// `Authorization` header value, only for the direct TypeSafe route; the proxy holds the key.
    pub bearer: Option<String>,
    pub local: bool,
}

/// Process configuration, read once from an environment lookup (injectable for tests).
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub endpoint: Result<Endpoint, Reason>,
    /// Defer the candidate evaluation when `problem_supported` is below this. `None` ⇒ never.
    pub defer_below: Option<f64>,
}

fn truthy(v: Option<String>) -> bool {
    matches!(
        v.as_deref()
            .map(|s| s.trim().to_ascii_lowercase())
            .as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl Config {
    /// Read the configuration through `get`. Enabled only by an explicit opt-in.
    pub fn from_lookup(get: &dyn Fn(&str) -> Option<String>) -> Self {
        let enabled = truthy(get(FLAG));
        let local_only = truthy(get("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY"));
        let declared_local = get("AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL").as_deref() == Some("1");
        let endpoint = if get("AGENTBOX_SYSTEM_ONE_PROXY").as_deref() == Some("1") {
            // The entrypoint exports the proxy URL under both names (system_one.rs); the shared JS
            // adapter reads either, so this must too or it would skip the proxy and its locality switch.
            match non_empty(get("AGENTBOX_SYSTEM_ONE_ENDPOINT"))
                .or_else(|| non_empty(get("AGENTBOX_SKILL_ROUTE_API")))
            {
                Some(url) if local_only && !declared_local => {
                    let _ = url;
                    Err(Reason::LocalOnly)
                }
                Some(url) => Ok(Endpoint {
                    url,
                    model: non_empty(get("AGENTBOX_SYSTEM_ONE_MODEL"))
                        .or_else(|| non_empty(get("AGENTBOX_SKILL_ROUTE_MODEL")))
                        .unwrap_or_else(|| DEFAULT_MODEL.into()),
                    bearer: None,
                    local: declared_local,
                }),
                None => Self::cloud(get, local_only),
            }
        } else {
            Self::cloud(get, local_only)
        };
        let defer_below = non_empty(get("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW"))
            .and_then(|s| s.parse::<f64>().ok())
            // A Noul near 0.5 means "uncertain". A threshold above 0.5 would defer on an uncertain
            // answer, so it is refused (treated as unset) rather than honoured.
            .filter(|v| v.is_finite() && (0.0..=0.5).contains(v));
        Config {
            enabled,
            endpoint,
            defer_below,
        }
    }

    fn cloud(get: &dyn Fn(&str) -> Option<String>, local_only: bool) -> Result<Endpoint, Reason> {
        match non_empty(get("TYPESAFE_API_KEY")) {
            Some(_) if local_only => Err(Reason::LocalOnly),
            Some(key) => Ok(Endpoint {
                url: DEFAULT_URL.into(),
                model: DEFAULT_MODEL.into(),
                bearer: Some(format!("Bearer {key}")),
                local: false,
            }),
            None => Err(Reason::NoEndpoint),
        }
    }

    /// The process environment.
    pub fn from_env() -> Self {
        Self::from_lookup(&|k| std::env::var(k).ok())
    }
}

/// What the engine knows at step 7→8. Every field is data the night already holds.
#[derive(Debug, Clone, PartialEq)]
pub struct Input {
    /// The model's report (head only is sent).
    pub report: String,
    /// The emitted patch, if any; only the paths it touches are sent.
    pub patch: Option<String>,
    /// Names of the required evaluators from the frozen manifest.
    pub evaluators: Vec<String>,
    /// The repository's own `extraDisciplines` from `dream.config.json` (at most [`MAX_DISCIPLINES`]
    /// are asked). Each becomes an independent "does the change violate this rule?" Noul.
    pub disciplines: Vec<String>,
}

/// Cap on `extraDisciplines` asked per request.
pub const MAX_DISCIPLINES: usize = 12;

/// The two signals, both in `[0, 1]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Signals {
    /// Score normalised as `score / (levels − 1)`.
    pub usefulness: f64,
    /// Probability that the problem statement is supported by the evidence.
    pub problem_supported: f64,
    /// Probability of violation per discipline asked, in the order of `Input::disciplines`.
    pub violations: Vec<f64>,
    pub model: String,
}

/// The result of one triage attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Annotated(Signals),
    Fallback(Reason),
}

/// An HTTP exchange, reduced to what this module needs.
pub struct HttpRequest {
    pub url: String,
    pub bearer: Option<String>,
    pub body: String,
}

/// A transport failure.
#[derive(Debug, Clone, PartialEq)]
pub enum TransportError {
    Timeout,
    Network,
}

/// Replaceable transport so tests never touch the network.
pub trait Transport: Send + Sync {
    /// POST `req`, resolving the status code and body.
    fn post<'a>(
        &'a self,
        req: &'a HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<(u16, String), TransportError>> + Send + 'a>>;
}

/// The production transport: `reqwest` with a hard deadline and no retry.
pub struct ReqwestTransport;

impl Transport for ReqwestTransport {
    fn post<'a>(
        &'a self,
        req: &'a HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<(u16, String), TransportError>> + Send + 'a>> {
        Box::pin(async move {
            let client = reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .map_err(|_| TransportError::Network)?;
            let mut r = client
                .post(&req.url)
                .header("Content-Type", "application/json");
            if let Some(b) = &req.bearer {
                r = r.header("Authorization", b);
            }
            let resp = r.body(req.body.clone()).send().await.map_err(|e| {
                if e.is_timeout() {
                    TransportError::Timeout
                } else {
                    TransportError::Network
                }
            })?;
            let status = resp.status().as_u16();
            let text = resp.text().await.map_err(|_| TransportError::Network)?;
            Ok((status, text))
        })
    }
}

fn clamp_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Paths a unified diff touches (`+++ b/<path>` lines), de-duplicated, in order.
pub fn change_surface(patch: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            let p = rest.trim().trim_start_matches("b/").to_string();
            if p != "/dev/null" && !p.is_empty() && !seen.contains(&p) {
                seen.push(p);
            }
        }
    }
    seen
}

/// Build the request body. Pure; the wire-shape test checks it.
pub fn build_request(input: &Input, model: &str) -> Value {
    let disciplines: Vec<&String> = input.disciplines.iter().take(MAX_DISCIPLINES).collect();
    let mut v = json!({
        "model": model,
        "state": {
            "hypothesis_report": clamp_chars(&input.report, REPORT_CHARS),
            "change_surface": input.patch.as_deref().map(change_surface).unwrap_or_default(),
            "evaluator_catalogue": input.evaluators,
            "repo_disciplines": disciplines,
        },
        "questions": {
            "usefulness": {
                "type": "score",
                "instructions": "How likely is the improvement proposed in `hypothesis_report` to be a real, useful change \
                    rather than a generic refactor? Judge the problem it claims to solve against the evidence the report \
                    cites, the size of `change_surface`, and whether `evaluator_catalogue` could actually detect the \
                    claimed improvement.",
                "criteria": USEFULNESS_LEVELS,
            },
            "problem_supported": {
                "type": "noul",
                "instructions": "Does the evidence quoted in `hypothesis_report` actually support the problem statement it \
                    opens with, rather than merely asserting it?",
            },
        },
    });
    for (i, d) in disciplines.iter().enumerate() {
        v["questions"][format!("violates_{i}")] = json!({
            "type": "noul",
            "instructions": format!(
                "Does the change proposed in `hypothesis_report` violate the repository rule at index {i} of \
                 `repo_disciplines` (\"{}\")? Answer yes only if the report or `change_surface` shows the violation.",
                clamp_chars(d, 200)
            ),
        });
    }
    v
}

/// Parse a response body into signals, or `Malformed`. `n_disciplines` is how many violation
/// questions were asked; every one must be answered.
pub fn parse_response(body: &str, n_disciplines: usize) -> Result<Signals, Reason> {
    let v: Value = serde_json::from_str(body).map_err(|_| Reason::Malformed)?;
    let answers = v
        .get("answers")
        .and_then(Value::as_object)
        .ok_or(Reason::Malformed)?;
    let usefulness_raw = answers
        .get("usefulness")
        .filter(|a| a.get("type").and_then(Value::as_str) == Some("score"))
        .and_then(|a| a.get("score"))
        .and_then(Value::as_f64)
        .ok_or(Reason::Malformed)?;
    let top = (USEFULNESS_LEVELS.len() - 1) as f64;
    if !usefulness_raw.is_finite() || !(0.0..=top).contains(&usefulness_raw) {
        return Err(Reason::Malformed);
    }
    let supported = answers
        .get("problem_supported")
        .filter(|a| a.get("type").and_then(Value::as_str) == Some("noul"))
        .and_then(|a| a.get("noul"))
        .and_then(Value::as_f64)
        .ok_or(Reason::Malformed)?;
    if !supported.is_finite() || !(0.0..=1.0).contains(&supported) {
        return Err(Reason::Malformed);
    }
    let mut violations = Vec::with_capacity(n_disciplines);
    for i in 0..n_disciplines {
        let p = answers
            .get(&format!("violates_{i}"))
            .filter(|a| a.get("type").and_then(Value::as_str) == Some("noul"))
            .and_then(|a| a.get("noul"))
            .and_then(Value::as_f64)
            .filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
            .ok_or(Reason::Malformed)?;
        violations.push(p);
    }
    Ok(Signals {
        usefulness: usefulness_raw / top,
        problem_supported: supported,
        violations,
        model: v
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

/// Ask for the signals. Never panics and never returns an error to the caller.
pub async fn triage(cfg: &Config, transport: &dyn Transport, input: &Input) -> Outcome {
    if !cfg.enabled {
        return Outcome::Fallback(Reason::FlagOff);
    }
    let ep = match &cfg.endpoint {
        Ok(ep) => ep,
        Err(r) => return Outcome::Fallback(r.clone()),
    };
    let body = build_request(input, &ep.model).to_string();
    let req = HttpRequest {
        url: ep.url.clone(),
        bearer: ep.bearer.clone(),
        body,
    };
    match transport.post(&req).await {
        Err(TransportError::Timeout) => Outcome::Fallback(Reason::Timeout),
        Err(TransportError::Network) => Outcome::Fallback(Reason::Network),
        Ok((status, _)) if !(200..300).contains(&status) => Outcome::Fallback(Reason::Http(status)),
        Ok((_, text)) => {
            match parse_response(&text, input.disciplines.len().min(MAX_DISCIPLINES)) {
                Ok(s) => Outcome::Annotated(s),
                Err(r) => Outcome::Fallback(r),
            }
        }
    }
}

/// Whether the candidate evaluation should be deferred for these signals.
/// Only an explicitly configured threshold can ever say yes; `usefulness` never does.
pub fn should_defer(cfg: &Config, s: &Signals) -> bool {
    matches!(cfg.defer_below, Some(t) if s.problem_supported < t)
}

/// The engine's single call. Writes `<night_dir>/jev-triage.json` on success and returns `true`
/// only when the candidate evaluation should be deferred. Every fallback returns `false` and
/// writes nothing, so the caller's behaviour is then identical to the code before this module.
pub async fn consider(
    cfg: &Config,
    transport: &dyn Transport,
    night_dir: &Path,
    input: &Input,
) -> bool {
    match triage(cfg, transport, input).await {
        Outcome::Fallback(Reason::FlagOff) => false,
        Outcome::Fallback(r) => {
            warn!(item = "AB-23-S1-01", reason = %r.token(), "jev triage fell back");
            false
        }
        Outcome::Annotated(s) => {
            let defer = should_defer(cfg, &s);
            let mut rec: BTreeMap<&str, Value> = BTreeMap::new();
            rec.insert("question_set_version", json!(QUESTION_SET_VERSION));
            rec.insert("model", json!(s.model));
            rec.insert("usefulness", json!(round3(s.usefulness)));
            rec.insert("problem_supported", json!(round3(s.problem_supported)));
            rec.insert("defer_below", json!(cfg.defer_below));
            rec.insert(
                "discipline_violations",
                json!(input
                    .disciplines
                    .iter()
                    .zip(&s.violations)
                    .map(|(d, p)| json!({ "discipline": d, "p_violates": round3(*p) }))
                    .collect::<Vec<_>>()),
            );
            rec.insert("deferred", json!(defer));
            rec.insert(
                "authority",
                json!("none: annotation only; the deterministic gate decides"),
            );
            if let Err(e) = std::fs::write(
                night_dir.join(RECORD_FILE),
                serde_json::to_vec_pretty(&rec).unwrap_or_default(),
            ) {
                warn!(error = %e, "jev triage record not written (fail-open)");
            }
            info!(
                usefulness = s.usefulness,
                problem_supported = s.problem_supported,
                deferred = defer,
                "jev triage annotated the hypothesis"
            );
            defer
        }
    }
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: BTreeMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    const PROXY: [(&str, &str); 4] = [
        ("AGENTBOX_SYSTEM_ONE_PROXY", "1"),
        (
            "AGENTBOX_SYSTEM_ONE_ENDPOINT",
            "http://127.0.0.1:1/v1/systemone",
        ),
        ("AGENTBOX_SYSTEM_ONE_MODEL", "m"),
        ("AGENTBOX_JEV_DREAM_TRIAGE", "1"),
    ];

    fn cfg_with(extra: &[(&str, &str)]) -> Config {
        let mut all: Vec<(&str, &str)> = PROXY.to_vec();
        all.extend_from_slice(extra);
        Config::from_lookup(&env(&all))
    }

    fn input() -> Input {
        Input {
            report: "Problem: the retry loop spins. Evidence: log lines. VERDICT: ACCEPT".into(),
            patch: Some(
                "--- a/src/retry.rs\n+++ b/src/retry.rs\n@@\n-x\n+y\n+++ b/src/retry.rs\n".into(),
            ),
            evaluators: vec!["cargo-test".into(), "clippy".into()],
            disciplines: vec![],
        }
    }

    /// A scripted transport that records every request.
    struct Mock {
        reply: Result<(u16, String), TransportError>,
        seen: Mutex<Vec<(String, Option<String>, String)>>,
    }
    impl Mock {
        fn new(reply: Result<(u16, String), TransportError>) -> Self {
            Mock {
                reply,
                seen: Mutex::new(Vec::new()),
            }
        }
        fn calls(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }
    impl Transport for Mock {
        fn post<'a>(
            &'a self,
            req: &'a HttpRequest,
        ) -> Pin<Box<dyn Future<Output = Result<(u16, String), TransportError>> + Send + 'a>>
        {
            self.seen
                .lock()
                .unwrap()
                .push((req.url.clone(), req.bearer.clone(), req.body.clone()));
            let r = self.reply.clone();
            Box::pin(async move { r })
        }
    }

    fn body(usefulness: f64, supported: f64) -> String {
        json!({
            "model": "jev-test",
            "answers": {
                "usefulness": { "type": "score", "score": usefulness, "confidence": 0.9 },
                "problem_supported": { "type": "noul", "noul": supported },
            },
            "usage": { "input_tokens": 1, "output_tokens": 1 },
        })
        .to_string()
    }

    // ---- configuration ----

    #[test]
    fn off_unless_explicitly_opted_in() {
        for v in ["", "0", "false", "off", "maybe"] {
            let c = Config::from_lookup(&env(&[
                ("AGENTBOX_JEV_DREAM_TRIAGE", v),
                ("TYPESAFE_API_KEY", "k"),
            ]));
            assert!(!c.enabled, "{v:?}");
        }
        assert!(!Config::from_lookup(&env(&[])).enabled);
        for v in ["1", "true", "YES", "on"] {
            assert!(Config::from_lookup(&env(&[("AGENTBOX_JEV_DREAM_TRIAGE", v)])).enabled);
        }
    }

    #[test]
    fn endpoint_order_proxy_then_typesafe_then_none() {
        let proxy = cfg_with(&[("TYPESAFE_API_KEY", "k")]);
        let ep = proxy.endpoint.unwrap();
        assert_eq!(
            (ep.url.as_str(), ep.model.as_str(), ep.bearer),
            ("http://127.0.0.1:1/v1/systemone", "m", None)
        );
        let cloud = Config::from_lookup(&env(&[
            ("AGENTBOX_JEV_DREAM_TRIAGE", "1"),
            ("TYPESAFE_API_KEY", "k"),
        ]))
        .endpoint
        .unwrap();
        assert_eq!(
            (cloud.url.as_str(), cloud.model.as_str()),
            (DEFAULT_URL, "jev-latest")
        );
        assert_eq!(cloud.bearer.as_deref(), Some("Bearer k"));
        assert_eq!(
            Config::from_lookup(&env(&[("AGENTBOX_JEV_DREAM_TRIAGE", "1")])).endpoint,
            Err(Reason::NoEndpoint)
        );
        assert_eq!(
            Config::from_lookup(&env(&[("AGENTBOX_SYSTEM_ONE_PROXY", "1")])).endpoint,
            Err(Reason::NoEndpoint)
        );
    }

    #[test]
    fn accepts_the_skill_route_names_the_entrypoint_also_exports() {
        let c = Config::from_lookup(&env(&[
            ("AGENTBOX_SYSTEM_ONE_PROXY", "1"),
            (
                "AGENTBOX_SKILL_ROUTE_API",
                "http://127.0.0.1:8094/v1/systemone",
            ),
            ("AGENTBOX_SKILL_ROUTE_MODEL", "pm"),
            ("AGENTBOX_JEV_DREAM_TRIAGE", "1"),
            ("TYPESAFE_API_KEY", "must-not-be-used"),
        ]));
        let ep = c.endpoint.unwrap();
        assert_eq!(
            (ep.url.as_str(), ep.model.as_str(), ep.bearer),
            ("http://127.0.0.1:8094/v1/systemone", "pm", None)
        );
        // and local-only still refuses an undeclared proxy under those names
        let lo = Config::from_lookup(&env(&[
            ("AGENTBOX_SYSTEM_ONE_PROXY", "1"),
            (
                "AGENTBOX_SKILL_ROUTE_API",
                "http://127.0.0.1:8094/v1/systemone",
            ),
            ("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY", "1"),
        ]));
        assert_eq!(lo.endpoint, Err(Reason::LocalOnly));
    }

    #[tokio::test]
    async fn an_uncertain_answer_does_not_defer_even_with_the_highest_allowed_threshold() {
        let c = cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", "0.5")]);
        let dir = tempfile::tempdir().unwrap();
        // 0.5 is "uncertain": not below the threshold, so the night proceeds
        assert!(
            !consider(
                &c,
                &Mock::new(Ok((200, body(0.0, 0.5)))),
                dir.path(),
                &input()
            )
            .await
        );
        // just under is a confident "no": defers
        assert!(
            consider(
                &c,
                &Mock::new(Ok((200, body(0.0, 0.2)))),
                dir.path(),
                &input()
            )
            .await
        );
    }

    #[test]
    fn local_only_refuses_undeclared_endpoints() {
        assert_eq!(
            cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY", "1")]).endpoint,
            Err(Reason::LocalOnly)
        );
        assert!(cfg_with(&[
            ("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY", "1"),
            ("AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL", "1")
        ])
        .endpoint
        .is_ok());
        let cloud = Config::from_lookup(&env(&[
            ("TYPESAFE_API_KEY", "k"),
            ("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY", "1"),
        ]));
        assert_eq!(cloud.endpoint, Err(Reason::LocalOnly));
    }

    #[test]
    fn defer_threshold_defaults_to_never_and_rejects_nonsense() {
        assert_eq!(cfg_with(&[]).defer_below, None);
        assert_eq!(
            cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", "0.3")]).defer_below,
            Some(0.3)
        );
        for bad in ["x", "-1", "2", "NaN", "0.51", "0.9"] {
            assert_eq!(
                cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", bad)]).defer_below,
                None,
                "{bad}"
            );
        }
    }

    // ---- wire shape ----

    #[test]
    fn request_has_a_score_with_an_ordered_list_and_a_noul() {
        let v = build_request(&input(), "m");
        assert_eq!(v["model"], "m");
        assert_eq!(v["questions"]["usefulness"]["type"], "score");
        assert!(v["questions"]["usefulness"]["criteria"].is_array());
        assert_eq!(
            v["questions"]["usefulness"]["criteria"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert_eq!(v["questions"]["problem_supported"]["type"], "noul");
        assert_eq!(v["state"]["change_surface"], json!(["src/retry.rs"]));
        assert_eq!(
            v["state"]["evaluator_catalogue"],
            json!(["cargo-test", "clippy"])
        );
        let instr = v["questions"]["usefulness"]["instructions"]
            .as_str()
            .unwrap();
        for field in ["hypothesis_report", "change_surface", "evaluator_catalogue"] {
            assert!(instr.contains(field), "{field}");
        }
        let long = Input {
            report: "é".repeat(9000),
            ..input()
        };
        assert_eq!(
            build_request(&long, "m")["state"]["hypothesis_report"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            REPORT_CHARS
        );
    }

    #[test]
    fn repo_disciplines_become_violation_nouls() {
        let i = Input {
            disciplines: vec![
                "no new dependencies".into(),
                "ADRs for schema changes".into(),
            ],
            ..input()
        };
        let v = build_request(&i, "m");
        assert_eq!(
            v["state"]["repo_disciplines"],
            json!(["no new dependencies", "ADRs for schema changes"])
        );
        assert_eq!(v["questions"]["violates_1"]["type"], "noul");
        assert!(v["questions"]["violates_1"]["instructions"]
            .as_str()
            .unwrap()
            .contains("index 1 of `repo_disciplines`"));
        assert!(v["questions"].get("violates_2").is_none());
        let many = Input {
            disciplines: (0..30).map(|n| format!("d{n}")).collect(),
            ..input()
        };
        assert_eq!(
            build_request(&many, "m")["state"]["repo_disciplines"]
                .as_array()
                .unwrap()
                .len(),
            MAX_DISCIPLINES
        );
        // no disciplines ⇒ the request is exactly the pre-discipline shape plus an empty list, and no violates_*
        assert!(build_request(&input(), "m")["questions"]
            .get("violates_0")
            .is_none());
    }

    #[tokio::test]
    async fn violations_are_recorded_and_a_missing_one_is_malformed() {
        let i = Input {
            disciplines: vec!["no new dependencies".into()],
            ..input()
        };
        let mut ok = serde_json::from_str::<Value>(&body(2.0, 0.9)).unwrap();
        ok["answers"]["violates_0"] = json!({"type":"noul","noul":0.8});
        let c = cfg_with(&[]);
        let dir = tempfile::tempdir().unwrap();
        assert!(!consider(&c, &Mock::new(Ok((200, ok.to_string()))), dir.path(), &i).await);
        let rec: Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(RECORD_FILE)).unwrap()).unwrap();
        assert_eq!(
            rec["discipline_violations"][0]["discipline"],
            "no new dependencies"
        );
        assert_eq!(rec["discipline_violations"][0]["p_violates"], 0.8);
        // a violation never defers by itself
        let dir2 = tempfile::tempdir().unwrap();
        let strict = cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", "0.4")]);
        assert!(
            !consider(
                &strict,
                &Mock::new(Ok((200, ok.to_string()))),
                dir2.path(),
                &i
            )
            .await
        );
        // the answer is absent ⇒ fallback, nothing written
        let dir3 = tempfile::tempdir().unwrap();
        assert_eq!(
            triage(&c, &Mock::new(Ok((200, body(2.0, 0.9)))), &i).await,
            Outcome::Fallback(Reason::Malformed)
        );
        assert!(!consider(&c, &Mock::new(Ok((200, body(2.0, 0.9)))), dir3.path(), &i).await);
        assert_eq!(std::fs::read_dir(dir3.path()).unwrap().count(), 0);
    }

    #[test]
    fn only_paths_of_the_patch_are_sent_not_its_content() {
        let v = build_request(&input(), "m").to_string();
        assert!(!v.contains("-x") && !v.contains("+y"));
    }

    // ---- fallback equivalence: flag off, key unset, client error, timeout, malformed, low/odd values ----

    #[tokio::test]
    async fn flag_off_sends_nothing_and_does_not_defer() {
        let m = Mock::new(Ok((200, body(0.0, 0.0))));
        let mut c = cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", "0.9")]);
        c.enabled = false;
        let dir = tempfile::tempdir().unwrap();
        assert!(!consider(&c, &m, dir.path(), &input()).await);
        assert_eq!(m.calls(), 0);
        assert!(!dir.path().join(RECORD_FILE).exists());
    }

    #[tokio::test]
    async fn every_fallback_returns_false_and_leaves_the_night_directory_untouched() {
        let cases: Vec<(&str, Config, Result<(u16, String), TransportError>, Reason)> = vec![
            ("key unset", Config::from_lookup(&env(&[("AGENTBOX_JEV_DREAM_TRIAGE", "1")])), Ok((200, body(3.0, 1.0))), Reason::NoEndpoint),
            ("local-only", cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_LOCAL_ONLY", "1")]), Ok((200, body(3.0, 1.0))), Reason::LocalOnly),
            ("timeout", cfg_with(&[]), Err(TransportError::Timeout), Reason::Timeout),
            ("network", cfg_with(&[]), Err(TransportError::Network), Reason::Network),
            ("http 500", cfg_with(&[]), Ok((500, "{}".into())), Reason::Http(500)),
            ("http 429", cfg_with(&[]), Ok((429, "{}".into())), Reason::Http(429)),
            ("not json", cfg_with(&[]), Ok((200, "<html>".into())), Reason::Malformed),
            ("no answers", cfg_with(&[]), Ok((200, "{\"model\":\"x\"}".into())), Reason::Malformed),
            ("missing noul", cfg_with(&[]), Ok((200, json!({"answers":{"usefulness":{"type":"score","score":1.0}}}).to_string())), Reason::Malformed),
            ("wrong answer type", cfg_with(&[]), Ok((200, json!({"answers":{"usefulness":{"type":"noul","noul":0.5},"problem_supported":{"type":"noul","noul":0.5}}}).to_string())), Reason::Malformed),
            ("score out of range", cfg_with(&[]), Ok((200, body(7.0, 0.5))), Reason::Malformed),
            ("noul out of range", cfg_with(&[]), Ok((200, body(1.0, 1.5))), Reason::Malformed),
        ];
        for (name, mut cfg, reply, want) in cases {
            cfg.defer_below = Some(0.99); // even a hair-trigger threshold must not act on a fallback
            let m = Mock::new(reply);
            let dir = tempfile::tempdir().unwrap();
            assert_eq!(
                triage(&cfg, &m, &input()).await,
                Outcome::Fallback(want),
                "{name}"
            );
            assert!(!consider(&cfg, &m, dir.path(), &input()).await, "{name}");
            assert_eq!(
                std::fs::read_dir(dir.path()).unwrap().count(),
                0,
                "{name}: nothing written"
            );
        }
    }

    // ---- accept path ----

    #[tokio::test]
    async fn annotation_is_written_but_never_defers_without_a_threshold() {
        let m = Mock::new(Ok((200, body(2.7, 0.05))));
        let c = cfg_with(&[]);
        let dir = tempfile::tempdir().unwrap();
        assert!(
            !consider(&c, &m, dir.path(), &input()).await,
            "an unset threshold means never"
        );
        let rec: Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(RECORD_FILE)).unwrap()).unwrap();
        assert_eq!(rec["question_set_version"], QUESTION_SET_VERSION);
        assert_eq!(rec["usefulness"], 0.9);
        assert_eq!(rec["problem_supported"], 0.05);
        assert_eq!(rec["deferred"], false);
        assert!(rec["authority"]
            .as_str()
            .unwrap()
            .contains("annotation only"));
    }

    #[tokio::test]
    async fn defers_only_below_an_explicit_threshold_and_only_on_the_support_signal() {
        let c = cfg_with(&[("AGENTBOX_JEV_DREAM_TRIAGE_DEFER_BELOW", "0.4")]);
        let dir = tempfile::tempdir().unwrap();
        // unsupported problem statement ⇒ defer (even though usefulness is top)
        assert!(
            consider(
                &c,
                &Mock::new(Ok((200, body(3.0, 0.1)))),
                dir.path(),
                &input()
            )
            .await
        );
        // supported ⇒ proceed (even though usefulness is bottom)
        let dir2 = tempfile::tempdir().unwrap();
        assert!(
            !consider(
                &c,
                &Mock::new(Ok((200, body(0.0, 0.9)))),
                dir2.path(),
                &input()
            )
            .await
        );
        let rec: Value =
            serde_json::from_slice(&std::fs::read(dir.path().join(RECORD_FILE)).unwrap()).unwrap();
        assert_eq!(rec["deferred"], true);
        assert_eq!(rec["defer_below"], 0.4);
    }

    #[tokio::test]
    async fn the_proxy_route_sends_no_authorization_and_the_cloud_route_sends_the_bearer() {
        let m = Mock::new(Ok((200, body(1.0, 0.5))));
        let _ = triage(&cfg_with(&[]), &m, &input()).await;
        let (url, bearer, sent) = m.seen.lock().unwrap()[0].clone();
        assert_eq!(
            (url.as_str(), bearer),
            ("http://127.0.0.1:1/v1/systemone", None)
        );
        assert!(serde_json::from_str::<Value>(&sent).is_ok());
        let cloud = Config::from_lookup(&env(&[
            ("AGENTBOX_JEV_DREAM_TRIAGE", "1"),
            ("TYPESAFE_API_KEY", "k"),
        ]));
        let m2 = Mock::new(Ok((200, body(1.0, 0.5))));
        let _ = triage(&cloud, &m2, &input()).await;
        assert_eq!(m2.seen.lock().unwrap()[0].1.as_deref(), Some("Bearer k"));
    }

    #[test]
    fn change_surface_dedupes_and_skips_dev_null() {
        let p = "--- /dev/null\n+++ b/new.rs\n--- a/x\n+++ b/x\n+++ b/x\n--- a/y\n+++ /dev/null\n";
        assert_eq!(
            change_surface(p),
            vec!["new.rs".to_string(), "x".to_string()]
        );
    }
}
