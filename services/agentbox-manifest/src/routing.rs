//! ADR-041 boot projection: `[model_routing]` → every `.agentic-qe/llm-config.json`.
//!
//! One policy, many projections. The manifest is the only edit point; this
//! output is replaced wholesale at every boot, like `.mcp.json`. Three
//! behaviours are load-bearing and reproduced exactly:
//!
//! * **Non-managed keys survive.** Only `MANAGED_KEYS` are rewritten; anything
//!   else an operator or agentic-qe itself put in the file round-trips.
//! * **API keys are never persisted.** `strip_api_keys` runs on the merged
//!   document, not just the managed half — defence in depth against a key that
//!   arrived via some other writer.
//! * **Fail-open.** Every error path returns without propagating, and the
//!   process still exits 0: a routing-projection failure must never block boot.
//!
//! Writes are atomic (temp + rename in the destination directory), matching
//! agentic-qe's own `saveRouterConfigFile`.

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{Map, Value};

use crate::{jsonio, tomlval};

/// Activity → agentic-qe agent types, in the Python literal's order. The order
/// is part of the byte-for-byte contract: it fixes `agentOverrides` key order.
const AGENT_ACTIVITY_MAP: &[(&str, &str)] = &[
    ("qe-security-scanner", "security-scan"),
    ("qe-security-auditor", "security-scan"),
    ("qe-pentest-validator", "security-scan"),
    ("qe-security-reviewer", "security-analysis"),
    ("qe-test-architect", "testing"),
    ("qe-test-generator", "testing"),
    ("qe-coverage-specialist", "testing"),
    ("qe-mutation-tester", "testing"),
    ("qe-code-reviewer", "review"),
    ("qe-integration-reviewer", "review"),
    ("qe-performance-reviewer", "review"),
    ("qe-requirements-validator", "specification"),
];

/// Providers agentic-qe 3.13.1 can actually construct. `sanitizeAgentOverrides`
/// drops the rest upstream; mirroring the drop here keeps the written file clean.
const AQE_CONSTRUCTIBLE: &[&str] = &[
    "claude",
    "claude-code",
    "codex",
    "openai",
    "ollama",
    "openrouter",
    "gemini",
    "azure-openai",
    "bedrock",
    "cognitum",
];

const MANAGED_KEYS: &[&str] = &[
    "agentOverrides",
    "defaultProvider",
    "fallbackChain",
    "_managedBy",
];

const PRUNE_DIRS: &[&str] = &["node_modules", ".git", "target", ".tmp", "dist"];

/// host → agentic-qe ExtendedProviderType (subscription tier: $0 marginal).
fn host_provider(host: &str) -> &'static str {
    match host {
        "claude" => "claude-code",
        _ => "codex",
    }
}

struct Route {
    host: String,
    model: String,
    esc_host: Option<String>,
    esc_model: Option<String>,
}

fn route_re() -> Regex {
    Regex::new(
        r"^\s*(claude|codex):([A-Za-z0-9._\-]+)(?:\s*->\s*(claude|codex):([A-Za-z0-9._\-]+))?\s*$",
    )
    .expect("static regex")
}

fn parse_route(re: &Regex, value: &str) -> Option<Route> {
    let c = re.captures(value)?;
    Some(Route {
        host: c[1].to_string(),
        model: c[2].to_string(),
        esc_host: c.get(3).map(|m| m.as_str().to_string()),
        esc_model: c.get(4).map(|m| m.as_str().to_string()),
    })
}

