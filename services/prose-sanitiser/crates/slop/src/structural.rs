//! Whole-document structural measures, reported as rates per 10,000 words.
//!
//! Lexical markers say *which words*; structural measures say *how the prose is
//! shaped*, and the shape is harder for a writer to change deliberately. The
//! Pew Research Center Data Labs tracking of roughly 490,000 Common Crawl pages
//! gives three of these a published rate, measured January 2023 against January
//! 2026 and expressed per 10,000 words:
//!
//! | Measure | Jan 2023 | Jan 2026 |
//! |---|---|---|
//! | Em-dashes | 5.79 | 11.19 |
//! | Oxford commas | 34.04 | 55.51 |
//! | Negative parallelism | 0.87 | 2.36 |
//!
//! Those three are [`ConfidenceTier::HighConfidenceStylistic`]: the pattern is
//! measured, so the tool can be confident it is looking at the right thing.
//!
//! Tricolon, sentence-length variance and uniform paragraph length are
//! [`ConfidenceTier::LowConfidenceJudgement`] instead. They are widely observed
//! practitioner heuristics with no measurement study behind them, and the
//! research brief is explicit that they should be marked low-confidence. The
//! tool reports them; it does not pretend they are measured.
//!
//! # What a rate is not
//!
//! A rate above the January 2026 figure is a **population-level** signal. It
//! does not identify a document, and a document below every threshold is not
//! evidence of human authorship. An em-dash budget is a house-style ceiling on
//! a tic; the measured rate sits beside it so a reader can see where the text
//! falls against a published distribution rather than against a preference.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_slop::structural::StructuralMetrics;
//!
//! let metrics = StructuralMetrics::measure("One clause — then another — and a third — again.");
//! assert_eq!(metrics.em_dashes, 3);
//! assert!(metrics.rate(metrics.em_dashes) > 0.0);
//! ```

use std::sync::OnceLock;

use prose_sanitiser_core::{ConfidenceTier, Finding, RuleMeta, Severity, Span};
use regex::Regex;

use crate::rules::sources::{HOUSE_STYLE, PEW, WIKIPEDIA};

/// The window every structural rate is expressed over.
pub const RATE_WINDOW_WORDS: f64 = 10_000.0;

/// Em-dashes per 10,000 words in January 2023 Common Crawl text.
pub const EMDASH_RATE_2023: f64 = 5.79;
/// Em-dashes per 10,000 words in January 2026 Common Crawl text.
pub const EMDASH_RATE_2026: f64 = 11.19;
/// Oxford commas per 10,000 words in January 2023 Common Crawl text.
pub const OXFORD_RATE_2023: f64 = 34.04;
/// Oxford commas per 10,000 words in January 2026 Common Crawl text.
pub const OXFORD_RATE_2026: f64 = 55.51;
/// Negative parallelism per 10,000 words in January 2023 Common Crawl text.
pub const NEGATIVE_PARALLELISM_RATE_2023: f64 = 0.87;
/// Negative parallelism per 10,000 words in January 2026 Common Crawl text.
pub const NEGATIVE_PARALLELISM_RATE_2026: f64 = 2.36;

/// House budget for tricolons per 10,000 words. No published rate exists.
///
/// Measured 2026-09-03 over 1,252 human and 1,207 machine documents from RAID
/// and MAGE: at every threshold tried, the tricolon rate flagged *more* human
/// documents than machine ones (39.2 per cent against 30.2 per cent at a budget
/// of 6, 10.2 against 10.6 at 40). **It does not discriminate.** It is kept as a
/// house-style budget, set where its false-positive cost is tolerable, and it
/// must not be read as an authorship signal.
pub const TRICOLON_BUDGET: f64 = 40.0;
/// Below this coefficient of variation, sentence lengths read as uniform.
///
/// Measured 2026-09-03 over 1,252 human and 1,207 machine documents from RAID
/// and MAGE. The floor was 0.35 when first written, which flagged 36.7 per cent
/// of human documents for 48.1 per cent of machine ones: far too loose to put
/// in front of a writer. At 0.20 it flags 6.9 per cent of human documents and
/// 14.8 per cent of machine ones, which is a real if modest separation at a
/// tolerable cost. Human median CV is 0.39, machine 0.35.
pub const SENTENCE_CV_FLOOR: f64 = 0.20;
/// Below this coefficient of variation, paragraph lengths read as uniform.
pub const PARAGRAPH_CV_FLOOR: f64 = 0.22;
/// Fewer sentences than this and the variance figures mean nothing.
pub const MIN_SENTENCES_FOR_VARIANCE: usize = 8;
/// Fewer paragraphs than this and the uniformity figure means nothing.
pub const MIN_PARAGRAPHS_FOR_UNIFORMITY: usize = 5;
/// Fewer words than this and no rate is stable enough to report.
pub const MIN_WORDS_FOR_RATES: usize = 250;

