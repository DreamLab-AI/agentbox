//! JSON-RPC 2.0 over newline-delimited stdio, which is what MCP speaks.
//!
//! Implemented directly rather than through a framework. The framing is four
//! fields and a newline; a dependency here would buy an abstraction over
//! something that fits on one screen, and cost the ability to build offline.
//! (Cryptography is the opposite case and is never hand-rolled — see
//! `colloquy-nostr`, which delegates every signature to the estate's key code.)

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A JSON-RPC request or notification.
///
/// A notification is a request with no `id`; it gets no response, and sending
/// one anyway is a protocol violation that some clients treat as fatal.
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    /// Always `"2.0"`.
    #[serde(default)]
    pub jsonrpc: String,
    /// Absent for notifications.
    #[serde(default)]
    pub id: Option<Value>,
    /// Method name.
    pub method: String,
    /// Method parameters.
    #[serde(default)]
    pub params: Value,
}

impl Request {
    /// Whether this is a notification and must not be answered.
    pub fn is_notification(&self) -> bool {
        self.id.is_none()
    }
}

/// A JSON-RPC response.
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    /// Always `"2.0"`.
    pub jsonrpc: &'static str,
    /// Echoes the request id.
    pub id: Value,
    /// Present on success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Present on failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// A JSON-RPC error object.
#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    /// JSON-RPC error code.
    pub code: i32,
    /// Human-readable message.
    pub message: String,
}

/// The method does not exist.
pub const METHOD_NOT_FOUND: i32 = -32601;
/// The parameters were wrong.
pub const INVALID_PARAMS: i32 = -32602;
/// Something failed inside the server.
pub const INTERNAL_ERROR: i32 = -32603;

impl Response {
    /// A successful response.
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    /// A failed response.
    pub fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError {
                code,
                message: message.into(),
            }),
        }
    }
}

/// Wrap a tool result as MCP content.
///
/// MCP tool results are a content array, and a tool that failed says so with
/// `isError` rather than a JSON-RPC error — the distinction matters because a
/// JSON-RPC error aborts the call, while `isError` hands the model something it
/// can read and recover from.
pub fn tool_result(text: impl Into<String>, is_error: bool) -> Value {
    serde_json::json!({
        "content": [{ "type": "text", "text": text.into() }],
        "isError": is_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_notification_is_a_request_without_an_id() {
        let n: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert!(n.is_notification());
        let r: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).unwrap();
        assert!(!r.is_notification());
    }

    #[test]
    fn missing_params_default_to_null_rather_than_failing_the_parse() {
        let r: Request = serde_json::from_str(r#"{"jsonrpc":"2.0","id":1,"method":"x"}"#).unwrap();
        assert!(r.params.is_null());
    }

    #[test]
    fn responses_omit_the_half_they_do_not_carry() {
        let ok = serde_json::to_string(&Response::ok(1.into(), serde_json::json!({"a":1}))).unwrap();
        assert!(!ok.contains("error"), "{ok}");
        let err = serde_json::to_string(&Response::err(1.into(), INVALID_PARAMS, "bad")).unwrap();
        assert!(!err.contains("result"), "{err}");
        assert!(err.contains("-32602"));
    }

    #[test]
    fn a_tool_failure_is_content_not_a_transport_error() {
        let v = tool_result("no such unit", true);
        assert_eq!(v["isError"], serde_json::json!(true));
        assert_eq!(v["content"][0]["type"], "text");
        assert_eq!(v["content"][0]["text"], "no such unit");
    }
}
