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
    RE.get_or_init(|| Regex::new(r"(?m)^-\s+#{1,6}\s+.+$").unwrap())
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
        let insert_at = line_end.map(|le| le + 1).unwrap_or(original.len());
        let new_text = format!(
            "{}{}\n{}",
            &original[..insert_at],
            content.trim_end_matches('\n'),
            &original[insert_at..]
        );
        return Ok(new_text);
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
}
