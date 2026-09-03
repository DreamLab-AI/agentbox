use super::*;
use prose_sanitiser_core::surrogate;

fn units(text: &str) -> Vec<Unit> {
    surrogate::decode(text.as_bytes())
}

fn prose(text: &str) -> BidiReport {
    analyse(&units(text), BidiContext::Prose)
}

fn code(text: &str) -> BidiReport {
    analyse(&units(text), BidiContext::Code)
}

/// Hebrew "shalom", so a sample genuinely contains RTL script.
const HEBREW: &str = "\u{05E9}\u{05DC}\u{05D5}\u{05DD}";

#[test]
fn every_bidi_control_is_classified() {
    for codepoint in [
        0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x200E, 0x200F,
        0x061C,
    ] {
        assert!(is_bidi_control(codepoint), "U+{codepoint:04X}");
    }
    assert!(!is_bidi_control(0x0041));
    assert!(!is_bidi_control(0x200B));
}

#[test]
fn balanced_isolates_in_rtl_prose_are_preserved() {
    let report = prose(&format!("\u{2067}{HEBREW}\u{2069}"));
    assert!(report.hits.is_empty());
    assert_eq!(report.preserved, vec![0, 5]);
}

#[test]
fn balanced_embeddings_in_rtl_prose_are_preserved() {
    let report = prose(&format!("\u{202B}{HEBREW}\u{202C}"));
    assert!(report.hits.is_empty());
    assert_eq!(report.preserved, vec![0, 5]);
}

#[test]
fn rtl_marks_are_load_bearing_and_never_reported() {
    let report = prose(&format!("{HEBREW}\u{200F} 12"));
    assert!(report.hits.is_empty());
    assert_eq!(report.preserved, vec![4]);
}

#[test]
fn the_same_bytes_in_code_are_all_rejected() {
    let report = code(&format!("\u{2067}{HEBREW}\u{2069}"));
    assert_eq!(report.hits.len(), 2);
    assert!(report.hits.iter().all(|hit| hit.fault == BidiFault::InCode));
    // Nothing is load-bearing in source code.
    assert!(report.preserved.is_empty());
}

#[test]
fn trojan_source_samples_are_rejected_in_every_language() {
    // The CVE-2021-42574 shape: an override inside a comment or string that
    // reorders the rendered line. One sample per language family.
    let samples = [
        // Rust
        "let is_admin = false; /* \u{202E} } \u{2066}if (is_admin)\u{2069} \u{2066} begin admin\u{2069} */",
        // Python
        "# \u{202E}'''  \u{2066}return True\u{2069}",
        // Markdown
        "Click [here](https://example.com/\u{202E}gnp.exe)",
    ];
    for sample in samples {
        let report = code(sample);
        assert!(
            !report.hits.is_empty(),
            "code context must reject: {sample:?}"
        );
        assert!(report.hits.iter().all(|hit| hit.fault == BidiFault::InCode));
        assert!(report.preserved.is_empty());
    }
}

#[test]
fn an_unmatched_pop_is_reported_even_in_rtl_prose() {
    let report = prose(&format!("{HEBREW}\u{2069}"));
    assert_eq!(report.hits.len(), 1);
    assert_eq!(report.hits[0].fault, BidiFault::UnmatchedPop);
}

#[test]
fn an_unclosed_open_is_reported_even_in_rtl_prose() {
    let report = prose(&format!("\u{2067}{HEBREW}"));
    assert_eq!(report.hits.len(), 1);
    assert_eq!(report.hits[0].fault, BidiFault::UnclosedOpen);
    assert_eq!(report.hits[0].offset, 0);
}

#[test]
fn a_nested_embedding_closed_by_an_outer_pdi_is_nested_unbalanced() {
    // RLI ... RLE ... PDI: the embedding never gets its own PDF.
    let report = prose(&format!("\u{2067}{HEBREW}\u{202B}{HEBREW}\u{2069}"));
    assert_eq!(report.hits.len(), 1);
    assert_eq!(report.hits[0].fault, BidiFault::NestedUnbalanced);
    assert_eq!(report.hits[0].control, '\u{202B}');
    // The isolate pair itself is well formed and survives.
    assert!(report.preserved.contains(&0));
}

#[test]
fn an_isolate_blocks_a_pdf_from_matching_across_it() {
    // RLE ... RLI ... PDF: the PDF cannot close the embedding through the
    // isolate, so it is an unmatched pop.
    let report = prose(&format!("\u{202B}{HEBREW}\u{2067}{HEBREW}\u{202C}"));
    assert!(report
        .hits
        .iter()
        .any(|hit| hit.fault == BidiFault::UnmatchedPop));
}

#[test]
fn balanced_controls_with_no_rtl_script_are_still_contraband() {
    // Nothing to reorder: the pair is decoration at best, an attack at worst.
    let report = prose("\u{2067}hello\u{2069}");
    assert_eq!(report.hits.len(), 2);
    assert!(report
        .hits
        .iter()
        .all(|hit| hit.fault == BidiFault::NoRtlContext));
    assert!(report.preserved.is_empty());
}

#[test]
fn ordinary_prose_reports_nothing_in_either_context() {
    for text in [
        "Ordinary prose.",
        HEBREW,
        "\u{0633}\u{0644}\u{0627}\u{0645}",
    ] {
        assert!(prose(text).hits.is_empty(), "prose: {text:?}");
        assert!(code(text).hits.is_empty(), "code: {text:?}");
    }
}

#[test]
fn rtl_detection_covers_hebrew_arabic_and_syriac() {
    assert!(is_rtl_char(0x05D0)); // Hebrew alef
    assert!(is_rtl_char(0x0627)); // Arabic alef
    assert!(is_rtl_char(0x0710)); // Syriac alaph
    assert!(!is_rtl_char('a' as u32));
    assert!(!is_rtl_char(0x4E00)); // CJK
}

#[test]
fn undecodable_bytes_are_skipped_without_panicking() {
    let mut raw = "\u{2067}".as_bytes().to_vec();
    raw.push(0xFF);
    raw.extend(HEBREW.as_bytes());
    raw.extend("\u{2069}".as_bytes());
    let report = analyse(&surrogate::decode(&raw), BidiContext::Prose);
    assert!(report.hits.is_empty());
}

#[test]
fn context_parses_and_renders_its_wire_form() {
    assert_eq!(BidiContext::parse("code"), Some(BidiContext::Code));
    assert_eq!(BidiContext::parse("prose"), Some(BidiContext::Prose));
    assert_eq!(BidiContext::parse("other"), None);
    assert_eq!(BidiContext::Code.as_str(), "code");
    assert_eq!(BidiContext::default(), BidiContext::Prose);
}