/// Build the managed half of `llm-config.json` from `[model_routing]`.
pub fn build_config(mr: &Value) -> Value {
    let re = route_re();
    let mut routes: Vec<(String, Route)> = Vec::new();
    if let Some(tbl) = mr.get("routes").and_then(Value::as_object) {
        for (activity, raw) in tbl {
            let raw_s = raw.as_str().unwrap_or("");
            match parse_route(&re, raw_s) {
                Some(r) => routes.push((activity.clone(), r)),
                None => eprintln!(
                    "[model-routing] unparseable route '{activity}' = '{raw_s}' — skipped"
                ),
            }
        }
    }

    let mut overrides = Map::new();
    for (agent, activity) in AGENT_ACTIVITY_MAP {
        let Some((_, r)) = routes.iter().find(|(a, _)| a == activity) else {
            continue;
        };
        let provider = host_provider(&r.host);
        if !AQE_CONSTRUCTIBLE.contains(&provider) {
            continue;
        }
        overrides.insert(
            (*agent).to_string(),
            serde_json::json!({ "provider": provider, "model": r.model }),
        );
    }

    let mut default_provider = mr
        .get("aqe_llm_provider")
        .and_then(Value::as_str)
        .unwrap_or("claude-code")
        .to_string();
    if !AQE_CONSTRUCTIBLE.contains(&default_provider.as_str()) {
        eprintln!(
            "[model-routing] aqe_llm_provider '{default_provider}' not constructible — using claude-code"
        );
        default_provider = "claude-code".into();
    }

    // A complete FallbackChain: agentic-qe merges a partial RouterConfig over
    // its defaults, but a partial *chain object* would clobber field-wise, so
    // every field is written. Each entry carries the distinct models the policy
    // routes on that provider, so a fallback lands on a model the vendor serves.
    let chain_providers: Vec<String> = mr
        .get("aqe_fallback_chain")
        .and_then(Value::as_str)
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty() && AQE_CONSTRUCTIBLE.contains(p))
        .map(str::to_string)
        .collect();

    let mut provider_models: Vec<(String, BTreeSet<String>)> = Vec::new();
    let push_model = |pm: &mut Vec<(String, BTreeSet<String>)>, prov: &str, model: &str| match pm
        .iter_mut()
        .find(|(p, _)| p == prov)
    {
        Some((_, set)) => {
            set.insert(model.to_string());
        }
        None => {
            let mut set = BTreeSet::new();
            set.insert(model.to_string());
            pm.push((prov.to_string(), set));
        }
    };
    for (_, r) in &routes {
        push_model(&mut provider_models, host_provider(&r.host), &r.model);
        if let (Some(h), Some(m)) = (&r.esc_host, &r.esc_model) {
            push_model(&mut provider_models, host_provider(h), m);
        }
    }

    let n = chain_providers.len();
    let entries: Vec<Value> = chain_providers
        .iter()
        .enumerate()
        .map(|(i, prov)| {
            let models: Vec<&String> = provider_models
                .iter()
                .find(|(p, _)| p == prov)
                .map(|(_, s)| s.iter().collect())
                .unwrap_or_default();
            serde_json::json!({
                "provider": prov,
                "models": models,
                "enabled": true,
                "priority": n - i,
            })
        })
        .collect();

    let mut cfg = Map::new();
    cfg.insert(
        "_managedBy".into(),
        Value::String(
            "agentbox entrypoint (ADR-041) — edit [model_routing] in agentbox.toml, not this file"
                .into(),
        ),
    );
    cfg.insert("defaultProvider".into(), Value::String(default_provider));
    cfg.insert("agentOverrides".into(), Value::Object(overrides));
    if !entries.is_empty() {
        cfg.insert(
            "fallbackChain".into(),
            serde_json::json!({
                "id": "agentbox-adr041",
                "entries": entries,
                "maxRetries": 2,
                "retryDelayMs": 1000,
                "backoffMultiplier": 2,
                "maxDelayMs": 15000,
            }),
        );
    }
    Value::Object(cfg)
}

/// Never persist anything `apiKey`-shaped, at any depth.
fn strip_api_keys(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter(|(k, _)| k.to_lowercase() != "apikey")
                .map(|(k, val)| (k.clone(), strip_api_keys(val)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip_api_keys).collect()),
        other => other.clone(),
    }
}

