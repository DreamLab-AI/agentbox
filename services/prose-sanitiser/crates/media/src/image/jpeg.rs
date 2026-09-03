//! JPEG segment-level inspection and metadata surgery.

use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits, C2PA_MARKERS};

pub const JPEG_SOI: &[u8] = b"\xff\xd8";

/// Inspect a JPEG. Returns `(has_c2pa, has_ai_metadata, findings)`.
pub fn inspect_jpeg(data: &[u8]) -> (bool, bool, Vec<String>) {
    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    if !data.starts_with(JPEG_SOI) {
        return (false, false, vec!["not a JPEG".to_string()]);
    }
    let combined = ai_and_c2pa_markers();
    let n = data.len();
    let mut i = 2usize;

    while i + 4 <= n {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        // Skip fill bytes.
        while i < n && data[i] == 0xFF {
            i += 1;
        }
        if i >= n {
            break;
        }
        let marker = data[i];
        i += 1;
        if marker == 0xD8 || marker == 0xD9 {
            continue; // SOI / EOI
        }
        if marker == 0xDA {
            break; // SOS — image data follows
        }
        if (0xD0..=0xD7).contains(&marker) {
            continue; // RSTn
        }
        if i + 2 > n {
            break;
        }
        let seglen = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        if seglen < 2 || i + seglen > n {
            findings.push(format!("bad segment length at marker 0x{marker:02X}"));
            break;
        }
        let payload = &data[i + 2..i + seglen];
        i += seglen;

        // APP11 (0xEB) often holds JUMBF/C2PA.
        if marker == 0xEB {
            has_c2pa = true;
            findings.push("JPEG APP11 segment (JUMBF/C2PA common)".to_string());
        }
        if matches!(marker, 0xE1 | 0xE2 | 0xED | 0xEE | 0xEB) {
            // APP1, 2, 13, 14, 11
            let hits = contains_any(payload, &combined);
            if !hits.is_empty() {
                has_ai = true;
                if hits_name_c2pa(&hits, true) {
                    has_c2pa = true;
                }
                findings.push(format!(
                    "JPEG APP{}: {}",
                    marker - 0xE0,
                    join_hits(&hits, 8)
                ));
            }
        }
    }

    let whole = contains_any(data, C2PA_MARKERS);
    if !whole.is_empty() && !has_c2pa {
        has_c2pa = true;
        findings.push(format!("byte-scan C2PA markers: {}", join_hits(&whole, 6)));
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Strip APP/COM segments from a JPEG, returning the new bytes and actions.
///
/// APP0 (JFIF) is kept by default for decoder compatibility; APP11 always goes.
pub fn strip_jpeg(data: &[u8], strip_all_app: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    if !data.starts_with(JPEG_SOI) {
        return Err("not JPEG".to_string());
    }
    let combined = ai_and_c2pa_markers();
    let mut actions: Vec<String> = Vec::new();
    let mut out = JPEG_SOI.to_vec();
    let n = data.len();
    let mut i = 2usize;

    while i < n {
        if data[i] != 0xFF {
            // Unexpected; copy the rest verbatim rather than guess.
            out.extend_from_slice(&data[i..]);
            actions.push("copied remainder after non-marker byte".to_string());
            break;
        }
        while i < n && data[i] == 0xFF {
            i += 1;
        }
        if i >= n {
            break;
        }
        let marker = data[i];
        i += 1;

        if marker == 0xD9 {
            out.extend_from_slice(b"\xff\xd9"); // EOI
            break;
        }
        if marker == 0xD8 {
            continue; // nested SOI
        }
        if (0xD0..=0xD7).contains(&marker) {
            out.extend_from_slice(&[0xFF, marker]);
            continue;
        }
        if marker == 0xDA {
            // SOS — the entropy-coded scan runs to EOF; copy it wholesale.
            if i + 2 > n {
                break;
            }
            out.extend_from_slice(b"\xff\xda");
            out.extend_from_slice(&data[i..]);
            actions.push("preserved entropy-coded scan (SOS→EOF)".to_string());
            break;
        }

        if i + 2 > n {
            break;
        }
        let seglen = u16::from_be_bytes([data[i], data[i + 1]]) as usize;
        if seglen < 2 || i + seglen > n {
            out.extend_from_slice(&data[i - 2..]); // best effort
            actions.push("truncated segment; copied remainder".to_string());
            break;
        }
        let payload = &data[i + 2..i + seglen];
        let next = i + seglen;

        let mut keep = false;
        let mut drop = false;
        if (0xE0..=0xEF).contains(&marker) {
            // APPn
            if marker == 0xEB {
                drop = true;
                actions.push("drop APP11 (C2PA/JUMBF)".to_string());
            } else if strip_all_app && marker != 0xE0 {
                // Keep APP0 (JFIF) by default.
                drop = true;
                actions.push(format!("drop APP{}", marker - 0xE0));
            } else if !contains_any(payload, &combined).is_empty() {
                drop = true;
                actions.push(format!("drop APP{} (AI/C2PA markers)", marker - 0xE0));
            } else {
                keep = true;
            }
        } else if marker == 0xFE {
            drop = true;
            actions.push("drop COM comment".to_string());
        } else {
            keep = true;
        }

        if keep && !drop {
            out.extend_from_slice(&[0xFF, marker]);
            out.extend_from_slice(&data[i..i + seglen]);
        }
        i = next;
    }

    if actions.is_empty() {
        actions.push("no JPEG APP segments removed".to_string());
    }
    Ok((out, actions))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        out.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    /// A minimal JPEG: SOI, the given segments, then a token scan and EOI.
    fn jpeg_with(segments: &[(u8, &[u8])]) -> Vec<u8> {
        let mut out = JPEG_SOI.to_vec();
        out.extend_from_slice(&segment(
            0xE0,
            b"JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00",
        ));
        for (marker, payload) in segments {
            out.extend_from_slice(&segment(*marker, payload));
        }
        out.extend_from_slice(&segment(0xDA, b"\x01\x01\x00"));
        out.extend_from_slice(b"scan-data");
        out.extend_from_slice(b"\xff\xd9");
        out
    }

    #[test]
    fn rejects_non_jpeg_bytes() {
        assert_eq!(inspect_jpeg(b"nope").2, vec!["not a JPEG".to_string()]);
        assert!(strip_jpeg(b"nope", true).is_err());
    }

    #[test]
    fn app11_alone_is_treated_as_a_c2pa_container() {
        let jpeg = jpeg_with(&[(0xEB, b"JP\x00\x00jumb")]);
        let (c2pa, ai, findings) = inspect_jpeg(&jpeg);
        assert!(c2pa && ai);
        assert!(findings
            .iter()
            .any(|f| f == "JPEG APP11 segment (JUMBF/C2PA common)"));

        let (cleaned, actions) = strip_jpeg(&jpeg, true).unwrap();
        assert!(actions.contains(&"drop APP11 (C2PA/JUMBF)".to_string()));
        assert!(!inspect_jpeg(&cleaned).0);
    }

    #[test]
    fn xmp_in_app1_with_vendor_markers_is_found() {
        let jpeg = jpeg_with(&[(
            0xE1,
            b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>digitalSourceType</x:xmpmeta>",
        )]);
        let (_, ai, findings) = inspect_jpeg(&jpeg);
        assert!(ai);
        assert!(findings.iter().any(|f| f.starts_with("JPEG APP1: ")));
    }

    #[test]
    fn the_entropy_coded_scan_and_jfif_survive_a_full_strip() {
        let jpeg = jpeg_with(&[(0xE1, b"Exif\x00\x00payload"), (0xFE, b"a comment")]);
        let (cleaned, actions) = strip_jpeg(&jpeg, true).unwrap();
        assert!(actions.contains(&"drop APP1".to_string()));
        assert!(actions.contains(&"drop COM comment".to_string()));
        assert!(actions.contains(&"preserved entropy-coded scan (SOS→EOF)".to_string()));
        // APP0/JFIF is kept, the scan bytes and EOI are intact.
        assert!(cleaned.windows(4).any(|w| w == b"JFIF"));
        assert!(cleaned.windows(9).any(|w| w == b"scan-data"));
        assert!(cleaned.ends_with(b"\xff\xd9"));
        assert!(!cleaned.windows(7).any(|w| w == b"payload"));
        assert!(cleaned.len() < jpeg.len());
    }

    #[test]
    fn keep_non_ai_metadata_retains_a_clean_app1() {
        let jpeg = jpeg_with(&[(0xE1, b"Exif\x00\x00ordinary camera tags")]);
        let (cleaned, actions) = strip_jpeg(&jpeg, false).unwrap();
        assert!(!actions.iter().any(|a| a.starts_with("drop APP1")));
        assert!(cleaned.windows(20).any(|w| w == b"ordinary camera tags"));
    }

    #[test]
    fn keep_non_ai_metadata_still_drops_a_marked_app1() {
        let jpeg = jpeg_with(&[(0xE1, b"Exif\x00\x00Generated by OpenAI")]);
        let (cleaned, actions) = strip_jpeg(&jpeg, false).unwrap();
        assert!(actions.contains(&"drop APP1 (AI/C2PA markers)".to_string()));
        assert!(!cleaned.windows(6).any(|w| w == b"OpenAI"));
    }

    #[test]
    fn a_bad_segment_length_is_reported_not_panicked_on() {
        let mut jpeg = JPEG_SOI.to_vec();
        jpeg.extend_from_slice(&[0xFF, 0xE1, 0xFF, 0xFF]); // length far past EOF
        jpeg.extend_from_slice(b"short");
        let (_, _, findings) = inspect_jpeg(&jpeg);
        assert!(findings
            .iter()
            .any(|f| f.starts_with("bad segment length at marker 0xE1")));
    }

    #[test]
    fn a_clean_jpeg_reports_no_removals() {
        let jpeg = jpeg_with(&[]);
        let (_, actions) = strip_jpeg(&jpeg, false).unwrap();
        assert_eq!(
            actions,
            vec!["preserved entropy-coded scan (SOS→EOF)".to_string()]
        );
    }
}
