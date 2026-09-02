//! `agentbox.toml` → flat TUI state JSON (port of `scripts/tui-read-manifest.py`).
//!
//! Every state key is the dotted TOML path it reads, so the whole reader is one
//! table of (key, default, stringify). The table below was generated from the
//! Python and is asserted field-for-field against it by the golden test.
//!
//! Two behaviours the wizard depends on:
//!
//! * **Safe defaults everywhere.** A missing or partial manifest must still
//!   yield every key, so a fresh install does not break the wizard.
//! * **Ports arrive as strings.** The Python wrapped nine numeric fields in
//!   `str(...)` because the TUI's text inputs are string-typed; `tui-write`
//!   converts them back with `int()`. Losing that would change the state shape.

use serde_json::{Map, Value};

use crate::tomlval;

/// Field default.
enum D {
    S(&'static str),
    B(bool),
}

struct F(&'static str, D, bool);

const FIELDS: &[F] = &[
    F("federation.mode", D::S("standalone"), false),
    F("federation.external_url", D::S(""), false),
    F("adapters.beads", D::S("local-sqlite"), false),
    F("adapters.pods", D::S("local-solid-rs"), false),
    F("adapters.memory", D::S("embedded-ruvector"), false),
    F("adapters.events", D::S("local-jsonl"), false),
    F(
        "adapters.orchestrator",
        D::S("local-process-manager"),
        false,
    ),
    F("gpu.backend", D::S("none"), false),
    F("desktop.enabled", D::B(false), false),
    F("desktop.stack", D::S("hyprland-wayland"), false),
    F("desktop.resolution", D::S("1920x1080"), false),
    F("toolchains.claude", D::B(true), false),
    F("toolchains.claude_code", D::B(false), false),
    F("toolchains.ruflo", D::B(true), false),
    F("toolchains.claude_flow", D::B(true), false),
    F("toolchains.agentic_qe", D::B(true), false),
    F("toolchains.nagual_qe", D::B(true), false),
    F("toolchains.antigravity_cli", D::B(false), false),
    F("toolchains.codex", D::B(false), false),
    F("toolchains.opencode", D::B(false), false),
    F("toolchains.code_server", D::B(false), false),
    F("toolchains.codebase_memory", D::B(true), false),
    F("toolchains.rust", D::B(true), false),
    F("toolchains.cuda", D::B(false), false),
    F("skills.browser.agent_browser", D::B(true), false),
    F("skills.browser.playwright", D::B(true), false),
    F("skills.browser.qe_browser", D::B(false), false),
    F("skills.media.ffmpeg", D::B(true), false),
    F("skills.media.imagemagick", D::B(true), false),
    F("skills.media.comfyui_builtin", D::B(false), false),
    F("skills.spatial_and_3d.blender", D::B(false), false),
    F("skills.spatial_and_3d.qgis", D::B(false), false),
    F(
        "skills.spatial_and_3d.gaussian_splatting",
        D::B(false),
        false,
    ),
    F("skills.data_science.pytorch", D::B(false), false),
    F("skills.data_science.jupyter", D::B(false), false),
    F("skills.docs.latex", D::B(true), false),
    F("skills.docs.mermaid", D::B(true), false),
    F("skills.docs.report_builder", D::B(true), false),
    F("skills.ontology.enabled", D::B(false), false),
    F("providers.anthropic.enabled", D::B(false), false),
    F("providers.anthropic.auth_mode", D::S("api_key"), false),
    F("providers.openai.enabled", D::B(false), false),
    F("providers.openai.auth_mode", D::S("api_key"), false),
    F("providers.gemini.enabled", D::B(false), false),
    F("providers.gemini.auth_mode", D::S("api_key"), false),
    F("providers.deepseek.enabled", D::B(false), false),
    F("providers.deepseek.auth_mode", D::S("api_key"), false),
    F("providers.perplexity.enabled", D::B(false), false),
    F("providers.perplexity.auth_mode", D::S("api_key"), false),
    F("providers.openrouter.enabled", D::B(false), false),
    F("providers.openrouter.auth_mode", D::S("api_key"), false),
    F("providers.context7.enabled", D::B(false), false),
    F("providers.context7.auth_mode", D::S("api_key"), false),
    F("providers.brave.enabled", D::B(false), false),
    F("providers.brave.auth_mode", D::S("api_key"), false),
    F("providers.github.enabled", D::B(false), false),
    F("providers.github.auth_mode", D::S("api_key"), false),
    F("providers.zai.enabled", D::B(false), false),
    F("providers.zai.auth_mode", D::S("api_key"), false),
    F("observability.metrics_port", D::S("9091"), true),
    F("observability.otlp_endpoint", D::S(""), false),
    F("observability.log_level", D::S("info"), false),
    F("integrations.ragflow.enabled", D::B(false), false),
    F("integrations.comfyui_external.enabled", D::B(false), false),
    F(
        "integrations.comfyui_external.url",
        D::S("http://comfyui:8188"),
        false,
    ),
    F(
        "integrations.comfyui_external.ws_url",
        D::S("ws://comfyui:8188/ws"),
        false,
    ),
    F("integrations.ruvector_external.conninfo", D::S(""), false),
    F("consultants.enabled", D::B(false), false),
    F("consultants.intelligence_signal", D::B(false), false),
    F(
        "consultants.log_dir",
        D::S("/var/lib/agentbox/consultations"),
        false,
    ),
    F("consultants.codex.enabled", D::B(false), false),
    F("consultants.antigravity.enabled", D::B(false), false),
    F("consultants.zai.enabled", D::B(false), false),
    F("consultants.perplexity.enabled", D::B(false), false),
    F("consultants.deepseek.enabled", D::B(false), false),
    F("model_routing.enabled", D::B(false), false),
    F("model_routing.primary_host", D::S("claude"), false),
    F("model_routing.aqe_agent_overrides", D::B(true), false),
    F("model_routing.dual_run", D::B(false), false),
    F("privacy_filter.enabled", D::B(false), false),
    F("privacy_filter.mode", D::S("off"), false),
    F("privacy_filter.port", D::S("9092"), true),
    F("privacy_filter.dtype", D::S("bf16"), false),
    F("privacy_filter.model", D::S("openai/privacy-filter"), false),
    F("privacy_filter.policy.pods", D::S("strict"), false),
    F("privacy_filter.policy.memory", D::S("strict"), false),
    F("privacy_filter.policy.events", D::S("soft"), false),
    F("privacy_filter.policy.beads", D::S("soft"), false),
    F("privacy_filter.policy.orchestrator", D::S("off"), false),
    F("privacy_filter.policy.inbound", D::S("soft"), false),
    F("privacy_filter.policy.outbound", D::S("soft"), false),
    F("sovereign_mesh.enabled", D::B(true), false),
    F("sovereign_mesh.solid_pod", D::B(true), false),
    F("sovereign_mesh.nostr_bridge", D::B(true), false),
    F("sovereign_mesh.https_bridge", D::B(false), false),
    F("sovereign_mesh.publish_agent_events", D::B(false), false),
    F("integrations.solid_pod_rs.port", D::S("8484"), true),
    F("integrations.solid_pod_rs.bind", D::S("127.0.0.1"), false),
    F("integrations.solid_pod_rs.storage", D::S("fs"), false),
    F(
        "integrations.solid_pod_rs.storage_root",
        D::S("/var/lib/solid"),
        false,
    ),
    F(
        "integrations.solid_pod_rs.base_url",
        D::S("http://127.0.0.1:8484"),
        false,
    ),
    F("integrations.solid_pod_rs.enable_oidc", D::B(false), false),
    F(
        "integrations.solid_pod_rs.enable_schnorr_verify",
        D::B(true),
        false,
    ),
    F(
        "integrations.solid_pod_rs.enable_dpop_cache",
        D::B(false),
        false,
    ),
    F(
        "integrations.solid_pod_rs.notifications",
        D::S("websocket"),
        false,
    ),
    F("integrations.solid_pod_rs.log_level", D::S("info"), false),
    F(
        "integrations.solid_pod_rs.enable_did_nostr",
        D::B(true),
        false,
    ),
    F(
        "integrations.solid_pod_rs.enable_webhook_signing",
        D::B(true),
        false,
    ),
    F(
        "integrations.solid_pod_rs.enable_rate_limit",
        D::B(true),
        false,
    ),
    F("integrations.solid_pod_rs.enable_quota", D::B(true), false),
    F(
        "integrations.solid_pod_rs.jss_v04_compat",
        D::B(true),
        false,
    ),
    F(
        "integrations.solid_pod_rs.rate_limit_per_sec",
        D::S("20"),
        true,
    ),
    F(
        "integrations.solid_pod_rs.quota_default_bytes",
        D::S("10737418240"),
        true,
    ),
    F("sovereign_mesh.relay.enabled", D::B(false), false),
    F(
        "sovereign_mesh.relay.implementation",
        D::S("nostr-rs-relay"),
        false,
    ),
    F("sovereign_mesh.relay.port", D::S("7777"), true),
    F("sovereign_mesh.relay.bind", D::S("127.0.0.1"), false),
    F("sovereign_mesh.relay.expose", D::B(false), false),
    F(
        "sovereign_mesh.relay.data_dir",
        D::S("/var/lib/nostr-relay"),
        false,
    ),
    F(
        "sovereign_mesh.relay.ingress_policy",
        D::S("allowlist"),
        false,
    ),
    F("sovereign_mesh.relay.pod_bridge", D::B(true), false),
    F("sovereign_mesh.relay.external_fanout", D::S("off"), false),
    F("sovereign_mesh.relay.max_event_bytes", D::S("131072"), true),
    F("sovereign_mesh.relay.messages_per_sec", D::S("5"), true),
    F("sovereign_mesh.relay.retention_days", D::S("30"), true),
    F("sovereign_mesh.relay.allow_nip04", D::B(false), false),
    F(
        "sovereign_mesh.relay.info_description",
        D::S("Agentbox sovereign relay"),
        false,
    ),
    F("sovereign_mesh.relay.info_contact", D::S(""), false),
];

/// CPython `str(value)` for the shapes a manifest scalar can take.
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

/// Build the flat state document from a parsed manifest.
pub fn build_state(cfg: &Value) -> Value {
    let mut state = Map::new();
    for F(key, default, stringify) in FIELDS {
        let resolved = match tomlval::get(cfg, key) {
            Some(v) => v.clone(),
            None => match default {
                D::S(s) => Value::String((*s).to_string()),
                D::B(b) => Value::Bool(*b),
            },
        };
        let value = if *stringify {
            Value::String(py_str(&resolved))
        } else {
            resolved
        };
        // `integrations.ruvector_external.enabled` is derived, not read: an
        // operator who sets only `conninfo` has plainly enabled the external
        // store, so a non-empty conninfo implies enabled. The Python emits it
        // immediately *before* `.conninfo`, and key order is asserted by the
        // golden test, so it is injected at the same point here.
        if *key == "integrations.ruvector_external.conninfo" {
            let has_conninfo = tomlval::get(cfg, "integrations.ruvector_external.conninfo")
                .map(|v| !py_str(v).is_empty())
                .unwrap_or(false);
            let enabled = has_conninfo
                || tomlval::get_bool(cfg, "integrations.ruvector_external.enabled", false);
            state.insert(
                "integrations.ruvector_external.enabled".into(),
                Value::Bool(enabled),
            );
        }
        state.insert((*key).to_string(), value);
    }
    Value::Object(state)
}

/// CLI entry: read `<agentbox.toml>` and write `<state.json>`.
///
/// A missing manifest is not an error — it yields the all-defaults state, which
/// is what a fresh install needs. Malformed TOML *is* an error, matching
/// `tomllib`'s uncaught `TOMLDecodeError`.
pub fn run(config_path: &std::path::Path, state_path: &std::path::Path) -> Result<(), String> {
    let cfg = if config_path.exists() {
        let text = std::fs::read_to_string(config_path)
            .map_err(|e| format!("{}: {e}", config_path.display()))?;
        tomlval::parse(&text).map_err(|e| format!("{}: {e}", config_path.display()))?
    } else {
        Value::Object(Map::new())
    };
    let state = build_state(&cfg);
    std::fs::write(state_path, crate::jsonio::dumps(&state))
        .map_err(|e| format!("{}: {e}", state_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_manifest_yields_every_default() {
        let state = build_state(&Value::Object(Map::new()));
        let obj = state.as_object().unwrap();
        assert_eq!(obj.len(), FIELDS.len() + 1); // + the derived ruvector flag
        assert_eq!(obj["federation.mode"], "standalone");
        assert_eq!(obj["adapters.beads"], "local-sqlite");
        assert_eq!(obj["desktop.enabled"], false);
        assert_eq!(obj["toolchains.claude"], true);
    }

    #[test]
    fn ports_are_stringified_even_when_the_manifest_holds_integers() {
        let cfg = tomlval::parse("[observability]\nmetrics_port = 9999\n").unwrap();
        assert_eq!(build_state(&cfg)["observability.metrics_port"], "9999");
    }

    #[test]
    fn a_conninfo_alone_implies_the_external_store_is_enabled() {
        let cfg =
            tomlval::parse("[integrations.ruvector_external]\nconninfo = \"host=db port=5432\"\n")
                .unwrap();
        assert_eq!(
            build_state(&cfg)["integrations.ruvector_external.enabled"],
            true
        );
    }

    #[test]
    fn an_empty_conninfo_leaves_the_explicit_flag_in_charge() {
        let cfg =
            tomlval::parse("[integrations.ruvector_external]\nconninfo = \"\"\nenabled = true\n")
                .unwrap();
        assert_eq!(
            build_state(&cfg)["integrations.ruvector_external.enabled"],
            true
        );

        let cfg = tomlval::parse("[integrations.ruvector_external]\nconninfo = \"\"\n").unwrap();
        assert_eq!(
            build_state(&cfg)["integrations.ruvector_external.enabled"],
            false
        );
    }

    #[test]
    fn manifest_values_override_defaults() {
        let cfg = tomlval::parse(
            "[federation]\nmode = \"client\"\nexternal_url = \"https://hub\"\n[desktop]\nenabled = true\n",
        )
        .unwrap();
        let s = build_state(&cfg);
        assert_eq!(s["federation.mode"], "client");
        assert_eq!(s["federation.external_url"], "https://hub");
        assert_eq!(s["desktop.enabled"], true);
    }

    #[test]
    fn the_derived_flag_sits_directly_before_conninfo() {
        let state = build_state(&Value::Object(Map::new()));
        let keys: Vec<&String> = state.as_object().unwrap().keys().collect();
        let i = keys
            .iter()
            .position(|k| *k == "integrations.ruvector_external.conninfo")
            .unwrap();
        assert_eq!(keys[i - 1], "integrations.ruvector_external.enabled");
    }
}
