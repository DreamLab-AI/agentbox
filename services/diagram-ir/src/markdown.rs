//! The one escaping helper both digests genuinely share.
//!
//! Everything built on top of it differs: the draw.io digest folds newlines
//! through `str.splitlines()` (inline `" · "`, table `" ⏎ "`), the Mermaid
//! digest does a plain `"\n"` replace for tables and escapes elsewhere with no
//! folding at all. Those variants live beside their own digest, deliberately.

use crate::entities::escape_no_quote;

/// `_escape_markdown` — HTML-escape (without quotes), then backslash-escape the
/// Markdown metacharacters.
pub fn escape_markdown(text: &str) -> String {
    let encoded = escape_no_quote(text);
    let mut out = String::with_capacity(encoded.len());
    for ch in encoded.chars() {
        if matches!(
            ch,
            '\\' | '`'
                | '*'
                | '{'
                | '}'
                | '['
                | ']'
                | '('
                | ')'
                | '#'
                | '+'
                | '-'
                | '.'
                | '!'
                | '_'
                | '|'
                | '>'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}
