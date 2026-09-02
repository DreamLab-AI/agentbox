//! `mcp-call` — minimal stdio JSON-RPC 2.0 client for the code-interpreter MCP.
//!
//! Replaces `tests/code-harness/lib/mcp_call.py`, which was a Python *class*
//! that `tests/code-harness/*.sh` loaded through `importlib`. A Rust library
//! cannot be imported that way, so the port exposes the same capability as a
//! CLI: a script of steps executed against one long-lived server process, so
//! kernel state still persists across turns (ADR-018 A2 / PRD-008 A2).
//!
//! Usage:
//!   mcp-call --script steps.json         # or `-` for stdin
//!   mcp-call call kernel.exec --args '{"code": "print(1)"}'
//!
//! Step forms:
//!   {"id": "s1", "tool": "kernel.exec", "arguments": {...}, "timeout": 90}
//!   {"id": "s1", "tool": "...", "background": true}   # dispatch, do not wait
//!   {"op": "await", "id": "s1"}                       # collect a background step
//!   {"op": "sleep", "seconds": 1.5}
//!
//! Output: `{"results": {<id>: <tool result>, ...}, "errors": {<id>: "..."}}`.
//!
//! `MCP_SERVER_CMD` overrides the server command.

use agentbox_ops::pyjson;
use clap::{Parser, Subcommand};
use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

const DEFAULT_CMD: &str = "python3 -u /opt/agentbox/mcp/code-interpreter/server.py";
const DEFAULT_WHEELHOUSE: &str = "/var/lib/agentbox/code-interpreter-wheelhouse";

#[derive(Parser)]
#[command(
    name = "mcp-call",
    about = "Minimal stdio JSON-RPC client for an MCP server"
)]
struct Args {
    /// Step script path, or `-` for stdin.
    #[arg(long)]
    script: Option<String>,
    /// Server command (overrides MCP_SERVER_CMD).
    #[arg(long = "server-cmd")]
    server_cmd: Option<String>,
    #[command(subcommand)]
    command: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Call one tool and print its result.
    Call {
        tool: String,
        #[arg(long, default_value = "{}")]
        args: String,
        #[arg(long, default_value_t = 60.0)]
        timeout: f64,
    },
    /// List the server's tools.
    ListTools,
}

/// One MCP server subprocess plus its JSON-RPC framing.
///
/// Requests are multiplexed by id over the single stdio pair, so a
/// long-running call can be left in flight while another request is sent —
/// which is what the interrupt test needs, and why a background step must
/// never open a second server process (that would be a different kernel).
struct Client {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    next_id: i64,
    /// Responses read while waiting for a different id.
    stashed: Vec<Value>,
}

impl Client {
    fn start(cmd_line: &str) -> Result<Self, String> {
        let parts = shell_split(cmd_line);
        let (program, rest) = parts.split_first().ok_or("empty server command")?;

        let mut child = Command::new(program)
            .args(rest)
            .env(
                "KERNEL_WHEELHOUSE",
                std::env::var("KERNEL_WHEELHOUSE").unwrap_or_else(|_| DEFAULT_WHEELHOUSE.into()),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("cannot start MCP server `{program}`: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin on MCP server")?;
        let stdout = child.stdout.take().ok_or("no stdout on MCP server")?;
        let mut client = Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
            next_id: 0,
            stashed: Vec::new(),
        };

        let resp = client.rpc(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp_call_test", "version": "0.1.0"}
            }),
            Duration::from_secs(60),
        )?;
        if let Some(err) = resp.get("error") {
            return Err(format!("MCP initialize failed: {err}"));
        }
        client.notify("notifications/initialized", json!({}))?;
        std::thread::sleep(Duration::from_millis(100));
        Ok(client)
    }

    fn send(&mut self, obj: &Value) -> Result<(), String> {
        writeln!(
            self.stdin,
            "{}",
            serde_json::to_string(obj).map_err(|e| e.to_string())?
        )
        .map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({"jsonrpc": "2.0", "method": method, "params": params}))
    }

    /// Writes a request and returns its id without waiting for the reply.
    fn send_request(&mut self, method: &str, params: Value) -> Result<i64, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))?;
        Ok(id)
    }

    /// Reads until the reply carrying `id` arrives, stashing any others so a
    /// call left in flight can still be collected later.
    fn await_id(&mut self, id: i64, timeout: Duration) -> Result<Value, String> {
        if let Some(pos) = self
            .stashed
            .iter()
            .position(|r| r.get("id").and_then(Value::as_i64) == Some(id))
        {
            return Ok(self.stashed.remove(pos));
        }
        let deadline = Instant::now() + timeout;
        loop {
            if Instant::now() >= deadline {
                return Err(format!("No response within {:.0}s", timeout.as_secs_f64()));
            }
            let mut line = String::new();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("MCP server closed its stdout".into());
            }
            let Ok(resp) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if resp.get("id").and_then(Value::as_i64) == Some(id) {
                return Ok(resp);
            }
            self.stashed.push(resp);
        }
    }

    /// Sends a request and waits for its reply.
    fn rpc(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.send_request(method, params)?;
        self.await_id(id, timeout)
    }

    /// Dispatches a tool call without waiting; returns its request id.
    fn dispatch(&mut self, tool: &str, arguments: Value) -> Result<i64, String> {
        self.send_request("tools/call", json!({"name": tool, "arguments": arguments}))
    }

    /// Waits for a dispatched call and unwraps its first text content item.
    fn collect_result(&mut self, id: i64, tool: &str, timeout: Duration) -> Result<Value, String> {
        let resp = self.await_id(id, timeout)?;
        if let Some(err) = resp.get("error") {
            return Err(format!("RPC error calling {tool}: {err}"));
        }
        let result = resp.get("result").cloned().unwrap_or_else(|| json!({}));
        if result.pointer("/content/0/type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = result.pointer("/content/0/text").and_then(Value::as_str) {
                return serde_json::from_str(text).map_err(|e| e.to_string());
            }
        }
        Ok(result)
    }

    /// Calls a tool and unwraps the first text content item as JSON.
    fn call(&mut self, tool: &str, arguments: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.dispatch(tool, arguments)?;
        self.collect_result(id, tool, timeout)
    }

    fn list_tools(&mut self) -> Result<Value, String> {
        let resp = self.rpc("tools/list", json!({}), Duration::from_secs(60))?;
        Ok(resp
            .pointer("/result/tools")
            .cloned()
            .unwrap_or_else(|| json!([])))
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Splits a command line on whitespace, honouring single and double quotes.
fn shell_split(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '\'' | '"') => quote = Some(c),
            (None, c) if c.is_whitespace() => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn server_cmd(explicit: Option<String>) -> String {
    explicit
        .or_else(|| std::env::var("MCP_SERVER_CMD").ok())
        .unwrap_or_else(|| DEFAULT_CMD.to_string())
}

fn read_script(source: &str) -> Result<Vec<Value>, String> {
    let text = if source == "-" {
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| e.to_string())?;
        buf
    } else {
        std::fs::read_to_string(source).map_err(|e| e.to_string())?
    };
    serde_json::from_str::<Value>(&text)
        .map_err(|e| e.to_string())?
        .as_array()
        .cloned()
        .ok_or_else(|| "script must be a JSON array of steps".to_string())
}

