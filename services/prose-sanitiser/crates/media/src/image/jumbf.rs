//! JUMBF box structure, and telling a C2PA manifest store from everything else.
//!
//! APP11 is not a C2PA marker. It is the general JPEG XT part 3 carrier for
//! ISO/IEC 19566-5 (JUMBF) boxes, and HDR data, JPEG 360 metadata and
//! privacy-and-security boxes all travel in it. Treating the segment marker
//! alone as proof of C2PA both mislabels those and throws them away, so this
//! module reassembles the box and reads its declared type.
//!
//! Two structures matter:
//!
//! * **The APP11 packet header** — `'J' 'P'`, a two-byte box instance number
//!   and a four-byte packet sequence number. A JUMBF box routinely exceeds the
//!   65,533-byte JPEG segment payload limit, so one box arrives split across
//!   several segments sharing an instance number and ordered by sequence
//!   number.
//! * **The box itself** — a `jumb` superbox whose first child is a `jumd`
//!   description box carrying a 16-byte type UUID, a toggle byte and an
//!   optional NUL-terminated label.

use std::collections::BTreeSet;

use img_parts::jpeg::{markers, JpegSegment};
use img_parts::Bytes;

/// The JPEG XT part 3 APP11 header length: `JP`, instance, sequence.
pub(super) const APP11_HEADER_LEN: usize = 8;

/// The trailing twelve bytes every C2PA JUMBF type UUID shares.
///
/// C2PA 2.4 assigns its box types as `<four ASCII bytes>-0011-0010-8000-00AA00389B71`:
/// `c2pa` for the manifest store, `c2ma` for a manifest, `c2as` for an
/// assertion store, `c2cl` for a claim. Only the first four bytes vary, so the
/// suffix is what identifies the family and the prefix says which member.
const C2PA_UUID_SUFFIX: [u8; 12] = [
    0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
];

/// Whether a description-box type UUID belongs to the C2PA family.
///
/// Matching the family rather than only the manifest-store UUID means a nested
/// `c2ma` manifest, `c2as` assertion store or `c2cl` claim box is recognised
/// too, which matters for an asset that embeds a bare manifest without the
/// store wrapper. The twelve-byte suffix is the discriminator; a JPEG XT or
/// JPEG 360 box has a different one and is not matched.
fn is_c2pa_box_type(uuid: &[u8]) -> bool {
    uuid.len() == 16
        && uuid[4..] == C2PA_UUID_SUFFIX
        && uuid.starts_with(b"c2")
        && uuid[..4].iter().all(u8::is_ascii_alphanumeric)
}

/// The JUMBF description-box toggle bit meaning "a label follows the UUID".
const JUMD_TOGGLE_LABEL: u8 = 0x02;

/// Read one ISO base-media-style box header, returning its type and payload.
///
/// Handles all three length forms: an ordinary 32-bit `LBox`, `LBox == 1` with
/// a 64-bit `XLBox`, and `LBox == 0` meaning "to the end of the enclosing box".
pub(super) fn read_box(data: &[u8]) -> Option<(&[u8], &[u8])> {
    if data.len() < 8 {
        return None;
    }
    let lbox = u32::from_be_bytes(data[0..4].try_into().ok()?) as u64;
    let tbox = &data[4..8];
    let (header, total) = match lbox {
        1 => {
            if data.len() < 16 {
                return None;
            }
            (16u64, u64::from_be_bytes(data[8..16].try_into().ok()?))
        }
        0 => (8, data.len() as u64),
        other => (8, other),
    };
    if total < header || total > data.len() as u64 {
        return None;
    }
    Some((tbox, &data[header as usize..total as usize]))
}

/// Whether a reassembled JUMBF superbox is a C2PA manifest store.
///
/// The structure is specified: a `jumb` superbox whose first child is a `jumd`
/// description box carrying a 16-byte type UUID, a toggle byte and an optional
/// NUL-terminated label. A box is C2PA when that UUID is in the C2PA family
/// (see [`is_c2pa_box_type`]), or when the label says `c2pa`.
///
/// APP11 is a general JPEG XT and JUMBF carrier: JPEG XT HDR data, JPEG 360
/// metadata and privacy-and-security boxes all live there. Treating the segment
/// marker alone as proof of C2PA both mislabels those and deletes them.
pub(super) fn jumbf_is_c2pa(payload: &[u8]) -> bool {
    let Some((tbox, body)) = read_box(payload) else {
        return false;
    };
    if tbox != b"jumb" {
        return false;
    }
    let Some((description_tbox, description)) = read_box(body) else {
        return false;
    };
    if description_tbox != b"jumd" || description.len() < 17 {
        return false;
    }
    if is_c2pa_box_type(&description[..16]) {
        return true;
    }
    if description[16] & JUMD_TOGGLE_LABEL == 0 {
        return false;
    }
    let label = &description[17..];
    let end = label
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(label.len());
    label[..end].eq_ignore_ascii_case(b"c2pa")
}

