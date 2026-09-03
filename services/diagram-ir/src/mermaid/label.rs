//! `clean_label` — flatten Mermaid label markup without interpreting it.
//!
//! Two of the Python's substitutions rely on lookaround, which the `regex`
//! crate does not provide, so they are hand-rolled here with the same
//! semantics: `.` never crosses a newline, and the scan is left-to-right and
//! non-overlapping.

use regex::Regex;
use std::sync::OnceLock;

use crate::entities::unescape;
use crate::pyfmt::{splitlines, strip};

fn br_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<br\s*/?>").unwrap())
}

fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

fn bold_star_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\*\*(.*?)\*\*").unwrap())
}

fn bold_underscore_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"__(.*?)__").unwrap())
}

pub(crate) fn is_word(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

/// `re.sub(r"(?<!&)#(quot|apos|amp|lt|gt);", r"&\1;", text)`.
fn restore_hash_entities(text: &str) -> String {
    const NAMES: &[&str] = &["quot", "apos", "amp", "lt", "gt"];
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'#' && (index == 0 || bytes[index - 1] != b'&') {
            let rest = &text[index + 1..];
            if let Some(name) = NAMES
                .iter()
                .find(|name| rest.starts_with(&format!("{name};")))
            {
                out.push('&');
                out.push_str(name);
                out.push(';');
                index += 1 + name.len() + 1;
                continue;
            }
        }
        let ch = text[index..].chars().next().expect("index is a boundary");
        out.push(ch);
        index += ch.len_utf8();
    }
    out
}

/// `re.sub(r"(?<!\w)[*_](.*?)[*_](?!\w)", r"\1", text)` — hand-rolled because
/// the lookaround is load-bearing and `.` must not cross a newline.
fn strip_emphasis(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < chars.len() {
        let opener = chars[index];
        let boundary_before = index == 0 || !is_word(chars[index - 1]);
        if (opener == '*' || opener == '_') && boundary_before {
            let mut cursor = index + 1;
            let mut closer = None;
            while cursor < chars.len() {
                let candidate = chars[cursor];
                let boundary_after = cursor + 1 >= chars.len() || !is_word(chars[cursor + 1]);
                if (candidate == '*' || candidate == '_') && boundary_after {
                    closer = Some(cursor);
                    break;
                }
                if candidate == '\n' {
                    break;
                }
                cursor += 1;
            }
            if let Some(closer) = closer {
                out.extend(&chars[index + 1..closer]);
                index = closer + 1;
                continue;
            }
        }
        out.push(opener);
        index += 1;
    }
    out
}

fn trim_wrapping_quotes(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut text = if chars.len() >= 2
        && chars[0] == chars[chars.len() - 1]
        && matches!(chars[0], '"' | '\'' | '`')
    {
        chars[1..chars.len() - 1].iter().collect::<String>()
    } else {
        text.to_string()
    };
    if text.starts_with('`') && text.ends_with('`') {
        let inner: Vec<char> = text.chars().collect();
        text = if inner.len() >= 2 {
            inner[1..inner.len() - 1].iter().collect()
        } else {
            String::new()
        };
    }
    text
}

/// `clean_label` — flatten Mermaid label markup without interpreting it.
pub fn clean_label(value: &str) -> String {
    let text = trim_wrapping_quotes(strip(value));
    let text = br_re().replace_all(&text, "\n").into_owned();
    let text = tag_re().replace_all(&text, "").into_owned();
    let text = restore_hash_entities(&text);
    let text = unescape(&text);
    let text = bold_star_re().replace_all(&text, "$1").into_owned();
    let text = bold_underscore_re().replace_all(&text, "$1").into_owned();
    let text = strip_emphasis(&text);
    let text = text.replace("\\\"", "\"").replace("\\'", "'");
    let joined = splitlines(&text)
        .iter()
        .map(|part| strip(part))
        .collect::<Vec<_>>()
        .join("\n");
    strip(&joined).to_string()
}
