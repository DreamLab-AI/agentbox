//! Claim-evidence gate: every quantitative claim must trace to evidence.
//!
//! Two modes share one extractor and one notion of *attribution*:
//!
//! - **Log mode** (derived from `claim_evidence_gate.py`): each numeric claim in
//!   the paper is looked up in `experimental_log.md`. A claim is `supported` when
//!   its number appears in the log, `attributed` (JSON key `uncertain`) when its
//!   sentence carries a citation or a prior-work cue, and `needs evidence`
//!   (JSON key `unsupported`) otherwise.
//! - **Ledger mode** (new): the paper cites results through a macro,
//!   `\ledger{id}` or `\ledger[fmt]{id}`, resolved against a JSON ledger
//!   `{"entries": [{"id", "value", "text", "superseded_by"?}]}`. Macro uses whose
//!   id is unknown or superseded are errors; every number still typed by hand in
//!   running prose is `attributed` (its sentence has a `\cite` or a prior-work
//!   cue) or `needs evidence`, with file, line and sentence.
//!
//! Exit codes: 0 clean, 1 something needs evidence, 2 an error (unreadable
//! input, or in ledger mode an unknown or superseded id).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::tex::{matching_brace, strip_comments, take_chars, Paper};

const CONTEXT_WINDOW: usize = 120;

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap_or_else(|e| panic!("static regex {p:?}: {e}"))
}

/// The nine upstream claim patterns, in upstream order (their index is the
/// `pattern_id`).
static CLAIM_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        re(
            r"(?i)(?:by|of|to|at|achieves?|improves?\s+(?:by|to)|gains?|reduces?\s+(?:by|to)|increases?\s+(?:by|to)|decreases?\s+(?:by|to)|accuracy|f1|recall|precision|score|performance|rate|under|over|above|below)\s+[<>~=]{0,2}\s*([+-]?\d+\.?\d*)\s*%",
        ),
        re(r"([+-]?\d+\.?\d*)\s*%"),
        re(r"(?i)(\d+\.?\d*)\s*[×x]\s*(?:faster|slower|more|less|better|worse)"),
        re(r"(\d+\.?\d*)\s*×"),
        re(r"×\s*(\d+\.?\d*)"),
        // Upstream matched `IS` case-insensitively, so "0 is 0" read as a claim; only the
        // upper-case Inception Score is a metric name here.
        re(r"(\d+\.?\d*)\s+(?:(?i:mAP|AUC|BLEU|ROUGE|CIDEr|FID|WER|CER|IoU|top-\d+)|IS\b)"),
        re(
            r"(?i)(?:outperforms?|exceeds?|surpasses?|beats?|better\s+than|superior\s+to|lags?\s+behind)\s+[^.]{0,60}?\s+by\s+([+-]?\d+\.?\d*)",
        ),
        re(r"\\textbf\{(\d+\.?\d*)\}"),
        re(r"(\d{2,3}\.\d{1,2})\s*(?:\\\\|&|\})"),
    ]
});

/// Pattern ids whose matches are structural rather than rhetorical.
const GENERIC_PATTERN_IDS: [usize; 2] = [7, 8];

/// Cues that a number belongs to someone else's work. `[CITE]` is the marker
/// [`normalize_latex`] leaves where a citation stood; in ledger mode a literal
/// `\cite...` command plays the same part.
///
/// "baseline" and "compared to" are deliberately *not* cues: they would
/// reclassify our own comparative results as someone else's numbers.
pub static PRIOR_WORK_CONTEXT: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)(?:\[CITE\]|\\[A-Za-z]*cite[A-Za-z]*|prior\s+(?:work|methods?)|previous\s+(?:work|methods?|approaches)|existing\s+(?:work|methods?|systems?|tools?)|et\s+al\.|concurrent\s+work|related\s+work|report(?:s|ed)\s+by|according\s+to|documents?\s|found\s+that)",
    )
});

static CITE_CMD: LazyLock<Regex> =
    LazyLock::new(|| re(r"\\cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{[^}]*\}"));
static OTHER_REFS: LazyLock<Regex> =
    LazyLock::new(|| re(r"\\(?:label|ref|cref|Cref|autoref|footnote|url|href)\{[^}]*\}"));
static BEGIN_ABSTRACT: LazyLock<Regex> = LazyLock::new(|| re(r"\\begin\{abstract\}"));
static BEGIN_END: LazyLock<Regex> = LazyLock::new(|| re(r"\\(?:begin|end)\{[^}]*\}"));
static TIMES: LazyLock<Regex> = LazyLock::new(|| re(r"\\times\b"));
static GEQ: LazyLock<Regex> = LazyLock::new(|| re(r"\\(?:geq|ge)\b"));
static LEQ: LazyLock<Regex> = LazyLock::new(|| re(r"\\(?:leq|le)\b"));
static SIM: LazyLock<Regex> = LazyLock::new(|| re(r"\\(?:sim|approx)\b"));
static BRACED_REL: LazyLock<Regex> = LazyLock::new(|| re(r"\{([<>~=]+)\}"));
static THIN: LazyLock<Regex> = LazyLock::new(|| re(r"\\[,;:!]"));
static PREFIX_HYPHEN: LazyLock<Regex> = LazyLock::new(|| re(r"([A-Za-z])-(\d+\.?\d*\s*%)"));
static SECTION_RE: LazyLock<Regex> = LazyLock::new(|| re(r"\\section\*?\{([^}]*)\}"));

