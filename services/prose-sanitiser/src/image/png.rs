//! PNG chunk-level inspection and metadata surgery.

use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits, C2PA_MARKERS};

pub const PNG_SIG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Chunks that carry image data or rendering intent and are never dropped.
const STRUCTURAL_CHUNKS: &[&[u8]] = &[
    b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS", b"gAMA", b"pHYs", b"sRGB", b"cHRM", b"iCCP",
];

/// One parsed chunk: type, payload and the original CRC bytes.
struct Chunk<'a> {
    kind: &'a [u8],
    payload: &'a [u8],
    crc: &'a [u8],
    /// Offset just past this chunk's CRC.
    next: usize,
}

/// Read the chunk starting at `pos`, or `None` when it is truncated.
fn read_chunk(data: &[u8], pos: usize) -> Option<Chunk<'_>> {
    if pos + 8 > data.len() {
        return None;
    }
    let length = u32::from_be_bytes(data[pos..pos + 4].try_into().ok()?) as usize;
    let kind = &data[pos + 4..pos + 8];
    let start = pos + 8;
    let end = start.checked_add(length)?;
    if end.checked_add(4)? > data.len() {
        return None;
    }
    Some(Chunk {
        kind,
        payload: &data[start..end],
        crc: &data[end..end + 4],
        next: end + 4,
    })
}

fn chunk_name(kind: &[u8]) -> String {
    // latin-1 with replacement, as the Python decoded it.
    kind.iter().map(|byte| *byte as char).collect()
}

