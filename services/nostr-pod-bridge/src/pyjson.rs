//! Byte-compatible re-implementation of CPython's `json.dumps` output shape.
//!
//! Several tools ported from Python are on hook hot paths whose stdout is
//! consumed by other programs (`claude-flow hooks post-task`,
//! `kg-proposal-extractor.js`). Their output must stay byte-identical, and
//! `serde_json`'s defaults differ from CPython's in two ways:
//!
//!   * separators — CPython's `json.dumps(obj)` emits `{"a": 1, "b": 2}`
//!     (`", "` between items, `": "` between key and value); `serde_json`
//!     emits `{"a":1,"b":2}`.
//!   * `ensure_ascii` — CPython escapes every non-ASCII scalar as `\uXXXX`
//!     (surrogate pairs above the BMP); `serde_json` passes UTF-8 through.
//!
//! Key order is preserved by the `preserve_order` feature on `serde_json`,
//! which matches Python dicts' insertion order.

use serde::Serialize;
use serde_json::ser::{CharEscape, Formatter, Serializer};
use std::io;

/// Escapes non-ASCII scalars as `\uXXXX`, exactly as `ensure_ascii=True` does.
fn write_ascii_escaped<W: ?Sized + io::Write>(w: &mut W, fragment: &str) -> io::Result<()> {
    if fragment.is_ascii() {
        return w.write_all(fragment.as_bytes());
    }
    let mut start = 0usize;
    for (idx, ch) in fragment.char_indices() {
        if ch.is_ascii() {
            continue;
        }
        if start < idx {
            w.write_all(&fragment.as_bytes()[start..idx])?;
        }
        let mut buf = [0u16; 2];
        for unit in ch.encode_utf16(&mut buf) {
            write!(w, "\\u{:04x}", unit)?;
        }
        start = idx + ch.len_utf8();
    }
    if start < fragment.len() {
        w.write_all(&fragment.as_bytes()[start..])?;
    }
    Ok(())
}

/// CPython's default `json.dumps(obj)` — compact, `", "` / `": "`, ASCII-safe.
#[derive(Clone, Debug, Default)]
pub struct PyCompactFormatter;

impl Formatter for PyCompactFormatter {
    fn write_string_fragment<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        fragment: &str,
    ) -> io::Result<()> {
        write_ascii_escaped(w, fragment)
    }

    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }

    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }

    fn begin_object_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        w.write_all(b": ")
    }
}

/// CPython's `json.dumps(obj, indent=N)` — newline-separated, ASCII-safe.
#[derive(Clone, Debug)]
pub struct PyPrettyFormatter {
    indent: usize,
    depth: usize,
    has_value: bool,
}

impl PyPrettyFormatter {
    pub fn new(indent: usize) -> Self {
        Self {
            indent,
            depth: 0,
            has_value: false,
        }
    }

    fn newline_indent<W: ?Sized + io::Write>(&self, w: &mut W) -> io::Result<()> {
        w.write_all(b"\n")?;
        for _ in 0..(self.indent * self.depth) {
            w.write_all(b" ")?;
        }
        Ok(())
    }
}

macro_rules! py_pretty_container {
    ($begin:ident, $end:ident, $open:literal, $close:literal) => {
        fn $begin<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
            self.depth += 1;
            self.has_value = false;
            w.write_all($open)
        }

        fn $end<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
            self.depth -= 1;
            if self.has_value {
                self.newline_indent(w)?;
            }
            self.has_value = true;
            w.write_all($close)
        }
    };
}