/// Flattens LaTeX into plain text the claim patterns can match.
///
/// - `\%` is an escaped percent sign, not a comment; real comments are removed
///   first (before upstream did, which is the same for every non-pathological
///   input).
/// - `3.2\%`, `2.13$\times$` and `${>}85\%$` become `3.2%`, `2.13×`, `>85%`.
/// - `\cite{...}` leaves a ` [CITE] ` marker, other references vanish, and the
///   abstract becomes a `\section{Abstract}` so it can be located.
///
/// ```
/// use skill_tools::paper_orchestra::claim_evidence::normalize_latex;
/// assert!(normalize_latex(r"reaches 92.4\% accuracy").contains("92.4%"));
/// assert!(normalize_latex(r"Prior work \citep{x} reports 4\%").contains("[CITE]"));
/// ```
#[must_use]
pub fn normalize_latex(text: &str) -> String {
    let t = strip_comments(text);
    let t = CITE_CMD.replace_all(&t, " [CITE] ");
    let t = OTHER_REFS.replace_all(&t, " ");
    let t = BEGIN_ABSTRACT.replace_all(&t, r"\section{Abstract}");
    let t = BEGIN_END.replace_all(&t, " ");
    let t = t.replace(r"\%", "%");
    let t = TIMES.replace_all(&t, "×");
    let t = GEQ.replace_all(&t, ">=");
    let t = LEQ.replace_all(&t, "<=");
    let t = SIM.replace_all(&t, "~");
    let t = BRACED_REL.replace_all(&t, "$1");
    let t = THIN.replace_all(&t, " ");
    let t = PREFIX_HYPHEN.replace_all(&t, "$1 $2");
    t.replace(['$', '~'], " ")
}

/// Offsets and titles of `\section{...}` headings.
#[must_use]
pub fn section_index(text: &str) -> Vec<(usize, String)> {
    SECTION_RE
        .captures_iter(text)
        .map(|m| (m.get(0).map_or(0, |w| w.start()), m[1].trim().to_string()))
        .collect()
}

/// The section containing `offset` (`(preamble)` before the first heading).
#[must_use]
pub fn section_at(index: &[(usize, String)], offset: usize) -> String {
    let mut name = "(preamble)";
    for (pos, title) in index {
        if *pos <= offset {
            name = title;
        } else {
            break;
        }
    }
    name.to_string()
}

