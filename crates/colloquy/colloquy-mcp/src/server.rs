//! The MCP server loop: tool declarations, dispatch, and stdio.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use colloquy_core::Timestamp;
use colloquy_store::KnowledgeStore;

use crate::protocol::*;
use crate::verbs::{self, Identity};

/// The MCP protocol revision this server speaks.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// Server name as it appears to a client.
pub const SERVER_NAME: &str = "colloquy";

/// Server version.
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The six tool declarations.
///
/// Descriptions are written for the model that reads them, not for a changelog:
/// each says when to reach for the verb, because a tool an agent never calls at
/// the right moment is the same as a tool that does not exist.
pub fn tool_declarations() -> Value {
    json!([
        {
            "name": "query",
            "description": "Search shared agent knowledge BEFORE acting on an unfamiliar error, API or integration, and before retrying something that just failed. Returns units with their evidence: confidence, how many independent principals confirmed, and whether anyone has disputed them.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "What you are trying to do, or the error you hit." },
                    "domain": { "type": "array", "items": { "type": "string" }, "description": "Restrict to these domain tags." },
                    "min_confidence": { "type": "number", "description": "Floor on derived confidence, 0..1." },
                    "limit": { "type": "integer", "description": "Maximum hits (default 10)." },
                    "include_gap_signals": { "type": "boolean", "description": "Include level-4 tooling-gap signals. Off by default: those are for people deciding what to build, not advice to act on." }
                }
            }
        },
        {
            "name": "propose",
            "description": "File something you learned that was not obvious: undocumented behaviour, a non-obvious workaround, or a solution that took several failed attempts. Proposing does not confirm — someone else has to.",
            "inputSchema": {
                "type": "object",
                "required": ["kind", "domain", "summary", "action"],
                "properties": {
                    "kind": { "type": "string", "enum": ["pitfall", "workaround", "tool_recommendation", "tool_gap_signal"], "description": "pitfall = permanent domain knowledge; workaround = useful now but evidence of a missing tool; tool_recommendation = points at the real solution; tool_gap_signal = emergent, rarely written by hand." },
                    "domain": { "type": "array", "items": { "type": "string" }, "description": "Domain tags, e.g. [\"api\",\"payments\"]." },
                    "summary": { "type": "string", "description": "One line, scannable. Max 200 characters." },
                    "detail": { "type": "string", "description": "The fuller explanation." },
                    "action": { "type": "string", "description": "What a reader should DO. A unit without this is an observation, not a learning." },
                    "severity": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
                }
            }
        },
        {
            "name": "confirm",
            "description": "Record that an existing unit held up when you relied on it. Confirmation weight follows distinct authorising principals, so your confirmation is worth most when nobody under your principal has confirmed it already.",
            "inputSchema": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": { "type": "string", "description": "The unit id, e.g. ku_a1b2c3d4e5f6." },
                    "note": { "type": "string", "description": "Optional context on how it held." }
                }
            }
        },
        {
            "name": "flag",
            "description": "Record that a unit is wrong or stale. This lowers its standing and opens a conversation; it does not remove it. Only a signed human decision retires a unit.",
            "inputSchema": {
                "type": "object",
                "required": ["id", "reason"],
                "properties": {
                    "id": { "type": "string", "description": "The unit id." },
                    "reason": { "type": "string", "description": "Required. What is wrong, specifically." }
                }
            }
        },
        {
            "name": "reflect",
            "description": "At the end of a session, hand over the learnings worth sharing. Each candidate is checked against what the store already knows: known ones are reported, new ones are filed. Use this instead of proposing a batch blindly.",
            "inputSchema": {
                "type": "object",
                "required": ["candidates"],
                "properties": {
                    "candidates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["kind", "domain", "summary", "action"],
                            "properties": {
                                "kind": { "type": "string", "enum": ["pitfall", "workaround", "tool_recommendation", "tool_gap_signal"] },
                                "domain": { "type": "array", "items": { "type": "string" } },
                                "summary": { "type": "string" },
                                "detail": { "type": "string" },
                                "action": { "type": "string" }
                            }
                        }
                    }
                }
            }
        },
        {
            "name": "status",
            "description": "Report what this store holds: unit counts by ladder level, how many are disputed or stale, and how many distinct principals have ever confirmed anything here.",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

/// A running server bound to one store and one identity.
#[derive(Debug)]
pub struct Server<S: KnowledgeStore> {
    store: S,
    identity: Identity,
}

impl<S: KnowledgeStore> Server<S> {
    /// Bind a server.
    pub fn new(store: S, identity: Identity) -> Self {
        Self { store, identity }
    }

    /// Handle one request, returning the response to write — or `None` for a
    /// notification, which must not be answered.
    pub async fn handle(&self, req: Request, now: Timestamp) -> Option<Response> {
        if req.is_notification() {
            return None;
        }
        let id = req.id.clone().unwrap_or(Value::Null);

        let result = match req.method.as_str() {
            "initialize" => Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
            })),
            "tools/list" => Ok(json!({ "tools": tool_declarations() })),
            "tools/call" => return Some(self.call(id, req.params, now).await),
            "ping" => Ok(json!({})),
            other => Err(Response::err(
                id.clone(),
                METHOD_NOT_FOUND,
                format!("unknown method `{other}`"),
            )),
        };

        Some(match result {
            Ok(v) => Response::ok(id, v),
            Err(e) => e,
        })
    }

    async fn call(&self, id: Value, params: Value, now: Timestamp) -> Response {
        let Some(name) = params.get("name").and_then(Value::as_str) else {
            return Response::err(id, INVALID_PARAMS, "`name` is required");
        };
        let args = params.get("arguments").cloned().unwrap_or(json!({}));

        let outcome = match name {
            "query" => verbs::query(&self.store, args, now).await,
            "propose" => verbs::propose(&self.store, &self.identity, args, now).await,
            "confirm" => verbs::attest(&self.store, &self.identity, args, false, now).await,
            "flag" => verbs::attest(&self.store, &self.identity, args, true, now).await,
            "reflect" => verbs::reflect(&self.store, &self.identity, args, now).await,
            "status" => verbs::status(&self.store, now).await,
            other => {
                return Response::err(id, METHOD_NOT_FOUND, format!("unknown tool `{other}`"));
            }
        };

        // A tool that failed reports through `isError`, not through a JSON-RPC
        // error: the model should see what went wrong and be able to fix it,
        // rather than have the call torn down underneath it.
        match outcome {
            Ok(v) => Response::ok(
                id,
                tool_result(serde_json::to_string_pretty(&v).unwrap_or_default(), false),
            ),
            Err(e) => Response::ok(id, tool_result(e.to_string(), true)),
        }
    }

    /// Serve until stdin closes.
    pub async fn serve_stdio(&self, clock: impl Fn() -> Timestamp) -> std::io::Result<()> {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        let mut out = tokio::io::stdout();

        while let Some(line) = lines.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            let response = match serde_json::from_str::<Request>(&line) {
                Ok(req) => self.handle(req, clock()).await,
                Err(e) => Some(Response::err(
                    Value::Null,
                    INVALID_PARAMS,
                    format!("unparseable request: {e}"),
                )),
            };
            if let Some(r) = response {
                let mut bytes = serde_json::to_vec(&r)?;
                bytes.push(b'\n');
                out.write_all(&bytes).await?;
                out.flush().await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_store::LocalStore;

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn server() -> Server<LocalStore> {
        Server::new(
            LocalStore::in_memory(),
            Identity::agent("did:nostr:scribe", "did:nostr:operator"),
        )
    }

    fn req(id: i64, method: &str, params: Value) -> Request {
        serde_json::from_value(json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        }))
        .unwrap()
    }

    fn payload(r: &Response) -> Value {
        let text = r.result.as_ref().unwrap()["content"][0]["text"]
            .as_str()
            .unwrap();
        serde_json::from_str(text).unwrap()
    }

    #[tokio::test]
    async fn initialize_declares_tools_and_a_protocol_version() {
        let r = server().handle(req(1, "initialize", json!({})), t(0)).await.unwrap();
        let v = r.result.unwrap();
        assert_eq!(v["protocolVersion"], json!(PROTOCOL_VERSION));
        assert_eq!(v["serverInfo"]["name"], json!("colloquy"));
        assert!(v["capabilities"]["tools"].is_object());
    }

    #[tokio::test]
    async fn all_six_verbs_are_declared_with_schemas() {
        let r = server().handle(req(1, "tools/list", json!({})), t(0)).await.unwrap();
        let tools = r.result.unwrap()["tools"].as_array().unwrap().clone();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["query", "propose", "confirm", "flag", "reflect", "status"]);
        for t in &tools {
            assert_eq!(t["inputSchema"]["type"], json!("object"), "{}", t["name"]);
            assert!(
                t["description"].as_str().unwrap().len() > 60,
                "{} needs a description that tells a model when to use it",
                t["name"]
            );
        }
    }

    #[tokio::test]
    async fn a_notification_gets_no_response() {
        let n: Request =
            serde_json::from_value(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
                .unwrap();
        assert!(server().handle(n, t(0)).await.is_none());
    }

    #[tokio::test]
    async fn an_unknown_method_is_a_transport_error() {
        let r = server().handle(req(1, "nope", json!({})), t(0)).await.unwrap();
        assert_eq!(r.error.unwrap().code, METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn a_full_propose_confirm_query_round_trip_works_over_the_wire() {
        let s = server();

        let r = s
            .handle(
                req(1, "tools/call", json!({
                    "name": "propose",
                    "arguments": {
                        "kind": "pitfall",
                        "domain": ["wire-format"],
                        "summary": "The 52-byte record width is frozen at compile time",
                        "detail": "A const assertion fails the build if it changes.",
                        "action": "Add a sibling frame instead of widening the record."
                    }
                })),
                t(0),
            )
            .await
            .unwrap();
        let id = payload(&r)["id"].as_str().unwrap().to_string();

        let r = s
            .handle(req(2, "tools/call", json!({ "name": "confirm", "arguments": { "id": &id } })), t(1))
            .await
            .unwrap();
        assert_eq!(payload(&r)["status"], json!("active"));

        let r = s
            .handle(
                req(3, "tools/call", json!({ "name": "query", "arguments": { "text": "52-byte record" } })),
                t(1),
            )
            .await
            .unwrap();
        let hits = payload(&r)["hits"].as_array().unwrap().clone();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["id"], json!(id));
    }

    #[tokio::test]
    async fn a_tool_failure_comes_back_as_content_the_model_can_read() {
        let r = server()
            .handle(
                req(1, "tools/call", json!({ "name": "confirm", "arguments": { "id": "ku_000000000000" } })),
                t(0),
            )
            .await
            .unwrap();
        let v = r.result.unwrap();
        assert_eq!(v["isError"], json!(true));
        assert!(r.error.is_none(), "must not tear the call down");
        assert!(v["content"][0]["text"].as_str().unwrap().contains("no unit"));
    }

    #[tokio::test]
    async fn an_unknown_tool_is_refused_by_name() {
        let r = server()
            .handle(req(1, "tools/call", json!({ "name": "delete_everything" })), t(0))
            .await
            .unwrap();
        assert!(r.error.unwrap().message.contains("delete_everything"));
    }
}
