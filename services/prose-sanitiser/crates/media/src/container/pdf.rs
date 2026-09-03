//! PDF provenance: object-graph inspection and a full structural rewrite.
//!
//! # Why a rewrite, not an edit
//!
//! A PDF is appended to, not overwritten. An incremental update writes a new
//! body, cross-reference section and trailer at the end of the file; the
//! previous revision stays in the byte stream verbatim. A tool that "removes"
//! `/Info` by appending an update leaves the original document-information
//! dictionary fully recoverable a few kilobytes earlier — `strings` finds it.
//!
//! [`lopdf`] loads the merged object graph and re-serialises it from scratch on
//! save, so objects that are no longer referenced simply never reach the
//! output. That is what actually removes them, and it is why this module owns
//! the whole job in-process rather than chaining `exiftool` into `qpdf`.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::OnceLock;

use lopdf::{Document, Object, ObjectId};
use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::patterns::blob_hits;
use crate::image::c2pa_read;
use crate::image::tools::run_optional_tools;
use crate::io::{max_container_bytes, read_capped, safe_write_bytes};

/// Document-information keys that carry authorship or tooling provenance.
const INFO_KEYS: &[&[u8]] = &[
    b"Title",
    b"Author",
    b"Subject",
    b"Keywords",
    b"Creator",
    b"Producer",
    b"CreationDate",
    b"ModDate",
];

fn xmp_packet_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?is-u)<\?xpacket begin.*?<\?xpacket end[^?]*\?>")
            .expect("static regex compiles")
    })
}

fn stream_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?s-u)stream\r?\n.*?endstream").expect("static regex compiles")
    })
}

/// Return PDF bytes with stream payloads removed, plus the XMP packets.
///
/// Stream payloads are often compressed binary where an AI-marker byte sequence
/// (e.g. "AIGC") can occur by chance. Scanning only dictionaries and XMP
/// packets avoids treating those collisions as metadata findings.
pub fn pdf_structured_blob(data: &[u8]) -> Vec<u8> {
    let no_streams = stream_re().replace_all(data, &b"stream endstream"[..]);
    let packets: Vec<&[u8]> = xmp_packet_re()
        .find_iter(data)
        .map(|found| found.as_bytes())
        .collect();
    let mut out = no_streams.into_owned();
    out.push(b'\n');
    out.extend_from_slice(&packets.join(&b'\n'));
    out
}

/// True when this object is an XMP metadata stream (`/Type /Metadata`).
fn is_metadata_stream(object: &Object) -> bool {
    object
        .as_stream()
        .ok()
        .and_then(|stream| stream.dict.get(b"Type").ok())
        .and_then(|kind| kind.as_name().ok())
        .map(|name| name == b"Metadata")
        .unwrap_or(false)
}

/// Every metadata-stream object id in the document.
fn metadata_stream_ids(doc: &Document) -> Vec<ObjectId> {
    doc.objects
        .iter()
        .filter(|(_, object)| is_metadata_stream(object))
        .map(|(id, _)| *id)
        .collect()
}

/// The document-information keys actually present, for the inspect report.
fn info_keys_present(doc: &Document) -> Vec<String> {
    let Some(info) = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|object| match object {
            Object::Reference(id) => doc.get_object(*id).ok(),
            other => Some(other),
        })
        .and_then(|object| object.as_dict().ok())
    else {
        return Vec::new();
    };
    let present: BTreeSet<String> = INFO_KEYS
        .iter()
        .filter(|key| info.has(key))
        .map(|key| String::from_utf8_lossy(key).into_owned())
        .collect();
    present.into_iter().collect()
}

