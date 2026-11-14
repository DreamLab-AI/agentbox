//! Reverse outline of a LaTeX draft (derived from `reverse_outline.py`).
//!
//! Strips the paper to one line per paragraph — its topic sentence — so a
//! reviewer can check whether the sequence reads as an argument. The mechanical
//! half (extraction and smell detection) lives here; judging the argument is
//! left to the reviewer.
//!
//! Flags raised per paragraph:
//!
//! | Flag | Meaning |
//! |---|---|
//! | `no-topic-sentence` | first sentence is under six words or opens on a connective |
//! | `overlong` | more than the maximum sentences or words |
//! | `multi-pivot` | two or more contrastive pivots (*however*, *in contrast* ...) |
//! | `orphan` | a single sentence of under 60 words |
//! | `citation-dump` | more citations than sentences |
//!
//! Deviations from upstream: citation commands such as `\parencite` and
//! `\textcite` count as citations (upstream matched only names starting with
//! `cite`), and the heading depth counts `sub` in the command name only, so
//! `\section{A substrate}` is not indented.

use std::fmt::Write as _;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use super::tex::{strip_comments, take_chars};

/// Environments whose contents are not prose.
const DROP_ENVIRONMENTS: &[&str] = &[
    "figure",
    "figure*",
    "table",
    "table*",
    "tabular",
    "tabularx",
    "equation",
    "equation*",
    "align",
    "align*",
    "gather",
    "gather*",
    "itemize",
    "enumerate",
    "description",
    "algorithm",
    "algorithmic",
    "lstlisting",
    "verbatim",
    "thebibliography",
];

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap_or_else(|e| panic!("static regex {p:?}: {e}"))
}

static DROP_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    DROP_ENVIRONMENTS
        .iter()
        .map(|e| {
            let e = regex::escape(e);
            re(&format!(r"(?s)\\begin\{{{e}\}}.*?\\end\{{{e}\}}"))
        })
        .collect()
});
static CONNECTIVE: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)^(?:however|moreover|furthermore|additionally|in addition|also|therefore|thus|hence|consequently|as a result|that is|in other words|for example|for instance|similarly|likewise|finally|then)\b",
    )
});
static PIVOTS: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)\b(?:however|in contrast|by contrast|on the other hand|conversely|nevertheless|nonetheless|whereas|although|yet)\b",
    )
});
static BEGIN_DOC: LazyLock<Regex> = LazyLock::new(|| re(r"\\begin\{document\}"));
static END_DOC: LazyLock<Regex> = LazyLock::new(|| re(r"\\end\{document\}"));
static BIB: LazyLock<Regex> = LazyLock::new(|| re(r"\\bibliography\{|\\begin\{thebibliography\}"));
static CITE: LazyLock<Regex> =
    LazyLock::new(|| re(r"\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\])*\{[^}]*\}"));
static DROPPED_CMDS: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"\\(?:label|ref|cref|Cref|autoref|includegraphics|usepackage|documentclass|bibliographystyle|bibliography|input|vspace|hspace|definecolor|hypersetup|newcommand|renewcommand|setlength)\*?(?:\[[^\]]*\])?\{[^}]*\}",
    )
});
static EMPH: LazyLock<Regex> =
    LazyLock::new(|| re(r"\\(?:emph|textbf|textit|texttt|underline|textsc)\{([^{}]*)\}"));
static INLINE_MATH: LazyLock<Regex> = LazyLock::new(|| re(r"\$[^$]*\$"));
static ANY_CMD: LazyLock<Regex> = LazyLock::new(|| re(r"\\[a-zA-Z]+\*?"));
static HEADING: LazyLock<Regex> = LazyLock::new(|| re(r"\\((?:sub)*)section\*?\{([^}]*)\}"));
static PARA_SPLIT: LazyLock<Regex> = LazyLock::new(|| re(r"\n\s*\n"));
static WS: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));

/// Strips everything that is not body prose while keeping sectioning intact:
/// the preamble, floats, lists, equations, the bibliography and comments. The
/// abstract becomes a section for outlining purposes.
#[must_use]
pub fn preprocess(tex: &str) -> String {
    let mut t = strip_comments(tex);
    if let Some(m) = BEGIN_DOC.find(&t) {
        t = t[m.end()..].to_string();
    }
    if let Some(m) = END_DOC.find(&t) {
        t.truncate(m.start());
    }
    if let Some(m) = BIB.find(&t) {
        t.truncate(m.start());
    }
    for r in DROP_RES.iter() {
        t = r.replace_all(&t, " ").into_owned();
    }
    let t = t.replace(r"\begin{abstract}", r"\section{Abstract}");
    t.replace(r"\end{abstract}", " ")
}

