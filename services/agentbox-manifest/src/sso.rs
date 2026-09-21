//! ADR-2094 boot projection: `[features.sovereign_system_one]` → the two System
//! One consumers.
//!
//! The gate repoints the live skill router (ADR-2091) and the Jev verbatim
//! compaction plugin (ADR-2093) from TypeSafe's cloud API at a LAN façade that
//! speaks the same wire format. Three properties are load-bearing:
//!
//! * **Disabled projects NOTHING.** Not an empty export, not a default value —
//!   no output at all, so the cloud path is byte-identical to a manifest that
//!   never carried the block (ADR-2020). This is why the caller interpolates
//!   the output rather than reading individual keys.
//! * **Locality is asserted by the manifest, never inferred at the far end.**
//!   `backendLocal` is projected as an explicit boolean for the compaction
//!   plugin's `decide()`, and it is `true` only when the endpoint is a LAN or
//!   loopback host *and* the operator turned the gate on. A hostname alone is
//!   never treated as proof (ADR-2094 §5).
//! * **Fail-open.** An enabled gate with an unusable endpoint prints a
//!   diagnostic to stderr, projects nothing, and exits 0: a broken local
//!   backend must leave the consumers on their existing path, not block boot.

use std::path::Path;

use serde_json::Value;

use crate::tomlval;

/// Output shape requested by the caller.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// `export KEY='value'` lines for `runtime-env.sh` and the hook prefix.
    Shell,
    /// `key=value` lines for `claude plugin install --config key=value`.
    PluginConfig,
    /// The resolved projection as one JSON object (diagnostics, tests).
    Json,
}

impl std::str::FromStr for Format {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "shell" => Ok(Format::Shell),
            "plugin-config" => Ok(Format::PluginConfig),
            "json" => Ok(Format::Json),
            other => Err(format!(
                "unknown format {other:?} (expected shell, plugin-config or json)"
            )),
        }
    }
}

/// The resolved gate.
pub struct Projection {
    pub endpoint: String,
    pub model: String,
    pub shortlist_k: i64,
    pub window_k: i64,
    pub embeddings_url: String,
    pub embeddings_model: String,
    pub backend_local: bool,
}

