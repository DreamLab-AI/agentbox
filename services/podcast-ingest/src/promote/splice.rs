//! Fail-closed JSON-splice extraction and application — port of
//! `extract_splice_json`, `SpliceError`, `apply_splice`, and
//! `clean_loom_response` from `promote.py`. Adapted (per the Python
//! docstring) from the page-judge scratchpad's `common.py`, reimplemented
//! locally so the skill stays self-contained.

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;
use thiserror::Error;

fn re_json_fence() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)```(?:json)?\s*(\{.*?\})\s*```").unwrap())
}
fn re_trailing_comma() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r",\s*([}\]])").unwrap())
}
fn re_full_fence() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)^```(?:json)?\n(.*)\n```$").unwrap())
}
fn re_heading() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // A section ends at the next heading. Vault pages are plain markdown
    // (`## Heading`); pages written before the 2026-09 migration were Logseq
    // outlines (`- ## Heading`). Both forms end a section.
    RE.get_or_init(|| Regex::new(r"(?m)^(?:-\s+)?#{1,6}\s+.+$").unwrap())
}

/// Port of `extract_splice_json` (also reused, unmodified, as
/// `promote.py::extract_judge_json`'s underlying brace-matching logic).
pub fn extract_splice_json(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    let owned_after_fence;
    let text: &str = if let Some(caps) = re_json_fence().captures(trimmed) {
        owned_after_fence = caps[1].to_string();
        &owned_after_fence
    } else {
        trimmed
    };

    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some(v);
    }

    let start = text.find('{')?;
    let mut depth = 0i32;
    for (idx, ch) in text[start..].char_indices() {
        let byte_idx = start + idx;
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = byte_idx + ch.len_utf8();
                    let candidate = &text[start..end];
                    if let Ok(v) = serde_json::from_str::<Value>(candidate) {
                        return Some(v);
                    }
                    let fixed = re_trailing_comma().replace_all(candidate, "$1").to_string();
                    return serde_json::from_str::<Value>(&fixed).ok();
                }
            }
            _ => {}
        }
    }
    None
}

#[derive(Debug, Error)]
pub enum SpliceError {
    #[error("unknown mode: {0:?}")]
    UnknownMode(Option<String>),
    #[error("missing/empty anchor")]
    MissingAnchor,
    #[error("missing/empty content")]
    MissingContent,
    #[error("anchor not found verbatim: {0:?}")]
    AnchorNotFound(String),
    #[error("anchor is ambiguous ({0} occurrences): {1:?}")]
    AnchorAmbiguous(usize, String),
}

/// Port of `apply_splice`.
pub fn apply_splice(original: &str, edit: &Value) -> Result<String, SpliceError> {
    let mode = edit.get("mode").and_then(|v| v.as_str());
    if !matches!(mode, Some("insert_after") | Some("replace_section")) {
        return Err(SpliceError::UnknownMode(mode.map(|s| s.to_string())));
    }
    let mode = mode.unwrap();

    let anchor = match edit.get("anchor").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Err(SpliceError::MissingAnchor),
    };
    let content = match edit.get("content").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return Err(SpliceError::MissingContent),
    };

    let count = original.matches(anchor).count();
    if count == 0 {
        return Err(SpliceError::AnchorNotFound(anchor.to_string()));
    }
    if count > 1 {
        return Err(SpliceError::AnchorAmbiguous(count, anchor.to_string()));
    }

    let anchor_start = original.find(anchor).unwrap();
    let anchor_end = anchor_start + anchor.len();

    if mode == "insert_after" {
        let line_end = original[anchor_end..].find('\n').map(|i| anchor_end + i);
        let after_line = line_end.map(|le| le + 1).unwrap_or(original.len());
        let anchor_line_start = original[..anchor_start]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        let anchor_line = &original[anchor_line_start..line_end.unwrap_or(original.len())];
        // "After a heading" with content that opens its own section means
        // after that whole section. Placed straight after the heading line the
        // new section would cut the old one off from its body, which the
        // judge scored coherence 1 on every candidate (2026-11-21).
        let insert_at = match (heading_level(anchor_line), first_heading_level(content)) {
            (Some(anchor_level), Some(_)) => section_end(original, after_line, anchor_level),
            _ => after_line,
        };
        return Ok(insert_block(original, insert_at, content));
    }

    let line_start = original[..anchor_start]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let section_end = re_heading()
        .find_at(original, anchor_end)
        .map(|m| m.start())
        .unwrap_or(original.len());
    let before = &original[..line_start];
    let after = &original[section_end..];
    let new_content = if content.ends_with('\n') {
        content.to_string()
    } else {
        format!("{content}\n")
    };
    Ok(format!("{before}{new_content}{after}"))
}

