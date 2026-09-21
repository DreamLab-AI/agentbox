//! One routing call against one backend.
//!
//! The HTTP itself — endpoint resolution, bearer auth, timeouts, bounded
//! retries on 429/529, error typing — is
//! [`system_one_client`]'s, and the request and response types are
//! [`system_one_core`]'s. What is here is the rig's own part: building the
//! request `config/hooks/lib/skill-route.cjs` builds, byte for byte (same
//! instructions, same `none` rubric, same 9000/3000 prompt clamp, same question
//! name), and turning a client error into a reason string a report can count.
//! A measurement rig that sent anything else would be measuring a backend
//! nobody calls.

use std::time::Duration;
use std::time::Instant;

use indexmap::IndexMap;
use system_one_client::{ClientError, SystemOneClient};
use system_one_core::wire::{Question, Request, Sso};

/// The option that lets a judge say "no skill applies".
pub const NONE: &str = "none";

/// Verbatim from `skill-route.cjs`.
pub const NONE_RUBRIC: &str = "No skill applies: a conversational reply, a follow-up on work \
already in progress in this session, a yes/no or clarification, a trivial edit, or a request any \
general-purpose coding assistant handles without specialised guidance.";

/// Verbatim from `skill-route.cjs`.
pub const INSTRUCTIONS: &str = "Which skill should handle `user_request`? Choose the single best \
fit, honouring each option's stated when-NOT-to-use boundaries. Choose `none` only when no listed \
skill would change how a capable assistant approaches the request.";

/// Prompt clamp, verbatim from `skill-route.cjs`.
const PROMPT_HEAD_CHARS: usize = 9000;
/// Prompt clamp, verbatim from `skill-route.cjs`.
const PROMPT_TAIL_CHARS: usize = 3000;

/// The question name both consumers use, and the rig must use too.
const QUESTION: &str = "skill";

/// Keep a pasted-document turn inside the judge's budget.
pub fn clamp_prompt(prompt: &str) -> String {
    let chars: Vec<char> = prompt.chars().collect();
    if chars.len() <= PROMPT_HEAD_CHARS + PROMPT_TAIL_CHARS {
        return prompt.to_string();
    }
    let elided = chars.len() - PROMPT_HEAD_CHARS - PROMPT_TAIL_CHARS;
    let head: String = chars[..PROMPT_HEAD_CHARS].iter().collect();
    let tail: String = chars[chars.len() - PROMPT_TAIL_CHARS..].iter().collect();
    format!("{head}\n[… {elided} chars elided …]\n{tail}")
}

/// How to reach one backend.
#[derive(Debug, Clone)]
pub struct Backend {
    /// Human label used in reports.
    pub label: String,
    /// Base URL or full `/v1/systemone` URL; the client resolves either.
    pub url: String,
    /// Model name sent in the body.
    pub model: String,
    /// Bearer token, when the backend wants one.
    pub key: Option<String>,
    /// Per-call timeout.
    pub timeout: Duration,
    /// Retries on 429/529.
    pub retries: u32,
    /// Input cost, US dollars per million tokens.
    pub usd_per_mtok_in: f64,
    /// Decline threshold to send per request, when sweeping it.
    ///
    /// `None` leaves the backend's own default in force, which is what a
    /// baseline run should do — the sweep is an experiment, not the norm.
    pub none_threshold: Option<f64>,
    /// Options to offer per request, when sweeping the latency lever.
    pub shortlist_k: Option<usize>,
}

impl Backend {
    /// The per-request levers this backend run is measuring, if any.
    pub fn request_options(&self) -> Option<system_one_core::wire::RequestOptions> {
        if self.none_threshold.is_none() && self.shortlist_k.is_none() {
            return None;
        }
        Some(system_one_core::wire::RequestOptions {
            none_threshold: self.none_threshold,
            shortlist_k: self.shortlist_k,
        })
    }
}

impl Backend {
    /// Build the HTTP client for this backend.
    ///
    /// Local validation is left **on**: a malformed request should fail here,
    /// loudly, rather than being counted as a backend's wrong answer.
    pub fn client(&self) -> Result<SystemOneClient, String> {
        SystemOneClient::builder(&self.url)
            .bearer_token(self.key.clone())
            .timeout(self.timeout)
            .max_retries(self.retries)
            .user_agent("system-one-eval")
            .build()
            .map_err(|e| format!("backend `{}` is unusable: {e}", self.label))
    }
}

/// What one case produced on one backend.
#[derive(Debug, Clone)]
pub enum Outcome {
    /// The backend answered.
    Routed(Box<Routed>),
    /// The backend did not answer, and why.
    Failed {
        /// Machine-readable reason.
        reason: String,
        /// Wall time before giving up.
        ms: u64,
    },
}

/// A successful route.
#[derive(Debug, Clone)]
pub struct Routed {
    /// The top pick.
    pub choice: String,
    /// Every option the backend reported, best first.
    pub ranked: Vec<(String, f64)>,
    /// Probability of the top pick.
    pub confidence: f64,
    /// Wall time for the call.
    pub ms: u64,
    /// Tokens the backend says it consumed.
    pub input_tokens: u64,
    /// Model the backend says answered.
    pub model: String,
    /// The honesty block, when the backend is the sovereign façade.
    pub sso: Option<Sso>,
}

impl Routed {
    /// Whether the label is in the top `n` ranked options.
    pub fn within(&self, label: &str, n: usize) -> bool {
        self.ranked.iter().take(n).any(|(key, _)| key == label)
    }

    /// Cost of this call under the backend's price.
    pub fn usd(&self, usd_per_mtok_in: f64) -> f64 {
        self.input_tokens as f64 * usd_per_mtok_in / 1e6
    }
}