/// Bounds of the sentence containing `start..end`: from just after the
/// previous `. `, `.\n`, `! `, `? ` or blank line to and including the next
/// `. `, `.\n`, `! `, `? ` or blank line's first character.
#[must_use]
pub fn sentence_bounds(text: &str, start: usize, end: usize) -> (usize, usize) {
    let before = &text[..start];
    let s = [". ", ".\n", "! ", "? ", "\n\n"]
        .iter()
        .filter_map(|p| before.rfind(p))
        .max()
        .map_or(0, |i| i + 1);
    let after = &text[end..];
    let e = [". ", ".\n", "! ", "? ", "\n\n"]
        .iter()
        .filter_map(|p| after.find(p))
        .min()
        .map_or(after.len(), |i| i + 1);
    (s, end + e)
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_boundary(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

fn one_line(s: &str) -> String {
    s.replace('\n', " ").trim().to_string()
}

/// A quantitative claim found in log mode.
#[derive(Debug, Clone)]
pub struct Claim {
    /// The matched number as written.
    pub value: String,
    /// Surrounding text (±120 bytes).
    pub context: String,
    /// Which of the nine patterns matched.
    pub pattern_id: usize,
    /// Whether the sentence carries a citation or prior-work cue.
    pub is_prior_work: bool,
    /// Section heading above the claim.
    pub section: String,
    /// The sentence containing the claim.
    pub sentence: String,
}

/// Extracts every quantitative claim from LaTeX source.
///
/// Claims are de-duplicated on `(value, sentence[..120])`, so the same number
/// stated in Related Work and again in Experiments yields two claims.
#[must_use]
pub fn extract_claims(tex: &str) -> Vec<Claim> {
    let clean = normalize_latex(tex);
    let sections = section_index(&clean);
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    let mut claims = Vec::new();
    for (pid, pat) in CLAIM_PATTERNS.iter().enumerate() {
        for m in pat.captures_iter(&clean) {
            let (Some(whole), Some(g)) = (m.get(0), m.get(1)) else {
                continue;
            };
            let val = g.as_str().trim();
            if val.is_empty() {
                continue;
            }
            if GENERIC_PATTERN_IDS.contains(&pid) {
                let Ok(f) = val.parse::<f64>() else {
                    continue;
                };
                if f < 0.5 {
                    continue;
                }
                if val.bytes().all(|b| b.is_ascii_digit()) {
                    if let Ok(n) = val.parse::<u32>() {
                        if (1900..=2099).contains(&n) {
                            continue;
                        }
                    }
                }
            }
            let (s, e) = sentence_bounds(&clean, whole.start(), whole.end());
            let sentence = one_line(&clean[s..e]);
            let key = (val.to_string(), take_chars(&sentence, 120));
            if !seen.insert(key) {
                continue;
            }
            let cs = floor_boundary(&clean, whole.start().saturating_sub(CONTEXT_WINDOW));
            let ce = ceil_boundary(&clean, whole.end() + CONTEXT_WINDOW);
            claims.push(Claim {
                value: val.to_string(),
                context: one_line(&clean[cs..ce]),
                pattern_id: pid,
                is_prior_work: PRIOR_WORK_CONTEXT.is_match(&sentence),
                section: section_at(&sections, whole.start()),
                sentence,
            });
        }
    }
    claims
}

/// Finds a whole-number occurrence of `value` in `log` (`87.4` does not match
/// inside `187.45`) and returns ±80 bytes of context.
///
/// ```
/// use skill_tools::paper_orchestra::claim_evidence::find_evidence;
/// assert!(find_evidence("87.4", "| Ours | 87.4 | 0.91 |").is_some());
/// assert!(find_evidence("87.4", "the value is 187.45 units").is_none());
/// ```
#[must_use]
pub fn find_evidence(value: &str, log: &str) -> Option<String> {
    let bytes = log.as_bytes();
    for (i, _) in log.match_indices(value) {
        let before_digit = i > 0 && bytes[i - 1].is_ascii_digit();
        let after_digit = bytes.get(i + value.len()).is_some_and(u8::is_ascii_digit);
        if before_digit || after_digit {
            continue;
        }
        let s = floor_boundary(log, i.saturating_sub(80));
        let e = ceil_boundary(log, i + value.len() + 80);
        return Some(one_line(&log[s..e]));
    }
    None
}

// ------------------------------------------------------------------ log mode

/// A supported claim.
#[derive(Debug, Serialize, Clone)]
pub struct SupportedItem {
    /// Sentence (or context) of the claim.
    pub claim: String,
    /// The number.
    pub value: String,
    /// Section.
    pub section: String,
    /// Context.
    pub context: String,
    /// Where the log mentions the number.
    pub evidence_snippet: String,
}

/// A claim with no evidence.
#[derive(Debug, Serialize, Clone)]
pub struct UnsupportedItem {
    /// Sentence (or context) of the claim.
    pub claim: String,
    /// The number.
    pub value: String,
    /// Section.
    pub section: String,
    /// Context.
    pub context: String,
}

/// An attributed claim (JSON key `uncertain`).
#[derive(Debug, Serialize, Clone)]
pub struct UncertainItem {
    /// Sentence (or context) of the claim.
    pub claim: String,
    /// The number.
    pub value: String,
    /// Section.
    pub section: String,
    /// Context.
    pub context: String,
    /// Why it is attributed.
    pub reason: &'static str,
}

/// Counters of a log-mode report.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct LogSummary {
    /// Claims extracted.
    pub total: usize,
    /// Found in the log.
    pub supported: usize,
    /// Not found, not attributed.
    pub unsupported: usize,
    /// Attributed to cited work.
    pub uncertain: usize,
}

/// The log-mode JSON report (upstream field names).
#[derive(Debug, Serialize, Clone)]
pub struct LogReport {
    /// Claims corroborated by the log.
    pub supported: Vec<SupportedItem>,
    /// Claims with no evidence.
    pub unsupported: Vec<UnsupportedItem>,
    /// Claims attributed to prior work.
    pub uncertain: Vec<UncertainItem>,
    /// Counters.
    pub summary: LogSummary,
}

fn claim_text(c: &Claim) -> String {
    let s = take_chars(&c.sentence, 300);
    if s.is_empty() {
        take_chars(&c.context, 200)
    } else {
        s
    }
}

/// Classifies every claim of `tex` against `log_text`.
#[must_use]
pub fn check_against_log(tex: &str, log_text: &str) -> LogReport {
    let claims = extract_claims(tex);
    let (mut supported, mut unsupported, mut uncertain) = (vec![], vec![], vec![]);
    for c in &claims {
        let claim = claim_text(c);
        if c.is_prior_work {
            uncertain.push(UncertainItem {
                claim,
                value: c.value.clone(),
                section: c.section.clone(),
                context: c.context.clone(),
                reason: "sentence carries a citation or prior-work cue — attributed, not claimed",
            });
        } else if let Some(ev) = find_evidence(&c.value, log_text) {
            supported.push(SupportedItem {
                claim,
                value: c.value.clone(),
                section: c.section.clone(),
                context: c.context.clone(),
                evidence_snippet: ev,
            });
        } else {
            unsupported.push(UnsupportedItem {
                claim,
                value: c.value.clone(),
                section: c.section.clone(),
                context: c.context.clone(),
            });
        }
    }
    LogReport {
        summary: LogSummary {
            total: claims.len(),
            supported: supported.len(),
            unsupported: unsupported.len(),
            uncertain: uncertain.len(),
        },
        supported,
        unsupported,
        uncertain,
    }
}

fn cell(s: &str, width: usize) -> String {
    take_chars(s.replace('|', "\\|").replace('\n', " ").trim(), width)
}

/// Renders the claim-evidence map: unsupported, then attributed, then
/// supported, so the revision agenda reads top-down.
#[must_use]
pub fn render_claim_map(report: &LogReport) -> String {
    let mut lines = vec![
        "# Claim-Evidence Map".to_string(),
        String::new(),
        format!(
            "{} quantitative claims extracted from the draft. ",
            report.summary.total
        ),
        "Rows marked **needs evidence** carry a number that appears nowhere in ".into(),
        "`experimental_log.md` and carries no citation — verify, attribute, or remove.".into(),
        String::new(),
        "| Value | Section | Claim | Evidence | Status |".into(),
        "|---|---|---|---|---|".into(),
    ];
    let mut row = |v: &str, sec: &str, claim: &str, ev: &str, st: &str| {
        lines.push(format!(
            "| `{v}` | {} | {} | {} | {st} |",
            cell(sec, 40),
            cell(claim, 160),
            cell(ev, 80)
        ));
    };
    for i in &report.unsupported {
        row(&i.value, &i.section, &i.claim, "—", "**needs evidence**");
    }
    for i in &report.uncertain {
        row(&i.value, &i.section, &i.claim, "cited source", "attributed");
    }
    for i in &report.supported {
        row(
            &i.value,
            &i.section,
            &i.claim,
            &i.evidence_snippet,
            "supported",
        );
    }
    lines.push(String::new());
    lines.join("\n")
}

// --------------------------------------------------------------- ledger mode

/// One ledger entry. Unknown fields are ignored (real ledgers carry many).
#[derive(Debug, Clone, Deserialize)]
pub struct LedgerEntry {
    /// Stable identifier cited by the macro.
    pub id: String,
    /// The measured value.
    #[serde(default)]
    pub value: Value,
    /// Display text, e.g. `88.3%`.
    #[serde(default)]
    pub text: Option<String>,
    /// Id of the entry that replaces this one.
    #[serde(default)]
    pub superseded_by: Option<String>,
}

/// The ledger document.
#[derive(Debug, Deserialize)]
pub struct Ledger {
    /// Entries.
    pub entries: Vec<LedgerEntry>,
}

impl Ledger {
    /// Parses a ledger from JSON text.
    ///
    /// # Errors
    ///
    /// A message when the text is not a ledger document.
    pub fn parse(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map_err(|e| format!("invalid ledger JSON: {e}"))
    }
}

/// A macro use found in the paper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MacroUse {
    /// The id argument.
    pub id: String,
    /// The optional `[fmt]` argument.
    pub fmt: Option<String>,
    /// Byte offset in the flattened paper text.
    pub offset: usize,
}

/// Finds `\<name>{id}` and `\<name>[fmt]{id}` uses in `text`.
///
/// ```
/// use skill_tools::paper_orchestra::claim_evidence::macro_uses;
/// let u = macro_uses(r"We reach \ledger[pct]{a.b} and \ledger{c}.", "ledger");
/// assert_eq!((u[0].id.as_str(), u[0].fmt.as_deref()), ("a.b", Some("pct")));
/// assert_eq!(u[1].id, "c");
/// ```
#[must_use]
pub fn macro_uses(text: &str, name: &str) -> Vec<MacroUse> {
    let r = re(&format!(
        r"\\{}\s*(?:\[([^\]]*)\])?\s*\{{([^}}]*)\}}",
        regex::escape(name)
    ));
    r.captures_iter(text)
        .map(|m| MacroUse {
            id: m[2].trim().to_string(),
            fmt: m.get(1).map(|f| f.as_str().to_string()),
            offset: m.get(0).map_or(0, |w| w.start()),
        })
        .collect()
}

