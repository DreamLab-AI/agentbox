//! Helpers for treating a Loom-returned JSON object exactly the way
//! `ingest.py` treats a Python `dict` — `.get(key, default)` semantics
//! (default substituted only when the key is **absent**, not when present
//! with value `null`), and Python-style `str()`/f-string rendering of
//! whatever JSON scalar type came back.
//!
//! `ingest.py` never gives assertions a fixed schema (they are raw JSON
//! objects from the Loom, of variable shape); `Assertion` mirrors that.

use serde_json::{Map, Value};

pub type Assertion = Map<String, Value>;

/// `dict.get(key, default)` for a string field — Python's default applies
/// only when the key is missing; a present `null` renders as Python's
/// `str(None)` ("None"), matching f-string interpolation of a `None` value.
pub fn get_str(a: &Assertion, key: &str, default: &str) -> String {
    match a.get(key) {
        None => default.to_string(),
        Some(v) => py_display(v),
    }
}

/// `dict.get(key, default)` for a numeric field, coercing whatever JSON
/// scalar is present to `f64` (falls back to `default` for non-numeric or
/// unparseable values, since Python's own `>=`/`sort` comparisons would
/// otherwise raise `TypeError` — a crash path this port degrades gracefully
/// from rather than reproduces).
pub fn get_f64(a: &Assertion, key: &str, default: f64) -> f64 {
    match a.get(key) {
        None => default,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(default),
        _ => default,
    }
}

/// `dict.get(key, [])` for a string-list field (e.g. `ontology_terms`).
pub fn get_str_vec(a: &Assertion, key: &str) -> Vec<String> {
    a.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// `dict.get(key, 1)` for `tier`, which the extraction prompt specifies as
/// an integer 1/2/3 but is read back from arbitrary LLM JSON.
pub fn get_tier(a: &Assertion, key: &str, default: i64) -> i64 {
    match a.get(key) {
        None => default,
        Some(Value::Number(n)) => n
            .as_i64()
            .unwrap_or_else(|| n.as_f64().unwrap_or(default as f64) as i64),
        _ => default,
    }
}

/// Python truthiness of a JSON value pulled out of `dict.get(key)` — `None`,
/// `false`, `0`/`0.0`, `""`, `[]`, `{}` are all falsy; everything else is
/// truthy (including the string `"0"`, which Python also treats as truthy).
pub fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// `value = a.get(key, ""); if value: ...` — the common "only emit this
/// ledger sub-line when present and truthy" pattern in `_build_ledger_bullet`.
/// Returns `None` when the key is absent, or present but Python-falsy
/// (matching `if authority:` / `if volatility:`, which are false for an
/// explicit JSON `null`, not just an absent key).
pub fn get_truthy_display(a: &Assertion, key: &str) -> Option<String> {
    match a.get(key) {
        None => None,
        Some(v) if !is_truthy(v) => None,
        Some(v) => Some(py_display(v)),
    }
}

/// `a.get(key, default_value)` returning the raw JSON value (not yet
/// stringified) — used where a downstream dict lookup (e.g. `TIER_LABELS`)
/// needs the value's numeric identity, separately from its eventual
/// f-string rendering.
pub fn get_raw_or<'a>(a: &'a Assertion, key: &str, default: &'a Value) -> &'a Value {
    a.get(key).unwrap_or(default)
}

/// Python `str()`/f-string rendering of a JSON scalar pulled out of a
/// `dict.get(...)` call.
pub fn py_display(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".to_string(),
        Value::Bool(b) => {
            if *b {
                "True".to_string()
            } else {
                "False".to_string()
            }
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else if let Some(f) = n.as_f64() {
                format_py_float(f)
            } else {
                n.to_string()
            }
        }
        other => other.to_string(),
    }
}

fn format_py_float(f: f64) -> String {
    if f.is_finite() && f == f.trunc() {
        format!("{f:.1}")
    } else {
        format!("{f}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn get_str_default_on_absence() {
        let a: Assertion = Map::new();
        assert_eq!(get_str(&a, "source", "unknown"), "unknown");
    }

    #[test]
    fn get_str_null_renders_none() {
        let mut a: Assertion = Map::new();
        a.insert("source".to_string(), Value::Null);
        assert_eq!(get_str(&a, "source", "unknown"), "None");
    }

    #[test]
    fn get_f64_reads_number() {
        let mut a: Assertion = Map::new();
        a.insert("confidence".to_string(), json!(0.9));
        assert_eq!(get_f64(&a, "confidence", 0.0), 0.9);
    }

    #[test]
    fn get_tier_reads_int() {
        let mut a: Assertion = Map::new();
        a.insert("tier".to_string(), json!(2));
        assert_eq!(get_tier(&a, "tier", 1), 2);
    }

    #[test]
    fn py_display_whole_float_shows_one_decimal() {
        assert_eq!(py_display(&json!(1.0)), "1.0");
    }
}
