//! Citation-key extraction shared by the orphan-cite, citation-coverage and
//! arXiv preflight gates.
//!
//! One extractor covers plain LaTeX, natbib and biblatex. It recognises an
//! explicit list of citation commands, not "anything containing `cite`", so
//! set-up macros (`\setcitestyle`, `\citestyle`, `\citeindextrue`,
//! `\bibliographystyle`) and `\citeauthoryear` are never read as citations:
//!
//! * natbib: `\cite`, `\citep`, `\citet`, `\citealp`, `\citealt`, `\citeauthor`,
//!   `\citeyear`, `\citeyearpar`, `\citenum`, `\citealias`, `\citepalias`,
//!   `\citetalias` (and the capitalised forms);
//! * biblatex: `\parencite`, `\textcite`, `\autocite`, `\smartcite`, `\footcite`,
//!   `\footcitetext`, `\supercite`, `\fullcite`, `\footfullcite`, `\citetitle`,
//!   `\citedate`, `\citeurl`, `\citefield`, `\citelist`, `\citename`, `\volcite`
//!   and relatives (for `\volcite` the first group is a volume, not a key), plus
//!   the multi-citation forms (`\cites`, `\parencites`, ...)
//!   with repeated `[..]{..}` groups;
//! * `\nocite`.
//!
//! A starred form, up to two optional `[...]` arguments (biblatex also `(...)`)
//! and a comma-separated key list are handled. `\nocite{*}` cites nothing in
//! particular and yields no key.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

/// Any control word; [`command_kind`] decides whether it cites.
static COMMAND: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\([A-Za-z]+)").expect("static command regex"));

/// How a citation command lays out its arguments.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// `\cite[..][..]{keys}`.
    Single,
    /// biblatex multi-citation: `\cites(..)(..)[..]{keys}[..]{keys}...`.
    Multi,
    /// biblatex `\volcite[pre]{volume}[pages]{keys}`: the first group is a volume.
    Volume,
}

/// Classifies a control word as a citation command, if it is one.
fn command_kind(name: &str) -> Option<Kind> {
    // Fold the leading capital (`\Citep`, `\Parencite`); the rest is case-exact.
    let mut chars = name.chars();
    let first = chars.next()?.to_ascii_lowercase();
    let folded = format!("{first}{}", chars.as_str());
    const SINGLE: [&str; 31] = [
        "cite",
        "citep",
        "citet",
        "citealp",
        "citealt",
        "citeauthor",
        "citeyear",
        "citeyearpar",
        "citenum",
        "citealias",
        "citepalias",
        "citetalias",
        "citetitle",
        "citedate",
        "citeurl",
        "citefield",
        "citelist",
        "citename",
        "parencite",
        "textcite",
        "smartcite",
        "autocite",
        "footcite",
        "footcitetext",
        "supercite",
        "fullcite",
        "footfullcite",
        "notecite",
        "pnotecite",
        "fnotecite",
        "nocite",
    ];
    const MULTI: [&str; 7] = [
        "cites",
        "parencites",
        "textcites",
        "smartcites",
        "autocites",
        "supercites",
        "footcites",
    ];
    const VOLUME: [&str; 7] = [
        "volcite",
        "pvolcite",
        "fvolcite",
        "ftvolcite",
        "svolcite",
        "tvolcite",
        "avolcite",
    ];
    if MULTI.contains(&folded.as_str()) {
        Some(Kind::Multi)
    } else if VOLUME.contains(&folded.as_str()) {
        Some(Kind::Volume)
    } else if SINGLE.contains(&folded.as_str()) {
        Some(Kind::Single)
    } else {
        None
    }
}

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
    let mut from = 0;
    while let Some(m) = COMMAND.captures_at(tex, from) {
        let whole = m.get(0).expect("whole match");
        from = whole.end();
        let Some(kind) = command_kind(&m[1]) else {
            continue;
        };
        let multi = kind == Kind::Multi;
        let mut braces = 0;
        let offset = whole.start();
        let mut i = whole.end();
        if tex[i..].starts_with('*') {
            i += 1;
        }
        let mut optional = 0;
        loop {
            let rest = tex[i..].trim_start();
            let start = tex.len() - rest.len();
            let close = match rest.chars().next() {
                Some('[') => ']',
                Some('(') if multi || optional < 2 => ')',
                Some('{') => '}',
                _ => break,
            };
            let Some(end) = rest.find(close) else {
                break;
            };
            i = start + end + 1;
            if close != '}' {
                optional += 1;
                if optional > 2 && !multi {
                    break;
                }
                continue;
            }
            braces += 1;
            let is_volume = kind == Kind::Volume && braces == 1;
            for k in rest[1..end].split(',').filter(|_| !is_volume) {
                let k = k.trim();
                if !(k.is_empty() || k == "*" || k.contains('#')) {
                    out.push(CiteUse {
                        key: k.to_string(),
                        offset,
                    });
                }
            }
            optional = 0;
            if !multi && !is_volume {
                break;
            }
        }
        from = i.max(from);
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
    fn setup_macros_are_not_citations() {
        let k = cited_keys(
            r"\setcitestyle{numbers,square}\citestyle{nature}\bibliographystyle{plainnat}\citeindextrue \nocite{*} \citeauthoryear{x}{y}",
        );
        assert!(k.is_empty(), "{k:?}");
        let k = cited_keys(r"\nocite{a,b} \citep{c}");
        assert_eq!(k.len(), 3);
    }

    #[test]
    fn biblatex_multicites_optional_arguments_and_whitespace() {
        let k = cited_keys(
            r"\parencites(see)(p.~4)[a]{k1}[b][c]{k2}{k3} \Cite [x] [y] {k4} \cite*{k5} \citealp*[p. 3]{k6} \autocite{k7}",
        );
        let want: BTreeSet<String> = (1..=7).map(|n| format!("k{n}")).collect();
        assert_eq!(k, want);
    }

    #[test]
    fn natbib_aliases_and_biblatex_volume_citations() {
        let k = cited_keys(
            r"\citealias{a} \citepalias[p.~3]{b} \citetalias{c} \volcite[cf.]{3}[10--12]{d} \Pvolcite{2}{e}",
        );
        let want: BTreeSet<String> = "abcde".chars().map(|c| c.to_string()).collect();
        assert_eq!(k, want, "the volume number is not a key");
    }

    #[test]
    fn offsets_point_at_the_command() {
        let u = cite_uses(r"ab \citep{x}");
        assert_eq!(u[0].offset, 3);
    }

    #[test]
    fn multiline_key_lists() {
        let k = cited_keys("\\citep{alpha,\n  beta}");
        assert_eq!(k.len(), 2);
    }
}
