//! The subprocess boundary to the torch harnesses that stay in Python.
//!
//! reverse-SynthID (scoring), CtrlRegen and MarkDiffusion (pixel-domain
//! removal) are torch programs, not parsers: porting them would mean porting a
//! diffusion stack. They keep their Python entry points and their exact
//! invocations; this module only locates them, runs them under the larger
//! torch resource caps and parses their JSON back.
//!
//! MarkLLM, the fourth harness, is driven from [`crate::rewrite`] because it
//! wraps a text rewrite rather than an image clean.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::common::proc::{run_capture, Rlimits, RunError};
use crate::common::{env_nonempty, which};

/// Where the Python harness scripts live.
///
/// The Rust binaries sit outside the skill, so the location is configuration
/// rather than `__file__`: an explicit override first, then the baked image
/// path, then a repo-relative path for a development checkout.
pub fn scripts_dir() -> PathBuf {
    if let Some(dir) = env_nonempty("PROSE_SANITISER_SCRIPTS_DIR") {
        return PathBuf::from(dir);
    }
    let baked = PathBuf::from("/opt/agentbox/skills/prose-sanitiser");
    if baked.is_dir() {
        return baked;
    }
    PathBuf::from("skills/prose-sanitiser")
}

/// The interpreter to run a harness with, when no checkout venv applies.
fn default_python() -> PathBuf {
    if let Some(python) = env_nonempty("PROSE_SANITISER_PYTHON") {
        return PathBuf::from(python);
    }
    which("python3").unwrap_or_else(|| PathBuf::from("python3"))
}

/// Prefer a checkout's own venv so torch/diffusers are importable.
fn venv_python(upstream: Option<&Path>) -> PathBuf {
    if let Some(upstream) = upstream {
        let candidate = upstream.join(".venv").join("bin").join("python");
        if candidate.is_file() {
            return candidate;
        }
    }
    default_python()
}

