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

use std::io;
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

/// `os.replace(tmp, path)` after writing `tmp` in the destination directory.
///
/// Matches `model-routing-project.py`'s `tempfile.mkstemp(dir=target_dir)` +
/// `os.replace` so the reader never observes a partial file.
pub fn write_atomic(path: &Path, value: &Value, trailing_newline: bool) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = dir.join(format!(".{}.tmp", file_stem(path)));
    write(&tmp, value, trailing_newline)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn file_stem(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "agentbox-manifest".into())
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
}
