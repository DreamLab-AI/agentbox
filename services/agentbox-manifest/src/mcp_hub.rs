//! `mcp-hub-project` — move stateless MCP servers behind the shared hub
//! (ADR-2034 §2).
//!
//! Every Claude Code session spawns a private copy of each stdio server in
//! `.mcp.json`. For the stateless bridges that is pure duplication: on
//! 2026-09-05, 27 sessions held 386 server processes and 25 GB. The hub
//! (`agentbox-mcp hub`, loopback `:9720`) runs each such server once and
//! multiplexes clients over streamable HTTP.
//!
//! This projection runs at the end of the boot MCP sequence, after the
//! bespoke blocks and the registry projector have written their stdio
//! entries. For each name on the hub list it:
//!
//! 1. lifts the stdio definition (command, args, env, cwd) out of `.mcp.json`
//!    into a durable sidecar (`--state`, mode 0600 beside `.mcp.json`) so the
//!    definition survives boots on which the upstream block is grep-guarded
//!    and does not rewrite it;
//! 2. replaces the `.mcp.json` entry with `{"type":"http","url":"<hub>/<name>/mcp"}`;
//! 3. writes the runtime hub config (`--out`, tmpfs, 0600) the hub reads.
//!
//! `--disable` reverses it: hub entries are restored from the sidecar so
//! turning the gate off in the manifest returns every session to stdio.
//! Secrets stay in files at the mode `.mcp.json` already used; nothing new
//! reaches argv or the process list.

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::jsonio;

/// Outcome, printed by the caller as one boot-log line.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub converted: Vec<String>,
    pub kept: Vec<String>,
    pub restored: Vec<String>,
    pub skipped: Vec<(String, String)>,
}

impl Report {
    pub fn summary(&self, enabled: bool) -> String {
        let mut s = format!(
            "hub {}: converted={} kept={} restored={} skipped={}",
            if enabled { "on" } else { "off" },
            self.converted.len(),
            self.kept.len(),
            self.restored.len(),
            self.skipped.len()
        );
        if !self.converted.is_empty() {
            s.push_str(&format!("; converted: {}", self.converted.join(", ")));
        }
        if !self.restored.is_empty() {
            s.push_str(&format!("; restored: {}", self.restored.join(", ")));
        }
        for (n, why) in &self.skipped {
            s.push_str(&format!("; skip {n} ({why})"));
        }
        s
    }
}

fn is_stdio(entry: &Value) -> bool {
    entry
        .get("command")
        .and_then(Value::as_str)
        .map(|c| !c.is_empty())
        .unwrap_or(false)
}

fn hub_endpoint(hub_url: &str, name: &str) -> String {
    format!("{}/{}/mcp", hub_url.trim_end_matches('/'), name)
}

fn is_hub_entry(entry: &Value, hub_url: &str, name: &str) -> bool {
    entry.get("url").and_then(Value::as_str) == Some(hub_endpoint(hub_url, name).as_str())
}

/// The `.mcp.json` entry a hubbed server gets. `description` is carried over
/// so the harness UI still names the server usefully.
fn http_entry(hub_url: &str, name: &str, stdio: &Value) -> Value {
    let mut e = Map::new();
    e.insert("type".into(), json!("http"));
    e.insert("url".into(), json!(hub_endpoint(hub_url, name)));
    if let Some(d) = stdio.get("description") {
        e.insert("description".into(), d.clone());
    }
    Value::Object(e)
}

/// The child spec the hub launches: only what a process needs.
fn child_spec(stdio: &Value) -> Value {
    let mut s = Map::new();
    s.insert("command".into(), stdio["command"].clone());
    s.insert("args".into(), stdio.get("args").cloned().unwrap_or_else(|| json!([])));
    s.insert("env".into(), stdio.get("env").cloned().unwrap_or_else(|| json!({})));
    if let Some(cwd) = stdio.get("cwd") {
        s.insert("cwd".into(), cwd.clone());
    }
    Value::Object(s)
}

