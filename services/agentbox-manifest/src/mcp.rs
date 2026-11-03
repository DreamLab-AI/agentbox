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
    let value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    validate_server_map(&value)?;
    Ok(value)
}

fn validate_server_map(value: &Value) -> Result<(), String> {
    if !value.is_object()
        || value
            .get("mcpServers")
            .is_some_and(|servers| !servers.is_object())
    {
        return Err(
            "MCP configuration must contain an object server map; preserved unchanged".into(),
        );
    }
    Ok(())
}

/// `cfg.setdefault('mcpServers', {})[name] = <spec>` — the shape shared by
/// browser-gpu, precedent-bridge, harness-bridge,
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
    jsonio::write_atomic(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))
}

/// Substitute `${VAR}` (ASCII `[A-Za-z_][A-Za-z0-9_]*`) with the JSON-escaped value of that environment
/// variable, or the empty string when it is unset (`os.environ.get(x, '')`).
/// Unsupported shell syntax and unmatched openers remain literal text.
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
        // Accept only the exact ${NAME} grammar. In particular shell defaults,
        // invalid identifiers and a later JSON object's closing brace are not
        // variable names. Advancing just past the literal opener on a mismatch
        // still allows a separate valid placeholder in a later field.
        let name_end = after
            .bytes()
            .position(|byte| !(byte.is_ascii_alphanumeric() || byte == b'_'));
        let end = name_end.filter(|end| {
            *end > 0
                && (after.as_bytes()[0].is_ascii_alphabetic() || after.as_bytes()[0] == b'_')
                && after.as_bytes()[*end] == b'}'
        });
        if let Some(end) = end {
            let value = std::env::var(&after[..end]).unwrap_or_default();
            let escaped = serde_json::to_string(&value).expect("a string always serialises");
            // Strip one delimiter only; quote characters in the value retain
            // their own JSON escaping, including a quote at the end.
            out.push_str(&escaped[1..escaped.len() - 1]);
            rest = &after[end + 1..];
        } else {
            out.push_str("${");
            rest = after;
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
pub fn reconcile_aqe(file: &Path, provider: Option<&str>, disabled: bool) -> Result<(), String> {
    let mut cfg = load_strict(file)?;
    let servers = jsonio::mcp_servers_mut(&mut cfg);
    if disabled {
        servers.shift_remove("agentic-qe");
        return jsonio::write_atomic(file, &cfg, false)
            .map_err(|e| format!("{}: {e}", file.display()));
    }
    let entry = servers.entry("agentic-qe".to_string()).or_insert_with(
        || serde_json::json!({ "command": "aqe", "args": ["mcp"], "type": "stdio" }),
    );
    aqe_entry(entry, provider)?;
    jsonio::write_atomic(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))
}

fn aqe_entry(entry: &mut Value, provider: Option<&str>) -> Result<(), String> {
    if !entry.is_object() {
        *entry = serde_json::json!({ "command": "aqe", "args": ["mcp"], "type": "stdio" });
    }
    let obj = entry.as_object_mut().expect("object");
    obj.insert("command".into(), Value::String("aqe".into()));
    obj.insert("args".into(), serde_json::json!(["mcp"]));
    obj.insert("type".into(), Value::String("stdio".into()));
    obj.shift_remove("url");
    obj.shift_remove("headers");
    obj.entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let env = obj
        .get_mut("env")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "agentic-qe env is not an object".to_string())?;

    env.insert("AQE_MEMORY_BACKEND".into(), Value::String("memory".into()));
    env.insert("AQE_VERBOSE".into(), Value::String("false".into()));
    env.insert("NODE_NO_WARNINGS".into(), Value::String("1".into()));
    // Explicit task tools only; the upstream package otherwise starts periodic workers.
    env.insert("AQE_WORKERS_ENABLED".into(), Value::String("false".into()));
    // AQE's optional local/embedder clients are not the estate memory pipeline.
    // Empty strings also prevent an inherited endpoint/token activating one.
    env.insert("AQE_EMBEDDER_ENDPOINT".into(), Value::String(String::new()));
    env.insert("AQE_EMBEDDER_TOKEN".into(), Value::String(String::new()));
    match provider.filter(|p| !p.is_empty()) {
        Some(p) => {
            env.insert("AQE_LLM_PROVIDER".into(), Value::String(p.to_string()));
        }
        None => {
            env.shift_remove("AQE_LLM_PROVIDER");
        }
    }

    Ok(())
}

