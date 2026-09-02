//! DOCX and ODT: zip container walking and metadata-part surgery.

use std::io::{Cursor, Read, Write};
use std::sync::OnceLock;

use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::patterns::{ai_meta_name_re_bytes, blob_hits};
use crate::image::markers::join_hits;

/// A zip bomb must be rejected before decompression, so the budget is checked
/// against the *declared* uncompressed size in the central directory.
pub const MAX_ZIP_DECOMPRESSED_BYTES: u64 = 128 * 1024 * 1024;

/// DOCX parts that carry provenance rather than visible content.
fn is_docx_meta_part(name: &str) -> bool {
    name.starts_with("docProps/") || name.starts_with("customXml/")
}

/// ODT parts that must never be dropped, whatever their bytes contain.
const ODT_KEEP_PARTS: &[&str] = &[
    "content.xml",
    "styles.xml",
    "mimetype",
    "META-INF/manifest.xml",
];

/// One entry read out of the source archive.
struct Entry {
    name: String,
    data: Vec<u8>,
    compression: CompressionMethod,
    last_modified: Option<zip::DateTime>,
    unix_mode: Option<u32>,
}

fn budget_error() -> String {
    format!(
        "zip decompressed size exceeds cap ({MAX_ZIP_DECOMPRESSED_BYTES} bytes); refusing to process"
    )
}

/// Read every entry, refusing the archive if the declared sizes exceed the cap.
fn read_entries(data: &[u8]) -> Result<Vec<Entry>, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(data)).map_err(|_| "not a valid zip".to_string())?;
    let mut budget: u64 = 0;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("cannot read zip entry {index}: {error}"))?;
        budget += file.size();
        if budget > MAX_ZIP_DECOMPRESSED_BYTES {
            return Err(budget_error());
        }
        let mut buffer = Vec::with_capacity(file.size().min(1 << 20) as usize);
        file.read_to_end(&mut buffer)
            .map_err(|error| format!("cannot read zip entry: {error}"))?;
        entries.push(Entry {
            name: file.name().to_string(),
            data: buffer,
            compression: file.compression(),
            last_modified: file.last_modified(),
            unix_mode: file.unix_mode(),
        });
    }
    Ok(entries)
}

/// Names only, for the light `customXml` presence check.
fn entry_names(entries: &[Entry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.name.as_str()).collect()
}

/// Write entries back out, preserving each one's compression and timestamp.
///
/// ODT requires an uncompressed `mimetype` first; carrying the original
/// compression method across does that without a special case.
fn write_entries(entries: Vec<Entry>) -> Result<Vec<u8>, String> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut buffer);
        for entry in entries {
            let mut options = SimpleFileOptions::default().compression_method(entry.compression);
            if let Some(timestamp) = entry.last_modified {
                options = options.last_modified_time(timestamp);
            }
            if let Some(mode) = entry.unix_mode {
                options = options.unix_permissions(mode);
            }
            writer
                .start_file(&entry.name, options)
                .map_err(|error| format!("cannot write zip entry {}: {error}", entry.name))?;
            writer
                .write_all(&entry.data)
                .map_err(|error| format!("cannot write zip entry {}: {error}", entry.name))?;
        }
        writer
            .finish()
            .map_err(|error| format!("cannot finalise zip: {error}"))?;
    }
    Ok(buffer.into_inner())
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

