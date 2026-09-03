//! `html.escape` / `html.unescape` equivalents.
//!
//! Both extractors and the self-check lean on CPython's exact unescaping
//! behaviour — the HTML5 name table with its semicolon-less legacy aliases, the
//! longest-prefix fallback (`&notit;` becomes `¬it;`), the windows-1252
//! remapping of numeric references in `0x80..=0x9F`, and the codepoints HTML5
//! declares invalid and drops outright.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::entities_table::HTML5_ENTITIES;

fn table() -> &'static HashMap<&'static str, &'static str> {
    static TABLE: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| HTML5_ENTITIES.iter().copied().collect())
}

/// `html.escape(text, quote=False)`.
pub fn escape_no_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
    out
}

/// CPython's `html.entities._invalid_charrefs`.
fn invalid_charref(number: u32) -> Option<&'static str> {
    Some(match number {
        0x00 => "\u{fffd}",
        0x0d => "\r",
        0x80 => "\u{20ac}",
        0x81 => "\u{81}",
        0x82 => "\u{201a}",
        0x83 => "\u{192}",
        0x84 => "\u{201e}",
        0x85 => "\u{2026}",
        0x86 => "\u{2020}",
        0x87 => "\u{2021}",
        0x88 => "\u{2c6}",
        0x89 => "\u{2030}",
        0x8a => "\u{160}",
        0x8b => "\u{2039}",
        0x8c => "\u{152}",
        0x8d => "\u{8d}",
        0x8e => "\u{17d}",
        0x8f => "\u{8f}",
        0x90 => "\u{90}",
        0x91 => "\u{2018}",
        0x92 => "\u{2019}",
        0x93 => "\u{201c}",
        0x94 => "\u{201d}",
        0x95 => "\u{2022}",
        0x96 => "\u{2013}",
        0x97 => "\u{2014}",
        0x98 => "\u{2dc}",
        0x99 => "\u{2122}",
        0x9a => "\u{161}",
        0x9b => "\u{203a}",
        0x9c => "\u{153}",
        0x9d => "\u{9d}",
        0x9e => "\u{17e}",
        0x9f => "\u{178}",
        _ => return None,
    })
}

/// CPython's `html.entities._invalid_codepoints` — these unescape to nothing.
fn invalid_codepoint(number: u32) -> bool {
    matches!(number, 0x1..=0x8 | 0xb | 0xe..=0x1f | 0x7f..=0x9f | 0xfdd0..=0xfdef)
        || (number & 0xfffe) == 0xfffe && number <= 0x10ffff
}

fn numeric_replacement(number: u32) -> String {
    if let Some(replacement) = invalid_charref(number) {
        return replacement.to_string();
    }
    if (0xd800..=0xdfff).contains(&number) || number > 0x10ffff {
        return "\u{fffd}".to_string();
    }
    if invalid_codepoint(number) {
        return String::new();
    }
    char::from_u32(number).map(String::from).unwrap_or_default()
}

fn named_replacement(token: &str) -> String {
    let names = table();
    if let Some(value) = names.get(token) {
        return (*value).to_string();
    }
    let chars: Vec<char> = token.chars().collect();
    for length in (2..chars.len()).rev() {
        let prefix: String = chars[..length].iter().collect();
        if let Some(value) = names.get(prefix.as_str()) {
            let tail: String = chars[length..].iter().collect();
            return format!("{value}{tail}");
        }
    }
    format!("&{token}")
}

fn named_token_char(ch: char) -> bool {
    !matches!(ch, '\t' | '\n' | '\u{0c}' | ' ' | '<' | '&' | '#' | ';')
}

/// `html.unescape(text)`.
pub fn unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'&' {
            let ch = text[index..].chars().next().unwrap();
            out.push(ch);
            index += ch.len_utf8();
            continue;
        }
        let rest = &text[index + 1..];
        if let Some((token, consumed)) = numeric_token(rest) {
            out.push_str(&numeric_replacement(token));
            index += 1 + consumed;
            continue;
        }
        if let Some((token, consumed)) = named_token(rest) {
            out.push_str(&named_replacement(token));
            index += 1 + consumed;
            continue;
        }
        out.push('&');
        index += 1;
    }
    out
}

/// `#[0-9]+;?` and `#[xX][0-9a-fA-F]+;?`; returns the value and byte length.
fn numeric_token(rest: &str) -> Option<(u32, usize)> {
    let bytes = rest.as_bytes();
    if bytes.first() != Some(&b'#') {
        return None;
    }
    let (radix, start) = match bytes.get(1) {
        Some(b'x') | Some(b'X') => (16u32, 2usize),
        _ => (10u32, 1usize),
    };
    let mut end = start;
    while end < bytes.len() && (bytes[end] as char).is_digit(radix) {
        end += 1;
    }
    if end == start {
        return None;
    }
    let mut value: u32 = 0;
    for byte in &bytes[start..end] {
        let digit = (*byte as char).to_digit(radix).unwrap_or(0);
        value = value.saturating_mul(radix).saturating_add(digit);
        if value > 0x0011_0000 {
            value = 0x0011_0000;
        }
    }
    let consumed = if bytes.get(end) == Some(&b';') {
        end + 1
    } else {
        end
    };
    Some((value, consumed))
}

/// `[^\t\n\f <&#;]{1,32};?`; returns the token (with any `;`) and byte length.
fn named_token(rest: &str) -> Option<(&str, usize)> {
    let mut end = 0usize;
    let mut taken = 0usize;
    for (offset, ch) in rest.char_indices() {
        if taken == 32 || !named_token_char(ch) {
            break;
        }
        end = offset + ch.len_utf8();
        taken += 1;
    }
    if taken == 0 {
        return None;
    }
    if rest.as_bytes().get(end) == Some(&b';') {
        end += 1;
    }
    Some((&rest[..end], end))
}
