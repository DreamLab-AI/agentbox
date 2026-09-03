//! DOCX provenance: `docProps`, `customXml`, comments and body fingerprints.
//!
//! Four layers carry provenance in an Office Open XML package, and all four are
//! handled here:
//!
//! 1. `docProps/core.xml` — `dc:creator`, `cp:lastModifiedBy`, revision count.
//! 2. `docProps/app.xml` — `Application`, `Company` and `TotalTime`, the last
//!    of which records how many minutes the document was open and is a strong
//!    behavioural fingerprint.
//! 3. `docProps/custom.xml` and `customXml/` — arbitrary injected properties.
//! 4. The body itself — editing-session ids, tracked changes and comment
//!    anchors, handled in [`super::wordml`].
//!
//! Dropping a part is not enough on its own: the package's `[Content_Types]`
//! overrides and `_rels` relationships must lose their entries too, or Office
//! reports the file as corrupt. Both are rewritten with `quick-xml`.

use std::collections::BTreeSet;
use std::io::Cursor;
use std::sync::OnceLock;

use quick_xml::events::attributes::Attribute;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, Writer};
use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::wordml::scrub_wordml;
use super::{entry_names, read_entries, write_entries, Entry};
use crate::container::patterns::{ai_meta_name_re_bytes, blob_hits};
use crate::image::markers::join_hits;

/// Comment and collaboration parts, dropped whole.
const COMMENT_PARTS: &[&str] = &[
    "word/comments.xml",
    "word/commentsExtended.xml",
    "word/commentsIds.xml",
    "word/commentsExtensible.xml",
    "word/people.xml",
];

/// When a `docProps` field is blanked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldPolicy {
    /// Blank only when the value reads as AI provenance.
    WhenAi,
    /// Blank on AI provenance or on a vendor name.
    WhenAiOrVendor,
    /// Always blank: the field is a behavioural fingerprint whatever its value.
    Always,
}

/// DOCX parts that carry provenance rather than visible content.
fn is_docx_meta_part(name: &str) -> bool {
    name.starts_with("docProps/") || name.starts_with("customXml/")
}

/// WordprocessingML parts whose body carries editing fingerprints.
fn is_wordml_part(name: &str) -> bool {
    name.starts_with("word/") && name.ends_with(".xml") && !name.starts_with("word/_rels/")
}

/// Inspect a DOCX.
///
/// Only metadata/provenance parts are scanned: the visible body (`word/*.xml`)
/// may legitimately mention a vendor name without being AI-generated metadata.
pub fn inspect_docx(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let entries = match read_entries(data) {
        Ok(entries) => entries,
        Err(error) if error == "not a valid zip" => {
            return (
                false,
                false,
                vec!["not a valid DOCX zip".to_string()],
                json!({}),
            )
        }
        Err(error) => return (false, false, vec![error], json!({})),
    };

    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    for entry in &entries {
        if !is_docx_meta_part(&entry.name) {
            continue;
        }
        let (c2pa, ai, hits) = blob_hits(&entry.data);
        if c2pa || ai {
            has_c2pa |= c2pa;
            has_ai |= ai;
            findings.push(format!("{}: {}", entry.name, join_hits(&hits, 6)));
        }
    }
    // Always flag customXml presence lightly.
    let custom = entry_names(&entries)
        .iter()
        .filter(|name| name.starts_with("customXml/"))
        .count();
    if custom > 0 {
        findings.push(format!("customXml parts: {custom}"));
    }
    let comments = entries
        .iter()
        .filter(|entry| COMMENT_PARTS.contains(&entry.name.as_str()))
        .count();
    if comments > 0 {
        findings.push(format!("comment parts: {comments}"));
    }

    (
        has_c2pa,
        has_ai || has_c2pa,
        findings,
        json!({"parts": entries.len()}),
    )
}

fn docprops_field_res() -> &'static [(ByteRegex, &'static str, FieldPolicy)] {
    static RES: OnceLock<Vec<(ByteRegex, &'static str, FieldPolicy)>> = OnceLock::new();
    RES.get_or_init(|| {
        vec![
            (
                ByteRegex::new(r"(?is-u)(<dc:creator[^>]*>)(.*?)(</dc:creator>)").unwrap(),
                "dc:creator",
                FieldPolicy::WhenAi,
            ),
            (
                ByteRegex::new(r"(?is-u)(<cp:lastModifiedBy[^>]*>)(.*?)(</cp:lastModifiedBy>)")
                    .unwrap(),
                "cp:lastModifiedBy",
                FieldPolicy::WhenAi,
            ),
            (
                ByteRegex::new(r"(?is-u)(<Application[^>]*>)(.*?)(</Application>)").unwrap(),
                "Application",
                FieldPolicy::WhenAiOrVendor,
            ),
            (
                ByteRegex::new(r"(?is-u)(<AppVersion[^>]*>)(.*?)(</AppVersion>)").unwrap(),
                "AppVersion",
                FieldPolicy::WhenAiOrVendor,
            ),
            // Editing telemetry: minutes the document was open, and the
            // organisation the installation is registered to. Neither is ever
            // wanted in a published file.
            (
                ByteRegex::new(r"(?is-u)(<TotalTime[^>]*>)(.*?)(</TotalTime>)").unwrap(),
                "TotalTime",
                FieldPolicy::Always,
            ),
            (
                ByteRegex::new(r"(?is-u)(<Company[^>]*>)(.*?)(</Company>)").unwrap(),
                "Company",
                FieldPolicy::Always,
            ),
        ]
    })
}

fn vendor_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?i-u)claude|openai|anthropic|gemini|chatgpt|synthid|copilot")
            .expect("static regex compiles")
    })
}

