//! Outbound calls made by the Voyager gate: the RuVector MCP bridge, the
//! code-interpreter kernel, and the two Python `ast` helpers.
//!
//! Every RuVector write goes through `claude-flow mcp call` — never raw SQL,
//! never the `claude-flow memory *` CLI (ADR-015).

use crate::pyjson;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const SKILLS_NAMESPACE: &str = "code-harness-skills";
pub const REJECTED_NAMESPACE: &str = "code-harness-skills-rejected";
pub const ACTIVITIES_NAMESPACE: &str = "code-harness-activities";

#[derive(Debug, Serialize)]
pub struct StorePayload {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub source_type: String,
    pub upsert: bool,
}

fn mcp_call(
    tool: &str,
    payload: &str,
    timeout_hint: u64,
) -> Result<std::process::Output, std::io::Error> {
    let _ = timeout_hint;
    Command::new("claude-flow")
        .args(["mcp", "call", tool, payload])
        .output()
}

/// Writes one record to RuVector. Dry runs print the payload instead.
pub fn memory_store(payload: &StorePayload, dry_run: bool) -> bool {
    if dry_run {
        pyjson::println_json(&json!({ "DRY_RUN_memory_store": payload }));
        return true;
    }
    match mcp_call("mcp__ruvector__memory_store", &pyjson::dumps(payload), 30) {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            pyjson::eprintln_json(&json!({
                "event": "RuVectorWriteFailed",
                "namespace": payload.namespace,
                "stderr": String::from_utf8_lossy(&out.stderr).chars().take(500).collect::<String>(),
            }));
            false
        }
        Err(err) => {
            pyjson::eprintln_json(&json!({
                "event": "RuVectorWriteException", "error": err.to_string(),
            }));
            false
        }
    }
}