/// The structural rules, as SARIF rule metadata.
pub const STRUCTURAL_RULES: &[RuleMeta] = &[
    RuleMeta {
        id: "structural-emdash-density",
        name: "Em-dash density above the 2026 population rate",
        description: "Em-dashes per 10,000 words, against the Pew Common Crawl tracking: 5.79 in January 2023, 11.19 in January 2026. A population-level signal, not a verdict on one document.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::HighConfidenceStylistic,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[PEW],
    },
    RuleMeta {
        id: "structural-oxford-comma-density",
        name: "Oxford-comma density above the 2026 population rate",
        description: "Serial commas per 10,000 words, against the Pew Common Crawl tracking: 34.04 in January 2023, 55.51 in January 2026. The Oxford comma is correct English; only the rate carries signal.",
        severity: Severity::Low,
        confidence: ConfidenceTier::HighConfidenceStylistic,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[PEW],
    },
    RuleMeta {
        id: "structural-negative-parallelism-density",
        name: "Negative-parallelism density above the 2026 population rate",
        description: "'Not just X, but Y' constructions per 10,000 words, against the Pew Common Crawl tracking: 0.87 in January 2023, 2.36 in January 2026. Nearly tripled, but rare in absolute terms, so a short document cannot support the measure.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::HighConfidenceStylistic,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[PEW],
    },
    RuleMeta {
        id: "structural-tricolon-density",
        name: "Tricolon (list-of-three) density above the house budget",
        description: "Three-item parallel lists per 10,000 words. A widely observed practitioner heuristic with no measurement study behind it. Tested here against RAID and MAGE, it flagged more human documents than machine ones at every threshold, so it is a house-style budget and not an authorship signal.",
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
    RuleMeta {
        id: "structural-sentence-variance",
        name: "Uniform sentence length (low burstiness)",
        description: "Coefficient of variation of sentence length. Well grounded as a detector input, but with no isolated peer-reviewed effect size, so it is reported as a judgement call. Measured here at 6.9 per cent of human documents against 14.8 per cent of machine ones.",
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
    RuleMeta {
        id: "structural-paragraph-uniformity",
        name: "Uniform paragraph length",
        description: "Coefficient of variation of paragraph length. A practitioner heuristic with no measurement study behind it.",
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
];

/// The serial (Oxford) comma: the comma before the final conjunction of a list.
///
/// Two commas are required, not one. A single `, and` is usually a comma
/// splice or a compound sentence — "she left, and he stayed" — which is not a
/// serial comma at all, and counting it would inflate the rate on any prose
/// that uses commas normally. Requiring a preceding comma within the same
/// clause, with no sentence terminator between, is the shape of a real list.
fn oxford_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r",[^.!?\n,]{1,60},\s+(?:and|or)\s+\S").expect("static regex compiles")
    })
}

fn tricolon_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b[\w'-]+,\s+[\w'-]+,?\s+(?:and|or)\s+[\w'-]+\b")
            .expect("static regex compiles")
    })
}

fn negative_parallelism_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bnot\s+(?:just|only|merely|simply)\b[^.?!]{1,80}?(?:,?\s*but\b|\s+—)")
            .expect("static regex compiles")
    })
}

/// Remove fenced code blocks and inline code, so structure is measured on prose.
///
/// Replacing rather than deleting would shift every byte offset; the measures
/// here are whole-document counts with no spans to preserve, so a plain
/// filtered copy is correct and cheaper.
pub fn prose_only(document: &str) -> String {
    let mut out = String::with_capacity(document.len());
    let mut in_fence = false;
    for line in document.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || trimmed.starts_with('>') {
            continue;
        }
        // Strip inline code spans; a backtick run is never prose.
        let mut in_code = false;
        for character in line.chars() {
            if character == '`' {
                in_code = !in_code;
                continue;
            }
            if !in_code {
                out.push(character);
            }
        }
    }
    out
}

