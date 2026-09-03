//! Layer B: the optional rewrite hook for statistical (token-sampling)
//! watermarks.
//!
//! No parser can see a token-sampling mark, so the only lever is to re-say the
//! text. Backends: `print-prompt` (default, CI-safe, no model), `ollama`, and
//! any OpenAI-compatible endpoint.
//!
//! Security posture, carried over verbatim:
//! - only http(s) endpoints are accepted, and redirects are refused outright so
//!   an Authorization header can never be re-sent to an unvalidated host;
//! - non-loopback endpoints are denied unless explicitly opted into, because
//!   the text leaves the machine;
//! - the API key is read from the environment only, never from argv, where it
//!   would be visible in `ps` and shell history.

pub mod backends;
pub mod markllm;
pub mod prompts;

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::common::surrogate::{self, Unit};
use crate::common::CliError;
use crate::text::{clean_text, CleanOptions};

pub use backends::{call_ollama, call_openai_compatible};
pub use markllm::{markllm_detect, MarkllmOptions, DEFAULT_MARKLLM_MODEL};

const LOOPBACK_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1"];

/// Tokenise for the lexical-divergence score.
fn tokens(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9]+").expect("static regex compiles"))
        .find_iter(&text.to_lowercase())
        .map(|found| found.as_str().to_string())
        .collect()
}

fn bigrams(tokens: &[String]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = tokens
        .windows(2)
        .map(|pair| (pair[0].clone(), pair[1].clone()))
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Bigram Jaccard distance: 0.0 identical, 1.0 fully different.
pub fn lexical_divergence(original: &str, candidate: &str) -> f64 {
    let a = tokens(original);
    let b = tokens(candidate);
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    if a.is_empty() || b.is_empty() {
        return 1.0;
    }
    let ba = bigrams(&a);
    let bb = bigrams(&b);
    let intersection = ba.iter().filter(|item| bb.contains(item)).count();
    let union = ba.len() + bb.len() - intersection;
    if union == 0 {
        return 0.0;
    }
    1.0 - intersection as f64 / union as f64
}

/// Pick the most lexically diverged rewrite, penalising extreme length drift.
pub fn select_candidate(original: &str, candidates: &[String]) -> (String, Vec<f64>) {
    let scores: Vec<f64> = candidates
        .iter()
        .map(|candidate| {
            let mut score = lexical_divergence(original, candidate);
            if !original.is_empty() {
                let ratio = candidate.chars().count() as f64 / original.chars().count() as f64;
                if !(0.5..=2.0).contains(&ratio) {
                    score -= 0.15;
                }
            }
            score
        })
        .collect();
    // Python's `max(range, key=...)` keeps the first index on a tie.
    let best =
        scores.iter().enumerate().fold(
            0usize,
            |best, (index, score)| {
                if *score > scores[best] {
                    index
                } else {
                    best
                }
            },
        );
    (candidates[best].clone(), scores)
}

/// Enforce the rewrite-endpoint allowlist.
///
/// Default-deny: only loopback endpoints are accepted. Anything else needs an
/// explicit opt-in, and non-http(s) schemes are always refused.
pub fn check_remote(base_url: &str, allow_remote: bool) -> Result<Option<String>, CliError> {
    let parsed = crate::audit::website::net::parse_url(base_url).map_err(|_| {
        CliError::new(
            1,
            format!("error: rewrite base URL must be http(s): {base_url}"),
        )
    })?;
    if parsed.scheme != "http" && parsed.scheme != "https" {
        return Err(CliError::new(
            1,
            format!(
                "error: rewrite base URL must be http(s), got scheme '{}': {base_url}",
                parsed.scheme
            ),
        ));
    }
    if LOOPBACK_HOSTS.contains(&parsed.host.as_str()) {
        return Ok(None);
    }
    if !allow_remote {
        return Err(CliError::new(
            1,
            format!(
                "error: rewrite base URL host is not loopback ('{}'); refusing to send content \
                 off-machine. Set WATERMARKS_REWRITE_ALLOW_REMOTE=1 or pass --allow-remote to \
                 override.",
                parsed.host
            ),
        ));
    }
    Ok(Some(format!(
        "warning: rewrite base URL host is '{}' (not localhost); content will leave this machine",
        parsed.host
    )))
}

/// Build the prompt for a strength.
pub fn build_prompt(
    strength: &str,
    text: &str,
    lang: &str,
    original_lang: &str,
    context: Option<&str>,
) -> Result<String, CliError> {
    // Markdown-shaped input gets the structure-preserving simplify prompt.
    let key = if strength == "simplify" {
        let head = text.trim_start();
        if head.starts_with('#') || head.starts_with("---") {
            "simplify_md"
        } else {
            "simplify"
        }
    } else {
        strength
    };

    let mut prompt = if let Some(template) = prompts::lookup(key) {
        template.replace("{TEXT}", text)
    } else if strength == "backtranslate" {
        format!(
            "Translate the text to {lang}, then translate that result back to {original_lang}. \
             Preserve all facts, numbers, and names. Output only the final {original_lang} text.\
             \n\n---\n{text}"
        )
    } else if strength == "structural" {
        format!(
            "First extract a bullet outline of all claims (no full sentences). Then write a \
             complete document from that outline in natural, varied human prose without omitting \
             any bullet. Output only the final document.\n\n---\n{text}"
        )
    } else {
        return Err(CliError::new(1, format!("unknown strength: {strength}")));
    };

    if let Some(context) = context.filter(|value| !value.is_empty()) {
        let clipped: String = context.chars().take(800).collect();
        prompt.push_str(&prompts::CONTEXT_SUFFIX.replace("{CONTEXT}", &clipped));
    }
    Ok(prompt)
}

/// Which backend performs the rewrite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    PrintPrompt,
    Ollama,
    OpenAiCompatible,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::PrintPrompt => "print-prompt",
            Backend::Ollama => "ollama",
            Backend::OpenAiCompatible => "openai-compatible",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "print-prompt" => Some(Backend::PrintPrompt),
            "ollama" => Some(Backend::Ollama),
            "openai-compatible" => Some(Backend::OpenAiCompatible),
            _ => None,
        }
    }
}