const MASKED_ENVS: &[&str] = &[
    "equation",
    "align",
    "alignat",
    "flalign",
    "gather",
    "multline",
    "eqnarray",
    "displaymath",
    "math",
    "split",
    "verbatim",
    "Verbatim",
    "lstlisting",
    "minted",
    "tikzpicture",
    "comment",
    "thebibliography",
];

/// Commands whose arguments are never prose: `(name, brace groups to mask)`.
/// Optional `[...]` groups before and between the braces are masked too.
const MASKED_COMMANDS: &[(&str, usize)] = &[
    ("ref", 1),
    ("eqref", 1),
    ("cref", 1),
    ("Cref", 1),
    ("autoref", 1),
    ("pageref", 1),
    ("vref", 1),
    ("label", 1),
    ("includegraphics", 1),
    ("input", 1),
    ("include", 1),
    ("usepackage", 1),
    ("RequirePackage", 1),
    ("hypersetup", 1),
    ("definecolor", 3),
    ("geometry", 1),
    ("documentclass", 1),
    ("bibliography", 1),
    ("bibliographystyle", 1),
    ("addbibresource", 1),
    ("url", 1),
    ("href", 1),
    ("texttt", 1),
    ("vspace", 1),
    ("hspace", 1),
    ("setlength", 2),
    ("addtolength", 2),
    ("setcounter", 2),
    ("fontsize", 2),
    ("linespread", 1),
    ("scalebox", 1),
    ("resizebox", 2),
    ("rule", 2),
    ("color", 1),
    ("textcolor", 1),
    ("cellcolor", 1),
    ("rowcolor", 1),
    ("usetikzlibrary", 1),
    ("captionsetup", 1),
    ("setlist", 1),
    ("graphicspath", 1),
];

fn blank(bytes: &mut [u8], from: usize, to: usize) {
    let end = to.min(bytes.len());
    for b in &mut bytes[from..end] {
        if *b != b'\n' {
            *b = b' ';
        }
    }
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}

/// Masks the argument groups following a command name that ends at `from`.
fn mask_groups(text: &str, bytes: &mut [u8], from: usize, braces: usize) {
    let mut i = from;
    if bytes.get(i) == Some(&b'*') {
        i += 1;
    }
    let mut taken = 0;
    let mut last_end = from;
    loop {
        let j = skip_ws(text.as_bytes(), i);
        match text.as_bytes().get(j) {
            Some(b'[') => match text[j..].find(']') {
                Some(k) => {
                    i = j + k + 1;
                    last_end = i;
                }
                None => break,
            },
            Some(b'{') if taken < braces => match matching_brace(text, j) {
                Some(k) => {
                    i = k + 1;
                    last_end = i;
                    taken += 1;
                }
                None => break,
            },
            _ => break,
        }
        if taken >= braces && text.as_bytes().get(skip_ws(text.as_bytes(), i)) != Some(&b'[') {
            break;
        }
    }
    blank(bytes, from, last_end);
}

/// Replaces every region that is not running prose by spaces (newlines kept),
/// so byte offsets still map onto the original text.
///
/// Masked: everything before `\begin{document}` and after `\end{document}`;
/// maths (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) and maths, verbatim,
/// listing, bibliography and `tikzpicture` environments; and the arguments of
/// reference, citation, file, layout and colour commands (see the module
/// constants). Citation *commands* keep their names so a later pass can still
/// see that the sentence cites something. `$\times$` becomes `×` so a
/// multiplier like `2.13$\times$` stays recognisable.
#[must_use]
pub fn mask_non_prose(text: &str, macro_name: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();

    if let Some(p) = text.find(r"\begin{document}") {
        blank(&mut bytes, 0, p + r"\begin{document}".len());
    }
    if let Some(p) = text.rfind(r"\end{document}") {
        blank(&mut bytes, p, text.len());
    }

    // `$\times$` -> `×` + padding (same byte length: 8).
    for (i, _) in text.match_indices(r"$\times$") {
        let rep = "×      ";
        bytes[i..i + 8].copy_from_slice(rep.as_bytes());
    }

    for env in MASKED_ENVS {
        let r = re(&format!(r"(?s)\\begin\{{{env}\*?\}}.*?\\end\{{{env}\*?\}}"));
        for m in r.find_iter(text) {
            blank(&mut bytes, m.start(), m.end());
        }
    }
    for pat in [r"(?s)\$\$.*?\$\$", r"(?s)\\\[.*?\\\]", r"(?s)\\\(.*?\\\)"] {
        for m in re(pat).find_iter(text) {
            blank(&mut bytes, m.start(), m.end());
        }
    }
    // Inline maths: pair unescaped `$` signs on the partly masked text.
    let partial = String::from_utf8_lossy(&bytes).into_owned();
    let pb = partial.as_bytes();
    let mut i = 0;
    let mut open: Option<usize> = None;
    while i < pb.len() {
        match pb[i] {
            b'\\' => i += 1,
            b'$' => match open.take() {
                Some(s) => blank(&mut bytes, s, i + 1),
                None => open = Some(i),
            },
            _ => {}
        }
        i += 1;
    }

    let cite = re(r"\\[A-Za-z]*[Cc]ite[A-Za-z]*");
    for m in cite.find_iter(text) {
        mask_groups(text, &mut bytes, m.end(), 1);
    }
    for (name, braces) in MASKED_COMMANDS {
        let r = re(&format!(r"\\{}\b", regex::escape(name)));
        for m in r.find_iter(text) {
            mask_groups(text, &mut bytes, m.end(), *braces);
        }
    }
    let user = re(&format!(r"\\{}\b", regex::escape(macro_name)));
    for m in user.find_iter(text) {
        mask_groups(text, &mut bytes, m.end(), 1);
    }
    // Macro definitions: \newcommand{\x}[2]{body} or \newcommand\x{body}.
    for m in re(r"\\(?:re|provide)?newcommand\b|\\def\b").find_iter(text) {
        let mut j = skip_ws(text.as_bytes(), m.end());
        if text.as_bytes().get(j) == Some(&b'*') {
            j += 1;
            j = skip_ws(text.as_bytes(), j);
        }
        let mut end = j;
        if text.as_bytes().get(j) == Some(&b'{') {
            if let Some(k) = matching_brace(text, j) {
                end = k + 1;
            }
        } else if text.as_bytes().get(j) == Some(&b'\\') {
            end = j + 1;
            while text
                .as_bytes()
                .get(end)
                .is_some_and(u8::is_ascii_alphabetic)
            {
                end += 1;
            }
        }
        mask_groups(text, &mut bytes, end, 1);
        blank(&mut bytes, m.start(), end);
    }
    // Only ASCII bytes were written over whole characters, so this is valid UTF-8.
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

static DECIMAL: LazyLock<Regex> = LazyLock::new(|| re(r"\d+\.\d+"));
static SPEC_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)(?:sections?|sec\.|appendix|appendices|theorems?|lemmas?|propositions?|corollar(?:y|ies)|definitions?|algorithms?|figures?|fig\.|tables?|eq\.|equations?|chapters?|claims?|remarks?|examples?|steps?|versions?|v|§)[\s~]*$",
    )
});
static UNIT_SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
    re(r"^\s*(?:\\(?:line|text|column)?width|\\textheight|\\hsize|(?:pt|em|ex|cm|mm|in|bp|sp)\b)")
});

