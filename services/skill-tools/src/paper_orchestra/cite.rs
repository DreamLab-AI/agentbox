//! Citation-key extraction shared by the orphan-cite, citation-coverage and
//! arXiv preflight gates.
//!
//! One extractor covers plain LaTeX, natbib and biblatex variants: any control
//! sequence whose name contains `cite` (`\cite`, `\citep`, `\citet`,
//! `\citeauthor`, `\parencite`, `\textcite`, `\autocite`, `\Citep*` ...), with up
//! to two optional `[...]` arguments and a comma-separated key list. `\nocite{*}`
//! cites nothing in particular and yields no key.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

static CITE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}")
        .expect("static cite regex")
});

static BIB_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*@(\w+)\s*\{\s*([^,\s}]+)").expect("static bib regex"));

/// One citation key together with the byte offset of its command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CiteUse {
    /// The cited key.
    pub key: String,
    /// Byte offset of the citation command in the scanned text.
    pub offset: usize,
}

/// Lists every citation key used in `tex`, in order of appearance (repeats kept).
///
/// ```
/// use skill_tools::paper_orchestra::cite::cite_uses;
/// let uses = cite_uses(r"See \citep[p.~3]{a, b} and \textcite{c}; \nocite{*}.");
/// let keys: Vec<_> = uses.iter().map(|u| u.key.as_str()).collect();
/// assert_eq!(keys, ["a", "b", "c"]);
/// ```
#[must_use]
pub fn cite_uses(tex: &str) -> Vec<CiteUse> {
    let mut out = Vec::new();
    for m in CITE_RE.captures_iter(tex) {
        let offset = m.get(0).map_or(0, |w| w.start());
        for k in m[1].split(',') {
            let k = k.trim();
            if k.is_empty() || k == "*" || k.contains('#') {
                continue;
            }
            out.push(CiteUse {
                key: k.to_string(),
                offset,
            });
        }
    }
    out
}

/// The set of distinct keys cited in `tex`.
#[must_use]
pub fn cited_keys(tex: &str) -> BTreeSet<String> {
    cite_uses(tex).into_iter().map(|u| u.key).collect()
}

/// Entry keys defined in a `.bib` file (`@comment`, `@string` and `@preamble`
/// blocks are not entries).
///
/// ```
/// use skill_tools::paper_orchestra::cite::bib_keys;
/// let bib = "@string{x = \"y\"}\n@article{smith2020,\n title={T}}\n@Book{ b2 ,}";
/// let keys: Vec<_> = bib_keys(bib).into_iter().collect();
/// assert_eq!(keys, ["b2", "smith2020"]);
/// ```
#[must_use]
pub fn bib_keys(bib: &str) -> BTreeSet<String> {
    BIB_KEY_RE
        .captures_iter(bib)
        .filter(|m| {
            !matches!(
                m[1].to_ascii_lowercase().as_str(),
                "comment" | "string" | "preamble"
            )
        })
        .map(|m| m[2].to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_and_lists() {
        let k = cited_keys(
            r"\cite{a}\citep*[see][p.~2]{b,c}\parencite{d}\citeauthor{e}\Textcite{f}\autocite[x]{g}",
        );
        let want: BTreeSet<String> = "abcdefg".chars().map(|c| c.to_string()).collect();
        assert_eq!(k, want);
    }

    #[test]
    fn nocite_star_and_macro_params_are_not_keys() {
        assert!(cited_keys(r"\nocite{*} \newcommand{\x}[1]{\cite{#1}}").is_empty());
    }

    #[test]
    fn multiline_key_lists() {
        let k = cited_keys("\\citep{alpha,\n  beta}");
        assert_eq!(k.len(), 2);
    }
}
