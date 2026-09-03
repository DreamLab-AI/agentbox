//! JPEG segment-level inspection and metadata surgery.
//!
//! Segment framing is [`img_parts::jpeg`]'s job: it owns the marker walk, the
//! length fields and the entropy-coded scan, and re-emits untouched segments
//! byte for byte. This module holds the policy — which application segments
//! carry provenance — plus the one structure `img-parts` does not model, the
//! multi-segment APP11 JUMBF box a C2PA manifest store is split across.

use img_parts::jpeg::{markers, Jpeg, JpegSegment};
use img_parts::Bytes;

use super::jumbf::{app11_boxes, strip_framing_markers, App11Map, JumbfBox};
use super::markers::{ai_and_c2pa_markers, contains_any, hits_name_c2pa, join_hits, C2PA_MARKERS};

/// The two-byte start-of-image marker.
pub const JPEG_SOI: &[u8] = b"\xff\xd8";

/// APP segments scanned for provenance strings: APP1 (Exif and XMP), APP2
/// (ICC and MPF), APP11 (JUMBF), APP13 (Photoshop IRB and IPTC), APP14 (Adobe).
const SCANNED_APP_MARKERS: &[u8] = &[
    markers::APP1,
    markers::APP2,
    markers::APP11,
    markers::APP13,
    markers::APP14,
];

/// Parse a JPEG, or explain why it could not be parsed.
fn parse(data: &[u8]) -> Result<Jpeg, String> {
    Jpeg::from_bytes(Bytes::copy_from_slice(data)).map_err(|error| error.to_string())
}

/// The `APPn` number for a marker byte, for the finding strings.
fn app_number(marker: u8) -> u8 {
    marker.wrapping_sub(markers::APP0)
}

/// Whole-file marker hits, minus anything the structural pass already explained.
///
/// The fallback scan exists to catch a manifest the segment walk cannot reach.
/// It is not evidence on its own: `jumb` and `jumd` are ISO/IEC 19566-5 *box
/// type* codes, so they appear in every JUMBF box including the JPEG XT, JPEG
/// 360 and privacy boxes that are not C2PA at all. When the reassembled boxes
/// have already been examined and found not to be C2PA, those two markers are
/// accounted for and must not be re-reported as an unexplained hit; a marker
/// naming C2PA itself is never filtered.
fn whole_file_hits(data: &[u8], boxes: &[JumbfBox]) -> Vec<String> {
    let hits = contains_any(data, C2PA_MARKERS);
    if boxes.is_empty() {
        return hits;
    }
    strip_framing_markers(hits)
}

