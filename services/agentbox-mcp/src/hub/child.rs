//! One stdio MCP child, started lazily, initialised once, shared by every
//! hub client. Requests are multiplexed by remapping ids onto a hub counter.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, OnceCell};
use tracing::{debug, info, warn};

use super::config::ServerSpec;
use super::rpc;

const INIT_TIMEOUT: Duration = Duration::from_secs(90);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
/// Protocol version the hub speaks to its children.
const HUB_PROTOCOL_VERSION: &str = "2025-06-18";

/// The live child and its plumbing. Shared between the request path and the
/// stdout reader task; every field is interior-mutable so the struct is built
/// once and never rebuilt.
struct Running {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    init_result: OnceCell<Value>,
    alive: AtomicBool,
    process: Mutex<Child>,
}

impl Running {
    async fn send(&self, msg: &Value) -> anyhow::Result<()> {
        let mut line = serde_json::to_string(msg)?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Sends a request with a fresh hub id and awaits the reply.
    async fn call(&self, mut msg: Value, timeout: Duration) -> anyhow::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if let Some(obj) = msg.as_object_mut() {
            obj.insert("id".into(), json!(id));
        }
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        if let Err(e) = self.send(&msg).await {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err(anyhow::anyhow!("child exited before replying")),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(anyhow::anyhow!(
                    "child did not reply within {}s",
                    timeout.as_secs()
                ))
            }
        }
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

/// A configured server: spawned on demand, restarted on the next request
/// after it dies.
pub struct ChildServer {
    pub name: String,
    spec: ServerSpec,
    running: Mutex<Option<Arc<Running>>>,
    requests: AtomicU64,
    restarts: AtomicU64,
}

impl ChildServer {
    pub fn new(name: String, spec: ServerSpec) -> Self {
        Self {
            name,
            spec,
            running: Mutex::new(None),
            requests: AtomicU64::new(0),
            restarts: AtomicU64::new(0),
        }
    }

    /// The running, initialised child — spawning it if needed. The slot lock
    /// is held across spawn + initialise so concurrent first requests share
    /// one child instead of racing to start several.
    async fn ensure(&self) -> anyhow::Result<Arc<Running>> {
        let mut slot = self.running.lock().await;
        if let Some(r) = slot.as_ref() {
            if r.is_alive() {
                return Ok(r.clone());
            }
            self.restarts.fetch_add(1, Ordering::Relaxed);
            warn!(server = %self.name, "child is gone; respawning");
        }
        let r = self.spawn().await?;
        *slot = Some(r.clone());
        Ok(r)
    }

