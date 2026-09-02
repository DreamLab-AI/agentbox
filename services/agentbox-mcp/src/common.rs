//! Shared helpers used by all three MCP subcommands.
//!
//! Every tool in this crate mirrors a Python FastMCP tool that returned a
//! plain JSON-serializable `dict`. FastMCP wraps that `dict` as a single
//! JSON text content block on success. `json_result` reproduces that shape;
//! `invalid_params` reproduces the pydantic `ValidationError` path (which
//! FastMCP surfaces as a tool-call error before the tool body ever runs).

use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::ErrorData as McpError;
use serde_json::Value;

/// Wrap a JSON value as a successful MCP tool result (single JSON text block),
/// matching FastMCP's default serialisation of a Python `dict` return value.
pub fn json_result(value: Value) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![ContentBlock::json(&value)?]))
}

/// Build an `invalid_params` protocol error, matching a pydantic
/// `ValidationError` raised before a tool body executes.
pub fn invalid_params(message: impl Into<String>) -> McpError {
    McpError::invalid_params(message.into(), None)
}

/// Read an environment variable, falling back to `default` when unset or empty.
pub fn env_or(key: &str, default: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

/// Read an environment variable as `u64`, falling back to `default` when
/// unset, empty, or unparsable.
pub fn env_or_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    // SAFETY: each test below uses a private, test-only env var name that no
    // other test or module touches, so concurrent test threads never race on
    // the same key.

    #[test]
    fn env_or_falls_back_when_unset() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_UNSET";
        unsafe {
            std::env::remove_var(key);
        }
        assert_eq!(env_or(key, "fallback"), "fallback");
    }

    #[test]
    fn env_or_falls_back_when_set_but_empty() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_EMPTY";
        unsafe {
            std::env::set_var(key, "");
        }
        assert_eq!(env_or(key, "fallback"), "fallback");
        unsafe {
            std::env::remove_var(key);
        }
    }

    #[test]
    fn env_or_returns_set_value() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_SET";
        unsafe {
            std::env::set_var(key, "custom-value");
        }
        assert_eq!(env_or(key, "fallback"), "custom-value");
        unsafe {
            std::env::remove_var(key);
        }
    }

    #[test]
    fn env_or_u64_falls_back_when_unset() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_U64_UNSET";
        unsafe {
            std::env::remove_var(key);
        }
        assert_eq!(env_or_u64(key, 300), 300);
    }

    #[test]
    fn env_or_u64_falls_back_when_unparsable() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_U64_BAD";
        unsafe {
            std::env::set_var(key, "not-a-number");
        }
        assert_eq!(env_or_u64(key, 300), 300);
        unsafe {
            std::env::remove_var(key);
        }
    }

    #[test]
    fn env_or_u64_parses_set_value() {
        let key = "AGENTBOX_MCP_TEST_ENV_OR_U64_SET";
        unsafe {
            std::env::set_var(key, "45");
        }
        assert_eq!(env_or_u64(key, 300), 45);
        unsafe {
            std::env::remove_var(key);
        }
    }
}
