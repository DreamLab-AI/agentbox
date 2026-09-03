//! OOXML and ODF: zip container walking and metadata-part surgery.
//!
//! The archive layer lives here — reading every entry under a decompression
//! budget and writing it back with its original compression method, timestamp
//! and position. Format policy lives in [`docx`] and [`odf`], and the
//! WordprocessingML body rewriting in [`wordml`].
//!
//! # Why entry order and compression method matter
//!
//! A naive re-zip that sorts entries alphabetically or recompresses everything
//! is itself a detectable "repacked by a non-Office tool" signal, and ODF
//! *requires* an uncompressed `mimetype` entry first. Carrying each untouched
//! entry's original method and position across preserves both.
//!
//! # Why the declared sizes are not trusted
//!
//! A zip's central directory is attacker-controlled data, not a promise. An
//! archive can understate an entry's uncompressed size, so checking the
//! declared figure and then calling `read_to_end` bounds nothing: the
//! decompressor writes as much as the compressed stream tells it to. Every
//! entry is therefore read through `take(budget + 1)`, which makes the *actual*
//! output the thing that is bounded, and the declared size only an early-exit
//! hint. Entry count, per-entry size and archive total each have their own
//! budget, because one large part and ten thousand tiny ones are different
//! attacks.

pub mod docx;
pub mod odf;
pub mod wordml;

use std::collections::BTreeSet;
use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub use docx::{clean_docx, inspect_docx};
pub use odf::{clean_odt, inspect_odt};

/// Total decompressed budget for one archive.
pub const MAX_ZIP_DECOMPRESSED_BYTES: u64 = 128 * 1024 * 1024;

/// Decompressed budget for a single entry.
///
/// No legitimate `docProps` part, comment part or document body approaches
/// this; it is here so one entry cannot consume the whole archive budget.
pub const MAX_ZIP_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

/// Maximum number of entries in one archive.
///
/// A real DOCX has tens of parts and a heavily illustrated one has hundreds.
/// The cap bounds the per-entry bookkeeping a hostile archive can force.
pub const MAX_ZIP_ENTRIES: usize = 4096;

/// The budgets applied while reading an archive.
///
/// Exposed so the tests can drive the enforcement paths with small numbers
/// instead of allocating hundreds of megabytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ZipBudget {
    /// Maximum entries in the archive.
    pub max_entries: usize,
    /// Maximum decompressed bytes for any one entry.
    pub max_entry_bytes: u64,
    /// Maximum decompressed bytes across the whole archive.
    pub max_total_bytes: u64,
}

impl Default for ZipBudget {
    fn default() -> Self {
        Self {
            max_entries: MAX_ZIP_ENTRIES,
            max_entry_bytes: MAX_ZIP_ENTRY_BYTES,
            max_total_bytes: MAX_ZIP_DECOMPRESSED_BYTES,
        }
    }
}

/// One entry read out of the source archive.
#[derive(Debug)]
pub struct Entry {
    /// The entry's path inside the archive.
    pub name: String,
    /// The decompressed contents.
    pub data: Vec<u8>,
    /// The compression method the source used, carried across verbatim.
    pub compression: CompressionMethod,
    /// The source timestamp, carried across verbatim.
    pub last_modified: Option<zip::DateTime>,
    /// The source Unix mode, carried across verbatim.
    pub unix_mode: Option<u32>,
}

/// The message raised when an archive exceeds its total decompressed budget.
pub fn budget_error() -> String {
    format!(
        "zip decompressed size exceeds cap ({MAX_ZIP_DECOMPRESSED_BYTES} bytes); refusing to process"
    )
}

/// True when an entry name is one no well-formed OOXML or ODF package uses and
/// that would be dangerous if anything downstream ever extracted it.
///
/// Nothing here extracts to the filesystem, so this is not a live traversal
/// defence. It stops this crate from *emitting* an archive carrying such a
/// name, which is what would make a downstream extractor dangerous.
fn is_dangerous_name(name: &str) -> bool {
    name.is_empty()
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.contains('\0')
        || name.contains('\\')
        || name.split('/').any(|segment| segment == "..")
        // A Windows drive-letter prefix such as `C:`.
        || name
            .split_once(':')
            .map(|(head, _)| head.len() == 1 && head.chars().all(|c| c.is_ascii_alphabetic()))
            .unwrap_or(false)
}

