//! Reference verification: title similarity and the strict date cutoff.
//!
//! Merges `levenshtein_match.py` and `check_cutoff.py`. The caller obtains the
//! `found_*` fields from a citation-verification tool (this module does no
//! network access) and passes them in as a JSON array of [`Candidate`].
//!
//! Similarity reproduces `Levenshtein.ratio` from `python-Levenshtein`, which
//! is the normalised *indel* similarity `2 * LCS / (len(a) + len(b))` (a
//! substitution costs 2), not the unit-cost normalised Levenshtein of crates
//! such as `strsim`. The two formulas disagree on near-misses, and the pass
//! mark of 70 was calibrated against the former.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// One reference to verify.
#[derive(Debug, Clone, Deserialize)]
pub struct Candidate {
    /// Bibliography key.
    pub key: String,
    /// The title the paper claims.
    pub claimed_title: String,
    /// The title the verification tool found.
    pub found_title: String,
    /// Publication date found: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`.
    #[serde(default)]
    pub found_date: Option<String>,
}

/// Outcome of the cutoff test for one row.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CutoffVerdict {
    /// The date used, after the worst-case completion rules.
    pub paper_date: Option<String>,
    /// The cutoff.
    pub cutoff: String,
    /// `PASS`, `FAIL`, or `UNKNOWN` when no usable date was supplied.
    pub verdict: String,
}

/// Verification result for one row.
#[derive(Debug, Clone, Serialize)]
pub struct RowResult {
    /// Bibliography key.
    pub key: String,
    /// Similarity 0–100.
    pub similarity: u32,
    /// `PASS` when similarity is strictly greater than the threshold.
    pub title_verdict: String,
    /// Cutoff result, present when a cutoff was requested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cutoff: Option<CutoffVerdict>,
    /// True when every requested test passed.
    pub pass: bool,
}

