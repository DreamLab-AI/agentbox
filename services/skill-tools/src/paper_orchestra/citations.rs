//! Citation gates: orphan cite keys and citation-pool coverage.
//!
//! Derived from `orphan_cite_gate.py` and `citation_coverage.py`. Both accept a
//! file or a directory for the paper (see [`super::tex::Paper`]), ignore
//! commented-out citations, and understand natbib and biblatex variants through
//! [`super::cite`].

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use serde::Deserialize;

use super::cite::{bib_keys, cited_keys};

/// Result of [`orphan_report`].
#[derive(Debug, PartialEq, Eq)]
pub struct OrphanReport {
    /// Distinct entries in the bibliography.
    pub bib_entries: usize,
    /// Distinct keys cited in the paper.
    pub cited: usize,
    /// Cited keys with no bibliography entry.
    pub orphans: Vec<String>,
    /// Bibliography entries never cited (informational).
    pub unused: Vec<String>,
}

/// Compares the keys cited in `tex` with the entries of `bib`.
///
/// ```
/// use skill_tools::paper_orchestra::citations::orphan_report;
/// let r = orphan_report(r"\citep{a,b} \textcite[p.~2]{c}", "@article{a,}\n@book{z,}");
/// assert_eq!(r.orphans, ["b", "c"]);
/// assert_eq!(r.unused, ["z"]);
/// ```
#[must_use]
pub fn orphan_report(tex: &str, bib: &str) -> OrphanReport {
    let bib = bib_keys(bib);
    let cited = cited_keys(tex);
    OrphanReport {
        bib_entries: bib.len(),
        cited: cited.len(),
        orphans: cited.difference(&bib).cloned().collect(),
        unused: bib.difference(&cited).cloned().collect(),
    }
}

/// One paper in a citation pool.
#[derive(Debug, Deserialize)]
struct PoolPaper {
    bibtex_key: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    discovered_for: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct Pool {
    #[serde(default)]
    papers: Vec<PoolPaper>,
}

/// Result of [`coverage_report`].
#[derive(Debug)]
pub struct CoverageReport {
    /// Printable report.
    pub text: String,
    /// 0 when coverage meets the threshold, 1 otherwise or when the pool has no keys.
    pub exit: i32,
}

/// Checks that at least `threshold` of the pool's keys are cited in `tex`.
///
/// # Errors
///
/// A message when `pool_json` is not a pool document.
pub fn coverage_report(
    tex: &str,
    pool_json: &str,
    threshold: f64,
) -> Result<CoverageReport, String> {
    let pool: Pool =
        serde_json::from_str(pool_json).map_err(|e| format!("invalid pool JSON: {e}"))?;
    let mut info: BTreeMap<String, (String, String)> = BTreeMap::new();
    for p in &pool.papers {
        if let Some(k) = p.bibtex_key.as_deref().filter(|k| !k.is_empty()) {
            let tag = match &p.discovered_for {
                serde_json::Value::Array(a) => a
                    .iter()
                    .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                    .collect::<Vec<_>>()
                    .join(","),
                serde_json::Value::String(s) => s.clone(),
                _ => String::new(),
            };
            info.insert(
                k.to_string(),
                (
                    if tag.is_empty() { "?".to_string() } else { tag },
                    p.title.clone().unwrap_or_default(),
                ),
            );
        }
    }
    let pool_keys: BTreeSet<&String> = info.keys().collect();
    if pool_keys.is_empty() {
        return Ok(CoverageReport {
            text: "ERROR: pool has no bibtex_keys. Run the BibTeX formatting step first.\n".into(),
            exit: 1,
        });
    }
    let cited = cited_keys(tex);
    let n_pool = pool_keys.len();
    let n_cited = pool_keys.iter().filter(|k| cited.contains(**k)).count();
    let ratio = n_cited as f64 / n_pool as f64;
    let threshold_n = (threshold * n_pool as f64) as usize;
    let mut text = format!(
        "Coverage: {n_cited}/{n_pool} = {:.1}% (threshold {:.0}% = {threshold_n})\n",
        ratio * 100.0,
        threshold * 100.0
    );
    let foreign: Vec<&String> = cited.iter().filter(|k| !info.contains_key(*k)).collect();
    if !foreign.is_empty() {
        let _ = writeln!(
            text,
            "\nWARNING: {} cited keys NOT in citation pool (violates 'cite ONLY collected_papers' rule):",
            foreign.len()
        );
        for k in foreign {
            let _ = writeln!(text, "  - {k}");
        }
    }
    if n_cited < threshold_n {
        let uncited: Vec<&String> = info.keys().filter(|k| !cited.contains(*k)).collect();
        let _ = writeln!(
            text,
            "\nFAIL: missing {} pool papers from .tex:",
            uncited.len()
        );
        for k in uncited {
            let (tag, title) = &info[k.as_str()];
            let _ = writeln!(
                text,
                "  - {:<40}  [{}]  {}",
                k,
                tag,
                super::tex::take_chars(title, 60)
            );
        }
        return Ok(CoverageReport { text, exit: 1 });
    }
    text.push_str("OK: citation coverage meets threshold\n");
    Ok(CoverageReport { text, exit: 0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orphans_and_unused() {
        let r = orphan_report(
            r"\cite{a} \parencite{b, c} % \cite{ghost}",
            "@a{a,}\n@b{b,}",
        );
        assert_eq!(
            r.orphans,
            ["c", "ghost"],
            "raw text still has the comment here"
        );
        let tex = super::super::tex::strip_comments(r"\cite{a} \parencite{b, c} % \cite{ghost}");
        let r = orphan_report(&tex, "@article{a,}\n@article{b,}\n@article{u,}");
        assert_eq!(r.orphans, ["c"]);
        assert_eq!(r.unused, ["u"]);
        assert_eq!((r.bib_entries, r.cited), (3, 3));
    }

    const POOL: &str = r#"{"papers":[
      {"bibtex_key":"a","title":"Alpha","discovered_for":["intro"]},
      {"bibtex_key":"b","title":"Beta","discovered_for":["rw","intro"]},
      {"bibtex_key":"c","title":"Gamma"},
      {"title":"keyless"}]}"#;

    #[test]
    fn coverage_meets_threshold() {
        let r = coverage_report(r"\cite{a,b,c}", POOL, 0.9).unwrap();
        assert_eq!(r.exit, 0);
        assert!(r
            .text
            .contains("Coverage: 3/3 = 100.0% (threshold 90% = 2)"));
    }

    #[test]
    fn coverage_fails_and_lists_uncited_and_foreign() {
        let r = coverage_report(r"\cite{a,zzz}", POOL, 0.9).unwrap();
        assert_eq!(r.exit, 1);
        assert!(r.text.contains("1/3"));
        assert!(r.text.contains("NOT in citation pool"));
        assert!(r.text.contains("rw,intro"));
        assert!(r.text.contains("Gamma"));
    }

    #[test]
    fn empty_pool_is_an_error_exit() {
        let r = coverage_report("", r#"{"papers":[]}"#, 0.9).unwrap();
        assert_eq!(r.exit, 1);
        assert!(coverage_report("", "nope", 0.9).is_err());
    }
}
