//! arXiv preflight: checks a LaTeX source tree against arXiv's submission rules
//! before upload. New in this port; there is no upstream script.
//!
//! Checks (each finding is an `ERROR` or a `WARN`):
//!
//! | Check | Severity |
//! |---|---|
//! | `\pdfoutput=1` within the first five lines of the main file | ERROR |
//! | `.bbl` beside the main file when `\bibliography`/`\addbibresource` is used, and every cited key present as `\bibitem`/`\entry` | ERROR (per missing key) |
//! | no `\write18`, `--shell-escape` hints, `minted`, or absolute paths in `\input`, `\include`, `\includegraphics`, `\bibliography`, `\addbibresource` | ERROR |
//! | every `\includegraphics` target resolves (`.pdf` `.png` `.jpg` `.jpeg` tried) and none is `.eps`/`.ps`/`.tif` | ERROR |
//! | every `\input`/`\include` target exists | ERROR |
//! | abstract (following an `\input` inside it) rendered to plain text within the limit | ERROR |
//! | TeX macros left in the rendered abstract | WARN |
//! | log: undefined references or citations | ERROR |
//! | log: multiply-defined labels | WARN |
//! | log: each `Overfull \hbox` wider than 5 pt | WARN |
//! | log: missing-character warnings | WARN |
//!
//! Exit code: 2 on any ERROR, 1 on WARN only, 0 when clean.
//!
//! Limits worth knowing: overfull boxes are reported with the source line
//! range TeX printed, but not attributed to a file (TeX's log does not make the
//! active file easy to recover reliably); and `\graphicspath` is honoured only
//! for literal directories.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use super::cite::cite_uses;
use super::tex::{matching_brace, strip_comment, Paper};

/// Default arXiv abstract limit in characters.
pub const DEFAULT_ABSTRACT_MAX: usize = 1920;
/// Overfull boxes wider than this many points are reported.
pub const OVERFULL_WARN_PT: f64 = 5.0;

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap_or_else(|e| panic!("static regex {p:?}: {e}"))
}

/// Severity of a finding.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    /// Worth fixing; arXiv will probably still accept the source.
    Warn,
    /// arXiv will reject or mis-build the source.
    Error,
}

/// One finding.
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    /// Severity.
    pub severity: Severity,
    /// Short check identifier, e.g. `pdfoutput`.
    pub check: &'static str,
    /// Explanation.
    pub message: String,
    /// `file:line` when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

/// An overfull `\hbox` read from the log.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Overfull {
    /// Excess width in points.
    pub width_pt: f64,
    /// First source line TeX named, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_start: Option<u32>,
    /// Last source line TeX named, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_end: Option<u32>,
}

/// Inputs to [`run`].
#[derive(Debug, Clone)]
pub struct Options {
    /// Source directory as it will be uploaded.
    pub source: PathBuf,
    /// Main file, relative to `source` (or absolute).
    pub main: PathBuf,
    /// Optional `.log` from a build of this source.
    pub log: Option<PathBuf>,
    /// Abstract limit in characters.
    pub abstract_max: usize,
}

/// The full preflight report.
#[derive(Debug, Serialize)]
pub struct Report {
    /// Source directory.
    pub source: String,
    /// Main file.
    pub main: String,
    /// Log inspected, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
    /// Rendered abstract length, when an abstract was found.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abstract_chars: Option<usize>,
    /// The abstract limit applied.
    pub abstract_max: usize,
    /// Every `Overfull \hbox` in the log.
    pub overfull: Vec<Overfull>,
    /// Findings, errors first.
    pub findings: Vec<Finding>,
    /// Error count.
    pub errors: usize,
    /// Warning count.
    pub warnings: usize,
}