/// Lower-cases, trims, replaces everything but `a-z0-9` and whitespace with a
/// space and collapses whitespace runs — exactly as `levenshtein_match.py` does
/// (including leaving any resulting edge space in place).
///
/// ```
/// use skill_tools::paper_orchestra::verify_refs::normalise;
/// assert_eq!(normalise("  Linformer: Self-Attention!  "), "linformer self attention ");
/// ```
#[must_use]
pub fn normalise(s: &str) -> String {
    let lowered = s.to_lowercase();
    let replaced: String = lowered
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    let mut out = String::with_capacity(replaced.len());
    let mut prev_space = false;
    for c in replaced.chars() {
        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out
}

fn lcs_len(a: &[char], b: &[char]) -> usize {
    let mut prev = vec![0usize; b.len() + 1];
    let mut cur = vec![0usize; b.len() + 1];
    for &x in a {
        for (j, &y) in b.iter().enumerate() {
            cur[j + 1] = if x == y {
                prev[j] + 1
            } else {
                prev[j + 1].max(cur[j])
            };
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// Indel similarity in `[0, 1]` of two strings (`1.0` when both are empty).
#[must_use]
pub fn indel_ratio(a: &str, b: &str) -> f64 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let total = a.len() + b.len();
    if total == 0 {
        return 1.0;
    }
    2.0 * lcs_len(&a, &b) as f64 / total as f64
}

/// Title similarity 0–100 with Python's half-to-even rounding.
///
/// With `substring_bypass`, a candidate of fewer than four words contained in
/// the found title scores at least 95 (the Linformer false-negative case).
///
/// ```
/// use skill_tools::paper_orchestra::verify_refs::similarity;
/// assert_eq!(similarity("Attention is all you need", "Attention Is All You Need", false), 100);
/// assert!(similarity("Linformer", "Linformer: Self-Attention with Linear Complexity", false) < 70);
/// assert_eq!(similarity("Linformer", "Linformer: Self-Attention with Linear Complexity", true), 95);
/// ```
#[must_use]
pub fn similarity(candidate: &str, found: &str, substring_bypass: bool) -> u32 {
    let (na, nb) = (normalise(candidate), normalise(found));
    let r = (indel_ratio(&na, &nb) * 100.0).round_ties_even() as u32;
    if substring_bypass && na.split_whitespace().count() < 4 && nb.contains(&na) {
        return r.max(95);
    }
    r
}

/// Parses a publication date with the worst-case completion rules: a bare year
/// is 31 December, a year and month is the first of that month.
#[must_use]
pub fn parse_paper_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    if let Some(prefix) = s.get(..10) {
        if let Ok(d) = NaiveDate::parse_from_str(prefix, "%Y-%m-%d") {
            return Some(d);
        }
    }
    let parts: Vec<&str> = s.split('-').collect();
    match parts.as_slice() {
        [y] if y.len() == 4 => NaiveDate::from_ymd_opt(y.parse().ok()?, 12, 31),
        [y, m] if y.len() == 4 => NaiveDate::from_ymd_opt(y.parse().ok()?, m.parse().ok()?, 1),
        _ => None,
    }
}

/// Applies the strict cutoff rule: the paper must predate the cutoff.
#[must_use]
pub fn cutoff_verdict(found_date: Option<&str>, cutoff: NaiveDate) -> CutoffVerdict {
    let date = found_date.and_then(parse_paper_date);
    CutoffVerdict {
        paper_date: date.map(|d| d.to_string()),
        cutoff: cutoff.to_string(),
        verdict: match date {
            Some(d) if d < cutoff => "PASS",
            Some(_) => "FAIL",
            None => "UNKNOWN",
        }
        .to_string(),
    }
}

/// Verifies every row. A row passes when its similarity is strictly greater
/// than `threshold` and, if a cutoff is given, its date strictly predates it.
/// A missing or unparseable date under a cutoff is `UNKNOWN` and fails the row:
/// the rule is that a paper passes only if its date is known to be earlier.
#[must_use]
pub fn verify(
    rows: &[Candidate],
    threshold: u32,
    cutoff: Option<NaiveDate>,
    substring_bypass: bool,
) -> Vec<RowResult> {
    rows.iter()
        .map(|r| {
            let sim = similarity(&r.claimed_title, &r.found_title, substring_bypass);
            let title_ok = sim > threshold;
            let c = cutoff.map(|c| cutoff_verdict(r.found_date.as_deref(), c));
            let cut_ok = c.as_ref().is_none_or(|c| c.verdict == "PASS");
            RowResult {
                key: r.key.clone(),
                similarity: sim,
                title_verdict: if title_ok { "PASS" } else { "FAIL" }.to_string(),
                cutoff: c,
                pass: title_ok && cut_ok,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_titles_score_100_and_unrelated_score_low() {
        assert_eq!(
            similarity("Deep Residual Learning", "deep   residual learning", false),
            100
        );
        // Upstream keeps the space a trailing "!" becomes, so punctuation costs two points here.
        assert_eq!(
            similarity("Deep Residual Learning", "deep residual learning!", false),
            98
        );
        assert!(
            similarity(
                "Deep Residual Learning",
                "A survey of graph databases",
                false
            ) < 50
        );
    }

    #[test]
    fn ratio_matches_indel_definition() {
        // LCS("abcd","abxd") = 3 -> 2*3/8 = 0.75 (unit-cost Levenshtein would give 0.75 too,
        // but "ab" vs "ba" separates them: indel 0.5, Levenshtein 0.0).
        assert!((indel_ratio("abcd", "abxd") - 0.75).abs() < 1e-12);
        assert!((indel_ratio("ab", "ba") - 0.5).abs() < 1e-12);
        assert_eq!(indel_ratio("", ""), 1.0);
    }

    #[test]
    fn rounding_is_half_to_even() {
        // 2*LCS/total = 0.125 exactly -> 12.5 -> rounds to 12 under half-to-even.
        // "a" vs "bbbbbbba": LCS 1, total 9 -> not exact; use 8 chars vs 8: "abcdefgh" vs "axxxxxxx"
        assert_eq!(
            ((indel_ratio("abcdefgh", "axxxxxxx") * 100.0).round_ties_even()) as u32,
            12
        );
    }

    #[test]
    fn substring_bypass_only_for_short_candidates() {
        let found = "Linformer: Self-Attention with Linear Complexity";
        assert_eq!(similarity("Linformer", found, true), 95);
        assert!(similarity("Self attention with linear complexity", found, true) >= 70);
        assert!(similarity("Linformer", found, false) < 70);
    }

    #[test]
    fn dates_complete_to_the_worst_case() {
        assert_eq!(
            parse_paper_date("2024"),
            NaiveDate::from_ymd_opt(2024, 12, 31)
        );
        assert_eq!(
            parse_paper_date("2024-09"),
            NaiveDate::from_ymd_opt(2024, 9, 1)
        );
        assert_eq!(
            parse_paper_date("2024-09-15T10:00:00Z"),
            NaiveDate::from_ymd_opt(2024, 9, 15)
        );
        assert_eq!(parse_paper_date("soon"), None);
    }

    #[test]
    fn cutoff_is_strict() {
        let c = NaiveDate::from_ymd_opt(2024, 10, 1).unwrap();
        assert_eq!(cutoff_verdict(Some("2024-09-15"), c).verdict, "PASS");
        assert_eq!(cutoff_verdict(Some("2024-10-01"), c).verdict, "FAIL");
        assert_eq!(cutoff_verdict(Some("2024"), c).verdict, "FAIL");
        assert_eq!(cutoff_verdict(None, c).verdict, "UNKNOWN");
    }

    #[test]
    fn row_passes_only_when_all_tests_pass() {
        let rows = vec![
            Candidate {
                key: "ok".into(),
                claimed_title: "Attention is all you need".into(),
                found_title: "Attention Is All You Need".into(),
                found_date: Some("2017-06-12".into()),
            },
            Candidate {
                key: "late".into(),
                claimed_title: "Attention is all you need".into(),
                found_title: "Attention Is All You Need".into(),
                found_date: Some("2030-01-01".into()),
            },
            Candidate {
                key: "wrong".into(),
                claimed_title: "Attention is all you need".into(),
                found_title: "Graph databases".into(),
                found_date: Some("2017-06-12".into()),
            },
            Candidate {
                key: "undated".into(),
                claimed_title: "Attention is all you need".into(),
                found_title: "Attention Is All You Need".into(),
                found_date: None,
            },
        ];
        let cutoff = NaiveDate::from_ymd_opt(2024, 10, 1);
        let out = verify(&rows, 70, cutoff, false);
        let pass: Vec<bool> = out.iter().map(|r| r.pass).collect();
        assert_eq!(pass, [true, false, false, false]);
        let no_cutoff = verify(&rows, 70, None, false);
        assert!(no_cutoff[1].pass && no_cutoff[3].pass && !no_cutoff[2].pass);
    }
}