impl Formatter for PyPrettyFormatter {
    fn write_string_fragment<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        fragment: &str,
    ) -> io::Result<()> {
        write_ascii_escaped(w, fragment)
    }

    py_pretty_container!(begin_array, end_array, b"[", b"]");
    py_pretty_container!(begin_object, end_object, b"{", b"}");

    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if !first {
            w.write_all(b",")?;
        }
        self.newline_indent(w)
    }

    fn end_array_value<W: ?Sized + io::Write>(&mut self, _w: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }

    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        first: bool,
    ) -> io::Result<()> {
        if !first {
            w.write_all(b",")?;
        }
        self.newline_indent(w)
    }

    fn begin_object_value<W: ?Sized + io::Write>(&mut self, w: &mut W) -> io::Result<()> {
        w.write_all(b": ")
    }

    fn end_object_value<W: ?Sized + io::Write>(&mut self, _w: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }

    fn write_char_escape<W: ?Sized + io::Write>(
        &mut self,
        w: &mut W,
        e: CharEscape,
    ) -> io::Result<()> {
        // Delegate to the default escape table; only the ASCII-folding of
        // ordinary characters differs from serde_json.
        PyCompactFormatter.write_char_escape(w, e)
    }
}

fn render<T, F>(value: &T, formatter: F) -> String
where
    T: ?Sized + Serialize,
    F: Formatter,
{
    let mut buf = Vec::with_capacity(128);
    let mut ser = Serializer::with_formatter(&mut buf, formatter);
    value
        .serialize(&mut ser)
        .expect("serialising to a Vec<u8> cannot fail for JSON-representable values");
    String::from_utf8(buf).expect("JSON output is always valid UTF-8")
}

/// Equivalent to CPython `json.dumps(value)`.
pub fn dumps<T: ?Sized + Serialize>(value: &T) -> String {
    render(value, PyCompactFormatter)
}

/// Equivalent to CPython `json.dumps(value, indent=indent)`.
pub fn dumps_indent<T: ?Sized + Serialize>(value: &T, indent: usize) -> String {
    render(value, PyPrettyFormatter::new(indent))
}

/// `print(json.dumps(value))` — the shape every ported hook uses on stdout.
pub fn println_json<T: ?Sized + Serialize>(value: &T) {
    println!("{}", dumps(value));
}

/// `print(json.dumps(value), file=sys.stderr)`.
pub fn eprintln_json<T: ?Sized + Serialize>(value: &T) {
    eprintln!("{}", dumps(value));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compact_uses_python_separators() {
        let v = json!({"a": 1, "b": [1, 2, 3]});
        assert_eq!(dumps(&v), r#"{"a": 1, "b": [1, 2, 3]}"#);
    }

    #[test]
    fn compact_empty_containers_match_python() {
        assert_eq!(dumps(&json!({})), "{}");
        assert_eq!(dumps(&json!([])), "[]");
    }

    #[test]
    fn non_ascii_is_escaped_like_ensure_ascii() {
        // CPython: json.dumps({"k": "café"}) -> '{"k": "caf\\u00e9"}'
        assert_eq!(dumps(&json!({"k": "café"})), r#"{"k": "caf\u00e9"}"#);
    }

    #[test]
    fn astral_plane_uses_surrogate_pairs() {
        // CPython: json.dumps("🎉") -> '"\\ud83c\\udf89"'
        assert_eq!(dumps(&json!("🎉")), r#""\ud83c\udf89""#);
    }

    #[test]
    fn control_characters_keep_serde_escapes() {
        assert_eq!(dumps(&json!("a\nb\"c")), r#""a\nb\"c""#);
    }

    #[test]
    fn key_insertion_order_is_preserved() {
        let v = json!({"zebra": 1, "alpha": 2, "middle": 3});
        assert_eq!(dumps(&v), r#"{"zebra": 1, "alpha": 2, "middle": 3}"#);
    }

    #[test]
    fn pretty_matches_python_indent_two() {
        let v = json!({"a": 1, "b": [1, 2]});
        assert_eq!(
            dumps_indent(&v, 2),
            "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ]\n}"
        );
    }

    #[test]
    fn pretty_empty_containers_stay_inline() {
        assert_eq!(
            dumps_indent(&json!({"a": [], "b": {}}), 2),
            "{\n  \"a\": [],\n  \"b\": {}\n}"
        );
    }
}