impl Report {
    /// Process exit code: 2 on errors, 1 on warnings only, 0 clean.
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        if self.errors > 0 {
            2
        } else if self.warnings > 0 {
            1
        } else {
            0
        }
    }

    /// Human-readable report.
    #[must_use]
    pub fn render(&self) -> String {
        let mut s = format!("arXiv preflight: {} (source: {})\n", self.main, self.source);
        if let Some(n) = self.abstract_chars {
            s.push_str(&format!(
                "  abstract: {n} / {} characters\n",
                self.abstract_max
            ));
        }
        if self.log.is_some() {
            let wide = self
                .overfull
                .iter()
                .filter(|o| o.width_pt > OVERFULL_WARN_PT)
                .count();
            s.push_str(&format!(
                "  log: {} overfull \\hbox ({wide} wider than {OVERFULL_WARN_PT}pt)\n",
                self.overfull.len()
            ));
        }
        for f in &self.findings {
            let tag = match f.severity {
                Severity::Error => "ERROR",
                Severity::Warn => "WARN ",
            };
            let loc = f
                .location
                .as_deref()
                .map(|l| format!(" ({l})"))
                .unwrap_or_default();
            s.push_str(&format!("  {tag} [{}] {}{loc}\n", f.check, f.message));
        }
        s.push_str(&format!(
            "Summary: {} error(s), {} warning(s) — {}\n",
            self.errors,
            self.warnings,
            match self.exit_code() {
                2 => "NOT READY (exit 2)",
                1 => "ready with warnings (exit 1)",
                _ => "clean (exit 0)",
            }
        ));
        s
    }
}

// ----------------------------------------------------------------- abstract

fn split_math(s: &str) -> Vec<(bool, &str)> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let (mut seg, mut i) = (0, 0);
    while i < b.len() {
        let close = match b[i] {
            b'\\' if matches!(b.get(i + 1), Some(b'(')) => {
                s[i + 2..].find(r"\)").map(|k| (i + 2 + k + 2, 0))
            }
            b'\\' if matches!(b.get(i + 1), Some(b'[')) => {
                s[i + 2..].find(r"\]").map(|k| (i + 2 + k + 2, 0))
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'$' if matches!(b.get(i + 1), Some(b'$')) => {
                s[i + 2..].find("$$").map(|k| (i + 2 + k + 2, 0))
            }
            b'$' => {
                let mut j = i + 1;
                let mut end = None;
                while j < b.len() {
                    match b[j] {
                        b'\\' => j += 1,
                        b'$' => {
                            end = Some((j + 1, 0));
                            break;
                        }
                        _ => {}
                    }
                    j += 1;
                }
                end
            }
            _ => None,
        };
        match close {
            Some((end, _)) => {
                if seg < i {
                    out.push((false, &s[seg..i]));
                }
                out.push((true, &s[i..end]));
                seg = end;
                i = end;
            }
            None => i += 1,
        }
    }
    if seg < b.len() {
        out.push((false, &s[seg..]));
    }
    out
}

const DROPPED: &[&str] = &[
    "cite",
    "citep",
    "citet",
    "citeauthor",
    "citeyear",
    "parencite",
    "textcite",
    "autocite",
    "ref",
    "eqref",
    "cref",
    "Cref",
    "autoref",
    "pageref",
    "label",
    "footnote",
    "footnotemark",
    "index",
    "vspace",
    "hspace",
];
const KEEP_QUIETLY: &[&str] = &["url", "path", "nolinkurl"];

fn read_group(s: &str, from: usize) -> Option<(String, usize)> {
    let b = s.as_bytes();
    let mut i = from;
    while b.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    if b.get(i) == Some(&b'{') {
        let e = matching_brace(s, i)?;
        return Some((s[i + 1..e].to_string(), e + 1));
    }
    None
}

fn skip_optional(s: &str, mut i: usize) -> usize {
    loop {
        let b = s.as_bytes();
        let mut j = i;
        while b.get(j).is_some_and(u8::is_ascii_whitespace) {
            j += 1;
        }
        if b.get(j) == Some(&b'[') {
            if let Some(k) = s[j..].find(']') {
                i = j + k + 1;
                continue;
            }
        }
        return i;
    }
}

fn render_text(s: &str, macros: &mut BTreeSet<String>) -> String {
    let mut out = String::new();
    let mut chars = s.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => {
                let rest = &s[i + 1..];
                let Some(n) = rest.chars().next() else { break };
                if n.is_ascii_alphabetic() {
                    let name: String = rest.chars().take_while(char::is_ascii_alphabetic).collect();
                    let mut end = i + 1 + name.len();
                    if s.as_bytes().get(end) == Some(&b'*') {
                        end += 1;
                    }
                    let quiet = KEEP_QUIETLY.contains(&name.as_str());
                    if !quiet {
                        macros.insert(format!("\\{name}"));
                    }
                    let after_opt = skip_optional(s, end);
                    if DROPPED.contains(&name.as_str()) {
                        end = read_group(s, after_opt).map_or(end, |(_, e)| e);
                    } else if name == "href" {
                        end = match read_group(s, after_opt) {
                            Some((_, e1)) => match read_group(s, e1) {
                                Some((text, e2)) => {
                                    out.push_str(&render_text(&text, macros));
                                    e2
                                }
                                None => e1,
                            },
                            None => end,
                        };
                    } else if let Some((arg, e)) = read_group(s, after_opt) {
                        out.push_str(&render_text(&arg, macros));
                        end = e;
                    }
                    while chars.peek().is_some_and(|(j, _)| *j < end) {
                        chars.next();
                    }
                } else {
                    match n {
                        '%' | '&' | '_' | '#' | '$' | '{' | '}' => out.push(n),
                        '\\' | ' ' | ',' | ';' | ':' | '!' | '/' | '@' => out.push(' '),
                        other => {
                            macros.insert(format!("\\{other}"));
                        }
                    }
                    chars.next();
                }
            }
            '{' | '}' => {}
            '~' => out.push(' '),
            _ => out.push(c),
        }
    }
    out
}

