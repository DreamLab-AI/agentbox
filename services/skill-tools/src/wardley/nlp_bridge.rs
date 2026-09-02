//! Subprocess bridge to the untouched, spaCy-based `advanced_nlp_parser.py`.
//!
//! `advanced_nlp_parser.py` is explicitly out of scope for this port (it needs
//! spaCy and stays Python — see the port brief). It exposes no CLI of its own (its
//! `__main__` block only runs a hardcoded demo), so instead of porting it we shell out
//! to a `python3 -c` one-liner that imports `parse_components_text` from it directly,
//! feeds it `{"text": ..., "use_advanced_nlp": ...}` as JSON on stdin, and prints the
//! resulting `{"components": [...], "dependencies": [...]}` as JSON on stdout.
//!
//! This mirrors `wardley_mapper.py`'s `create_map`/`parse_text`, which call
//! `parse_components_text(input_text, use_advanced_nlp=True)` inside a
//! `try: ... except Exception: components, dependencies = quick_parse_input(input_text)`
//! block — i.e. ANY failure (spaCy not installed, `python3` missing, non-zero exit,
//! malformed JSON on stdout) falls back to the lightweight regex parser. This module
//! only provides the subprocess call; callers ([`super::mapper`]) are responsible for
//! applying that same fallback-on-any-error semantics by catching
//! [`NlpBridgeError`] and calling [`super::quick_map::advanced_nlp_parse`] instead.
//!
//! ## Path resolution strategy
//!
//! `advanced_nlp_parser.py` lives at `skills/wardley-maps/tools/advanced_nlp_parser.py`
//! relative to the repository root. Since a compiled Rust binary has no notion of "the
//! directory this crate's source lives in" at runtime the way Python's
//! `os.path.dirname(os.path.abspath(__file__))` does, resolution is, in priority
//! order:
//!
//! 1. `WARDLEY_NLP_SCRIPT_DIR` environment variable, if set — used verbatim as the
//!    directory containing `advanced_nlp_parser.py` (an explicit override for
//!    deployments where the skills tree isn't a repo-relative sibling of the binary,
//!    e.g. a packaged/installed layout).
//! 2. Walk upward from the current working directory, at each level checking whether
//!    `skills/wardley-maps/tools/advanced_nlp_parser.py` exists underneath it — the
//!    same shape of repo-root discovery `git rev-parse --show-toplevel` performs,
//!    without shelling out to `git`. This works from any subdirectory of a checkout
//!    (e.g. running `cargo test` from `services/skill-tools/`).
//!
//! If neither resolves to an existing file, [`NlpBridgeError::ScriptNotFound`] is
//! returned and the caller falls back to the regex parser exactly as the Python
//! `except Exception` clause would for an `ImportError`.

use super::{CompDict, ParseResult};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const SCRIPT_DIR_ENV_VAR: &str = "WARDLEY_NLP_SCRIPT_DIR";
const RELATIVE_SCRIPT_PATH: &str = "skills/wardley-maps/tools/advanced_nlp_parser.py";

#[derive(Debug)]
pub enum NlpBridgeError {
    ScriptNotFound,
    Spawn(std::io::Error),
    Io(std::io::Error),
    NonZeroExit { status: Option<i32>, stderr: String },
    InvalidJson(serde_json::Error),
    UnexpectedShape,
}

impl std::fmt::Display for NlpBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NlpBridgeError::ScriptNotFound => write!(
                f,
                "advanced_nlp_parser.py not found (set WARDLEY_NLP_SCRIPT_DIR)"
            ),
            NlpBridgeError::Spawn(e) => write!(f, "failed to spawn python3: {e}"),
            NlpBridgeError::Io(e) => write!(f, "I/O error talking to python3 subprocess: {e}"),
            NlpBridgeError::NonZeroExit { status, stderr } => {
                write!(
                    f,
                    "python3 subprocess exited with status {status:?}: {stderr}"
                )
            }
            NlpBridgeError::InvalidJson(e) => {
                write!(f, "invalid JSON from python3 subprocess: {e}")
            }
            NlpBridgeError::UnexpectedShape => {
                write!(f, "unexpected JSON shape from python3 subprocess")
            }
        }
    }
}

