use super::*;

/// Several hundred words of unremarkable prose with no structural tells.
///
/// Paragraph and sentence lengths both vary, because a fixture of identical
/// paragraphs would trip the uniformity rules the fixture exists to prove are
/// quiet on ordinary writing.
fn plain_prose() -> String {
    let shapes = [
        "Sentence {i} is short. This one runs on for rather longer than the last, carrying \
         several clauses before it finally stops somewhere near the right margin of the page. \
         A third.",
        "Paragraph {i} says one thing and stops.",
        "Here the argument opens with a claim and develops it across a middle stretch that \
         has room for a qualification. The next sentence is brief. This one, by contrast, \
         takes its time getting to the point while pausing on the way to note that the \
         measurement is a population rate rather than a verdict on any one document.",
        "Two sentences only. The second runs a good deal longer than the first, which is the \
         whole point of the fixture.",
    ];
    let mut text = String::new();
    for index in 0..12 {
        text.push_str(&shapes[index % shapes.len()].replace("{i}", &index.to_string()));
        text.push_str("\n\n");
    }
    text
}

#[test]
fn em_dashes_count_both_source_forms() {
    let metrics = StructuralMetrics::measure("One — two --- three.");
    assert_eq!(metrics.em_dashes, 2);
}

#[test]
fn code_fences_inline_code_and_quotes_are_excluded() {
    let document =
        "Prose — here.\n\n```\ncode — with — dashes\n```\n\n`inline — code`\n\n> quoted — line\n";
    let metrics = StructuralMetrics::measure(document);
    assert_eq!(metrics.em_dashes, 1);
}

#[test]
fn oxford_commas_are_counted() {
    let metrics = StructuralMetrics::measure("Red, white, and blue. Salt, pepper, and oil.");
    assert_eq!(metrics.oxford_commas, 2);
}

#[test]
fn a_single_comma_before_and_is_not_a_serial_comma() {
    // A compound sentence, not a list. Counting it would inflate every rate.
    let metrics = StructuralMetrics::measure("She left, and he stayed behind in the rain.");
    assert_eq!(metrics.oxford_commas, 0);
}

#[test]
fn a_sentence_boundary_breaks_the_serial_pattern() {
    let metrics = StructuralMetrics::measure("She left, alone. He stayed, and waited.");
    assert_eq!(metrics.oxford_commas, 0);
}

#[test]
fn tricolons_are_counted_with_and_or_or() {
    let metrics = StructuralMetrics::measure("Fast, cheap, and good. Ready, willing or able.");
    assert_eq!(metrics.tricolons, 2);
}

#[test]
fn negative_parallelism_is_counted() {
    let metrics = StructuralMetrics::measure(
        "It is not just a tool, but a philosophy. It is not only fast but cheap.",
    );
    assert_eq!(metrics.negative_parallelisms, 2);
}

#[test]
fn a_rate_is_per_ten_thousand_words() {
    let metrics = StructuralMetrics::measure(&"word ".repeat(1000));
    assert_eq!(metrics.words, 1000);
    assert!((metrics.rate(1) - 10.0).abs() < 1e-9);
    assert_eq!(metrics.rate(0), 0.0);
}

#[test]
fn an_empty_document_has_a_zero_rate_and_no_findings() {
    let metrics = StructuralMetrics::measure("");
    assert_eq!(metrics.words, 0);
    assert_eq!(metrics.rate(5), 0.0);
    assert!(metrics.findings().is_empty());
}

#[test]
fn a_short_document_reports_nothing_however_dense() {
    let metrics = StructuralMetrics::measure("Not just a — b — c — d — tool, but a philosophy.");
    assert!(!metrics.rates_are_meaningful());
    assert!(metrics.findings().is_empty());
}

#[test]
fn ordinary_prose_trips_no_structural_rule() {
    let metrics = StructuralMetrics::measure(&plain_prose());
    assert!(metrics.rates_are_meaningful());
    let ids: Vec<String> = metrics
        .findings()
        .into_iter()
        .map(|finding| finding.rule_id)
        .collect();
    assert!(ids.is_empty(), "unexpected findings: {ids:?}");
}