/// Renders abstract source to the plain text arXiv's metadata field would hold
/// and lists the distinct TeX macros that needed rewriting.
///
/// Maths (`$...$`, `\(...\)`, `\[...\]`) is kept verbatim because the metadata
/// field accepts TeX there. Formatting macros (`\emph`, `\textbf`...) keep
/// their argument; citations, references and labels vanish; every macro seen
/// outside maths is listed, since the metadata field would show it literally.
///
/// ```
/// use skill_tools::paper_orchestra::preflight::render_abstract;
/// let (text, macros) = render_abstract(r"We \emph{show} 5\% gains~\cite{a} with $\alpha$.");
/// assert_eq!(text, "We show 5% gains with $\\alpha$.");
/// assert_eq!(macros, ["\\cite", "\\emph"]);
/// ```
#[must_use]
pub fn render_abstract(src: &str) -> (String, Vec<String>) {
    let mut macros = BTreeSet::new();
    let mut out = String::new();
    for (is_math, seg) in split_math(src) {
        if is_math {
            out.push_str(seg);
        } else {
            out.push_str(&render_text(seg, &mut macros));
        }
    }
    static PARA: LazyLock<Regex> = LazyLock::new(|| re(r"\n[ \t]*\n\s*"));
    static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"[ \t\r\n]+"));
    let paras: Vec<String> = PARA
        .split(out.trim())
        .map(|p| SPACES.replace_all(p.trim(), " ").into_owned())
        .filter(|p| !p.is_empty())
        .collect();
    (paras.join("\n\n"), macros.into_iter().collect())
}

// ---------------------------------------------------------------- bbl, log

/// Keys defined in a `.bbl` file: `\bibitem[label]{key}` and `\entry{key}{type}`.
#[must_use]
pub fn bbl_keys(bbl: &str) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    let b = bbl.as_bytes();
    for (i, _) in bbl.match_indices(r"\bibitem") {
        let mut j = i + r"\bibitem".len();
        while b.get(j).is_some_and(u8::is_ascii_whitespace) {
            j += 1;
        }
        if b.get(j) == Some(&b'[') {
            let mut depth = 0i32;
            while j < b.len() {
                match b[j] {
                    b'\\' => j += 1,
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    b']' if depth <= 0 => break,
                    _ => {}
                }
                j += 1;
            }
            j += 1;
        }
        if let Some((k, _)) = read_group(bbl, j) {
            keys.insert(k.trim().to_string());
        }
    }
    static ENTRY: LazyLock<Regex> = LazyLock::new(|| re(r"\\entry\{([^}]+)\}\s*\{"));
    for m in ENTRY.captures_iter(bbl) {
        keys.insert(m[1].trim().to_string());
    }
    keys
}

/// Undoes TeX's hard wrapping: a line exactly 79 characters long continues on
/// the next line.
#[must_use]
pub fn unwrap_log(log: &str) -> String {
    let mut out = String::with_capacity(log.len());
    let mut lines = log.lines().peekable();
    while let Some(line) = lines.next() {
        out.push_str(line);
        if line.chars().count() == 79 && lines.peek().is_some() {
            continue;
        }
        out.push('\n');
    }
    out
}

/// Every `Overfull \hbox` in an (unwrapped) log.
#[must_use]
pub fn overfull_boxes(log: &str) -> Vec<Overfull> {
    static OVER: LazyLock<Regex> =
        LazyLock::new(|| re(r"Overfull \\hbox \(([0-9.]+)pt too wide\)([^\n]*)"));
    static RANGE: LazyLock<Regex> = LazyLock::new(|| re(r"lines? (\d+)(?:--(\d+))?"));
    OVER.captures_iter(log)
        .filter_map(|m| {
            let width_pt = m[1].parse::<f64>().ok()?;
            let (mut a, mut b) = (None, None);
            if let Some(r) = RANGE.captures(&m[2]) {
                a = r[1].parse().ok();
                b = r.get(2).and_then(|x| x.as_str().parse().ok()).or(a);
            }
            Some(Overfull {
                width_pt,
                line_start: a,
                line_end: b,
            })
        })
        .collect()
}

