//! YAML frontmatter provenance in Markdown.

use std::sync::OnceLock;

use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::patterns::{ai_meta_name_re, AI_FRONTMATTER_KEYS};

/// A leading `---` ... `---` frontmatter block.
fn frontmatter_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?s-u)\A---\r?\n(.*?)\r?\n---\r?\n?").expect("static regex compiles")
    })
}

/// A top-level `key:` line.
fn key_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^([A-Za-z0-9_.-]+)\s*:").expect("static regex compiles"))
}

/// Is this key one of the known provenance keys, or does it read like one?
fn key_is_provenance(key: &str) -> bool {
    AI_FRONTMATTER_KEYS.contains(&key.to_lowercase().as_str()) || ai_meta_name_re().is_match(key)
}

/// Split a frontmatter block into its lines, as `str` for pattern work.
fn block_lines(block: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(block)
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect()
}

/// Top-level keys only: nested mappings and list items belong to their parent.
fn is_continuation(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t') || line.starts_with('-')
}

/// Inspect Markdown frontmatter.
///
/// Returns `(has_c2pa, has_ai_metadata, findings, details)`.
pub fn inspect_markdown(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let mut findings: Vec<String> = Vec::new();
    let mut has_ai = false;
    let Some(captures) = frontmatter_re().captures(data) else {
        return (false, false, Vec::new(), json!({"has_frontmatter": false}));
    };
    let block = captures.get(1).expect("group 1 always present").as_bytes();

    let mut keys: Vec<String> = Vec::new();
    for line in block_lines(block) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || is_continuation(&line) {
            continue;
        }
        let Some(captures) = key_re().captures(&line) else {
            continue;
        };
        let key = captures[1].to_string();
        keys.push(key.clone());
        if key_is_provenance(&key) {
            has_ai = true;
            findings.push(format!("frontmatter key: {key}"));
        }
        // The value is checked too — `author: Claude` is provenance.
        let value = line.split_once(':').map(|(_, rest)| rest).unwrap_or("");
        if ai_meta_name_re().is_match(value) {
            has_ai = true;
            findings.push(format!("frontmatter value hit on {key}"));
        }
    }
    let c2pa = findings.iter().any(|finding| {
        let lowered = finding.to_lowercase();
        lowered.contains("c2pa") || lowered.contains("content")
    });
    (
        c2pa,
        has_ai,
        findings,
        json!({"has_frontmatter": true, "keys": keys}),
    )
}