/// Reconcile the same direct AQE MCP in Codex, preserving unrelated TOML values.
pub fn reconcile_aqe_codex(
    file: &Path,
    provider: Option<&str>,
    disabled: bool,
) -> Result<(), String> {
    use std::io::Write;
    let text = match std::fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err("AQE Codex configuration is unreadable".into()),
    };
    let mut cfg: toml_edit::DocumentMut = text
        .parse()
        .map_err(|_| "AQE Codex configuration is malformed; preserved unchanged")?;
    let servers = edit_table(cfg.as_table_mut(), "mcp_servers")?;
    if disabled {
        servers.remove("agentic-qe");
    } else {
        let entry = edit_table(servers, "agentic-qe")?;
        // Derive owned fields from the same policy as the JSON projection.
        // All unrelated operator values and formatting stay in the document.
        let mut managed = Value::Null;
        aqe_entry(&mut managed, provider)?;
        edit_value(
            entry,
            "command",
            toml_edit::Value::from(managed["command"].as_str().expect("AQE command")),
        );
        let args = managed["args"]
            .as_array()
            .expect("AQE args")
            .iter()
            .map(|value| value.as_str().expect("AQE argument"));
        edit_value(entry, "args", toml_edit::Value::Array(args.collect()));
        for stale in ["type", "url", "headers"] {
            entry.remove(stale);
        }
        // These are defaults for a newly registered entry, never overrides of
        // operator deadlines or required-server policy.
        if entry.get("startup_timeout_sec").is_none() {
            entry.insert("startup_timeout_sec", toml_edit::value(30));
        }
        if entry.get("required").is_none() {
            entry.insert("required", toml_edit::value(false));
        }
        let env = edit_table(entry, "env")?;
        for (key, value) in managed["env"].as_object().expect("AQE environment") {
            edit_value(
                env,
                key,
                toml_edit::Value::from(value.as_str().expect("AQE environment value")),
            );
        }
        if managed["env"].get("AQE_LLM_PROVIDER").is_none() {
            env.remove("AQE_LLM_PROVIDER");
        }
    }
    let output = cfg.to_string();
    let parent = file.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).map_err(|_| "cannot create Codex config directory")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "cannot stage Codex config")?;
    temporary
        .write_all(output.as_bytes())
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| "cannot write staged Codex config")?;
    temporary
        .persist(file)
        .map_err(|_| "cannot replace Codex config")?;
    Ok(())
}

fn edit_table<'a>(
    parent: &'a mut dyn toml_edit::TableLike,
    key: &str,
) -> Result<&'a mut dyn toml_edit::TableLike, String> {
    parent
        .entry(key)
        .or_insert(toml_edit::Item::Table(toml_edit::Table::new()))
        .as_table_like_mut()
        .ok_or_else(|| format!("AQE Codex {key} must be a table; preserved unchanged"))
}

fn edit_value(table: &mut dyn toml_edit::TableLike, key: &str, mut value: toml_edit::Value) {
    if let Some(previous) = table.get(key).and_then(toml_edit::Item::as_value) {
        *value.decor_mut() = previous.decor().clone();
    }
    *table.entry(key).or_insert(toml_edit::Item::None) = toml_edit::Item::Value(value);
}

