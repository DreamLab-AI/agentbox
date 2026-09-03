//! JPEG segment-level inspection and metadata surgery.
//!
//! Segment framing is [`img_parts::jpeg`]'s job: it owns the marker walk, the
//! length fields and the entropy-coded scan, and re-emits untouched segments
//! byte for byte. This module holds the policy — which application segments
//! carry provenance — plus the one structure `img-parts` does not model, the
//! multi-segment APP11 JUMBF box a C2PA manifest store is split across.

use img_parts::jpeg::{markers, Jpeg, JpegSegment};
use img_parts::Bytes;

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

/// The JPEG XT part 3 APP11 header: `'J' 'P'`, a two-byte box instance number
/// and a four-byte packet sequence number, ahead of the JUMBF payload.
const APP11_HEADER_LEN: usize = 8;

/// One JUMBF box reassembled from the APP11 segments that carry it.
///
/// ISO/IEC 19566-5 boxes routinely exceed the 65,533-byte JPEG segment payload
/// limit, so a C2PA manifest store arrives split across several APP11 segments
/// sharing a box instance number and ordered by packet sequence number. A
/// marker that straddles a segment boundary is invisible to a per-segment scan
/// and only shows up once the payload is put back together.
#[derive(Debug)]
struct JumbfBox {
    /// The box instance number from the APP11 header.
    instance: u16,
    /// How many APP11 segments carried this box.
    segments: usize,
    /// The concatenated payload, in packet-sequence order.
    payload: Vec<u8>,
}

/// Reassemble every APP11 JUMBF box in segment order.
fn app11_boxes(segments: &[JpegSegment]) -> Vec<JumbfBox> {
    // (instance, sequence, payload), collected before grouping so the sort is
    // stable within an instance.
    let mut packets: Vec<(u16, u32, usize, Bytes)> = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if segment.marker() != markers::APP11 {
            continue;
        }
        let contents = segment.contents();
        if contents.len() >= APP11_HEADER_LEN && contents.starts_with(b"JP") {
            let instance = u16::from_be_bytes([contents[2], contents[3]]);
            let sequence = u32::from_be_bytes([contents[4], contents[5], contents[6], contents[7]]);
            packets.push((
                instance,
                sequence,
                index,
                contents.slice(APP11_HEADER_LEN..),
            ));
        } else {
            // Not JPEG XT framing. Treat it as a standalone box so the payload
            // is still scanned rather than dropped from the report.
            packets.push((0, index as u32, index, contents.clone()));
        }
    }
    // Sort by instance, then packet sequence, then original position so equal
    // sequence numbers keep file order.
    packets.sort_by_key(|(instance, sequence, index, _)| (*instance, *sequence, *index));

    let mut boxes: Vec<JumbfBox> = Vec::new();
    for (instance, _, _, payload) in packets {
        match boxes.last_mut() {
            Some(last) if last.instance == instance => {
                last.segments += 1;
                last.payload.extend_from_slice(&payload);
            }
            _ => boxes.push(JumbfBox {
                instance,
                segments: 1,
                payload: payload.to_vec(),
            }),
        }
    }
    boxes
}

/// Parse a JPEG, or explain why it could not be parsed.
fn parse(data: &[u8]) -> Result<Jpeg, String> {
    Jpeg::from_bytes(Bytes::copy_from_slice(data)).map_err(|error| error.to_string())
}

/// The `APPn` number for a marker byte, for the finding strings.
fn app_number(marker: u8) -> u8 {
    marker.wrapping_sub(markers::APP0)
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

    match parse(data) {
        Ok(jpeg) => {
            let segments = jpeg.segments();
            let boxes = app11_boxes(segments);
            if !boxes.is_empty() {
                has_c2pa = true;
                findings.push("JPEG APP11 segment (JUMBF/C2PA common)".to_string());
            }
            for jumbf in &boxes {
                if jumbf.segments > 1 {
                    findings.push(format!(
                        "JPEG APP11 JUMBF box {} reassembled from {} segments",
                        jumbf.instance, jumbf.segments
                    ));
                }
                let hits = contains_any(&jumbf.payload, &combined);
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

    let whole = contains_any(data, C2PA_MARKERS);
    if !whole.is_empty() && !has_c2pa {
        has_c2pa = true;
        findings.push(format!("byte-scan C2PA markers: {}", join_hits(&whole, 6)));
    }
    (has_c2pa, has_ai || has_c2pa, findings)
}

/// Decide whether one segment is dropped, and say why.
///
/// APP0 (JFIF) is kept by default for decoder compatibility; APP11 always goes.
fn drop_reason(segment: &JpegSegment, strip_all_app: bool, combined: &[&[u8]]) -> Option<String> {
    let marker = segment.marker();
    if marker == markers::COM {
        return Some("drop COM comment".to_string());
    }
    if !(markers::APP0..=markers::APP15).contains(&marker) {
        return None;
    }
    if marker == markers::APP11 {
        return Some("drop APP11 (C2PA/JUMBF)".to_string());
    }
    if strip_all_app && marker != markers::APP0 {
        return Some(format!("drop APP{}", app_number(marker)));
    }
    if !contains_any(segment.contents(), combined).is_empty() {
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
    jpeg.segments_mut().retain(
        |segment| match drop_reason(segment, strip_all_app, &combined) {
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
            vec!["no JPEG APP segments removed".to_string()],
        ));
    }
    actions.extend(note);
    Ok((jpeg.encoder().bytes().to_vec(), actions))
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
    fn a_jumbf_box_split_across_app11_segments_is_reassembled_and_scanned() {
        // The marker "contentcredentials" straddles the boundary: neither
        // segment contains it, only the reassembled box does.
        let first = app11_packet(1, 0, b"\x00\x00\x02\x00jumbc2ma content");
        let second = app11_packet(1, 1, b"credentials trailer");
        let jpeg = jpeg_with(&[(0xEB, &first), (0xEB, &second)]);

        let (c2pa, ai, findings) = inspect_jpeg(&jpeg);
        assert!(c2pa && ai);
        assert!(
            findings
                .iter()
                .any(|f| f == "JPEG APP11 JUMBF box 1 reassembled from 2 segments"),
            "findings were {findings:?}"
        );
        let reassembled = findings
            .iter()
            .find(|f| f.starts_with("JPEG APP11: "))
            .expect("the reassembled payload is scanned");
        assert!(
            reassembled.contains("contentcredentials"),
            "the split marker must be found: {reassembled}"
        );

        // Every packet of the box goes, not just the first.
        let (cleaned, actions) = strip_jpeg(&jpeg, true).unwrap();
        assert_eq!(
            actions
                .iter()
                .filter(|a| *a == "drop APP11 (C2PA/JUMBF)")
                .count(),
            2
        );
        assert!(!cleaned.windows(4).any(|w| w == b"jumb"));
        assert!(!inspect_jpeg(&cleaned).0);
    }

    #[test]
    fn out_of_order_jumbf_packets_are_reassembled_by_sequence_number() {
        let tail = app11_packet(0, 2, b"credentials");
        let head = app11_packet(0, 1, b"jumb content");
        // Written tail-first; the sequence numbers decide the order.
        let jpeg = jpeg_with(&[(0xEB, &tail), (0xEB, &head)]);
        let findings = inspect_jpeg(&jpeg).2;
        assert!(findings
            .iter()
            .any(|f| f.starts_with("JPEG APP11: ") && f.contains("contentcredentials")));
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