/// A number typed by hand in running prose.
#[derive(Debug, Clone)]
pub struct HandTyped {
    /// The number as written.
    pub value: String,
    /// Byte offset of the number in the flattened text.
    pub offset: usize,
    /// The sentence, from the unmasked text.
    pub sentence: String,
    /// Whether the sentence carries `\cite` or a prior-work cue.
    pub attributed: bool,
}

/// Finds hand-typed decimals and percentages in running prose.
///
/// Detection runs upstream's nine claim patterns plus a plain-decimal pattern
/// over the masked text (see [`mask_non_prose`]). Lengths and section numbers
/// (`Section 3.2`, `0.5\linewidth`, `1.2.3`, `arXiv:2604.05018`) are not
/// claims.
#[must_use]
pub fn hand_typed_numbers(text: &str, macro_name: &str) -> Vec<HandTyped> {
    let masked = mask_non_prose(text, macro_name);
    // Same-length rewrites so offsets stay valid: `\%` -> ` %`, `\times` -> `×` + 4 spaces.
    let norm = masked.replace(r"\%", " %").replace(r"\times", "×    ");
    let mut found: BTreeMap<usize, (String, usize)> = BTreeMap::new();
    for (pid, pat) in CLAIM_PATTERNS.iter().enumerate() {
        for m in pat.captures_iter(&norm) {
            let Some(g) = m.get(1) else { continue };
            let val = g.as_str().trim();
            if GENERIC_PATTERN_IDS.contains(&pid) {
                let Ok(f) = val.parse::<f64>() else { continue };
                if f < 0.5
                    || (val.bytes().all(|b| b.is_ascii_digit()) && (1900.0..=2099.0).contains(&f))
                {
                    continue;
                }
            }
            found.entry(g.start()).or_insert((val.to_string(), pid));
        }
    }
    let nb = norm.as_bytes();
    for m in DECIMAL.find_iter(&norm) {
        let (s, e) = (m.start(), m.end());
        let prev_digit_dot = s >= 2 && nb[s - 1] == b'.' && nb[s - 2].is_ascii_digit();
        let next_digit_dot =
            nb.get(e) == Some(&b'.') && nb.get(e + 1).is_some_and(u8::is_ascii_digit);
        let after_colon = s > 0 && nb[s - 1] == b':';
        if prev_digit_dot
            || next_digit_dot
            || after_colon
            || (s > 0 && nb[s - 1].is_ascii_digit())
            || nb.get(e).is_some_and(u8::is_ascii_digit)
            || SPEC_PREFIX.is_match(&norm[floor_boundary(&norm, s.saturating_sub(16))..s])
        {
            continue;
        }
        found.entry(s).or_insert((m.as_str().to_string(), 9));
    }
    let mut out = Vec::new();
    for (start, (val, _)) in found {
        let end = start + val.len();
        let tail_end = ceil_boundary(&norm, end + 14);
        if UNIT_SUFFIX.is_match(&norm[end.min(norm.len())..tail_end]) {
            continue;
        }
        let (s, e) = sentence_bounds(&norm, start, end);
        // Show at most 120 bytes either side of the number, inside the sentence.
        let (ds, de) = (
            ceil_boundary(text, s.max(start.saturating_sub(120))),
            floor_boundary(text, e.min(end + 120)),
        );
        out.push(HandTyped {
            attributed: PRIOR_WORK_CONTEXT.is_match(&norm[s..e]),
            sentence: one_line(&text[ds..de.max(ds)]),
            value: val,
            offset: start,
        });
    }
    out
}

/// What is wrong with a macro use.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MacroError {
    /// The id is not in the ledger.
    UnknownId,
    /// The id's entry has been superseded.
    SupersededId,
}

/// A macro use that must be fixed.
#[derive(Debug, Serialize, Clone)]
pub struct MacroProblem {
    /// Problem kind.
    pub kind: MacroError,
    /// The id as cited.
    pub id: String,
    /// The replacement id, for superseded entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
    /// File.
    pub file: String,
    /// One-based line.
    pub line: usize,
}

/// A hand-typed number row.
#[derive(Debug, Serialize, Clone)]
pub struct NumberRow {
    /// The number as written.
    pub value: String,
    /// File.
    pub file: String,
    /// One-based line.
    pub line: usize,
    /// Section heading above it.
    pub section: String,
    /// The sentence.
    pub sentence: String,
}

/// Macro-use counters.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct MacroCounts {
    /// Macro uses in the paper.
    pub total: usize,
    /// Distinct ids among them.
    pub distinct_ids: usize,
}

/// Counters of a ledger-mode report.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct LedgerSummary {
    /// Macro uses.
    pub macro_uses: usize,
    /// Distinct ids.
    pub distinct_ids: usize,
    /// Unknown or superseded uses.
    pub errors: usize,
    /// Hand-typed numbers attributed to cited work.
    pub attributed: usize,
    /// Hand-typed numbers with no evidence.
    pub needs_evidence: usize,
}

