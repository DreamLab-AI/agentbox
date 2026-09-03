//! ODF provenance: `meta.xml` and the parts around the document content.
//!
//! OpenDocument consolidates into `meta.xml` what OOXML spreads across three
//! `docProps` parts: `meta:generator`, `dc:creator`, `meta:editing-cycles`,
//! `meta:editing-duration` and the `meta:document-statistic` element. The
//! editing-duration and cycle count are the ODF twins of OOXML's `TotalTime`
//! and are removed unconditionally for the same reason.

use std::sync::OnceLock;

use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::docx::revalidate;
use super::{read_entries, write_entries, Entry};
use crate::container::patterns::{ai_meta_name_re_bytes, blob_hits};
use crate::image::markers::join_hits;

/// ODT parts that must never be dropped, whatever their bytes contain.
const ODT_KEEP_PARTS: &[&str] = &[
    "content.xml",
    "styles.xml",
    "mimetype",
    "META-INF/manifest.xml",
];

/// `meta.xml` elements removed unconditionally: tooling identity and editing
/// telemetry, neither of which is document content.
const ALWAYS_DROP_META: &[(&str, &str)] = &[
    ("meta:generator", "drop meta:generator"),
    ("meta:editing-cycles", "drop meta:editing-cycles"),
    ("meta:editing-duration", "drop meta:editing-duration"),
    ("meta:initial-creator", "drop meta:initial-creator"),
    ("meta:printed-by", "drop meta:printed-by"),
];

/// A regex matching one whole element, open tag through close tag.
fn element_re(name: &str) -> ByteRegex {
    ByteRegex::new(&format!(
        r"(?is-u)<{name}\b[^>]*>.*?</{name}\s*>|<{name}\b[^>]*/>"
    ))
    .expect("static regex compiles")
}

fn creator_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| element_re("dc:creator"))
}

fn generator_like_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)generator|claude|openai|anthropic|gemini")
            .expect("static regex compiles")
    })
}

/// Inspect an ODT. Every part is scanned, unlike DOCX.
pub fn inspect_odt(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let entries = match read_entries(data) {
        Ok(entries) => entries,
        Err(error) if error == "not a valid zip" => {
            return (
                false,
                false,
                vec!["not a valid ODT zip".to_string()],
                json!({}),
            )
        }
        Err(error) => return (false, false, vec![error], json!({})),
    };

    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    for entry in &entries {
        let (c2pa, ai, hits) = blob_hits(&entry.data);
        if c2pa || ai {
            has_c2pa |= c2pa;
            has_ai |= ai;
            findings.push(format!("{}: {}", entry.name, join_hits(&hits, 6)));
        }
    }
    if let Some(meta) = entries.iter().find(|entry| entry.name == "meta.xml") {
        if generator_like_re().is_match(&meta.data) {
            has_ai = true;
            findings.push("meta.xml generator-like fields".to_string());
        }
    }
    (has_c2pa, has_ai || has_c2pa, findings, json!({}))
}

/// Remove the unconditional telemetry and identity elements from `meta.xml`.
fn scrub_meta(data: &[u8], actions: &mut Vec<String>) -> Vec<u8> {
    let mut out = data.to_vec();
    for (element, action) in ALWAYS_DROP_META {
        let pattern = element_re(element);
        if pattern.find_iter(&out).next().is_some() {
            actions.push((*action).to_string());
            out = pattern.replace_all(&out, &b""[..]).into_owned();
        }
    }
    // `dc:creator` is a person's name as often as it is a tool's, so it goes
    // only when it reads as AI provenance.
    let mut kept = Vec::with_capacity(out.len());
    let mut last = 0;
    for found in creator_re().find_iter(&out) {
        kept.extend_from_slice(&out[last..found.start()]);
        if ai_meta_name_re_bytes().is_match(found.as_bytes()) {
            actions.push("scrub creator-like meta".to_string());
        } else {
            kept.extend_from_slice(found.as_bytes());
        }
        last = found.end();
    }
    kept.extend_from_slice(&out[last..]);
    kept
}

/// Strip provenance from an ODT.
///
/// A rewritten `meta.xml` is reparsed before the archive is assembled, so a
/// rewrite that damaged the part fails the clean rather than shipping.
///
/// # Errors
///
/// Returns `Err` for a non-zip input, an archive over any of its budgets, or a
/// rewritten `meta.xml` that is not well-formed.
pub fn clean_odt(data: &[u8]) -> Result<(Vec<u8>, Vec<String>), String> {
    let entries = read_entries(data)?;
    let mut actions: Vec<String> = Vec::new();
    let mut kept: Vec<Entry> = Vec::new();

    for mut entry in entries {
        if entry.name == "meta.xml" {
            let scrubbed = scrub_meta(&entry.data, &mut actions);
            if scrubbed != entry.data {
                // Same gate as the DOCX parts: a rewritten part is only safe to
                // put back in the package if it survives an independent parse.
                revalidate(&entry.name, &scrubbed)?;
            }
            entry.data = scrubbed;
        } else {
            let (c2pa, ai, _) = blob_hits(&entry.data);
            if (c2pa || ai) && !ODT_KEEP_PARTS.contains(&entry.name.as_str()) {
                actions.push(format!("drop part {} (AI/C2PA markers)", entry.name));
                continue;
            }
        }
        kept.push(entry);
    }

    if actions.is_empty() {
        actions.push("no ODT metadata removed".to_string());
    }
    Ok((write_entries(kept)?, actions))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editing_telemetry_goes_unconditionally() {
        let meta = br#"<office:meta><meta:editing-cycles>7</meta:editing-cycles><meta:editing-duration>PT1H2M</meta:editing-duration><dc:title>Hills</dc:title></office:meta>"#;
        let mut actions = Vec::new();
        let out = scrub_meta(meta, &mut actions);
        assert!(actions.contains(&"drop meta:editing-cycles".to_string()));
        assert!(actions.contains(&"drop meta:editing-duration".to_string()));
        let out = String::from_utf8(out).unwrap();
        assert!(!out.contains("PT1H2M"));
        assert!(out.contains("<dc:title>Hills</dc:title>"));
    }

    #[test]
    fn a_self_closing_generator_element_is_matched_too() {
        let mut actions = Vec::new();
        let out = scrub_meta(br#"<m><meta:generator/></m>"#, &mut actions);
        assert_eq!(actions, vec!["drop meta:generator".to_string()]);
        assert_eq!(String::from_utf8(out).unwrap(), "<m></m>");
    }

    #[test]
    fn a_clean_meta_part_is_left_alone() {
        let meta = br#"<m><dc:title>Hills</dc:title><dc:creator>Jo Bloggs</dc:creator></m>"#;
        let mut actions = Vec::new();
        let out = scrub_meta(meta, &mut actions);
        assert!(actions.is_empty());
        assert_eq!(out, meta.to_vec());
    }
}