/// Pure projection over the three documents. `mcp` is `.mcp.json`, `state`
/// the durable stdio sidecar. Returns the runtime hub config to write.
pub fn apply(
    mcp: &mut Value,
    state: &mut Map<String, Value>,
    hub_url: &str,
    bind: &str,
    servers: &[String],
    enabled: bool,
) -> (Report, Value) {
    let mut report = Report::default();
    let table = jsonio::mcp_servers_mut(mcp);
    let mut hub_servers = Map::new();

    if enabled {
        for name in servers {
            match table.get(name) {
                Some(entry) if is_stdio(entry) => {
                    let stdio = entry.clone();
                    state.insert(name.clone(), stdio.clone());
                    table.insert(name.clone(), http_entry(hub_url, name, &stdio));
                    hub_servers.insert(name.clone(), child_spec(&stdio));
                    report.converted.push(name.clone());
                }
                Some(entry) if is_hub_entry(entry, hub_url, name) => match state.get(name) {
                    Some(stdio) => {
                        hub_servers.insert(name.clone(), child_spec(stdio));
                        report.kept.push(name.clone());
                    }
                    None => report
                        .skipped
                        .push((name.clone(), "hub entry without a stored stdio definition".into())),
                },
                Some(_) => report
                    .skipped
                    .push((name.clone(), "not a stdio entry (left as is)".into())),
                None => report.skipped.push((name.clone(), "absent from .mcp.json".into())),
            }
        }
    } else {
        let names: Vec<String> = table.keys().cloned().collect();
        for name in names {
            let Some(entry) = table.get(&name) else { continue };
            if !is_hub_entry(entry, hub_url, &name) {
                continue;
            }
            match state.get(&name) {
                Some(stdio) => {
                    table.insert(name.clone(), stdio.clone());
                    report.restored.push(name);
                }
                None => report
                    .skipped
                    .push((name, "hub entry with no stored definition to restore".into())),
            }
        }
    }

    let config = json!({
        "schema": "agentbox.mcp-hub.v1",
        "bind": bind,
        "hub_url": hub_url,
        "servers": Value::Object(hub_servers),
    });
    (report, config)
}

fn write_private(path: &Path, value: &Value) -> Result<(), String> {
    jsonio::write_atomic(path, value, true).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("{}: chmod: {e}", path.display()))?;
    }
    Ok(())
}

