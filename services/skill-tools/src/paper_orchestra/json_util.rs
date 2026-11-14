//! Small JSON helpers shared by the refinement-loop tools: Python-style
//! truthiness, tolerant numeric reads and an insertion-ordered map serialiser
//! (the crate does not enable `serde_json/preserve_order`, so key order would
//! otherwise be alphabetical).

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value;

/// Python truthiness of a JSON value (`null`, `false`, `0`, `""`, `[]` and `{}`
/// are falsy).
///
/// ```
/// use skill_tools::paper_orchestra::json_util::truthy;
/// use serde_json::json;
/// assert!(truthy(&json!({"a": 1})));
/// assert!(!truthy(&json!({})));
/// assert!(!truthy(&json!(0)));
/// ```
#[must_use]
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Reads `v` as `float(v)` would: numbers, numeric strings and booleans.
///
/// # Errors
///
/// A message when the value cannot be read as a number.
pub fn as_float(v: &Value) -> Result<f64, String> {
    match v {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| format!("{v} is not a finite number")),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| format!("could not convert string to float: {s:?}")),
        Value::Bool(b) => Ok(f64::from(u8::from(*b))),
        other => Err(format!("cannot read {other} as a number")),
    }
}

/// `obj.get(key, 0)` read as a float; absent keys give `0.0`.
///
/// # Errors
///
/// A message when the key is present but not numeric.
pub fn float_or_zero(obj: &Value, key: &str) -> Result<f64, String> {
    match obj.get(key) {
        None => Ok(0.0),
        Some(v) => as_float(v).map_err(|e| format!("{key}: {e}")),
    }
}

/// A list of `(key, value)` pairs serialised as a JSON object in order.
#[derive(Debug, Clone)]
pub struct Ordered<V>(pub Vec<(String, V)>);

impl<V: Serialize> Serialize for Ordered<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

/// Serialises with two-space indentation (Python's `json.dumps(indent=2)`),
/// keeping non-ASCII text as is.
///
/// # Errors
///
/// Any serialisation error.
pub fn to_pretty<T: Serialize>(v: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(v)
}

/// Writes `contents` to `path` through a sibling temporary file and a rename,
/// creating parent directories, so a crash never leaves a truncated file.
///
/// # Errors
///
/// Any I/O error.
pub fn write_atomic(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp{}", std::process::id()));
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthiness_matches_python() {
        assert!(!truthy(&json!("")) && truthy(&json!("x")) && !truthy(&json!(null)));
        assert!(truthy(&json!(0.5)) && !truthy(&json!(0.0)) && !truthy(&json!([])));
    }

    #[test]
    fn float_reading() {
        assert_eq!(as_float(&json!("3.5")).unwrap(), 3.5);
        assert!(as_float(&json!(null)).is_err());
        assert_eq!(float_or_zero(&json!({}), "x").unwrap(), 0.0);
    }

    #[test]
    fn ordered_keeps_insertion_order() {
        let o = Ordered(vec![("z".to_string(), 1), ("a".to_string(), 2)]);
        assert_eq!(serde_json::to_string(&o).unwrap(), r#"{"z":1,"a":2}"#);
    }
}
