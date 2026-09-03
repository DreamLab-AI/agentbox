//! WordprocessingML body surgery: revision ids, tracked changes, comments.
//!
//! These are the fingerprints that survive every `docProps` scrub because they
//! live in the document body rather than in a metadata part.
//!
//! * **`w:rsid*` attributes** are editing-session identifiers. Word stamps a
//!   fresh 32-bit id on every save session and tags each run, paragraph and
//!   table row with the session that touched it, so the attribute set is a
//!   record of *how the document was written*: how many sittings, and which
//!   passages arrived together. `word/settings.xml` carries the matching
//!   `<w:rsids>` table.
//! * **Tracked changes** (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo` and the
//!   `w:*PrChange` formatting records) carry author names and timestamps for
//!   every edit, plus the superseded text itself.
//! * **Comment anchors** (`w:commentRangeStart`, `w:commentRangeEnd`,
//!   `w:commentReference`) point at the comment parts.
//!
//! Resolution follows the "accept all revisions" semantics Word itself uses: an
//! insertion is unwrapped so its text stays, a deletion is dropped with its
//! contents, and a formatting-change record is dropped while the formatting it
//! records is left in place.
//!
//! The rewrite is event-driven through `quick-xml`, never regular expressions:
//! these elements nest, and matching nested `<w:ins>` inside `<w:del>` with a
//! pattern is exactly the kind of hand-rolled parsing this crate refuses to do.

use std::io::Cursor;

use quick_xml::events::attributes::Attribute;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, Writer};

/// Elements dropped together with everything inside them.
///
/// `w:del` and `w:moveFrom` hold text that was removed; accepting the revision
/// means it goes. The `*Change` records hold superseded formatting properties.
const DROP_WITH_CONTENTS: &[&[u8]] = &[
    b"w:del",
    b"w:moveFrom",
    b"w:rPrChange",
    b"w:pPrChange",
    b"w:sectPrChange",
    b"w:tblPrChange",
    b"w:tblPrExChange",
    b"w:tcPrChange",
    b"w:trPrChange",
    b"w:tblGridChange",
    b"w:cellIns",
    b"w:cellDel",
    b"w:cellMerge",
    // The editing-session id table in `word/settings.xml`.
    b"w:rsids",
];

/// Elements whose start and end tags go while their children stay.
///
/// Accepting an insertion keeps the inserted text and discards only the record
/// of who inserted it and when.
const UNWRAP: &[&[u8]] = &[b"w:ins", b"w:moveTo"];

/// Self-closing anchors that are simply deleted.
const DROP_EMPTY: &[&[u8]] = &[
    b"w:commentRangeStart",
    b"w:commentRangeEnd",
    b"w:commentReference",
    b"w:moveFromRangeStart",
    b"w:moveFromRangeEnd",
    b"w:moveToRangeStart",
    b"w:moveToRangeEnd",
    b"w:proofErr",
];

/// What a scrub changed, for the action log.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WordmlEdits {
    /// Editing-session attributes removed.
    pub rsid_attributes: usize,
    /// `w:ins`/`w:moveTo` wrappers unwrapped.
    pub insertions_accepted: usize,
    /// `w:del`/`w:moveFrom` elements removed with their contents.
    pub deletions_removed: usize,
    /// `w:*PrChange` formatting records removed.
    pub format_changes_removed: usize,
    /// Comment and move anchors removed.
    pub anchors_removed: usize,
}

impl WordmlEdits {
    /// True when nothing at all was changed.
    pub fn is_empty(self) -> bool {
        self == Self::default()
    }

    /// One action string per non-zero counter, for the caller's log.
    pub fn actions(self, part: &str) -> Vec<String> {
        let mut actions = Vec::new();
        if self.rsid_attributes > 0 {
            actions.push(format!(
                "strip {} w:rsid editing-session attributes from {part}",
                self.rsid_attributes
            ));
        }
        if self.insertions_accepted > 0 {
            actions.push(format!(
                "accept {} tracked insertions in {part}",
                self.insertions_accepted
            ));
        }
        if self.deletions_removed > 0 {
            actions.push(format!(
                "accept {} tracked deletions in {part}",
                self.deletions_removed
            ));
        }
        if self.format_changes_removed > 0 {
            actions.push(format!(
                "drop {} formatting-change records in {part}",
                self.format_changes_removed
            ));
        }
        if self.anchors_removed > 0 {
            actions.push(format!(
                "drop {} comment and move anchors in {part}",
                self.anchors_removed
            ));
        }
        actions
    }
}

/// True when an attribute is an editing-session identifier.
///
/// Matches the whole `w:rsid*` family — `w:rsid`, `w:rsidR`, `w:rsidRPr`,
/// `w:rsidRDefault`, `w:rsidP`, `w:rsidTr`, `w:rsidDel`, `w:rsidSect` — under
/// any namespace prefix.
fn is_rsid_attribute(key: &[u8]) -> bool {
    let local = key.rsplit(|byte| *byte == b':').next().unwrap_or(key);
    local.starts_with(b"rsid")
}

