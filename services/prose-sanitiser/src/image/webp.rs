//! WebP RIFF-chunk inspection and metadata surgery.

use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits};

pub const WEBP_RIFF: &[u8] = b"RIFF";
pub const WEBP_SIG: &[u8] = b"WEBP";

/// VP8X feature-flag bits for the metadata chunks, so a removed chunk also
/// clears its advertised flag and the file stays self-consistent.
const METADATA_FLAGS: &[(&[u8], u8)] = &[(b"ICCP", 0x20), (b"EXIF", 0x08), (b"XMP ", 0x04)];

/// One RIFF chunk: fourcc, payload and any odd-length pad byte.
pub struct WebpChunk {
    pub fourcc: [u8; 4],
    pub payload: Vec<u8>,
    pub padding: Vec<u8>,
}

fn is_webp(data: &[u8]) -> bool {
    data.len() >= 12 && &data[..4] == WEBP_RIFF && &data[8..12] == WEBP_SIG
}

fn chunk_name(fourcc: &[u8]) -> String {
    fourcc.iter().map(|byte| *byte as char).collect()
}

/// Walk the RIFF chunks. Returns the chunks plus any structural notes.
pub fn webp_chunks(data: &[u8]) -> (Vec<WebpChunk>, Vec<String>) {
    if !is_webp(data) {
        return (Vec::new(), vec!["not a WebP".to_string()]);
    }
    let mut notes = Vec::new();
    let declared = u32::from_le_bytes(data[4..8].try_into().expect("checked length")) as usize;
    if declared + 8 != data.len() {
        notes.push(format!(
            "RIFF size mismatch: header={} actual={}",
            declared + 8,
            data.len()
        ));
    }

    let mut chunks = Vec::new();
    let mut pos = 12usize;
    while pos + 8 <= data.len() {
        let fourcc: [u8; 4] = data[pos..pos + 4].try_into().expect("checked length");
        let length = u32::from_le_bytes(data[pos + 4..pos + 8].try_into().expect("checked length"))
            as usize;
        let payload_start = pos + 8;
        let Some(payload_end) = payload_start.checked_add(length) else {
            notes.push(format!("truncated WebP chunk {}", chunk_name(&fourcc)));
            break;
        };
        let padded_end = payload_end + (length & 1);
        if padded_end > data.len() {
            notes.push(format!("truncated WebP chunk {}", chunk_name(&fourcc)));
            break;
        }
        chunks.push(WebpChunk {
            fourcc,
            payload: data[payload_start..payload_end].to_vec(),
            padding: data[payload_end..padded_end].to_vec(),
        });
        pos = padded_end;
    }
    if pos != data.len() && !notes.iter().any(|note| note.contains("truncated")) {
        notes.push(format!("trailing WebP bytes: {}", data.len() - pos));
    }
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

/// Strip metadata chunks from a WebP, rewriting the RIFF size and VP8X flags.
///
/// A malformed container is refused rather than rebuilt: re-serialising from a
/// partial chunk walk would silently truncate image data.
pub fn strip_webp(data: &[u8], strip_all_metadata: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    let (chunks, notes) = webp_chunks(data);
    if chunks.is_empty() && notes == vec!["not a WebP".to_string()] {
        return Err("not WebP".to_string());
    }
    if !notes.is_empty() {
        return Err(format!("malformed WebP: {}", notes.join("; ")));
    }

    let combined = ai_and_c2pa_markers();
    let mut actions: Vec<String> = Vec::new();
    let mut kept: Vec<WebpChunk> = Vec::new();
    let mut removed_flags: u8 = 0;

    for chunk in chunks {
        let metadata_flag = METADATA_FLAGS
            .iter()
            .find(|(fourcc, _)| *fourcc == chunk.fourcc)
            .map(|(_, flag)| *flag);
        let mut drop = chunk.fourcc.to_ascii_uppercase() == *b"C2PA";
        if metadata_flag.is_some() {
            drop = strip_all_metadata || !contains_any(&chunk.payload, &combined).is_empty();
        }
        if drop {
            actions.push(format!("drop WebP chunk {}", chunk_name(&chunk.fourcc)));
            removed_flags |= metadata_flag.unwrap_or(0);
        } else {
            kept.push(chunk);
        }
    }

    let mut body = WEBP_SIG.to_vec();
    for chunk in kept {
        let mut payload = chunk.payload;
        if &chunk.fourcc == b"VP8X" && !payload.is_empty() && removed_flags != 0 {
            payload[0] &= !removed_flags;
        }
        body.extend_from_slice(&chunk.fourcc);
        body.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        let odd = payload.len() & 1;
        body.extend_from_slice(&payload);
        if odd == 1 {
            body.extend_from_slice(&chunk.padding);
        }
    }

    if actions.is_empty() {
        actions.push("no WebP metadata chunks removed (already clean or none matched)".to_string());
    }
    let mut out = WEBP_RIFF.to_vec();
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    Ok((out, actions))
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
    fn webp_with(vp8x_flags: u8, chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
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
        assert!(cleaned.windows(20).any(|w| w == b"ordinary camera tags"));
    }

    #[test]
    fn a_malformed_container_is_refused_rather_than_rebuilt() {
        let mut webp = webp_with(0, &[(b"EXIF", b"tags")]);
        webp.truncate(webp.len() - 4); // now the RIFF size lies
        let error = strip_webp(&webp, true).unwrap_err();
        assert!(error.starts_with("malformed WebP: "));
    }
}
