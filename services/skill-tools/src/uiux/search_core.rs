//! Direct port of `core.py`'s `_load_csv`, `_search_csv`, `search`, `search_stack`.
//! `detect_domain` lives in [`super::domain_detect`]; the [`OrderedRow`]/
//! [`SearchOutcome`] result types live in [`super::outcome`].

use std::collections::HashMap;

use super::bm25::Bm25;
use super::config;
use super::data;
use super::domain_detect::detect_domain;
use super::outcome::{OrderedRow, SearchOutcome};

/// `_load_csv`: parse embedded CSV text into a list of header->value maps.
/// `pub(crate)` so `design_system.rs` can reuse it to load `ui-reasoning.csv`.
pub(crate) fn load_csv(csv_text: &str) -> Vec<HashMap<String, String>> {
    let mut reader = csv::ReaderBuilder::new().from_reader(csv_text.as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map(|h| h.iter().map(|s| s.to_string()).collect())
        .unwrap_or_default();

    let mut rows = Vec::new();
    for record in reader.records().flatten() {
        let mut row = HashMap::with_capacity(headers.len());
        for (col, val) in headers.iter().zip(record.iter()) {
            row.insert(col.clone(), val.to_string());
        }
        rows.push(row);
    }
    rows
}

/// `_search_csv`: BM25-rank CSV rows against `query`, keep the top `max_results` by
/// rank, then drop any with a score of exactly 0. Order matters: take-then-filter,
/// not filter-then-take, so a query that only weakly matches can return fewer than
/// `max_results` rows even when more than `max_results` rows exist with score > 0
/// beyond the initial cut — this replicates `ranked[:max_results]` before the
/// `if score > 0` check in `core.py._search_csv`, not the other way round.
pub fn search_csv(
    csv_text: &str,
    search_cols: &[&str],
    output_cols: &[&str],
    query: &str,
    max_results: usize,
) -> Vec<OrderedRow> {
    let data_rows = load_csv(csv_text);

    let documents: Vec<String> = data_rows
        .iter()
        .map(|row| {
            search_cols
                .iter()
                .map(|col| row.get(*col).map(|s| s.as_str()).unwrap_or(""))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();

    let mut bm25 = Bm25::default();
    bm25.fit(&documents);
    let ranked = bm25.score(query);

    let mut results = Vec::new();
    for (idx, score) in ranked.into_iter().take(max_results) {
        if score > 0.0 {
            let row = &data_rows[idx];
            let mut ordered = Vec::with_capacity(output_cols.len());
            for col in output_cols {
                if let Some(v) = row.get(*col) {
                    ordered.push(((*col).to_string(), v.clone()));
                }
            }
            results.push(OrderedRow(ordered));
        }
    }
    results
}

/// `search()`: main search entry point with optional auto-domain-detection.
pub fn search(query: &str, domain: Option<&str>, max_results: usize) -> SearchOutcome {
    let domain_name = domain
        .map(|d| d.to_string())
        .unwrap_or_else(|| detect_domain(query).to_string());

    // `CSV_CONFIG.get(domain, CSV_CONFIG["style"])` — falls back to the style config
    // for lookup purposes, but the *reported* domain stays whatever was requested.
    let config = config::domain_config(&domain_name)
        .or_else(|| config::domain_config("style"))
        .expect("the 'style' domain is always present in CSV_CONFIG");

    let csv_text = match data::csv_by_filename(config.file) {
        Some(t) => t,
        None => {
            return SearchOutcome::DomainError {
                error: format!("File not found: {}", config.file),
                domain: domain_name,
            }
        }
    };

    let results = search_csv(
        csv_text,
        config.search_cols,
        config.output_cols,
        query,
        max_results,
    );
    SearchOutcome::Domain {
        domain: domain_name,
        query: query.to_string(),
        file: config.file.to_string(),
        count: results.len(),
        results,
    }
}

/// `search_stack()`: search stack-specific implementation guidelines.
pub fn search_stack(query: &str, stack: &str, max_results: usize) -> SearchOutcome {
    let file = match config::stack_file(stack) {
        Some(f) => f,
        None => {
            return SearchOutcome::StackUnknownError {
                error: format!(
                    "Unknown stack: {}. Available: {}",
                    stack,
                    config::available_stacks().join(", ")
                ),
            }
        }
    };

    let csv_text = match data::csv_by_filename(file) {
        Some(t) => t,
        None => {
            return SearchOutcome::StackFileError {
                error: format!("Stack file not found: {}", file),
                stack: stack.to_string(),
            }
        }
    };

    let results = search_csv(
        csv_text,
        config::STACK_SEARCH_COLS,
        config::STACK_OUTPUT_COLS,
        query,
        max_results,
    );
    SearchOutcome::Stack {
        stack: stack.to_string(),
        query: query.to_string(),
        file: file.to_string(),
        count: results.len(),
        results,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_CSV: &str = "\
Style Category,Keywords,Best For,Type,AI Prompt Keywords,Effects & Animation,Primary Colors,Performance,Accessibility,Framework Compatibility,Complexity,CSS/Technical Keywords,Implementation Checklist,Design System Variables
Glassmorphism,blur translucent panels,dashboards,Visual,glass blur,backdrop-blur,#fff,Good,AA,React,Medium,backdrop-filter,checklist,vars
Minimalism,clean flat white space,landing pages,Visual,minimal clean,fade,#000,Excellent,AAA,Any,Low,flex,checklist,vars
Neumorphism,soft shadows extruded,cards,Visual,soft ui,shadow,#eee,Fair,AA,CSS,High,box-shadow,checklist,vars
";

    fn search_cols() -> &'static [&'static str] {
        &["Style Category", "Keywords", "Best For"]
    }

    fn output_cols() -> &'static [&'static str] {
        &[
            "Style Category",
            "Keywords",
            "Best For",
            "Effects & Animation",
        ]
    }

    #[test]
    fn search_csv_round_trips_fixture_headers() {
        let results = search_csv(
            FIXTURE_CSV,
            search_cols(),
            output_cols(),
            "glassmorphism blur",
            3,
        );
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].get("Style Category"), Some("Glassmorphism"));
        assert_eq!(results[0].get("Effects & Animation"), Some("backdrop-blur"));
        // Column order in each row must equal output_cols order.
        let keys: Vec<&str> = results[0].iter().map(|(k, _)| k).collect();
        assert_eq!(
            keys,
            vec![
                "Style Category",
                "Keywords",
                "Best For",
                "Effects & Animation"
            ]
        );
    }

    #[test]
    fn search_csv_returns_empty_when_no_positive_scores() {
        let results = search_csv(
            FIXTURE_CSV,
            search_cols(),
            output_cols(),
            "zzz_no_match_zzz",
            3,
        );
        assert!(results.is_empty());
    }

    #[test]
    fn search_csv_truncates_before_filtering_by_score() {
        // max_results=1 with a query matching two rows should return at most 1,
        // even though 2 rows would score > 0 — take-then-filter, not filter-then-take.
        let results = search_csv(
            FIXTURE_CSV,
            search_cols(),
            output_cols(),
            "clean shadows",
            1,
        );
        assert!(results.len() <= 1);
    }

    #[test]
    fn search_against_embedded_style_csv_finds_glassmorphism() {
        let outcome = search("glassmorphism", Some("style"), 3);
        match outcome {
            SearchOutcome::Domain { count, results, .. } => {
                assert_eq!(count, 1);
                assert_eq!(results[0].get("Style Category"), Some("Glassmorphism"));
            }
            other => panic!("expected Domain outcome, got {other:?}"),
        }
    }

    #[test]
    fn search_auto_detects_domain() {
        let outcome = search("glassmorphism", None, 3);
        match outcome {
            SearchOutcome::Domain { domain, .. } => assert_eq!(domain, "style"),
            other => panic!("expected Domain outcome, got {other:?}"),
        }
    }

    #[test]
    fn search_stack_against_embedded_react_csv() {
        let outcome = search_stack("form validation", "react", 3);
        match outcome {
            SearchOutcome::Stack { count, .. } => assert!(count > 0),
            other => panic!("expected Stack outcome, got {other:?}"),
        }
    }

    #[test]
    fn search_stack_unknown_stack_errors() {
        let outcome = search_stack("anything", "does-not-exist", 3);
        assert!(outcome.is_error());
        match outcome {
            SearchOutcome::StackUnknownError { error } => {
                assert!(error.starts_with("Unknown stack: does-not-exist"));
            }
            other => panic!("expected StackUnknownError, got {other:?}"),
        }
    }
}