// -------------------------------------------------------------------- run

struct Collector {
    findings: Vec<Finding>,
}

impl Collector {
    fn add(
        &mut self,
        severity: Severity,
        check: &'static str,
        message: String,
        location: Option<String>,
    ) {
        self.findings.push(Finding {
            severity,
            check,
            message,
            location,
        });
    }
}

fn is_absolute_path(p: &str) -> bool {
    let p = p.trim();
    p.starts_with('/')
        || p.starts_with('~')
        || p.starts_with("file:")
        || p.starts_with("\\\\")
        || p.as_bytes().get(1) == Some(&b':')
            && p.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
}

const OK_FIG_EXT: [&str; 4] = ["pdf", "png", "jpg", "jpeg"];
const BAD_FIG_EXT: [&str; 4] = ["eps", "ps", "tif", "tiff"];
const UNSUPPORTED_FIG_EXT: [&str; 4] = ["svg", "gif", "bmp", "webp"];

fn graphics_dirs(text: &str, main_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![main_dir.to_path_buf()];
    static GP: LazyLock<Regex> = LazyLock::new(|| re(r"\\graphicspath\s*\{"));
    for m in GP.find_iter(text) {
        let open = m.end() - 1;
        let Some(close) = matching_brace(text, open) else {
            continue;
        };
        let inner = &text[open + 1..close];
        let mut i = 0;
        while let Some(rel) = inner[i..].find('{') {
            let o = i + rel;
            let Some(c) = matching_brace(inner, o) else {
                break;
            };
            let d = inner[o + 1..c].trim();
            if !d.is_empty() && !d.contains('\\') && !is_absolute_path(d) {
                dirs.push(main_dir.join(d));
            }
            i = c + 1;
        }
    }
    dirs
}

