//! WebP RIFF-chunk inspection and metadata surgery.
//!
//! RIFF framing — chunk ids, little-endian sizes, the odd-length pad byte and
//! the enclosing `RIFF`/`WEBP` list — is [`img_parts::riff`]'s job. This module
//! holds the policy: which chunks carry provenance, and the VP8X feature-flag
//! bookkeeping that keeps a file self-consistent after one is removed.

use img_parts::riff::{RiffChunk, RiffContent};
use img_parts::webp::WebP;
use img_parts::{Bytes, Error as ImgError};

use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits};

/// The RIFF container magic.
pub const WEBP_RIFF: &[u8] = b"RIFF";
/// The WebP form type, at offset 8.
pub const WEBP_SIG: &[u8] = b"WEBP";

/// VP8X feature-flag bits for the metadata chunks, so a removed chunk also
/// clears its advertised flag and the file stays self-consistent.
const METADATA_FLAGS: &[(&[u8], u8)] = &[(b"ICCP", 0x20), (b"EXIF", 0x08), (b"XMP ", 0x04)];

/// The VP8X chunk id, whose first payload byte holds the feature flags.
const VP8X: [u8; 4] = *b"VP8X";

/// One RIFF chunk, as a flat view for inspection and reporting.
///
/// The pad byte is reconstructed rather than carried through: RIFF specifies it
/// as a single zero, and `img-parts` re-emits it as one when re-encoding.
pub struct WebpChunk {
    /// The four-character chunk id.
    pub fourcc: [u8; 4],
    /// The chunk payload, pad byte excluded.
    pub payload: Vec<u8>,
    /// The pad byte, present only when the payload length is odd.
    pub padding: Vec<u8>,
}

/// Render a chunk id as its four Latin-1 characters.
fn chunk_name(fourcc: &[u8]) -> String {
    fourcc.iter().map(|byte| *byte as char).collect()
}

/// Parse a WebP, mapping the container errors onto the note strings callers
/// and tests match on.
fn parse(data: &[u8]) -> Result<WebP, String> {
    if data.len() < 12 || &data[..4] != WEBP_RIFF || &data[8..12] != WEBP_SIG {
        return Err("not a WebP".to_string());
    }
    WebP::from_bytes(Bytes::copy_from_slice(data)).map_err(|error| match error {
        ImgError::WrongSignature => "not a WebP".to_string(),
        other => format!("malformed RIFF: {other}"),
    })
}

/// Flatten one parsed chunk into the reporting view.
fn flatten(chunk: &RiffChunk) -> WebpChunk {
    let payload = match chunk.content() {
        RiffContent::Data(data) => data.to_vec(),
        // A nested list (LIST/seqt) is re-encoded so its bytes are still
        // scanned; the surgery below works on the parsed tree, not on this.
        list => list.clone().encoder().bytes().to_vec(),
    };
    let padding = if payload.len() % 2 == 1 {
        vec![0]
    } else {
        Vec::new()
    };
    WebpChunk {
        fourcc: chunk.id(),
        payload,
        padding,
    }
}

/// Note when a parse-and-re-encode of the untouched container is not
/// byte-identical, which means the file carried bytes outside the RIFF tree.
fn fidelity_note(data: &[u8], webp: &WebP) -> Option<String> {
    let round_trip = webp.clone().encoder().bytes();
    if round_trip.as_ref() == data {
        return None;
    }
    Some(format!(
        "trailing WebP bytes: {}",
        data.len().abs_diff(round_trip.len())
    ))
}

/// Walk the RIFF chunks. Returns the chunks plus any structural notes.
pub fn webp_chunks(data: &[u8]) -> (Vec<WebpChunk>, Vec<String>) {
    let webp = match parse(data) {
        Ok(webp) => webp,
        Err(note) => return (Vec::new(), vec![note]),
    };
    let chunks: Vec<WebpChunk> = webp.chunks().iter().map(flatten).collect();
    let notes = fidelity_note(data, &webp).into_iter().collect();
    (chunks, notes)
}