/// Heading level of one line, for both the plain (`## H`) and the Logseq
/// outline (`- ## H`) form. `None` when the line is not a heading.
fn heading_level(line: &str) -> Option<usize> {
    let t = line.trim_start();
    let t = t.strip_prefix("- ").map(str::trim_start).unwrap_or(t);
    let level = t.chars().take_while(|c| *c == '#').count();
    ((1..=6).contains(&level) && t[level..].starts_with(' ')).then_some(level)
}

/// Heading level of the first non-blank line of `content`, if it is one.
fn first_heading_level(content: &str) -> Option<usize> {
    content
        .lines()
        .find(|l| !l.trim().is_empty())
        .and_then(heading_level)
}

/// Byte offset where the section opened by a heading of `level` ends: the
/// start of the next heading at that level or above, searching from `from`
/// (a line start), or the end of the text.
fn section_end(text: &str, from: usize, level: usize) -> usize {
    let mut offset = from;
    for line in text[from..].split_inclusive('\n') {
        if heading_level(line).is_some_and(|l| l <= level) {
            return offset;
        }
        offset += line.len();
    }
    text.len()
}

/// Insert `content` as its own block at `at` (a line start). On a plain
/// markdown page a block that opens with a heading is set off by blank lines;
/// a Logseq outline keeps its bullets adjacent.
fn insert_block(original: &str, at: usize, content: &str) -> String {
    let (before, after) = original.split_at(at);
    let content = content.trim_matches('\n');
    let outline = content.trim_start().starts_with("- ");
    let mut out = String::with_capacity(original.len() + content.len() + 4);
    out.push_str(before);
    if !before.is_empty() && !before.ends_with('\n') {
        out.push('\n');
    }
    let spaced = !outline && first_heading_level(content).is_some();
    if spaced && !before.is_empty() && !out.ends_with("\n\n") {
        out.push('\n');
    }
    out.push_str(content);
    out.push('\n');
    if spaced && !after.is_empty() && !after.starts_with('\n') {
        out.push('\n');
    }
    out.push_str(after);
    out
}

/// Split a vault page into its YAML frontmatter block (including both `---`
/// fences and the newline after the closing one) and its body.
///
/// A page without frontmatter is all body. The splice is drafted against, and
/// applied to, the body only: the frontmatter is governed data that a prose
/// edit must never anchor on or alter.
pub fn split_frontmatter(text: &str) -> (&str, &str) {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return ("", text);
    };
    let mut offset = text.len() - rest.len();
    for line in rest.split_inclusive('\n') {
        offset += line.len();
        if line.trim_end_matches(['\n', '\r']) == "---" {
            return text.split_at(offset);
        }
    }
    ("", text)
}