/// Everything a rewrite run needs.
#[derive(Debug, Clone)]
pub struct RewriteOptions {
    pub backend: Backend,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub strength: String,
    pub lang: String,
    pub original_lang: String,
    pub timeout: f64,
    pub layer_a_after: bool,
    pub temperature: f64,
    pub candidates: u32,
    pub allow_remote: bool,
    pub reasoning_effort: Option<String>,
    pub markllm: Option<MarkllmOptions>,
    pub context: Option<String>,
    pub min_chars: usize,
}

impl Default for RewriteOptions {
    fn default() -> Self {
        Self {
            backend: Backend::PrintPrompt,
            model: None,
            base_url: None,
            api_key: None,
            strength: "paraphrase".to_string(),
            lang: "French".to_string(),
            original_lang: "English".to_string(),
            timeout: 120.0,
            layer_a_after: true,
            temperature: 0.9,
            candidates: 1,
            allow_remote: false,
            reasoning_effort: None,
            markllm: None,
            context: None,
            min_chars: 0,
        }
    }
}

/// Strip fenced code blocks, to measure prose length alone.
fn prose_length(text: &str) -> usize {
    static RE: OnceLock<Regex> = OnceLock::new();
    let without_code = RE
        .get_or_init(|| Regex::new(r"(?s)```.*?```").expect("static regex compiles"))
        .replace_all(text, "");
    without_code.trim().chars().count()
}

