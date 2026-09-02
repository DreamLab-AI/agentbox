//! Direct BM25 port of `core.py`'s `BM25` class. `k1 = 1.5`, `b = 0.75` exactly.
//!
//! No search-engine crate is used — this is a from-scratch reimplementation chosen to
//! match the Python algorithm term-for-term (including its exact tie-break and
//! truncate-then-filter ordering), which a general-purpose BM25 crate would not
//! guarantee.

use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Lazily-compiled `[^\w\s]` matcher. `regex` crate's `\w` is Unicode-aware by
/// default (letters, digits, underscore across Unicode categories), matching
/// Python's `re.sub(r'[^\w\s]', ' ', text)` under the (default, Python 3) `re.UNICODE`
/// flag — not just ASCII.
fn punctuation_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^\w\s]").expect("static regex is valid"))
}

/// Tokenize like `BM25.tokenize`: lowercase, replace non-word/non-space chars with a
/// space, split on whitespace, keep tokens with more than 2 **characters** (Python's
/// `len(w)` counts Unicode code points, so we count `chars()`, not bytes).
pub fn tokenize(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let cleaned = punctuation_re().replace_all(&lowered, " ");
    cleaned
        .split_whitespace()
        .filter(|w| w.chars().count() > 2)
        .map(|w| w.to_string())
        .collect()
}

/// BM25 ranking engine over a fitted corpus of documents.
pub struct Bm25 {
    k1: f64,
    b: f64,
    corpus: Vec<Vec<String>>,
    doc_lengths: Vec<usize>,
    avgdl: f64,
    idf: HashMap<String, f64>,
    n: usize,
}

impl Default for Bm25 {
    fn default() -> Self {
        Self::new(1.5, 0.75)
    }
}

impl Bm25 {
    pub fn new(k1: f64, b: f64) -> Self {
        Self {
            k1,
            b,
            corpus: Vec::new(),
            doc_lengths: Vec::new(),
            avgdl: 0.0,
            idf: HashMap::new(),
            n: 0,
        }
    }

    /// Build the BM25 index from a corpus of raw documents, mirroring `BM25.fit`.
    pub fn fit<S: AsRef<str>>(&mut self, documents: &[S]) {
        self.corpus = documents.iter().map(|d| tokenize(d.as_ref())).collect();
        self.n = self.corpus.len();
        if self.n == 0 {
            return;
        }
        self.doc_lengths = self.corpus.iter().map(|d| d.len()).collect();
        let total: usize = self.doc_lengths.iter().sum();
        self.avgdl = total as f64 / self.n as f64;

        let mut doc_freqs: HashMap<String, usize> = HashMap::new();
        for doc in &self.corpus {
            let mut seen = std::collections::HashSet::new();
            for word in doc {
                if seen.insert(word.clone()) {
                    *doc_freqs.entry(word.clone()).or_insert(0) += 1;
                }
            }
        }

        for (word, freq) in doc_freqs {
            let idf = ((self.n as f64 - freq as f64 + 0.5) / (freq as f64 + 0.5) + 1.0).ln();
            self.idf.insert(word, idf);
        }
    }