/// The request `skill-route.cjs` sends, for one prompt.
pub fn build_request(
    backend: &Backend,
    candidates: &IndexMap<String, String>,
    prompt: &str,
) -> Request {
    let mut criteria = candidates.clone();
    criteria.insert(NONE.to_string(), NONE_RUBRIC.to_string());
    let mut request = Request::new(
        backend.model.clone(),
        system_one_core::wire::State::Fields(
            [(
                "user_request".to_string(),
                serde_json::Value::String(clamp_prompt(prompt)),
            )]
            .into_iter()
            .collect(),
        ),
    )
    .with_question(QUESTION, Question::choice(INSTRUCTIONS, criteria));
    request.sso = backend.request_options();
    request
}

/// Turn a client error into the short reason a report counts by.
///
/// A backend's own `{"error":{"code"}}` wins where there is one, so a run
/// against the façade reports `options_unfittable` rather than `http-422`.
fn reason_for(error: &ClientError) -> String {
    if let Some(code) = error.code() {
        return code.to_string();
    }
    match error {
        ClientError::Timeout { .. } => "timeout".to_string(),
        ClientError::Transport { .. } => "network".to_string(),
        ClientError::Status { status, .. } => format!("http-{status}"),
        ClientError::MalformedBody { .. } => "bad-shape".to_string(),
        ClientError::InvalidRequest { .. } => "invalid-request".to_string(),
        ClientError::InvalidBaseUrl { .. } => "bad-url".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Ask one backend to route one prompt.
pub async fn route(
    client: &SystemOneClient,
    backend: &Backend,
    candidates: &IndexMap<String, String>,
    prompt: &str,
) -> Outcome {
    let request = build_request(backend, candidates, prompt);
    let started = Instant::now();
    let response = match client.predict(&request).await {
        Ok(response) => response,
        Err(error) => {
            return Outcome::Failed {
                reason: reason_for(&error),
                ms: started.elapsed().as_millis() as u64,
            }
        }
    };
    let ms = started.elapsed().as_millis() as u64;

    let Some(answer) = response.answers.get(QUESTION) else {
        return Outcome::Failed {
            reason: "bad-shape".into(),
            ms,
        };
    };
    let Some((choice, probabilities)) = answer.as_choice() else {
        return Outcome::Failed {
            reason: "bad-shape".into(),
            ms,
        };
    };
    let mut ranked: Vec<(String, f64)> = probabilities
        .iter()
        .map(|(key, value)| (key.clone(), *value))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    Outcome::Routed(Box::new(Routed {
        confidence: probabilities.get(choice).copied().unwrap_or(0.0),
        choice: choice.to_string(),
        ranked,
        ms,
        input_tokens: response.usage.input_tokens,
        model: if response.model.is_empty() {
            backend.model.clone()
        } else {
            response.model.clone()
        },
        sso: response.sso,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> Backend {
        Backend {
            label: "t".into(),
            url: "http://systemone:8097".into(),
            model: "laya-typed-decisions".into(),
            key: None,
            timeout: Duration::from_secs(5),
            retries: 0,
            usd_per_mtok_in: 0.0,
            none_threshold: None,
            shortlist_k: None,
        }
    }

    #[test]
    fn short_prompts_are_not_clamped() {
        assert_eq!(clamp_prompt("a short turn"), "a short turn");
    }

    #[test]
    fn long_prompts_keep_head_and_tail() {
        let prompt = "x".repeat(20_000);
        let clamped = clamp_prompt(&prompt);
        assert!(clamped.contains("chars elided"));
        assert!(clamped.len() < prompt.len());
        assert!(clamped.starts_with("xxxx"));
        assert!(clamped.ends_with("xxxx"));
    }

    #[test]
    fn the_request_is_the_routers_request() {
        let candidates: IndexMap<String, String> =
            [("rust-engineer".to_string(), "ports python".to_string())]
                .into_iter()
                .collect();
        let request = build_request(&backend(), &candidates, "please port this");
        // It is a valid System One request by the standard's own judgement.
        system_one_core::validate::validate(&request).unwrap();
        let Question::Choice {
            instructions,
            criteria,
        } = &request.questions["skill"]
        else {
            panic!("the router asks a choice");
        };
        assert_eq!(instructions, INSTRUCTIONS);
        assert_eq!(criteria["none"], NONE_RUBRIC);
        assert_eq!(criteria.len(), 2, "candidates plus none");
        assert_eq!(request.state.render(), "user_request: please port this");
        assert!(
            request.sso.is_none(),
            "a baseline run sends no levers at all"
        );
    }

    #[test]
    fn a_swept_run_carries_its_threshold_on_every_request() {
        let mut backend = backend();
        backend.none_threshold = Some(0.35);
        let candidates: IndexMap<String, String> =
            [("rust-engineer".to_string(), "ports python".to_string())]
                .into_iter()
                .collect();
        let request = build_request(&backend, &candidates, "please port this");
        assert_eq!(request.sso.unwrap().none_threshold, Some(0.35));
        // And the question itself is untouched: the sweep changes one number,
        // not the corpus.
        system_one_core::validate::validate(&request).unwrap();
    }

    #[test]
    fn ranking_helpers_respect_top_n() {
        let routed = Routed {
            choice: "a".into(),
            ranked: vec![("a".into(), 0.5), ("b".into(), 0.3), ("c".into(), 0.2)],
            confidence: 0.5,
            ms: 10,
            input_tokens: 1_000_000,
            model: "m".into(),
            sso: None,
        };
        assert!(routed.within("c", 3));
        assert!(!routed.within("c", 2));
        assert!((routed.usd(0.042) - 0.042).abs() < 1e-12);
    }
}
