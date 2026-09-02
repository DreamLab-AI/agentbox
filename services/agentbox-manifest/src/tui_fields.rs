//! State-document accessors and the two data tables `tui_write` renders from.
//!
//! Split out of `tui_write.rs` to keep both files reviewable: this module holds
//! the CPython-semantics helpers (`truthy`/`b`/`q`/`i` mirror the Python's
//! same-named one-liners) plus the provider table and the security-exception
//! emitter, while `tui_write.rs` holds the section-by-section rendering.

use serde_json::Value;

use crate::jsonio;

/// Python truthiness of a state value.
pub fn truthy(state: &Value, key: &str) -> bool {
    match state.get(key) {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Bool(true)) => true,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

/// `b()` — boolean field to a TOML literal.
pub fn b(state: &Value, key: &str) -> &'static str {
    if truthy(state, key) {
        "true"
    } else {
        "false"
    }
}

/// `q()` — string field to a double-quoted TOML value via `json.dumps`.
pub fn q(state: &Value, key: &str, default: &str) -> String {
    let v = state
        .get(key)
        .cloned()
        .unwrap_or_else(|| Value::String(default.to_string()));
    jsonio::ensure_ascii(&serde_json::to_string(&v).unwrap_or_else(|_| "\"\"".into()))
}

/// `s.get(key, default)` as a `&str`, for the plain-string reads.
pub fn sget<'a>(state: &'a Value, key: &str, default: &'a str) -> &'a str {
    state.get(key).and_then(Value::as_str).unwrap_or(default)
}

/// `i()` — integer field (held as a string in state) to a TOML integer,
/// falling back to `default` when `int()` would raise.
pub fn i(state: &Value, key: &str, default: i64) -> String {
    let raw = match state.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => {
            return n
                .as_i64()
                .or_else(|| n.as_f64().map(|f| f.trunc() as i64))
                .unwrap_or(default)
                .to_string()
        }
        Some(Value::Bool(v)) => return i64::from(*v).to_string(),
        _ => default.to_string(),
    };
    raw.parse::<i64>().unwrap_or(default).to_string()
}

/// `json.dumps(list)` with CPython's default `", "` item separator.
pub fn py_json_list(items: &[&str]) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|s| serde_json::to_string(s).unwrap_or_default())
        .collect();
    format!("[{}]", parts.join(", "))
}

pub const PROVIDERS: &[(&str, &str)] = &[
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("openai", "OPENAI_API_KEY"),
    ("gemini", "GOOGLE_API_KEY"),
    ("deepseek", "DEEPSEEK_API_KEY"),
    ("perplexity", "PERPLEXITY_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("context7", "CONTEXT7_API_KEY"),
    ("brave", "BRAVE_API_KEY"),
    ("ceramic", "CERAMIC_API_KEY"),
    ("github", "GITHUB_TOKEN"),
    ("zai", "ZAI_API_KEY"),
];

pub fn optional_env_vars(provider: &str) -> &'static [&'static str] {
    match provider {
        "openai" => &["OPENAI_BASE_URL"],
        "deepseek" => &["DEEPSEEK_BASE_URL"],
        "zai" => &["ZAI_ANTHROPIC_API_KEY", "ZAI_URL"],
        _ => &[],
    }
}

