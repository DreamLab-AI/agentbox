//! Decoding, not merely stripping, of steganographic payloads.
//!
//! Three carriers hide arbitrary bytes in text that survives copy and paste.
//! Deleting them silently is the weaker response: what was hidden is the part
//! worth reporting, and recovering it turns a tidier into a security tool. The
//! variation-selector carrier is not hypothetical — it was used in the real
//! *os-info-checker-es6* npm supply-chain attack.
//!
//! | Carrier | Encoding | Legitimate use it must not shadow |
//! |---|---|---|
//! | Variation selectors | [Butler 2025](https://paulbutler.org/2025/smuggling-arbitrary-data-through-an-emoji/) byte map over the 256 selectors | Exactly one selector per base: emoji presentation (`U+FE0E`/`U+FE0F`) and CJK ideographic variation sequences |
//! | Tag block | `U+E0020..=U+E007E` minus `0xE0000` is ASCII | `U+1F3F4` + subdivision tags + `U+E007F`: the England, Scotland and Wales flags |
//! | Zero-width run | One bit per zero-width character | Emoji ZWJ glue, Indic virama forms, Persian morpheme joiners |
//!
//! # The discriminator, in one line
//!
//! **Legitimate use is exactly one variation selector per base character.**
//! No well-formed sequence stacks two, so a chain of two or more is
//! mechanically certain contraband and can be decoded without guessing. A lone
//! selector is indistinguishable from legitimate variation selection and is
//! deliberately *not* reported as a payload: that costs the one-byte case and
//! buys a zero false-positive rate on real emoji and CJK text.

use prose_sanitiser_core::Unit;

/// Which carrier hid the bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadKind {
    /// A chain of two or more variation selectors, per the Butler byte map.
    VariationSelector,
    /// Tag-block characters carrying ASCII, outside a valid flag sequence.
    TagBlock,
    /// A run of zero-width characters used as binary.
    ZeroWidthBinary,
}

impl PayloadKind {
    /// The lowercase wire form used in JSON reports.
    pub fn as_str(self) -> &'static str {
        match self {
            PayloadKind::VariationSelector => "variation_selector",
            PayloadKind::TagBlock => "tag_block",
            PayloadKind::ZeroWidthBinary => "zero_width_binary",
        }
    }
}

/// One recovered payload: where it hid, what carried it, and the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payload {
    /// Which carrier hid the bytes.
    pub kind: PayloadKind,
    /// Character offset of the first carrier character.
    pub start: usize,
    /// Character offset one past the last carrier character.
    pub end: usize,
    /// The character the chain hung off, when there was one.
    pub base: Option<char>,
    /// The recovered bytes, in order.
    pub bytes: Vec<u8>,
    /// Why this run was judged a payload rather than legitimate text.
    pub note: &'static str,
}

impl Payload {
    /// How many carrier characters the payload occupies.
    pub fn len(&self) -> usize {
        self.end - self.start
    }

