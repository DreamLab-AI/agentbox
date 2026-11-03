//! Python-compatible JSON read/write.
//!
//! Every JSON file this binary touches was previously written by CPython's
//! `json.dump(obj, fh, indent=2)`. Three properties of that call have to be
//! reproduced exactly, because the consumers (`.mcp.json` read by Claude Code,
//! `installed_plugins.json`, `llm-config.json` read by agentic-qe) are compared
//! byte-for-byte by the golden tests:
//!
//! 1. two-space indent, `": "` key separator, `","` item separator — this is
//!    what `serde_json::to_string_pretty` already emits;
//! 2. **insertion order preserved** — CPython dicts are ordered and `tomllib`
//!    /`json.load` preserve document order, so `serde_json` is built here with
//!    the `preserve_order` feature and `toml` likewise;
//! 3. **`ensure_ascii=True`** — CPython escapes every non-ASCII scalar as
//!    `\uXXXX` (surrogate pairs above the BMP). `serde_json` emits raw UTF-8
//!    instead, so [`ensure_ascii`] post-processes the rendered text.
//!
//! JSON structure characters are all ASCII, so any byte above 0x7F in a
//! rendered document is necessarily inside a string literal — a flat scan is
//! therefore correct and needs no parser state.

use std::io::{self, Write};
use std::path::Path;

use serde_json::Value;

/// Escape every non-ASCII scalar as `\uXXXX`, matching CPython `ensure_ascii=True`.
pub fn ensure_ascii(rendered: &str) -> String {
    if rendered.is_ascii() {
        return rendered.to_string();
    }
    let mut out = String::with_capacity(rendered.len());
    for ch in rendered.chars() {
        if ch.is_ascii() {
            out.push(ch);
        } else {
            let mut buf = [0u16; 2];
            for unit in ch.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

/// Render `value` exactly as `json.dumps(value, indent=2)` would.
pub fn dumps(value: &Value) -> String {
    ensure_ascii(&serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into()))
}

/// Read a JSON document, or `None` when it is absent or unparseable.
///
/// Unparseable-is-`None` mirrors the `try/except → sys.exit(0)` shape of the
/// entrypoint heredocs: a corrupt config never blocks boot.
pub fn read_opt(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write a JSON document with CPython's `json.dump(..., indent=2)` bytes.
///
/// `trailing_newline` selects between `json.dump(...)` (false — the entrypoint
/// heredocs) and `json.dump(...); fh.write("\n")` (true — model-routing and
/// provision-agent-stacks).
pub fn write(path: &Path, value: &Value, trailing_newline: bool) -> io::Result<()> {
    let mut text = dumps(value);
    if trailing_newline {
        text.push('\n');
    }
    std::fs::write(path, text)
}

/// Atomically replace a private configuration using a same-directory temp file.
///
/// The staging file is unpredictable, exclusively created and owner-only before
/// any bytes are written. Existing broad permissions are deliberately narrowed:
/// all callers write per-user configuration, including secret-bearing MCP data.
/// Failed staging, permission-setting, writing or replacement returns an error
/// and the temporary file is removed by RAII. JSON bytes retain CPython parity.
pub fn write_atomic(path: &Path, value: &Value, trailing_newline: bool) -> io::Result<()> {
    let dir = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    temporary.write_all(dumps(value).as_bytes())?;
    if trailing_newline {
        temporary.write_all(b"\n")?;
    }
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// Ensure `root["mcpServers"]` exists as an object and hand back a mutable
/// reference — the Rust spelling of `cfg.setdefault('mcpServers', {})`.
pub fn mcp_servers_mut(root: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !root.is_object() {
        *root = Value::Object(serde_json::Map::new());
    }
    let obj = root.as_object_mut().expect("just made an object");
    obj.entry("mcpServers")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let slot = obj.get_mut("mcpServers").expect("just inserted");
    if !slot.is_object() {
        *slot = Value::Object(serde_json::Map::new());
    }
    slot.as_object_mut().expect("just made an object")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ascii_passthrough_is_identity() {
        assert_eq!(ensure_ascii("{\n  \"a\": 1\n}"), "{\n  \"a\": 1\n}");
    }

    #[test]
    fn bmp_scalar_is_escaped_lowercase_hex() {
        // CPython: json.dumps("café") == '"caf\\u00e9"'
        assert_eq!(dumps(&json!("caf\u{e9}")), "\"caf\\u00e9\"");
    }

    #[test]
    fn astral_scalar_becomes_a_surrogate_pair() {
        // CPython: json.dumps("\U0001F600") == '"\\ud83d\\ude00"'
        assert_eq!(dumps(&json!("\u{1F600}")), "\"\\ud83d\\ude00\"");
    }

    #[test]
    fn pretty_shape_matches_cpython_indent_two() {
        let v = json!({"b": 1, "a": {"c": []}});
        assert_eq!(
            dumps(&v),
            "{\n  \"b\": 1,\n  \"a\": {\n    \"c\": []\n  }\n}"
        );
    }

    #[test]
    fn insertion_order_is_preserved_not_sorted() {
        let v: Value = serde_json::from_str(r#"{"z":1,"a":2}"#).unwrap();
        assert_eq!(dumps(&v), "{\n  \"z\": 1,\n  \"a\": 2\n}");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_ignores_predictable_temp_links_and_installs_private_bytes() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let scratch = tempfile::tempdir().unwrap();
        let path = scratch.path().join("config.json");
        let victim = scratch.path().join("unrelated");
        std::fs::write(&victim, "untouched").unwrap();
        symlink(&victim, scratch.path().join(".config.json.tmp")).unwrap();
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_atomic(&path, &json!({"token": "private-fixture"}), true).unwrap();
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "untouched");
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            dumps(&json!({"token": "private-fixture"})) + "\n"
        );
    }

    #[test]
    fn failed_atomic_replacement_preserves_target_and_removes_staging_file() {
        let scratch = tempfile::tempdir().unwrap();
        let path = scratch.path().join("existing-directory");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("retained"), "old").unwrap();
        assert!(write_atomic(&path, &json!({"token": "private-fixture"}), false).is_err());
        assert_eq!(
            std::fs::read_to_string(path.join("retained")).unwrap(),
            "old"
        );
        assert_eq!(std::fs::read_dir(scratch.path()).unwrap().count(), 1);
    }
}
