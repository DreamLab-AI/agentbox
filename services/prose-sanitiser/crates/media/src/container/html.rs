//! Provenance in HTML: meta tags, JSON-LD blocks and `data-ai*` attributes.

use std::sync::OnceLock;

use regex::bytes::{Captures, Regex as ByteRegex};
use serde_json::{json, Value};

use super::patterns::ai_meta_name_re_bytes;
use crate::image::markers::AI_META_HINTS;

fn meta_tag_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| ByteRegex::new(r"(?i-u)<meta\b[^>]*>").expect("static regex compiles"))
}

fn meta_attr_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r#"(?i-u)(name|property|content|generator)\s*=\s*["']([^"']*)["']"#)
            .expect("static regex compiles")
    })
}

/// Known AI vendor names for the `generator` meta tag. A plain CMS generator
/// (WordPress, Elementor) is CMS provenance, not AI-generator metadata.
fn generator_ai_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(
            r"(?i-u)claude|anthropic|openai|chatgpt|gemini|synthid|copilot|midjourney|dall.?e|stable.?diffusion",
        )
        .expect("static regex compiles")
    })
}

fn jsonld_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(
            r#"(?is-u)<script\b[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>.*?</script>"#,
        )
        .expect("static regex compiles")
    })
}

fn data_ai_attr_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r#"(?i-u)\bdata-ai[\w-]*\s*=\s*["'][^"']*["']"#)
            .expect("static regex compiles")
    })
}

fn data_ai_attr_with_space_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r#"(?i-u)\sdata-ai[\w-]*\s*=\s*["'][^"']*["']"#)
            .expect("static regex compiles")
    })
}

fn provenance_jsonld_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)DigitalSourceType|trainedAlgorithmicMedia|SoftwareAgent")
            .expect("static regex compiles")
    })
}

fn jsonld_c2pa_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)c2pa|contentcredential").expect("static regex compiles")
    })
}

fn c2pa_meta_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)c2pa|content.?credential").expect("static regex compiles")
    })
}

fn drop_meta_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)generator|claude|anthropic|openai|gemini|synthid|c2pa|aigc")
            .expect("static regex compiles")
    })
}

fn meta_attrs(tag: &[u8]) -> Vec<(String, Vec<u8>)> {
    meta_attr_re()
        .captures_iter(tag)
        .map(|capture| {
            (
                String::from_utf8_lossy(&capture[1]).to_lowercase(),
                capture[2].to_vec(),
            )
        })
        .collect()
}

/// True for a generator meta tag that is CMS provenance, not AI.
pub fn is_cms_generator_meta(tag: &[u8]) -> bool {
    let attrs = meta_attrs(tag);
    let lookup = |wanted: &str| {
        attrs
            .iter()
            .find(|(name, _)| name == wanted)
            .map(|(_, value)| value.clone())
    };
    let name_or_property = lookup("name")
        .or_else(|| lookup("property"))
        .or_else(|| lookup("generator"))
        .unwrap_or_default();
    if String::from_utf8_lossy(&name_or_property).to_lowercase() != "generator" {
        return false;
    }
    let content = lookup("content").unwrap_or_default();
    if generator_ai_re().is_match(&content) || generator_ai_re().is_match(tag) {
        return false;
    }
    true
}

/// The first `limit` characters of a lossily decoded slice.
fn snippet(bytes: &[u8], limit: usize) -> String {
    String::from_utf8_lossy(bytes).chars().take(limit).collect()
}

/// Inspect HTML for provenance markup.
pub fn inspect_html(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let mut findings: Vec<String> = Vec::new();
    let mut has_ai = false;
    let mut has_c2pa = false;

    // The first twelve hints are the vendor/provenance names worth matching
    // against raw tag text; the rest are too generic for a substring test.
    let lowered_hints: Vec<Vec<u8>> = AI_META_HINTS
        .iter()
        .take(12)
        .map(|hint| hint.to_ascii_lowercase())
        .collect();

    for tag in meta_tag_re().find_iter(data) {
        let tag = tag.as_bytes();
        if c2pa_meta_re().is_match(tag) {
            has_c2pa = true;
        }
        if is_cms_generator_meta(tag) {
            findings.push(format!("info: cms generator: {}", snippet(tag, 120)));
            continue;
        }
        let lowered_tag = tag.to_ascii_lowercase();
        let hint_hit = lowered_hints
            .iter()
            .any(|hint| lowered_tag.windows(hint.len()).any(|window| window == hint));
        if ai_meta_name_re_bytes().is_match(tag) || hint_hit {
            has_ai = true;
            findings.push(format!("meta: {}", snippet(tag, 120)));
        }
    }

    for block in jsonld_re().find_iter(data) {
        let blob = block.as_bytes();
        if ai_meta_name_re_bytes().is_match(blob) || provenance_jsonld_re().is_match(blob) {
            has_ai = true;
            findings.push("json-ld provenance-like block".to_string());
            if jsonld_c2pa_re().is_match(blob) {
                has_c2pa = true;
            }
        }
    }

    for attribute in data_ai_attr_re().find_iter(data) {
        has_ai = true;
        findings.push(format!("attr: {}", snippet(attribute.as_bytes(), 80)));
    }

    (has_c2pa, has_ai, findings, json!({}))
}