/// The structural shape of one document.
#[derive(Debug, Clone, PartialEq)]
pub struct StructuralMetrics {
    /// Words of prose, excluding code.
    pub words: usize,
    /// Em-dashes, counting the LaTeX `---` source form.
    pub em_dashes: usize,
    /// Serial commas.
    pub oxford_commas: usize,
    /// "Not just X, but Y" constructions.
    pub negative_parallelisms: usize,
    /// Three-item parallel lists.
    pub tricolons: usize,
    /// Sentences found.
    pub sentences: usize,
    /// Mean sentence length in words.
    pub sentence_mean: f64,
    /// Coefficient of variation of sentence length; the burstiness proxy.
    pub sentence_cv: f64,
    /// Paragraphs found.
    pub paragraphs: usize,
    /// Coefficient of variation of paragraph length in words.
    pub paragraph_cv: f64,
}

impl StructuralMetrics {
    /// Measure `document`, ignoring code fences, inline code and blockquotes.
    pub fn measure(document: &str) -> Self {
        let prose = prose_only(document);
        let words = prose.split_whitespace().count();

        let sentence_lengths = sentence_lengths(&prose);
        let (sentence_mean, sentence_cv) = mean_and_cv(&sentence_lengths);

        let paragraph_lengths: Vec<usize> = prose_sanitiser_core::paragraphs(&prose)
            .iter()
            .filter_map(|span| span.slice(&prose))
            .map(|text| text.split_whitespace().count())
            .filter(|count| *count > 0)
            .collect();
        let (_, paragraph_cv) = mean_and_cv(&paragraph_lengths);

        Self {
            words,
            em_dashes: prose.matches('—').count() + prose.matches("---").count(),
            oxford_commas: oxford_re().find_iter(&prose).count(),
            negative_parallelisms: negative_parallelism_re().find_iter(&prose).count(),
            tricolons: tricolon_re().find_iter(&prose).count(),
            sentences: sentence_lengths.len(),
            sentence_mean,
            sentence_cv,
            paragraphs: paragraph_lengths.len(),
            paragraph_cv,
        }
    }

    /// `count` expressed per 10,000 words. Zero when the document has no words.
    pub fn rate(&self, count: usize) -> f64 {
        if self.words == 0 {
            return 0.0;
        }
        count as f64 * RATE_WINDOW_WORDS / self.words as f64
    }

    /// Whether the document is long enough for a rate to mean anything.
    pub fn rates_are_meaningful(&self) -> bool {
        self.words >= MIN_WORDS_FOR_RATES
    }

    /// The structural findings, as whole-document aggregates.
    ///
    /// Every finding spans `0..0`: these are properties of the document, not of
    /// any one place in it, and pointing at an arbitrary line would invite a
    /// reader to "fix" that line and change nothing.
    pub fn findings(&self) -> Vec<Finding> {
        let mut findings = Vec::new();
        if !self.rates_are_meaningful() {
            return findings;
        }

        let mut push = |rule: &str, matched: String, advice: String| {
            let meta = STRUCTURAL_RULES
                .iter()
                .find(|entry| entry.id == rule)
                .expect("every emitted rule id is in STRUCTURAL_RULES");
            findings.push(Finding {
                rule_id: meta.id.to_string(),
                label: meta.name.to_string(),
                span: Span::new(0, 0),
                matched,
                severity: meta.severity,
                confidence: meta.confidence,
                advice,
                replacement: None,
            });
        };

        let em_rate = self.rate(self.em_dashes);
        if em_rate > EMDASH_RATE_2026 {
            push(
                "structural-emdash-density",
                format!("{em_rate:.2} em-dashes per 10,000 words"),
                format!(
                    "Above the January 2026 population rate of {EMDASH_RATE_2026:.2} and roughly {:.1}x the January 2023 rate of {EMDASH_RATE_2023:.2}. Replace some with a comma, full stop or colon.",
                    em_rate / EMDASH_RATE_2023
                ),
            );
        }

        let oxford_rate = self.rate(self.oxford_commas);
        if oxford_rate > OXFORD_RATE_2026 {
            push(
                "structural-oxford-comma-density",
                format!("{oxford_rate:.2} serial commas per 10,000 words"),
                format!(
                    "Above the January 2026 population rate of {OXFORD_RATE_2026:.2}. The Oxford comma is correct English; only the rate carries signal, so this is context for a human, not a defect to correct."
                ),
            );
        }

        let negative_rate = self.rate(self.negative_parallelisms);
        if negative_rate > NEGATIVE_PARALLELISM_RATE_2026 {
            push(
                "structural-negative-parallelism-density",
                format!("{negative_rate:.2} negative parallelisms per 10,000 words"),
                format!(
                    "Above the January 2026 population rate of {NEGATIVE_PARALLELISM_RATE_2026:.2}. Lead with the positive claim, or delete the negative half."
                ),
            );
        }

        let tricolon_rate = self.rate(self.tricolons);
        if tricolon_rate > TRICOLON_BUDGET {
            push(
                "structural-tricolon-density",
                format!("{tricolon_rate:.2} three-item lists per 10,000 words"),
                format!(
                    "Above the house budget of {TRICOLON_BUDGET:.1}. This measure was tested against human and machine corpora and did not separate them, so it is a style preference only. It is not evidence of authorship."
                ),
            );
        }

        if self.sentences >= MIN_SENTENCES_FOR_VARIANCE && self.sentence_cv < SENTENCE_CV_FLOOR {
            push(
                "structural-sentence-variance",
                format!(
                    "sentence-length CV {:.2} over {} sentences (mean {:.1} words)",
                    self.sentence_cv, self.sentences, self.sentence_mean
                ),
                format!(
                    "Below {SENTENCE_CV_FLOOR:.2}: the sentences are close to one length. Vary them. No isolated effect size is published for this measure, so it is a judgement call."
                ),
            );
        }

        if self.paragraphs >= MIN_PARAGRAPHS_FOR_UNIFORMITY
            && self.paragraph_cv < PARAGRAPH_CV_FLOOR
        {
            push(
                "structural-paragraph-uniformity",
                format!(
                    "paragraph-length CV {:.2} over {} paragraphs",
                    self.paragraph_cv, self.paragraphs
                ),
                format!(
                    "Below {PARAGRAPH_CV_FLOOR:.2}: every paragraph is about the same size. Let the content set the length. A practitioner heuristic, not a measured rate."
                ),
            );
        }

        findings
    }