    async fn spawn(&self) -> anyhow::Result<Arc<Running>> {
        let mut cmd = Command::new(&self.spec.command);
        cmd.args(&self.spec.args)
            .envs(&self.spec.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        if let Some(cwd) = &self.spec.cwd {
            cmd.current_dir(cwd);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| anyhow::anyhow!("spawn {}: {e}", self.spec.command))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        info!(server = %self.name, pid = ?child.id(), "spawned");

        let running = Arc::new(Running {
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            init_result: OnceCell::new(),
            alive: AtomicBool::new(true),
            process: Mutex::new(child),
        });

        // Reader: route replies to waiters, answer server-initiated requests
        // with an error, drop notifications. Owns a clone of the same Arc the
        // request path uses, so `pending` and `alive` are shared.
        let reader = running.clone();
        let name = self.name.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Ok(msg) = serde_json::from_str::<Value>(line) else {
                    debug!(server = %name, "non-JSON line from child: {line}");
                    continue;
                };
                if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                    if rpc::is_response_to(&msg, id) {
                        if let Some(tx) = reader.pending.lock().await.remove(&id) {
                            let _ = tx.send(msg);
                        }
                        continue;
                    }
                }
                let has_id = msg.get("id").map(|v| !v.is_null()).unwrap_or(false);
                if msg.get("method").is_some() && has_id {
                    let reply = rpc::error_response(
                        msg["id"].clone(),
                        -32601,
                        "agentbox-mcp hub does not route server-initiated requests",
                    );
                    let _ = reader.send(&reply).await;
                    continue;
                }
                debug!(server = %name, method = ?msg.get("method"), "child notification dropped");
            }
            reader.alive.store(false, Ordering::Relaxed);
            let mut pending = reader.pending.lock().await;
            for (_, tx) in pending.drain() {
                let _ = tx.send(rpc::error_response(Value::Null, -32000, "child exited"));
            }
            warn!(server = %name, "child stdout closed");
        });

        // Initialise once, on behalf of every future client.
        let init = json!({
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": HUB_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "agentbox-mcp-hub", "version": env!("CARGO_PKG_VERSION")}
            }
        });
        let reply = running.call(init, INIT_TIMEOUT).await?;
        let result = reply.get("result").cloned().ok_or_else(|| {
            anyhow::anyhow!(
                "initialize error: {}",
                reply.get("error").cloned().unwrap_or(Value::Null)
            )
        })?;
        running
            .send(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            .await?;
        let _ = running.init_result.set(result);
        info!(server = %self.name, "initialised");
        Ok(running)
    }

    /// The child's `initialize` result (capabilities, serverInfo, protocolVersion).
    pub async fn initialize_result(&self) -> anyhow::Result<Value> {
        let r = self.ensure().await?;
        Ok(r.init_result.get().cloned().unwrap_or(Value::Null))
    }

    /// Forwards a notification.
    pub async fn notify(&self, msg: &Value) -> anyhow::Result<()> {
        self.ensure().await?.send(msg).await
    }

    /// Forwards a request; the reply carries the hub's id, which the caller
    /// swaps back for the client's.
    pub async fn request(&self, msg: &Value) -> anyhow::Result<Value> {
        self.requests.fetch_add(1, Ordering::Relaxed);
        let r = self.ensure().await?;
        r.call(msg.clone(), REQUEST_TIMEOUT).await
    }

    pub async fn status(&self) -> Value {
        let slot = self.running.lock().await;
        let running = slot.as_ref().map(|r| r.is_alive()).unwrap_or(false);
        json!({
            "running": running,
            "requests": self.requests.load(Ordering::Relaxed),
            "restarts": self.restarts.load(Ordering::Relaxed),
            "command": self.spec.command,
        })
    }

    pub async fn shutdown(&self) {
        let mut slot = self.running.lock().await;
        if let Some(r) = slot.take() {
            let mut p = r.process.lock().await;
            let _ = p.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), p.wait()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A shell-script MCP server: answers initialize, echoes `ping`, issues
    /// one server-initiated request, and exits on `quit`.
    fn fake_server() -> ServerSpec {
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"0"}}}\n' "$id" ;;
    *'"method":"notifications/initialized"'*) printf '{"jsonrpc":"2.0","id":99,"method":"roots/list","params":{}}\n' ;;
    *'"method":"ping"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"pong":true}}\n' "$id" ;;
    *'"method":"slow"'*) sleep 1; printf '{"jsonrpc":"2.0","id":%s,"result":{"slow":true}}\n' "$id" ;;
    *'"method":"quit"'*) exit 0 ;;
    *) ;;
  esac
done
"#;
        ServerSpec {
            command: "sh".into(),
            args: vec!["-c".into(), script.into()],
            env: Default::default(),
            cwd: None,
        }
    }

    #[tokio::test]
    async fn initialises_once_and_multiplexes_requests() {
        let s = ChildServer::new("fake".into(), fake_server());
        let init = s.initialize_result().await.unwrap();
        assert_eq!(init["serverInfo"]["name"], "fake");

        // Concurrent requests with colliding client ids are kept apart by the hub ids.
        let slow = json!({"jsonrpc": "2.0", "id": 1, "method": "slow"});
        let ping = json!({"jsonrpc": "2.0", "id": 1, "method": "ping"});
        let a = s.request(&slow);
        let b = s.request(&ping);
        let (ra, rb) = tokio::join!(a, b);
        assert_eq!(ra.unwrap()["result"]["slow"], true);
        assert_eq!(rb.unwrap()["result"]["pong"], true);

        let st = s.status().await;
        assert_eq!(st["running"], true);
        assert_eq!(st["requests"], 2);
        assert_eq!(st["restarts"], 0);
        s.shutdown().await;
        assert_eq!(s.status().await["running"], false);
    }

    #[tokio::test]
    async fn respawns_after_child_exit() {
        let s = ChildServer::new("fake".into(), fake_server());
        s.initialize_result().await.unwrap();
        s.notify(&json!({"jsonrpc": "2.0", "method": "quit"}))
            .await
            .unwrap();
        // Give the reader a moment to observe EOF.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(s.status().await["running"], false);
        let r = s
            .request(&json!({"jsonrpc": "2.0", "id": "x", "method": "ping"}))
            .await
            .unwrap();
        assert_eq!(r["result"]["pong"], true);
        assert_eq!(s.status().await["restarts"], 1);
        s.shutdown().await;
    }

    #[tokio::test]
    async fn spawn_failure_is_an_error_not_a_panic() {
        let s = ChildServer::new(
            "missing".into(),
            ServerSpec {
                command: "/nonexistent/agentbox-no-such-binary".into(),
                args: vec![],
                env: Default::default(),
                cwd: None,
            },
        );
        assert!(s.initialize_result().await.is_err());
        assert_eq!(s.status().await["running"], false);
    }
}
