//! Byte-compatible JSON serialisation matching Python's
//! `json.dumps(value, indent=2)` — the convention used by every JSON writer
//! in `ingest.py`, `promote.py`, and `bulk_ingest.py`.
//!
//! Two behaviours must be reproduced exactly for on-disk byte parity:
//!
//! 1. **2-space pretty-printing** with `", "`/`": "` item/key separators —
//!    `serde_json::to_string_pretty` already matches Python's `indent=2`
//!    defaults here (comma with no trailing space before a newline, `": "`
//!    after each key).
//! 2. **`ensure_ascii=True`** (Python's default) — every non-ASCII character
//!    is escaped as `\uXXXX` (surrogate pairs above the BMP), never emitted
//!    as raw UTF-8. `serde_json` does not do this by default, so it is
//!    applied as a post-processing pass over the already-serialised string;
//!    this is safe because non-ASCII bytes can only occur inside already
//!    correctly-escaped JSON string values, never in structural characters.
//!
//! Field ORDER is controlled by the struct's declaration order (Rust
//! structs always serialise fields in declaration order — untouched by this
//! module) and must match the Python dict-literal order at each call site.

use serde::Serialize;

/// Serialise `value` exactly as Python's `json.dumps(value, indent=2)` would
/// (2-space indent, `ensure_ascii=True`). No trailing newline is added —
/// callers that want one (matching `"\n".join(...) + "\n"` sites) add it
/// themselves.
pub fn to_json_pretty_ascii<T: Serialize>(value: &T) -> serde_json::Result<String> {
    let pretty = serde_json::to_string_pretty(value)?;
    Ok(escape_non_ascii(&pretty))
}

fn escape_non_ascii(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let cp = c as u32;
        if cp < 128 {
            out.push(c);
        } else if cp > 0xFFFF {
            let v = cp - 0x10000;
            let high = 0xD800 + (v >> 10);
            let low = 0xDC00 + (v & 0x3FF);
            out.push_str(&format!("\\u{high:04x}\\u{low:04x}"));
        } else {
            out.push_str(&format!("\\u{cp:04x}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Sample {
        a: i32,
        b: Vec<i32>,
        c: String,
    }

    #[test]
    fn matches_python_indent_two_shape() {
        let s = Sample {
            a: 1,
            b: vec![],
            c: "hi".to_string(),
        };
        let json = to_json_pretty_ascii(&s).unwrap();
        assert_eq!(json, "{\n  \"a\": 1,\n  \"b\": [],\n  \"c\": \"hi\"\n}");
    }

    #[test]
    fn escapes_non_ascii_like_python_ensure_ascii() {
        let json = to_json_pretty_ascii(&"em\u{2014}dash".to_string()).unwrap();
        assert_eq!(json, "\"em\\u2014dash\"");
    }

    #[test]
    fn escapes_astral_as_surrogate_pair() {
        // U+1F600 GRINNING FACE -> Python: "😀"
        let json = to_json_pretty_ascii(&"\u{1F600}".to_string()).unwrap();
        assert_eq!(json, "\"\\ud83d\\ude00\"");
    }
}
