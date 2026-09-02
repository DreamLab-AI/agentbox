//! TOML parsing, nested lookup, deep merge, and the canonical serialiser.
//!
//! The Python this replaces used `tomllib` to parse and a hand-rolled
//! `_dump_toml` (in `scripts/tui-write-manifest.py`) to write. Nothing in the
//! Python ever round-tripped comments or original spacing — `_dump_toml`
//! rebuilds the document from a plain dict — so `toml_edit` buys nothing here
//! and would in fact *change* the output. The `toml` crate with
//! `preserve_order` reproduces `tomllib`'s ordered-dict behaviour exactly,
//! which is what the byte-for-byte goldens depend on.
//!
//! Everything downstream works on `serde_json::Value` so one nested-lookup and
//! one merge implementation serve both the TOML and the JSON sites.

use serde_json::{Map, Value};

/// Parse TOML text into the JSON value model, preserving key order.
pub fn parse(text: &str) -> Result<Value, toml::de::Error> {
    Ok(toml_to_json(text.parse::<toml::Value>()?))
}

/// Read and parse a TOML file, yielding an empty table when it is missing or
/// malformed. Fail-open, matching every `try: ... except: cfg = {}` in the
/// entrypoint heredocs.
pub fn parse_file_lenient(path: &std::path::Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| parse(&t).ok())
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn toml_to_json(v: toml::Value) -> Value {
    match v {
        toml::Value::String(s) => Value::String(s),
        toml::Value::Integer(i) => Value::Number(i.into()),
        toml::Value::Float(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        toml::Value::Boolean(b) => Value::Bool(b),
        // tomllib yields datetime objects, which `_dump_toml_value` falls
        // through to `json.dumps(str(v))` — i.e. a quoted string. Matching that
        // keeps round-trips stable; agentbox.toml carries no datetimes today.
        toml::Value::Datetime(d) => Value::String(d.to_string()),
        toml::Value::Array(a) => Value::Array(a.into_iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => {
            let mut m = Map::new();
            for (k, v) in t {
                m.insert(k, toml_to_json(v));
            }
            Value::Object(m)
        }
    }
}

/// Nested lookup by dotted path. Returns `None` at the first missing or
/// non-object hop — the Rust spelling of `tui-read-manifest.py`'s `g()`.
pub fn get<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for seg in path.split('.') {
        cur = cur.as_object()?.get(seg)?;
        if cur.is_null() {
            return None;
        }
    }
    Some(cur)
}

/// Truthiness of a dotted path under TOML/Python rules: `true` only for a
/// literal boolean true, a non-zero number, or a non-empty string/array.
pub fn get_bool(root: &Value, path: &str, default: bool) -> bool {
    match get(root, path) {
        None => default,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(default),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(Value::Null) => default,
    }
}

/// Merge `overlay` into `base`; overlay wins for shared keys and two objects
/// recurse. A byte-faithful port of `_deep_merge` — base keys keep their
/// position, overlay-only keys append, which `preserve_order` reproduces.
pub fn deep_merge(base: &Value, overlay: &Value) -> Value {
    match (base, overlay) {
        (Value::Object(b), Value::Object(o)) => {
            let mut result = b.clone();
            for (k, v) in o {
                let merged = match result.get(k) {
                    Some(existing) if existing.is_object() && v.is_object() => {
                        deep_merge(existing, v)
                    }
                    _ => v.clone(),
                };
                result.insert(k.clone(), merged);
            }
            Value::Object(result)
        }
        _ => overlay.clone(),
    }
}

/// Serialise one TOML scalar — the port of `_dump_toml_value`.
pub fn dump_value(v: &Value) -> String {
    match v {
        Value::Bool(true) => "true".into(),
        Value::Bool(false) => "false".into(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                // CPython `repr(float)` is the shortest round-tripping form and
                // always carries a point; Rust's `{:?}` for f64 matches both.
                format!("{f:?}")
            } else {
                n.to_string()
            }
        }
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into()),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(dump_value).collect();
            format!("[{}]", parts.join(", "))
        }
        // Inline table — `_dump_toml_value`'s dict branch, used for dicts
        // nested inside arrays-of-tables.
        Value::Object(map) => {
            let inner: Vec<String> = map
                .iter()
                .map(|(k, val)| format!("{k} = {}", dump_value(val)))
                .collect();
            format!("{{{}}}", inner.join(", "))
        }
        Value::Null => "\"None\"".into(),
    }
}

