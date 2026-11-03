//! Agentbox-only policy projection for the portable VisionCraft executor.
//!
//! This module knows the host manifest and environment override names. It does
//! not implement review execution or findings interpretation. Credential values
//! remain in the inherited environment; only their names enter policy JSON.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;

use serde_json::{json, Value};

const KEYS: &[&str] = &[
    "enabled",
    "agent",
    "model_auth",
    "model",
    "thinking_level",
    "fail_on",
    "max_duration",
    "batch_size",
    "concurrency",
    "ai_provider",
    "ai_api_key_env",
    "ai_base_url",
    "max_output_bytes",
];

fn project(
    text: &str,
    source: &str,
    environment: &BTreeMap<String, String>,
) -> Result<Value, String> {
    let document: toml::Value = toml::from_str(text)
        .map_err(|_| "deepsec-gate: invalid Agentbox TOML; policy was not applied".to_owned())?;
    // VisionCraft owns generic defaults. The host only declares its overrides.
    let mut policy = json!({ "policy_source": source });
    let section = match document.get("security") {
        None => None,
        Some(security) => {
            let security = security
                .as_table()
                .ok_or("deepsec-gate: security must be a table")?;
            match security.get("deepsec") {
                None => None,
                Some(section) => Some(
                    section
                        .as_table()
                        .ok_or("deepsec-gate: security.deepsec must be a table")?,
                ),
            }
        }
    };
    if let Some(section) = section {
        if section.keys().any(|key| !KEYS.contains(&key.as_str())) {
            return Err("deepsec-gate: unknown security.deepsec policy field".into());
        }
        for (key, value) in section {
            let value = if key == "enabled" {
                Value::Bool(
                    value
                        .as_bool()
                        .ok_or("deepsec-gate: enabled must be a boolean")?,
                )
            } else if ["batch_size", "concurrency", "max_output_bytes"].contains(&key.as_str()) {
                let count = value
                    .as_integer()
                    .filter(|n| *n > 0)
                    .ok_or_else(|| format!("deepsec-gate: {key} must be a positive integer"))?;
                Value::from(count)
            } else {
                Value::String(
                    value
                        .as_str()
                        .ok_or_else(|| format!("deepsec-gate: {key} must be a string"))?
                        .into(),
                )
            };
            policy[key] = value;
        }
    }
    for key in KEYS {
        let name = format!("DEEPSEC_GATE_{}", key.to_uppercase());
        if let Some(value) = environment.get(&name).filter(|value| !value.is_empty()) {
            policy[*key] = if *key == "enabled" {
                Value::Bool(match value.as_str() {
                    "true" => true,
                    "false" => false,
                    _ => return Err("deepsec-gate: enabled override must be true or false".into()),
                })
            } else if ["batch_size", "concurrency", "max_output_bytes"].contains(key) {
                let count = value
                    .parse::<u64>()
                    .ok()
                    .filter(|n| *n > 0)
                    .ok_or_else(|| {
                        format!("deepsec-gate: {key} override must be a positive integer")
                    })?;
                Value::from(count)
            } else {
                Value::String(value.clone())
            };
        }
    }
    // Keep the legacy case-insensitive severity override. Semantic/route and
    // duration validation belongs to the single portable policy validator.
    if let Some(value) = policy["fail_on"].as_str() {
        policy["fail_on"] = Value::String(value.to_uppercase());
    }
    Ok(policy)
}

/// Project host policy, then replace this process with the portable executor.
pub(crate) fn execute(args: &[OsString]) -> Result<(), String> {
    if args
        .iter()
        .any(|arg| arg == "--policy-json" || arg.to_string_lossy().starts_with("--policy-json="))
    {
        return Err("deepsec-gate: --policy-json is owned by the host adapter".into());
    }
    let explicit = std::env::var_os("AGENTBOX_CONFIG").filter(|value| !value.is_empty());
    let (text, source) = load_manifest(
        explicit.as_deref().map(Path::new),
        Path::new("/etc/agentbox.toml"),
    )?;
    execute_policy(args, &text, &source)
}

fn load_manifest(explicit: Option<&Path>, default: &Path) -> Result<(String, String), String> {
    let manifest = explicit.unwrap_or(default);
    let (text, source) = match std::fs::read_to_string(manifest) {
        Ok(text) => (text, manifest.to_string_lossy().into_owned()),
        Err(error) if explicit.is_none() && error.kind() == std::io::ErrorKind::NotFound => {
            (String::new(), "defaults".into())
        }
        Err(_) => {
            return Err("deepsec-gate: cannot read Agentbox manifest; paid review refused".into())
        }
    };
    Ok((text, source))
}

fn execute_policy(args: &[OsString], text: &str, source: &str) -> Result<(), String> {
    let mut environment = BTreeMap::new();
    for key in KEYS {
        let name = format!("DEEPSEC_GATE_{}", key.to_uppercase());
        match std::env::var(&name) {
            Ok(value) => {
                environment.insert(name, value);
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(_) => return Err("deepsec-gate: policy override is not valid UTF-8".into()),
        }
    }
    let policy = project(text, source, &environment)?;
    let json = serde_json::to_string(&policy).map_err(|_| "deepsec-gate: cannot encode policy")?;
    let mut command = std::process::Command::new("visioncraft");
    command.args(["deepsec", "--policy-json", &json]).args(args);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = command.exec();
        Err(format!("deepsec-gate: visioncraft unavailable ({:?}); install the pinned package; no fallback review ran", error.kind()))
    }
    #[cfg(not(unix))]
    Err("deepsec-gate: this Agentbox host adapter requires Unix process replacement".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_absent_default_manifest_may_use_defaults() {
        let absent =
            std::env::temp_dir().join(format!("visioncraft-absent-policy-{}", std::process::id()));
        assert!(!absent.exists());
        assert_eq!(
            load_manifest(None, &absent).unwrap(),
            (String::new(), "defaults".into())
        );
        assert!(load_manifest(Some(&absent), &absent).is_err());
    }

    #[test]
    fn defaults_belong_to_executor_and_explicit_false_is_typed() {
        let empty = BTreeMap::new();
        assert_eq!(
            project("", "defaults", &empty).unwrap(),
            json!({"policy_source":"defaults"})
        );
        assert_eq!(
            project("[security.deepsec]\nenabled = false", "host", &empty).unwrap()["enabled"],
            false
        );
    }

    #[test]
    fn malformed_or_unknown_policy_never_silently_defaults() {
        for text in [
            "[broken",
            "security = true",
            "[security]\ndeepsec = true",
            "[security.deepsec]\nenabled = 'true'",
            "[security.deepsec]\nbatch_size = 0",
            "[security.deepsec]\nmisspelled = true",
        ] {
            assert!(
                project(text, "fixture", &BTreeMap::new()).is_err(),
                "{text}"
            );
        }
    }
}