/// Blank a metadata field's text when its policy says so.
fn replace_field(
    data: &[u8],
    pattern: &ByteRegex,
    label: &str,
    policy: FieldPolicy,
    part: &str,
    actions: &mut Vec<String>,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut last = 0;
    for captures in pattern.captures_iter(data) {
        let whole = captures.get(0).expect("group 0 always present");
        let inner = captures.get(2).expect("group 2 always present").as_bytes();
        out.extend_from_slice(&data[last..whole.start()]);
        let blank = match policy {
            FieldPolicy::Always => true,
            FieldPolicy::WhenAi => {
                ai_meta_name_re_bytes().is_match(inner)
                    || ai_meta_name_re_bytes().is_match(label.as_bytes())
            }
            FieldPolicy::WhenAiOrVendor => {
                ai_meta_name_re_bytes().is_match(inner)
                    || ai_meta_name_re_bytes().is_match(label.as_bytes())
                    || vendor_re().is_match(inner)
            }
        };
        if blank && !inner.is_empty() {
            actions.push(format!("scrub {part} field {label}"));
            out.extend_from_slice(captures.get(1).expect("group 1").as_bytes());
            out.extend_from_slice(captures.get(3).expect("group 3").as_bytes());
        } else {
            out.extend_from_slice(whole.as_bytes());
        }
        last = whole.end();
    }
    out.extend_from_slice(&data[last..]);
    out
}

/// Resolve a relationship `Target` against the directory its `.rels` sits in.
///
/// `word/_rels/document.xml.rels` with target `comments.xml` resolves to
/// `word/comments.xml`; a leading `/` means package-absolute.
fn resolve_target(rels_part: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let base = rels_part
        .rsplit_once("_rels/")
        .map(|(head, _)| head)
        .unwrap_or("");
    let mut segments: Vec<&str> = base.split('/').filter(|part| !part.is_empty()).collect();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    segments.join("/")
}

/// Remove every `<element …>` whose `attribute` satisfies `doomed`.
///
/// Used for `[Content_Types].xml` overrides and `_rels` relationships, both of
/// which are flat lists of self-closing elements keyed by a path attribute.
/// Returns the rewritten part and the attribute value of each element removed,
/// so the caller can classify what went without re-parsing.
///
/// # Errors
///
/// Returns `Err` when the part is not well-formed XML.
fn remove_elements_by_attribute(
    data: &[u8],
    element: &[u8],
    attribute: &[u8],
    doomed: &dyn Fn(&str) -> bool,
) -> Result<(Vec<u8>, Vec<String>), String> {
    let doomed_value = |start: &BytesStart<'_>| -> Option<String> {
        if start.name().as_ref() != element {
            return None;
        }
        start
            .attributes()
            .filter_map(std::result::Result::ok)
            .filter(|found: &Attribute<'_>| found.key.as_ref() == attribute)
            .map(|found| String::from_utf8_lossy(&found.value).into_owned())
            .find(|value| doomed(value))
    };

    let mut reader = Reader::from_reader(data);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut removed: Vec<String> = Vec::new();
    let mut skip_depth = 0usize;

    loop {
        let event = reader
            .read_event()
            .map_err(|error| format!("malformed XML: {error}"))?;
        if skip_depth > 0 {
            match &event {
                Event::Start(start) if start.name().as_ref() == element => skip_depth += 1,
                Event::End(end) if end.name().as_ref() == element => skip_depth -= 1,
                Event::Eof => break,
                _ => {}
            }
            continue;
        }
        match event {
            Event::Eof => break,
            Event::Empty(start) => match doomed_value(&start) {
                Some(value) => removed.push(value),
                None => writer
                    .write_event(Event::Empty(start))
                    .map_err(|error| format!("cannot rewrite XML: {error}"))?,
            },
            Event::Start(start) => match doomed_value(&start) {
                Some(value) => {
                    removed.push(value);
                    skip_depth = 1;
                }
                None => writer
                    .write_event(Event::Start(start))
                    .map_err(|error| format!("cannot rewrite XML: {error}"))?,
            },
            other => writer
                .write_event(other)
                .map_err(|error| format!("cannot rewrite XML: {error}"))?,
        }
    }
    if removed.is_empty() {
        return Ok((data.to_vec(), removed));
    }
    Ok((writer.into_inner().into_inner(), removed))
}