/// Serialise a whole table — the port of `_dump_toml`.
///
/// Keys are partitioned exactly as the Python did: sub-tables become
/// `[section]` blocks, lists whose *first* element is a table become `[[section]]`
/// blocks, and everything else (an empty list included) is a scalar `k = v`.
pub fn dump(table: &Value, prefix: &str) -> String {
    let Some(map) = table.as_object() else {
        return String::new();
    };

    let mut scalars: Vec<(&String, &Value)> = Vec::new();
    let mut tables: Vec<(&String, &Value)> = Vec::new();
    let mut arrays_of_tables: Vec<(&String, &Vec<Value>)> = Vec::new();

    for (k, v) in map {
        match v {
            Value::Object(_) => tables.push((k, v)),
            Value::Array(items) if matches!(items.first(), Some(Value::Object(_))) => {
                arrays_of_tables.push((k, items))
            }
            _ => scalars.push((k, v)),
        }
    }

    let mut lines: Vec<String> = Vec::new();
    for (k, v) in scalars {
        lines.push(format!("{k} = {}", dump_value(v)));
    }
    for (k, v) in tables {
        let section = if prefix.is_empty() {
            k.to_string()
        } else {
            format!("{prefix}.{k}")
        };
        lines.push(format!("\n[{section}]"));
        lines.push(dump(v, &section));
    }
    for (k, items) in arrays_of_tables {
        let section = if prefix.is_empty() {
            k.to_string()
        } else {
            format!("{prefix}.{k}")
        };
        for item in items {
            lines.push(format!("\n[[{section}]]"));
            if let Some(im) = item.as_object() {
                for (ik, iv) in im {
                    lines.push(format!("{ik} = {}", dump_value(iv)));
                }
            }
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_preserves_document_order() {
        let v = parse("z = 1\na = 2\n").unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["z", "a"]);
    }

    #[test]
    fn nested_get_walks_dotted_paths() {
        let v = parse("[a.b]\nc = 7\n").unwrap();
        assert_eq!(get(&v, "a.b.c"), Some(&json!(7)));
        assert_eq!(get(&v, "a.b.missing"), None);
        assert_eq!(get(&v, "a.c.d"), None);
    }

    #[test]
    fn get_bool_matches_python_truthiness() {
        let v = parse("t = true\nf = false\ns = \"\"\nn = 0\n").unwrap();
        assert!(get_bool(&v, "t", false));
        assert!(!get_bool(&v, "f", true));
        assert!(!get_bool(&v, "s", true));
        assert!(!get_bool(&v, "n", true));
        assert!(get_bool(&v, "absent", true));
    }

    #[test]
    fn deep_merge_recurses_and_overlay_wins() {
        let base = json!({"a": {"x": 1, "y": 2}, "keep": true});
        let overlay = json!({"a": {"y": 99, "z": 3}});
        assert_eq!(
            deep_merge(&base, &overlay),
            json!({"a": {"x": 1, "y": 99, "z": 3}, "keep": true})
        );
    }

    #[test]
    fn deep_merge_keeps_base_key_positions() {
        let base: Value = serde_json::from_str(r#"{"first":1,"second":2}"#).unwrap();
        let overlay: Value = serde_json::from_str(r#"{"second":9,"third":3}"#).unwrap();
        let merged = deep_merge(&base, &overlay);
        let keys: Vec<&String> = merged.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["first", "second", "third"]);
    }

    #[test]
    fn empty_list_is_a_scalar_not_an_array_of_tables() {
        let v = json!({"allowed": []});
        assert_eq!(dump(&v, ""), "allowed = []");
    }

    #[test]
    fn array_of_tables_becomes_double_bracket_sections() {
        let v = json!({"pkg": [{"name": "a", "enabled": true}]});
        assert_eq!(dump(&v, ""), "\n[[pkg]]\nname = \"a\"\nenabled = true");
    }

    #[test]
    fn dump_value_covers_every_scalar_shape() {
        assert_eq!(dump_value(&json!(true)), "true");
        assert_eq!(dump_value(&json!(42)), "42");
        assert_eq!(dump_value(&json!(1.5)), "1.5");
        assert_eq!(dump_value(&json!("hi")), "\"hi\"");
        assert_eq!(dump_value(&json!([1, "a"])), "[1, \"a\"]");
        assert_eq!(dump_value(&json!({"k": 1})), "{k = 1}");
    }

    #[test]
    fn nested_tables_carry_the_dotted_prefix() {
        let v = json!({"a": {"b": {"c": 1}}});
        assert_eq!(dump(&v, ""), "\n[a]\n\n[a.b]\nc = 1");
    }
}