/// `[security.exceptions.*]` blocks — mirrors the validator's
/// `KNOWN_EXCEPTION_FEATURE_GATES` + `isFeatureActive` logic. Without these the
/// wizard's own `validate_candidate` step trips W021 for every active feature
/// that needs hardened-baseline relief, and W021 is blocking by design.
pub fn security_exceptions(s: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let gpu = sget(s, "gpu.backend", "none");

    if truthy(s, "desktop.enabled") {
        out.extend([
            "[security.exceptions.desktop]".to_string(),
            "tmpfs = [\"/tmp/.X11-unix\", \"/run/user/1000\"]".into(),
            String::new(),
        ]);
    }
    if gpu == "ollama-rocm" {
        out.extend([
            "[security.exceptions.gpu-rocm]".to_string(),
            "devices = [\"/dev/kfd\", \"/dev/dri\"]".into(),
            String::new(),
        ]);
    }
    if gpu == "ollama-cuda" || gpu == "local-cuda" {
        out.extend([
            "[security.exceptions.gpu-cuda]".to_string(),
            "runtime = \"nvidia\"".into(),
            "device_requests = [{driver = \"nvidia\", count = -1, capabilities = [[\"gpu\"]]}]"
                .into(),
            String::new(),
        ]);
    }
    if truthy(s, "skills.spatial_and_3d.gaussian_splatting") {
        out.extend([
            "[security.exceptions.gaussian-splatting]".to_string(),
            "inherits = [\"gpu-cuda\"]".into(),
            String::new(),
        ]);
    }
    if truthy(s, "skills.browser.playwright") {
        out.extend([
            "[security.exceptions.playwright]".to_string(),
            "cap_add = [\"SYS_ADMIN\"]".into(),
            "reason = \"chromium sandbox; SYS_ADMIN is the minimum privilege for Chromium user-ns sandbox inside a container\"".into(),
            String::new(),
        ]);
    }
    if truthy(s, "toolchains.code_server") {
        out.extend([
            "[security.exceptions.code-server]".to_string(),
            "writable_volumes = [\"codeserver-config:/home/devuser/.local/share/code-server\"]"
                .into(),
            String::new(),
        ]);
    }
    if truthy(s, "sovereign_mesh.relay.enabled") {
        out.extend([
            "[security.exceptions.nostr-relay]".to_string(),
            "writable_volumes = [\"nostr-relay-data:/var/lib/nostr-relay\"]".into(),
            "reason = \"nostr-rs-relay SQLite journal and WAL require a writable durable path\""
                .into(),
            String::new(),
        ]);
    }
    if truthy(s, "consultants.enabled") {
        out.extend([
            "[security.exceptions.consultants]".to_string(),
            "writable_volumes = [\"consultations-data:/var/lib/agentbox/consultations\"]".into(),
            "reason = \"consultant tier writes JSONL audit log per call\"".into(),
            String::new(),
        ]);
    }
    if sget(s, "adapters.pods", "local-solid-rs") == "local-solid-rs" {
        out.extend([
            "[security.exceptions.solid-pod-rs]".to_string(),
            "writable_volumes = [\"solid-data:/var/lib/solid\"]".into(),
            "reason = \"solid-pod-rs fs-backend requires atomic-rename writable storage under /var/lib/solid\"".into(),
            String::new(),
        ]);
    }
    out
}