/// Inspect a PDF: object-graph findings first, byte-level markers behind them.
pub fn inspect_pdf(path: &Path, data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let (mut has_c2pa, mut has_ai, hits) = blob_hits(&pdf_structured_blob(data));
    let mut findings: Vec<String> = hits
        .into_iter()
        .map(|hit| format!("pdf-structured:{hit}"))
        .collect();

    // The object graph, when it parses, is authoritative about what metadata
    // the document actually declares.
    let mut structure = json!({"parsed": false});
    if let Ok(doc) = Document::load_mem(data) {
        let info = info_keys_present(&doc);
        let metadata_streams = metadata_stream_ids(&doc).len();
        if !info.is_empty() {
            findings.push(format!("PDF /Info keys: {}", info.join(", ")));
        }
        if metadata_streams > 0 {
            findings.push(format!("PDF /Metadata streams: {metadata_streams}"));
        }
        structure = json!({
            "parsed": true,
            "version": doc.version,
            "objects": doc.objects.len(),
            "info_keys": info,
            "metadata_streams": metadata_streams,
        });
    }

    let packets: Vec<&[u8]> = xmp_packet_re()
        .find_iter(data)
        .map(|found| found.as_bytes())
        .collect();
    if !packets.is_empty() {
        findings.push("XMP packet present".to_string());
        let blob = packets.join(&b'\n');
        has_ai = has_ai
            || ByteRegex::new(
                r"(?i-u)digitalSourceType|trainedAlgorithmicMedia|SoftwareAgent|c2pa",
            )
            .expect("static regex compiles")
            .is_match(&blob);
    }

    // A PDF carries a C2PA manifest as an embedded file with
    // `AFRelationship = C2PA_Manifest`; the SDK reads it properly.
    let c2pa = c2pa_read::read_c2pa(data, "pdf");
    if c2pa.present {
        has_c2pa = true;
        findings.push("C2PA manifest store present".to_string());
    }

    let tools = run_optional_tools(path);
    if tools
        .get("c2patool")
        .and_then(|entry| entry.get("has_manifest"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        has_c2pa = true;
        findings.push("c2patool reports C2PA-related manifest".to_string());
    }

    (
        has_c2pa,
        has_ai || has_c2pa,
        findings,
        json!({"tools": tools, "structure": structure, "c2pa": c2pa.to_json()}),
    )
}

/// True when this dictionary is a C2PA manifest embedded-file specification.
///
/// A PDF carries its manifest as an embedded file whose file-specification
/// dictionary declares `/AFRelationship /C2PA_Manifest`, referenced from the
/// catalogue's `/AF` array.
fn is_c2pa_file_spec(object: &Object) -> bool {
    object
        .as_dict()
        .ok()
        .and_then(|dict| dict.get(b"AFRelationship").ok())
        .and_then(|value| value.as_name().ok())
        .map(|name| name == b"C2PA_Manifest")
        .unwrap_or(false)
}

/// Every C2PA embedded-file specification in the document.
fn c2pa_file_spec_ids(doc: &Document) -> Vec<ObjectId> {
    doc.objects
        .iter()
        .filter(|(_, object)| is_c2pa_file_spec(object))
        .map(|(id, _)| *id)
        .collect()
}

/// Metadata carriers still present in a document, named for a report.
///
/// Empty is the only acceptable result after a rewrite. Anything here means the
/// clean did not do what it claims, and the caller must fail rather than write.
fn residual_metadata(doc: &Document) -> Vec<String> {
    let mut residue = Vec::new();
    if doc.trailer.get(b"Info").is_ok() {
        residue.push("trailer /Info".to_string());
    }
    if doc
        .catalog()
        .map(|catalog| catalog.has(b"Metadata"))
        .unwrap_or(false)
    {
        residue.push("catalog /Metadata".to_string());
    }
    let streams = metadata_stream_ids(doc).len();
    if streams > 0 {
        residue.push(format!("{streams} /Metadata stream(s)"));
    }
    let specs = c2pa_file_spec_ids(doc).len();
    if specs > 0 {
        residue.push(format!("{specs} C2PA embedded-file specification(s)"));
    }
    residue
}

/// Rewrite a parsed PDF with every metadata carrier removed.
///
/// Returns the serialised document. The write is a full rewrite from the object
/// graph, so nothing from a prior incremental revision survives.
fn rewrite(doc: &mut Document, actions: &mut Vec<String>) -> Result<Vec<u8>, String> {
    if doc.trailer.remove(b"Info").is_some() {
        actions.push("remove trailer /Info".to_string());
    }
    if let Ok(catalog) = doc.catalog_mut() {
        if catalog.remove(b"Metadata").is_some() {
            actions.push("remove catalog /Metadata".to_string());
        }
    }
    for id in metadata_stream_ids(doc) {
        doc.objects.remove(&id);
        actions.push(format!("drop /Metadata stream object {}", id.0));
    }
    // `delete_object` also unlinks the reference from the catalogue's `/AF`
    // array, which a bare `objects.remove` would leave dangling.
    for id in c2pa_file_spec_ids(doc) {
        doc.delete_object(id);
        actions.push(format!("drop C2PA embedded-file specification {}", id.0));
    }
    let pruned = doc.prune_objects().len();
    if pruned > 0 {
        actions.push(format!("prune {pruned} now-unreferenced objects"));
    }
    doc.renumber_objects();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|error| format!("cannot serialise PDF: {error}"))?;
    actions.push(
        "lopdf full object-graph rewrite (no incremental update, so prior revisions do not \
         survive)"
            .to_string(),
    );
    Ok(out)
}