/// Which parts this clean removes, decided before anything is rewritten.
fn doomed_parts(entries: &[Entry]) -> BTreeSet<String> {
    entries
        .iter()
        .filter(|entry| {
            entry.name.starts_with("customXml/")
                || COMMENT_PARTS.contains(&entry.name.as_str())
                || (entry.name == "docProps/custom.xml"
                    && (blob_hits(&entry.data).1 || ai_meta_name_re_bytes().is_match(&entry.data)))
        })
        .map(|entry| entry.name.clone())
        .collect()
}

/// Rewrite `[Content_Types].xml` so it no longer declares removed parts.
fn clean_content_types(
    data: &[u8],
    doomed: &BTreeSet<String>,
    actions: &mut Vec<String>,
) -> Result<Vec<u8>, String> {
    let (out, removed) = remove_elements_by_attribute(data, b"Override", b"PartName", &|value| {
        doomed.contains(value.trim_start_matches('/'))
    })?;
    let custom_xml = removed
        .iter()
        .filter(|value| value.trim_start_matches('/').starts_with("customXml/"))
        .count();
    let other = removed.len() - custom_xml;
    if custom_xml > 0 {
        actions.push(format!(
            "drop Content_Types customXml overrides x{custom_xml}"
        ));
    }
    if other > 0 {
        actions.push(format!("drop Content_Types overrides x{other}"));
    }
    Ok(out)
}

/// Rewrite a `.rels` part so it no longer points at removed parts.
fn clean_rels(
    name: &str,
    data: &[u8],
    doomed: &BTreeSet<String>,
    actions: &mut Vec<String>,
) -> Result<Vec<u8>, String> {
    let (out, removed) =
        remove_elements_by_attribute(data, b"Relationship", b"Target", &|value| {
            doomed.contains(&resolve_target(name, value))
        })?;
    if !removed.is_empty() {
        actions.push(format!("drop {} relationships in {name}", removed.len()));
    }
    Ok(out)
}

/// Strip provenance from a DOCX.
///
/// # Errors
///
/// Returns `Err` for a non-zip input, an archive over the decompression budget,
/// or a part that is not well-formed XML.
pub fn clean_docx(data: &[u8]) -> Result<(Vec<u8>, Vec<String>), String> {
    let entries = read_entries(data)?;
    let doomed = doomed_parts(&entries);
    let mut actions: Vec<String> = Vec::new();
    let mut kept: Vec<Entry> = Vec::new();

    for mut entry in entries {
        if doomed.contains(&entry.name) {
            actions.push(format!("drop part {}", entry.name));
            continue;
        }
        if entry.name.starts_with("docProps/") {
            let mut scrubbed = entry.data.clone();
            for (pattern, label, policy) in docprops_field_res() {
                scrubbed = replace_field(
                    &scrubbed,
                    pattern,
                    label,
                    *policy,
                    &entry.name,
                    &mut actions,
                );
            }
            entry.data = scrubbed;
        } else if entry.name == "[Content_Types].xml" {
            entry.data = clean_content_types(&entry.data, &doomed, &mut actions)?;
        } else if entry.name.ends_with(".rels") {
            entry.data = clean_rels(&entry.name, &entry.data, &doomed, &mut actions)?;
        } else if is_wordml_part(&entry.name) {
            let (scrubbed, edits) = scrub_wordml(&entry.data)?;
            actions.extend(edits.actions(&entry.name));
            entry.data = scrubbed;
        }
        kept.push(entry);
    }

    if actions.is_empty() {
        actions.push("no DOCX metadata parts removed".to_string());
    }
    Ok((write_entries(kept)?, actions))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relationship_targets_resolve_against_the_rels_directory() {
        assert_eq!(
            resolve_target("word/_rels/document.xml.rels", "comments.xml"),
            "word/comments.xml"
        );
        assert_eq!(
            resolve_target("word/_rels/document.xml.rels", "../customXml/item1.xml"),
            "customXml/item1.xml"
        );
        assert_eq!(
            resolve_target("_rels/.rels", "docProps/core.xml"),
            "docProps/core.xml"
        );
        assert_eq!(
            resolve_target("word/_rels/document.xml.rels", "/word/styles.xml"),
            "word/styles.xml"
        );
    }

    #[test]
    fn only_the_named_elements_are_removed() {
        let xml = br#"<Types><Override PartName="/a.xml" ContentType="x"/><Override PartName="/b.xml" ContentType="y"/><Default Extension="rels"/></Types>"#;
        let doomed = |value: &str| value == "/a.xml";
        let (out, removed) =
            remove_elements_by_attribute(xml, b"Override", b"PartName", &doomed).unwrap();
        assert_eq!(removed, vec!["/a.xml".to_string()]);
        let out = String::from_utf8(out).unwrap();
        assert!(!out.contains("a.xml"));
        assert!(out.contains("b.xml"));
        assert!(out.contains("<Default"));
    }

    #[test]
    fn an_untouched_part_is_returned_byte_identical() {
        let xml = br#"<Types><Override PartName="/b.xml"/></Types>"#;
        let doomed = |_: &str| false;
        let (out, removed) =
            remove_elements_by_attribute(xml, b"Override", b"PartName", &doomed).unwrap();
        assert!(removed.is_empty());
        assert_eq!(out, xml.to_vec());
    }
}