/// Resolve the gate, or `None` when it is off or unusable.
///
/// `warn` receives one human-readable diagnostic per rejection; the caller
/// decides where it goes (stderr at boot, a vector in tests).
pub fn resolve(manifest: &Value, warn: &mut dyn FnMut(String)) -> Option<Projection> {
    let sso = tomlval::get(manifest, "features.sovereign_system_one")?;
    if !sso.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    let endpoint = sso
        .get("endpoint")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if endpoint.is_empty() {
        warn("[system-one] enabled but no endpoint — leaving the cloud path in place".into());
        return None;
    }
    if !is_local_endpoint(&endpoint) {
        // Refusing here rather than projecting keeps the promise in ADR-2094 §4:
        // there is no path by which a "sovereign" gate sends prompts off-LAN.
        warn(format!(
            "[system-one] endpoint {endpoint} is not a LAN/loopback host — refusing to project it (E075)"
        ));
        return None;
    }
    Some(Projection {
        model: sso
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("laya-typed-decisions")
            .to_string(),
        shortlist_k: sso.get("shortlist_k").and_then(Value::as_i64).unwrap_or(8),
        window_k: sso.get("window_k").and_then(Value::as_i64).unwrap_or(2),
        embeddings_url: sso
            .get("embeddings_url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        embeddings_model: sso
            .get("embeddings_model")
            .and_then(Value::as_str)
            .unwrap_or("bge-small-en-v1.5")
            .to_string(),
        // Enabled AND local: both conditions are the operator's, and this is
        // the only place the boolean is minted.
        backend_local: true,
        endpoint,
    })
}

/// Render the projection. Disabled or unusable ⇒ empty string.
pub fn render(manifest: &Value, format: Format, warn: &mut dyn FnMut(String)) -> String {
    let Some(p) = resolve(manifest, warn) else {
        return String::new();
    };
    match format {
        Format::Shell => [
            "export AGENTBOX_SYSTEM_ONE_ENABLED=1".to_string(),
            format!("export AGENTBOX_SYSTEM_ONE_ENDPOINT={}", shq(&p.endpoint)),
            format!("export AGENTBOX_SYSTEM_ONE_MODEL={}", shq(&p.model)),
            "export AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1".to_string(),
            format!("export AGENTBOX_SYSTEM_ONE_SHORTLIST_K={}", p.shortlist_k),
            format!("export AGENTBOX_SYSTEM_ONE_WINDOW_K={}", p.window_k),
            format!(
                "export AGENTBOX_SYSTEM_ONE_EMBEDDINGS_URL={}",
                shq(&p.embeddings_url)
            ),
            format!(
                "export AGENTBOX_SYSTEM_ONE_EMBEDDINGS_MODEL={}",
                shq(&p.embeddings_model)
            ),
            // The consumer-facing names: the router hook and /route read these.
            format!("export AGENTBOX_SKILL_ROUTE_API={}", shq(&p.endpoint)),
            format!("export AGENTBOX_SKILL_ROUTE_MODEL={}", shq(&p.model)),
        ]
        .join("\n"),
        // No quoting: `claude plugin install --config k=v` takes each pair as
        // one argv element, and the caller must pass them as such.
        Format::PluginConfig => [
            format!("baseUrl={}", p.endpoint),
            format!("model={}", p.model),
            "backendLocal=true".to_string(),
        ]
        .join("\n"),
        Format::Json => serde_json::to_string_pretty(&serde_json::json!({
            "enabled": true,
            "endpoint": p.endpoint,
            "model": p.model,
            "shortlist_k": p.shortlist_k,
            "window_k": p.window_k,
            "embeddings_url": p.embeddings_url,
            "embeddings_model": p.embeddings_model,
            "backend_local": p.backend_local,
        }))
        .unwrap_or_else(|_| "{}".to_string()),
    }
}

/// Boot entrypoint: print the projection and always exit 0.
pub fn run(manifest_path: &Path, format: Format) {
    let manifest = tomlval::parse_file_lenient(manifest_path);
    let mut warn = |m: String| eprintln!("{m}");
    let out = render(&manifest, format, &mut warn);
    if !out.is_empty() {
        println!("{out}");
    }
}

/// Single-quote a value for `sh`, closing and reopening around embedded quotes.
fn shq(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Loopback, RFC1918/CGNAT/link-local, `.local`/`.internal`, or a dotless
/// hostname (a Docker service such as `systemone`). Everything else is off-LAN.
///
/// Deliberately the same rule as `scripts/agentbox-config-validate.js`'s E075,
/// so the boot projection and the config gate cannot disagree about what
/// "local" means.
pub fn is_local_endpoint(endpoint: &str) -> bool {
    let rest = match endpoint.split_once("://") {
        Some(("http", rest)) | Some(("https", rest)) => rest,
        _ => return false,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = if let Some(end) = authority.find(']') {
        // [::1]:8097
        authority[1..end].to_string()
    } else {
        authority.split(':').next().unwrap_or("").to_string()
    };
    let host = host.to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    if host == "localhost" || host == "::1" || host.starts_with("127.") {
        return true;
    }
    if host.ends_with(".local") || host.ends_with(".internal") {
        return true;
    }
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() == 4 && octets.iter().all(|o| o.parse::<u8>().is_ok()) {
        let a: u8 = octets[0].parse().expect("checked");
        let b: u8 = octets[1].parse().expect("checked");
        return match a {
            10 => true,
            192 => b == 168,
            172 => (16..=31).contains(&b),
            100 => (64..=127).contains(&b), // CGNAT
            169 => b == 254,                // link-local
            _ => false,
        };
    }
    if host.starts_with("fc") || host.starts_with("fd") || host.starts_with("fe80:") {
        return true;
    }
    !host.contains('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(body: &str) -> Value {
        tomlval::parse(body).expect("valid toml")
    }

    const ENABLED: &str = r#"
[features.sovereign_system_one]
enabled = true
endpoint = "http://systemone:8097/v1/systemone"
model = "laya-typed-decisions"
shortlist_k = 8
window_k = 2
embeddings_url = "http://192.168.2.132:9997/v1/embeddings"
embeddings_model = "bge-small-en-v1.5"
"#;

    fn render_quiet(m: &Value, f: Format) -> (String, Vec<String>) {
        let mut warns = Vec::new();
        let out = render(m, f, &mut |w| warns.push(w));
        (out, warns)
    }

    #[test]
    fn disabled_projects_absolutely_nothing() {
        let m = manifest("[features.sovereign_system_one]\nenabled = false\nendpoint = \"http://systemone:8097/v1/systemone\"\n");
        for f in [Format::Shell, Format::PluginConfig, Format::Json] {
            let (out, warns) = render_quiet(&m, f);
            assert_eq!(out, "", "disabled gate must project nothing");
            assert!(warns.is_empty(), "disabled gate must not warn");
        }
    }

    #[test]
    fn a_missing_block_projects_nothing() {
        let (out, warns) = render_quiet(&manifest("[core]\nx = 1\n"), Format::Shell);
        assert_eq!(out, "");
        assert!(warns.is_empty());
    }

    #[test]
    fn enabled_projects_both_consumer_names() {
        let (out, warns) = render_quiet(&manifest(ENABLED), Format::Shell);
        assert!(warns.is_empty(), "unexpected warnings: {warns:?}");
        assert!(out.contains("export AGENTBOX_SKILL_ROUTE_API='http://systemone:8097/v1/systemone'"));
        assert!(out.contains("export AGENTBOX_SKILL_ROUTE_MODEL='laya-typed-decisions'"));
        assert!(out.contains("export AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1"));
    }

    #[test]
    fn plugin_config_carries_base_url_model_and_locality() {
        let (out, _) = render_quiet(&manifest(ENABLED), Format::PluginConfig);
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(
            lines,
            vec![
                "baseUrl=http://systemone:8097/v1/systemone",
                "model=laya-typed-decisions",
                "backendLocal=true",
            ]
        );
    }

    #[test]
    fn an_off_lan_endpoint_is_refused_not_projected() {
        let m = manifest(&ENABLED.replace(
            "http://systemone:8097/v1/systemone",
            "https://api.typesafe.ai/v1/systemone",
        ));
        let (out, warns) = render_quiet(&m, Format::Shell);
        assert_eq!(out, "", "a cloud endpoint must never be projected");
        assert_eq!(warns.len(), 1);
        assert!(warns[0].contains("not a LAN/loopback host"));
    }

    #[test]
    fn an_enabled_gate_without_an_endpoint_fails_open() {
        let m = manifest("[features.sovereign_system_one]\nenabled = true\n");
        let (out, warns) = render_quiet(&m, Format::Shell);
        assert_eq!(out, "");
        assert_eq!(warns.len(), 1);
        assert!(warns[0].contains("no endpoint"));
    }

    #[test]
    fn locality_matches_the_validators_rule() {
        for local in [
            "http://systemone:8097/v1/systemone",
            "http://127.0.0.1:8097/v1/systemone",
            "http://localhost:8097",
            "http://192.168.2.132:9997/v1",
            "http://10.10.10.1:8085/v1",
            "http://172.20.0.4:8097",
            "http://100.64.1.2:8097",
            "http://machinelearn.local:8097",
            "http://[::1]:8097/v1/systemone",
        ] {
            assert!(is_local_endpoint(local), "{local} should be local");
        }
        for remote in [
            "https://api.typesafe.ai/v1/systemone",
            "http://8.8.8.8:8097",
            "https://example.com",
            "ftp://systemone:8097",
            "systemone:8097",
            "",
        ] {
            assert!(!is_local_endpoint(remote), "{remote} should be off-LAN");
        }
    }

    #[test]
    fn a_quote_in_a_value_cannot_break_out_of_the_export() {
        let m = manifest(
            "[features.sovereign_system_one]\nenabled = true\nendpoint = \"http://systemone:8097/v1\"\nmodel = \"a'; rm -rf /\"\n",
        );
        let (out, _) = render_quiet(&m, Format::Shell);
        assert!(out.contains(r"export AGENTBOX_SYSTEM_ONE_MODEL='a'\''; rm -rf /'"));
    }
}
