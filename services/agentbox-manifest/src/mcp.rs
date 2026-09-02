//! `.mcp.json` / `.claude.json` server-registration sites.
//!
//! These replace nine `python3 -c` blocks in `config/entrypoint-unified.sh`.
//! Two conventions from the shell are preserved exactly:
//!
//! * **Who prints.** Most sites are wrapped as
//!   `python3 -c "..." 2>/dev/null && echo "  [mcp] Added x" || true`, so the
//!   *shell* owns the log line and the interpreter must stay silent and signal
//!   via its exit status. Two sites (`protect-namespace`, `deregister-fork`)
//!   printed from inside Python and only when they changed something; those
//!   keep their `println!`.
//! * **Secrets never reach argv.** The email-gateway bearer token and the
//!   RuVector password were read from the environment inside Python precisely
//!   so they stayed off the process list. `set-server` therefore takes its
//!   server spec on **stdin**, so a shell heredoc can interpolate a secret
//!   without it ever appearing in `ps`.

use std::io::Read;
use std::path::Path;

use serde_json::{Map, Value};

use crate::jsonio;

/// Load `.mcp.json`, failing (non-zero exit, no output) when it is absent or
/// corrupt — the shell's `&& echo` then suppresses the success line, exactly as
/// the Python's uncaught `json.JSONDecodeError` did.
fn load_strict(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// `cfg.setdefault('mcpServers', {})[name] = <spec>` — the shape shared by
/// browser-gpu, ontology-bridge, precedent-bridge, harness-bridge,
/// email-gateway, perplexity and ruvnet-brain.
pub fn set_server(file: &Path, name: &str) -> Result<(), String> {
    let mut spec_text = String::new();
    std::io::stdin()
        .read_to_string(&mut spec_text)
        .map_err(|e| format!("reading spec from stdin: {e}"))?;
    let spec_text = expand_env_placeholders(&spec_text);
    let spec: Value =
        serde_json::from_str(&spec_text).map_err(|e| format!("spec is not valid JSON: {e}"))?;

    let mut cfg = load_strict(file)?;
    jsonio::mcp_servers_mut(&mut cfg).insert(name.to_string(), spec);
    jsonio::write(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))
}

/// Substitute `${VAR}` with the JSON-escaped value of that environment
/// variable, or the empty string when it is unset (`os.environ.get(x, '')`).
///
/// This exists so a secret can reach the spec without passing through argv.
/// The entrypoint's heredocs let the shell expand ordinary paths and URLs, but
/// escape the placeholder for anything sensitive (`\${AGENTBOX_EMAIL_GATEWAY_TOKEN}`),
/// so the value is read here, inside the process — the property the Python had,
/// and one two of today's `python3 -c` sites had already lost by interpolating
/// an API key straight onto the command line.
///
/// Escaping matters as much as the indirection: a token containing a quote or
/// a backslash would otherwise produce invalid JSON. The substitution is
/// JSON-escaped with the surrounding quotes stripped, because placeholders only
/// ever appear inside string literals.
fn expand_env_placeholders(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let name = &after[..end];
                let value = std::env::var(name).unwrap_or_default();
                let escaped = serde_json::to_string(&value).unwrap_or_else(|_| "\"\"".into());
                // Strip exactly one quote from each end. `trim_matches('"')`
                // would strip *every* trailing quote, so a value ending in `"`
                // lost its own escaped quote and left a dangling backslash that
                // ran the JSON string off the end of the line.
                out.push_str(&escaped[1..escaped.len() - 1]);
                rest = &after[end + 1..];
            }
            // An unterminated `${` is literal text, not a placeholder.
            None => {
                out.push_str(&rest[start..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Reconcile the `agentic-qe` entry and its env block every boot.
///
/// `provider` empty removes `AQE_LLM_PROVIDER` rather than writing a blank —
/// the `env.pop(..., None)` branch, which is what lets an operator turn ADR-041
/// routing back off without leaving a stale key behind.
pub fn reconcile_aqe(file: &Path, provider: Option<&str>) -> Result<(), String> {
    let mut cfg = load_strict(file)?;
    let servers = jsonio::mcp_servers_mut(&mut cfg);

    let entry = servers.entry("agentic-qe".to_string()).or_insert_with(
        || serde_json::json!({ "command": "aqe", "args": ["mcp"], "type": "stdio" }),
    );
    if !entry.is_object() {
        *entry = serde_json::json!({ "command": "aqe", "args": ["mcp"], "type": "stdio" });
    }
    let obj = entry.as_object_mut().expect("object");
    obj.entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let env = obj
        .get_mut("env")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "agentic-qe env is not an object".to_string())?;

    env.insert("AQE_MEMORY_BACKEND".into(), Value::String("memory".into()));
    env.insert("AQE_VERBOSE".into(), Value::String("false".into()));
    env.insert("NODE_NO_WARNINGS".into(), Value::String("1".into()));
    match provider.filter(|p| !p.is_empty()) {
        Some(p) => {
            env.insert("AQE_LLM_PROVIDER".into(), Value::String(p.to_string()));
        }
        None => {
            env.shift_remove("AQE_LLM_PROVIDER");
        }
    }

    jsonio::write(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))
}

/// Append `namespace` to the governed server's `RUVECTOR_PROTECTED_NAMESPACES`.
///
/// Append-never-replace keeps the shipped default (`governance-precedents`) and
/// any operator additions; the file is only rewritten when the namespace was
/// genuinely absent, and the log line is emitted only then.
pub fn protect_namespace(file: &Path, server: &str, namespace: &str) -> Result<(), String> {
    let mut cfg = load_strict(file)?;
    // No such server — `cf is None` in the Python, which fell through silently
    // without writing.
    let Some(srv) = cfg
        .get_mut("mcpServers")
        .and_then(|s| s.get_mut(server))
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    srv.entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(env) = srv.get_mut("env").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let current = env
        .get("RUVECTOR_PROTECTED_NAMESPACES")
        .and_then(Value::as_str)
        .unwrap_or("governance-precedents");
    let mut names: Vec<String> = current
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if names.iter().any(|n| n == namespace) {
        return Ok(());
    }
    names.push(namespace.to_string());
    env.insert(
        "RUVECTOR_PROTECTED_NAMESPACES".into(),
        Value::String(names.join(",")),
    );
    jsonio::write(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))?;
    println!("  [ruvnet-brain] protected namespace {namespace} in claude-flow env");
    Ok(())
}