/// Whether a formatting-change record was dropped, for the right counter.
fn is_format_change(name: &[u8]) -> bool {
    name.ends_with(b"PrChange") || name.ends_with(b"GridChange")
}

/// Rebuild a start tag without its editing-session attributes.
///
/// Returns `None` when the tag has none, so an untouched element is written
/// back exactly as it was read. The surviving attribute values are copied as
/// raw bytes rather than re-escaped, so an entity such as `&amp;` stays as it
/// was written instead of becoming `&amp;amp;`.
fn without_rsids(start: &BytesStart<'_>) -> Result<Option<(BytesStart<'static>, usize)>, String> {
    // Every attribute must parse. Skipping the ones that do not would silently
    // drop them from the rewritten tag, which is data loss disguised as a
    // clean.
    let attributes: Vec<(Vec<u8>, Vec<u8>)> = start
        .attributes()
        .map(|attribute| {
            attribute
                .map(|attribute: Attribute<'_>| {
                    (attribute.key.as_ref().to_vec(), attribute.value.to_vec())
                })
                .map_err(|error| format!("malformed WordprocessingML attribute: {error}"))
        })
        .collect::<Result<_, _>>()?;
    let removed = attributes
        .iter()
        .filter(|(key, _)| is_rsid_attribute(key))
        .count();
    if removed == 0 {
        return Ok(None);
    }

    let name = start.name().as_ref().to_vec();
    let mut content = name.clone();
    for (key, value) in attributes {
        if is_rsid_attribute(&key) {
            continue;
        }
        content.push(b' ');
        content.extend_from_slice(&key);
        content.extend_from_slice(b"=\"");
        content.extend_from_slice(&value);
        content.push(b'"');
    }
    let rebuilt =
        BytesStart::from_content(String::from_utf8_lossy(&content).into_owned(), name.len());
    Ok(Some((rebuilt, removed)))
}