/// Flattens LaTeX markup inside one section body into readable prose;
/// citations become `[CITE]` and inline maths becomes `NUM`.
#[must_use]
pub fn flatten(body: &str) -> String {
    let b = CITE.replace_all(body, "[CITE]");
    let b = DROPPED_CMDS.replace_all(&b, " ");
    let b = EMPH.replace_all(&b, "$1");
    let b = INLINE_MATH.replace_all(&b, " NUM ");
    let b = b.replace(r"\%", "%").replace('~', " ");
    let b = ANY_CMD.replace_all(&b, " ");
    b.replace(['{', '}'], " ")
}

/// Returns `[(heading, flattened body)]` for every sectioning command; deeper
/// headings are prefixed with `— ` per level.
#[must_use]
pub fn split_sections(tex: &str) -> Vec<(String, String)> {
    let marks: Vec<_> = HEADING.captures_iter(tex).collect();
    if marks.is_empty() {
        return vec![("(whole document)".to_string(), flatten(tex))];
    }
    marks
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let whole = m.get(0).expect("whole match");
            let end = marks
                .get(i + 1)
                .map_or(tex.len(), |n| n.get(0).expect("whole match").start());
            let depth = m[1].len() / 3;
            let title = format!("{}{}", "— ".repeat(depth), m[2].trim());
            (title, flatten(&tex[whole.end()..end]))
        })
        .collect()
}

/// Splits a paragraph at `[.!?]` + whitespace when the next character is an
/// upper-case letter, a backslash or a dollar sign.
fn raw_sentences(p: &str) -> Vec<String> {
    let p = p.trim();
    let mut out = Vec::new();
    let mut last = 0;
    let chars: Vec<(usize, char)> = p.char_indices().collect();
    let mut k = 0;
    while k < chars.len() {
        let (i, c) = chars[k];
        if matches!(c, '.' | '!' | '?') {
            let mut j = k + 1;
            while j < chars.len() && chars[j].1.is_whitespace() {
                j += 1;
            }
            if j > k + 1
                && j < chars.len()
                && (chars[j].1.is_ascii_uppercase() || matches!(chars[j].1, '\\' | '$'))
            {
                out.push(p[last..i + c.len_utf8()].trim().to_string());
                last = chars[j].0;
                k = j;
                continue;
            }
        }
        k += 1;
    }
    out.push(p[last..].trim().to_string());
    out.retain(|s| !s.is_empty());
    out
}

/// Splits into sentences, merging run-in headings forward.
///
/// `\textbf{Policy engine.} The engine evaluates...` is one sentence with a
/// bold lead-in, not a two-word sentence followed by a real one; fragments of
/// five words or fewer are re-attached to what follows.
#[must_use]
pub fn sentences(paragraph: &str) -> Vec<String> {
    let mut merged = Vec::new();
    let mut carry = String::new();
    for s in raw_sentences(paragraph) {
        let s = if carry.is_empty() {
            s
        } else {
            format!("{carry} {s}").trim().to_string()
        };
        carry.clear();
        if s.split_whitespace().count() <= 5 {
            carry = s;
            continue;
        }
        merged.push(s);
    }
    if !carry.is_empty() {
        merged.push(carry);
    }
    merged
}

/// One analysed paragraph.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Paragraph {
    /// First sentence (at most 300 characters, whitespace collapsed).
    pub topic_sentence: String,
    /// Sentence count.
    pub sentences: usize,
    /// Word count.
    pub words: usize,
    /// Citation count.
    pub citations: usize,
    /// Structural flags.
    pub flags: Vec<String>,
}

/// Analyses one paragraph; fragments under 15 words are not paragraphs.
#[must_use]
pub fn analyze_paragraph(text: &str, max_sentences: usize, max_words: usize) -> Option<Paragraph> {
    let sents = sentences(text);
    let topic = sents.first()?;
    let words = text.split_whitespace().count();
    if words < 15 {
        return None;
    }
    let citations = text.matches("[CITE]").count();
    let mut flags = Vec::new();
    if topic.split_whitespace().count() < 6 || CONNECTIVE.is_match(topic) {
        flags.push("no-topic-sentence".to_string());
    }
    if sents.len() > max_sentences || words > max_words {
        flags.push("overlong".to_string());
    }
    if PIVOTS.find_iter(text).count() >= 2 {
        flags.push("multi-pivot".to_string());
    }
    if sents.len() == 1 && words < 60 {
        flags.push("orphan".to_string());
    }
    if citations > sents.len() {
        flags.push("citation-dump".to_string());
    }
    Some(Paragraph {
        topic_sentence: take_chars(&WS.replace_all(topic, " "), 300),
        sentences: sents.len(),
        words,
        citations,
        flags,
    })
}

