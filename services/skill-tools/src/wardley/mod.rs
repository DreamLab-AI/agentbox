//! Wardley Map generation, heuristics, interactive D3 rendering, strategic analysis,
//! and MCP-style stdin/stdout dispatch — ported from the Python `wardley-maps` skill
//! tooling (`skills/wardley-maps/tools/*.py`).
//!
//! Module map (mirrors the six ported Python files, one Rust module each, plus a
//! template-string split for the two large HTML/JS/CSS generators and a subprocess
//! bridge for the excluded spaCy-based NLP parser):
//!
//! | Rust module | Ported from |
//! |---|---|
//! | [`generator`] | `generate_wardley_map.py` |
//! | [`generator_template`] | (HTML/CSS wrapper strings for `generator`) |
//! | [`heuristics`] | `heuristics_engine.py` |
//! | [`interactive`] | `interactive_map_generator.py` |
//! | [`interactive_template`] | (D3/CSS/JS strings for `interactive`) |
//! | [`quick_map`] | `quick_map.py` |
//! | [`strategic_analyzer`] | `strategic_analyzer.py` |
//! | [`mapper`] | `wardley_mapper.py` |
//! | [`nlp_bridge`] | shells out to the untouched `advanced_nlp_parser.py` |

pub mod generator;
pub mod generator_template;
pub mod heuristics;
pub mod heuristics_patterns;
pub mod interactive;
pub mod interactive_template;
pub mod interactive_template_script;
pub mod mapper;
pub mod nlp_bridge;
pub mod quick_map;
pub mod strategic_analyzer;
pub mod strategic_analyzer_insights;

use serde_json::{Map, Value};

/// A Wardley Map component, represented the same way the Python originals used a
/// plain `dict`: an open, string-keyed bag of JSON values (`name`, `visibility`,
/// `evolution`, and occasionally `type` / `category` / `description` / `insights` /
/// `confidence` / ...). Keeping this as a JSON object rather than a fixed Rust struct
/// preserves the Python duck-typing every ported function relied on — callers can
/// carry arbitrary extra fields straight through untouched — and keeps the
/// `wardley-mapper` stdin/stdout JSON contract byte-for-byte compatible with
/// downstream tooling that already expects Python's dict shapes.
pub type CompDict = Map<String, Value>;

/// A dependency edge, always a `(source, target)` pair — the Rust equivalent of the
/// Python `(from_component, to_component)` 2-tuples used throughout.
pub type Dependency = (String, String);

/// Return shape shared by every component/dependency text-parsing entry point
/// (`quick_parse_input`, `advanced_nlp_parse`, `interactive_mode`, the NLP bridge).
pub type ParseResult = (Vec<CompDict>, Vec<Dependency>);

/// Python's `dict.get(key, default)` for a string field.
pub fn get_str(c: &CompDict, key: &str, default: &str) -> String {
    c.get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| default.to_string())
}

/// Python's `dict.get(key, default)` for a numeric field. Accepts any JSON number
/// (int or float) the way Python's duck-typed `float(...)` coercion would.
pub fn get_f64(c: &CompDict, key: &str, default: f64) -> f64 {
    c.get(key).and_then(Value::as_f64).unwrap_or(default)
}

/// Python's `dict.get(key, default)` for a boolean field.
pub fn get_bool(c: &CompDict, key: &str, default: bool) -> bool {
    c.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Format an `f64` the way Python's `str(float)` / bare f-string interpolation does.
///
/// Both Rust's `Display` impl for `f64` and CPython's `float.__repr__` use a
/// shortest-round-trip decimal algorithm and were verified (see the crate's Wardley
/// port report) to produce digit-for-digit identical output for every value these
/// generators compute — with exactly one difference: Rust drops the fractional part
/// for whole numbers (`800.0` formats as `"800"`), while Python always keeps at least
/// one digit after the point (`"800.0"`). This helper restores that trailing `.0` so
/// SVG/HTML coordinate output matches the Python original.
///
/// Only apply this to values that are genuinely floats in the Python source (i.e.
/// anything touched by `/` or multiplied by a float such as `evolution`/`visibility`).
/// Values that stay Python `int` all the way through (e.g. `self.margin`,
/// `self.height - self.margin`) must be formatted as plain integers instead — see the
/// per-call-site comments in [`generator`] for the exact int/float boundary in each
/// formula.
pub fn py_float_str(v: f64) -> String {
    let s = format!("{v}");
    if s.contains('.') || s.contains('e') || s.contains("inf") || s.contains("NaN") {
        s
    } else {
        format!("{s}.0")
    }
}

/// Python's `str.title()`: capitalise the first alphabetic character of every
/// maximal run of alphabetic characters, lowercase every other alphabetic character,
/// and leave every non-alphabetic character untouched. Used to replicate
/// `component_name.title()` calls in the ported `quick_map` regex parser.
pub fn py_title_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_is_alpha = false;
    for ch in s.chars() {
        if ch.is_alphabetic() {
            if prev_is_alpha {
                out.extend(ch.to_lowercase());
            } else {
                out.extend(ch.to_uppercase());
            }
            prev_is_alpha = true;
        } else {
            out.push(ch);
            prev_is_alpha = false;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn py_float_str_matches_python_semantics() {
        assert_eq!(py_float_str(800.0), "800.0");
        assert_eq!(py_float_str(155.0), "155.0");
        assert_eq!(py_float_str(112.5), "112.5");
        assert_eq!(py_float_str(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn title_case_matches_python() {
        assert_eq!(py_title_case("customer portal"), "Customer Portal");
        assert_eq!(py_title_case("api-gateway"), "Api-Gateway");
        assert_eq!(py_title_case("aws s3"), "Aws S3");
    }
}