/// The ledger-mode JSON report.
#[derive(Debug, Serialize, Clone)]
pub struct LedgerReport {
    /// Always `ledger`.
    pub mode: &'static str,
    /// The macro name checked.
    #[serde(rename = "macro")]
    pub macro_name: String,
    /// Entries in the ledger.
    pub ledger_entries: usize,
    /// Macro-use counters.
    pub macro_uses: MacroCounts,
    /// Unknown or superseded macro uses.
    pub errors: Vec<MacroProblem>,
    /// Hand-typed numbers whose sentence cites prior work.
    pub attributed: Vec<NumberRow>,
    /// Hand-typed numbers with nothing behind them.
    pub needs_evidence: Vec<NumberRow>,
    /// Counters.
    pub summary: LedgerSummary,
}

impl LedgerReport {
    /// Process exit code: 2 errors, 1 needs evidence, 0 clean.
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        if !self.errors.is_empty() {
            2
        } else if !self.needs_evidence.is_empty() {
            1
        } else {
            0
        }
    }
}

/// Runs the ledger-mode gate over a loaded paper.
#[must_use]
pub fn check_against_ledger(paper: &Paper, ledger: &Ledger, macro_name: &str) -> LedgerReport {
    let text = paper.text();
    let by_id: HashMap<&str, &LedgerEntry> =
        ledger.entries.iter().map(|e| (e.id.as_str(), e)).collect();
    let uses = macro_uses(text, macro_name);
    let distinct: BTreeSet<&str> = uses.iter().map(|u| u.id.as_str()).collect();
    let mut errors = Vec::new();
    for u in &uses {
        let (file, line) = split_loc(&paper.locate_display(u.offset));
        match by_id.get(u.id.as_str()) {
            None => errors.push(MacroProblem {
                kind: MacroError::UnknownId,
                id: u.id.clone(),
                superseded_by: None,
                file,
                line,
            }),
            Some(e) => {
                if let Some(next) = e.superseded_by.as_deref().filter(|s| !s.is_empty()) {
                    errors.push(MacroProblem {
                        kind: MacroError::SupersededId,
                        id: u.id.clone(),
                        superseded_by: Some(next.to_string()),
                        file,
                        line,
                    });
                }
            }
        }
    }
    let index = section_index(text);
    let (mut attributed, mut needs) = (Vec::new(), Vec::new());
    let mut seen_rows: BTreeSet<(String, usize, String)> = BTreeSet::new();
    for h in hand_typed_numbers(text, macro_name) {
        let (file, line) = split_loc(&paper.locate_display(h.offset));
        // One row per value per source line: a table row repeating "0\%" is one finding.
        if !seen_rows.insert((file.clone(), line, h.value.clone())) {
            continue;
        }
        let row = NumberRow {
            value: h.value,
            file,
            line,
            section: section_for(text, &index, h.offset),
            sentence: take_chars(&h.sentence, 300),
        };
        if h.attributed {
            attributed.push(row);
        } else {
            needs.push(row);
        }
    }
    LedgerReport {
        mode: "ledger",
        macro_name: macro_name.to_string(),
        ledger_entries: ledger.entries.len(),
        macro_uses: MacroCounts {
            total: uses.len(),
            distinct_ids: distinct.len(),
        },
        summary: LedgerSummary {
            macro_uses: uses.len(),
            distinct_ids: distinct.len(),
            errors: errors.len(),
            attributed: attributed.len(),
            needs_evidence: needs.len(),
        },
        errors,
        attributed,
        needs_evidence: needs,
    }
}

fn section_for(text: &str, index: &[(usize, String)], offset: usize) -> String {
    let abstract_start = text.find(r"\begin{abstract}");
    let abstract_end = text.find(r"\end{abstract}");
    if let (Some(s), Some(e)) = (abstract_start, abstract_end) {
        let first_section = index.first().map_or(usize::MAX, |x| x.0);
        if offset > s
            && offset < e
            && s < first_section.max(e)
            && index.iter().all(|(p, _)| *p < s || *p > offset)
        {
            return "Abstract".to_string();
        }
    }
    section_at(index, offset)
}

fn split_loc(s: &str) -> (String, usize) {
    match s.rsplit_once(':') {
        Some((f, l)) => (f.to_string(), l.parse().unwrap_or(0)),
        None => (s.to_string(), 0),
    }
}