/// Inspect a WebP. Returns `(has_c2pa, has_ai_metadata, findings)`.
pub fn inspect_webp(data: &[u8]) -> (bool, bool, Vec<String>) {
    let (chunks, mut findings) = webp_chunks(data);
    if chunks.is_empty() && findings == vec!["not a WebP".to_string()] {
        return (false, false, findings);
    }
    let combined = ai_and_c2pa_markers();
    let mut has_c2pa = false;
    let mut has_ai = false;

    for chunk in &chunks {
        let name = chunk_name(&chunk.fourcc);
        if chunk.fourcc.to_ascii_uppercase() == *b"C2PA" {
            has_c2pa = true;
            has_ai = true;
            findings.push("WebP C2PA chunk".to_string());
            continue;
        }
        if &chunk.fourcc == b"XMP " || &chunk.fourcc == b"EXIF" {
            let hits = contains_any(&chunk.payload, &combined);
            if !hits.is_empty() {
                has_ai = true;
                if hits_name_c2pa(&hits, true) {
                    has_c2pa = true;
                }
                findings.push(format!("WebP {name}: {}", join_hits(&hits, 8)));
            }
        }
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Decide whether one chunk is dropped, returning its metadata flag bit.
fn drop_flag(chunk: &RiffChunk, strip_all_metadata: bool, combined: &[&[u8]]) -> Option<u8> {
    let fourcc = chunk.id();
    if let Some((_, flag)) = METADATA_FLAGS
        .iter()
        .find(|(candidate, _)| *candidate == fourcc)
    {
        let payload = chunk.content().data().cloned().unwrap_or_default();
        let drop = strip_all_metadata || !contains_any(&payload, combined).is_empty();
        return drop.then_some(*flag);
    }
    (fourcc.to_ascii_uppercase() == *b"C2PA").then_some(0)
}

/// Clear the feature-flag bits of the metadata chunks that were removed.
fn clear_vp8x_flags(webp: &mut WebP, removed_flags: u8) {
    if removed_flags == 0 {
        return;
    }
    let Some(chunk) = webp
        .chunks_mut()
        .iter_mut()
        .find(|chunk| chunk.id() == VP8X)
    else {
        return;
    };
    let RiffContent::Data(data) = chunk.content() else {
        return;
    };
    if data.is_empty() {
        return;
    }
    let mut payload = data.to_vec();
    payload[0] &= !removed_flags;
    *chunk.content_mut() = RiffContent::Data(Bytes::from(payload));
}

/// Strip metadata chunks from a WebP, rewriting the RIFF size and VP8X flags.
///
/// # Errors
///
/// A malformed container is refused rather than rebuilt: re-serialising from a
/// partial chunk walk would silently truncate image data.
pub fn strip_webp(data: &[u8], strip_all_metadata: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    let mut webp = parse(data).map_err(|note| match note.as_str() {
        "not a WebP" => "not WebP".to_string(),
        other => format!("malformed WebP: {other}"),
    })?;
    if let Some(note) = fidelity_note(data, &webp) {
        return Err(format!("malformed WebP: {note}"));
    }

    let combined = ai_and_c2pa_markers();
    let mut actions: Vec<String> = Vec::new();
    let mut removed_flags: u8 = 0;
    webp.chunks_mut().retain(
        |chunk| match drop_flag(chunk, strip_all_metadata, &combined) {
            Some(flag) => {
                actions.push(format!("drop WebP chunk {}", chunk_name(&chunk.id())));
                removed_flags |= flag;
                false
            }
            None => true,
        },
    );

    if actions.is_empty() {
        return Ok((
            data.to_vec(),
            vec!["no WebP metadata chunks removed (already clean or none matched)".to_string()],
        ));
    }
    clear_vp8x_flags(&mut webp, removed_flags);
    Ok((webp.encoder().bytes().to_vec(), actions))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = fourcc.to_vec();
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            out.push(0);
        }
        out
    }

    /// An extended (VP8X) WebP carrying the given chunks after the header.
    pub(super) fn webp_with(vp8x_flags: u8, chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut body = WEBP_SIG.to_vec();
        let mut vp8x = vec![vp8x_flags, 0, 0, 0];
        vp8x.extend_from_slice(&[0, 0, 0, 0, 0, 0]); // canvas size fields
        body.extend_from_slice(&chunk(b"VP8X", &vp8x));
        for (fourcc, payload) in chunks {
            body.extend_from_slice(&chunk(fourcc, payload));
        }
        body.extend_from_slice(&chunk(b"VP8 ", b"fake-image-data"));
        let mut out = WEBP_RIFF.to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn rejects_non_webp_bytes() {
        assert_eq!(webp_chunks(b"nope").1, vec!["not a WebP".to_string()]);
        assert_eq!(inspect_webp(b"nope").2, vec!["not a WebP".to_string()]);
        assert!(strip_webp(b"nope", true).is_err());
    }

    #[test]
    fn parsing_and_re_encoding_is_byte_identical() {
        let webp = webp_with(0x08, &[(b"EXIF", b"odd")]);
        let parsed = parse(&webp).unwrap();
        assert_eq!(parsed.encoder().bytes().to_vec(), webp);
    }

    #[test]
    fn walks_chunks_and_honours_odd_length_padding() {
        let webp = webp_with(0x08, &[(b"EXIF", b"odd")]);
        let (chunks, notes) = webp_chunks(&webp);
        assert!(notes.is_empty(), "unexpected notes: {notes:?}");
        assert_eq!(chunks.len(), 3);
        assert_eq!(&chunks[1].fourcc, b"EXIF");
        assert_eq!(chunks[1].payload, b"odd");
        assert_eq!(chunks[1].padding, vec![0]);
    }

    #[test]
    fn a_dedicated_c2pa_chunk_is_found_and_dropped() {
        let webp = webp_with(0, &[(b"C2PA", b"manifest-bytes")]);
        let (c2pa, ai, findings) = inspect_webp(&webp);
        assert!(c2pa && ai);
        assert!(findings.contains(&"WebP C2PA chunk".to_string()));

        let (cleaned, actions) = strip_webp(&webp, true).unwrap();
        assert!(actions.contains(&"drop WebP chunk C2PA".to_string()));
        assert!(!inspect_webp(&cleaned).0);
        assert!(cleaned.windows(4).any(|w| w == b"VP8 "));
    }

    #[test]
    fn xmp_markers_are_found_in_the_metadata_chunk() {
        let webp = webp_with(0x04, &[(b"XMP ", b"<x>trainedAlgorithmicMedia</x>")]);
        let (_, ai, findings) = inspect_webp(&webp);
        assert!(ai);
        assert!(findings.iter().any(|f| f.starts_with("WebP XMP : ")));
    }

    #[test]
    fn dropping_metadata_clears_the_matching_vp8x_flag_and_riff_size() {
        // Advertise EXIF (0x08) and XMP (0x04).
        let webp = webp_with(0x0C, &[(b"EXIF", b"tags"), (b"XMP ", b"packet")]);
        let (cleaned, actions) = strip_webp(&webp, true).unwrap();
        assert_eq!(actions.len(), 2);

        let (chunks, notes) = webp_chunks(&cleaned);
        assert!(notes.is_empty(), "rewritten RIFF size must be consistent");
        assert_eq!(chunks.len(), 2); // VP8X + VP8
        assert_eq!(chunks[0].payload[0], 0, "metadata flags must be cleared");
        // And the declared RIFF size matches the real length.
        let declared = u32::from_le_bytes(cleaned[4..8].try_into().unwrap()) as usize;
        assert_eq!(declared + 8, cleaned.len());
    }

    #[test]
    fn keep_non_ai_metadata_retains_clean_exif() {
        let webp = webp_with(0x08, &[(b"EXIF", b"ordinary camera tags")]);
        let (cleaned, actions) = strip_webp(&webp, false).unwrap();
        assert_eq!(
            actions,
            vec!["no WebP metadata chunks removed (already clean or none matched)".to_string()]
        );
        assert_eq!(cleaned, webp, "a clean file comes back byte-identical");
    }

    #[test]
    fn a_malformed_container_is_refused_rather_than_rebuilt() {
        let mut webp = webp_with(0, &[(b"EXIF", b"tags")]);
        webp.truncate(webp.len() - 4); // now the RIFF size lies
        let error = strip_webp(&webp, true).unwrap_err();
        assert!(error.starts_with("malformed WebP: "), "error was {error}");
    }
}