/// Check a rewritten document before it is allowed anywhere near the disk.
///
/// A clean that cannot be verified is a failed clean. Three things must hold:
/// the output reparses, no metadata carrier survives in the object graph, and
/// no XMP packet or C2PA manifest survives in the bytes.
fn verify(rewritten: &[u8]) -> Result<(), String> {
    let reparsed = Document::load_mem(rewritten)
        .map_err(|error| format!("the rewritten PDF does not reparse: {error}"))?;
    let residue = residual_metadata(&reparsed);
    if !residue.is_empty() {
        return Err(format!(
            "the rewritten PDF still carries {}",
            residue.join(", ")
        ));
    }
    if xmp_packet_re().is_match(rewritten) {
        return Err("the rewritten PDF still carries an XMP packet".to_string());
    }
    if c2pa_read::read_c2pa(rewritten, "pdf").present {
        return Err("the rewritten PDF still carries a C2PA manifest store".to_string());
    }
    Ok(())
}

/// Clean a PDF's provenance metadata, or fail without writing anything.
///
/// # Fail closed
///
/// There is no degraded mode. A PDF is appended to rather than overwritten, so
/// the only way to remove `/Info` is to re-serialise the whole object graph; a
/// byte-level edit cannot reach it, and deleting matched bytes in place leaves
/// `/Length` values and cross-reference offsets pointing at the wrong places.
/// A file `lopdf` cannot parse is therefore refused outright, and the
/// destination is not created.
///
/// The rewrite is verified in memory before it is written, so a result that
/// reaches the disk has been reparsed and confirmed free of `/Info`,
/// `/Metadata`, XMP packets and C2PA manifests.
///
/// # Errors
///
/// Returns `Err` when the input cannot be read, cannot be parsed, cannot be
/// re-serialised, fails verification, or cannot be written. In every case no
/// destination file is produced.
pub fn clean_pdf(path: &Path, dest: &Path) -> Result<(Vec<String>, Value), String> {
    let data = read_capped(path, max_container_bytes())
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;

    let mut doc = Document::load_mem(&data).map_err(|error| {
        format!(
            "refusing to clean {}: lopdf cannot build a complete object graph ({error}). \
             A byte-level fallback cannot reach /Info and would leave the cross-reference \
             offsets stale, so nothing was written.",
            path.display()
        )
    })?;

    let mut actions: Vec<String> = Vec::new();
    let rewritten = rewrite(&mut doc, &mut actions)?;
    verify(&rewritten).map_err(|error| format!("refusing to write {}: {error}", dest.display()))?;
    actions.push("verified: the output reparses and carries no metadata carrier".to_string());

    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    safe_write_bytes(dest, &rewritten)
        .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;

    Ok((
        actions,
        json!({"mode": "lopdf", "structural_rewrite": true, "verified": true}),
    ))
}

#[cfg(test)]
mod tests;
