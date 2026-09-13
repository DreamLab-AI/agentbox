//! A real MCP client over stdio.
//!
//! The shared tier's store is RuVector, and the estate's rule for RuVector is
//! absolute: **writes go through the governed memory MCP server, never through
//! raw SQL.** The server owns the embedding pipeline; a row inserted around it
//! is invisible to HNSW search, which is a silent failure rather than a loud
//! one.
//!
//! So this is not a database client. It spawns the same
//! `mcp/servers/ruvector-mcp.cjs` process the rest of the estate talks to, and
//! speaks newline-delimited JSON-RPC 2.0 to it — the identical transport, the
//! identical gates, the identical protected-namespace checks.
//!
//! Requests are serialised behind one lock. The server is a single-threaded
//! Node process reading a line at a time; interleaving two requests on its stdin
//! would be a framing bug, not a concurrency win.

use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// Why a call to the MCP child failed.
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    /// The child could not be spawned or has died.
    #[error("MCP child process: {0}")]
    Process(String),
    /// The transport failed mid-request.
    #[error("MCP transport: {0}")]
    Transport(String),
    /// The server answered with a JSON-RPC error.
    #[error("MCP server error {code}: {message}")]
    Rpc {
        /// JSON-RPC error code.
        code: i64,
        /// The server's message.
        message: String,
    },
    /// The tool reported failure through `isError` or a `success: false` body.
    #[error("tool `{tool}` failed: {detail}")]
    Tool {
        /// Which tool.
        tool: String,
        /// What it said.
        detail: String,
    },
    /// The answer did not have the shape the caller needs.
    #[error("unexpected response from `{tool}`: {detail}")]
    Shape {
        /// Which tool.
        tool: String,
        /// What was wrong.
        detail: String,
    },
}

/// The MCP protocol revision this client requests.
pub const CLIENT_PROTOCOL_VERSION: &str = "2025-06-18";

struct Pipe {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: i64,
}

/// A live MCP server, spawned as a child process.
#[derive(Debug)]
pub struct McpStdioClient {
    pipe: Mutex<Pipe>,
    #[allow(dead_code)]
    child: Child,
    name: String,
}

impl std::fmt::Debug for Pipe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pipe").field("next_id", &self.next_id).finish()
    }
}

impl McpStdioClient {
    /// Spawn a server and complete the MCP handshake.
    ///
    /// `env` entries are applied on top of the inherited environment, which is
    /// what lets a caller pass the same `RUVECTOR_*` variables `.mcp.json`
    /// carries without reconstructing the whole environment.
    pub async fn spawn(
        name: &str,
        program: &str,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<Self, McpError> {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // The server logs to stderr; inheriting keeps those lines in the
            // supervisor's log rather than silently filling a pipe buffer and
            // deadlocking the child once it fills.
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        for (k, v) in env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn().map_err(|e| McpError::Process(e.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::Process("no stdin pipe".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::Process("no stdout pipe".into()))?;

        let client = Self {
            pipe: Mutex::new(Pipe {
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 0,
            }),
            child,
            name: name.to_string(),
        };

        client
            .request(
                "initialize",
                json!({
                    "protocolVersion": CLIENT_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "colloquy-backends", "version": env!("CARGO_PKG_VERSION") },
                }),
            )
            .await?;
        client.notify("notifications/initialized", json!({})).await?;
        Ok(client)
    }

    /// Send a notification, which takes no reply.
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), McpError> {
        let line = serde_json::to_string(&json!({
            "jsonrpc": "2.0", "method": method, "params": params
        }))
        .map_err(|e| McpError::Transport(e.to_string()))?;
        let mut pipe = self.pipe.lock().await;
        write_line(&mut pipe.stdin, &line).await
    }

    /// Send a request and wait for its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, McpError> {
        let mut pipe = self.pipe.lock().await;
        pipe.next_id += 1;
        let id = pipe.next_id;

        let line = serde_json::to_string(&json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        }))
        .map_err(|e| McpError::Transport(e.to_string()))?;
        write_line(&mut pipe.stdin, &line).await?;

        // Read until the response with our id arrives. A well-behaved server
        // interleaves nothing here, but a log line written to stdout by mistake
        // must skip rather than desynchronise the stream for every later call.
        loop {
            let mut buf = String::new();
            let n = pipe
                .stdout
                .read_line(&mut buf)
                .await
                .map_err(|e| McpError::Transport(e.to_string()))?;
            if n == 0 {
                return Err(McpError::Process(format!(
                    "`{}` closed stdout before answering {method}",
                    self.name
                )));
            }
            let Ok(v) = serde_json::from_str::<Value>(buf.trim()) else {
                continue;
            };
            if v.get("id").and_then(Value::as_i64) != Some(id) {
                continue;
            }
            if let Some(e) = v.get("error") {
                return Err(McpError::Rpc {
                    code: e.get("code").and_then(Value::as_i64).unwrap_or(0),
                    message: e
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                });
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// Call a tool and parse its text content back into JSON.
    ///
    /// MCP tool results are a content array of text parts, and every server in
    /// this estate puts a JSON document in the first part. A tool that set
    /// `isError` is surfaced as [`McpError::Tool`] rather than returned as data:
    /// a caller that treats an error body as a result is how a store starts
    /// reporting successful writes that did not happen.
    pub async fn call_tool(&self, tool: &str, args: Value) -> Result<Value, McpError> {
        let result = self
            .request("tools/call", json!({ "name": tool, "arguments": args }))
            .await?;

        let text = result
            .get("content")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .and_then(|p| p.get("text"))
            .and_then(Value::as_str)
            .ok_or_else(|| McpError::Shape {
                tool: tool.to_string(),
                detail: "no text content part".into(),
            })?;

        let is_error = result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if is_error {
            return Err(McpError::Tool {
                tool: tool.to_string(),
                detail: text.to_string(),
            });
        }

        let parsed: Value = serde_json::from_str(text).map_err(|e| McpError::Shape {
            tool: tool.to_string(),
            detail: format!("content is not JSON: {e}"),
        })?;

        // The memory tools report failure in the body, not through isError.
        if parsed.get("success") == Some(&Value::Bool(false)) {
            return Err(McpError::Tool {
                tool: tool.to_string(),
                detail: parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("no error message")
                    .to_string(),
            });
        }
        Ok(parsed)
    }
}

async fn write_line(stdin: &mut ChildStdin, line: &str) -> Result<(), McpError> {
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| McpError::Transport(e.to_string()))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| McpError::Transport(e.to_string()))?;
    stdin
        .flush()
        .await
        .map_err(|e| McpError::Transport(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server implemented as a shell one-liner, not a mock object: these tests
    /// drive the same code path production does, over a real pipe to a real
    /// child process.
    async fn echo_server(script: &str) -> Result<McpStdioClient, McpError> {
        McpStdioClient::spawn(
            "test",
            "sh",
            &["-c".to_string(), script.to_string()],
            &[],
        )
        .await
    }

    /// Answers `initialize`, then every `tools/call`, with a fixed body.
    const SCRIPT: &str = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  [ -z "$id" ] && continue
  case "$line" in
    *initialize*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18"}}\n' "$id" ;;
    *boom*)       printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"exploded"}}\n' "$id" ;;
    *iserror*)    printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"nope"}],"isError":true}}\n' "$id" ;;
    *unsuccess*)  printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"write-protected\\"}"}]}}\n' "$id" ;;
    *notjson*)    printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"hello"}]}}\n' "$id" ;;
    *)            printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"value\\":42}"}]}}\n' "$id" ;;
  esac
