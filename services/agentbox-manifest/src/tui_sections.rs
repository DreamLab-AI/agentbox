//! The section-by-section TOML emission for the wizard.
//!
//! Split out of `tui_write.rs` so the emitter and the merge/CLI layer stay
//! separately reviewable. The order of the pushes here *is* the contract: the
//! golden test compares the rendered bytes against what the Python emitted, so
//! a reordered section is a failing test, not a cosmetic change.

use serde_json::Value;

use crate::jsonio;
use crate::tui_fields::{
    b, i, integrations, providers_and_toolchains, q, security_exceptions, sget, truthy,
};

/// Render the wizard's own TOML text, before any merge with an existing file.
pub fn render(s: &Value) -> String {
    let mut l: Vec<String> = Vec::new();
    let push = |lines: &mut Vec<String>, xs: Vec<String>| lines.extend(xs);

    push(
        &mut l,
        vec![
            "[core]".into(),
            "orchestration = \"ruflo-v3\"".into(),
            "vector_db = \"ruvector-embedded\"".into(),
            String::new(),
        ],
    );

    l.push("[federation]".into());
    l.push(format!("mode = {}", q(s, "federation.mode", "standalone")));
    if !sget(s, "federation.external_url", "").trim().is_empty() {
        l.push(format!(
            "external_url = {}",
            q(s, "federation.external_url", "")
        ));
    }
    l.push(String::new());

    push(
        &mut l,
        vec![
            "[adapters]".into(),
            format!("beads        = {}", q(s, "adapters.beads", "local-sqlite")),
            format!("pods         = {}", q(s, "adapters.pods", "local-solid-rs")),
            format!(
                "memory       = {}",
                q(s, "adapters.memory", "embedded-ruvector")
            ),
            format!("events       = {}", q(s, "adapters.events", "local-jsonl")),
            format!(
                "orchestrator = {}",
                q(s, "adapters.orchestrator", "local-process-manager")
            ),
            String::new(),
            "[gpu]".into(),
            format!("backend = {}", q(s, "gpu.backend", "none")),
            String::new(),
            "[desktop]".into(),
            format!("enabled    = {}", b(s, "desktop.enabled")),
            format!("stack      = {}", q(s, "desktop.stack", "hyprland-wayland")),
            format!("resolution = {}", q(s, "desktop.resolution", "1920x1080")),
            String::new(),
            "[sovereign_mesh]".into(),
            format!("enabled              = {}", b(s, "sovereign_mesh.enabled")),
            format!(
                "solid_pod            = {}",
                b(s, "sovereign_mesh.solid_pod")
            ),
            format!(
                "nostr_bridge         = {}",
                b(s, "sovereign_mesh.nostr_bridge")
            ),
            format!(
                "https_bridge         = {}",
                b(s, "sovereign_mesh.https_bridge")
            ),
            format!(
                "publish_agent_events = {}",
                b(s, "sovereign_mesh.publish_agent_events")
            ),
            String::new(),
            "[observability]".into(),
            format!(
                "metrics_port  = {}",
                i(s, "observability.metrics_port", 9091)
            ),
            format!(
                "log_level     = {}",
                q(s, "observability.log_level", "info")
            ),
        ],
    );
    let otlp = sget(s, "observability.otlp_endpoint", "")
        .trim()
        .to_string();
    if !otlp.is_empty() {
        l.push(format!(
            "otlp_endpoint = {}",
            jsonio::ensure_ascii(&serde_json::to_string(&otlp).unwrap_or_default())
        ));
    }
    l.push(String::new());

    // Always emit [consultants] so operator-edited model/home/timeout overrides
    // survive a wizard round-trip.
    push(
        &mut l,
        vec![
            "[consultants]".into(),
            format!("enabled              = {}", b(s, "consultants.enabled")),
            format!(
                "intelligence_signal  = {}",
                b(s, "consultants.intelligence_signal")
            ),
            format!(
                "log_dir              = {}",
                q(s, "consultants.log_dir", "/var/lib/agentbox/consultations")
            ),
            String::new(),
            "[consultants.codex]".into(),
            format!("enabled = {}", b(s, "consultants.codex.enabled")),
            "model      = \"gpt-5.4\"".into(),
            "home       = \"/home/devuser/.codex\"".into(),
            "timeout_ms = 180000".into(),
            String::new(),
            "[consultants.antigravity]".into(),
            format!("enabled = {}", b(s, "consultants.antigravity.enabled")),
            format!(
                "model      = {}",
                q(s, "consultants.antigravity.model", "gemini-3.8-flash")
            ),
            "home       = \"/home/devuser/.antigravity\"".into(),
            "timeout_ms = 180000".into(),
            String::new(),
            "[consultants.zai]".into(),
            format!("enabled = {}", b(s, "consultants.zai.enabled")),
            "model      = \"glm-5.3\"".into(),
            "home       = \"/home/zai-user\"".into(),
            "timeout_ms = 180000".into(),
            String::new(),
            "[consultants.perplexity]".into(),
            format!("enabled = {}", b(s, "consultants.perplexity.enabled")),
            "model      = \"sonar-pro\"".into(),
            "timeout_ms = 60000".into(),
            String::new(),
            "[consultants.deepseek]".into(),
            format!("enabled = {}", b(s, "consultants.deepseek.enabled")),
            "model      = \"deepseek-v4-flash\"".into(),
            "timeout_ms = 120000".into(),
            String::new(),
        ],
    );

    // ADR-041: gate keys come from the wizard; the per-activity routes table is
    // emitted for fresh installs only — the deep-merge below preserves an
    // operator-tuned [model_routing.routes] from an existing manifest.
    push(
        &mut l,
        vec![
            "[model_routing]".into(),
            format!("enabled             = {}", b(s, "model_routing.enabled")),
            format!(
                "primary_host        = {}",
                q(s, "model_routing.primary_host", "claude")
            ),
            format!(
                "aqe_agent_overrides = {}",
                b(s, "model_routing.aqe_agent_overrides")
            ),
            format!("dual_run            = {}", b(s, "model_routing.dual_run")),
            "aqe_llm_provider    = \"claude-code\"".into(),
            "aqe_fallback_chain  = \"claude-code,codex\"".into(),
            String::new(),
            "[model_routing.routes]".into(),
            "specification     = \"claude:claude-sonnet-5\"".into(),
            "architecture      = \"claude:claude-fable-5-1\"".into(),
            "design            = \"claude:claude-opus-5\"".into(),
            "implementation    = \"codex:gpt-5.5 -> claude:claude-fable-5-1\"".into(),
            "testing           = \"codex:gpt-5.5 -> claude:claude-opus-5\"".into(),
            "review            = \"claude:claude-sonnet-5\"".into(),
            "security-scan     = \"codex:gpt-5.5\"".into(),
            "security-analysis = \"claude:claude-fable-5-1\"".into(),
            "documentation     = \"codex:gpt-5.5\"".into(),
            "debugging         = \"claude:claude-fable-5-1\"".into(),
            "packaging         = \"codex:gpt-5.5\"".into(),
            "release           = \"claude:claude-sonnet-5\"".into(),
            String::new(),
            "[privacy_filter]".into(),
            format!("enabled = {}", b(s, "privacy_filter.enabled")),
            format!("mode    = {}", q(s, "privacy_filter.mode", "off")),
            format!("port    = {}", i(s, "privacy_filter.port", 9092)),
            format!("dtype   = {}", q(s, "privacy_filter.dtype", "bf16")),
            format!(
                "model   = {}",
                q(s, "privacy_filter.model", "openai/privacy-filter")
            ),
            String::new(),
            "[privacy_filter.policy]".into(),
            format!(
                "pods         = {}",
                q(s, "privacy_filter.policy.pods", "strict")
            ),
            format!(
                "memory       = {}",
                q(s, "privacy_filter.policy.memory", "strict")
            ),
            format!(
                "events       = {}",
                q(s, "privacy_filter.policy.events", "soft")
            ),
            format!(
                "beads        = {}",
                q(s, "privacy_filter.policy.beads", "soft")
            ),
            format!(
                "orchestrator = {}",
                q(s, "privacy_filter.policy.orchestrator", "off")
            ),
            format!(
                "inbound      = {}",
                q(s, "privacy_filter.policy.inbound", "soft")
            ),
            format!(
                "outbound     = {}",
                q(s, "privacy_filter.policy.outbound", "soft")
            ),
            String::new(),
            "[privacy_filter.entities]".into(),
            "enabled = []".into(),
            String::new(),
        ],
    );

    l.extend(providers_and_toolchains(s));

    if truthy(s, "sovereign_mesh.relay.enabled") {
        push(
            &mut l,
            vec![
                "[sovereign_mesh.relay]".into(),
                "enabled          = true".into(),
                format!(
                    "implementation   = {}",
                    q(s, "sovereign_mesh.relay.implementation", "nostr-rs-relay")
                ),
                format!(
                    "port             = {}",
                    i(s, "sovereign_mesh.relay.port", 7777)
                ),
                format!(
                    "bind             = {}",
                    q(s, "sovereign_mesh.relay.bind", "127.0.0.1")
                ),
                format!("expose           = {}", b(s, "sovereign_mesh.relay.expose")),
                format!(
                    "data_dir         = {}",
                    q(s, "sovereign_mesh.relay.data_dir", "/var/lib/nostr-relay")
                ),
                format!(
                    "ingress_policy   = {}",
                    q(s, "sovereign_mesh.relay.ingress_policy", "allowlist")
                ),
                "allowed_pubkeys  = []".into(),
                "allowed_kinds    = [1, 1059, 30078, 27235, 38000, 38100]".into(),
                format!(
                    "pod_bridge       = {}",
                    b(s, "sovereign_mesh.relay.pod_bridge")
                ),
                format!(
                    "external_fanout  = {}",
                    q(s, "sovereign_mesh.relay.external_fanout", "off")
                ),
                format!(
                    "max_event_bytes  = {}",
                    i(s, "sovereign_mesh.relay.max_event_bytes", 131072)
                ),
                format!(
                    "messages_per_sec = {}",
                    i(s, "sovereign_mesh.relay.messages_per_sec", 5)
                ),
                format!(
                    "retention_days   = {}",
                    i(s, "sovereign_mesh.relay.retention_days", 30)
                ),
                format!(
                    "allow_nip04      = {}",
                    b(s, "sovereign_mesh.relay.allow_nip04")
                ),
                format!(
                    "info_description = {}",
                    q(
                        s,
                        "sovereign_mesh.relay.info_description",
                        "Agentbox sovereign relay"
                    )
                ),
                format!(
                    "info_contact     = {}",
                    q(s, "sovereign_mesh.relay.info_contact", "")
                ),
                String::new(),
            ],
        );
    }

    l.extend(integrations(s));

    l.extend(security_exceptions(s));
    l.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tomlval;
    use serde_json::Map;

    fn state(pairs: &[(&str, Value)]) -> Value {
        let mut m = Map::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), v.clone());
        }
        Value::Object(m)
    }

    #[test]
    fn an_empty_external_url_is_omitted_entirely() {
        let out = render(&state(&[(
            "federation.external_url",
            Value::String("  ".into()),
        )]));
        assert!(!out.contains("external_url"));
    }

    #[test]
    fn a_set_external_url_is_emitted() {
        let out = render(&state(&[(
            "federation.external_url",
            Value::String("https://h".into()),
        )]));
        assert!(out.contains("external_url = \"https://h\""));
    }

    #[test]
    fn the_default_pods_slot_emits_its_security_exception() {
        let out = render(&state(&[]));
        assert!(out.contains("[security.exceptions.solid-pod-rs]"));
        assert!(!out.contains("[security.exceptions.desktop]"));
    }

    #[test]
    fn cuda_backends_emit_the_device_request_block() {
        let out = render(&state(&[(
            "gpu.backend",
            Value::String("local-cuda".into()),
        )]));
        assert!(out.contains("[security.exceptions.gpu-cuda]"));
        assert!(out.contains("device_requests = [{driver = \"nvidia\", count = -1"));
    }

    #[test]
    fn an_invalid_auth_mode_is_coerced_to_api_key() {
        let out = render(&state(&[(
            "providers.zai.auth_mode",
            Value::String("magic".into()),
        )]));
        assert!(out.contains("[providers.zai]\nenabled  = false\nenv_var  = \"ZAI_API_KEY\"\noptional_env_vars = [\"ZAI_ANTHROPIC_API_KEY\", \"ZAI_URL\"]\nauth_mode = \"api_key\""));
    }

    #[test]
    fn rendered_output_is_parseable_and_carries_the_core_marker() {
        let parsed = tomlval::parse(&render(&state(&[]))).unwrap();
        assert_eq!(parsed["core"]["orchestration"], "ruflo-v3");
        assert_eq!(parsed["observability"]["metrics_port"], 9091);
    }
}