/// Strip revision ids, tracked changes and comment anchors from a
/// WordprocessingML part.
///
/// Returns the rewritten XML and a count of what changed. When nothing matched,
/// the input bytes are returned verbatim, so an already-clean part is never
/// re-serialised.
///
/// # Errors
///
/// Returns `Err` when the part is not well-formed XML.
pub fn scrub_wordml(data: &[u8]) -> Result<(Vec<u8>, WordmlEdits), String> {
    let mut reader = Reader::from_reader(data);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;

    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut edits = WordmlEdits::default();
    // Depth counter for the element currently being skipped, if any.
    let mut skipping: Option<(Vec<u8>, usize)> = None;

    loop {
        let event = reader
            .read_event()
            .map_err(|error| format!("malformed WordprocessingML: {error}"))?;

        // While skipping, only track nesting so the matching end tag is found.
        if let Some((name, depth)) = skipping.as_mut() {
            match &event {
                Event::Start(start) if start.name().as_ref() == name.as_slice() => *depth += 1,
                Event::End(end) if end.name().as_ref() == name.as_slice() => {
                    *depth -= 1;
                    if *depth == 0 {
                        skipping = None;
                    }
                }
                Event::Eof => break,
                _ => {}
            }
            continue;
        }

        match event {
            Event::Eof => break,
            Event::Start(start) => {
                let name = start.name().as_ref().to_vec();
                if DROP_WITH_CONTENTS.contains(&name.as_slice()) {
                    if is_format_change(&name) {
                        edits.format_changes_removed += 1;
                    } else {
                        edits.deletions_removed += 1;
                    }
                    skipping = Some((name, 1));
                    continue;
                }
                if UNWRAP.contains(&name.as_slice()) {
                    edits.insertions_accepted += 1;
                    continue;
                }
                match without_rsids(&start)? {
                    Some((rebuilt, removed)) => {
                        edits.rsid_attributes += removed;
                        writer.write_event(Event::Start(rebuilt))
                    }
                    None => writer.write_event(Event::Start(start)),
                }
            }
            Event::End(end) => {
                let name = end.name().as_ref().to_vec();
                if UNWRAP.contains(&name.as_slice()) {
                    continue;
                }
                writer.write_event(Event::End(end))
            }
            Event::Empty(start) => {
                let name = start.name().as_ref().to_vec();
                if DROP_EMPTY.contains(&name.as_slice()) {
                    edits.anchors_removed += 1;
                    continue;
                }
                if DROP_WITH_CONTENTS.contains(&name.as_slice()) {
                    if is_format_change(&name) {
                        edits.format_changes_removed += 1;
                    } else {
                        edits.deletions_removed += 1;
                    }
                    continue;
                }
                match without_rsids(&start)? {
                    Some((rebuilt, removed)) => {
                        edits.rsid_attributes += removed;
                        writer.write_event(Event::Empty(rebuilt))
                    }
                    None => writer.write_event(Event::Empty(start)),
                }
            }
            other => writer.write_event(other),
        }
        .map_err(|error| format!("cannot rewrite WordprocessingML: {error}"))?;
    }

    if edits.is_empty() {
        return Ok((data.to_vec(), edits));
    }
    Ok((writer.into_inner().into_inner(), edits))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scrub(xml: &str) -> (String, WordmlEdits) {
        let (out, edits) = scrub_wordml(xml.as_bytes()).unwrap();
        (String::from_utf8(out).unwrap(), edits)
    }

    #[test]
    fn a_clean_part_comes_back_byte_identical() {
        let xml =
            r#"<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(out, xml);
        assert!(edits.is_empty());
    }

    #[test]
    fn editing_session_ids_are_stripped_from_every_element() {
        let xml = r#"<w:p w:rsidR="00A1" w:rsidRDefault="00A1" w14:paraId="1"><w:r w:rsidRPr="00B2"><w:t>Text</w:t></w:r></w:p>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.rsid_attributes, 3);
        assert!(!out.contains("rsid"), "output was {out}");
        // Non-rsid attributes survive.
        assert!(out.contains(r#"w14:paraId="1""#));
        assert!(out.contains("<w:t>Text</w:t>"));
    }

    #[test]
    fn an_insertion_is_accepted_and_its_text_kept() {
        let xml = r#"<w:p><w:ins w:id="1" w:author="Jo" w:date="2026-09-03T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.insertions_accepted, 1);
        assert!(!out.contains("w:ins"));
        assert!(!out.contains("Jo"));
        assert!(out.contains("<w:t>added</w:t>"));
    }

    #[test]
    fn a_deletion_is_accepted_and_its_text_removed() {
        let xml = r#"<w:p><w:del w:id="2" w:author="Jo"><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.deletions_removed, 1);
        assert!(!out.contains("gone"));
        assert!(!out.contains("Jo"));
        assert!(out.contains("kept"));
    }

    #[test]
    fn nested_revisions_do_not_confuse_the_skip() {
        // An insertion inside a deletion: the whole deletion goes, and the
        // paragraph after it is untouched. A regex would stop at the first
        // </w:del> and leave the tail behind.
        let xml = concat!(
            r#"<w:body><w:del w:id="1"><w:ins w:id="2"><w:r><w:delText>x</w:delText></w:r>"#,
            r#"</w:ins><w:del w:id="3"><w:r><w:delText>y</w:delText></w:r></w:del></w:del>"#,
            r#"<w:p><w:r><w:t>tail</w:t></w:r></w:p></w:body>"#
        );
        let (out, edits) = scrub(xml);
        assert_eq!(edits.deletions_removed, 1, "the outer w:del is one removal");
        assert!(!out.contains("delText"));
        assert!(!out.contains("w:ins"));
        assert!(out.contains("<w:t>tail</w:t>"));
        assert!(out.starts_with("<w:body>") && out.ends_with("</w:body>"));
    }

    #[test]
    fn formatting_change_records_are_counted_separately() {
        let xml = r#"<w:p><w:pPr><w:pPrChange w:id="4" w:author="Jo"><w:pPr/></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="5"><w:rPr/></w:rPrChange></w:rPr></w:r></w:p>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.format_changes_removed, 2);
        assert_eq!(edits.deletions_removed, 0);
        assert!(!out.contains("Change"));
    }

    #[test]
    fn comment_anchors_are_removed() {
        let xml = r#"<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.anchors_removed, 3);
        assert!(!out.contains("comment"));
        assert!(out.contains("<w:t>text</w:t>"));
    }

    #[test]
    fn the_settings_rsid_table_goes_with_its_contents() {
        let xml = r#"<w:settings><w:rsids><w:rsidRoot w:val="00A1"/><w:rsid w:val="00B2"/></w:rsids><w:zoom w:percent="100"/></w:settings>"#;
        let (out, edits) = scrub(xml);
        assert_eq!(edits.deletions_removed, 1);
        assert!(!out.contains("rsid"));
        assert!(out.contains("w:zoom"));
    }

    #[test]
    fn a_malformed_attribute_is_an_error_rather_than_a_silent_drop() {
        // The tag has an rsid, so it must be rebuilt — and rebuilding a tag
        // whose attributes cannot all be read would lose the unreadable ones.
        let error = scrub_wordml(br#"<w:p w:rsidR="00A1" broken=unquoted/>"#).unwrap_err();
        assert!(error.contains("attribute"), "error was {error}");
    }

    #[test]
    fn an_unclosed_tag_at_end_of_input_is_tolerated() {
        // `check_end_names` is off: a fragment is a legitimate input here, and
        // the reader must not reject one.
        assert!(scrub_wordml(b"<w:p><w:r>").is_ok());
    }

    #[test]
    fn the_action_log_names_each_kind_of_edit() {
        let edits = WordmlEdits {
            rsid_attributes: 4,
            insertions_accepted: 1,
            deletions_removed: 2,
            format_changes_removed: 0,
            anchors_removed: 3,
        };
        let actions = edits.actions("word/document.xml");
        assert_eq!(actions.len(), 4);
        assert!(actions[0].contains("4 w:rsid"));
        assert!(actions.iter().all(|a| a.contains("word/document.xml")));
    }
}