    /// Score all documents against `query`, returning `(doc_index, score)` pairs
    /// sorted by score descending. Ties preserve original document order — a **stable**
    /// sort is required to replicate Python's `sorted(..., reverse=True)`, which is
    /// documented to be stable (it sorts ascending on the negated-comparison key
    /// internally but the observable behaviour is: equal-score elements keep their
    /// original relative order). `Vec::sort_by` in Rust is stable, so we sort ascending
    /// by score and reverse only the *comparison*, never the vector itself, to avoid
    /// disturbing tie order.
    pub fn score(&self, query: &str) -> Vec<(usize, f64)> {
        let query_tokens = tokenize(query);
        let mut scores: Vec<(usize, f64)> = Vec::with_capacity(self.corpus.len());

        for (idx, doc) in self.corpus.iter().enumerate() {
            let mut score = 0.0f64;
            let doc_len = self.doc_lengths[idx] as f64;

            let mut term_freqs: HashMap<&str, usize> = HashMap::new();
            for word in doc {
                *term_freqs.entry(word.as_str()).or_insert(0) += 1;
            }

            for token in &query_tokens {
                if let Some(&idf) = self.idf.get(token.as_str()) {
                    let tf = *term_freqs.get(token.as_str()).unwrap_or(&0) as f64;
                    let numerator = tf * (self.k1 + 1.0);
                    let denominator = tf + self.k1 * (1.0 - self.b + self.b * doc_len / self.avgdl);
                    score += idf * numerator / denominator;
                }
            }

            scores.push((idx, score));
        }

        // Stable descending sort: compare b vs a (reversed), which keeps equal
        // elements in their original relative order — identical observable behaviour
        // to Python's `sorted(scores, key=lambda x: x[1], reverse=True)`.
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).expect("scores are never NaN"));
        scores
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "expected {b}, got {a}");
    }

    #[test]
    fn tokenize_lowercases_and_strips_punctuation() {
        assert_eq!(
            tokenize("Hello, World! This is a TEST-123 ok."),
            vec!["hello", "world", "this", "test", "123"]
        );
    }

    #[test]
    fn tokenize_filters_short_tokens() {
        // "a" (1) and "bb" (2) are dropped; "ccc" (3) and "dddd" (4) survive.
        assert_eq!(tokenize("a bb ccc dddd"), vec!["ccc", "dddd"]);
    }

    #[test]
    fn tokenize_empty_string_is_empty() {
        assert!(tokenize("").is_empty());
    }

    #[test]
    fn tokenize_keeps_unicode_word_chars_together() {
        // Cross-checked against Python's core.py BM25.tokenize on the same input:
        // ['hello', 'world', 'this', 'test', '123', 'café', 'façade日本語']
        let toks = tokenize("Hello, World! This is a TEST-123 café façade日本語 ok.");
        assert_eq!(
            toks,
            vec![
                "hello",
                "world",
                "this",
                "test",
                "123",
                "café",
                "façade日本語"
            ]
        );
    }

    /// Fixed 5-document corpus, cross-checked against the real Python `core.py`
    /// (`python3 -c` run against the actual `BM25` class) so the numbers below are
    /// not hand-derived guesses:
    ///
    /// ```text
    /// docs = [
    ///   "Glassmorphism style with blur effects and translucent panels",
    ///   "Minimalism clean flat design with lots of white space",
    ///   "Neumorphism soft shadows and extruded surfaces",
    ///   "Brutalism bold raw typography with high contrast",
    ///   "Glassmorphism dark mode translucent blur panels for dashboards",
    /// ]
    /// bm25.score("glassmorphism blur")
    ///   -> [(0, 1.6893008230557651), (4, 1.6893008230557651), (1, 0.0), (2, 0.0), (3, 0.0)]
    /// bm25.score("minimalism white space")
    ///   -> [(1, 4.012481723189253), (0, 0.0), (2, 0.0), (3, 0.0), (4, 0.0)]
    /// bm25.score("nonexistent xyz query")
    ///   -> [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
    /// avgdl = 7.4, doc_lengths = [8, 8, 6, 7, 8]
    /// ```
    fn fixture_docs() -> Vec<&'static str> {
        vec![
            "Glassmorphism style with blur effects and translucent panels",
            "Minimalism clean flat design with lots of white space",
            "Neumorphism soft shadows and extruded surfaces",
            "Brutalism bold raw typography with high contrast",
            "Glassmorphism dark mode translucent blur panels for dashboards",
        ]
    }

    #[test]
    fn fit_computes_avgdl_and_doc_lengths_matching_python() {
        let mut bm25 = Bm25::default();
        bm25.fit(&fixture_docs());
        approx(bm25.avgdl, 7.4);
        assert_eq!(bm25.doc_lengths, vec![8, 8, 6, 7, 8]);
    }

    #[test]
    fn score_matches_python_exactly_including_tie_order() {
        let mut bm25 = Bm25::default();
        bm25.fit(&fixture_docs());

        let ranked = bm25.score("glassmorphism blur");
        // Docs 0 and 4 tie at the same score; stable sort must keep doc 0 before
        // doc 4 (their original corpus order), exactly as Python's stable sort does.
        assert_eq!(ranked[0].0, 0);
        assert_eq!(ranked[1].0, 4);
        approx(ranked[0].1, 1.6893008230557651);
        approx(ranked[1].1, 1.6893008230557651);
        // Remaining zero-score docs keep their original relative order too.
        assert_eq!(ranked[2].0, 1);
        assert_eq!(ranked[3].0, 2);
        assert_eq!(ranked[4].0, 3);
        for r in &ranked[2..5] {
            approx(r.1, 0.0);
        }
    }

    #[test]
    fn score_single_best_match_matches_python() {
        let mut bm25 = Bm25::default();
        bm25.fit(&fixture_docs());

        let ranked = bm25.score("minimalism white space");
        assert_eq!(ranked[0].0, 1);
        approx(ranked[0].1, 4.012481723189253);
        for &(idx, score) in &ranked[1..] {
            assert!(idx != 1);
            approx(score, 0.0);
        }
    }

    #[test]
    fn score_no_match_is_all_zero_and_preserves_order() {
        let mut bm25 = Bm25::default();
        bm25.fit(&fixture_docs());

        let ranked = bm25.score("nonexistent xyz query");
        let order: Vec<usize> = ranked.iter().map(|(idx, _)| *idx).collect();
        assert_eq!(order, vec![0, 1, 2, 3, 4]);
        for (_, score) in ranked {
            approx(score, 0.0);
        }
    }

    #[test]
    fn empty_corpus_scores_nothing() {
        let mut bm25 = Bm25::default();
        let empty: Vec<&str> = vec![];
        bm25.fit(&empty);
        assert!(bm25.score("anything").is_empty());
    }
}