#[test]
fn heavy_em_dash_use_trips_the_density_rule() {
    let document = format!("{}{}", plain_prose(), "A — B — C — D. ".repeat(40));
    let metrics = StructuralMetrics::measure(&document);
    let finding = metrics
        .findings()
        .into_iter()
        .find(|f| f.rule_id == "structural-emdash-density")
        .expect("em-dash density should fire");
    assert_eq!(finding.confidence, ConfidenceTier::HighConfidenceStylistic);
    assert!(finding.replacement.is_none());
    assert!(finding.matched.contains("per 10,000 words"));
    assert!(finding.advice.contains("11.19"));
}

#[test]
fn uniform_sentences_trip_the_variance_rule_at_the_judgement_tier() {
    // Every sentence identical, so the CV is exactly zero.
    let document = "One two three four five. ".repeat(60);
    let metrics = StructuralMetrics::measure(&document);
    let finding = metrics
        .findings()
        .into_iter()
        .find(|f| f.rule_id == "structural-sentence-variance")
        .expect("uniform sentences should fire");
    assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
    assert!(metrics.sentence_cv < SENTENCE_CV_FLOOR);
}

#[test]
fn no_structural_finding_is_ever_auto_fixable() {
    let document = format!("{}{}", plain_prose(), "A — B — C — D. ".repeat(40));
    for finding in StructuralMetrics::measure(&document).findings() {
        assert!(!finding.confidence.auto_fixable(), "{}", finding.rule_id);
        assert!(finding.replacement.is_none(), "{}", finding.rule_id);
        assert_eq!(finding.span, Span::new(0, 0));
    }
}

#[test]
fn every_emitted_rule_id_has_metadata() {
    let document = format!("{}{}", plain_prose(), "Not just A — B, but C. ".repeat(60));
    for finding in StructuralMetrics::measure(&document).findings() {
        assert!(
            STRUCTURAL_RULES
                .iter()
                .any(|meta| meta.id == finding.rule_id),
            "{} missing from STRUCTURAL_RULES",
            finding.rule_id
        );
    }
}

#[test]
fn structural_rule_metadata_is_dated_and_never_mechanical() {
    for meta in STRUCTURAL_RULES {
        assert!(meta.id.starts_with("structural-"), "{}", meta.id);
        assert_eq!(meta.since.len(), 10, "{}", meta.id);
        assert_eq!(meta.reviewed.len(), 10, "{}", meta.id);
        assert!(!meta.sources.is_empty(), "{}", meta.id);
        assert_ne!(
            meta.confidence,
            ConfidenceTier::CertainMechanical,
            "{} claims mechanical certainty",
            meta.id
        );
    }
}

#[test]
fn the_pew_rates_only_ever_move_upward() {
    // A const block, so a typo in a transcribed rate fails the build rather
    // than the test run.
    const _: () = assert!(EMDASH_RATE_2026 > EMDASH_RATE_2023);
    const _: () = assert!(OXFORD_RATE_2026 > OXFORD_RATE_2023);
    const _: () = assert!(NEGATIVE_PARALLELISM_RATE_2026 > NEGATIVE_PARALLELISM_RATE_2023);
    // And the transcription itself, against the published figures.
    assert_eq!((EMDASH_RATE_2023, EMDASH_RATE_2026), (5.79, 11.19));
    assert_eq!((OXFORD_RATE_2023, OXFORD_RATE_2026), (34.04, 55.51));
    assert_eq!(
        (
            NEGATIVE_PARALLELISM_RATE_2023,
            NEGATIVE_PARALLELISM_RATE_2026
        ),
        (0.87, 2.36)
    );
}

#[test]
fn the_json_report_carries_both_baselines() {
    let value = StructuralMetrics::measure(&plain_prose()).to_json();
    assert_eq!(value["em_dash_rate_2023"], EMDASH_RATE_2023);
    assert_eq!(value["em_dash_rate_2026"], EMDASH_RATE_2026);
    assert_eq!(value["rates_are_meaningful"], true);
    assert!(value["sentence_length_cv"].is_number());
}

#[test]
fn mean_and_cv_handle_the_degenerate_cases() {
    assert_eq!(mean_and_cv(&[]), (0.0, 0.0));
    assert_eq!(mean_and_cv(&[0, 0]), (0.0, 0.0));
    let (mean, cv) = mean_and_cv(&[4, 4, 4, 4]);
    assert_eq!(mean, 4.0);
    assert_eq!(cv, 0.0);
}