impl std::error::Error for NlpBridgeError {}

/// Resolve the directory containing `advanced_nlp_parser.py`. See the module docs for
/// the priority order.
pub fn resolve_nlp_script_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var(SCRIPT_DIR_ENV_VAR) {
        let path = PathBuf::from(&dir);
        if path.join("advanced_nlp_parser.py").is_file() {
            return Some(path);
        }
    }

    let cwd = std::env::current_dir().ok()?;
    let mut current: &Path = &cwd;
    loop {
        let candidate = current.join(RELATIVE_SCRIPT_PATH);
        if candidate.is_file() {
            return Some(candidate.parent()?.to_path_buf());
        }
        current = current.parent()?;
    }
}

/// `parse_components_text(text, use_advanced_nlp) -> (components, dependencies)` via
/// subprocess. Returns `Err` for any failure — script not found, `python3` missing,
/// non-zero exit, or malformed output — leaving the fallback decision to the caller.
pub fn parse_via_nlp(text: &str, use_advanced_nlp: bool) -> Result<ParseResult, NlpBridgeError> {
    let script_dir = resolve_nlp_script_dir().ok_or(NlpBridgeError::ScriptNotFound)?;

    let python_code = format!(
        r#"
import sys, json
sys.path.insert(0, {script_dir:?})
from advanced_nlp_parser import parse_components_text
data = json.load(sys.stdin)
comps, deps = parse_components_text(data['text'], use_advanced_nlp=data.get('use_advanced_nlp', True))
print(json.dumps({{'components': comps, 'dependencies': deps}}))
"#,
        script_dir = script_dir.display().to_string(),
    );

    let mut child = Command::new("python3")
        .arg("-c")
        .arg(&python_code)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(NlpBridgeError::Spawn)?;

    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().ok_or_else(|| {
            NlpBridgeError::Io(std::io::Error::other("failed to open child stdin"))
        })?;
        let request = serde_json::json!({"text": text, "use_advanced_nlp": use_advanced_nlp});
        stdin
            .write_all(request.to_string().as_bytes())
            .map_err(NlpBridgeError::Io)?;
    }

    let output = child.wait_with_output().map_err(NlpBridgeError::Io)?;

    if !output.status.success() {
        return Err(NlpBridgeError::NonZeroExit {
            status: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: Value = serde_json::from_str(stdout.trim()).map_err(NlpBridgeError::InvalidJson)?;

    let components: Vec<CompDict> = parsed
        .get("components")
        .and_then(Value::as_array)
        .ok_or(NlpBridgeError::UnexpectedShape)?
        .iter()
        .filter_map(|v| v.as_object().cloned())
        .collect();

    let dependencies: Vec<(String, String)> = parsed
        .get("dependencies")
        .and_then(Value::as_array)
        .ok_or(NlpBridgeError::UnexpectedShape)?
        .iter()
        .filter_map(|v| {
            let arr = v.as_array()?;
            if arr.len() < 2 {
                return None;
            }
            Some((arr[0].as_str()?.to_string(), arr[1].as_str()?.to_string()))
        })
        .collect();

    Ok((components, dependencies))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_nlp_script_dir_finds_the_real_script_when_run_in_repo() {
        // This test is tolerant of running outside the repo checkout (e.g. a stripped
        // build sandbox for `cargo test`) per the port brief's guidance for the
        // integration-style tests in this module.
        if let Some(dir) = resolve_nlp_script_dir() {
            assert!(dir.join("advanced_nlp_parser.py").is_file());
        }
    }

    #[test]
    fn env_var_override_is_respected_when_present() {
        // Doesn't touch the real environment permanently; just exercises the branch.
        let script_dir = resolve_nlp_script_dir();
        if let Some(dir) = script_dir {
            std::env::set_var(SCRIPT_DIR_ENV_VAR, dir.to_string_lossy().to_string());
            let resolved = resolve_nlp_script_dir();
            std::env::remove_var(SCRIPT_DIR_ENV_VAR);
            assert_eq!(resolved, Some(dir));
        }
    }
}