/// Reject an entry name that is unsafe or already seen.
///
/// # Errors
///
/// Returns `Err` for a dangerous path form or a name that appeared earlier in
/// the same archive. A duplicate lets two readers disagree about which bytes a
/// part holds, which is a way to hide content from a sanitiser.
pub(super) fn check_entry_name(name: &str, seen: &mut BTreeSet<String>) -> Result<(), String> {
    if is_dangerous_name(name) {
        return Err(format!("refusing zip entry with unsafe name: {name:?}"));
    }
    if !seen.insert(name.to_string()) {
        return Err(format!(
            "refusing zip with a duplicate entry name: {name:?}"
        ));
    }
    Ok(())
}

/// Read every entry under [`ZipBudget::default`].
///
/// # Errors
///
/// Returns `Err` for a non-zip input, an unreadable entry, a dangerous or
/// duplicated entry name, or an archive that exceeds any of its budgets.
pub fn read_entries(data: &[u8]) -> Result<Vec<Entry>, String> {
    read_entries_with(data, ZipBudget::default())
}

/// Read every entry, enforcing `budget` against the bytes actually produced.
///
/// # Errors
///
/// As [`read_entries`].
pub fn read_entries_with(data: &[u8], budget: ZipBudget) -> Result<Vec<Entry>, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(data)).map_err(|_| "not a valid zip".to_string())?;
    if archive.len() > budget.max_entries {
        return Err(format!(
            "zip entry count {} exceeds cap ({}); refusing to process",
            archive.len(),
            budget.max_entries
        ));
    }

    let mut remaining = budget.max_total_bytes;
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("cannot read zip entry {index}: {error}"))?;
        let name = file.name().to_string();
        check_entry_name(&name, &mut seen)?;
        // The declared size is a hint that lets an obvious bomb exit early. It
        // is not the bound: the read below is.
        if file.size() > budget.max_entry_bytes {
            return Err(format!(
                "zip entry {name:?} declares {} bytes, over the per-entry cap ({}); refusing to \
                 process",
                file.size(),
                budget.max_entry_bytes
            ));
        }

        let allowance = remaining.min(budget.max_entry_bytes);
        let mut buffer = Vec::new();
        (&mut file)
            .take(allowance + 1)
            .read_to_end(&mut buffer)
            .map_err(|error| format!("cannot read zip entry {name:?}: {error}"))?;
        let produced = buffer.len() as u64;
        if produced > allowance {
            return Err(budget_error());
        }
        remaining = remaining.checked_sub(produced).ok_or_else(budget_error)?;

        entries.push(Entry {
            name,
            data: buffer,
            compression: file.compression(),
            last_modified: file.last_modified(),
            unix_mode: file.unix_mode(),
        });
    }
    Ok(entries)
}

/// Names only, for the light `customXml` presence check.
pub fn entry_names(entries: &[Entry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.name.as_str()).collect()
}

/// Write entries back out, preserving each one's compression and timestamp.
///
/// ODT requires an uncompressed `mimetype` first; carrying the original
/// compression method across does that without a special case.
///
/// # Errors
///
/// Returns `Err` when an entry cannot be written or the archive cannot be
/// finalised.
pub fn write_entries(entries: Vec<Entry>) -> Result<Vec<u8>, String> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut buffer);
        for entry in entries {
            let mut options = SimpleFileOptions::default().compression_method(entry.compression);
            // Only Deflated accepts a level: passing one for a Stored entry is
            // rejected outright, and ODT's uncompressed `mimetype` is exactly
            // that case. The deflate implementation still differs from zlib's,
            // so the archive is byte-equivalent in content but not necessarily
            // in compressed size.
            if entry.compression == CompressionMethod::Deflated {
                options = options.compression_level(Some(6));
            }
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

/// Names in a zip, for the format sniffer.
///
/// # Errors
///
/// Returns `Err` when the input is not a valid zip archive.
pub fn zip_namelist(data: &[u8]) -> Result<Vec<String>, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(data)).map_err(|_| "not a valid zip".to_string())?;
    Ok((0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .collect())
}

#[cfg(test)]
mod tests;