fn expand_user(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = env_nonempty("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(raw)
}

fn resolve_dir(raw: &str) -> PathBuf {
    let expanded = expand_user(raw);
    std::fs::canonicalize(&expanded).unwrap_or(expanded)
}

/// Turn a finished harness run into its JSON payload, or an availability error.
fn parse_payload(
    result: Result<std::process::Output, RunError>,
    adapter: &str,
) -> Result<Value, Value> {
    let output = match result {
        Ok(output) => output,
        Err(RunError::TimedOut(limit)) => {
            return Err(json!({
                "available": false,
                "error": format!("{adapter} timed out after {}s", limit.as_secs()),
            }))
        }
        Err(error) => return Err(json!({"available": false, "error": error.to_string()})),
    };
    if output.status.code() != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(json!({
            "available": false,
            "error": stderr.trim().chars().take(2000).collect::<String>(),
        }));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = if stdout.trim().is_empty() {
        "{}"
    } else {
        &stdout
    };
    serde_json::from_str::<Value>(text).map_err(
        |error| json!({"available": false, "error": format!("bad {adapter} JSON: {error}")}),
    )
}

/// Run the optional reverse-SynthID scorer.
///
/// Returns `None` when the scorer is not configured or reports itself
/// unavailable (exit 3), so callers keep the default "no SynthID score".
pub fn run_synthid_score(path: &Path, upstream_dir: Option<&str>) -> Option<Value> {
    let upstream = upstream_dir
        .map(str::to_string)
        .or_else(|| env_nonempty("REVERSE_SYNTHID_DIR"))?;
    if upstream.is_empty() {
        return None;
    }

    let script = scripts_dir().join("score_synthid.py");
    let args = vec![
        script.display().to_string(),
        path.display().to_string(),
        "--upstream-dir".to_string(),
        upstream,
        "--json".to_string(),
    ];
    let result = run_capture(
        &default_python(),
        &args,
        Rlimits::default_child(),
        Duration::from_secs(180),
        None,
    );
    let output = match result {
        Ok(output) => output,
        Err(error) => return Some(json!({"available": false, "error": error.to_string()})),
    };
    // Exit 3 is the harness's "not configured" signal, not a failure.
    if output.status.code() == Some(3) {
        return None;
    }
    if output.status.code() != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Some(json!({
            "available": false,
            "error": stderr.trim().chars().take(2000).collect::<String>(),
        }));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = if stdout.trim().is_empty() {
        "{}"
    } else {
        &stdout
    };
    match serde_json::from_str::<Value>(text) {
        Ok(value) => Some(value),
        Err(error) => Some(json!({
            "available": false,
            "error": format!("bad scorer JSON: {error}"),
        })),
    }
}

/// CtrlRegen invocation settings.
#[derive(Debug, Clone)]
pub struct CtrlRegenOptions {
    pub upstream_dir: Option<String>,
    pub strength: f64,
    pub steps: u32,
    pub device: Option<String>,
    pub seed: Option<i64>,
    pub timeout_secs: u64,
}

impl Default for CtrlRegenOptions {
    fn default() -> Self {
        Self {
            upstream_dir: None,
            strength: 0.25,
            steps: 50,
            device: None,
            seed: None,
            timeout_secs: 3600,
        }
    }
}

/// Run the optional CtrlRegen remover.
pub fn run_ctrlregen_clean(path: &Path, output: &Path, options: &CtrlRegenOptions) -> Value {
    let Some(upstream_dir) = options
        .upstream_dir
        .clone()
        .or_else(|| env_nonempty("NOAI_WATERMARK_DIR"))
    else {
        return json!({
            "available": false,
            "error": "CtrlRegen not configured (set NOAI_WATERMARK_DIR or pass --ctrlregen-dir)",
        });
    };
    let upstream = resolve_dir(&upstream_dir);
    if !upstream.is_dir() {
        return json!({
            "available": false,
            "error": format!("CtrlRegen dir not found: {}", upstream.display()),
        });
    }

    let script = scripts_dir().join("clean_ctrlregen.py");
    let mut args = vec![
        script.display().to_string(),
        path.display().to_string(),
        "-o".to_string(),
        output.display().to_string(),
        "--upstream-dir".to_string(),
        upstream.display().to_string(),
        "--strength".to_string(),
        format_float(options.strength),
        "--steps".to_string(),
        options.steps.to_string(),
        "--json".to_string(),
    ];
    if let Some(device) = &options.device {
        args.push("--device".to_string());
        args.push(device.clone());
    }
    if let Some(seed) = options.seed {
        args.push("--seed".to_string());
        args.push(seed.to_string());
    }

    let result = run_capture(
        &venv_python(Some(&upstream)),
        &args,
        Rlimits::torch_child(),
        Duration::from_secs(options.timeout_secs),
        None,
    );
    match parse_payload(result, "CtrlRegen") {
        Ok(mut payload) => {
            if let Some(map) = payload.as_object_mut() {
                map.insert("available".into(), json!(true));
            }
            payload
        }
        Err(error) => error,
    }
}

/// MarkDiffusion DiffusionPurification invocation settings.
#[derive(Debug, Clone)]
pub struct MarkDiffusionOptions {
    pub upstream_dir: Option<String>,
    pub strength: f64,
    pub model: Option<String>,
    pub size: u32,
    pub steps: u32,
    pub device: Option<String>,
    pub timeout_secs: u64,
}

impl Default for MarkDiffusionOptions {
    fn default() -> Self {
        Self {
            upstream_dir: None,
            strength: 0.3,
            model: None,
            size: 512,
            steps: 50,
            device: None,
            timeout_secs: 3600,
        }
    }
}

/// Run the optional MarkDiffusion DiffusionPurification remover.
pub fn run_markdiffusion_purify(
    path: &Path,
    output: &Path,
    options: &MarkDiffusionOptions,
) -> Value {
    let upstream_dir = options
        .upstream_dir
        .clone()
        .or_else(|| env_nonempty("MARKDIFFUSION_DIR"));
    let upstream = upstream_dir.as_deref().map(resolve_dir);
    if let Some(upstream) = &upstream {
        if !upstream.is_dir() {
            return json!({
                "available": false,
                "error": format!("MarkDiffusion dir not found: {}", upstream.display()),
            });
        }
    }

    let script = scripts_dir().join("markdiffusion_harness.py");
    let mut args = vec![
        script.display().to_string(),
        "purify".to_string(),
        path.display().to_string(),
        "-o".to_string(),
        output.display().to_string(),
        "--purification-strength".to_string(),
        format_float(options.strength),
        "--size".to_string(),
        options.size.to_string(),
        "--steps".to_string(),
        options.steps.to_string(),
        "--json".to_string(),
    ];
    if let Some(upstream) = &upstream {
        args.push("--upstream-dir".to_string());
        args.push(upstream.display().to_string());
    }
    if let Some(model) = &options.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }
    if let Some(device) = &options.device {
        args.push("--device".to_string());
        args.push(device.clone());
    }

    let result = run_capture(
        &venv_python(upstream.as_deref()),
        &args,
        Rlimits::torch_child(),
        Duration::from_secs(options.timeout_secs),
        None,
    );
    match parse_payload(result, "DiffusionPurification") {
        Ok(mut payload) => {
            if let Some(map) = payload.as_object_mut() {
                map.insert("available".into(), json!(true));
            }
            payload
        }
        Err(mut error) => {
            // The Python reported the adapter name for a JSON parse failure.
            if let Some(message) = error.get("error").and_then(Value::as_str) {
                if message.starts_with("bad DiffusionPurification JSON") {
                    let fixed = message.replace(
                        "bad DiffusionPurification JSON",
                        "bad MarkDiffusion adapter JSON",
                    );
                    error["error"] = json!(fixed);
                }
            }
            error
        }
    }
}

