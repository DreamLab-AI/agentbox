use super::*;
use crate::stego::byte_to_variation_selector;

fn check(source: &str) -> Vec<Finding> {
    check_text(source, &TextPolicy::default())
}

fn vs_chain(base: &str, payload: &[u8]) -> String {
    let mut text = String::from(base);
    for byte in payload {
        text.push(byte_to_variation_selector(*byte));
    }
    text
}

#[test]
fn a_soft_hyphen_is_reported_but_never_fixable() {
    use prose_sanitiser_core::Config;

    let findings = check("co\u{00AD}operate");
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].rule_id, RULE_SOFT_HYPHEN);
    assert_eq!(
        findings[0].confidence,
        ConfidenceTier::LowConfidenceJudgement
    );
    // No replacement, so it can never be turned into an edit — not even with
    // --write, because a judgement call is never auto-applied.
    assert_eq!(findings[0].replacement, None);
    let write = Config {
        write: true,
        ..Config::default()
    };
    assert!(!findings[0].is_fixable(&write));
    assert_eq!(findings[0].to_edit(&write), None);
}

#[test]
fn every_finding_is_certain_mechanical() {
    // The tier is the auto-fix gate, and Layer A is the only layer that earns
    // it. A rule that drifts out of this set must do so deliberately.
    let source = format!(
        "in\u{200B}visible {} p\u{0430}ypal",
        vs_chain("\u{1F600}", b"hi")
    );
    let findings = check_text(
        &source,
        &TextPolicy {
            context: BidiContext::Code,
            report_spaces: true,
            context_free_homoglyphs: true,
            strip_emoji_glue: false,
        },
    );
    assert!(!findings.is_empty());
    // Every rule but the soft hyphen, which is a judgement about the author's
    // intent rather than a fact about the codepoint.
    assert!(findings
        .iter()
        .filter(|finding| finding.rule_id != RULE_SOFT_HYPHEN)
        .all(|finding| finding.confidence == ConfidenceTier::CertainMechanical));
}

#[test]
fn findings_are_sorted_by_position() {
    let findings = check("a\u{200B}b\u{200B}c\u{200B}");
    let starts: Vec<usize> = findings.iter().map(|f| f.span.start).collect();
    let mut sorted = starts.clone();
    sorted.sort_unstable();
    assert_eq!(starts, sorted);
}

#[test]
fn spans_are_byte_offsets_that_slice_the_source() {
    // Non-ASCII before the carrier, so a character index would be wrong here.
    let source = "héllo\u{200B}world";
    let findings = check(source);
    assert_eq!(findings.len(), 1);
    let span = findings[0].span;
    assert_eq!(span.slice(source), Some("\u{200B}"));
}

#[test]
fn a_payload_reports_its_decoded_bytes_in_the_advice() {
    let findings = check(&vs_chain("\u{1F600}", b"hi"));
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].rule_id, RULE_VS_PAYLOAD);
    assert!(findings[0].advice.contains("\"hi\""));
    assert!(findings[0].advice.contains("6869"));
    assert_eq!(findings[0].replacement.as_deref(), Some(""));
}

#[test]
fn a_payload_finding_replaces_exactly_the_carrier() {
    let source = vs_chain("x", b"hi");
    let findings = check(&source);
    let span = findings[0].span;
    let mut cleaned = source.clone();
    cleaned.replace_range(span.start..span.end, "");
    assert_eq!(cleaned, "x");
}

#[test]
fn bidi_is_rejected_in_code_and_preserved_in_rtl_prose() {
    let source = "\u{2067}\u{05E9}\u{05DC}\u{05D5}\u{05DD}\u{2069}";

    let code = check_text(
        source,
        &TextPolicy {
            context: BidiContext::Code,
            ..TextPolicy::default()
        },
    );
    let bidi_hits: Vec<&Finding> = code.iter().filter(|f| f.rule_id == RULE_BIDI).collect();
    assert_eq!(bidi_hits.len(), 2);
    // In code the remedy is mechanical: delete it.
    assert!(bidi_hits
        .iter()
        .all(|f| f.replacement.as_deref() == Some("")));

    let prose = check_text(source, &TextPolicy::default());
    assert!(prose.iter().all(|f| f.rule_id != RULE_BIDI));
}

#[test]
fn an_unbalanced_control_in_prose_is_reported_but_never_auto_fixed() {
    // The right repair may be to add the missing pop, so the fix is the
    // author's call and the finding carries no replacement.
    let findings = check("\u{05E9}\u{05DC}\u{2069}");
    let bidi: Vec<&Finding> = findings.iter().filter(|f| f.rule_id == RULE_BIDI).collect();
    assert_eq!(bidi.len(), 1);
    assert_eq!(bidi[0].replacement, None);
}

#[test]
fn homoglyphs_report_the_ascii_they_fold_to() {
    let findings = check("p\u{0430}ypal");
    let homoglyphs: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.rule_id == RULE_HOMOGLYPH)
        .collect();
    assert_eq!(homoglyphs.len(), 1);
    assert_eq!(homoglyphs[0].replacement.as_deref(), Some("a"));
}

#[test]
fn space_homoglyphs_are_reported_only_when_asked() {
    let source = "a\u{00A0}b";
    assert!(check(source).is_empty());
    let findings = check_text(
        source,
        &TextPolicy {
            report_spaces: true,
            ..TextPolicy::default()
        },
    );
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].replacement.as_deref(), Some(" "));
}

#[test]
fn legitimate_content_produces_no_findings() {
    // The section D3 controls, through the Finding surface this time.
    for sample in [
        "\u{2764}\u{FE0F}\u{200D}\u{1F525}",
        "देवनागरी हिन्दी",
        "سلام فارسی",
        "שלום world",
        "Москва привет",
        "café naïve",
        "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
    ] {
        assert!(
            check(sample).is_empty(),
            "{sample:?} must produce no findings"
        );
    }
}

#[test]
fn a_bom_at_offset_zero_survives_but_a_stray_one_does_not() {
    assert!(check("\u{FEFF}hello").is_empty());
    assert_eq!(check("hello\u{FEFF}").len(), 1);
}

#[test]
fn the_default_policy_is_the_safe_one() {
    // `sanitise` and friends call this with no configuration, so the default
    // must be prose context, no space reporting and nothing paranoid.
    let policy = TextPolicy::default();
    assert_eq!(policy.context, BidiContext::Prose);
    assert!(!policy.report_spaces);
    assert!(!policy.context_free_homoglyphs);
    assert!(!policy.strip_emoji_glue);
}

#[test]
fn paranoid_mode_reports_load_bearing_glue_that_the_default_keeps() {
    // Heart-on-fire: every invisible in it is load-bearing.
    let emoji = "\u{2764}\u{FE0F}\u{200D}\u{1F525}";
    assert!(check(emoji).is_empty());
    let paranoid = check_text(
        emoji,
        &TextPolicy {
            strip_emoji_glue: true,
            ..TextPolicy::default()
        },
    );
    assert!(!paranoid.is_empty());
}

#[test]
fn every_rule_id_appears_in_the_published_rules_table() {
    // The SARIF driver table must describe every rule the checker can emit.
    let ids: Vec<&str> = crate::RULES.iter().map(|rule| rule.id).collect();
    for rule_id in [
        RULE_INVISIBLE,
        RULE_HOMOGLYPH,
        RULE_VS_PAYLOAD,
        RULE_TAG_PAYLOAD,
        RULE_ZW_PAYLOAD,
        RULE_BIDI,
    ] {
        assert!(ids.contains(&rule_id), "{rule_id} missing from RULES");
    }
}
