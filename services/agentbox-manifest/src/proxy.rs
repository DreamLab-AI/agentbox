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

    let routes = tomlval::get(&cfg, "interaction_plane.proxy.routes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let allowed = tomlval::get(&cfg, "interaction_plane.proxy.allowed_pubkeys")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

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
    jsonio::write(out_path, &Value::Object(out), false)
        .map_err(|e| format!("{}: {e}", out_path.display()))?;
    println!(
        "[nip98-proxy] projected {} route(s), {} allowlisted pubkey(s)",
        routes.len(),
        allowed.len()
    );
    Ok(())
}