/// Render a float the way Python's `str(float)` does for these flags.
fn format_float(value: f64) -> String {
    if value == value.trunc() && value.abs() < 1e15 {
        format!("{value:.1}")
    } else {
        format!("{value}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unconfigured_scorer_yields_no_score() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.png");
        std::fs::write(&file, b"x").unwrap();
        // No --synthid-dir and (in a clean test env) no REVERSE_SYNTHID_DIR.
        if std::env::var("REVERSE_SYNTHID_DIR").is_err() {
            assert!(run_synthid_score(&file, None).is_none());
        }
        assert!(run_synthid_score(&file, Some("")).is_none());
    }

    #[test]
    fn ctrlregen_reports_a_clear_error_when_unconfigured() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.png");
        let options = CtrlRegenOptions {
            upstream_dir: Some("/nonexistent-ctrlregen-checkout".into()),
            ..CtrlRegenOptions::default()
        };
        let result = run_ctrlregen_clean(&file, &file, &options);
        assert_eq!(result["available"], false);
        assert!(result["error"]
            .as_str()
            .unwrap()
            .starts_with("CtrlRegen dir not found: "));
    }

    #[test]
    fn markdiffusion_reports_a_missing_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("x.png");
        let options = MarkDiffusionOptions {
            upstream_dir: Some("/nonexistent-markdiffusion".into()),
            ..MarkDiffusionOptions::default()
        };
        let result = run_markdiffusion_purify(&file, &file, &options);
        assert_eq!(result["available"], false);
        assert!(result["error"]
            .as_str()
            .unwrap()
            .starts_with("MarkDiffusion dir not found: "));
    }

    #[test]
    fn floats_render_the_way_the_python_flags_expected() {
        assert_eq!(format_float(0.25), "0.25");
        assert_eq!(format_float(0.3), "0.3");
        assert_eq!(format_float(1.0), "1.0");
    }

    #[test]
    fn the_scripts_dir_honours_an_explicit_override() {
        // The override wins over both the baked and repo-relative fallbacks.
        std::env::set_var("PROSE_SANITISER_SCRIPTS_DIR", "/tmp/harnesses");
        assert_eq!(scripts_dir(), PathBuf::from("/tmp/harnesses"));
        std::env::remove_var("PROSE_SANITISER_SCRIPTS_DIR");
    }
}