/// Runs the step script against one server session.
fn run_script(steps: &[Value], cmd: &str) -> i32 {
    let mut client = match Client::start(cmd) {
        Ok(c) => c,
        Err(e) => {
            pyjson::println_json(&json!({"results": {}, "errors": {"_startup": e}}));
            return 1;
        }
    };

    let mut results = Map::new();
    let mut errors = Map::new();
    // Dispatched-but-not-collected background steps: (id, request id, tool, timeout).
    let mut pending: Vec<(String, i64, String, Duration)> = Vec::new();

    for step in steps {
        match step.get("op").and_then(Value::as_str) {
            Some("sleep") => {
                let secs = step.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
                std::thread::sleep(Duration::from_secs_f64(secs));
                continue;
            }
            Some("await") => {
                let want = step.get("id").and_then(Value::as_str).unwrap_or("");
                if let Some(pos) = pending.iter().position(|(sid, ..)| sid == want) {
                    let (sid, req_id, tool, timeout) = pending.remove(pos);
                    match client.collect_result(req_id, &tool, timeout) {
                        Ok(v) => {
                            results.insert(sid, v);
                        }
                        Err(e) => {
                            errors.insert(sid, json!(e));
                        }
                    }
                }
                continue;
            }
            _ => {}
        }

        let Some(tool) = step.get("tool").and_then(Value::as_str) else {
            continue;
        };
        let id = step
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(tool)
            .to_string();
        let arguments = step.get("arguments").cloned().unwrap_or_else(|| json!({}));
        let timeout =
            Duration::from_secs_f64(step.get("timeout").and_then(Value::as_f64).unwrap_or(60.0));

        // A background step is dispatched on the SAME session and collected
        // later, so the kernel it touches is the one every other step sees.
        let req_id = match client.dispatch(tool, arguments) {
            Ok(r) => r,
            Err(e) => {
                errors.insert(id, json!(e));
                continue;
            }
        };

        if step
            .get("background")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            pending.push((id, req_id, tool.to_string(), timeout));
            continue;
        }

        match client.collect_result(req_id, tool, timeout) {
            Ok(v) => {
                results.insert(id, v);
            }
            Err(e) => {
                errors.insert(id, json!(e));
            }
        }
    }

    // Collect anything still outstanding.
    for (sid, req_id, tool, timeout) in pending {
        match client.collect_result(req_id, &tool, timeout) {
            Ok(v) => {
                results.insert(sid, v);
            }
            Err(e) => {
                errors.insert(sid, json!(e));
            }
        }
    }

    let failed = !errors.is_empty();
    pyjson::println_json(&json!({"results": results, "errors": errors}));
    i32::from(failed)
}

fn main() {
    let a = Args::parse();
    let cmd = server_cmd(a.server_cmd);

    match a.command {
        Some(Cmd::Call {
            tool,
            args,
            timeout,
        }) => {
            let arguments: Value = match serde_json::from_str(&args) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("--args is not valid JSON: {e}");
                    std::process::exit(2);
                }
            };
            match Client::start(&cmd)
                .and_then(|mut c| c.call(&tool, arguments, Duration::from_secs_f64(timeout)))
            {
                Ok(v) => println!("{}", pyjson::dumps(&v)),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
        }
        Some(Cmd::ListTools) => match Client::start(&cmd).and_then(|mut c| c.list_tools()) {
            Ok(v) => println!("{}", pyjson::dumps_indent(&v, 2)),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        },
        None => {
            let Some(script) = a.script else {
                eprintln!("Provide --script <file|-> or the `call` subcommand.");
                std::process::exit(2);
            };
            match read_script(&script) {
                Ok(steps) => std::process::exit(run_script(&steps, &cmd)),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(2);
                }
            }
        }
    }
}