    /// The measures as a JSON object, for the `--structural` report.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "words": self.words,
            "sentences": self.sentences,
            "paragraphs": self.paragraphs,
            "em_dashes": self.em_dashes,
            "em_dash_rate_per_10k": round2(self.rate(self.em_dashes)),
            "em_dash_rate_2023": EMDASH_RATE_2023,
            "em_dash_rate_2026": EMDASH_RATE_2026,
            "oxford_commas": self.oxford_commas,
            "oxford_comma_rate_per_10k": round2(self.rate(self.oxford_commas)),
            "oxford_comma_rate_2023": OXFORD_RATE_2023,
            "oxford_comma_rate_2026": OXFORD_RATE_2026,
            "negative_parallelisms": self.negative_parallelisms,
            "negative_parallelism_rate_per_10k": round2(self.rate(self.negative_parallelisms)),
            "negative_parallelism_rate_2023": NEGATIVE_PARALLELISM_RATE_2023,
            "negative_parallelism_rate_2026": NEGATIVE_PARALLELISM_RATE_2026,
            "tricolons": self.tricolons,
            "tricolon_rate_per_10k": round2(self.rate(self.tricolons)),
            "tricolon_budget": TRICOLON_BUDGET,
            "sentence_mean_words": round2(self.sentence_mean),
            "sentence_length_cv": round2(self.sentence_cv),
            "paragraph_length_cv": round2(self.paragraph_cv),
            "rates_are_meaningful": self.rates_are_meaningful(),
        })
    }
}

/// Two decimal places, so a JSON report does not carry sixteen digits of noise.
fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Word counts per sentence, splitting on terminal punctuation.
///
/// A deliberately simple splitter: abbreviations such as "e.g." over-split, but
/// they do so identically in human and machine prose, so the comparison the
/// measure supports survives it.
fn sentence_lengths(prose: &str) -> Vec<usize> {
    prose
        .split(['.', '!', '?', '\n'])
        .map(|sentence| sentence.split_whitespace().count())
        .filter(|count| *count >= 3)
        .collect()
}

/// Mean and coefficient of variation of `values`.
fn mean_and_cv(values: &[usize]) -> (f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    let count = values.len() as f64;
    let mean = values.iter().sum::<usize>() as f64 / count;
    if mean == 0.0 {
        return (0.0, 0.0);
    }
    let variance = values
        .iter()
        .map(|value| {
            let delta = *value as f64 - mean;
            delta * delta
        })
        .sum::<f64>()
        / count;
    (mean, variance.sqrt() / mean)
}

#[cfg(test)]
mod tests;