/// A section of the reverse outline.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OutlineSection {
    /// Heading.
    pub section: String,
    /// Paragraphs with at least 15 words.
    pub paragraphs: Vec<Paragraph>,
}

/// Builds the reverse outline of a draft.
#[must_use]
pub fn build_outline(tex: &str, max_sentences: usize, max_words: usize) -> Vec<OutlineSection> {
    split_sections(&preprocess(tex))
        .into_iter()
        .filter_map(|(title, body)| {
            let paragraphs: Vec<Paragraph> = PARA_SPLIT
                .split(&body)
                .filter_map(|c| analyze_paragraph(c, max_sentences, max_words))
                .collect();
            (!paragraphs.is_empty()).then_some(OutlineSection {
                section: title,
                paragraphs,
            })
        })
        .collect()
}

/// Renders the Markdown outline.
#[must_use]
pub fn render_markdown(outline: &[OutlineSection]) -> String {
    let total: usize = outline.iter().map(|s| s.paragraphs.len()).sum();
    let flagged = outline
        .iter()
        .flat_map(|s| &s.paragraphs)
        .filter(|p| !p.flags.is_empty())
        .count();
    let mut l = vec![
        "# Reverse Outline".to_string(),
        String::new(),
        format!(
            "{total} paragraphs across {} sections; {flagged} carry a structural flag.",
            outline.len()
        ),
        String::new(),
        "Read the topic sentences alone, in order, ignoring everything else. If that".into(),
        "sequence does not read as an argument, the fix is structural — reordering,".into(),
        "merging, or cutting paragraphs — not sentence-level editing.".into(),
        String::new(),
    ];
    for sec in outline {
        l.push(format!("## {}", sec.section));
        l.push(String::new());
        for (i, p) in sec.paragraphs.iter().enumerate() {
            let flag = if p.flags.is_empty() {
                String::new()
            } else {
                format!("  `{}`", p.flags.join(" "))
            };
            l.push(format!("{}. {}{flag}", i + 1, p.topic_sentence));
            let mut meta = format!("   _{} sentences, {} words", p.sentences, p.words);
            if p.citations > 0 {
                let _ = write!(meta, ", {} citations", p.citations);
            }
            meta.push('_');
            l.push(meta);
        }
        l.push(String::new());
    }
    l.join("\n")
}