/// One JUMBF box reassembled from the APP11 segments that carry it.
///
/// ISO/IEC 19566-5 boxes routinely exceed the 65,533-byte JPEG segment payload
/// limit, so a C2PA manifest store arrives split across several APP11 segments
/// sharing a box instance number and ordered by packet sequence number. A
/// marker that straddles a segment boundary is invisible to a per-segment scan
/// and only shows up once the payload is put back together.
#[derive(Debug)]
pub(super) struct JumbfBox {
    /// The box instance number from the APP11 header.
    pub(super) instance: u16,
    /// Indices into the segment list of every APP11 segment carrying this box.
    pub(super) segments: Vec<usize>,
    /// The concatenated payload, in packet-sequence order.
    pub(super) payload: Vec<u8>,
    /// Whether the reassembled box is a C2PA manifest store.
    pub(super) is_c2pa: bool,
}

/// Reassemble every APP11 JUMBF box in segment order.
pub(super) fn app11_boxes(segments: &[JpegSegment]) -> Vec<JumbfBox> {
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
    for (instance, _, index, payload) in packets {
        match boxes.last_mut() {
            Some(last) if last.instance == instance => {
                last.segments.push(index);
                last.payload.extend_from_slice(&payload);
            }
            _ => boxes.push(JumbfBox {
                instance,
                segments: vec![index],
                payload: payload.to_vec(),
                is_c2pa: false,
            }),
        }
    }
    for jumbf in &mut boxes {
        jumbf.is_c2pa = jumbf_is_c2pa(&jumbf.payload);
    }
    boxes
}

/// Drop the JUMBF box-type codes from a marker hit list.
///
/// `jumb` and `jumd` are ISO/IEC 19566-5 *box type* codes. They appear in every
/// JUMBF box, C2PA or not, so on their own they identify framing rather than
/// provenance. A marker naming C2PA itself is never filtered.
pub(super) fn strip_framing_markers(hits: Vec<String>) -> Vec<String> {
    hits.into_iter()
        .filter(|hit| !hit.eq_ignore_ascii_case("jumb") && !hit.eq_ignore_ascii_case("jumd"))
        .collect()
}

/// Which APP11 segments the JUMBF pass examined, and which of those are C2PA.
#[derive(Debug, Default)]
pub(super) struct App11Map {
    /// Every APP11 segment that belongs to a reassembled box.
    pub(super) examined: BTreeSet<usize>,
    /// The subset carrying a C2PA manifest store.
    pub(super) c2pa: BTreeSet<usize>,
}