/// Strip provenance markup from HTML.
pub fn clean_html(data: &[u8]) -> (Vec<u8>, Vec<String>) {
    let mut actions: Vec<String> = Vec::new();

    let out = replace_all_with(meta_tag_re(), data, |captures| {
        let tag = captures.get(0).expect("group 0 always present").as_bytes();
        if is_cms_generator_meta(tag) {
            return tag.to_vec();
        }
        if ai_meta_name_re_bytes().is_match(tag) || drop_meta_re().is_match(tag) {
            actions.push(format!("drop meta: {}", snippet(tag, 80)));
            return Vec::new();
        }
        tag.to_vec()
    });

    let out = replace_all_with(jsonld_re(), &out, |captures| {
        let blob = captures.get(0).expect("group 0 always present").as_bytes();
        if ai_meta_name_re_bytes().is_match(blob) || provenance_jsonld_re().is_match(blob) {
            actions.push("drop json-ld provenance-like script".to_string());
            return Vec::new();
        }
        blob.to_vec()
    });

    let attribute_count = data_ai_attr_with_space_re().find_iter(&out).count();
    let out = if attribute_count > 0 {
        actions.push(format!("drop data-ai* attributes x{attribute_count}"));
        data_ai_attr_with_space_re()
            .replace_all(&out, &b""[..])
            .into_owned()
    } else {
        out
    };

    if actions.is_empty() {
        actions.push("no HTML AI meta removed".to_string());
    }
    (out, actions)
}

/// `Regex::replace_all` with a `FnMut` replacer over bytes.
fn replace_all_with(
    pattern: &ByteRegex,
    haystack: &[u8],
    mut replacer: impl FnMut(&Captures<'_>) -> Vec<u8>,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(haystack.len());
    let mut last = 0;
    for captures in pattern.captures_iter(haystack) {
        let whole = captures.get(0).expect("group 0 always present");
        out.extend_from_slice(&haystack[last..whole.start()]);
        out.extend_from_slice(&replacer(&captures));
        last = whole.end();
    }
    out.extend_from_slice(&haystack[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn a_cms_generator_is_context_not_a_finding() {
        let html = br#"<meta name="generator" content="WordPress 6.4">"#;
        let (c2pa, ai, findings, _) = inspect_html(html);
        assert!(!c2pa && !ai);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].starts_with("info: cms generator: "));

        // And it survives the clean.
        let (cleaned, actions) = clean_html(html);
        assert_eq!(text(cleaned), String::from_utf8_lossy(html));
        assert_eq!(actions, vec!["no HTML AI meta removed".to_string()]);
    }

    #[test]
    fn an_ai_generator_is_a_finding_and_is_dropped() {
        let html = br#"<meta name="generator" content="Claude">"#;
        let (_, ai, findings, _) = inspect_html(html);
        assert!(ai);
        assert!(findings[0].starts_with("meta: "));

        let (cleaned, actions) = clean_html(html);
        assert_eq!(text(cleaned), "");
        assert!(actions[0].starts_with("drop meta: "));
    }

    #[test]
    fn c2pa_meta_sets_the_c2pa_flag() {
        let (c2pa, _, _, _) = inspect_html(br#"<meta name="c2pa" content="urn:x">"#);
        assert!(c2pa);
    }

    #[test]
    fn provenance_json_ld_is_found_and_dropped() {
        let html = br#"<html><script type="application/ld+json">{"digitalSourceType":"trainedAlgorithmicMedia"}</script><p>Body</p></html>"#;
        let (_, ai, findings, _) = inspect_html(html);
        assert!(ai);
        assert!(findings.contains(&"json-ld provenance-like block".to_string()));

        let (cleaned, actions) = clean_html(html);
        assert!(actions.contains(&"drop json-ld provenance-like script".to_string()));
        let cleaned = text(cleaned);
        assert!(!cleaned.contains("trainedAlgorithmicMedia"));
        assert!(cleaned.contains("<p>Body</p>"));
    }

    #[test]
    fn ordinary_json_ld_survives() {
        let html = br#"<script type="application/ld+json">{"@type":"Article","headline":"Hills"}</script>"#;
        let (_, ai, _, _) = inspect_html(html);
        assert!(!ai);
        let (cleaned, _) = clean_html(html);
        assert!(text(cleaned).contains("Hills"));
    }

    #[test]
    fn data_ai_attributes_are_counted_and_stripped() {
        let html = br#"<div data-ai-model="x" data-ai-run="y" class="k">Body</div>"#;
        let (_, ai, findings, _) = inspect_html(html);
        assert!(ai);
        assert_eq!(findings.len(), 2);
        assert!(findings[0].starts_with("attr: "));

        let (cleaned, actions) = clean_html(html);
        assert!(actions.contains(&"drop data-ai* attributes x2".to_string()));
        assert_eq!(text(cleaned), r#"<div class="k">Body</div>"#);
    }

    #[test]
    fn a_clean_page_is_left_exactly_as_it_was() {
        let html = br#"<html><head><meta charset="utf-8"><title>Hills</title></head><body><p>Text</p></body></html>"#;
        let (c2pa, ai, findings, _) = inspect_html(html);
        assert!(!c2pa && !ai && findings.is_empty());
        let (cleaned, actions) = clean_html(html);
        assert_eq!(text(cleaned), String::from_utf8_lossy(html));
        assert_eq!(actions, vec!["no HTML AI meta removed".to_string()]);
    }

    #[test]
    fn undecodable_bytes_survive_the_clean() {
        let mut html = b"<p>".to_vec();
        html.push(0xFF);
        html.extend_from_slice(br#"</p><meta name="generator" content="Claude">"#);
        let (cleaned, _) = clean_html(&html);
        assert!(cleaned.contains(&0xFF));
        assert!(!cleaned.windows(6).any(|w| w == b"Claude"));
    }
}
