use super::*;
use prose_sanitiser_core::surrogate;

fn units(text: &str) -> Vec<Unit> {
    surrogate::decode(text.as_bytes())
}

fn found(text: &str) -> Vec<Payload> {
    scan(&units(text))
}

fn vs_chain(base: &str, payload: &[u8]) -> String {
    let mut text = String::from(base);
    for byte in payload {
        text.push(byte_to_variation_selector(*byte));
    }
    text
}

fn tag_chain(base: char, ascii: &str, cancel: bool) -> String {
    let mut text = String::new();
    text.push(base);
    for byte in ascii.bytes() {
        text.push(char::from_u32(0xE0000 + u32::from(byte)).unwrap());
    }
    if cancel {
        text.push('\u{E007F}');
    }
    text
}

#[test]
fn variation_selector_map_round_trips_every_byte() {
    for byte in 0u8..=255 {
        let selector = byte_to_variation_selector(byte);
        assert_eq!(variation_selector_byte(selector as u32), Some(byte));
    }
}

#[test]
fn the_map_spans_both_selector_blocks_exactly() {
    assert_eq!(byte_to_variation_selector(0), '\u{FE00}');
    assert_eq!(byte_to_variation_selector(15), '\u{FE0F}');
    assert_eq!(byte_to_variation_selector(16), '\u{E0100}');
    assert_eq!(byte_to_variation_selector(255), '\u{E01EF}');
    assert_eq!(variation_selector_byte('a' as u32), None);
}

#[test]
fn decodes_a_payload_hidden_after_an_emoji() {
    let payloads = found(&vs_chain("\u{1F600}", b"secret"));
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, PayloadKind::VariationSelector);
    assert_eq!(payloads[0].bytes, b"secret");
    assert_eq!(payloads[0].base, Some('\u{1F600}'));
    assert_eq!(payloads[0].printable(), "secret");
    assert_eq!(payloads[0].hex(), "736563726574");
    assert_eq!(payloads[0].as_text().as_deref(), Some("secret"));
}

#[test]
fn decodes_a_chain_hanging_off_a_non_emoji_base() {
    // The attack does not need an emoji; any base character carries a chain.
    let payloads = found(&vs_chain("x", b"hi"));
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].bytes, b"hi");
    assert_eq!(payloads[0].base, Some('x'));
}

#[test]
fn recovers_arbitrary_non_ascii_bytes() {
    let secret = [0x00u8, 0xFF, 0x10, 0x0F, 0x80];
    let payloads = found(&vs_chain("\u{1F4A9}", &secret));
    assert_eq!(payloads[0].bytes, secret);
    assert_eq!(payloads[0].hex(), "00ff100f80");
    // Non-printing bytes are shown as dots, never re-emitted raw.
    assert_eq!(payloads[0].printable(), ".....");
    // Not valid UTF-8, so the text view correctly declines rather than mangles.
    assert_eq!(payloads[0].as_text(), None);
}

#[test]
fn a_lone_variation_selector_is_legitimate_and_not_a_payload() {
    // Emoji presentation selector: exactly one selector on one base.
    assert!(found("\u{2764}\u{FE0F}").is_empty());
    // A CJK ideographic variation sequence is the same shape.
    assert!(found("\u{845B}\u{E0100}").is_empty());
}

#[test]
fn the_offsets_cover_the_carrier_but_not_the_base() {
    let text = vs_chain("x", b"hi");
    let payload = &found(&text)[0];
    assert_eq!(payload.start, 1);
    assert_eq!(payload.end, 3);
    assert_eq!(payload.len(), 2);
}

#[test]
fn tag_block_smuggled_ascii_is_decoded() {
    let payloads = found(&tag_chain('X', "rm -rf /", false));
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, PayloadKind::TagBlock);
    assert_eq!(payloads[0].as_text().as_deref(), Some("rm -rf /"));
}

#[test]
fn the_three_subdivision_flags_are_preserved() {
    for code in RGI_SUBDIVISION_TAGS {
        let flag = tag_chain('\u{1F3F4}', code, true);
        assert!(found(&flag).is_empty(), "{code} flag must not be reported");
    }
}

#[test]
fn a_flag_base_carrying_anything_else_is_still_smuggling() {
    // Right shape, wrong payload: not an RGI subdivision code.
    assert_eq!(found(&tag_chain('\u{1F3F4}', "ussta", true)).len(), 1);
    // Right code, no CANCEL TAG terminator: not a well-formed flag.
    assert_eq!(found(&tag_chain('\u{1F3F4}', "gbeng", false)).len(), 1);
    // Right code, wrong base.
    assert_eq!(found(&tag_chain('A', "gbeng", true)).len(), 1);
}

#[test]
fn the_deprecated_language_tag_is_always_reported() {
    let payloads = found("a\u{E0001}b");
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, PayloadKind::TagBlock);
    assert_eq!(payloads[0].note, NOTE_LANGUAGE);
}

#[test]
fn a_long_zero_width_run_decodes_as_binary() {
    // 'A' is 0100_0001; ZWSP reads 0 and ZWNJ reads 1.
    let run: String = "01000001"
        .chars()
        .map(|bit| if bit == '0' { '\u{200B}' } else { '\u{200C}' })
        .collect();
    let payloads = found(&format!("x{run}y"));
    assert_eq!(payloads.len(), 1);
    assert_eq!(payloads[0].kind, PayloadKind::ZeroWidthBinary);
    assert_eq!(payloads[0].bytes, b"A");
}

#[test]
fn short_zero_width_runs_are_left_to_the_orthography_rules() {
    // A joiner or two is shaping, not a carrier, however odd it looks.
    assert!(found("a\u{200D}b").is_empty());
    assert!(found(&"\u{200B}".repeat(ZERO_WIDTH_RUN_THRESHOLD - 1)).is_empty());
}

#[test]
fn several_payloads_in_one_document_are_reported_separately() {
    let text = format!(
        "{} and {}",
        vs_chain("\u{1F600}", b"one"),
        tag_chain('Z', "two", false)
    );
    let payloads = found(&text);
    assert_eq!(payloads.len(), 2);
    assert_eq!(payloads[0].bytes, b"one");
    assert_eq!(payloads[1].bytes, b"two");
}

#[test]
fn undecodable_bytes_break_a_chain_without_panicking() {
    let mut raw = vec![b'x'];
    raw.extend("\u{FE00}".as_bytes());
    raw.push(0xFF);
    raw.extend("\u{FE01}".as_bytes());
    // Two lone selectors separated by an invalid byte: neither is a chain.
    assert!(scan(&surrogate::decode(&raw)).is_empty());
}

#[test]
fn clean_prose_yields_nothing() {
    assert!(found("Ordinary prose, with punctuation \u{2014} and an emoji \u{1F600}.").is_empty());
}
