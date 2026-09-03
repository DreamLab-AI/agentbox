//! Frontmatter scalar quoting — shared by `ingest::ledger` (`_build_ledger_header`)
//! and `promote::dossier` (`write_working_page`), which carried byte-identical
//! `_yaml_scalar()` copies in the Python originals.
//!
//! VAULT-corpus-format V2: wikilinks are quoted strings, and dates /
//! boolean-looking bare words must not be re-typed by the YAML reader.

use regex::Regex;
use std::sync::OnceLock;

fn re_bool_like() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(true|false|null|yes|no|on|off|~)$").unwrap())
}

fn re_number_like() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$").unwrap())
}

fn re_date_like() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}").unwrap())
}

fn re_special_chars() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Mirrors Python's r'[:#\[\]{},"\']' (ingest.py) / r"""[:#\[\]{},"']""" (promote.py) — identical class.
    RE.get_or_init(|| Regex::new(r#"[:#\[\]{},"']"#).unwrap())
}

/// Quote a frontmatter scalar when a bare one would change its YAML type.
pub fn yaml_scalar(value: &str) -> String {
    let v = value;
    let first_special = v
        .chars()
        .next()
        .map(|c| "|>&*!%@`[{".contains(c))
        .unwrap_or(false);
    if v.is_empty() || first_special || v.trim() != v {
        return format!("\"{v}\"");
    }
    if re_bool_like().is_match(v) {
        return format!("\"{v}\"");
    }
    if re_number_like().is_match(v) {
        return format!("\"{v}\"");
    }
    if re_date_like().is_match(v) {
        return format!("\"{v}\"");
    }
    if re_special_chars().is_match(v) {
        let escaped = v.replace('\\', "\\\\").replace('"', "\\\"");
        return format!("\"{escaped}\"");
    }
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_word_unquoted() {
        assert_eq!(yaml_scalar("AI Daily Brief"), "AI Daily Brief");
    }

    #[test]
    fn empty_string_quoted() {
        assert_eq!(yaml_scalar(""), "\"\"");
    }

    #[test]
    fn bool_like_quoted() {
        assert_eq!(yaml_scalar("true"), "\"true\"");
        assert_eq!(yaml_scalar("Yes"), "\"Yes\"");
    }

    #[test]
    fn number_like_quoted() {
        assert_eq!(yaml_scalar("42"), "\"42\"");
        assert_eq!(yaml_scalar("3.14"), "\"3.14\"");
    }

    #[test]
    fn date_like_quoted() {
        assert_eq!(yaml_scalar("2026-08-24"), "\"2026-08-24\"");
    }

    #[test]
    fn special_chars_quoted_and_escaped() {
        assert_eq!(yaml_scalar("a: b"), "\"a: b\"");
        assert_eq!(yaml_scalar("say \"hi\""), "\"say \\\"hi\\\"\"");
    }

    #[test]
    fn leading_special_char_quoted() {
        assert_eq!(yaml_scalar("[bracketed"), "\"[bracketed\"");
    }
}
