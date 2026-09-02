//! Shared helpers for the prose-sanitiser binaries and service.

pub mod binary;
pub mod confidence;
pub mod io;
pub mod proc;
pub mod surrogate;

pub use binary::{looks_binary, ROUTER_ADVICE, TEXT_TOOL_ADVICE};
pub use confidence::{classify_finding_confidence, CONFIDENCE_LEVELS};
pub use io::{
    backup_path, cleaned_path, guard_binary, max_input_bytes, read_text_input, safe_write_bytes,
    safe_write_text, write_text_output,
};
pub use proc::{safe_arg, which};
pub use surrogate::Unit;

/// A failure that maps directly onto a process exit code.
///
/// The Python CLIs print to stderr and `raise SystemExit(n)`; this carries the
/// same pair so every binary's `main` can stay a three-line shim.
#[derive(Debug, Clone)]
pub struct CliError {
    pub code: i32,
    pub message: String,
}

impl CliError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

/// Print `message` to stderr, like the Python `eprint`.
pub fn eprint_line(message: &str) {
    eprintln!("{message}");
}

/// Run a CLI body, printing any error to stderr and returning its exit code.
pub fn run_cli(body: impl FnOnce() -> Result<i32, CliError>) -> i32 {
    match body() {
        Ok(code) => code,
        Err(error) => {
            eprint_line(&error.message);
            error.code
        }
    }
}

/// Read a numeric environment override, falling back to `default`.
///
/// Python's `int(os.environ.get(name, str(default)))` raises on a malformed
/// value; treating it as unset is friendlier and cannot silently disable a cap,
/// because the default is always the conservative one.
pub fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(default)
}

/// Read an environment variable, treating empty as unset.
pub fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Truthiness for the flag-shaped environment variables.
pub fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// Serialise to the same shape as Python's `json.dump(..., indent=2,
/// ensure_ascii=False)` and write it to stdout with a trailing newline.
pub fn emit_json(value: &serde_json::Value) {
    println!("{}", to_pretty_json(value));
}

/// Python's `json.dumps(value, indent=2, ensure_ascii=False)`.
pub fn to_pretty_json(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).expect("serde_json values always serialise")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_helpers_fall_back_safely() {
        assert_eq!(env_usize("PROSE_SANITISER_ABSENT_CAP", 42), 42);
        assert!(!env_flag("PROSE_SANITISER_ABSENT_FLAG"));
        assert!(env_nonempty("PROSE_SANITISER_ABSENT_VALUE").is_none());
    }

    #[test]
    fn pretty_json_matches_the_python_indent() {
        let value = serde_json::json!({"a": 1, "b": ["x"]});
        assert_eq!(
            to_pretty_json(&value),
            "{\n  \"a\": 1,\n  \"b\": [\n    \"x\"\n  ]\n}"
        );
    }

    #[test]
    fn pretty_json_keeps_non_ascii_unescaped() {
        let value = serde_json::json!({"label": "naïve — text"});
        assert!(to_pretty_json(&value).contains("naïve — text"));
    }
}
