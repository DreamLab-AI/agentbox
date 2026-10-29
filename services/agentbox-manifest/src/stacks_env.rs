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
    /// Full SessionEnd digest command, run as-is (with `|| true` appended).
    pub nostr_summary_hook: String,
    pub ontology_monitor_hook: String,
    /// The ADR-2146 activity-sink hook script.
    pub activity_sink_hook: String,
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
            // `nostr-session-summary.py` is gone: the SessionEnd digest is now
            // the `session-summary` subcommand of the nostr-pod-bridge binary,
            // which already owned the signing half. The value is the full
            // command (no `python3` prefix is added at the call site), so an
            // override may name an absolute path or supply its own runner.
            nostr_summary_hook: env_or(
                "AGENTBOX_NOSTR_SUMMARY_HOOK",
                "nostr-pod-bridge session-summary",
            ),
            ontology_monitor_hook: env_or(
                "AGENTBOX_ONTOLOGY_MONITOR_HOOK",
                "/opt/agentbox/config/hooks/ontology-monitor.cjs",
            ),
            activity_sink_hook: env_or(
                "AGENTBOX_ACTIVITY_SINK_HOOK",
                "/opt/agentbox/config/hooks/activity-sink.cjs",
            ),
            hf_cache: env_or("AGENTBOX_HF_CACHE", "/home/devuser/.cache/huggingface"),
        }
    }
}

/// Gates read from the manifest that change what gets written into each profile.
pub struct Gates {
    pub floor: bool,
    pub session_plane: bool,
    /// `[voicelink].enabled && [voicelink].record_events` (ADR-2151): register the
    /// `voice-paned record` hooks on Stop and Notification in every profile.
    pub voicelink_record: bool,
    pub mobile_bridge: bool,
    pub summary_model: String,
    pub zai_reasoning_effort: String,
    pub ontology_monitor: bool,
    pub ontology_monitor_mode: String,
    /// `[integrations.activity_sink]` when it is enabled AND usable (ADR-2146).
    pub activity_sink: Option<ActivitySink>,
}

/// The resolved `[integrations.activity_sink]` table. Only the token's FILE path
/// or ENV NAME is carried — never its value, which must not reach settings.json.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivitySink {
    pub url: String,
    pub token_file: String,
    pub token_env: String,
    /// Selected wire event names, in canonical order.
    pub events: Vec<String>,
}

/// Wire event names the hook understands, in canonical order.
pub const ACTIVITY_SINK_EVENTS: [&str; 3] = ["post_tool_use", "user_prompt", "stop"];

impl ActivitySink {
    /// Resolve the table. `None` when it is off, the url is not a quotable
    /// http(s) URL, `token_env` is not an env var name, or no event is selected —
    /// the same conditions under which the root-session block de-registers.
    pub fn from_manifest(cfg: &Value) -> Option<Self> {
        if !tomlval::get_bool(cfg, "integrations.activity_sink.enabled", false) {
            return None;
        }
        let s = |k: &str| {
            as_string(tomlval::get(
                cfg,
                &format!("integrations.activity_sink.{k}"),
            ))
            .trim()
            .to_string()
        };
        let url = s("url");
        let url_ok = (url.starts_with("http://") || url.starts_with("https://"))
            && !url
                .chars()
                .any(|c| c.is_whitespace() || c == '\'' || c == '"');
        let token_env = s("token_env");
        let env_ok = token_env.is_empty()
            || (token_env
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !token_env.starts_with(|c: char| c.is_ascii_digit()));
        let events: Vec<String> = match tomlval::get(cfg, "integrations.activity_sink.events") {
            None | Some(Value::Null) => {
                ACTIVITY_SINK_EVENTS.iter().map(|e| e.to_string()).collect()
            }
            Some(Value::Array(a)) => ACTIVITY_SINK_EVENTS
                .iter()
                .filter(|e| a.iter().any(|v| v.as_str() == Some(**e)))
                .map(|e| e.to_string())
                .collect(),
            Some(_) => Vec::new(),
        };
        if !url_ok || !env_ok || events.is_empty() {
            return None;
        }
        Some(Self {
            url,
            token_file: s("token_file"),
            token_env,
            events,
        })
    }
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
            session_plane: tomlval::get_bool(cfg, "interaction_plane.enabled", false),
            floor: tomlval::get_bool(cfg, "claude_code.floor", true),
            voicelink_record: tomlval::get_bool(cfg, "voicelink.enabled", false)
                && tomlval::get_bool(cfg, "voicelink.record_events", true),
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
            activity_sink: ActivitySink::from_manifest(cfg),
        }
    }
}