/// `[providers.*]`, `[toolchains]` and the `[skills.*]` family.
///
/// Emitted for every provider whether enabled or not, so an operator can flip
/// a flag in place rather than hand-adding a block. `auth_mode` is coerced to
/// `api_key` for anything but the two legal values: a hand-edited manifest
/// setting `oauth` on a provider whose CLI has no sign-in flow trips validator
/// W040 and falls back to env-var semantics at runtime, so writing the coerced
/// value keeps the file honest about what will actually happen.
pub fn providers_and_toolchains(s: &Value) -> Vec<String> {
    let mut l: Vec<String> = Vec::new();
    for (name, env_var) in PROVIDERS {
        let enabled = truthy(s, &format!("providers.{name}.enabled"));
        let mut auth_mode = sget(s, &format!("providers.{name}.auth_mode"), "api_key");
        if auth_mode.is_empty() || (auth_mode != "api_key" && auth_mode != "oauth") {
            auth_mode = "api_key";
        }
        l.extend(vec![
                format!("[providers.{name}]"),
                format!("enabled  = {}", if enabled { "true" } else { "false" }),
                format!("env_var  = \"{env_var}\""),
                format!(
                    "optional_env_vars = {}",
                    py_json_list(optional_env_vars(name))
                ),
                format!("auth_mode = \"{auth_mode}\""),
            String::new(),
        ]);
    }

    l.extend(vec![
            "[toolchains]".into(),
            format!("claude          = {}", b(s, "toolchains.claude")),
            format!("claude_code     = {}", b(s, "toolchains.claude_code")),
            format!("ruflo           = {}", b(s, "toolchains.ruflo")),
            format!("claude_flow     = {}", b(s, "toolchains.claude_flow")),
            format!("agentic_qe      = {}", b(s, "toolchains.agentic_qe")),
            format!("nagual_qe       = {}", b(s, "toolchains.nagual_qe")),
            format!("antigravity_cli = {}", b(s, "toolchains.antigravity_cli")),
            format!("codex           = {}", b(s, "toolchains.codex")),
            format!("opencode        = {}", b(s, "toolchains.opencode")),
            format!("code_server     = {}", b(s, "toolchains.code_server")),
            format!("codebase_memory = {}", b(s, "toolchains.codebase_memory")),
            format!("rust            = {}", b(s, "toolchains.rust")),
            format!("cuda            = {}", b(s, "toolchains.cuda")),
            String::new(),
            "[skills.browser]".into(),
            format!("agent_browser = {}", b(s, "skills.browser.agent_browser")),
            format!("playwright    = {}", b(s, "skills.browser.playwright")),
            format!("qe_browser    = {}", b(s, "skills.browser.qe_browser")),
            String::new(),
            "[skills.media]".into(),
            format!("ffmpeg           = {}", b(s, "skills.media.ffmpeg")),
            format!("imagemagick      = {}", b(s, "skills.media.imagemagick")),
            format!(
                "comfyui_builtin  = {}",
                b(s, "skills.media.comfyui_builtin")
            ),
            String::new(),
            "[skills.spatial_and_3d]".into(),
            format!(
                "blender            = {}",
                b(s, "skills.spatial_and_3d.blender")
            ),
            format!(
                "qgis               = {}",
                b(s, "skills.spatial_and_3d.qgis")
            ),
            format!(
                "gaussian_splatting = {}",
                b(s, "skills.spatial_and_3d.gaussian_splatting")
            ),
            String::new(),
            "[skills.data_science]".into(),
            format!("pytorch = {}", b(s, "skills.data_science.pytorch")),
            format!("jupyter = {}", b(s, "skills.data_science.jupyter")),
            String::new(),
            "[skills.docs]".into(),
            format!("latex          = {}", b(s, "skills.docs.latex")),
            format!("mermaid        = {}", b(s, "skills.docs.mermaid")),
            format!("report_builder = {}", b(s, "skills.docs.report_builder")),
            String::new(),
            "[skills.ontology]".into(),
            format!("enabled = {}", b(s, "skills.ontology.enabled")),
            String::new(),
    ]);

    l
}