    /// Whether the payload occupies no characters. Never true in practice; it
    /// exists because clippy asks for it alongside [`Payload::len`].
    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    /// Lowercase hex of the recovered bytes, e.g. `68690a`.
    pub fn hex(&self) -> String {
        self.bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The payload as printable text, with non-printing bytes shown as `.`.
    ///
    /// Deliberately lossy and never re-emitted as data: this is for a human
    /// reading a report, and [`Payload::bytes`] is the ground truth.
    pub fn printable(&self) -> String {
        self.bytes
            .iter()
            .map(|&byte| {
                if (0x20..0x7F).contains(&byte) {
                    byte as char
                } else {
                    '.'
                }
            })
            .collect()
    }

    /// The payload decoded as UTF-8, or `None` when it is not valid UTF-8.
    ///
    /// Smuggled payloads are frequently prompt-injection text, so the decoded
    /// string is the useful form; binary payloads correctly return `None`
    /// rather than being mangled into replacement characters.
    pub fn as_text(&self) -> Option<String> {
        String::from_utf8(self.bytes.clone()).ok()
    }
}

/// Variation selectors 1..=16, the low half of the Butler byte map.
const VS_LOW: std::ops::RangeInclusive<u32> = 0xFE00..=0xFE0F;
/// Variation selectors 17..=256, the high half.
const VS_HIGH: std::ops::RangeInclusive<u32> = 0xE0100..=0xE01EF;
/// Tag characters that carry ASCII `0x20..=0x7E`.
const TAG_ASCII: std::ops::RangeInclusive<u32> = 0xE0020..=0xE007E;
/// CANCEL TAG, the terminator of an emoji tag sequence.
const TAG_CANCEL: u32 = 0xE007F;
/// LANGUAGE TAG: deprecated in Unicode 5.1 and never legitimate in modern text.
const TAG_LANGUAGE: u32 = 0xE0001;
/// WAVING BLACK FLAG, the only valid base for an emoji tag sequence.
const FLAG_BASE: char = '\u{1F3F4}';

/// The RGI subdivision-flag tag sequences: England, Scotland and Wales.
///
/// Per [UTS #51](https://www.unicode.org/reports/tr51/) these are the only
/// emoji tag sequences in Recommended-for-General-Interchange data, so any
/// other tag payload hanging off `U+1F3F4` is smuggled rather than a flag.
pub const RGI_SUBDIVISION_TAGS: &[&str] = &["gbeng", "gbsct", "gbwls"];

/// A run of this many zero-width characters is never legitimate text.
///
/// One byte is eight bits, and no orthography stacks eight joiners, so this is
/// the point at which a run stops being plausible shaping and starts being a
/// carrier.
pub const ZERO_WIDTH_RUN_THRESHOLD: usize = 8;

const NOTE_VS: &str =
    "Two or more stacked variation selectors; legitimate use is exactly one per base";
const NOTE_TAG: &str = "Tag-block characters outside a well-formed RGI subdivision-flag sequence";
const NOTE_LANGUAGE: &str = "Deprecated LANGUAGE TAG (U+E0001), withdrawn in Unicode 5.1";
const NOTE_ZW: &str =
    "Zero-width run of eight or more; bit mapping ZWSP/WJ=0, ZWNJ/ZWJ=1 is conventional, not standardised";

/// Decode a byte from a variation selector, per the Butler map.
///
/// `U+FE00 + n` carries byte `n` for `n < 16`; `U+E0100 + n` carries byte
/// `n + 16`. Returns `None` for anything that is not a variation selector.
pub fn variation_selector_byte(codepoint: u32) -> Option<u8> {
    if VS_LOW.contains(&codepoint) {
        return Some((codepoint - 0xFE00) as u8);
    }
    if VS_HIGH.contains(&codepoint) {
        return Some((codepoint - 0xE0100 + 16) as u8);
    }
    None
}

/// Encode one byte as its variation selector, the inverse of
/// [`variation_selector_byte`].
///
/// Provided so tests and fixtures can build a payload without restating the
/// mapping, which is how an encoder and decoder drift apart.
pub fn byte_to_variation_selector(byte: u8) -> char {
    let codepoint = if byte < 16 {
        0xFE00 + u32::from(byte)
    } else {
        0xE0100 + u32::from(byte) - 16
    };
    char::from_u32(codepoint).expect("variation selector codepoints are all assigned")
}

/// Whether `codepoint` is any variation selector.
pub fn is_variation_selector(codepoint: u32) -> bool {
    VS_LOW.contains(&codepoint) || VS_HIGH.contains(&codepoint)
}

/// Whether `codepoint` is a tag-block character.
pub fn is_tag_char(codepoint: u32) -> bool {
    TAG_ASCII.contains(&codepoint) || codepoint == TAG_CANCEL || codepoint == TAG_LANGUAGE
}

/// The bit a zero-width character contributes, if it is one of the alphabet.
///
/// The bit value is the conventional one (ZWSP and the word joiner read as 0,
/// ZWNJ and ZWJ as 1). Unlike the variation-selector map this convention is not
/// standardised, so the recovered bytes are a best-effort reading of a payload
/// whose *presence* is nonetheless certain.
fn zero_width_bit(codepoint: u32) -> Option<u8> {
    match codepoint {
        0x200B | 0x2060 | 0xFEFF => Some(0),
        0x200C | 0x200D => Some(1),
        _ => None,
    }
}

/// The character at `offset`, or `None` for an undecodable byte.
fn char_at(units: &[Unit], offset: usize) -> Option<char> {
    units.get(offset).copied().and_then(Unit::as_char)
}

/// Recover every steganographic payload in `units`.
///
/// Scans once, left to right. Chains are maximal: a run is consumed whole, so
/// a payload is reported once rather than per character.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::surrogate;
/// use prose_sanitiser_unicode::stego::{byte_to_variation_selector, scan, PayloadKind};
///
/// let mut text = String::from("x");
/// for byte in b"hi" {
///     text.push(byte_to_variation_selector(*byte));
/// }
/// let payloads = scan(&surrogate::decode(text.as_bytes()));
/// assert_eq!(payloads.len(), 1);
/// assert_eq!(payloads[0].kind, PayloadKind::VariationSelector);
/// assert_eq!(payloads[0].bytes, b"hi");
/// assert_eq!(payloads[0].as_text().as_deref(), Some("hi"));
/// ```
pub fn scan(units: &[Unit]) -> Vec<Payload> {
    let mut payloads = Vec::new();
    let mut offset = 0usize;

    while offset < units.len() {
        let Some(character) = char_at(units, offset) else {
            offset += 1;
            continue;
        };
        let codepoint = character as u32;

        if is_variation_selector(codepoint) {
            let (next, payload) = read_variation_chain(units, offset);
            payloads.extend(payload);
            offset = next;
            continue;
        }
        if is_tag_char(codepoint) {
            let (next, payload) = read_tag_chain(units, offset);
            payloads.extend(payload);
            offset = next;
            continue;
        }
        if zero_width_bit(codepoint).is_some() {
            let (next, payload) = read_zero_width_run(units, offset);
            payloads.extend(payload);
            offset = next;
            continue;
        }
        offset += 1;
    }
    payloads
}

/// The character a chain hangs off, if the chain is not at the start of input.
fn base_before(units: &[Unit], start: usize) -> Option<char> {
    start
        .checked_sub(1)
        .and_then(|previous| char_at(units, previous))
}

/// Consume a maximal variation-selector run, decoding it when it is a payload.
fn read_variation_chain(units: &[Unit], start: usize) -> (usize, Option<Payload>) {
    let mut end = start;
    let mut bytes = Vec::new();
    while let Some(byte) = char_at(units, end).and_then(|c| variation_selector_byte(c as u32)) {
        bytes.push(byte);
        end += 1;
    }
    // Exactly one selector is legitimate variation selection: emoji
    // presentation, or a CJK ideographic variation sequence. Only a stack of
    // two or more is mechanically certain contraband.
    if bytes.len() < 2 {
        return (end.max(start + 1), None);
    }
    (
        end,
        Some(Payload {
            kind: PayloadKind::VariationSelector,
            start,
            end,
            base: base_before(units, start),
            bytes,
            note: NOTE_VS,
        }),
    )
}

/// Consume a maximal tag-block run, decoding it unless it is a genuine flag.
fn read_tag_chain(units: &[Unit], start: usize) -> (usize, Option<Payload>) {
    let mut end = start;
    let mut bytes = Vec::new();
    let mut cancelled = false;
    let mut language_tag = false;
    while let Some(codepoint) = char_at(units, end).map(|c| c as u32) {
        if TAG_ASCII.contains(&codepoint) {
            bytes.push((codepoint - 0xE0000) as u8);
            end += 1;
            continue;
        }
        if codepoint == TAG_CANCEL {
            cancelled = true;
            end += 1;
            break;
        }
        if codepoint == TAG_LANGUAGE {
            // Deprecated LANGUAGE TAG: carries no ASCII, but its presence is
            // itself the finding.
            language_tag = true;
            end += 1;
            continue;
        }
        break;
    }
    if bytes.is_empty() && !language_tag {
        return (end.max(start + 1), None);
    }
    let base = base_before(units, start);
    let decoded = String::from_utf8_lossy(&bytes).to_string();
    // The England, Scotland and Wales flags are exactly this shape and must
    // survive: waving black flag, a recognised subdivision code, CANCEL TAG.
    let is_flag = !language_tag
        && base == Some(FLAG_BASE)
        && cancelled
        && RGI_SUBDIVISION_TAGS.contains(&decoded.as_str());
    if is_flag {
        return (end, None);
    }
    (
        end,
        Some(Payload {
            kind: PayloadKind::TagBlock,
            start,
            end,
            base,
            bytes,
            note: if language_tag {
                NOTE_LANGUAGE
            } else {
                NOTE_TAG
            },
        }),
    )
}

/// Consume a maximal zero-width run, decoding it when it is long enough to be
/// a carrier rather than shaping.
fn read_zero_width_run(units: &[Unit], start: usize) -> (usize, Option<Payload>) {
    let mut end = start;
    let mut bits = Vec::new();
    while let Some(bit) = char_at(units, end).and_then(|c| zero_width_bit(c as u32)) {
        bits.push(bit);
        end += 1;
    }
    if bits.len() < ZERO_WIDTH_RUN_THRESHOLD {
        return (end.max(start + 1), None);
    }
    // Most significant bit first, dropping a trailing partial byte: fewer than
    // eight bits carry nothing recoverable.
    let bytes: Vec<u8> = bits
        .chunks_exact(8)
        .map(|chunk| chunk.iter().fold(0u8, |acc, &bit| (acc << 1) | bit))
        .collect();
    (
        end,
        Some(Payload {
            kind: PayloadKind::ZeroWidthBinary,
            start,
            end,
            base: base_before(units, start),
            bytes,
            note: NOTE_ZW,
        }),
    )
}

#[cfg(test)]
mod tests;