/// Inspect a JPEG. Returns `(has_c2pa, has_ai_metadata, findings)`.
///
/// A JPEG that fails to parse still gets the whole-file marker scan, so a
/// truncated file carrying a manifest is reported rather than silently passed.
pub fn inspect_jpeg(data: &[u8]) -> (bool, bool, Vec<String>) {
    let mut findings = Vec::new();
    let mut has_c2pa = false;
    let mut has_ai = false;
    if !data.starts_with(JPEG_SOI) {
        return (false, false, vec!["not a JPEG".to_string()]);
    }
    let combined = ai_and_c2pa_markers();

    let mut boxes: Vec<JumbfBox> = Vec::new();
    match parse(data) {
        Ok(jpeg) => {
            let segments = jpeg.segments();
            boxes = app11_boxes(segments);
            if boxes.iter().any(|jumbf| jumbf.is_c2pa) {
                has_c2pa = true;
                findings.push("JPEG APP11 segment (JUMBF/C2PA common)".to_string());
            }
            for jumbf in &boxes {
                if jumbf.segments.len() > 1 {
                    findings.push(format!(
                        "JPEG APP11 JUMBF box {} reassembled from {} segments",
                        jumbf.instance,
                        jumbf.segments.len()
                    ));
                }
                if !jumbf.is_c2pa {
                    findings.push(format!(
                        "JPEG application data 11 carries a non-C2PA JUMBF box {} (preserved)",
                        jumbf.instance
                    ));
                }
                let hits = strip_framing_markers(contains_any(&jumbf.payload, &combined));
                if !hits.is_empty() {
                    has_ai = true;
                    findings.push(format!("JPEG APP11: {}", join_hits(&hits, 8)));
                }
            }

            for segment in segments {
                let marker = segment.marker();
                if marker == markers::APP11 || !SCANNED_APP_MARKERS.contains(&marker) {
                    continue;
                }
                let hits = contains_any(segment.contents(), &combined);
                if hits.is_empty() {
                    continue;
                }
                has_ai = true;
                if hits_name_c2pa(&hits, true) {
                    has_c2pa = true;
                }
                findings.push(format!(
                    "JPEG APP{}: {}",
                    app_number(marker),
                    join_hits(&hits, 8)
                ));
            }
        }
        Err(error) => findings.push(format!("malformed JPEG: {error}")),
    }

    let whole = whole_file_hits(data, &boxes);
    if !whole.is_empty() && !has_c2pa {
        has_c2pa = true;
        findings.push(format!("byte-scan C2PA markers: {}", join_hits(&whole, 6)));
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Decide whether one segment is dropped, and say why.
///
/// APP0 (JFIF) is kept by default for decoder compatibility. An APP11 segment
/// carrying a C2PA manifest store always goes, identified through
/// `c2pa_segments`; one carrying any other JUMBF or JPEG XT box is treated like
/// any other application segment, so it survives unless a full metadata strip
/// was asked for or it carries a provenance marker.
fn drop_reason(
    index: usize,
    segment: &JpegSegment,
    strip_all_app: bool,
    combined: &[&[u8]],
    app11: &App11Map,
) -> Option<String> {
    let marker = segment.marker();
    if marker == markers::COM {
        return Some("drop COM comment".to_string());
    }
    if !(markers::APP0..=markers::APP15).contains(&marker) {
        return None;
    }
    if marker == markers::APP11 && app11.c2pa.contains(&index) {
        return Some("drop APP11 (C2PA/JUMBF)".to_string());
    }
    if strip_all_app && marker != markers::APP0 {
        return Some(format!("drop APP{}", app_number(marker)));
    }
    // A segment already accounted for by a parsed non-C2PA JUMBF box must not
    // be condemned by its own framing: `jumb` and `jumd` are box-type codes.
    let hits = if app11.examined.contains(&index) {
        strip_framing_markers(contains_any(segment.contents(), combined))
    } else {
        contains_any(segment.contents(), combined)
    };
    if !hits.is_empty() {
        return Some(format!("drop APP{} (AI/C2PA markers)", app_number(marker)));
    }
    None
}

/// Note when a parse-and-re-encode of the untouched container is not
/// byte-identical, so the caller learns the file carried something outside the
/// segment model (most often bytes trailing the end-of-image marker).
fn fidelity_note(data: &[u8], jpeg: &Jpeg) -> Option<String> {
    let round_trip = jpeg.clone().encoder().bytes();
    if round_trip.as_ref() == data {
        return None;
    }
    Some(format!(
        "note: container re-encode differs from input by {} bytes outside the segment structure",
        data.len().abs_diff(round_trip.len())
    ))
}

/// Strip APP and COM segments from a JPEG, returning the new bytes and actions.
///
/// The entropy-coded scan is never touched: it is carried through as the SOS
/// segment's entropy, so pixel data is bit-for-bit identical.
///
/// # Errors
///
/// Returns `Err` when the input is not a JPEG or its segment structure cannot
/// be parsed.
pub fn strip_jpeg(data: &[u8], strip_all_app: bool) -> Result<(Vec<u8>, Vec<String>), String> {
    if !data.starts_with(JPEG_SOI) {
        return Err("not JPEG".to_string());
    }
    let mut jpeg = parse(data).map_err(|error| format!("malformed JPEG: {error}"))?;
    let combined = ai_and_c2pa_markers();

    let mut actions: Vec<String> = Vec::new();
    let note = fidelity_note(data, &jpeg);
    // Which APP11 segments carry a C2PA manifest store, decided once from the
    // reassembled boxes rather than guessed per segment.
    let app11 = App11Map::of(jpeg.segments());

    let mut index = 0usize;
    jpeg.segments_mut().retain(|segment| {
        let reason = drop_reason(index, segment, strip_all_app, &combined, &app11);
        index += 1;
        match reason {
            Some(action) => {
                actions.push(action);
                false
            }
            None => true,
        }
    });

    if actions.is_empty() {
        return Ok((
            data.to_vec(),
            vec!["no JPEG APP segments removed".to_string()],
        ));
    }
    actions.extend(note);
    Ok((jpeg.encoder().bytes().to_vec(), actions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::jumbf::fixtures::{c2pa_jumbf, jumbf_box};

    fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        out.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    /// A minimal JPEG: SOI, the given segments, then a token scan and EOI.
    pub(super) fn jpeg_with(segments: &[(u8, &[u8])]) -> Vec<u8> {
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

    /// One APP11 packet of a JUMBF box, with the JPEG XT header.
    fn app11_packet(instance: u16, sequence: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = b"JP".to_vec();
        out.extend_from_slice(&instance.to_be_bytes());
        out.extend_from_slice(&sequence.to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn rejects_non_jpeg_bytes() {
        assert_eq!(inspect_jpeg(b"nope").2, vec!["not a JPEG".to_string()]);
        assert!(strip_jpeg(b"nope", true).is_err());
    }

    #[test]
    fn parsing_and_re_encoding_is_byte_identical() {
        let jpeg = jpeg_with(&[(0xE1, b"Exif\x00\x00ordinary camera tags")]);
        let parsed = parse(&jpeg).unwrap();
        assert_eq!(parsed.encoder().bytes().to_vec(), jpeg);
    }

    #[test]
    fn an_app11_c2pa_manifest_store_is_identified_and_dropped() {
        let packet = app11_packet(0, 0, &c2pa_jumbf(b"manifest content"));
        let jpeg = jpeg_with(&[(0xEB, &packet)]);
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
    fn a_non_c2pa_jumbf_box_is_neither_flagged_nor_deleted() {
        // JPEG XT, JPEG 360 and privacy-and-security boxes all live in APP11.
        // Treating the segment marker as proof of C2PA both mislabels them and
        // throws away auxiliary image data.
        let other_uuid = [
            0x6A, 0x70, 0x36, 0x30, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38,
            0x9B, 0x71,
        ];
        let packet = app11_packet(0, 0, &jumbf_box(&other_uuid, b"jp360", b"nope"));
        let jpeg = jpeg_with(&[(0xEB, &packet)]);

        let (c2pa, _, findings) = inspect_jpeg(&jpeg);
        assert!(!c2pa, "a non-C2PA JUMBF box is not C2PA: {findings:?}");
        assert!(findings
            .iter()
            .any(|f| f.contains("non-C2PA JUMBF box 0 (preserved)")));

        // Kept when only provenance is being removed...
        let (cleaned, actions) = strip_jpeg(&jpeg, false).unwrap();
        assert!(
            !actions.iter().any(|a| a.contains("APP11")),
            "actions were {actions:?}"
        );
        assert!(cleaned.windows(5).any(|w| w == b"jp360"));

        // ...and removed only when the caller asked for every APP segment.
        let (cleaned, actions) = strip_jpeg(&jpeg, true).unwrap();
        assert!(actions.contains(&"drop APP11".to_string()));
        assert!(!cleaned.windows(5).any(|w| w == b"jp360"));
    }

    #[test]
    fn an_app11_segment_without_a_parseable_box_is_not_c2pa() {
        // The old behaviour: any APP11 at all counted as a manifest.
        let jpeg = jpeg_with(&[(0xEB, b"JP\x00\x00jumb")]);
        assert!(!inspect_jpeg(&jpeg).0);
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
        // The length runs far past EOF, so the segment walk cannot complete.
        //
        // This replaces the previous `bad segment length at marker 0xE1`
        // assertion: `img-parts` reports one truncation error for the file
        // rather than naming the marker, and reproducing the old string would
        // mean re-deriving the hand-rolled walk this module exists to delete.
        let mut jpeg = JPEG_SOI.to_vec();
        jpeg.extend_from_slice(&[0xFF, 0xE1, 0xFF, 0xFF]);
        jpeg.extend_from_slice(b"short");
        let (_, _, findings) = inspect_jpeg(&jpeg);
        assert!(findings.iter().any(|f| f.starts_with("malformed JPEG: ")));
        assert!(strip_jpeg(&jpeg, true)
            .unwrap_err()
            .starts_with("malformed JPEG"));
    }

    #[test]
    fn the_jfif_app0_segment_survives_every_strip() {
        // APP0 is decoder compatibility information, not provenance. A
        // metadata-free JPEG must keep it — the round-trip guarantee makes that
        // automatic, but a JPEG that *does* have something removed is
        // re-encoded, and APP0 has to survive that path too.
        let clean = jpeg_with(&[]);
        let (out, _) = strip_jpeg(&clean, true).unwrap();
        assert_eq!(out, clean, "a clean JPEG is returned unchanged");
        assert!(out.windows(4).any(|w| w == b"JFIF"));

        let marked = jpeg_with(&[(0xE1, b"Exif\x00\x00Generated by Claude")]);
        let (out, actions) = strip_jpeg(&marked, true).unwrap();
        assert!(actions.iter().any(|a| a.starts_with("drop APP1")));
        assert!(
            out.windows(4).any(|w| w == b"JFIF"),
            "APP0 must survive a re-encode: actions were {actions:?}"
        );
        assert!(out.starts_with(b"\xff\xd8\xff\xe0"), "APP0 stays first");
    }

    #[test]
    fn a_clean_jpeg_is_returned_byte_for_byte() {
        let jpeg = jpeg_with(&[]);
        let (cleaned, actions) = strip_jpeg(&jpeg, false).unwrap();
        assert_eq!(actions, vec!["no JPEG APP segments removed".to_string()]);
        assert_eq!(cleaned, jpeg);
    }

    #[test]
    fn bytes_outside_the_segment_structure_are_reported() {
        // Marker fill bytes (repeated 0xFF ahead of a marker) are legal but
        // carry no information, so the segment model drops them. Saying so is
        // what keeps "untouched parts are byte-identical" an honest claim.
        let clean = jpeg_with(&[(0xFE, b"a comment")]);
        let split = clean
            .windows(2)
            .position(|window| window == [0xFF, 0xFE])
            .expect("the comment segment is present");
        let mut padded = clean[..split].to_vec();
        padded.push(0xFF);
        padded.extend_from_slice(&clean[split..]);

        let (_, actions) = strip_jpeg(&padded, true).unwrap();
        assert!(
            actions.iter().any(|a| a.starts_with("note: container")),
            "actions were {actions:?}"
        );

        // Bytes after the end-of-image marker ride along in the entropy-coded
        // scan and are preserved, so they raise no note.
        let mut trailing = clean.clone();
        trailing.extend_from_slice(b"trailing junk");
        let (cleaned, actions) = strip_jpeg(&trailing, true).unwrap();
        assert!(!actions.iter().any(|a| a.starts_with("note: container")));
        assert!(cleaned.ends_with(b"trailing junk"));
    }
}