/// Lowercase hex SHA-256 of a page, the identity a dossier records for the
/// text it was drafted against.
pub fn page_sha256(text: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Port of `clean_loom_response`.
pub fn clean_loom_response(text: &str) -> String {
    let re_think = {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new(r"(?s)<think>.*?</think>").unwrap())
    };
    let stripped = re_think.replace_all(text, "").trim().to_string();
    if let Some(caps) = re_full_fence().captures(&stripped) {
        caps[1].to_string()
    } else {
        stripped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_plain_json_object() {
        let v = extract_splice_json(
            "{\"mode\": \"insert_after\", \"anchor\": \"x\", \"content\": \"y\"}",
        )
        .unwrap();
        assert_eq!(v["mode"], "insert_after");
    }

    #[test]
    fn extracts_json_from_fence() {
        let text =
            "```json\n{\"mode\": \"insert_after\", \"anchor\": \"x\", \"content\": \"y\"}\n```";
        let v = extract_splice_json(text).unwrap();
        assert_eq!(v["anchor"], "x");
    }

    #[test]
    fn salvages_trailing_comma() {
        let text = "{\"mode\": \"insert_after\", \"anchor\": \"x\", \"content\": \"y\",}";
        let v = extract_splice_json(text).unwrap();
        assert_eq!(v["content"], "y");
    }

    #[test]
    fn returns_none_for_garbage() {
        assert!(extract_splice_json("not json at all").is_none());
    }

    #[test]
    fn apply_splice_insert_after_unique_anchor() {
        let original = "line one\nANCHOR\nline three\n";
        let edit = json!({"mode": "insert_after", "anchor": "ANCHOR", "content": "inserted"});
        let result = apply_splice(original, &edit).unwrap();
        assert_eq!(result, "line one\nANCHOR\ninserted\nline three\n");
    }

    #[test]
    fn apply_splice_rejects_ambiguous_anchor() {
        let original = "ANCHOR\nANCHOR\n";
        let edit = json!({"mode": "insert_after", "anchor": "ANCHOR", "content": "x"});
        assert!(matches!(
            apply_splice(original, &edit),
            Err(SpliceError::AnchorAmbiguous(2, _))
        ));
    }

    #[test]
    fn apply_splice_rejects_missing_anchor() {
        let original = "text";
        let edit = json!({"mode": "insert_after", "anchor": "nope", "content": "x"});
        assert!(matches!(
            apply_splice(original, &edit),
            Err(SpliceError::AnchorNotFound(_))
        ));
    }

    #[test]
    fn apply_splice_replace_section_stops_at_next_heading() {
        let original = "before\n- ### Section A\nold content\n- ### Section B\nkeep this\n";
        let edit = json!({"mode": "replace_section", "anchor": "- ### Section A", "content": "new content"});
        let result = apply_splice(original, &edit).unwrap();
        assert_eq!(result, "before\nnew content\n- ### Section B\nkeep this\n");
    }

    #[test]
    fn clean_loom_response_strips_think_tags_and_fence() {
        let text = "<think>reasoning</think>\n```json\n{\"a\": 1}\n```";
        assert_eq!(clean_loom_response(text), "{\"a\": 1}");
    }

    #[test]
    fn frontmatter_is_split_from_the_body() {
        let page = "---\ntype: Class\ntitle: X\n---\n# X\n\nBody.\n";
        let (head, body) = split_frontmatter(page);
        assert_eq!(head, "---\ntype: Class\ntitle: X\n---\n");
        assert_eq!(body, "# X\n\nBody.\n");
        assert_eq!(format!("{head}{body}"), page);
    }

    #[test]
    fn crlf_frontmatter_is_preserved_byte_for_byte() {
        let page = "---\r\ntype: Class\r\ntitle: X\r\n---\r\n# X\r\nBody.\r\n";
        let (head, body) = split_frontmatter(page);
        assert_eq!(head, "---\r\ntype: Class\r\ntitle: X\r\n---\r\n");
        assert_eq!(body, "# X\r\nBody.\r\n");
        assert_eq!(format!("{head}{body}"), page);
    }

    #[test]
    fn a_page_without_frontmatter_or_with_an_unclosed_block_is_all_body() {
        assert_eq!(split_frontmatter("# X\n"), ("", "# X\n"));
        assert_eq!(
            split_frontmatter("---\ntype: Class\n"),
            ("", "---\ntype: Class\n")
        );
    }

    #[test]
    fn replace_section_ends_at_a_plain_markdown_heading() {
        let page = "# T\n\n## Overview\nold\n\n## Later\nkeep\n";
        let edit = json!({"mode": "replace_section", "anchor": "## Overview", "content": "## Overview\nnew\n"});
        assert_eq!(
            apply_splice(page, &edit).unwrap(),
            "# T\n\n## Overview\nnew\n## Later\nkeep\n"
        );
    }

    #[test]
    fn page_sha256_matches_the_published_vector() {
        assert_eq!(
            page_sha256("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_new_section_anchored_on_a_heading_goes_after_that_whole_section() {
        let page =
            "# T\n\n## Landscape\nBody of landscape.\n\n### Detail\nMore.\n\n## References\nR.\n";
        let edit = json!({"mode": "insert_after", "anchor": "## Landscape", "content": "## Recent Developments\nNew."});
        assert_eq!(
            apply_splice(page, &edit).unwrap(),
            "# T\n\n## Landscape\nBody of landscape.\n\n### Detail\nMore.\n\n## Recent Developments\nNew.\n\n## References\nR.\n"
        );
    }

    #[test]
    fn a_new_section_after_the_last_section_lands_at_the_end() {
        let page = "# T\n\n## Landscape\nBody.\n";
        let edit = json!({"mode": "insert_after", "anchor": "## Landscape", "content": "## Recent Developments\nNew.\n"});
        assert_eq!(
            apply_splice(page, &edit).unwrap(),
            "# T\n\n## Landscape\nBody.\n\n## Recent Developments\nNew.\n"
        );
    }

    #[test]
    fn plain_content_after_a_prose_anchor_is_inserted_on_the_next_line() {
        let page = "Intro.\nTail.\n";
        let edit = json!({"mode": "insert_after", "anchor": "Intro.", "content": "- New fact."});
        assert_eq!(
            apply_splice(page, &edit).unwrap(),
            "Intro.\n- New fact.\nTail.\n"
        );
    }

    #[test]
    fn heading_levels_cover_plain_and_outline_forms() {
        assert_eq!(heading_level("## H"), Some(2));
        assert_eq!(heading_level("- ### H"), Some(3));
        assert_eq!(heading_level("#hashtag"), None);
        assert_eq!(heading_level("plain"), None);
    }
}