/// Inspect a DOCX.
///
/// Only metadata/provenance parts are scanned: the visible body (`word/*.xml`)
/// may legitimately mention a vendor name without being AI-generated metadata.
pub fn inspect_docx(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let entries = match read_entries(data) {
        Ok(entries) => entries,
        Err(error) if error == "not a valid zip" => {
            return (false, false, vec!["not a valid DOCX zip".to_string()], json!({}))
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

    (
        has_c2pa,
        has_ai || has_c2pa,
        findings,
        json!({"parts": entries.len()}),
    )
}

fn docprops_field_res() -> &'static [(ByteRegex, &'static str)] {
    static RES: OnceLock<Vec<(ByteRegex, &'static str)>> = OnceLock::new();
    RES.get_or_init(|| {
        vec![
            (
                ByteRegex::new(r"(?is-u)(<dc:creator[^>]*>)(.*?)(</dc:creator>)").unwrap(),
                "dc:creator",
            ),
            (
                ByteRegex::new(r"(?is-u)(<cp:lastModifiedBy[^>]*>)(.*?)(</cp:lastModifiedBy>)")
                    .unwrap(),
                "cp:lastModifiedBy",
            ),
            (
                ByteRegex::new(r"(?is-u)(<Application[^>]*>)(.*?)(</Application>)").unwrap(),
                "Application",
            ),
            (
                ByteRegex::new(r"(?is-u)(<AppVersion[^>]*>)(.*?)(</AppVersion>)").unwrap(),
                "AppVersion",
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

fn content_types_override_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r#"(?-u)<Override\b[^>]*PartName="/customXml/[^"]*"[^>]*/>"#)
            .expect("static regex compiles")
    })
}

/// Strip provenance from a DOCX.
pub fn clean_docx(data: &[u8]) -> Result<(Vec<u8>, Vec<String>), String> {
    let entries = read_entries(data)?;
    let mut actions: Vec<String> = Vec::new();
    let mut kept: Vec<Entry> = Vec::new();

    for mut entry in entries {
        // Drop entire customXml trees — often used for provenance injects; the
        // visible body stays in word/.
        if entry.name.starts_with("customXml/") {
            actions.push(format!("drop part {}", entry.name));
            continue;
        }
        if entry.name.starts_with("docProps/") {
            let mut scrubbed = entry.data.clone();
            for (pattern, label) in docprops_field_res() {
                scrubbed = replace_field(&scrubbed, pattern, label, &entry.name, &mut actions);
            }
            // Drop custom.xml entirely if it reads as AI provenance.
            if entry.name.ends_with("custom.xml")
                && (blob_hits(&entry.data).1 || ai_meta_name_re_bytes().is_match(&entry.data))
            {
                actions.push(format!("drop part {}", entry.name));
                continue;
            }
            entry.data = scrubbed;
        }
        if entry.name == "[Content_Types].xml" {
            let count = content_types_override_re().find_iter(&entry.data).count();
            if count > 0 {
                actions.push(format!("drop Content_Types customXml overrides x{count}"));
                entry.data = content_types_override_re()
                    .replace_all(&entry.data, &b""[..])
                    .into_owned();
            }
        }
        kept.push(entry);
    }

    if actions.is_empty() {
        actions.push("no DOCX metadata parts removed".to_string());
    }
    Ok((write_entries(kept)?, actions))
}

/// Blank a metadata field's text when it reads as AI provenance.
fn replace_field(
    data: &[u8],
    pattern: &ByteRegex,
    label: &str,
    part: &str,
    actions: &mut Vec<String>,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut last = 0;
    for captures in pattern.captures_iter(data) {
        let whole = captures.get(0).expect("group 0 always present");
        let inner = captures.get(2).expect("group 2 always present").as_bytes();
        out.extend_from_slice(&data[last..whole.start()]);
        let name_hit =
            ai_meta_name_re_bytes().is_match(inner) || ai_meta_name_re_bytes().is_match(label.as_bytes());
        // Application/AppVersion are additionally cleared on a vendor name.
        let vendor_hit =
            matches!(label, "Application" | "AppVersion") && vendor_re().is_match(inner);
        if name_hit || vendor_hit {
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

// ---------------------------------------------------------------------------
// ODT
// ---------------------------------------------------------------------------

/// Inspect an ODT. Every part is scanned, unlike DOCX.
pub fn inspect_odt(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let entries = match read_entries(data) {
        Ok(entries) => entries,
        Err(error) if error == "not a valid zip" => {
            return (false, false, vec!["not a valid ODT zip".to_string()], json!({}))
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
        if ByteRegex::new(r"(?i-u)generator|claude|openai|anthropic|gemini")
            .expect("static regex compiles")
            .is_match(&meta.data)
        {
            has_ai = true;
            findings.push("meta.xml generator-like fields".to_string());
        }
    }
    (has_c2pa, has_ai || has_c2pa, findings, json!({}))
}

/// Strip provenance from an ODT.
pub fn clean_odt(data: &[u8]) -> Result<(Vec<u8>, Vec<String>), String> {
    let entries = read_entries(data)?;
    let mut actions: Vec<String> = Vec::new();
    let mut kept: Vec<Entry> = Vec::new();

    let generator_re = ByteRegex::new(r"(?is-u)<meta:generator\b[^>]*>.*?</meta:generator\s*>")
        .expect("static regex compiles");
    let creator_re = ByteRegex::new(r"(?is-u)<dc:creator\b[^>]*>.*?</dc:creator\s*>")
        .expect("static regex compiles");

    for mut entry in entries {
        if entry.name == "meta.xml" {
            let count = generator_re.find_iter(&entry.data).count();
            if count > 0 {
                actions.push("drop meta:generator".to_string());
                entry.data = generator_re.replace_all(&entry.data, &b""[..]).into_owned();
            }
            // Scrub creator-like fields when they read as AI.
            let mut out = Vec::with_capacity(entry.data.len());
            let mut last = 0;
            for found in creator_re.find_iter(&entry.data) {
                out.extend_from_slice(&entry.data[last..found.start()]);
                if ai_meta_name_re_bytes().is_match(found.as_bytes()) {
                    actions.push("scrub creator-like meta".to_string());
                } else {
                    out.extend_from_slice(found.as_bytes());
                }
                last = found.end();
            }
            out.extend_from_slice(&entry.data[last..]);
            entry.data = out;
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

/// Names in a zip, for the format sniffer.
pub fn zip_namelist(data: &[u8]) -> Result<Vec<String>, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(data)).map_err(|_| "not a valid zip".to_string())?;
    Ok((0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|file| file.name().to_string()))
        .collect())
}

#[cfg(test)]
mod tests;