/// Reconcile one `.agentic-qe/` directory. Returns whether it changed.
fn reconcile(target_dir: &Path, managed: &Value, dry_run: bool) -> bool {
    let path = target_dir.join("llm-config.json");
    let existing = if path.exists() {
        match jsonio::read_opt(&path) {
            Some(v) if v.is_object() => v,
            _ => {
                eprintln!(
                    "[model-routing] {}: unreadable — rewriting managed keys only",
                    path.display()
                );
                Value::Object(Map::new())
            }
        }
    } else {
        Value::Object(Map::new())
    };

    let mut merged = Map::new();
    if let Some(m) = existing.as_object() {
        for (k, v) in m {
            if !MANAGED_KEYS.contains(&k.as_str()) {
                merged.insert(k.clone(), v.clone());
            }
        }
    }
    for (k, v) in managed.as_object().expect("managed is an object") {
        merged.insert(k.clone(), v.clone());
    }
    let merged = strip_api_keys(&Value::Object(merged));

    if merged == existing {
        return false;
    }
    if dry_run {
        eprintln!("[model-routing] would update {}", path.display());
        return true;
    }
    if let Err(e) = jsonio::write_atomic(&path, &merged, true) {
        eprintln!("[model-routing] {}: write failed ({e})", path.display());
        return false;
    }
    true
}

/// `os.walk` with the Python's prune rules, collecting every `.agentic-qe` dir.
fn discover_targets(workspace: &Path, dry_run: bool) -> Vec<PathBuf> {
    let mut targets: HashSet<PathBuf> = HashSet::new();
    let root_aqe = workspace.join(".agentic-qe");
    if !dry_run {
        let _ = std::fs::create_dir_all(&root_aqe);
    }
    targets.insert(root_aqe);

    let ws = workspace
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();
    let max_depth = ws.matches('/').count() + 4;

    let mut queue: Vec<PathBuf> = vec![workspace.to_path_buf()];
    while let Some(dir) = queue.pop() {
        let depth = dir
            .to_string_lossy()
            .trim_end_matches('/')
            .matches('/')
            .count();
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<String> = Vec::new();
        for e in entries.flatten() {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = e.file_name().to_string_lossy().into_owned();
                if !PRUNE_DIRS.contains(&name.as_str()) {
                    children.push(name);
                }
            }
        }
        if children.iter().any(|c| c == ".agentic-qe") {
            targets.insert(dir.join(".agentic-qe"));
        }
        for c in children {
            queue.push(dir.join(c));
        }
    }

    let mut out: Vec<PathBuf> = targets.into_iter().collect();
    out.sort();
    out
}

