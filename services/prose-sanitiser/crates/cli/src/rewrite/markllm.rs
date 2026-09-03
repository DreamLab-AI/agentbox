//! The MarkLLM harness boundary.
//!
//! MarkLLM is the fourth torch harness and stays in Python: it loads a causal
//! LM to score a scheme's statistical watermark. This module only locates the
//! checkout, runs the adapter with its original invocation, and parses the
//! JSON back. Verification never fails the rewrite.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::common::proc::{run_capture, Rlimits};
use crate::common::{env_nonempty, env_usize, which};
use crate::image::harness::scripts_dir;

pub const DEFAULT_MARKLLM_MODEL: &str = "facebook/opt-1.3b";

/// How to run the MarkLLM adapter.
#[derive(Debug, Clone)]
pub struct MarkllmOptions {
    /// kgw | synthid | synthid-text
    pub scheme: String,
    pub upstream_dir: Option<String>,
    pub model: String,
    pub timeout: f64,
}

impl Default for MarkllmOptions {
    fn default() -> Self {
        Self {
            scheme: String::new(),
            upstream_dir: None,
            model: DEFAULT_MARKLLM_MODEL.to_string(),
            timeout: 180.0,
        }
    }
}

/// Locate the checkout's venv interpreter, if it exists.
fn venv_python(upstream: &Path) -> Option<PathBuf> {
    let candidate = upstream.join(".venv").join("bin").join("python");
    candidate.is_file().then_some(candidate)
}

/// torch/CUDA usually needs a large address space, so unlike the
/// exiftool/c2patool/SynthID children the MarkLLM cap is opt-in.
fn markllm_limits() -> Rlimits {
    match env_nonempty("WATERMARKS_MARKLLM_RLIMIT_AS").and_then(|raw| parse_int_any_base(&raw)) {
        Some(limit) => Rlimits {
            address_space: limit,
            file_size: Rlimits::torch_child().file_size,
        },
        // No cap requested: fall back to the generous torch caps rather than
        // the tight parser ones, which would abort a model load outright.
        None => Rlimits {
            address_space: u64::MAX,
            file_size: env_usize("WATERMARKS_CHILD_RLIMIT_FSIZE", 2 << 30) as u64,
        },
    }
}

/// Python's `int(raw, 0)`: decimal, or 0x/0o/0b prefixed.
fn parse_int_any_base(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    let (radix, digits) = match raw.get(..2).map(str::to_ascii_lowercase).as_deref() {
        Some("0x") => (16, &raw[2..]),
        Some("0o") => (8, &raw[2..]),
        Some("0b") => (2, &raw[2..]),
        _ => (10, raw),
    };
    u64::from_str_radix(digits, radix).ok()
}

/// Run the MarkLLM adapter on `text`.
///
/// Returns the adapter's JSON payload, or an `available: false` object with an
/// `error` string when the backend is unconfigured or broken.
pub fn markllm_detect(text: &str, options: &MarkllmOptions) -> Value {
    let Some(upstream_dir) = options
        .upstream_dir
        .clone()
        .filter(|value| !value.is_empty())
    else {
        return json!({"available": false, "error": "no MARKLLM_DIR set"});
    };
    let upstream = std::fs::canonicalize(expand_user(&upstream_dir))
        .unwrap_or_else(|_| PathBuf::from(&upstream_dir));
    if !upstream.is_dir() || !upstream.join("watermark").is_dir() {
        return json!({
            "available": false,
            "error": format!("MarkLLM checkout missing: {}", upstream.display()),
        });
    }
    let Some(python) = venv_python(&upstream) else {
        return json!({
            "available": false,
            "error": format!("MarkLLM venv missing: {}", upstream.display()),
        });
    };

    let script = scripts_dir().join("detect_text_watermark.py");
    let args = vec![
        script.display().to_string(),
        "detect".to_string(),
        "-".to_string(),
        "--scheme".to_string(),
        options.scheme.clone(),
        "--upstream-dir".to_string(),
        upstream.display().to_string(),
        "--model".to_string(),
        options.model.clone(),
        "--json".to_string(),
    ];

    let result = run_capture(
        &python,
        &args,
        markllm_limits(),
        Duration::from_secs_f64(options.timeout),
        Some(text.as_bytes()),
    );
    let output = match result {
        Ok(output) => output,
        Err(error) => {
            return json!({"available": false, "error": format!("MarkLLM adapter error: {error}")})
        }
    };
    let code = output.status.code().unwrap_or(-1);
    if code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("adapter exited {code}")
        } else {
            stderr
        };
        return json!({"available": false, "error": message});
    }
    match serde_json::from_slice::<Value>(&output.stdout) {
        Ok(value) => value,
        Err(error) => json!({
            "available": false,
            "error": format!("adapter JSON parse error: {error}"),
        }),
    }
}

fn expand_user(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = env_nonempty("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(raw)
}

/// Whether a Python interpreter is on PATH at all, for diagnostics.
pub fn python_available() -> bool {
    which("python3").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_checkout_is_reported_not_fatal() {
        let options = MarkllmOptions::default();
        let result = markllm_detect("text", &options);
        assert_eq!(result["available"], false);
        assert_eq!(result["error"], "no MARKLLM_DIR set");
    }

    #[test]
    fn a_missing_checkout_is_reported_by_path() {
        let options = MarkllmOptions {
            scheme: "kgw".into(),
            upstream_dir: Some("/nonexistent-markllm-checkout".into()),
            ..MarkllmOptions::default()
        };
        let result = markllm_detect("text", &options);
        assert_eq!(result["available"], false);
        assert!(result["error"]
            .as_str()
            .unwrap()
            .starts_with("MarkLLM checkout missing: "));
    }

    #[test]
    fn a_checkout_without_a_venv_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("watermark")).unwrap();
        let options = MarkllmOptions {
            scheme: "kgw".into(),
            upstream_dir: Some(dir.path().display().to_string()),
            ..MarkllmOptions::default()
        };
        let result = markllm_detect("text", &options);
        assert_eq!(result["available"], false);
        assert!(result["error"]
            .as_str()
            .unwrap()
            .starts_with("MarkLLM venv missing: "));
    }

    #[test]
    fn integer_limits_parse_in_every_python_base() {
        assert_eq!(parse_int_any_base("1024"), Some(1024));
        assert_eq!(parse_int_any_base("0x400"), Some(1024));
        assert_eq!(parse_int_any_base("0o2000"), Some(1024));
        assert_eq!(parse_int_any_base("nonsense"), None);
    }
}
