//! Python-compatible formatting primitives.
//!
//! The digests these binaries print embed Python `repr()` output verbatim
//! (`- shapes: {'rect': 3}`), so the port reproduces `repr`, `str.splitlines`,
//! `bool` spelling and `pathlib.PurePath` normalisation rather than
//! approximating them with Rust's own `Debug`/`Display`.

/// `str.splitlines()` — Python's boundary set, not just `\n`.
pub fn splitlines(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        let boundary = matches!(
            ch,
            '\n' | '\r'
                | '\u{0b}'
                | '\u{0c}'
                | '\u{1c}'
                | '\u{1d}'
                | '\u{1e}'
                | '\u{85}'
                | '\u{2028}'
                | '\u{2029}'
        );
        if boundary {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            lines.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

/// `str.strip()` — Python strips Unicode whitespace, which is wider than
/// Rust's `char::is_whitespace` in a couple of places but close enough that the
/// shared definition is `is_whitespace` plus the C0 separators Python includes.
pub fn is_py_space(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '\u{1c}' | '\u{1d}' | '\u{1e}' | '\u{1f}')
}

/// `str.strip()`.
pub fn strip(text: &str) -> &str {
    text.trim_matches(is_py_space)
}

/// `bool` spelled the Python way.
pub fn py_bool(value: bool) -> &'static str {
    if value {
        "True"
    } else {
        "False"
    }
}

/// `repr()` of a `str`.
pub fn repr_str(text: &str) -> String {
    let quote = if text.contains('\'') && !text.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::with_capacity(text.len() + 2);
    out.push(quote);
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// `repr()` of a `dict[str, int]` whose insertion order is already fixed.
pub fn repr_dict_str_int(items: &[(String, i64)]) -> String {
    let body: Vec<String> = items
        .iter()
        .map(|(key, value)| format!("{}: {}", repr_str(key), value))
        .collect();
    format!("{{{}}}", body.join(", "))
}

/// `repr()` of a `dict[int, int]`.
pub fn repr_dict_int_int(items: &[(i64, i64)]) -> String {
    let body: Vec<String> = items
        .iter()
        .map(|(key, value)| format!("{key}: {value}"))
        .collect();
    format!("{{{}}}", body.join(", "))
}

/// `repr()` of a `list[str]`.
pub fn repr_list_str(items: &[String]) -> String {
    let body: Vec<String> = items.iter().map(|item| repr_str(item)).collect();
    format!("[{}]", body.join(", "))
}

/// `repr()` of a `list[int]`.
pub fn repr_list_int(items: &[i64]) -> String {
    let body: Vec<String> = items.iter().map(|item| item.to_string()).collect();
    format!("[{}]", body.join(", "))
}

/// `str(pathlib.Path(value))` — collapses `.` and duplicate separators the way
/// `PurePath` does, so `./a.html` prints as `a.html` like the Python did.
pub fn path_str(value: &str) -> String {
    if value.is_empty() {
        return ".".to_string();
    }
    let absolute = value.starts_with('/');
    let double_root = value.starts_with("//") && !value.starts_with("///");
    let parts: Vec<&str> = value
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty() {
        return if absolute {
            if double_root {
                "//".to_string()
            } else {
                "/".to_string()
            }
        } else {
            ".".to_string()
        };
    }
    let joined = parts.join("/");
    if absolute {
        format!("{}{}", if double_root { "//" } else { "/" }, joined)
    } else {
        joined
    }
}

/// `len(text)` — Python counts code points, and both extractors report that
/// count when `--out` is used.
pub fn char_len(text: &str) -> usize {
    text.chars().count()
}

/// The file name component, `pathlib.Path(value).name`.
pub fn path_name(value: &str) -> String {
    let normalised = path_str(value);
    match normalised.rsplit_once('/') {
        Some((_, name)) => name.to_string(),
        None => {
            if normalised == "." {
                String::new()
            } else {
                normalised
            }
        }
    }
}

/// `pathlib.Path(value).stem` — the name with its final suffix removed.
pub fn path_stem(value: &str) -> String {
    let name = path_name(value);
    match name.rfind('.') {
        Some(0) | None => name,
        Some(index) => name[..index].to_string(),
    }
}

/// `pathlib.Path(value).suffix`, case-folded by the caller when needed.
pub fn path_suffix(value: &str) -> String {
    let name = path_name(value);
    match name.rfind('.') {
        Some(0) | None => String::new(),
        Some(index) => name[index..].to_string(),
    }
}