/// Drop provenance keys (and their nested blocks) from Markdown frontmatter.
pub fn clean_markdown(data: &[u8]) -> (Vec<u8>, Vec<String>) {
    let mut actions: Vec<String> = Vec::new();
    let Some(captures) = frontmatter_re().captures(data) else {
        return (data.to_vec(), vec!["no YAML frontmatter".to_string()]);
    };
    let whole = captures.get(0).expect("group 0 always present");
    let block = captures.get(1).expect("group 1 always present").as_bytes();
    let body = &data[whole.end()..];

    let mut kept: Vec<String> = Vec::new();
    // Whether we are inside the nested block of a dropped top-level key.
    let mut dropping = false;
    for line in block_lines(block) {
        let trimmed = line.trim();

        // Blank lines and comments belong to whichever block we are inside.
        if trimmed.is_empty() || trimmed.starts_with('#') {
            if !dropping {
                kept.push(line);
            }
            continue;
        }
        // Continuation lines follow their parent.
        if is_continuation(&line) {
            if !dropping {
                kept.push(line);
            }
            continue;
        }
        let Some(captures) = key_re().captures(&line) else {
            dropping = false;
            kept.push(line);
            continue;
        };
        let key = captures[1].to_string();
        let value = line.split_once(':').map(|(_, rest)| rest).unwrap_or("");
        if key_is_provenance(&key) {
            actions.push(format!("drop frontmatter key: {key}"));
            dropping = true;
            continue;
        }
        if ai_meta_name_re().is_match(value) {
            actions.push(format!("drop frontmatter key (value hit): {key}"));
            dropping = true;
            continue;
        }
        dropping = false;
        kept.push(line);
    }

    if actions.is_empty() {
        actions.push("no AI frontmatter keys removed".to_string());
    }
    let rebuilt = kept.join("\n");
    let rebuilt = rebuilt.trim_matches('\n');

    let mut out = Vec::new();
    if rebuilt.is_empty() {
        // An empty block leaves the body alone, with its leading blank lines
        // stripped the way Python's `body.lstrip("\n")` did.
        let mut start = 0;
        while start < body.len() && body[start] == b'\n' {
            start += 1;
        }
        out.extend_from_slice(&body[start..]);
        actions.push("removed empty frontmatter block".to_string());
    } else {
        out.extend_from_slice(b"---\n");
        out.extend_from_slice(rebuilt.as_bytes());
        out.extend_from_slice(b"\n---\n");
        out.extend_from_slice(body);
    }
    (out, actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_without_frontmatter_is_left_alone() {
        let body = b"# Title\n\nBody text.\n";
        let (c2pa, ai, findings, details) = inspect_markdown(body);
        assert!(!c2pa && !ai && findings.is_empty());
        assert_eq!(details["has_frontmatter"], false);

        let (cleaned, actions) = clean_markdown(body);
        assert_eq!(cleaned, body);
        assert_eq!(actions, vec!["no YAML frontmatter".to_string()]);
    }

    #[test]
    fn provenance_keys_are_found_and_dropped_with_their_nested_block() {
        let source = b"---\ntitle: A post\ngenerator:\n  name: Claude\n  version: 1\nauthor: Jo\n---\n\nBody.\n";
        let (_, ai, findings, details) = inspect_markdown(source);
        assert!(ai);
        assert!(findings.contains(&"frontmatter key: generator".to_string()));
        assert_eq!(details["keys"], json!(["title", "generator", "author"]));

        let (cleaned, actions) = clean_markdown(source);
        assert!(actions.contains(&"drop frontmatter key: generator".to_string()));
        let text = String::from_utf8(cleaned).unwrap();
        assert_eq!(text, "---\ntitle: A post\nauthor: Jo\n---\n\nBody.\n");
        // The nested mapping went with its parent.
        assert!(!text.contains("Claude"));
    }

    #[test]
    fn a_value_hit_drops_the_key_too() {
        let source = b"---\ntitle: A post\nauthor: Claude\n---\nBody.\n";
        let (_, ai, findings, _) = inspect_markdown(source);
        assert!(ai);
        assert!(findings.contains(&"frontmatter value hit on author".to_string()));

        let (cleaned, actions) = clean_markdown(source);
        assert!(actions.contains(&"drop frontmatter key (value hit): author".to_string()));
        assert_eq!(
            String::from_utf8(cleaned).unwrap(),
            "---\ntitle: A post\n---\nBody.\n"
        );
    }

    #[test]
    fn emptying_the_block_removes_the_delimiters_and_leading_blank_lines() {
        let source = b"---\ngenerator: x\n---\n\n\nBody.\n";
        let (cleaned, actions) = clean_markdown(source);
        assert!(actions.contains(&"removed empty frontmatter block".to_string()));
        assert_eq!(String::from_utf8(cleaned).unwrap(), "Body.\n");
    }

    #[test]
    fn innocent_frontmatter_survives_untouched() {
        let source = b"---\ntitle: A post\ndate: 2026-01-01\ntags:\n  - one\n  - two\n---\nBody.\n";
        let (cleaned, actions) = clean_markdown(source);
        assert_eq!(actions, vec!["no AI frontmatter keys removed".to_string()]);
        assert_eq!(
            String::from_utf8(cleaned).unwrap(),
            String::from_utf8(source.to_vec()).unwrap()
        );
    }

    #[test]
    fn crlf_frontmatter_is_recognised() {
        let source = b"---\r\ngenerator: x\r\ntitle: y\r\n---\r\nBody.\n";
        let (_, ai, _, _) = inspect_markdown(source);
        assert!(ai);
        let (cleaned, actions) = clean_markdown(source);
        assert!(actions.contains(&"drop frontmatter key: generator".to_string()));
        assert!(String::from_utf8(cleaned).unwrap().contains("title: y"));
    }

    #[test]
    fn a_c2pa_key_sets_the_c2pa_flag() {
        let (c2pa, ai, _, _) = inspect_markdown(b"---\nc2pa: urn:x\n---\n");
        assert!(c2pa && ai);
    }

    #[test]
    fn comments_and_blank_lines_follow_the_block_they_sit_in() {
        let source =
            b"---\ntitle: t\n\n# a note\ngenerator: g\n# dropped note\nauthor: a\n---\nBody.\n";
        let (cleaned, _) = clean_markdown(source);
        let text = String::from_utf8(cleaned).unwrap();
        assert!(text.contains("# a note"));
        assert!(!text.contains("# dropped note"));
        assert!(text.contains("author: a"));
    }
}
