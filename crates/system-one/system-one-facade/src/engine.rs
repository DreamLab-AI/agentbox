//! The loopback client for the laya engine.
//!
//! The engine is the only thing downstream of the façade, it listens on
//! loopback only, and it is the sole holder of the model. Everything this
//! module does is therefore about *honesty*: report the engine's real budget
//! rather than assume one, report the tokens the engine really consumed rather
//! than the tokens we sent, and turn an engine failure into a loud error
//! rather than into a plausible answer.

use std::sync::RwLock;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use system_one_core::budget::{DEFAULT_HEAD_MAX_LEN, DEFAULT_MAX_LEN, OPTION_TOKEN_CAP};
use system_one_core::capability::{DeclaredCapabilities, EngineCapabilities};
use system_one_core::wire::ChoiceAction;

use crate::config::Config;
use crate::error::{FacadeError, Result};

/// The capability shape assumed of an engine that declares nothing.
///
/// Conservative by construction (contract §11.4): an engine that fails to
/// declare itself gets the shared-head, hard-capped treatment, because the cost
/// of over-protecting an unconstrained engine is some wasted headroom while the
/// cost of under-protecting a constrained one is the silent four-token collapse
/// this façade exists to prevent.
pub fn fallback_capabilities(cfg: &Config) -> EngineCapabilities {
    EngineCapabilities {
        max_len: DEFAULT_MAX_LEN,
        head_max_len: Some(DEFAULT_HEAD_MAX_LEN),
        option_max_len: Some(cfg.option_max_tokens.min(OPTION_TOKEN_CAP)),
        scores_options_independently: false,
    }
}

/// Raw `/v1/models` payload, accepted in either the flat or OpenAI-ish shape.
///
/// Capability fields are read at both levels and merged, the top level winning
/// per field, so neither shape can hide a declaration.
#[derive(Debug, Deserialize)]
struct ModelsPayload {
    #[serde(default)]
    data: Vec<ModelEntry>,
    #[serde(flatten)]
    declared: DeclaredCapabilities,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(flatten)]
    declared: DeclaredCapabilities,
}

/// One question as the engine receives it, after shortlisting and compression.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum EngineQuestion {
    /// Pick one option key.
    Choice {
        /// Prompt.
        instructions: String,
        /// Option key to compressed rubric.
        criteria: IndexMap<String, String>,
    },
    /// Place the state on a scale.
    Score {
        /// Prompt.
        instructions: String,
        /// Scale labels, low to high.
        criteria: Vec<String>,
    },
    /// Judge a proposition.
    Noul {
        /// Prompt.
        instructions: String,
    },
}

/// One `/predict` call: a state and the questions asked over exactly that state.
#[derive(Debug, Clone, Serialize)]
pub struct PredictRequest {
    /// Rendered state text for this call.
    pub state: String,
    /// Questions keyed by the name the engine echoes back.
    pub questions: IndexMap<String, EngineQuestion>,
    /// Truncate the state from the left, keeping its tail (§10.5).
    pub truncate_left: bool,
}

/// An answer exactly as laya produced it, before re-expansion.
///
/// Permissive by construction: the façade must never reject an answer because
/// the engine added a field, and `action` in particular is laya's own metadata
/// which contract §10.7 requires us to carry through untouched.
#[derive(Debug, Clone, Deserialize)]
pub struct EngineAnswer {
    /// `choice` / `score` / `noul`, when the engine states it.
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    /// Winning option, for a choice.
    #[serde(default)]
    pub choice: Option<String>,
    /// Probability per option, for a choice.
    #[serde(default)]
    pub probabilities: Option<IndexMap<String, f64>>,
    /// Absolute, un-normalised per-option scores, when the engine computes
    /// them independently rather than as shares of one distribution.
    ///
    /// Optional by design: an engine that scores options independently may
    /// report these directly, and where it does not, the façade reconstructs
    /// them from `confidence` and `probabilities` (see
    /// [`EngineAnswer::absolute_scores`]). Either way the numbers a decline
    /// threshold is compared against are the engine's, never invented.
    #[serde(default, alias = "raw_scores", alias = "entailment")]
    pub scores: Option<IndexMap<String, f64>>,
    /// Confidence, where the engine reports one.
    #[serde(default)]
    pub confidence: Option<f64>,
    /// Expected scale position, for a score.
    #[serde(default)]
    pub score: Option<f64>,
    /// Mass per scale label, for a score.
    #[serde(default)]
    pub distribution: Option<Vec<f64>>,
    /// Probability, for a noul.
    #[serde(default)]
    pub noul: Option<f64>,
    /// Laya's own act metadata; preserved verbatim into the answer.
    ///
    /// Typed as core's [`ChoiceAction`] rather than a free `Value` so that it
    /// travels into [`system_one_core::Answer::Choice`] without a conversion
    /// that could quietly drop it.
    #[serde(default)]
    pub action: Option<ChoiceAction>,
}

