//! JSON-RPC message classification and the replies the hub composes itself.

use serde_json::{json, Value};

/// The protocol versions the hub will echo back to a client that asks for
/// them. Anything else gets the child's own version.
pub const KNOWN_PROTOCOL_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];

/// What one incoming JSON-RPC message is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    /// `initialize` request; carries the client's id.
    Initialize(Value),
    /// A request other than `initialize`; carries the client's id.
    Request(Value),
    /// A notification (no id).
    Notification,
    /// A response (result/error with id) — a client answering a server request.
    Response,
    Invalid(String),
}

/// `notifications/initialized` from a client. The hub answers `initialize`
/// itself and initialised the child once, so this must not be forwarded.
pub fn is_initialized_notification(msg: &Value) -> bool {
    msg.get("method").and_then(Value::as_str) == Some("notifications/initialized")
        && msg.get("id").is_none()
}

pub fn classify(msg: &Value) -> Kind {
    let Some(obj) = msg.as_object() else {
        return Kind::Invalid("message is not an object".into());
    };
    let has_id = obj.get("id").map(|v| !v.is_null()).unwrap_or(false);
    match obj.get("method").and_then(Value::as_str) {
        Some("initialize") if has_id => Kind::Initialize(obj["id"].clone()),
        Some("initialize") => Kind::Invalid("initialize must carry an id".into()),
        Some(_) if has_id => Kind::Request(obj["id"].clone()),
        Some(_) => Kind::Notification,
        None if obj.contains_key("result") || obj.contains_key("error") => Kind::Response,
        None => Kind::Invalid("message has neither method nor result/error".into()),
    }
}

/// A JSON-RPC error object addressed to `id`.
pub fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// The `initialize` reply: the child's cached result, with the protocol
/// version set to the client's request when the hub knows it, so a client
/// pinned to an older revision is not told a version it did not ask for.
pub fn initialize_reply(id: Value, mut result: Value, requested: Option<&str>) -> Value {
    if let (Some(req), Some(obj)) = (requested, result.as_object_mut()) {
        if KNOWN_PROTOCOL_VERSIONS.contains(&req) {
            obj.insert("protocolVersion".into(), json!(req));
        }
    }
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

/// True when `msg` is a response addressed to `id`.
pub fn is_response_to(msg: &Value, id: u64) -> bool {
    msg.get("id").and_then(Value::as_u64) == Some(id)
        && (msg.get("result").is_some() || msg.get("error").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialized_notification_is_recognised_only_without_an_id() {
        assert!(is_initialized_notification(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
        ));
        assert!(!is_initialized_notification(
            &json!({"jsonrpc": "2.0", "id": 1, "method": "notifications/initialized"})
        ));
        assert!(!is_initialized_notification(
            &json!({"jsonrpc": "2.0", "method": "notifications/progress"})
        ));
    }

    #[test]
    fn classifies_every_shape() {
        assert_eq!(
            classify(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})),
            Kind::Initialize(json!(1))
        );
        assert_eq!(
            classify(&json!({"jsonrpc": "2.0", "id": "a", "method": "tools/list"})),
            Kind::Request(json!("a"))
        );
        assert_eq!(
            classify(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"})),
            Kind::Notification
        );
        assert_eq!(
            classify(&json!({"jsonrpc": "2.0", "id": 3, "result": {}})),
            Kind::Response
        );
        assert!(matches!(
            classify(&json!({"jsonrpc": "2.0", "method": "initialize"})),
            Kind::Invalid(_)
        ));
        assert!(matches!(classify(&json!([1])), Kind::Invalid(_)));
        assert!(matches!(
            classify(&json!({"jsonrpc": "2.0", "id": 1})),
            Kind::Invalid(_)
        ));
        assert_eq!(
            classify(&json!({"id": null, "method": "x"})),
            Kind::Notification
        );
    }

    #[test]
    fn initialize_reply_echoes_known_version_only() {
        let base = json!({"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "x"}});
        let r = initialize_reply(json!(7), base.clone(), Some("2025-03-26"));
        assert_eq!(r["id"], 7);
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["capabilities"]["tools"], json!({}));
        let r = initialize_reply(json!(7), base.clone(), Some("1999-01-01"));
        assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
        let r = initialize_reply(json!(7), base, None);
        assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
    }

    #[test]
    fn error_and_response_helpers() {
        let e = error_response(json!("q"), -32000, "boom");
        assert_eq!(e["error"]["code"], -32000);
        assert_eq!(e["id"], "q");
        assert!(is_response_to(&json!({"id": 5, "result": 1}), 5));
        assert!(is_response_to(&json!({"id": 5, "error": {}}), 5));
        assert!(!is_response_to(&json!({"id": 5, "method": "m"}), 5));
        assert!(!is_response_to(&json!({"id": 6, "result": 1}), 5));
    }
}
