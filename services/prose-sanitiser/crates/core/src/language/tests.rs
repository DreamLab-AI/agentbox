use super::*;

const ENGLISH: &str = "The report delves into the rich tapestry of considerations that underpin \
the decision, and it underscores the need for a comprehensive review of every downstream effect.";

const GERMAN: &str = "Der Bericht befasst sich eingehend mit den zahlreichen Erwägungen, die der \
Entscheidung zugrunde liegen, und betont die Notwendigkeit einer umfassenden Überprüfung.";

const FRENCH: &str = "Le rapport examine en détail les nombreuses considérations qui sous-tendent \
la décision et souligne la nécessité d'un examen complet de chaque effet en aval.";

#[test]
fn english_prose_is_scanned() {
    assert!(LanguageFilter::new().is_english(ENGLISH));
}

#[test]
fn other_languages_are_skipped() {
    let filter = LanguageFilter::new();
    assert!(!filter.is_english(GERMAN));
    assert!(!filter.is_english(FRENCH));
}

#[test]
fn short_spans_are_scanned_rather_than_guessed() {
    let filter = LanguageFilter::new();
    assert!(filter.is_english("Guten Tag"));
    assert!(filter.is_english(""));
    assert!(filter.is_english("Bonjour"));
}

#[test]
fn a_span_of_code_and_numbers_is_scanned() {
    let filter = LanguageFilter::new();
    let code = "0123456789 ".repeat(40);
    assert!(filter.is_english(&code));
}

#[test]
fn a_disabled_filter_passes_everything() {
    let filter = LanguageFilter::disabled();
    assert!(!filter.is_enabled());
    assert!(filter.is_english(GERMAN));
    assert_eq!(filter.english_spans(GERMAN).len(), 1);
}

#[test]
fn paragraphs_split_on_blank_lines() {
    let document = "one\nstill one\n\ntwo\n\n\nthree\n";
    let spans = paragraphs(document);
    assert_eq!(spans.len(), 3);
    assert_eq!(spans[0].slice(document).unwrap(), "one\nstill one\n");
    assert_eq!(spans[1].slice(document).unwrap(), "two\n");
    assert_eq!(spans[2].slice(document).unwrap(), "three\n");
}

#[test]
fn a_document_with_no_trailing_newline_keeps_its_last_paragraph() {
    let spans = paragraphs("only");
    assert_eq!(spans.len(), 1);
    assert_eq!(spans[0], Span::new(0, 4));
}

#[test]
fn an_empty_document_has_no_paragraphs() {
    assert!(paragraphs("").is_empty());
    assert!(paragraphs("\n\n  \n").is_empty());
}

#[test]
fn a_mixed_document_keeps_only_the_english_paragraphs() {
    let document = format!("{ENGLISH}\n\n{GERMAN}\n\n{ENGLISH}\n");
    let filter = LanguageFilter::new();
    let spans = filter.english_spans(&document);
    assert_eq!(spans.len(), 2);
    for span in &spans {
        assert!(span.slice(&document).unwrap().contains("delves"));
    }

    let german_offset = document.find("Bericht").unwrap();
    assert!(!filter.offset_is_english(&spans, german_offset));
    assert!(filter.offset_is_english(&spans, 0));
}

#[test]
fn a_disabled_filter_reports_every_offset_as_english() {
    let filter = LanguageFilter::disabled();
    assert!(filter.offset_is_english(&[], 12_345));
}
