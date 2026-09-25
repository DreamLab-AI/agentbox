//! The shared tier's real backend: RuVector, through the governed memory server.
//!
//! Four tool calls, one each. The mapping is thin on purpose — everything
//! interesting about the shared tier lives in `colloquy_store::SharedStore`,
//! which is testable without a database; this file is the part that cannot be.
//!
//! # Why a child process and not a database connection
//!
//! Writing to `memory_entries` directly would work, right up until it did not:
//! the governed server owns the embedding call, and a row inserted around it is
//! stored, returned by key, and **invisible to every semantic search** — a
//! failure with no error and no symptom until someone notices retrieval has
//! quietly got worse. The estate's rule is MCP-only, and this honours it rather
//! than optimising past it.

use async_trait::async_trait;
use serde_json::{json, Value};

use colloquy_store::VectorBackend;

use crate::mcp_client::{McpError, McpStdioClient};

/// The default governed memory server, as `.mcp.json` registers it.
pub const DEFAULT_SERVER: &str = "/opt/agentbox/mcp/servers/ruvector-mcp.cjs";

/// RuVector, reached through the governed memory MCP server.
#[derive(Debug)]
pub struct RuvectorBackend {
    client: McpStdioClient,
}

impl RuvectorBackend {
    /// Spawn the governed memory server.
    ///
    /// `env` should carry the same `RUVECTOR_*` variables the manifest projects
    /// into `.mcp.json` — `RUVECTOR_PG_CONNINFO`, `XINFERENCE_ENDPOINT`,
    /// `EMBEDDING_MODEL`, `NODE_PATH`. They are applied over the inherited
    /// environment, so a supervised process that already has them can pass an
    /// empty slice.
    pub async fn spawn(server_js: &str, env: &[(String, String)]) -> Result<Self, McpError> {
        let client =
            McpStdioClient::spawn("ruvector-mcp", "node", &[server_js.to_string()], env).await?;
        Ok(Self { client })
    }

    /// Wrap an already-running client, for a caller that shares one server
    /// across several consumers.
    pub fn with_client(client: McpStdioClient) -> Self {
        Self { client }
    }

    /// Read every `RUVECTOR_*` and embedding variable out of the current
    /// environment, to forward to the child.
    ///
    /// A supervised process inherits these from the entrypoint; forwarding them
    /// explicitly means the child behaves the same whether it was spawned from
    /// a supervisor or a shell.
    pub fn env_from_process() -> Vec<(String, String)> {
        std::env::vars()
            .filter(|(k, _)| {
                k.starts_with("RUVECTOR_")
                    || k == "XINFERENCE_ENDPOINT"
                    || k == "EMBEDDING_MODEL"
                    || k == "NODE_PATH"
            })
            .collect()
    }
}

/// Pull `results` out of a `memory_search` answer.
fn search_rows(v: &Value) -> Vec<(String, String, f64)> {
    v.get("results")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let key = r.get("key")?.as_str()?.to_string();
                    let value = value_as_string(r.get("value")?)?;
                    // `score` is the cosine similarity, already in 0..=1 on the
                    // HNSW path and a flat 0.5 on the degraded ILIKE fallback.
                    let score = r.get("score").and_then(Value::as_f64).unwrap_or(0.0);
                    Some((key, value, score))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The memory tools parse JSON values on the way out, so a payload that was
/// stored as a JSON document comes back as an object rather than a string.
/// Either shape has to round-trip to the same text.
fn value_as_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}