/// Inspect a PNG. Returns `(has_c2pa, has_ai_metadata, findings)`.
pub fn inspect_png(data: &[u8]) -> (bool, bool, Vec<String>) {
    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    if !data.starts_with(PNG_SIG) {
        return (false, false, vec!["not a PNG".to_string()]);
    }
    let combined = ai_and_c2pa_markers();
    let mut pos = PNG_SIG.len();
    while pos + 8 <= data.len() {
        let Some(chunk) = read_chunk(data, pos) else {
            // Mirror Python's `f"truncated chunk {ctype!r}"` byte-string repr.
            let kind = &data[pos + 4..(pos + 8).min(data.len())];
            findings.push(format!("truncated chunk {}", byte_repr(kind)));
            break;
        };
        let name = chunk_name(chunk.kind);

        // Private/ancillary chunks sometimes used for JUMBF/C2PA.
        if matches!(chunk.kind, b"caBX" | b"juMB" | b"jumb") || chunk.kind.starts_with(b"c2") {
            has_c2pa = true;
            findings.push(format!("PNG chunk {name} (possible C2PA container)"));
        }
        if matches!(chunk.kind, b"tEXt" | b"zTXt" | b"iTXt" | b"eXIf") {
            let hits = contains_any(chunk.payload, &combined);
            if !hits.is_empty() {
                has_ai = true;
                if hits_name_c2pa(&hits, false) {
                    has_c2pa = true;
                }
                findings.push(format!("PNG {name}: {}", join_hits(&hits, 8)));
            }
        }
        if chunk.kind == b"IEND" {
            break;
        }
        pos = chunk.next;
    }

    // Whole-file scan fallback.
    let whole = contains_any(data, C2PA_MARKERS);
    if !whole.is_empty() && !has_c2pa {
        has_c2pa = true;
        findings.push(format!("byte-scan C2PA markers: {}", join_hits(&whole, 6)));
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Python's `repr()` of a short bytes object, for the truncated-chunk finding.
fn byte_repr(bytes: &[u8]) -> String {
    let mut out = String::from("b'");
    for byte in bytes {
        match byte {
            b'\\' => out.push_str("\\\\"),
            b'\'' => out.push_str("\\'"),
            0x20..=0x7E => out.push(*byte as char),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            _ => out.push_str(&format!("\\x{byte:02x}")),
        }
    }
    out.push('\'');
    out
}

/// Strip metadata chunks from a PNG, returning the new bytes and an action log.
pub fn strip_png(data: &[u8], strip_all_text: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    if !data.starts_with(PNG_SIG) {
        return Err("not PNG".to_string());
    }
    let combined = ai_and_c2pa_markers();
    let mut actions: Vec<String> = Vec::new();
    let mut out = PNG_SIG.to_vec();
    let mut pos = PNG_SIG.len();

    while pos + 8 <= data.len() {
        let Some(chunk) = read_chunk(data, pos) else {
            break;
        };
        let name = chunk_name(chunk.kind);
        pos = chunk.next;

        let mut drop = false;
        if matches!(chunk.kind, b"eXIf" | b"caBX") || chunk.kind.starts_with(b"c2") {
            drop = true;
            actions.push(format!("drop chunk {name}"));
        } else if matches!(chunk.kind, b"tEXt" | b"zTXt" | b"iTXt") {
            if strip_all_text || !contains_any(chunk.payload, &combined).is_empty() {
                drop = true;
                actions.push(format!("drop chunk {name}"));
            }
        } else {
            let mut probe = chunk.kind.to_vec();
            probe.extend_from_slice(chunk.payload);
            if !contains_any(&probe, C2PA_MARKERS).is_empty()
                && !STRUCTURAL_CHUNKS.contains(&chunk.kind)
            {
                drop = true;
                actions.push(format!("drop chunk {name} (C2PA marker in payload)"));
            }
        }

        if !drop {
            out.extend_from_slice(&(chunk.payload.len() as u32).to_be_bytes());
            out.extend_from_slice(chunk.kind);
            out.extend_from_slice(chunk.payload);
            out.extend_from_slice(chunk.crc);
        }
        if chunk.kind == b"IEND" {
            break;
        }
    }
    if actions.is_empty() {
        actions.push("no PNG metadata chunks removed (already clean or none matched)".to_string());
    }
    Ok((out, actions))
}

/// Build a PNG chunk with a correct CRC — used by the tests and by any caller
/// that needs to synthesise one.
pub fn build_chunk(kind: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    let mut crc_input = kind.to_vec();
    crc_input.extend_from_slice(payload);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    out
}

/// The PNG/zlib CRC-32, so synthesised chunks are byte-valid.
pub fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (index, entry) in table.iter_mut().enumerate() {
        let mut value = index as u32;
        for _ in 0..8 {
            value = if value & 1 != 0 {
                0xEDB8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
        }
        *entry = value;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc = table[((crc ^ *byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal but structurally valid PNG carrying the given extra chunks.
    fn png_with(extra: &[(&[u8], &[u8])]) -> Vec<u8> {
        let mut out = PNG_SIG.to_vec();
        // 1x1 greyscale IHDR.
        out.extend_from_slice(&build_chunk(
            b"IHDR",
            &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0],
        ));
        for (kind, payload) in extra {
            out.extend_from_slice(&build_chunk(kind, payload));
        }
        out.extend_from_slice(&build_chunk(b"IDAT", &[0x78, 0x9C, 0x63, 0x00, 0x00]));
        out.extend_from_slice(&build_chunk(b"IEND", b""));
        out
    }

    #[test]
    fn rejects_non_png_bytes() {
        assert_eq!(inspect_png(b"not a png").2, vec!["not a PNG".to_string()]);
        assert!(strip_png(b"not a png", true).is_err());
    }

    #[test]
    fn a_clean_png_reports_nothing() {
        let png = png_with(&[]);
        let (c2pa, ai, findings) = inspect_png(&png);
        assert!(!c2pa && !ai);
        assert!(findings.is_empty());
    }

    #[test]
    fn text_chunks_carrying_vendor_markers_are_found_and_dropped() {
        let png = png_with(&[(b"tEXt", b"Software\x00Generated by Claude")]);
        let (c2pa, ai, findings) = inspect_png(&png);
        assert!(!c2pa);
        assert!(ai);
        assert!(findings[0].starts_with("PNG tEXt: "));
        assert!(findings[0].contains("Generated by"));
        assert!(findings[0].contains("Claude"));

        let (cleaned, actions) = strip_png(&png, true).unwrap();
        assert!(actions.contains(&"drop chunk tEXt".to_string()));
        assert!(!inspect_png(&cleaned).1);
        // The image payload survives.
        assert!(cleaned.windows(4).any(|w| w == b"IDAT"));
        assert!(cleaned.windows(4).any(|w| w == b"IHDR"));
    }

    #[test]
    fn a_jumbf_chunk_is_a_c2pa_container() {
        let png = png_with(&[(b"caBX", b"\x00\x00\x00\x18jumb")]);
        let (c2pa, ai, findings) = inspect_png(&png);
        assert!(c2pa && ai);
        assert!(findings
            .iter()
            .any(|f| f == "PNG chunk caBX (possible C2PA container)"));

        let (cleaned, actions) = strip_png(&png, true).unwrap();
        assert!(actions.contains(&"drop chunk caBX".to_string()));
        assert!(!inspect_png(&cleaned).0);
    }

    #[test]
    fn c2_prefixed_private_chunks_are_dropped() {
        let png = png_with(&[(b"c2pa", b"manifest")]);
        assert!(inspect_png(&png).0);
        let (cleaned, actions) = strip_png(&png, true).unwrap();
        assert!(actions.contains(&"drop chunk c2pa".to_string()));
        assert!(!cleaned.windows(4).any(|w| w == b"c2pa"));
    }

    #[test]
    fn keep_non_ai_metadata_retains_innocent_text() {
        let png = png_with(&[(b"tEXt", b"Title\x00A photo of a hill")]);
        let (cleaned, actions) = strip_png(&png, false).unwrap();
        assert_eq!(
            actions,
            vec!["no PNG metadata chunks removed (already clean or none matched)".to_string()]
        );
        assert_eq!(cleaned, png);
    }

    #[test]
    fn exif_chunks_go_even_without_markers() {
        let png = png_with(&[(b"eXIf", b"II*\x00harmless")]);
        let (_, actions) = strip_png(&png, true).unwrap();
        assert!(actions.contains(&"drop chunk eXIf".to_string()));
    }

    #[test]
    fn structural_chunks_are_never_dropped_for_a_payload_collision() {
        // An iCCP profile whose bytes happen to contain "c2pa" must survive.
        let png = png_with(&[(b"iCCP", b"prof\x00\x00c2pa-colliding-bytes")]);
        let (cleaned, _) = strip_png(&png, true).unwrap();
        assert!(cleaned.windows(4).any(|w| w == b"iCCP"));
    }

    #[test]
    fn a_truncated_chunk_is_reported_not_panicked_on() {
        // Nine bytes of IEND survive: the header parses, the CRC does not.
        let mut png = png_with(&[]);
        png.truncate(png.len() - 3);
        let (_, _, findings) = inspect_png(&png);
        assert_eq!(findings, vec!["truncated chunk b'IEND'".to_string()]);

        // A chunk cut before its 8-byte header simply ends the walk, with no
        // finding — the loop guard never admits it. Matches the Python.
        let mut shorter = png_with(&[]);
        shorter.truncate(shorter.len() - 6);
        assert!(inspect_png(&shorter).2.is_empty());
    }

    #[test]
    fn a_whole_file_marker_outside_a_known_chunk_is_a_byte_scan_hit() {
        let png = png_with(&[(b"zzZz", b"contentcredentials")]);
        let (c2pa, _, findings) = inspect_png(&png);
        assert!(c2pa);
        assert!(findings
            .iter()
            .any(|f| f.starts_with("byte-scan C2PA markers: ")));
    }

    #[test]
    fn crc32_matches_the_known_png_value() {
        // CRC of an empty IEND chunk is the well-known 0xAE426082.
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }
}