/// Entry point. Always returns `Ok(())`: fail-open is the contract.
pub fn project(manifest: &Path, workspace: &Path, dry_run: bool) {
    let Ok(text) = std::fs::read_to_string(manifest) else {
        eprintln!(
            "[model-routing] cannot read manifest {} — skipping",
            manifest.display()
        );
        return;
    };
    let cfg = match tomlval::parse(&text) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[model-routing] cannot read manifest {}: {e} — skipping",
                manifest.display()
            );
            return;
        }
    };

    let empty = Value::Object(Map::new());
    let mr = cfg.get("model_routing").unwrap_or(&empty);
    if !tomlval::get_bool(mr, "enabled", false)
        || !tomlval::get_bool(mr, "aqe_agent_overrides", true)
    {
        eprintln!("[model-routing] gate off — no projection");
        return;
    }

    let managed = build_config(mr);
    let targets = discover_targets(workspace, dry_run);
    let mut changed = 0usize;
    for t in &targets {
        if (t.is_dir() || !dry_run) && reconcile(t, &managed, dry_run) {
            changed += 1;
        }
    }

    let n_agents = managed
        .get("agentOverrides")
        .and_then(Value::as_object)
        .map(|m| m.len())
        .unwrap_or(0);
    let provider = managed
        .get("defaultProvider")
        .and_then(Value::as_str)
        .unwrap_or("");
    eprintln!(
        "[model-routing] projected agentOverrides ({n_agents} agents, provider={provider}) into {} project dir(s), {changed} updated",
        targets.len()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mr(toml_text: &str) -> Value {
        tomlval::parse(toml_text)
            .unwrap()
            .get("model_routing")
            .cloned()
            .unwrap()
    }

    #[test]
    fn simple_and_escalating_routes_both_parse() {
        let re = route_re();
        let r = parse_route(&re, "claude:claude-sonnet-5").unwrap();
        assert_eq!(
            (r.host.as_str(), r.model.as_str()),
            ("claude", "claude-sonnet-5")
        );
        assert!(r.esc_host.is_none());

        let r = parse_route(&re, "codex:gpt-5.5 -> claude:claude-fable-5-1").unwrap();
        assert_eq!(r.esc_host.as_deref(), Some("claude"));
        assert_eq!(r.esc_model.as_deref(), Some("claude-fable-5-1"));
    }

    #[test]
    fn an_unknown_host_is_rejected() {
        let re = route_re();
        assert!(parse_route(&re, "gemini:pro").is_none());
        assert!(parse_route(&re, "not a route").is_none());
    }

    #[test]
    fn agent_overrides_follow_the_activity_map_order() {
        let cfg = build_config(&mr(
            "[model_routing.routes]\nsecurity-scan = \"codex:gpt-5.5\"\ntesting = \"claude:claude-opus-5\"\n",
        ));
        let keys: Vec<&String> = cfg["agentOverrides"].as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            vec![
                "qe-security-scanner",
                "qe-security-auditor",
                "qe-pentest-validator",
                "qe-test-architect",
                "qe-test-generator",
                "qe-coverage-specialist",
                "qe-mutation-tester",
            ]
        );
        assert_eq!(
            cfg["agentOverrides"]["qe-test-architect"]["provider"],
            "claude-code"
        );
    }

    #[test]
    fn a_non_constructible_default_provider_falls_back() {
        let cfg = build_config(&mr("[model_routing]\naqe_llm_provider = \"nonsense\"\n"));
        assert_eq!(cfg["defaultProvider"], "claude-code");
    }

    #[test]
    fn fallback_chain_priorities_descend_and_models_are_sorted() {
        let cfg = build_config(&mr(
            "[model_routing]\naqe_fallback_chain = \"claude-code,codex\"\n\
             [model_routing.routes]\ntesting = \"codex:gpt-5.5 -> claude:zeta\"\nreview = \"claude:alpha\"\n",
        ));
        let entries = cfg["fallbackChain"]["entries"].as_array().unwrap();
        assert_eq!(entries[0]["provider"], "claude-code");
        assert_eq!(entries[0]["priority"], 2);
        assert_eq!(entries[1]["priority"], 1);
        // sorted(set(...)) — "alpha" before "zeta"
        assert_eq!(entries[0]["models"][0], "alpha");
        assert_eq!(entries[0]["models"][1], "zeta");
    }

    #[test]
    fn no_chain_means_no_fallback_key() {
        let cfg = build_config(&mr("[model_routing.routes]\nreview = \"claude:a\"\n"));
        assert!(cfg.get("fallbackChain").is_none());
    }

    #[test]
    fn api_keys_are_stripped_at_every_depth() {
        let v = serde_json::json!({
            "apiKey": "secret", "APIKEY": "secret",
            "nested": {"apikey": "secret", "keep": 1},
            "list": [{"ApiKey": "secret", "ok": true}]
        });
        let s = strip_api_keys(&v);
        assert!(s.get("apiKey").is_none() && s.get("APIKEY").is_none());
        assert!(s["nested"].get("apikey").is_none());
        assert_eq!(s["nested"]["keep"], 1);
        assert!(s["list"][0].get("ApiKey").is_none());
        assert_eq!(s["list"][0]["ok"], true);
    }
}