done
"#;

    #[tokio::test]
    async fn a_real_child_process_completes_the_handshake_and_answers() {
        let c = echo_server(SCRIPT).await.unwrap();
        let v = c.call_tool("memory_store", json!({})).await.unwrap();
        assert_eq!(v["value"], json!(42));
    }

    #[tokio::test]
    async fn a_jsonrpc_error_is_surfaced_with_its_code() {
        let c = echo_server(SCRIPT).await.unwrap();
        let e = c.call_tool("boom", json!({})).await.unwrap_err();
        assert!(matches!(e, McpError::Rpc { code: -32603, .. }), "{e}");
    }

    #[tokio::test]
    async fn is_error_content_is_an_error_not_a_result() {
        let c = echo_server(SCRIPT).await.unwrap();
        let e = c.call_tool("iserror", json!({})).await.unwrap_err();
        assert!(matches!(e, McpError::Tool { .. }), "{e}");
    }

    #[tokio::test]
    async fn a_success_false_body_is_an_error_too() {
        // The memory tools report a write-protected namespace this way, and
        // reading it as success is how a store claims writes it never made.
        let c = echo_server(SCRIPT).await.unwrap();
        let e = c.call_tool("unsuccess", json!({})).await.unwrap_err();
        assert!(e.to_string().contains("write-protected"), "{e}");
    }

    #[tokio::test]
    async fn non_json_content_is_a_shape_error() {
        let c = echo_server(SCRIPT).await.unwrap();
        let e = c.call_tool("notjson", json!({})).await.unwrap_err();
        assert!(matches!(e, McpError::Shape { .. }), "{e}");
    }

    #[tokio::test]
    async fn a_server_that_dies_is_reported_not_hung() {
        let c = McpStdioClient::spawn("dead", "sh", &["-c".into(), "exit 0".into()], &[]).await;
        assert!(matches!(c, Err(McpError::Process(_))), "expected a spawn-time failure");
    }

    #[tokio::test]
    async fn stray_stdout_noise_does_not_desynchronise_the_stream() {
        let noisy = format!("echo 'a log line that is not json'\n{SCRIPT}");
        let c = echo_server(&noisy).await.unwrap();
        assert_eq!(c.call_tool("x", json!({})).await.unwrap()["value"], json!(42));
    }
}