/// Runs every check.
///
/// # Errors
///
/// A message when the main file or the log cannot be read; everything else is
/// reported as findings.
pub fn run(opts: &Options) -> Result<Report, String> {
    let main = if opts.main.is_absolute() {
        opts.main.clone()
    } else {
        opts.source.join(&opts.main)
    };
    if !main.is_file() {
        return Err(format!("main file not found: {}", main.display()));
    }
    let paper = Paper::load_main(&main).map_err(|e| e.to_string())?;
    let main_dir = main
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let text = paper.text();
    let mut c = Collector {
        findings: Vec::new(),
    };

    for m in &paper.missing {
        c.add(
            Severity::Error,
            "input-missing",
            format!("\\input/\\include target not found: {m}"),
            None,
        );
    }

    // 1. \pdfoutput=1 in the first five lines of the main file.
    static PDFOUT: LazyLock<Regex> = LazyLock::new(|| re(r"\\pdfoutput\s*=\s*1\b"));
    let head_ok = std::fs::read(&main)
        .map(|b| {
            String::from_utf8_lossy(&b)
                .lines()
                .take(5)
                .any(|l| PDFOUT.is_match(strip_comment(l)))
        })
        .unwrap_or(false);
    if !head_ok {
        c.add(
            Severity::Error,
            "pdfoutput",
            "\\pdfoutput=1 is not within the first five lines of the main file; arXiv may build with the wrong engine".into(),
            Some(format!("{}:1", main.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned()))),
        );
    }

    // 2. .bbl beside the main file and every cited key in it.
    static BIBUSE: LazyLock<Regex> =
        LazyLock::new(|| re(r"\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{"));
    if BIBUSE.is_match(text) {
        let bbl = main.with_extension("bbl");
        let bbl_name = bbl
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        match std::fs::read(&bbl) {
            Err(_) => c.add(
                Severity::Error,
                "bbl-missing",
                format!("{bbl_name} not found beside the main file; arXiv does not run BibTeX/biber, upload the generated .bbl"),
                None,
            ),
            Ok(bytes) => {
                let have = bbl_keys(&String::from_utf8_lossy(&bytes));
                let mut reported = BTreeSet::new();
                for u in cite_uses(text) {
                    if !have.contains(&u.key) && reported.insert(u.key.clone()) {
                        c.add(
                            Severity::Error,
                            "bbl-key-missing",
                            format!("cited key `{}` has no \\bibitem/\\entry in {bbl_name}", u.key),
                            Some(paper.locate_display(u.offset)),
                        );
                    }
                }
            }
        }
    }

    // 3. Forbidden constructs.
    static W18: LazyLock<Regex> = LazyLock::new(|| re(r"\\write\s*18\b"));
    for m in W18.find_iter(text) {
        c.add(
            Severity::Error,
            "write18",
            "\\write18 shell escape is not permitted".into(),
            Some(paper.locate_display(m.start())),
        );
    }
    // Scan comments too (arXiv publishes them). `raw_text()` has one line per `paper.lines` entry.
    for l in &paper.lines {
        let line = if l.raw.is_empty() { &l.code } else { &l.raw };
        if line.contains("shell-escape") || line.contains("shell_escape") {
            c.add(
                Severity::Error,
                "shell-escape",
                "hint of --shell-escape in the source (comments included; arXiv publishes them)"
                    .into(),
                Some(paper.display_loc(l.file, l.number)),
            );
            break;
        }
    }
    for rc in ["latexmkrc", ".latexmkrc"] {
        for dir in [&opts.source, &main_dir] {
            if std::fs::read_to_string(dir.join(rc))
                .is_ok_and(|t| t.contains("shell-escape") || t.contains("shell_escape"))
            {
                c.add(
                    Severity::Error,
                    "shell-escape",
                    format!("{rc} enables shell escape"),
                    Some(rc.to_string()),
                );
            }
        }
    }
    static MINTED: LazyLock<Regex> = LazyLock::new(|| {
        re(
            r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bminted\b[^}]*\}|\\begin\{minted\}|\\inputminted",
        )
    });
    for m in MINTED.find_iter(text) {
        c.add(
            Severity::Error,
            "minted",
            "`minted` needs --shell-escape and is not supported by arXiv".into(),
            Some(paper.locate_display(m.start())),
        );
    }
    for inc in &paper.includes {
        if is_absolute_path(&inc.name) {
            c.add(
                Severity::Error,
                "absolute-path",
                format!("absolute path in \\input/\\include: {}", inc.name),
                Some(paper.display_loc(inc.file, inc.number)),
            );
        }
    }
    static PATHCMD: LazyLock<Regex> = LazyLock::new(|| {
        re(
            r"\\(includegraphics|bibliography|addbibresource|lstinputlisting)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}",
        )
    });
    for m in PATHCMD.captures_iter(text) {
        let pieces: Vec<&str> = if &m[1] == "bibliography" || &m[1] == "addbibresource" {
            m[2].split(',').collect()
        } else {
            vec![&m[2]]
        };
        for p in pieces {
            if is_absolute_path(p) {
                c.add(
                    Severity::Error,
                    "absolute-path",
                    format!("absolute path in \\{}: {}", &m[1], p.trim()),
                    Some(paper.locate_display(m.get(0).map_or(0, |w| w.start()))),
                );
            }
        }
    }

    // 4. Figures.
    let dirs = graphics_dirs(text, &main_dir);
    let mut seen_figs = BTreeSet::new();
    static IG: LazyLock<Regex> =
        LazyLock::new(|| re(r"\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}"));
    for m in IG.captures_iter(text) {
        let p = m[1].trim().to_string();
        if p.is_empty() || p.contains('#') || !seen_figs.insert(p.clone()) {
            continue;
        }
        let loc = Some(paper.locate_display(m.get(0).map_or(0, |w| w.start())));
        if p.contains('\\') {
            c.add(
                Severity::Warn,
                "figure-unchecked",
                format!("figure path uses a macro and was not checked: {p}"),
                loc,
            );
            continue;
        }
        if is_absolute_path(&p) {
            continue; // reported by the absolute-path check
        }
        let ext = Path::new(&p)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .unwrap_or_default();
        if BAD_FIG_EXT.contains(&ext.as_str()) {
            c.add(
                Severity::Error,
                "figure-format",
                format!("{p}: .{ext} figures are not accepted; convert to PDF, PNG or JPEG"),
                loc,
            );
            continue;
        }
        if UNSUPPORTED_FIG_EXT.contains(&ext.as_str()) {
            c.add(
                Severity::Error,
                "figure-format",
                format!(
                    "{p}: .{ext} is not a pdfLaTeX graphics format; convert to PDF, PNG or JPEG"
                ),
                loc,
            );
            continue;
        }
        let cands: Vec<String> = if OK_FIG_EXT.contains(&ext.as_str()) {
            vec![p.clone()]
        } else {
            OK_FIG_EXT.iter().map(|e| format!("{p}.{e}")).collect()
        };
        let found = dirs
            .iter()
            .any(|d| cands.iter().any(|cand| d.join(cand).is_file()));
        if !found {
            c.add(
                Severity::Error,
                "figure-missing",
                format!("figure not found: {p} (tried {})", cands.join(", ")),
                loc,
            );
        }
    }

    // 5. Abstract.
    let mut abstract_chars = None;
    static ABS: LazyLock<Regex> =
        LazyLock::new(|| re(r"(?s)\\begin\{abstract\}(.*?)\\end\{abstract\}"));
    match ABS.captures(text) {
        None => c.add(
            Severity::Warn,
            "abstract",
            "no `abstract` environment found; arXiv's metadata abstract must be entered by hand"
                .into(),
            None,
        ),
        Some(m) => {
            let (plain, macros) = render_abstract(&m[1]);
            let n = plain.chars().count();
            abstract_chars = Some(n);
            let loc = Some(paper.locate_display(m.get(0).map_or(0, |w| w.start())));
            if n > opts.abstract_max {
                c.add(
                    Severity::Error,
                    "abstract-length",
                    format!(
                        "abstract is {n} characters; arXiv's limit is {} ({} over)",
                        opts.abstract_max,
                        n - opts.abstract_max
                    ),
                    loc.clone(),
                );
            }
            if !macros.is_empty() {
                c.add(
                    Severity::Warn,
                    "abstract-macros",
                    format!(
                        "TeX macros in the abstract that arXiv's plain-text metadata field would need rewritten: {}",
                        macros.join(" ")
                    ),
                    loc,
                );
            }
        }
    }

    // 6. Log.
    let mut overfull = Vec::new();
    if let Some(log_path) = &opts.log {
        let bytes = std::fs::read(log_path)
            .map_err(|e| format!("cannot read log {}: {e}", log_path.display()))?;
        let log = unwrap_log(&String::from_utf8_lossy(&bytes));
        static UNDEF: LazyLock<Regex> = LazyLock::new(|| {
            re(
                r"(Reference|Citation) [`'‘]([^'’]+)['’](?: on page [^\s]+)? undefined(?: on input line (\d+))?",
            )
        });
        let mut seen = BTreeSet::new();
        for m in UNDEF.captures_iter(&log) {
            if seen.insert((m[1].to_string(), m[2].to_string())) {
                c.add(
                    Severity::Error,
                    "undefined-ref",
                    format!("undefined {} `{}`", m[1].to_lowercase(), &m[2]),
                    m.get(3).map(|l| format!("log: input line {}", l.as_str())),
                );
            }
        }
        static MULTI: LazyLock<Regex> =
            LazyLock::new(|| re(r"Label [`'‘]([^'’]+)['’] multiply defined"));
        let labels: BTreeSet<String> = MULTI
            .captures_iter(&log)
            .map(|m| m[1].to_string())
            .collect();
        for l in labels {
            c.add(
                Severity::Warn,
                "multiply-defined-label",
                format!("label `{l}` is multiply defined"),
                None,
            );
        }
        overfull = overfull_boxes(&log);
        for o in overfull.iter().filter(|o| o.width_pt > OVERFULL_WARN_PT) {
            let at = match (o.line_start, o.line_end) {
                (Some(a), Some(b)) if a != b => {
                    format!("source lines {a}--{b} of the file TeX was reading")
                }
                (Some(a), _) => format!("source line {a} of the file TeX was reading"),
                _ => "no source line in the log".to_string(),
            };
            c.add(
                Severity::Warn,
                "overfull-hbox",
                format!("Overfull \\hbox {:.2}pt too wide, {at}", o.width_pt),
                None,
            );
        }
        static MISSING: LazyLock<Regex> =
            LazyLock::new(|| re(r"Missing character: There is no (.+?) in font ([^!\n]+?)!"));
        let mut counts: BTreeMap<(String, String), usize> = BTreeMap::new();
        for m in MISSING.captures_iter(&log) {
            *counts
                .entry((m[1].to_string(), m[2].trim().to_string()))
                .or_default() += 1;
        }
        for ((ch, font), n) in counts {
            let mut it = ch.chars();
            let shown = match (it.next(), it.next()) {
                (Some(x), None) => format!("U+{:04X} `{x}`", u32::from(x)),
                _ => format!("`{ch}`"),
            };
            c.add(
                Severity::Warn,
                "missing-character",
                format!("no glyph for {shown} in font {font} ({n}×)"),
                None,
            );
        }
    }

    let mut findings = c.findings;
    findings.sort_by_key(|f| std::cmp::Reverse(f.severity));
    let errors = findings
        .iter()
        .filter(|f| f.severity == Severity::Error)
        .count();
    let warnings = findings.len() - errors;
    Ok(Report {
        source: opts.source.display().to_string(),
        main: main
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
        log: opts.log.as_ref().map(|p| p.display().to_string()),
        abstract_chars,
        abstract_max: opts.abstract_max,
        overfull,
        findings,
        errors,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, body: &str) {
        let p = dir.join(name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    const GOOD_MAIN: &str = "% header\n\\pdfoutput=1\n\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\begin{abstract}\nShort abstract.\n\\end{abstract}\nText \\cite{a,b}.\n\\includegraphics{fig/one}\n\\bibliography{refs}\n\\end{document}\n";
    const GOOD_BBL: &str = "\\begin{thebibliography}{2}\n\\bibitem[Smith et~al.(2020)Smith, Jones,\n  and Lee]{a}\nX.\n\\bibitem[{Roe(2021)}]{b}\nY.\n\\end{thebibliography}\n";

    fn good_tree() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "main.tex", GOOD_MAIN);
        write(d.path(), "main.bbl", GOOD_BBL);
        write(d.path(), "fig/one.pdf", "%PDF");
        d
    }

    fn opts(d: &Path) -> Options {
        Options {
            source: d.to_path_buf(),
            main: "main.tex".into(),
            log: None,
            abstract_max: DEFAULT_ABSTRACT_MAX,
        }
    }

    fn checks(r: &Report) -> Vec<&'static str> {
        r.findings.iter().map(|f| f.check).collect()
    }

    #[test]
    fn clean_tree_exits_zero() {
        let d = good_tree();
        let r = run(&opts(d.path())).unwrap();
        assert_eq!(r.exit_code(), 0, "{}", r.render());
        assert_eq!(r.abstract_chars, Some("Short abstract.".len()));
    }

    #[test]
    fn missing_pdfoutput_bbl_and_figure_are_errors() {
        let d = good_tree();
        write(
            d.path(),
            "main.tex",
            &GOOD_MAIN.replace("\\pdfoutput=1\n", "\n\n\n\n\n\\pdfoutput=1\n"),
        );
        std::fs::remove_file(d.path().join("main.bbl")).unwrap();
        std::fs::remove_file(d.path().join("fig/one.pdf")).unwrap();
        let r = run(&opts(d.path())).unwrap();
        assert_eq!(r.exit_code(), 2);
        for want in ["pdfoutput", "bbl-missing", "figure-missing"] {
            assert!(checks(&r).contains(&want), "{want} in {:?}", checks(&r));
        }
    }

    #[test]
    fn uncited_bbl_keys_are_reported_per_key() {
        let d = good_tree();
        write(d.path(), "main.bbl", "\\bibitem[x]{a}\nA.\n");
        let r = run(&opts(d.path())).unwrap();
        let missing: Vec<_> = r
            .findings
            .iter()
            .filter(|f| f.check == "bbl-key-missing")
            .collect();
        assert_eq!(missing.len(), 1);
        assert!(missing[0].message.contains("`b`"));
        assert_eq!(missing[0].location.as_deref(), Some("main.tex:9"));
    }

    #[test]
    fn forbidden_constructs_and_absolute_paths() {
        let d = good_tree();
        let body = GOOD_MAIN.replace(
            "\\begin{document}",
            "\\usepackage{minted}\n\\immediate\\write18{ls}\n\\begin{document}\n\\includegraphics{/abs/fig.pdf}\n\\input{/etc/x}",
        );
        write(
            d.path(),
            "main.tex",
            &(body + "% run with --shell-escape\n"),
        );
        let r = run(&opts(d.path())).unwrap();
        for want in ["minted", "write18", "shell-escape", "absolute-path"] {
            assert!(checks(&r).contains(&want), "{want} in {:?}", checks(&r));
        }
        assert!(
            r.findings
                .iter()
                .filter(|f| f.check == "absolute-path")
                .count()
                >= 2
        );
    }

    #[test]
    fn eps_figures_and_graphicspath_resolution() {
        let d = good_tree();
        write(
            d.path(),
            "main.tex",
            &GOOD_MAIN.replace(
                "\\includegraphics{fig/one}",
                "\\graphicspath{{img/}}\n\\includegraphics{pic}\n\\includegraphics{old.eps}",
            ),
        );
        write(d.path(), "img/pic.png", "x");
        let r = run(&opts(d.path())).unwrap();
        assert!(checks(&r).contains(&"figure-format"));
        assert!(!checks(&r).contains(&"figure-missing"), "{}", r.render());
    }

    #[test]
    fn abstract_is_followed_through_input_and_length_checked() {
        let d = good_tree();
        let main = GOOD_MAIN.replace("Short abstract.", "\\input{abs}");
        write(d.path(), "main.tex", &main);
        write(d.path(), "abs.tex", &"word ".repeat(500));
        let r = run(&opts(d.path())).unwrap();
        assert!(checks(&r).contains(&"abstract-length"), "{}", r.render());
        assert!(r.abstract_chars.unwrap() > 1920);
    }

    #[test]
    fn abstract_macros_warn_and_math_is_kept() {
        let (t, m) = render_abstract(
            "A \\textbf{bold} claim of 5\\% on $\\alpha$-bounds \\ledger[pct]{x.y}.",
        );
        assert_eq!(t, "A bold claim of 5% on $\\alpha$-bounds x.y.");
        assert_eq!(m, ["\\ledger", "\\textbf"]);
        let d = good_tree();
        write(
            d.path(),
            "main.tex",
            &GOOD_MAIN.replace("Short abstract.", "An \\emph{odd} one."),
        );
        let r = run(&opts(d.path())).unwrap();
        assert_eq!(r.exit_code(), 1);
        assert!(checks(&r).contains(&"abstract-macros"));
    }

    #[test]
    fn bbl_parser_handles_multiline_labels_and_biblatex() {
        let k = bbl_keys("\\bibitem[A et~al.(2019)A, B,\n and C]{one}\n\\bibitem{two}\n\\entry{three}{article}{}\n\\bibitem[{N(2020)}]{four}");
        assert_eq!(
            k.into_iter().collect::<Vec<_>>(),
            ["four", "one", "three", "two"]
        );
    }

    #[test]
    fn log_findings() {
        let d = good_tree();
        let full = "LaTeX Warning: Reference `fig:a-very-long-label-name-that-wraps-around' on page 3 undefined on input line 12.";
        let wrapped_ref: String = full.chars().take(79).collect();
        let rest: String = full.chars().skip(79).collect();
        let log = format!(
            "{wrapped_ref}\n{rest}\n\
             LaTeX Warning: Citation `ghost' on page 1 undefined on input line 30.\n\
             LaTeX Warning: Label `dup' multiply defined.\n\
             Overfull \\hbox (0.61pt too wide) in paragraph at lines 5--6\n\
             Overfull \\hbox (40.08pt too wide) in paragraph at lines 112--118\n\
             Missing character: There is no ĉ in font cmr10!\n\
             Missing character: There is no ĉ in font cmr10!\n"
        );
        write(d.path(), "main.log", &log);
        let mut o = opts(d.path());
        o.log = Some(d.path().join("main.log"));
        let r = run(&o).unwrap();
        assert_eq!(r.exit_code(), 2);
        let msgs: Vec<_> = r.findings.iter().map(|f| f.message.clone()).collect();
        assert!(
            msgs.iter()
                .any(|m| m.contains("reference `fig:a-very-long-label-name-that-wraps-around`")),
            "{msgs:?}"
        );
        assert!(msgs.iter().any(|m| m.contains("citation `ghost`")));
        assert!(msgs.iter().any(|m| m.contains("`dup`")));
        assert!(msgs
            .iter()
            .any(|m| m.contains("40.08pt") && m.contains("112--118")));
        assert!(!msgs.iter().any(|m| m.contains("0.61pt")));
        assert!(msgs
            .iter()
            .any(|m| m.contains("U+0109") && m.contains("2×")));
        assert_eq!(r.overfull.len(), 2);
        assert!(r.render().contains("2 overfull \\hbox (1 wider than 5pt)"));
    }

    #[test]
    fn missing_input_and_main_errors() {
        let d = good_tree();
        write(
            d.path(),
            "main.tex",
            &GOOD_MAIN.replace("Text", "\\input{nowhere} Text"),
        );
        assert!(checks(&run(&opts(d.path())).unwrap()).contains(&"input-missing"));
        let mut o = opts(d.path());
        o.main = "absent.tex".into();
        assert!(run(&o).is_err());
    }
}