impl EngineAnswer {
    /// The absolute, un-normalised score per option, for a decline threshold.
    ///
    /// Two shapes are accepted, and neither is invented:
    ///
    /// * the engine reported `scores` directly — used as sent;
    /// * the engine reported only `probabilities` and a `confidence` — the
    ///   distribution is rescaled so the winner's value equals `confidence`.
    ///   For a judge whose probabilities are its entailment scores normalised
    ///   across options, that recovers the original scores exactly, because
    ///   normalisation preserves ratios and `confidence` restores the scale.
    ///
    /// Returns `None` when neither shape is available, which is a fact the
    /// caller must report rather than paper over: without an absolute scale
    /// there is nothing a fixed threshold could honestly be compared against.
    ///
    /// ```
    /// use system_one_facade::engine::EngineAnswer;
    ///
    /// let answer: EngineAnswer = serde_json::from_str(
    ///     r#"{"type":"choice","choice":"a","confidence":0.82,
    ///         "probabilities":{"a":0.6,"b":0.4}}"#,
    /// )
    /// .unwrap();
    /// let scores = answer.absolute_scores().unwrap();
    /// assert!((scores["a"] - 0.82).abs() < 1e-9);
    /// assert!((scores["b"] - 0.82 * 0.4 / 0.6).abs() < 1e-9);
    /// ```
    pub fn absolute_scores(&self) -> Option<IndexMap<String, f64>> {
        if let Some(scores) = &self.scores {
            if !scores.is_empty() {
                return Some(scores.clone());
            }
        }
        let probabilities = self.probabilities.as_ref()?;
        let confidence = self.confidence.filter(|c| c.is_finite())?;
        let top = probabilities
            .values()
            .copied()
            .filter(|p| p.is_finite())
            .fold(f64::NEG_INFINITY, f64::max);
        if !top.is_finite() || top <= 0.0 {
            return None;
        }
        let scale = confidence / top;
        Some(
            probabilities
                .iter()
                .map(|(key, value)| (key.clone(), value * scale))
                .collect(),
        )
    }
}

/// The engine's reply to one `/predict` call.
#[derive(Debug, Clone, Deserialize)]
pub struct PredictResponse {
    /// One answer per question asked.
    pub answers: IndexMap<String, EngineAnswer>,
    /// What the engine consumed.
    #[serde(default)]
    pub usage: EngineUsage,
    /// Engine-side wall time, when reported.
    #[serde(default)]
    pub ms: Option<u64>,
}

/// Engine-side token accounting.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
pub struct EngineUsage {
    /// Tokens the engine actually read.
    #[serde(default)]
    pub input_tokens: u64,
    /// Always zero for an encoder judge.
    #[serde(default)]
    pub output_tokens: u64,
}

/// Engine health, as `/health` surfaces it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineHealth {
    /// Engine's own status word.
    #[serde(default)]
    pub status: Option<String>,
    /// Device the model is on.
    #[serde(default)]
    pub device: Option<String>,
    /// Whether the engine fell back to CPU after a CUDA OOM (§10.8).
    #[serde(default)]
    pub cpu_fallback: Option<bool>,
    /// Loaded model id.
    #[serde(default)]
    pub model: Option<String>,
}

/// HTTP client for the loopback engine, with TTL-cached capabilities.
#[derive(Debug)]
pub struct Engine {
    http: reqwest::Client,
    base: String,
    ttl: Duration,
    fallback: EngineCapabilities,
    cached: RwLock<Option<(EngineCapabilities, Instant)>>,
}

