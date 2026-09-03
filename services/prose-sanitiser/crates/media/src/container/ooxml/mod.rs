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

pub mod docx;
pub mod odf;
pub mod wordml;

use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub use docx::{clean_docx, inspect_docx};
pub use odf::{clean_odt, inspect_odt};

/// A zip bomb must be rejected before decompression, so the budget is checked
/// against the *declared* uncompressed size in the central directory.
pub const MAX_ZIP_DECOMPRESSED_BYTES: u64 = 128 * 1024 * 1024;

/// One entry read out of the source archive.
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

/// The message raised when an archive's declared sizes exceed the cap.
pub fn budget_error() -> String {
    format!(
        "zip decompressed size exceeds cap ({MAX_ZIP_DECOMPRESSED_BYTES} bytes); refusing to process"
    )
}

/// Read every entry, refusing the archive if the declared sizes exceed the cap.
///
/// # Errors
///
/// Returns `Err` for a non-zip input, an unreadable entry, or an archive whose
/// declared uncompressed size exceeds [`MAX_ZIP_DECOMPRESSED_BYTES`].
pub fn read_entries(data: &[u8]) -> Result<Vec<Entry>, String> {
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