#[async_trait]
impl VectorBackend for RuvectorBackend {
    async fn upsert(
        &self,
        namespace: &str,
        key: &str,
        text: &str,
        payload: &str,
    ) -> Result<(), String> {
        // `memory_store` embeds `value`. The payload is the whole StoredUnit and
        // would blow past the model's window, so the *searchable* text is stored
        // under the unit's key and the payload under a sibling key. Retrieval by
        // key returns the payload whole; search matches the bounded text.
        self.client
            .call_tool(
                "memory_store",
                json!({ "key": key, "value": text, "namespace": namespace }),
            )
            .await
            .map_err(|e| e.to_string())?;
        self.client
            .call_tool(
                "memory_store",
                json!({ "key": payload_key(key), "value": payload, "namespace": namespace }),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get(&self, namespace: &str, key: &str) -> Result<Option<String>, String> {
        let v = self
            .client
            .call_tool(
                "memory_retrieve",
                json!({ "key": payload_key(key), "namespace": namespace }),
            )
            .await
            .map_err(|e| e.to_string())?;
        if v.get("found") == Some(&Value::Bool(false)) {
            return Ok(None);
        }
        Ok(v.get("value").and_then(value_as_string))
    }

    async fn search(
        &self,
        namespace: &str,
        text: &str,
        limit: usize,
    ) -> Result<Vec<(String, String, f64)>, String> {
        // `min_score: 0` keeps every ranked hit: the server's default cosine
        // floor is tuned for a model reader, while colloquy applies its own
        // confidence arithmetic to the raw scores. Snippet values are fine here
        // because each hit's payload is fetched whole by key below.
        let v = self
            .client
            .call_tool(
                "memory_search",
                json!({ "query": text, "namespace": namespace, "limit": limit, "min_score": 0.0 }),
            )
            .await
            .map_err(|e| e.to_string())?;

        // Search matches the embedded text rows; the payload lives beside them,
        // so each hit needs its sibling fetched. Hits on a payload row itself
        // are dropped — they would duplicate their own unit.
        let mut out = Vec::new();
        for (key, _, score) in search_rows(&v) {
            if is_payload_key(&key) {
                continue;
            }
            if let Some(payload) = self.get(namespace, &key).await? {
                out.push((key, payload, score));
            }
        }
        Ok(out)
    }

    async fn list(&self, namespace: &str, limit: usize) -> Result<Vec<(String, String)>, String> {
        let v = self
            .client
            .call_tool(
                "memory_list",
                // Two rows per unit, so the ceiling has to be doubled or a
                // listing silently truncates to half the units it was asked for.
                json!({ "namespace": namespace, "limit": limit.saturating_mul(2) }),
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(v.get("entries")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| {
                        let key = r.get("key")?.as_str()?;
                        let payload = value_as_string(r.get("value")?)?;
                        is_payload_key(key).then(|| (unit_key(key).to_string(), payload))
                    })
                    .take(limit)
                    .collect()
            })
            .unwrap_or_default())
    }
}

/// Suffix marking the row that carries the full payload rather than the
/// embedded text.
const PAYLOAD_SUFFIX: &str = "::unit";

fn payload_key(key: &str) -> String {
    format!("{key}{PAYLOAD_SUFFIX}")
}

fn is_payload_key(key: &str) -> bool {
    key.ends_with(PAYLOAD_SUFFIX)
}

fn unit_key(payload_key: &str) -> &str {
    payload_key
        .strip_suffix(PAYLOAD_SUFFIX)
        .unwrap_or(payload_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_keys_round_trip_and_are_distinguishable() {
        let k = "ku_a1b2c3d4e5f6";
        let p = payload_key(k);
        assert!(is_payload_key(&p));
        assert!(!is_payload_key(k));
        assert_eq!(unit_key(&p), k);
    }

    #[test]
    fn search_rows_reads_the_governed_servers_shape() {
        let v = json!({
            "success": true, "action": "search", "namespace": "colloquy",
            "results": [
                { "key": "ku_aaa", "value": "text", "namespace": "colloquy", "score": 0.87 },
                { "key": "ku_bbb", "value": "text", "namespace": "colloquy", "score": 0.42 }
            ],
            "count": 2, "method": "hnsw-xinference"
        });
        let rows = search_rows(&v);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "ku_aaa");
        assert!((rows[0].2 - 0.87).abs() < 1e-9);
    }

    #[test]
    fn a_degraded_ilike_fallback_still_parses() {
        // The server reports `degraded: true` and a flat 0.5 score when
        // Xinference is down. That is a worse answer, not an unreadable one.
        let v = json!({
            "success": true, "results": [{ "key": "ku_x", "value": "t", "score": 0.5 }],
            "method": "ilike-fallback", "degraded": true
        });
        assert_eq!(search_rows(&v)[0].2, 0.5);
    }

    #[test]
    fn a_value_stored_as_json_comes_back_as_text_either_way() {
        assert_eq!(value_as_string(&json!("plain")).as_deref(), Some("plain"));
        assert_eq!(
            value_as_string(&json!({ "a": 1 })).as_deref(),
            Some(r#"{"a":1}"#)
        );
        assert_eq!(value_as_string(&Value::Null), None);
    }

    #[test]
    fn an_empty_result_set_is_empty_not_an_error() {
        assert!(search_rows(&json!({ "success": true, "results": [] })).is_empty());
        assert!(search_rows(&json!({ "success": true })).is_empty());
    }
}