impl Engine {
    /// Build an engine client from resolved configuration.
    pub fn new(cfg: &Config) -> Self {
        let http = reqwest::Client::builder()
            .timeout(cfg.engine_timeout)
            .build()
            .expect("reqwest client builds with the pinned feature set");
        Self {
            http,
            base: cfg.engine_url.trim_end_matches('/').to_string(),
            ttl: cfg.budget_ttl,
            fallback: fallback_capabilities(cfg),
            cached: RwLock::new(None),
        }
    }

    /// The engine base URL.
    pub fn base_url(&self) -> &str {
        &self.base
    }

    /// What the engine declares it can do, from cache when fresh.
    ///
    /// A failed lookup is fatal to the request. Guessing a budget is how an
    /// option set silently collapses to four tokens each; guessing a
    /// *capability* is worse, because it decides whether any adaptation runs
    /// at all.
    pub async fn capabilities(&self) -> Result<EngineCapabilities> {
        if let Ok(guard) = self.cached.read() {
            if let Some((caps, at)) = *guard {
                if at.elapsed() < self.ttl {
                    return Ok(caps);
                }
            }
        }
        let caps = self.fetch_capabilities().await?;
        if let Ok(mut guard) = self.cached.write() {
            *guard = Some((caps, Instant::now()));
        }
        Ok(caps)
    }

    async fn fetch_capabilities(&self) -> Result<EngineCapabilities> {
        let url = format!("{}/v1/models", self.base);
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| map_transport(&url, e))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(FacadeError::EngineError(format!(
                "engine /v1/models returned {status}: {}",
                clip(&body)
            )));
        }
        let payload: ModelsPayload = serde_json::from_str(&body).map_err(|e| {
            FacadeError::EngineError(format!("engine /v1/models was not usable JSON: {e}"))
        })?;
        let entry = payload.data.first();
        let declared = payload
            .declared
            .or(entry.map(|e| e.declared).unwrap_or_default());
        let capabilities = declared.resolve(&self.fallback);
        capabilities
            .check()
            .map_err(|e| FacadeError::EngineError(e.to_string()))?;
        tracing::debug!(
            model = entry.and_then(|e| e.id.as_deref()).unwrap_or("unknown"),
            max_len = capabilities.max_len,
            head_max_len = ?capabilities.head_max_len,
            option_max_len = ?capabilities.option_max_len,
            scores_options_independently = capabilities.scores_options_independently,
            declared = !declared.is_silent(),
            "engine capabilities refreshed"
        );
        Ok(capabilities)
    }

    /// Ask the engine. Duration is the caller's measured engine time.
    pub async fn predict(&self, request: &PredictRequest) -> Result<(PredictResponse, Duration)> {
        let url = format!("{}/predict", self.base);
        let started = Instant::now();
        let res = self
            .http
            .post(&url)
            .json(request)
            .send()
            .await
            .map_err(|e| map_transport(&url, e))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        let elapsed = started.elapsed();
        if !status.is_success() {
            return Err(map_engine_failure(status.as_u16(), &body));
        }
        let parsed: PredictResponse = serde_json::from_str(&body).map_err(|e| {
            FacadeError::EngineError(format!("engine /predict was not usable JSON: {e}"))
        })?;
        Ok((parsed, elapsed))
    }

    /// The engine's `/health`, for the façade's own health surface.
    pub async fn health(&self) -> Result<EngineHealth> {
        let url = format!("{}/health", self.base);
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| map_transport(&url, e))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(FacadeError::EngineError(format!(
                "engine /health returned {status}: {}",
                clip(&body)
            )));
        }
        serde_json::from_str(&body).map_err(|e| {
            FacadeError::EngineError(format!("engine /health was not usable JSON: {e}"))
        })
    }
}

fn clip(body: &str) -> String {
    body.chars().take(200).collect()
}

fn map_transport(url: &str, err: reqwest::Error) -> FacadeError {
    if err.is_timeout() {
        FacadeError::EngineTimeout(format!("engine call to {url} timed out"))
    } else {
        FacadeError::EngineUnavailable(format!("engine call to {url} failed: {err}"))
    }
}

