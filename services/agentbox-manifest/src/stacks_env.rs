//! Environment and manifest gates for `provision-agent-stacks`.
//!
//! Split out of `stacks.rs` so the provisioning logic and the inputs it reads
//! stay separately reviewable. Every default here matches the Python's
//! `os.getenv(KEY, default)` exactly, including `WORKSPACE`'s legacy
//! `/workspace` fallback — the entrypoint always exports the real value, and
//! changing the fallback would be a behaviour change, not a tidy-up.

use std::path::PathBuf;

use serde_json::Value;

use crate::tomlval;

/// Resolved environment for one provisioning run.
pub struct Env {
    pub workspace: PathBuf,
    pub skills_tree: PathBuf,
    pub agentbox_config: PathBuf,
    pub shared_projects_root: PathBuf,
    pub hook_adapter: String,
    pub nostr_summary_hook: String,
    pub ontology_monitor_hook: String,
    pub hf_cache: String,
}

pub fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

impl Env {
    pub fn from_process() -> Self {
        Self {
            workspace: env_or("WORKSPACE", "/workspace").into(),
            skills_tree: env_or("SKILLS_TREE", "/opt/agentbox/skills").into(),
            agentbox_config: env_or("AGENTBOX_CONFIG", "/etc/agentbox.toml").into(),
            shared_projects_root: env_or("SHARED_PROJECTS_ROOT", "/projects").into(),
            hook_adapter: env_or(
                "AGENTBOX_HOOK_ADAPTER",
                "/opt/agentbox/config/hooks/claude-flow-hook-adapter.cjs",
            ),
            // Still a Python hook: `nostr-session-summary.py` is a runtime
            // SessionEnd hook, not boot-path config munging, and is tracked
            // separately in the estate audit. The command string is emitted
            // verbatim so the wiring is unchanged by this port.
            nostr_summary_hook: env_or(
                "AGENTBOX_NOSTR_SUMMARY_HOOK",
                "/opt/agentbox/config/hooks/nostr-session-summary.py",
            ),
            ontology_monitor_hook: env_or(
                "AGENTBOX_ONTOLOGY_MONITOR_HOOK",
                "/opt/agentbox/config/hooks/ontology-monitor.cjs",
            ),
            hf_cache: env_or("AGENTBOX_HF_CACHE", "/home/devuser/.cache/huggingface"),
        }
    }
}

/// Gates read from the manifest that change what gets written into each profile.
pub struct Gates {
    pub mobile_bridge: bool,
    pub summary_model: String,
    pub zai_reasoning_effort: String,
    pub ontology_monitor: bool,
    pub ontology_monitor_mode: String,
}

pub fn as_string(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

impl Gates {
    pub fn from_manifest(cfg: &Value) -> Self {
        let mobile_bridge = tomlval::get_bool(cfg, "sovereign_mesh.mobile_bridge.enabled", false);
        let ontology_monitor = tomlval::get_bool(cfg, "ontology_monitor.enabled", false);
        Self {
            mobile_bridge,
            summary_model: if mobile_bridge {
                as_string(tomlval::get(
                    cfg,
                    "sovereign_mesh.mobile_bridge.summary_model",
                ))
            } else {
                String::new()
            },
            zai_reasoning_effort: as_string(tomlval::get(cfg, "consultants.zai.reasoning_effort")),
            ontology_monitor,
            ontology_monitor_mode: if ontology_monitor {
                let m = as_string(tomlval::get(cfg, "ontology_monitor.mode"));
                if m.is_empty() {
                    "dryrun".into()
                } else {
                    m
                }
            } else {
                "dryrun".into()
            },
        }
    }
}