/// Run a Layer B rewrite. Returns the result text and an info block.
///
/// `warn` receives any advisory the run wants to surface on stderr.
pub fn rewrite(
    text: &str,
    options: &RewriteOptions,
    warn: &mut dyn FnMut(&str),
) -> Result<(String, Value), CliError> {
    let mut info = Map::new();

    let prose = prose_length(text);
    if options.min_chars > 0 && prose < options.min_chars {
        info.insert("backend".into(), json!(options.backend.as_str()));
        info.insert("strength".into(), json!(options.strength));
        info.insert("mode".into(), json!("skipped"));
        info.insert(
            "reason".into(),
            json!(format!(
                "prose length {prose} < min_chars {}",
                options.min_chars
            )),
        );
        info.insert("input_chars".into(), json!(text.chars().count()));
        info.insert("output_chars".into(), json!(text.chars().count()));
        return Ok((text.to_string(), Value::Object(info)));
    }

    let prompt = build_prompt(
        &options.strength,
        text,
        &options.lang,
        &options.original_lang,
        options.context.as_deref(),
    )?;

    info.insert("backend".into(), json!(options.backend.as_str()));
    info.insert("strength".into(), json!(options.strength));
    info.insert("model".into(), json!(options.model));
    info.insert("base_url".into(), json!(options.base_url));
    info.insert("temperature".into(), json!(options.temperature));
    info.insert("prompt_chars".into(), json!(prompt.chars().count()));
    info.insert("input_chars".into(), json!(text.chars().count()));
    if let Some(effort) = &options.reasoning_effort {
        info.insert("reasoning_effort".into(), json!(effort));
    }

    // MarkLLM verification is best-effort and never fails the rewrite.
    let mut markllm_block: Option<Map<String, Value>> = None;
    if let Some(markllm) = &options.markllm {
        let before = markllm_detect(text, markllm);
        if !before
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let error = before
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            warn(&format!("markllm verification unavailable: {error}"));
        }
        let mut block = Map::new();
        block.insert("scheme".into(), json!(markllm.scheme));
        block.insert("before".into(), before);
        info.insert("markllm".into(), Value::Object(block.clone()));
        markllm_block = Some(block);
    }

    if options.backend == Backend::PrintPrompt {
        info.insert("mode".into(), json!("print-prompt"));
        if options.candidates > 1 {
            warn("note: --candidates ignored in print-prompt mode");
        }
        return Ok((prompt, Value::Object(info)));
    }

    let model = options
        .model
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CliError::new(
                1,
                "error: --model required for ollama/openai-compatible backends",
            )
        })?;
    let base_url = options
        .base_url
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CliError::new(
                1,
                "error: --base-url required for ollama/openai-compatible backends",
            )
        })?;

    if let Some(warning) = check_remote(base_url, options.allow_remote)? {
        warn(&warning);
    }

    let count = options.candidates.max(1);
    let mut outputs: Vec<String> = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let produced = match options.backend {
            Backend::Ollama => call_ollama(
                base_url,
                model,
                &prompt,
                options.timeout,
                options.temperature,
            ),
            Backend::OpenAiCompatible => call_openai_compatible(
                base_url,
                model,
                &prompt,
                options.api_key.as_deref(),
                options.timeout,
                options.temperature,
                options.reasoning_effort.as_deref(),
            ),
            Backend::PrintPrompt => unreachable!("handled above"),
        }
        .map_err(|error| CliError::new(1, format!("rewrite failed: {error}")))?;
        outputs.push(produced);
    }

    let mut out = if outputs.len() == 1 {
        outputs.remove(0)
    } else {
        info.insert("candidates".into(), json!(count));
        let (best, scores) = select_candidate(text, &outputs);
        info.insert("candidate_scores".into(), json!(scores));
        best
    };

    if options.layer_a_after {
        let units: Vec<Unit> = surrogate::decode(out.as_bytes());
        let (cleaned, stats) = clean_text(&units, CleanOptions::default());
        out = String::from_utf8_lossy(&surrogate::encode(&cleaned)).into_owned();
        info.insert("layer_a_after".into(), stats.to_json());
    }

    info.insert("output_chars".into(), json!(out.chars().count()));
    info.insert("mode".into(), json!("rewritten"));
    info.insert(
        "note".into(),
        json!(
            "Layer B is best-effort against statistical token-sampling watermarks; cannot certify \
             removal against a vendor detector."
        ),
    );

    if let (Some(mut block), Some(markllm)) = (markllm_block.take(), options.markllm.as_ref()) {
        let after = markllm_detect(&out, markllm);
        let before_available = block
            .get("before")
            .and_then(|value| value.get("available"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let before_watermarked = block
            .get("before")
            .and_then(|value| value.get("is_watermarked"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let after_available = after
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let after_watermarked = after
            .get("is_watermarked")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        block.insert("after".into(), after);
        if before_available && after_available {
            block.insert(
                "cleared".into(),
                json!(before_watermarked && !after_watermarked),
            );
        }
        block.insert(
            "note".into(),
            json!(
                "MarkLLM detection is only valid against the SAME scheme config + keys used at \
                 generation; it does not certify a vendor detector."
            ),
        );
        info.insert("markllm".into(), Value::Object(block));
    }

    Ok((out, Value::Object(info)))
}

#[cfg(test)]
mod tests;