/// Entry point for the subcommand. Prints the summary line on success.
#[allow(clippy::too_many_arguments)]
pub fn project(
    file: &Path,
    state_path: &Path,
    out: &Path,
    hub_url: &str,
    bind: &str,
    servers: &[String],
    enabled: bool,
) -> Result<(), String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let mut mcp: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", file.display()))?;
    let mut state: Map<String, Value> = jsonio::read_opt(state_path)
        .and_then(|v| v.get("servers").cloned())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let (report, config) = apply(&mut mcp, &mut state, hub_url, bind, servers, enabled);

    write_private(
        state_path,
        &json!({"schema": "agentbox.mcp-hub-state.v1", "servers": Value::Object(state)}),
    )?;
    write_private(out, &config)?;
    jsonio::write(file, &mcp, false).map_err(|e| format!("{}: {e}", file.display()))?;
    println!("[mcp-hub] {}", report.summary(enabled));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HUB: &str = "http://127.0.0.1:9720";

    fn doc() -> Value {
        json!({"mcpServers": {
            "consultant-codex": {"command": "sh", "args": ["-c", "exec node x.js"], "type": "stdio",
                                 "env": {"AGENTBOX_CODEX_MODEL": "gpt-5.4"}, "description": "Codex consultant"},
            "perplexity": {"command": "node", "args": ["p.js"], "type": "stdio", "env": {"PERPLEXITY_API_KEY": "k"}},
            "code-interpreter": {"command": "python3", "args": ["s.py"], "type": "stdio"},
            "browser-gpu": {"type": "sse", "url": "http://browsercontainer:8931/sse"}
        }})
    }

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn converts_stdio_entries_and_records_definitions() {
        let mut mcp = doc();
        let mut state = Map::new();
        let (r, cfg) = apply(&mut mcp, &mut state, HUB, "127.0.0.1:9720", &names(&["consultant-codex", "perplexity", "browser-gpu", "missing"]), true);
        assert_eq!(r.converted, names(&["consultant-codex", "perplexity"]));
        assert_eq!(r.skipped.len(), 2);
        let s = &mcp["mcpServers"];
        assert_eq!(s["consultant-codex"]["type"], "http");
        assert_eq!(s["consultant-codex"]["url"], "http://127.0.0.1:9720/consultant-codex/mcp");
        assert_eq!(s["consultant-codex"]["description"], "Codex consultant");
        assert!(s["consultant-codex"].get("command").is_none());
        assert!(s["consultant-codex"].get("env").is_none(), "secrets leave .mcp.json");
        assert_eq!(s["code-interpreter"]["command"], "python3", "unlisted stays stdio");
        assert_eq!(s["browser-gpu"]["type"], "sse");
        assert_eq!(state["perplexity"]["env"]["PERPLEXITY_API_KEY"], "k");
        assert_eq!(cfg["servers"]["perplexity"]["command"], "node");
        assert_eq!(cfg["servers"]["consultant-codex"]["args"][1], "exec node x.js");
        assert_eq!(cfg["bind"], "127.0.0.1:9720");
        assert!(cfg["servers"].get("code-interpreter").is_none());
    }

    #[test]
    fn second_boot_keeps_hub_entries_from_state() {
        let mut mcp = doc();
        let mut state = Map::new();
        apply(&mut mcp, &mut state, HUB, "b", &names(&["perplexity"]), true);
        // The upstream block is grep-guarded and leaves the http entry alone.
        let (r, cfg) = apply(&mut mcp, &mut state, HUB, "b", &names(&["perplexity"]), true);
        assert_eq!(r.kept, names(&["perplexity"]));
        assert!(r.converted.is_empty());
        assert_eq!(cfg["servers"]["perplexity"]["env"]["PERPLEXITY_API_KEY"], "k");
    }

    #[test]
    fn refreshed_upstream_definition_wins_over_state() {
        let mut mcp = doc();
        let mut state = Map::new();
        apply(&mut mcp, &mut state, HUB, "b", &names(&["perplexity"]), true);
        mcp["mcpServers"]["perplexity"] = json!({"command": "node", "args": ["p2.js"], "env": {"PERPLEXITY_API_KEY": "k2"}});
        let (r, cfg) = apply(&mut mcp, &mut state, HUB, "b", &names(&["perplexity"]), true);
        assert_eq!(r.converted, names(&["perplexity"]));
        assert_eq!(cfg["servers"]["perplexity"]["args"][0], "p2.js");
        assert_eq!(state["perplexity"]["env"]["PERPLEXITY_API_KEY"], "k2");
    }

    #[test]
    fn hub_entry_without_state_is_reported_not_broken() {
        let mut mcp = json!({"mcpServers": {"x": {"type": "http", "url": "http://127.0.0.1:9720/x/mcp"}}});
        let mut state = Map::new();
        let (r, cfg) = apply(&mut mcp, &mut state, HUB, "b", &names(&["x"]), true);
        assert_eq!(r.skipped[0].0, "x");
        assert!(cfg["servers"].as_object().unwrap().is_empty());
        assert_eq!(mcp["mcpServers"]["x"]["type"], "http", "left for the operator to see");
    }

    #[test]
    fn disable_restores_only_hub_entries_with_definitions() {
        let mut mcp = doc();
        let mut state = Map::new();
        apply(&mut mcp, &mut state, HUB, "b", &names(&["perplexity", "consultant-codex"]), true);
        mcp["mcpServers"]["orphan"] = json!({"type": "http", "url": "http://127.0.0.1:9720/orphan/mcp"});
        mcp["mcpServers"]["other-http"] = json!({"type": "http", "url": "http://elsewhere/mcp"});
        let (r, cfg) = apply(&mut mcp, &mut state, HUB, "b", &[], false);
        assert_eq!(r.restored, names(&["consultant-codex", "perplexity"]));
        assert_eq!(r.skipped, vec![("orphan".to_string(), "hub entry with no stored definition to restore".to_string())]);
        assert_eq!(mcp["mcpServers"]["perplexity"]["command"], "node");
        assert_eq!(mcp["mcpServers"]["perplexity"]["env"]["PERPLEXITY_API_KEY"], "k");
        assert_eq!(mcp["mcpServers"]["other-http"]["url"], "http://elsewhere/mcp");
        assert!(cfg["servers"].as_object().unwrap().is_empty());
    }

    #[test]
    fn project_writes_three_files_with_private_modes() {
        let dir = std::env::temp_dir().join(format!("mcp-hub-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mcp_path = dir.join(".mcp.json");
        let state_path = dir.join(".mcp-hub-servers.json");
        let out = dir.join("run").join("mcp-hub.json");
        std::fs::create_dir_all(out.parent().unwrap()).unwrap();
        std::fs::write(&mcp_path, doc().to_string()).unwrap();

        project(&mcp_path, &state_path, &out, HUB, "127.0.0.1:9720", &names(&["perplexity"]), true).unwrap();
        let mcp: Value = serde_json::from_str(&std::fs::read_to_string(&mcp_path).unwrap()).unwrap();
        assert_eq!(mcp["mcpServers"]["perplexity"]["type"], "http");
        let st: Value = serde_json::from_str(&std::fs::read_to_string(&state_path).unwrap()).unwrap();
        assert_eq!(st["servers"]["perplexity"]["command"], "node");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert_eq!(cfg["schema"], "agentbox.mcp-hub.v1");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for p in [&state_path, &out] {
                assert_eq!(std::fs::metadata(p).unwrap().permissions().mode() & 0o777, 0o600, "{}", p.display());
            }
        }
        project(&mcp_path, &state_path, &out, HUB, "127.0.0.1:9720", &[], false).unwrap();
        let mcp: Value = serde_json::from_str(&std::fs::read_to_string(&mcp_path).unwrap()).unwrap();
        assert_eq!(mcp["mcpServers"]["perplexity"]["command"], "node");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn summary_names_what_changed() {
        let r = Report { converted: names(&["a"]), kept: vec![], restored: vec![], skipped: vec![("b".into(), "absent".into())] };
        assert_eq!(r.summary(true), "hub on: converted=1 kept=0 restored=0 skipped=1; converted: a; skip b (absent)");
    }
}