/// ADR-036 D2: drop any `ruvector-mcp` registration whose script lives outside
/// `/opt/agentbox/` — the ungoverned personal fork that predates the
/// `PROTECTED_NAMESPACES` guard. The fork file itself is left on disk.
///
/// Unreadable or unparseable input exits 0 with no change: the Python wrapped
/// its load in `try/except → sys.exit(0)` so a corrupt user config never
/// blocked boot.
pub fn deregister_ruvector_fork(file: &Path) -> Result<(), String> {
    let Some(mut cfg) = jsonio::read_opt(file) else {
        return Ok(());
    };
    let Some(servers) = cfg.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let doomed: Vec<String> = servers
        .iter()
        .filter(|(_, v)| v.is_object() && references_foreign_ruvector(v))
        .map(|(k, _)| k.clone())
        .collect();
    if doomed.is_empty() {
        return Ok(());
    }
    for k in &doomed {
        servers.shift_remove(k);
    }
    jsonio::write(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))?;
    println!(
        "  [mcp] De-registered ungoverned ruvector fork: {} (ADR-036 D2)",
        doomed.join(", ")
    );
    Ok(())
}

/// The Python predicate: any of `args + [command]`, stringified, mentions
/// `ruvector-mcp` but not `/opt/agentbox/`.
fn references_foreign_ruvector(server: &Value) -> bool {
    let mut candidates: Vec<String> = server
        .get("args")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(py_str).collect())
        .unwrap_or_default();
    candidates.push(server.get("command").map(py_str).unwrap_or_default());
    candidates
        .iter()
        .any(|s| s.contains("ruvector-mcp") && !s.contains("/opt/agentbox/"))
}

/// `str(a)` for the shapes that appear in an MCP `args` array. Only the two
/// substring tests above consume this, so a plain string passes through
/// unquoted (which is what `str()` does and `json.dumps` would not).
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn foreign_fork_is_detected_by_args() {
        assert!(references_foreign_ruvector(&json!({
            "command": "node", "args": ["/home/devuser/.claude/ruvector-mcp.cjs"]
        })));
    }

    #[test]
    fn governed_server_under_opt_agentbox_is_kept() {
        assert!(!references_foreign_ruvector(&json!({
            "command": "node", "args": ["/opt/agentbox/mcp/servers/ruvector-mcp.cjs"]
        })));
    }

    #[test]
    fn unrelated_server_is_kept() {
        assert!(!references_foreign_ruvector(&json!({
            "command": "node", "args": ["/opt/agentbox/mcp/servers/ontology-bridge.js"]
        })));
    }

    #[test]
    fn command_field_alone_can_trip_the_predicate() {
        assert!(references_foreign_ruvector(
            &json!({ "command": "/usr/local/bin/ruvector-mcp" })
        ));
    }

    #[test]
    fn env_placeholders_expand_from_the_process_environment() {
        std::env::set_var("ABM_TEST_TOKEN", "s3cr3t");
        assert_eq!(
            expand_env_placeholders(r#"{"h":"Bearer ${ABM_TEST_TOKEN}"}"#),
            r#"{"h":"Bearer s3cr3t"}"#
        );
    }

    #[test]
    fn an_unset_variable_expands_to_the_empty_string() {
        std::env::remove_var("ABM_TEST_ABSENT");
        assert_eq!(
            expand_env_placeholders(r#"{"k":"${ABM_TEST_ABSENT}"}"#),
            r#"{"k":""}"#
        );
    }

    #[test]
    fn a_quote_in_the_value_is_escaped_not_injected() {
        std::env::set_var("ABM_TEST_QUOTED", "a\"b\\c");
        let out = expand_env_placeholders(r#"{"k":"${ABM_TEST_QUOTED}"}"#);
        let v: Value = serde_json::from_str(&out).expect("stays valid JSON");
        assert_eq!(v["k"], "a\"b\\c");
    }

    #[test]
    fn an_unterminated_placeholder_is_left_alone() {
        assert_eq!(expand_env_placeholders("${OOPS"), "${OOPS");
    }

    #[test]
    fn a_value_ending_in_a_quote_keeps_its_escape() {
        // Regression: `trim_matches('"')` ate the escaped trailing quote as
        // well as the delimiter, producing `pk-\"quoted\` — an unterminated
        // JSON string.
        std::env::set_var("ABM_TEST_TRAILING", "pk-\"quoted\"");
        let out = expand_env_placeholders(r#"{"k":"${ABM_TEST_TRAILING}"}"#);
        let v: Value = serde_json::from_str(&out).expect("stays valid JSON");
        assert_eq!(v["k"], "pk-\"quoted\"");
    }

    #[test]
    fn a_value_that_is_only_quotes_survives() {
        std::env::set_var("ABM_TEST_QUOTES", "\"\"\"");
        let out = expand_env_placeholders(r#"{"k":"${ABM_TEST_QUOTES}"}"#);
        let v: Value = serde_json::from_str(&out).expect("stays valid JSON");
        assert_eq!(v["k"], "\"\"\"");
    }
}
