//! PNG chunk-level inspection and metadata surgery.
//!
//! Every chunk read and write goes through [`img_parts::png`], which owns the
//! length/type/CRC framing and re-emits untouched chunks byte for byte. This
//! module holds only the *policy*: which chunk types carry provenance, and
//! which are structural and must survive whatever their payload happens to
//! contain.

use img_parts::png::{Png, PngChunk};
use img_parts::Bytes;

use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits, C2PA_MARKERS};

/// The eight-byte PNG signature.
pub const PNG_SIG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Chunks that carry image data or rendering intent and are never dropped.
const STRUCTURAL_CHUNKS: &[&[u8]] = &[
    b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS", b"gAMA", b"pHYs", b"sRGB", b"cHRM", b"iCCP",
];

/// The `iTXt` keyword Adobe uses for an embedded XMP packet, NUL-terminated as
/// it appears at the head of the chunk payload.
const XMP_ITXT_KEYWORD: &[u8] = b"XML:com.adobe.xmp\0";

/// Textual chunk types, all of which may carry provenance strings.
const TEXT_CHUNKS: &[&[u8]] = &[b"tEXt", b"zTXt", b"iTXt"];

/// Chunk types removed unconditionally: they exist only to carry metadata.
///
/// `eXIf` is the PNG Exif container, `caBX` the C2PA JUMBF box recommended
/// before `IDAT`, and `tIME` the last-modification timestamp, which is a
/// behavioural fingerprint rather than rendering information.
const ALWAYS_DROP_CHUNKS: &[&[u8]] = &[b"eXIf", b"caBX", b"tIME"];

/// Render a chunk type as its four Latin-1 characters.
fn chunk_name(kind: &[u8]) -> String {
    kind.iter().map(|byte| *byte as char).collect()
}

/// True when this chunk type is one of the JUMBF/C2PA container conventions.
fn is_c2pa_container(kind: &[u8]) -> bool {
    matches!(kind, b"caBX" | b"juMB" | b"jumb") || kind.starts_with(b"c2")
}

/// True when an `iTXt` payload is an Adobe XMP packet.
fn is_xmp_itxt(kind: &[u8], payload: &[u8]) -> bool {
    kind == b"iTXt" && payload.starts_with(XMP_ITXT_KEYWORD)
}

/// Parse a PNG, or explain why it could not be parsed.
fn parse(data: &[u8]) -> Result<Png, String> {
    Png::from_bytes(Bytes::copy_from_slice(data)).map_err(|error| error.to_string())
}