/// Flag counts, most frequent first (ties alphabetical).
#[must_use]
pub fn flag_counts(outline: &[OutlineSection]) -> Vec<(String, usize)> {
    let mut m: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for p in outline.iter().flat_map(|s| &s.paragraphs) {
        for f in &p.flags {
            *m.entry(f.clone()).or_default() += 1;
        }
    }
    let mut v: Vec<_> = m.into_iter().collect();
    v.sort_by_key(|x| std::cmp::Reverse(x.1));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAXS: usize = 8;
    const MAXW: usize = 220;

    fn flags(text: &str) -> Vec<String> {
        analyze_paragraph(text, MAXS, MAXW)
            .map(|p| p.flags)
            .unwrap_or_default()
    }

    #[test]
    fn preamble_is_dropped() {
        let tex = r"\documentclass{article}\definecolor{brand}{RGB}{1,2,3}\begin{document}\section{Intro} Body text here.\end{document}";
        let out = preprocess(tex);
        assert!(!out.contains("definecolor"));
        assert!(out.contains("Body text here."));
    }

    #[test]
    fn float_environments_are_dropped() {
        let tex = r"\begin{document}\section{X} Real prose sentence goes here.\begin{figure}\includegraphics{a.png}\caption{A caption.}\end{figure}\end{document}";
        assert!(!preprocess(tex).contains("caption"));
    }

    #[test]
    fn abstract_becomes_a_section() {
        let tex =
            r"\begin{document}\begin{abstract}Some abstract prose.\end{abstract}\end{document}";
        assert!(preprocess(tex).contains(r"\section{Abstract}"));
    }

    #[test]
    fn bibliography_is_dropped() {
        let tex = r"\begin{document}\section{X} Prose. \bibliography{refs}\end{document}";
        assert!(!preprocess(tex).contains("refs"));
    }

    #[test]
    fn run_in_heading_merges_forward() {
        let s = sentences("Policy engine. The engine evaluates every tool call against a YAML ruleset before the call reaches the operating system.");
        assert_eq!(s.len(), 1);
        assert!(s[0].starts_with("Policy engine."));
    }

    #[test]
    fn ordinary_sentences_are_not_merged() {
        let s = sentences("The first sentence carries the message of this paragraph. The second sentence supports it with a concrete example.");
        assert_eq!(s.len(), 2);
    }

    #[test]
    fn clean_paragraph_has_no_flags() {
        let text = "Our policy engine evaluates tool calls before execution. It matches each call against a ruleset of twenty-five detectors. Calls that match a critical rule are blocked outright.";
        assert!(flags(text).is_empty());
    }

    #[test]
    fn run_in_heading_is_not_a_missing_topic_sentence() {
        let text = "Policy engine. The engine evaluates every tool call against a YAML ruleset before the call reaches the operating system, and blocks the ones that match a critical rule.";
        assert!(!flags(text).contains(&"no-topic-sentence".to_string()));
    }

    #[test]
    fn connective_opener_is_flagged() {
        let text = "However, the same mechanism fails when the agent writes to a path outside the workspace root. We therefore extend the matcher to canonicalize paths before evaluation.";
        assert!(flags(text).contains(&"no-topic-sentence".to_string()));
    }

    #[test]
    fn overlong_paragraph_is_flagged() {
        let text = (0..12)
            .map(|i| format!("This is supporting sentence number {i} in a long paragraph."))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(flags(&text).contains(&"overlong".to_string()));
    }

    #[test]
    fn two_pivots_are_flagged() {
        let text = "The baseline achieves reasonable precision on static inputs. However, it collapses under adaptive prompts in our setting. In contrast, the policy engine holds its precision throughout.";
        assert!(flags(text).contains(&"multi-pivot".to_string()));
    }

    #[test]
    fn citation_dump_is_flagged() {
        let text = "Several systems address this problem [CITE] [CITE] [CITE]. Others take a complementary approach [CITE] [CITE].";
        assert!(flags(text).contains(&"citation-dump".to_string()));
    }

    #[test]
    fn short_single_sentence_is_an_orphan() {
        let text = "This observation about adaptive adversaries motivates the enforcement design described in the following subsection of the paper.";
        assert!(flags(text).contains(&"orphan".to_string()));
    }

    #[test]
    fn long_single_sentence_is_not_an_orphan() {
        let text = "The vendor landscape divides into four broad categories according to whether a given product intercepts agent tool calls at runtime, scans repositories after the fact for credentials that have already leaked into history, gates model access at the network boundary through a proxy layer, or merely reports its findings to a dashboard without offering any enforcement path that could stop the action before it reaches the operating system at all.";
        assert!(!flags(text).contains(&"orphan".to_string()));
    }

    #[test]
    fn fragments_are_not_paragraphs() {
        assert!(analyze_paragraph("Table 1.", MAXS, MAXW).is_none());
    }

    #[test]
    fn sections_and_subsection_depth() {
        let tex = "\\begin{document}\\section{Method} The method proceeds in three stages, each of which is described in the subsections that follow this overview paragraph.\n\n\\subsection{Policy Engine} The engine evaluates every incoming tool call against a ruleset of detectors before that call reaches the system.\\end{document}";
        let titles: Vec<_> = build_outline(tex, MAXS, MAXW)
            .into_iter()
            .map(|s| s.section)
            .collect();
        assert_eq!(titles, ["Method", "— Policy Engine"]);
    }

    #[test]
    fn heading_depth_counts_the_command_not_the_title() {
        let tex = "\\begin{document}\\section{A substrate} The substrate carries every experiment that the remaining sections of this paper report in full detail.\\end{document}";
        assert_eq!(build_outline(tex, MAXS, MAXW)[0].section, "A substrate");
    }

    #[test]
    fn markdown_lists_flags_and_citation_counts() {
        let tex = "\\begin{document}\\section{S} However, this fails in practice when agents write outside the workspace root \\parencite{a}. We extend the matcher to canonicalise paths.\\end{document}";
        let o = build_outline(tex, MAXS, MAXW);
        let md = render_markdown(&o);
        assert!(md.starts_with("# Reverse Outline"));
        assert!(md.contains("`no-topic-sentence`"));
        assert!(md.contains("1 citations_"));
        assert_eq!(flag_counts(&o)[0].1, 1);
    }
}