/// Mirror one server from `from` (the workspace `.mcp.json`) into `to` (the
/// user-level `~/.claude/.claude.json`), so it loads whatever directory Claude
/// Code is started in.
///
/// `.mcp.json` is only discovered by walking up from the cwd, so a session
/// started outside `$WORKSPACE` (for example in `$HOME`) never saw the
/// `claude-flow` RuVector memory server. The user-level file is read from every
/// cwd. Only `mcpServers[name]` is touched; every other key Claude Code keeps
/// in that file survives, and the file is rewritten only when the entry
/// actually differs (the log line follows suit). A missing source entry is a
/// no-op, an unparseable destination is left alone rather than clobbered, and
/// the destination is made owner-only because the entry carries the conninfo.
pub fn mirror_server(from: &Path, to: &Path, name: &str) -> Result<(), String> {
    let src = load_strict(from)?;
    let Some(spec) = src.get("mcpServers").and_then(|s| s.get(name)) else {
        return Ok(());
    };
    let mut dst = if to.exists() {
        jsonio::read_opt(to)
            .ok_or_else(|| format!("{}: unparseable, left untouched", to.display()))?
    } else {
        Value::Object(Map::new())
    };
    validate_server_map(&dst)?;
    let servers = jsonio::mcp_servers_mut(&mut dst);
    if servers.get(name) == Some(spec) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata =
                std::fs::symlink_metadata(to).map_err(|e| format!("{}: {e}", to.display()))?;
            if metadata.is_file() && metadata.permissions().mode() & 0o7777 == 0o600 {
                return Ok(());
            }
        }
        #[cfg(not(unix))]
        return Ok(());
    }
    servers.insert(name.to_string(), spec.clone());
    jsonio::write_atomic(to, &dst, false).map_err(|e| format!("{}: {e}", to.display()))?;
    println!(
        "  [mcp] Mirrored {name} into {} (loads from any cwd)",
        to.display()
    );
    Ok(())
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
    jsonio::write_atomic(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))?;
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
    jsonio::write_atomic(file, &cfg, false).map_err(|e| format!("{}: {e}", file.display()))?;
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

    fn mirror_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("mcp-mirror-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn mirror_copies_entry_and_keeps_other_user_keys() {
        let d = mirror_dir("copy");
        let (from, to) = (d.join("a.json"), d.join("u.json"));
        std::fs::write(
            &from,
            r#"{"mcpServers":{"claude-flow":{"command":"node"},"x":{}}}"#,
        )
        .unwrap();
        std::fs::write(
            &to,
            r#"{"theme":"dark","mcpServers":{"other":{"command":"y"}}}"#,
        )
        .unwrap();
        mirror_server(&from, &to, "claude-flow").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&to).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["claude-flow"]["command"], "node");
        assert_eq!(v["mcpServers"]["other"]["command"], "y");
        assert!(
            v["mcpServers"].get("x").is_none(),
            "only the named server moves"
        );
        assert_eq!(v["theme"], "dark");
    }

    #[test]
    fn mirror_creates_missing_destination_and_is_idempotent() {
        let d = mirror_dir("create");
        let (from, to) = (d.join("a.json"), d.join("u.json"));
        std::fs::write(
            &from,
            r#"{"mcpServers":{"claude-flow":{"command":"node"}}}"#,
        )
        .unwrap();
        mirror_server(&from, &to, "claude-flow").unwrap();
        let first = std::fs::metadata(&to).unwrap().modified().unwrap();
        mirror_server(&from, &to, "claude-flow").unwrap();
        assert_eq!(
            first,
            std::fs::metadata(&to).unwrap().modified().unwrap(),
            "no rewrite when equal"
        );
    }

    #[test]
    fn mirror_leaves_unparseable_destination_and_absent_source_alone() {
        let d = mirror_dir("bad");
        let (from, to) = (d.join("a.json"), d.join("u.json"));
        std::fs::write(&from, r#"{"mcpServers":{"claude-flow":{}}}"#).unwrap();
        std::fs::write(&to, "{not json").unwrap();
        assert!(mirror_server(&from, &to, "claude-flow").is_err());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "{not json");
        mirror_server(&from, &to, "absent").unwrap();
    }

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
            "command": "node", "args": ["/opt/agentbox/mcp/servers/governance-bridge.js"]
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

    #[test]
    fn unsupported_shell_expansions_and_cross_field_braces_stay_literal() {
        for text in [
            r#"{"args":["-c","echo ${X:-default} ${9X} ${} ${X-Y}"]}"#,
            r#"{"args":["${UNCLOSED"],"nested":{"keep":true}}"#,
        ] {
            assert_eq!(expand_env_placeholders(text), text);
        }
    }

    #[test]
    fn unmatched_literal_does_not_hide_a_later_valid_placeholder() {
        std::env::set_var("ABM_TEST_AFTER_LITERAL", "expanded");
        assert_eq!(
            expand_env_placeholders(
                r#"{"literal":"${UNCLOSED","next":"${ABM_TEST_AFTER_LITERAL}"}"#
            ),
            r#"{"literal":"${UNCLOSED","next":"expanded"}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn unchanged_mirror_still_repairs_public_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = tempfile::tempdir().unwrap();
        let from = scratch.path().join("from.json");
        let to = scratch.path().join("to.json");
        let text = r#"{"mcpServers":{"fixture":{"env":{"TOKEN":"private-fixture"}}}}"#;
        std::fs::write(&from, text).unwrap();
        std::fs::write(&to, text).unwrap();
        std::fs::set_permissions(&to, std::fs::Permissions::from_mode(0o644)).unwrap();
        mirror_server(&from, &to, "fixture").unwrap();
        assert_eq!(
            std::fs::metadata(&to).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(jsonio::read_opt(&from), jsonio::read_opt(&to));
    }
}