/// Inspect a PNG. Returns `(has_c2pa, has_ai_metadata, findings)`.
///
/// A PNG that fails to parse still gets the whole-file marker scan, so a
/// truncated or CRC-damaged file carrying a manifest is reported rather than
/// silently passed.
pub fn inspect_png(data: &[u8]) -> (bool, bool, Vec<String>) {
    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    if !data.starts_with(PNG_SIG) {
        return (false, false, vec!["not a PNG".to_string()]);
    }
    let combined = ai_and_c2pa_markers();

    match parse(data) {
        Ok(png) => {
            for chunk in png.chunks() {
                let kind = chunk.kind();
                let name = chunk_name(&kind);
                if is_c2pa_container(&kind) {
                    has_c2pa = true;
                    findings.push(format!("PNG chunk {name} (possible C2PA container)"));
                }
                if is_xmp_itxt(&kind, chunk.contents()) {
                    findings.push("PNG iTXt XMP packet (XML:com.adobe.xmp)".to_string());
                }
                if TEXT_CHUNKS.contains(&&kind[..]) || kind == *b"eXIf" {
                    let hits = contains_any(chunk.contents(), &combined);
                    if !hits.is_empty() {
                        has_ai = true;
                        if hits_name_c2pa(&hits, false) {
                            has_c2pa = true;
                        }
                        findings.push(format!("PNG {name}: {}", join_hits(&hits, 8)));
                    }
                }
            }
        }
        Err(error) => findings.push(format!("malformed PNG: {error}")),
    }

    // Whole-file scan fallback, which also covers anything the chunk walk could
    // not reach.
    let whole = contains_any(data, C2PA_MARKERS);
    if !whole.is_empty() && !has_c2pa {
        has_c2pa = true;
        findings.push(format!("byte-scan C2PA markers: {}", join_hits(&whole, 6)));
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Decide whether one chunk is dropped, and say why.
fn drop_reason(chunk: &PngChunk, strip_all_text: bool, combined: &[&[u8]]) -> Option<String> {
    let kind = chunk.kind();
    let name = chunk_name(&kind);
    let payload = chunk.contents();

    if ALWAYS_DROP_CHUNKS.contains(&&kind[..]) || is_c2pa_container(&kind) {
        return Some(format!("drop chunk {name}"));
    }
    if TEXT_CHUNKS.contains(&&kind[..]) {
        if strip_all_text || is_xmp_itxt(&kind, payload) {
            return Some(format!("drop chunk {name}"));
        }
        if !contains_any(payload, combined).is_empty() {
            return Some(format!("drop chunk {name}"));
        }
        return None;
    }
    if STRUCTURAL_CHUNKS.contains(&&kind[..]) {
        return None;
    }
    // An unknown ancillary chunk whose type or payload names a C2PA structure.
    let mut probe = kind.to_vec();
    probe.extend_from_slice(payload);
    if contains_any(&probe, C2PA_MARKERS).is_empty() {
        return None;
    }
    Some(format!("drop chunk {name} (C2PA marker in payload)"))
}

/// Strip metadata chunks from a PNG, returning the new bytes and an action log.
///
/// When nothing matches, the input bytes are returned verbatim: a clean file is
/// byte-identical after a strip, not merely equivalent.
///
/// # Errors
///
/// Returns `Err` when the input is not a PNG or its chunk structure cannot be
/// parsed. Rewriting a file whose framing is not understood risks truncating
/// image data, so a malformed container is refused rather than rebuilt.
pub fn strip_png(data: &[u8], strip_all_text: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    if !data.starts_with(PNG_SIG) {
        return Err("not PNG".to_string());
    }
    let mut png = parse(data).map_err(|error| format!("malformed PNG: {error}"))?;
    let combined = ai_and_c2pa_markers();

    let mut actions: Vec<String> = Vec::new();
    png.chunks_mut().retain(
        |chunk| match drop_reason(chunk, strip_all_text, &combined) {
            Some(action) => {
                actions.push(action);
                false
            }
            None => true,
        },
    );

    if actions.is_empty() {
        return Ok((
            data.to_vec(),
            vec!["no PNG metadata chunks removed (already clean or none matched)".to_string()],
        ));
    }
    Ok((png.encoder().bytes().to_vec(), actions))
}

/// Build a PNG chunk with a correct CRC.
///
/// Used by the tests and by any caller that needs to synthesise one.
///
/// # Panics
///
/// Panics when `kind` is not exactly four bytes: a PNG chunk type is a
/// fixed-width field, and a caller passing anything else has a bug.
pub fn build_chunk(kind: &[u8], payload: &[u8]) -> Vec<u8> {
    let kind: [u8; 4] = kind.try_into().expect("a PNG chunk type is four bytes");
    PngChunk::new(kind, Bytes::copy_from_slice(payload))
        .encoder()
        .bytes()
        .to_vec()
}

/// The PNG/zlib CRC-32, so synthesised chunks are byte-valid.
///
/// Delegates to `crc32fast`, the same implementation `img-parts` verifies
/// against, rather than carrying a second table.
pub fn crc32(data: &[u8]) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(data);
    hasher.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal but structurally valid PNG carrying the given extra chunks.
    pub(super) fn png_with(extra: &[(&[u8], &[u8])]) -> Vec<u8> {
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
    fn parsing_and_re_encoding_is_byte_identical() {
        let png = png_with(&[(b"tEXt", b"Title\x00A photo of a hill")]);
        let parsed = parse(&png).unwrap();
        assert_eq!(parsed.encoder().bytes().to_vec(), png);
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
    fn an_xmp_itxt_chunk_goes_even_when_text_is_otherwise_kept() {
        let mut payload = XMP_ITXT_KEYWORD.to_vec();
        payload.extend_from_slice(b"\x00\x00\x00\x00<x:xmpmeta>ordinary</x:xmpmeta>");
        let png = png_with(&[(b"iTXt", &payload)]);

        let (_, _, findings) = inspect_png(&png);
        assert!(findings.contains(&"PNG iTXt XMP packet (XML:com.adobe.xmp)".to_string()));

        // Even with `strip_all_text` off, an XMP packet is metadata by
        // definition and is removed.
        let (cleaned, actions) = strip_png(&png, false).unwrap();
        assert!(actions.contains(&"drop chunk iTXt".to_string()));
        assert!(!cleaned.windows(9).any(|w| w == b"xmpmeta>o"));
    }

    #[test]
    fn a_time_chunk_is_a_behavioural_fingerprint_and_goes() {
        let png = png_with(&[(b"tIME", &[0x07, 0xE9, 1, 2, 3, 4, 5])]);
        let (cleaned, actions) = strip_png(&png, true).unwrap();
        assert!(actions.contains(&"drop chunk tIME".to_string()));
        assert!(!cleaned.windows(4).any(|w| w == b"tIME"));
    }

    #[test]
    fn structural_chunks_are_never_dropped_for_a_payload_collision() {
        // An iCCP profile whose bytes happen to contain "c2pa" must survive.
        let png = png_with(&[(b"iCCP", b"prof\x00\x00c2pa-colliding-bytes")]);
        let (cleaned, _) = strip_png(&png, true).unwrap();
        assert!(cleaned.windows(4).any(|w| w == b"iCCP"));
    }

    #[test]
    fn a_malformed_png_is_still_scanned_for_markers() {
        // Truncating the final chunk makes the container unparseable. The walk
        // cannot run, so the finding names the structural problem and the
        // whole-file scan carries the detection.
        //
        // This replaces the previous per-chunk `truncated chunk b'IEND'`
        // assertion: `img-parts` reports one truncation error for the file
        // rather than naming the chunk, and reproducing the old string would
        // mean re-deriving the hand-rolled walk this module exists to delete.
        let mut png = png_with(&[(b"zzZz", b"contentcredentials")]);
        png.truncate(png.len() - 3);
        let (c2pa, _, findings) = inspect_png(&png);
        assert!(findings.iter().any(|f| f.starts_with("malformed PNG: ")));
        assert!(c2pa, "the byte scan still finds the marker");
        assert!(findings
            .iter()
            .any(|f| f.starts_with("byte-scan C2PA markers: ")));

        // And a rewrite is refused rather than attempted.
        assert!(strip_png(&png, true)
            .unwrap_err()
            .starts_with("malformed PNG"));
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
