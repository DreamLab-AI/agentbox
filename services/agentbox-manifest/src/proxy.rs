//! ADR-069: project `[interaction_plane.proxy]` into the nip98-proxy config file.
//!
//! `supervisord`'s `environment=` cannot carry JSON, so the boot-class route
//! table and pubkey allowlist for the sovereign ingress travel through a file.
//! The proxy fails closed on malformed content, which makes this one of the
//! strict byte-for-byte consumers: the output is `json.dump(..., indent=2)`
//! with no trailing newline.
//!
//! Reconciled every boot, and an absent section *removes* the file so the proxy
//! falls back to its baked env rather than honouring a stale allowlist.

use std::path::Path;

use serde_json::{Map, Value};

use crate::{jsonio, tomlval};

pub fn project(manifest_path: &Path, out_path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(manifest_path)
        .map_err(|e| format!("{}: {e}", manifest_path.display()))?;
    let cfg = tomlval::parse(&text).map_err(|e| format!("{}: {e}", manifest_path.display()))?;

    let routes = array_or_absent(&cfg, "interaction_plane.proxy.routes")?;
    let allowed = array_or_absent(&cfg, "interaction_plane.proxy.allowed_pubkeys")?;

    if routes.is_empty() && allowed.is_empty() {
        if out_path.exists() {
            std::fs::remove_file(out_path).map_err(|e| format!("{}: {e}", out_path.display()))?;
            println!("[nip98-proxy] config section absent — removed stale config file");
        }
        return Ok(());
    }

    let mut out = Map::new();
    out.insert("routes".into(), Value::Array(routes.clone()));
    out.insert("allowedPubkeys".into(), Value::Array(allowed.clone()));

    if let Some(dir) = out_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    // Atomic: the proxy polls for this file and must never read half of it.
    jsonio::write_atomic(out_path, &Value::Object(out), false)
        .map_err(|e| format!("{}: {e}", out_path.display()))?;
    println!(
        "[nip98-proxy] projected {} route(s), {} allowlisted pubkey(s)",
        routes.len(),
        allowed.len()
    );
    Ok(())
}

/// An absent key is an empty list; a key holding anything but an array is an
/// error. Reading a mistyped allowlist as absent would project "no allowlist",
/// which the proxy serves as "any valid signer" (W3-05).
fn array_or_absent(cfg: &Value, key: &str) -> Result<Vec<Value>, String> {
    match tomlval::get(cfg, key) {
        None => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(_) => Err(format!("[{key}] must be an array")),
    }
}

#[cfg(test)]
mod tests {
    use super::project;

    fn run(manifest: &str) -> (Result<(), String>, Option<String>) {
        let dir = tempfile::tempdir().unwrap();
        let manifest_path = dir.path().join("agentbox.toml");
        let out = dir.path().join("nip98-proxy-config.json");
        std::fs::write(&manifest_path, manifest).unwrap();
        let result = project(&manifest_path, &out);
        (result, std::fs::read_to_string(&out).ok())
    }

    #[test]
    fn a_string_allowlist_is_refused_and_writes_nothing() {
        let (result, written) =
            run("[interaction_plane.proxy]\nallowed_pubkeys = \"ab12\"\n");
        let err = result.unwrap_err();
        assert!(err.contains("allowed_pubkeys") && err.contains("array"), "{err}");
        assert_eq!(written, None);
    }

    #[test]
    fn a_mistyped_routes_value_is_refused() {
        let (result, written) = run("[interaction_plane.proxy]\nroutes = 3\n");
        assert!(result.is_err());
        assert_eq!(written, None);
    }

    #[test]
    fn an_array_allowlist_is_projected() {
        let key = "a".repeat(64);
        let (result, written) = run(&format!(
            "[interaction_plane.proxy]\nallowed_pubkeys = [\"{key}\"]\n"
        ));
        result.unwrap();
        assert!(written.unwrap().contains(&key));
    }

    #[test]
    fn an_absent_section_writes_nothing() {
        let (result, written) = run("[other]\nx = 1\n");
        result.unwrap();
        assert_eq!(written, None);
    }
}