/// Renders the ledger-mode Markdown report.
#[must_use]
pub fn render_ledger_markdown(r: &LedgerReport) -> String {
    let mut l = vec![
        "# Claim-Evidence Map (ledger mode)".to_string(),
        String::new(),
        format!(
            "`\\{}` uses: {} ({} distinct ids) against a ledger of {} entries; {} error(s), {} \
             attributed number(s), {} needing evidence.",
            r.macro_name,
            r.summary.macro_uses,
            r.summary.distinct_ids,
            r.ledger_entries,
            r.summary.errors,
            r.summary.attributed,
            r.summary.needs_evidence
        ),
        String::new(),
    ];
    if !r.errors.is_empty() {
        l.extend([
            "## Macro errors".to_string(),
            String::new(),
            "| Id | Problem | Where |".into(),
            "|---|---|---|".into(),
        ]);
        for e in &r.errors {
            let what = match (&e.kind, &e.superseded_by) {
                (MacroError::UnknownId, _) => "unknown id".to_string(),
                (MacroError::SupersededId, Some(n)) => format!("superseded by `{n}`"),
                (MacroError::SupersededId, None) => "superseded".to_string(),
            };
            l.push(format!(
                "| `{}` | {what} | {}:{} |",
                cell(&e.id, 80),
                e.file,
                e.line
            ));
        }
        l.push(String::new());
    }
    l.extend([
        "## Hand-typed numbers".to_string(),
        String::new(),
        "| Value | Where | Section | Sentence | Status |".into(),
        "|---|---|---|---|---|".into(),
    ]);
    let mut push = |rows: &[NumberRow], status: &str| {
        for n in rows {
            l.push(format!(
                "| `{}` | {}:{} | {} | {} | {status} |",
                n.value,
                n.file,
                n.line,
                cell(&n.section, 40),
                cell(&n.sentence, 160)
            ));
        }
    };
    push(&r.needs_evidence, "**needs evidence**");
    push(&r.attributed, "attributed");
    l.push(String::new());
    l.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(tex: &str) -> Vec<String> {
        extract_claims(tex).into_iter().map(|c| c.value).collect()
    }

    // ---- ports of the upstream regression tests (normalize_latex) ----
    #[test]
    fn escaped_percent_is_not_a_comment() {
        let out = normalize_latex(r"Our method reaches 92.4\% accuracy on the held-out split.");
        assert!(out.contains("accuracy on the held-out split"));
        assert!(out.contains("92.4%"));
    }

    #[test]
    fn real_comment_is_still_stripped() {
        let out = normalize_latex("Visible text.  % TODO: rewrite this paragraph\nNext line.");
        assert!(!out.contains("TODO"));
        assert!(out.contains("Visible text."));
    }

    #[test]
    fn math_multiplier_is_flattened() {
        let out = normalize_latex(r"a 2.13$\times$ multiplier");
        assert!(out.contains('×') && !out.contains("times"));
        assert!(values(r"a 2.13$\times$ speedup").contains(&"2.13".to_string()));
    }

    #[test]
    fn braced_relation_is_flattened() {
        assert!(normalize_latex(r"from ${>}85\%$ down").contains(">85%"));
    }

    #[test]
    fn citation_leaves_a_marker() {
        let out = normalize_latex(r"Prior work reports 41.2\% \citep{smith2025}.");
        assert!(out.contains("[CITE]"));
        assert!(PRIOR_WORK_CONTEXT.is_match(&out));
    }

    #[test]
    fn other_refs_are_dropped_without_marker() {
        let out = normalize_latex(r"See \ref{fig:one} for the 12.5\% case.");
        assert!(!out.contains("[CITE]"));
        assert!(out.contains("12.5%"));
    }

    // ---- ports of the upstream regression tests (extract_claims) ----
    #[test]
    fn percentage_claim_is_extracted() {
        assert!(
            values(r"The system improves accuracy by 3.2\% over the baseline.")
                .contains(&"3.2".to_string())
        );
    }

    #[test]
    fn prefix_hyphen_is_not_a_minus_sign() {
        let v = values(r"We hold attacks to sub-5\% success.");
        assert!(v.contains(&"5".to_string()));
        assert!(!v.contains(&"-5".to_string()));
    }

    #[test]
    fn cited_number_is_attributed_not_claimed() {
        let c = extract_claims(r"GitGuardian reports 28.6\% growth \citep{gg2026}.");
        assert!(!c.is_empty());
        assert!(c.iter().all(|c| c.is_prior_work));
    }

    #[test]
    fn our_number_is_not_attributed() {
        let c = extract_claims(r"\section{Experiments} We reach 87.4\% accuracy.");
        let ours: Vec<_> = c.iter().filter(|c| c.value == "87.4").collect();
        assert!(!ours.is_empty());
        assert!(!ours[0].is_prior_work);
        assert_eq!(ours[0].section, "Experiments");
    }

    #[test]
    fn baseline_comparison_is_our_claim() {
        let tex = r"\section{Experiments} Our model improves over the strongest baseline by 3.2\%.";
        let c: Vec<_> = extract_claims(tex)
            .into_iter()
            .filter(|c| c.value == "3.2")
            .collect();
        assert!(!c.is_empty());
        assert!(!c[0].is_prior_work);
    }

    #[test]
    fn same_value_in_two_sentences_yields_two_claims() {
        let tex = r"\section{Related Work} Prior work reports 41.2\% \citep{a2025}. \section{Experiments} Our system reaches 41.2\% on the same split.";
        let c: Vec<_> = extract_claims(tex)
            .into_iter()
            .filter(|c| c.value == "41.2")
            .collect();
        assert_eq!(c.len(), 2);
        assert_eq!(
            c.iter().map(|c| c.is_prior_work).collect::<BTreeSet<_>>(),
            BTreeSet::from([true, false])
        );
        assert_eq!(
            c.iter()
                .map(|c| c.section.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["Related Work", "Experiments"])
        );
    }

    #[test]
    fn abstract_is_a_named_section() {
        let c: Vec<_> =
            extract_claims(r"\begin{abstract} We reach 88.1\% accuracy. \end{abstract}")
                .into_iter()
                .filter(|c| c.value == "88.1")
                .collect();
        assert_eq!(c[0].section, "Abstract");
    }

    #[test]
    fn section_attribution() {
        let c: Vec<_> = extract_claims(
            r"\section{Method} No numbers. \section{Experiments} We reach 91.0\% recall.",
        )
        .into_iter()
        .filter(|c| c.value == "91.0")
        .collect();
        assert_eq!(c[0].section, "Experiments");
    }

    #[test]
    fn lowercase_is_is_not_a_metric_name() {
        assert!(values("the value 0 is 0 here").is_empty());
        assert!(values("an IS of 3 or 11.2 IS here").contains(&"11.2".to_string()));
    }

    #[test]
    fn years_in_table_cells_are_not_claims() {
        assert!(values(r"\begin{tabular}{ll} 2025 & \textbf{2026} \\ \end{tabular}").is_empty());
    }

    // ---- ports of the upstream regression tests (find_evidence) ----
    #[test]
    fn exact_number_match() {
        assert!(find_evidence("87.4", "| Ours | 87.4 | 0.91 |").is_some());
    }

    #[test]
    fn fabricated_number_is_unsupported() {
        assert!(find_evidence("93.8", "| Ours | 87.4 | 0.91 |").is_none());
    }

    #[test]
    fn no_partial_number_match() {
        assert!(find_evidence("87.4", "the value is 187.45 units").is_none());
    }

    // ---- log mode end to end ----
    #[test]
    fn log_report_classifies_three_ways_and_renders_map() {
        let tex = r"\section{R} We reach 87.4\% accuracy. We also claim 99.9\% recall. GG reports 28.6\% \citep{g}.";
        let r = check_against_log(tex, "| Ours | 87.4 |");
        assert_eq!(
            r.summary,
            LogSummary {
                total: 3,
                supported: 1,
                unsupported: 1,
                uncertain: 1
            }
        );
        let md = render_claim_map(&r);
        assert!(
            md.contains("**needs evidence**")
                && md.contains("attributed")
                && md.contains("supported")
        );
        assert!(md.find("needs evidence").unwrap() < md.find("| attributed |").unwrap());
    }

    // ---- ledger mode ----
    fn ledger() -> Ledger {
        Ledger::parse(
            r#"{"entries":[{"id":"a.acc","value":0.883,"text":"88.3%","unit":"x"},
                {"id":"old","value":1,"superseded_by":"a.acc"},{"id":"nul","value":2,"superseded_by":null}]}"#,
        )
        .unwrap()
    }

    #[test]
    fn macro_uses_with_and_without_format() {
        let u = macro_uses(
            r"\ledger[pct]{a.acc} then \ledger{ b } not \ledgerx{c} nor \newcommand{\ledger}[2]{}",
            "ledger",
        );
        assert_eq!(
            u.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            ["a.acc", "b"]
        );
        assert_eq!(u[0].fmt.as_deref(), Some("pct"));
    }

    #[test]
    fn unknown_and_superseded_ids_are_errors() {
        let p = Paper::from_text("p.tex", "\\begin{document}\nWe reach \\ledger[pct]{a.acc}, \\ledger{old}, \\ledger{ghost}, \\ledger{nul}.\n\\end{document}\n");
        let r = check_against_ledger(&p, &ledger(), "ledger");
        assert_eq!(r.exit_code(), 2);
        assert_eq!(r.errors.len(), 2);
        assert_eq!(r.errors[0].kind, MacroError::SupersededId);
        assert_eq!(r.errors[0].superseded_by.as_deref(), Some("a.acc"));
        assert_eq!(r.errors[1].kind, MacroError::UnknownId);
        assert_eq!((r.summary.macro_uses, r.summary.distinct_ids), (4, 4));
        assert_eq!((r.errors[0].file.as_str(), r.errors[0].line), ("p.tex", 2));
    }

    #[test]
    fn hand_typed_numbers_are_classified_by_attribution() {
        let tex = "\\begin{document}\n\\section{Results}\nWe reach 87.4\\% accuracy \\ledger{a.acc}.\n\nGG reports 28.6\\% growth \\citep{g}. Id \\ledger{a.acc} is fine.\n\\end{document}\n";
        let p = Paper::from_text("p.tex", tex);
        let r = check_against_ledger(&p, &ledger(), "ledger");
        assert_eq!(
            r.needs_evidence
                .iter()
                .map(|n| n.value.as_str())
                .collect::<Vec<_>>(),
            ["87.4"]
        );
        assert_eq!(
            r.attributed
                .iter()
                .map(|n| n.value.as_str())
                .collect::<Vec<_>>(),
            ["28.6"]
        );
        assert_eq!(
            (r.needs_evidence[0].file.as_str(), r.needs_evidence[0].line),
            ("p.tex", 3)
        );
        assert_eq!(r.needs_evidence[0].section, "Results");
        assert!(r.needs_evidence[0].sentence.contains("We reach 87.4"));
        assert_eq!(r.exit_code(), 1);
    }

    #[test]
    fn non_prose_regions_are_not_scanned() {
        let tex = r#"\documentclass{article}
\newcommand{\gap}{0.75}
\usepackage[margin=2.4cm]{geometry}
\definecolor{teal0}{RGB}{0,110,110}
\begin{document}
\includegraphics[width=0.85\linewidth]{figures/fig-2.3.pdf}
Math $x = 0.25$ and \(y=0.5\) and \[ z = 0.75 \] and
\begin{equation} a = 1.5 \end{equation}
\begin{align*} b &= 2.5 \end{align*}
\begin{verbatim} 3.5 \end{verbatim}
\begin{tikzpicture} \draw (0,0) -- (1.5,2.5); \end{tikzpicture}
See Section 3.2 and Eq.~\eqref{eq:1.5} \cite[p.~4.5]{k} \label{x:6.5} \ref{y:7.5} version 1.2.3 and arXiv:2604.05018.
% a comment with 9.9
Width \hspace{0.5em} \vspace{1.5ex} \setlength{\parskip}{0.5em} ok.
\end{document}"#;
        let r = check_against_ledger(
            &Paper::from_text("p.tex", tex),
            &Ledger { entries: vec![] },
            "ledger",
        );
        assert!(
            r.needs_evidence.is_empty() && r.attributed.is_empty(),
            "{:?} {:?}",
            r.needs_evidence,
            r.attributed
        );
    }

    #[test]
    fn tables_and_prose_decimals_are_flagged() {
        let tex = "\\begin{document}\n\\begin{tabular}{lc}\nOurs & 0.883 \\\\\n\\end{tabular}\nThe gain was 12.5\\% and 2.13$\\times$ faster, with p = 0.03 reported in prose.\n\\end{document}";
        let r = check_against_ledger(
            &Paper::from_text("p.tex", tex),
            &Ledger { entries: vec![] },
            "ledger",
        );
        let v: BTreeSet<&str> = r.needs_evidence.iter().map(|n| n.value.as_str()).collect();
        for want in ["0.883", "12.5", "2.13", "0.03"] {
            assert!(v.contains(want), "{want} missing from {v:?}");
        }
    }

    #[test]
    fn custom_macro_name_and_json_shape() {
        let p = Paper::from_text(
            "p.tex",
            "\\begin{document}\n\\fact{a.acc} \\fact[x]{a.acc}\n\\end{document}",
        );
        let r = check_against_ledger(&p, &ledger(), "fact");
        assert_eq!(
            (r.summary.macro_uses, r.summary.distinct_ids, r.exit_code()),
            (2, 1, 0)
        );
        let j = serde_json::to_value(&r).unwrap();
        assert_eq!(j["macro"], "fact");
        assert_eq!(j["mode"], "ledger");
        assert!(render_ledger_markdown(&r).contains("`\\fact` uses: 2"));
    }

    #[test]
    fn masking_preserves_length_and_lines() {
        let t = "é $x=1.5$ \\cite{k}\n\\begin{equation}\n2.5\n\\end{equation}\nline";
        let m = mask_non_prose(t, "ledger");
        assert_eq!(m.len(), t.len());
        assert_eq!(m.matches('\n').count(), t.matches('\n').count());
        assert!(m.contains("\\cite"));
        assert!(!m.contains("1.5") && !m.contains("2.5"));
    }
}