/// Semantic search over a namespace. Any failure yields no results, matching
/// the Python original's deliberately quiet behaviour.
pub fn memory_search(namespace: &str, query: &str, limit: u32, dry_run: bool) -> Vec<Value> {
    if dry_run {
        return Vec::new();
    }
    let payload = pyjson::dumps(&json!({"namespace": namespace, "query": query, "limit": limit}));
    let Ok(out) = mcp_call("mcp__ruvector__memory_search", &payload, 30) else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    serde_json::from_slice::<Value>(&out.stdout)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

/// Fetches one record by key.
pub fn memory_retrieve(key: &str, namespace: &str, dry_run: bool) -> Option<Value> {
    if dry_run {
        return None;
    }
    let payload = pyjson::dumps(&json!({"key": key, "namespace": namespace}));
    let out = mcp_call("mcp__ruvector__memory_retrieve", &payload, 30).ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice::<Value>(&out.stdout).ok()
}

/// Executes code in the code-interpreter kernel.
pub fn kernel_exec(code: &str, timeout_s: u64, dry_run: bool) -> Value {
    if dry_run {
        return json!({
            "stdout": "", "stderr": "", "result": null,
            "exception": null, "duration_ms": 0, "cell_id": 0
        });
    }
    let payload = pyjson::dumps(&json!({"code": code, "timeout_s": timeout_s}));
    match mcp_call(
        "mcp__code_interpreter__kernel_exec",
        &payload,
        timeout_s + 10,
    ) {
        Ok(out) if out.status.success() => {
            serde_json::from_slice(&out.stdout).unwrap_or_else(|_| json!({}))
        }
        Ok(out) => json!({"exception": {
            "type": "MCPError",
            "message": String::from_utf8_lossy(&out.stderr).chars().take(500).collect::<String>(),
            "traceback": ""
        }}),
        Err(err) => json!({"exception": {
            "type": "InvocationError", "message": err.to_string(), "traceback": ""
        }}),
    }
}

/// Resets the kernel so verification starts from a clean namespace.
pub fn kernel_reset(dry_run: bool) -> bool {
    if dry_run {
        return true;
    }
    mcp_call("mcp__code_interpreter__kernel_reset", "{}", 15)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Python `ast` helpers
// ---------------------------------------------------------------------------
//
// These are the only places this crate shells out to python3, and deliberately
// so: both need CPython's own parser to reason about untrusted Python source.

/// Resolves `sandbox_check.py` given an explicit override, falling back to the
/// image location and then the source checkout. Pure, so it is testable
/// without mutating process-wide environment.
pub fn sandbox_check_path_from(override_path: Option<&str>) -> PathBuf {
    if let Some(p) = override_path.filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    for root in [
        "/opt/agentbox/mcp",
        "/home/devuser/workspace/project/agentbox/mcp",
    ] {
        let candidate = Path::new(root)
            .join("code-interpreter")
            .join("sandbox_check.py");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("/opt/agentbox/mcp/code-interpreter/sandbox_check.py")
}

/// Locates `sandbox_check.py`, reused from `mcp/code-interpreter/`.
/// `VOYAGER_SANDBOX_CHECK` overrides the search.
pub fn sandbox_check_path() -> PathBuf {
    sandbox_check_path_from(std::env::var("VOYAGER_SANDBOX_CHECK").ok().as_deref())
}

/// Outcome of the static AST scan.
pub struct StaticScan {
    pub exit_code: i32,
    pub payload: Value,
}

/// Runs `sandbox_check.py` over a candidate body via a temporary file.
pub fn run_sandbox_check(script: &Path, body_python: &str) -> Result<StaticScan, String> {
    let dir = std::env::temp_dir();
    let tmp = dir.join(format!(
        "voyager-candidate-{}-{}.py",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&tmp, body_python).map_err(|e| e.to_string())?;

    let result = Command::new("python3").arg(script).arg(&tmp).output();
    let _ = std::fs::remove_file(&tmp);

    let out = result.map_err(|e| format!("sandbox_check.py invocation failed: {e}"))?;
    let payload = serde_json::from_slice::<Value>(&out.stdout).unwrap_or_else(|_| json!({}));
    Ok(StaticScan {
        exit_code: out.status.code().unwrap_or(-1),
        payload,
    })
}

/// First top-level function name in the source, via CPython's `ast`.
///
/// This mirrors the original's `ast.walk` + `isinstance(node, ast.FunctionDef)`
/// exactly; a regex would disagree on decorated, nested, or string-embedded
/// definitions, and the result decides which function the examples call.
pub fn extract_fn_name(body_python: &str) -> Option<String> {
    const PROG: &str = "import ast,sys\n\
                        src=sys.stdin.read()\n\
                        try:\n\
                        \x20   tree=ast.parse(src)\n\
                        except SyntaxError:\n\
                        \x20   sys.exit(0)\n\
                        for node in ast.walk(tree):\n\
                        \x20   if isinstance(node, ast.FunctionDef):\n\
                        \x20       print(node.name); break\n";

    use std::io::Write;
    let mut child = Command::new("python3")
        .args(["-c", PROG])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    child
        .stdin
        .as_mut()?
        .write_all(body_python.as_bytes())
        .ok()?;
    let out = child.wait_with_output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dry_run_store_never_shells_out() {
        let payload = StorePayload {
            namespace: "ns".into(),
            key: "k".into(),
            value: "v".into(),
            source_type: "ex:Thing".into(),
            upsert: true,
        };
        assert!(memory_store(&payload, true));
    }

    #[test]
    fn dry_run_reads_return_nothing() {
        assert!(memory_search("ns", "q", 10, true).is_empty());
        assert!(memory_retrieve("k", "ns", true).is_none());
        assert!(kernel_reset(true));
    }

    #[test]
    fn a_dry_run_kernel_exec_reports_no_exception() {
        let r = kernel_exec("1 + 1", 30, true);
        assert!(r.get("exception").unwrap().is_null());
    }

    #[test]
    fn the_first_top_level_function_name_is_extracted() {
        assert_eq!(
            extract_fn_name("def solve(x):\n    return x\n").as_deref(),
            Some("solve")
        );
    }

    #[test]
    fn imports_and_comments_do_not_confuse_extraction() {
        let src = "import os\n# def decoy(x): pass\n\ndef real_one(a, b):\n    return a + b\n";
        assert_eq!(extract_fn_name(src).as_deref(), Some("real_one"));
    }

    #[test]
    fn source_without_a_function_yields_none() {
        assert_eq!(extract_fn_name("x = 1\n"), None);
    }

    #[test]
    fn unparseable_source_yields_none_rather_than_failing() {
        assert_eq!(extract_fn_name("def (:\n"), None);
    }

    #[test]
    fn an_explicit_override_wins_over_the_search_path() {
        assert_eq!(
            sandbox_check_path_from(Some("/tmp/nowhere/sandbox_check.py")),
            PathBuf::from("/tmp/nowhere/sandbox_check.py")
        );
    }

    #[test]
    fn an_empty_override_falls_back_to_the_search_path() {
        assert!(sandbox_check_path_from(Some("")).ends_with("sandbox_check.py"));
        assert!(sandbox_check_path_from(None).ends_with("sandbox_check.py"));
    }
}