impl App11Map {
    pub(super) fn of(segments: &[JpegSegment]) -> Self {
        let mut map = Self::default();
        for jumbf in app11_boxes(segments) {
            for index in &jumbf.segments {
                map.examined.insert(*index);
                if jumbf.is_c2pa {
                    map.c2pa.insert(*index);
                }
            }
        }
        map
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! Box builders shared with the JPEG tests.

    use super::C2PA_UUID_SUFFIX;

    /// The JUMBF type UUID a C2PA manifest **store** declares: the box an APP11
    /// segment carries at the top level, and the one real assets use.
    ///
    /// Test-only. Production recognises the whole family through
    /// [`super::is_c2pa_box_type`], so hard-coding one member here would only
    /// re-test the constant.
    pub(crate) const C2PA_JUMBF_UUID: [u8; 16] = {
        let mut uuid = [0u8; 16];
        uuid[0] = b'c';
        uuid[1] = b'2';
        uuid[2] = b'p';
        uuid[3] = b'a';
        let mut index = 0;
        while index < C2PA_UUID_SUFFIX.len() {
            uuid[4 + index] = C2PA_UUID_SUFFIX[index];
            index += 1;
        }
        uuid
    };

    /// An ISO base-media box: `LBox`, `TBox`, payload.
    pub(crate) fn iso_box(tbox: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(tbox);
        out.extend_from_slice(payload);
        out
    }

    /// A JUMBF superbox with the given description-box type UUID and label.
    pub(crate) fn jumbf_box(uuid: &[u8; 16], label: &[u8], content: &[u8]) -> Vec<u8> {
        let mut description = uuid.to_vec();
        description.push(super::JUMD_TOGGLE_LABEL);
        description.extend_from_slice(label);
        description.push(0);

        let mut body = iso_box(b"jumd", &description);
        body.extend_from_slice(&iso_box(b"c2cl", content));
        iso_box(b"jumb", &body)
    }

    /// A JUMBF superbox that really is a C2PA manifest store.
    pub(crate) fn c2pa_jumbf(content: &[u8]) -> Vec<u8> {
        jumbf_box(&C2PA_JUMBF_UUID, b"c2pa", content)
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{c2pa_jumbf, jumbf_box, C2PA_JUMBF_UUID};
    use super::*;

    #[test]
    fn the_whole_c2pa_uuid_family_is_recognised() {
        // C2PA assigns `c2pa` (manifest store), `c2ma` (manifest), `c2as`
        // (assertion store) and `c2cl` (claim), all sharing one suffix. A box
        // carrying a nested manifest without the store wrapper is still C2PA.
        for prefix in [b"c2pa", b"c2ma", b"c2as", b"c2cl"] {
            let mut uuid = [0u8; 16];
            uuid[..4].copy_from_slice(prefix);
            uuid[4..].copy_from_slice(&C2PA_UUID_SUFFIX);
            assert!(
                is_c2pa_box_type(&uuid),
                "{} should be C2PA",
                String::from_utf8_lossy(prefix)
            );
            assert!(jumbf_is_c2pa(&jumbf_box(&uuid, b"whatever", b"x")));
        }

        // The suffix is the discriminator: the same ASCII prefix with any other
        // suffix is a different vendor's box.
        let mut impostor = [0u8; 16];
        impostor[..4].copy_from_slice(b"c2pa");
        assert!(!is_c2pa_box_type(&impostor));

        // And a JPEG 360-style box sharing the suffix but not the prefix is not
        // C2PA either.
        let mut other = [0u8; 16];
        other[..4].copy_from_slice(b"jp36");
        other[4..].copy_from_slice(&C2PA_UUID_SUFFIX);
        assert!(!is_c2pa_box_type(&other));

        assert!(!is_c2pa_box_type(&[0u8; 15]), "a short UUID is not a UUID");
    }

    #[test]
    fn the_c2pa_box_is_recognised_by_uuid_and_by_label() {
        // The label alone is enough, because a description box may carry a
        // vendor UUID with the standard label.
        let unknown_uuid = [0xAA; 16];
        assert!(jumbf_is_c2pa(&jumbf_box(&unknown_uuid, b"c2pa", b"x")));
        // And the UUID alone is enough, whatever the label says.
        assert!(jumbf_is_c2pa(&jumbf_box(
            &C2PA_JUMBF_UUID,
            b"something",
            b"x"
        )));
        // Neither: not C2PA. This is the case the old code deleted anyway.
        assert!(!jumbf_is_c2pa(&jumbf_box(&unknown_uuid, b"jp360", b"x")));
    }

    #[test]
    fn truncated_or_absent_framing_is_not_c2pa_and_does_not_panic() {
        assert!(!jumbf_is_c2pa(b""));
        assert!(!jumbf_is_c2pa(b"\x00\x00\x00\x08jumb"));
        assert!(!jumbf_is_c2pa(&[0xFF; 8]));
        // A `jumb` superbox whose first child is not a description box.
        assert!(!jumbf_is_c2pa(&c2pa_jumbf(b"x")[..12]));
    }

    #[test]
    fn a_box_length_running_past_the_payload_is_refused() {
        // LBox claims 4 GiB inside an eight-byte buffer.
        assert!(read_box(b"\xff\xff\xff\xffjumb").is_none());
        // The 64-bit form with a length shorter than its own header.
        let mut extended = 1u32.to_be_bytes().to_vec();
        extended.extend_from_slice(b"jumb");
        extended.extend_from_slice(&4u64.to_be_bytes());
        assert!(read_box(&extended).is_none());
        // The 64-bit form announced but not present.
        let mut truncated = 1u32.to_be_bytes().to_vec();
        truncated.extend_from_slice(b"jumb");
        assert!(read_box(&truncated).is_none());
    }

    #[test]
    fn a_zero_length_box_runs_to_the_end_of_the_buffer() {
        let mut open_ended = 0u32.to_be_bytes().to_vec();
        open_ended.extend_from_slice(b"jumb");
        open_ended.extend_from_slice(b"tail");
        let (tbox, payload) = read_box(&open_ended).expect("LBox 0 is legal");
        assert_eq!(tbox, b"jumb");
        assert_eq!(payload, b"tail");
    }

    #[test]
    fn framing_markers_are_not_provenance() {
        let hits = vec![
            "jumb".to_string(),
            "JUMB".to_string(),
            "c2pa".to_string(),
            "SynthID".to_string(),
        ];
        assert_eq!(
            strip_framing_markers(hits),
            vec!["c2pa".to_string(), "SynthID".to_string()]
        );
    }
}
