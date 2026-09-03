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

/// Attribute budget for a single element.
///
/// Independent of any parser fix: `quick-xml` before 0.41 checked for duplicate
/// attributes in quadratic time, and a dependency upgrade should not be the only
/// thing standing between a hostile part and the CPU. No WordprocessingML
/// element legitimately carries anything near this many.
pub const MAX_ATTRIBUTES_PER_ELEMENT: usize = 512;

/// Element-nesting budget.
///
/// Deeply nested tables nest tens of levels, not hundreds. The cap bounds the
/// skip bookkeeping a hostile part can force.
pub const MAX_ELEMENT_DEPTH: usize = 256;

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
    let mut attributes: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    for attribute in start.attributes() {
        if attributes.len() >= MAX_ATTRIBUTES_PER_ELEMENT {
            return Err(format!(
                "refusing WordprocessingML element with more than \
                 {MAX_ATTRIBUTES_PER_ELEMENT} attributes"
            ));
        }
        let attribute: Attribute<'_> =
            attribute.map_err(|error| format!("malformed WordprocessingML attribute: {error}"))?;
        attributes.push((attribute.key.as_ref().to_vec(), attribute.value.to_vec()));
    }
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
    // Mismatched or unclosed tags are a hard error. A part that does not close
    // its elements is not a document this crate may claim to have cleaned.
    reader.config_mut().check_end_names = true;

    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut edits = WordmlEdits::default();
    // Depth counter for the element currently being skipped, if any.
    let mut skipping: Option<(Vec<u8>, usize)> = None;
    // Depth of the elements written through, so an unbalanced part is caught at
    // end of input rather than emitted as a successful rewrite.
    let mut depth = 0usize;

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
                depth += 1;
                if depth > MAX_ELEMENT_DEPTH {
                    return Err(format!(
                        "refusing WordprocessingML nested deeper than {MAX_ELEMENT_DEPTH} elements"
                    ));
                }
                if DROP_WITH_CONTENTS.contains(&name.as_slice()) {
                    if is_format_change(&name) {
                        edits.format_changes_removed += 1;
                    } else {
                        edits.deletions_removed += 1;
                    }
                    // The subtree is tracked by `skipping` from here, so this
                    // element leaves the written-through depth alone.
                    depth -= 1;
                    skipping = Some((name, 1));
                    continue;
                }
                if UNWRAP.contains(&name.as_slice()) {
                    // The tag goes but its children stay, so the wrapper does
                    // not contribute to the written-through depth either.
                    depth -= 1;
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
                depth = depth.checked_sub(1).ok_or_else(|| {
                    format!(
                        "malformed WordprocessingML: unmatched </{}>",
                        String::from_utf8_lossy(&name)
                    )
                })?;
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

    // End of input is only legitimate with every element closed and no skip in
    // progress. Otherwise the tail was silently discarded, and returning the
    // truncated result as a successful clean would be a lie.
    if let Some((name, _)) = skipping {
        return Err(format!(
            "malformed WordprocessingML: input ended inside <{}>",
            String::from_utf8_lossy(&name)
        ));
    }
    if depth != 0 {
        return Err(format!(
            "malformed WordprocessingML: input ended with {depth} element(s) still open"
        ));
    }

    if edits.is_empty() {
        return Ok((data.to_vec(), edits));
    }
    Ok((writer.into_inner().into_inner(), edits))
}

#[cfg(test)]
mod tests;