/// The `[integrations.*]` family.
///
/// `comfyui_external` and `solid_pod_rs` are emitted unconditionally so an
/// operator's tunings survive a wizard round-trip regardless of the current
/// slot selection (ADR-010); `ruvector_external` and `ragflow` appear only
/// when enabled, because an absent section is how those two stay off.
pub fn integrations(s: &Value) -> Vec<String> {
    let mut l: Vec<String> = Vec::new();
    if truthy(s, "integrations.comfyui_external.enabled") {
        l.extend(vec![
                "[integrations.comfyui_external]".into(),
                "enabled = true".into(),
                format!(
                    "url    = {}",
                    q(
                        s,
                        "integrations.comfyui_external.url",
                        "http://comfyui:8188"
                    )
                ),
                format!(
                    "ws_url = {}",
                    q(
                        s,
                        "integrations.comfyui_external.ws_url",
                        "ws://comfyui:8188/ws"
                    )
                ),
                String::new(),
        ]);
    } else {
        l.extend(vec![
                "[integrations.comfyui_external]".into(),
                "enabled = false".into(),
                "url    = \"http://comfyui:8188\"".into(),
                "ws_url = \"ws://comfyui:8188/ws\"".into(),
                String::new(),
        ]);
    }

    // solid-pod-rs is always emitted (ADR-010) so operator tunings survive a
    // wizard round-trip regardless of the current pods slot.
    l.extend(vec![
            "[integrations.solid_pod_rs]".into(),
            format!(
                "port                  = {}",
                i(s, "integrations.solid_pod_rs.port", 8484)
            ),
            format!(
                "bind                  = {}",
                q(s, "integrations.solid_pod_rs.bind", "127.0.0.1")
            ),
            format!(
                "storage               = {}",
                q(s, "integrations.solid_pod_rs.storage", "fs")
            ),
            format!(
                "storage_root          = {}",
                q(
                    s,
                    "integrations.solid_pod_rs.storage_root",
                    "/var/lib/solid"
                )
            ),
            format!(
                "base_url              = {}",
                q(
                    s,
                    "integrations.solid_pod_rs.base_url",
                    "http://127.0.0.1:8484"
                )
            ),
            format!(
                "enable_oidc           = {}",
                b(s, "integrations.solid_pod_rs.enable_oidc")
            ),
            format!(
                "enable_schnorr_verify = {}",
                b(s, "integrations.solid_pod_rs.enable_schnorr_verify")
            ),
            format!(
                "enable_dpop_cache     = {}",
                b(s, "integrations.solid_pod_rs.enable_dpop_cache")
            ),
            format!(
                "notifications          = {}",
                q(s, "integrations.solid_pod_rs.notifications", "websocket")
            ),
            format!(
                "log_level              = {}",
                q(s, "integrations.solid_pod_rs.log_level", "info")
            ),
            format!(
                "enable_did_nostr       = {}",
                b(s, "integrations.solid_pod_rs.enable_did_nostr")
            ),
            format!(
                "enable_webhook_signing = {}",
                b(s, "integrations.solid_pod_rs.enable_webhook_signing")
            ),
            format!(
                "enable_rate_limit      = {}",
                b(s, "integrations.solid_pod_rs.enable_rate_limit")
            ),
            format!(
                "enable_quota           = {}",
                b(s, "integrations.solid_pod_rs.enable_quota")
            ),
            format!(
                "jss_v04_compat         = {}",
                b(s, "integrations.solid_pod_rs.jss_v04_compat")
            ),
            format!(
                "rate_limit_per_sec     = {}",
                i(s, "integrations.solid_pod_rs.rate_limit_per_sec", 20)
            ),
            format!(
                "quota_default_bytes    = {}",
                i(
                    s,
                    "integrations.solid_pod_rs.quota_default_bytes",
                    10737418240
                )
            ),
            String::new(),
    ]);

    if truthy(s, "integrations.ruvector_external.enabled") {
        l.extend(vec![
                "[integrations.ruvector_external]".into(),
                "enabled = true".into(),
                format!(
                    "conninfo = {}",
                    q(s, "integrations.ruvector_external.conninfo", "")
                ),
                String::new(),
        ]);
    }
    if truthy(s, "integrations.ragflow.enabled") {
        l.extend(vec![
                "[integrations.ragflow]".into(),
                "enabled = true".into(),
                String::new(),
        ]);
    }

    l
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    fn state(pairs: &[(&str, Value)]) -> Value {
        let mut m = Map::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), v.clone());
        }
        Value::Object(m)
    }

    #[test]
    fn int_helper_falls_back_on_unparseable_input() {
        let s = state(&[("p", Value::String("not-a-number".into()))]);
        assert_eq!(i(&s, "p", 9091), "9091");
        let s = state(&[("p", Value::String("8080".into()))]);
        assert_eq!(i(&s, "p", 9091), "8080");
        assert_eq!(i(&state(&[]), "absent", 42), "42");
    }

    #[test]
    fn quoting_matches_json_dumps() {
        let s = state(&[("k", Value::String("a\"b".into()))]);
        assert_eq!(q(&s, "k", ""), "\"a\\\"b\"");
    }

    #[test]
    fn optional_env_var_lists_use_the_cpython_separator() {
        assert_eq!(
            py_json_list(&["ZAI_ANTHROPIC_API_KEY", "ZAI_URL"]),
            "[\"ZAI_ANTHROPIC_API_KEY\", \"ZAI_URL\"]"
        );
        assert_eq!(py_json_list(&[]), "[]");
    }
}