/// Map an engine error body onto a façade error code.
///
/// The one mapping that matters is contract §10.3: laya raises
/// `ValueError("question %r options exceed head_max_len=%d")` when its option
/// markers are lost, and that must surface as `options_unfittable` — a
/// statement that the question could not be asked — never as a guess.
///
/// ```
/// use system_one_facade::engine::map_engine_failure;
/// let e = map_engine_failure(500, "ValueError: question 'skill' options exceed head_max_len=192");
/// assert_eq!(e.code(), "options_unfittable");
/// let other = map_engine_failure(500, "CUDA out of memory");
/// assert_eq!(other.code(), "engine_error");
/// ```
pub fn map_engine_failure(status: u16, body: &str) -> FacadeError {
    let lower = body.to_lowercase();
    if lower.contains("exceed head_max_len") || lower.contains("options exceed") {
        return FacadeError::OptionsUnfittable(format!(
            "the engine refused the question: options exceed its head budget ({})",
            clip(body)
        ));
    }
    if status == 503 {
        return FacadeError::EngineUnavailable(format!(
            "engine reports unavailable: {}",
            clip(body)
        ));
    }
    if status == 504 {
        return FacadeError::EngineTimeout(format!("engine reports timeout: {}", clip(body)));
    }
    FacadeError::EngineError(format!("engine returned {status}: {}", clip(body)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_parse_from_both_payload_shapes() {
        let flat: ModelsPayload =
            serde_json::from_str(r#"{"max_len":1024,"head_max_len":512,"option_max_len":48}"#)
                .unwrap();
        assert_eq!(flat.declared.max_len, Some(Some(1024)));
        let nested: ModelsPayload =
            serde_json::from_str(r#"{"data":[{"id":"laya","max_len":512,"head_max_len":192}]}"#)
                .unwrap();
        assert_eq!(nested.data[0].declared.head_max_len, Some(Some(192)));
        assert_eq!(nested.declared.max_len, None);
    }

    #[test]
    fn an_undeclared_engine_gets_the_conservative_shape() {
        let silent: ModelsPayload = serde_json::from_str(r#"{"data":[{"id":"mystery"}]}"#).unwrap();
        let caps = silent
            .declared
            .or(silent.data.first().map(|e| e.declared).unwrap_or_default())
            .resolve(&fallback_capabilities(&Config::default()));
        assert_eq!(caps, EngineCapabilities::conservative());
        assert!(caps.is_head_bounded(), "silence is not a licence");
    }

    #[test]
    fn a_declared_unconstrained_engine_is_taken_at_its_word() {
        let payload: ModelsPayload = serde_json::from_str(
            r#"{"data":[{"id":"openjev","max_len":4096,"head_max_len":null,
                "option_max_len":null,"scores_options_independently":true}]}"#,
        )
        .unwrap();
        let caps = payload
            .declared
            .or(payload.data.first().map(|e| e.declared).unwrap_or_default())
            .resolve(&fallback_capabilities(&Config::default()));
        assert_eq!(caps.max_len, 4096);
        assert!(!caps.is_head_bounded());
        assert!(!caps.caps_options());
        assert!(caps.scores_options_independently);
    }

    #[test]
    fn absolute_scores_prefer_the_engines_own_numbers() {
        let with_scores: EngineAnswer = serde_json::from_str(
            r#"{"type":"choice","choice":"a","confidence":0.9,
                "probabilities":{"a":0.9,"b":0.1},"scores":{"a":0.44,"b":0.05}}"#,
        )
        .unwrap();
        let scores = with_scores.absolute_scores().unwrap();
        assert_eq!(scores["a"], 0.44);

        // An engine reporting no absolute scale at all yields nothing, rather
        // than a number a threshold could be compared against by accident.
        let bare: EngineAnswer =
            serde_json::from_str(r#"{"type":"choice","choice":"a","probabilities":{"a":1.0}}"#)
                .unwrap();
        assert!(bare.absolute_scores().is_none());
    }

    #[test]
    fn value_error_becomes_options_unfittable() {
        let e = map_engine_failure(
            500,
            "ValueError: question 'skill' options exceed head_max_len=192",
        );
        assert_eq!(e.code(), "options_unfittable");
    }

    #[test]
    fn action_metadata_round_trips() {
        let a: EngineAnswer = serde_json::from_str(
            r#"{"type":"choice","choice":"a","probabilities":{"a":0.9,"b":0.1},
                "confidence":0.9,"action":{"act_probability":0.4}}"#,
        )
        .unwrap();
        assert_eq!(a.action.unwrap().act_probability, 0.4);
    }
}
