//! Shared LaTeX source loading.
//!
//! Every subcommand that takes a paper accepts either a single `.tex` file or a
//! directory. [`Paper::load`] resolves the main file, follows `\input{}` and
//! `\include{}` relative to the main file's directory (the working directory
//! TeX itself would use, with the including file's directory as a fallback),
//! strips real comments (a `%` preceded by an even number of backslashes) and
//! keeps a line table so any byte offset in the flattened text maps back to a
//! `file:line` pair.
//!
//! Comments are removed *before* includes are followed, so a commented-out
//! `\input` is ignored. The unstripped text stays available through
//! [`Paper::raw_text`] for gates that must see comments (anti-leakage and
//! shell-escape hints: arXiv publishes comments verbatim).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use thiserror::Error;

/// Errors raised while locating or reading LaTeX sources.
#[derive(Debug, Error)]
pub enum TexError {
    /// A file or directory could not be read.
    #[error("cannot read {path}: {source}")]
    Io {
        /// Path that failed.
        path: PathBuf,
        /// Underlying I/O error.
        #[source]
        source: std::io::Error,
    },
    /// The path does not exist.
    #[error("not found: {0}")]
    NotFound(PathBuf),
    /// A directory holds no `.tex` file with `\documentclass`.
    #[error("no main .tex file (one containing \\documentclass) found in {0}")]
    NoMain(PathBuf),
    /// A directory holds several candidate main files and none is named
    /// `main.tex` or `paper.tex`.
    #[error("several candidate main files in {dir}: {candidates}; pass the file itself")]
    AmbiguousMain {
        /// Directory searched.
        dir: PathBuf,
        /// Comma-separated candidate file names.
        candidates: String,
    },
}

/// One physical line of the expanded paper.
#[derive(Debug, Clone)]
pub struct SrcLine {
    /// Index into [`Paper::files`].
    pub file: usize,
    /// One-based line number within that file.
    pub number: usize,
    /// The line as written, comments included.
    pub raw: String,
    /// The line with its comment removed and any `\input`/`\include` command
    /// replaced by a line break (the included lines follow this one).
    pub code: String,
}

/// An `\input`/`\include` command as written, whether or not it resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncludeRef {
    /// The argument, trimmed.
    pub name: String,
    /// Index into [`Paper::files`] of the including file.
    pub file: usize,
    /// One-based line of the command.
    pub number: usize,
}

/// A LaTeX paper flattened across its `\input`/`\include` tree.
#[derive(Debug, Clone)]
pub struct Paper {
    /// The main file.
    pub main: PathBuf,
    /// Every file read, main first, in first-visit order.
    pub files: Vec<PathBuf>,
    /// Expanded lines in reading order.
    pub lines: Vec<SrcLine>,
    /// `\input`/`\include` targets that could not be found (or were refused:
    /// absolute paths and paths leaving the main file's directory are never read).
    pub missing: Vec<String>,
    /// Every include command met, resolved or not.
    pub includes: Vec<IncludeRef>,
    text: String,
    starts: Vec<usize>,
}

static INCLUDE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\\(?:input|include)\s*\{([^}]*)\}").expect("static include regex")
});

static DOCCLASS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^[^%\n]*\\documentclass").expect("static documentclass regex")
});

const MAX_DEPTH: usize = 32;

/// Returns the part of `line` before its first real comment marker.
///
/// A `%` starts a comment unless it is preceded by an odd number of
/// backslashes (`\%` is a literal percent sign; `\\%` is a line break
/// followed by a comment).
///
/// ```
/// use skill_tools::paper_orchestra::tex::strip_comment;
/// assert_eq!(strip_comment(r"gain of 3\% % note"), r"gain of 3\% ");
/// assert_eq!(strip_comment(r"a \\% comment"), r"a \\");
/// ```
#[must_use]
pub fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut backslashes = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'\\' => backslashes += 1,
            b'%' if backslashes % 2 == 0 => return &line[..i],
            _ => backslashes = 0,
        }
    }
    line
}

/// Removes every real comment from `text`, keeping line structure.
///
/// ```
/// use skill_tools::paper_orchestra::tex::strip_comments;
/// assert_eq!(strip_comments("keep % drop\nnext"), "keep \nnext");
/// ```
#[must_use]
pub fn strip_comments(text: &str) -> String {
    text.lines()
        .map(strip_comment)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Finds the index of the `}` that closes the `{` at byte `open`.
///
/// Escaped braces (`\{`, `\}`) are ignored. Returns `None` when the group is
/// not closed.
///
/// ```
/// use skill_tools::paper_orchestra::tex::matching_brace;
/// let s = r"{a {b} \} c} tail";
/// assert_eq!(matching_brace(s, 0), Some(11));
/// ```
#[must_use]
pub fn matching_brace(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.get(open) != Some(&b'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Truncates to at most `n` characters (never splits a code point).
#[must_use]
pub fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Chooses the main file in `dir`: `main.tex`, else `paper.tex`, else the only
/// `.tex` file (directly inside `dir`) that has an active `\documentclass`.
///
/// # Errors
///
/// [`TexError::NoMain`] or [`TexError::AmbiguousMain`] when no unique choice
/// exists, [`TexError::Io`] when the directory cannot be read.
pub fn find_main(dir: &Path) -> Result<PathBuf, TexError> {
    for name in ["main.tex", "paper.tex"] {
        let p = dir.join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    let rd = std::fs::read_dir(dir).map_err(|source| TexError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let mut found: Vec<PathBuf> = Vec::new();
    for entry in rd.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("tex") && p.is_file() {
            if let Ok(bytes) = std::fs::read(&p) {
                if DOCCLASS_RE.is_match(&String::from_utf8_lossy(&bytes)) {
                    found.push(p);
                }
            }
        }
    }
    found.sort();
    match found.len() {
        0 => Err(TexError::NoMain(dir.to_path_buf())),
        1 => Ok(found.remove(0)),
        _ => Err(TexError::AmbiguousMain {
            dir: dir.to_path_buf(),
            candidates: found
                .iter()
                .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
                .collect::<Vec<_>>()
                .join(", "),
        }),
    }
}

fn resolve_include(name: &str, main_dir: &Path, cur_dir: &Path) -> Option<PathBuf> {
    let name = name.trim();
    if name.is_empty() || Path::new(name).is_absolute() || name.starts_with('~') {
        return None;
    }
    let root = main_dir.canonicalize().ok()?;
    for base in [main_dir, cur_dir] {
        let with_ext = if name.ends_with(".tex") {
            name.to_string()
        } else {
            format!("{name}.tex")
        };
        for cand in [with_ext.as_str(), name] {
            let p = base.join(cand);
            // Never read outside the main file's directory (untrusted sources).
            if p.is_file() && p.canonicalize().is_ok_and(|c| c.starts_with(&root)) {
                return Some(p);
            }
        }
    }
    None
}

impl Paper {
    /// Loads a paper from a single file or from a directory (see [`find_main`]).
    ///
    /// # Errors
    ///
    /// Returns a [`TexError`] when the path is missing, no main file can be
    /// chosen, or the main file cannot be read. Unreadable or missing
    /// *included* files are recorded in [`Paper::missing`] instead.
    pub fn load(path: &Path) -> Result<Self, TexError> {
        if path.is_dir() {
            Self::load_main(&find_main(path)?)
        } else if path.is_file() {
            Self::load_main(path)
        } else {
            Err(TexError::NotFound(path.to_path_buf()))
        }
    }

    /// Loads a paper whose main file is `main`.
    ///
    /// # Errors
    ///
    /// [`TexError::Io`] when `main` cannot be read.
    pub fn load_main(main: &Path) -> Result<Self, TexError> {
        let main_dir = main
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        let mut paper = Paper {
            main: main.to_path_buf(),
            files: Vec::new(),
            lines: Vec::new(),
            missing: Vec::new(),
            includes: Vec::new(),
            text: String::new(),
            starts: Vec::new(),
        };
        let mut stack: Vec<PathBuf> = Vec::new();
        paper.expand(main, &main_dir, &mut stack, true)?;
        paper.finish();
        Ok(paper)
    }

    /// Builds a paper from in-memory text (no includes followed). Intended for
    /// tests and for callers that already hold the source.
    #[must_use]
    pub fn from_text(name: &str, text: &str) -> Self {
        let mut paper = Paper {
            main: PathBuf::from(name),
            files: vec![PathBuf::from(name)],
            lines: Vec::new(),
            missing: Vec::new(),
            includes: Vec::new(),
            text: String::new(),
            starts: Vec::new(),
        };
        for (i, raw) in text.lines().enumerate() {
            paper.lines.push(SrcLine {
                file: 0,
                number: i + 1,
                raw: raw.to_string(),
                code: strip_comment(raw).to_string(),
            });
        }
        paper.finish();
        paper
    }

    fn expand(
        &mut self,
        file: &Path,
        main_dir: &Path,
        stack: &mut Vec<PathBuf>,
        is_main: bool,
    ) -> Result<(), TexError> {
        let canon = file.canonicalize().unwrap_or_else(|_| file.to_path_buf());
        if stack.contains(&canon) || stack.len() >= MAX_DEPTH {
            self.missing
                .push(format!("{} (include cycle or depth limit)", file.display()));
            return Ok(());
        }
        let bytes = match std::fs::read(file) {
            Ok(b) => b,
            Err(source) if is_main => {
                return Err(TexError::Io {
                    path: file.to_path_buf(),
                    source,
                })
            }
            Err(_) => {
                self.missing.push(file.display().to_string());
                return Ok(());
            }
        };
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let idx = self.files.len();
        self.files.push(file.to_path_buf());
        let cur_dir = file
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        stack.push(canon);
        for (i, raw) in text.lines().enumerate() {
            let number = i + 1;
            let code = strip_comment(raw);
            if !INCLUDE_RE.is_match(code) {
                self.lines.push(SrcLine {
                    file: idx,
                    number,
                    raw: raw.to_string(),
                    code: code.to_string(),
                });
                continue;
            }
            let mut cursor = 0usize;
            let mut first = true;
            for m in INCLUDE_RE.captures_iter(code) {
                let whole = m.get(0).expect("whole match");
                self.lines.push(SrcLine {
                    file: idx,
                    number,
                    raw: if first {
                        raw.to_string()
                    } else {
                        String::new()
                    },
                    code: code[cursor..whole.start()].to_string(),
                });
                first = false;
                cursor = whole.end();
                let name = &m[1];
                self.includes.push(IncludeRef {
                    name: name.trim().to_string(),
                    file: idx,
                    number,
                });
                match resolve_include(name, main_dir, &cur_dir) {
                    Some(p) => {
                        self.expand(&p, main_dir, stack, false)?;
                        // An included file ends a paragraph for outlining purposes.
                        self.lines.push(SrcLine {
                            file: idx,
                            number,
                            raw: String::new(),
                            code: String::new(),
                        });
                    }
                    None => self.missing.push(name.trim().to_string()),
                }
            }
            self.lines.push(SrcLine {
                file: idx,
                number,
                raw: String::new(),
                code: code[cursor..].to_string(),
            });
        }
        stack.pop();
        Ok(())
    }

    fn finish(&mut self) {
        let mut text = String::new();
        let mut starts = Vec::with_capacity(self.lines.len());
        for (i, l) in self.lines.iter().enumerate() {
            if i > 0 {
                text.push('\n');
            }
            starts.push(text.len());
            text.push_str(&l.code);
        }
        self.text = text;
        self.starts = starts;
    }

    /// The expanded, comment-free source.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The expanded source with comments intact (lines produced only by
    /// splitting an include command are empty).
    #[must_use]
    pub fn raw_text(&self) -> String {
        self.lines
            .iter()
            .map(|l| {
                if l.raw.is_empty() {
                    l.code.as_str()
                } else {
                    l.raw.as_str()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Maps a byte offset in [`Paper::text`] to its source file and line.
    #[must_use]
    pub fn locate(&self, offset: usize) -> (&Path, usize) {
        let i = match self.starts.binary_search(&offset) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        match self.lines.get(i) {
            Some(l) => (self.files[l.file].as_path(), l.number),
            None => (self.main.as_path(), 0),
        }
    }

    /// `name:line` for a file index and line number, relative to the main
    /// file's directory where possible.
    #[must_use]
    pub fn display_loc(&self, file: usize, number: usize) -> String {
        let base = self.main.parent().unwrap_or_else(|| Path::new(""));
        let f = &self.files[file];
        format!("{}:{number}", f.strip_prefix(base).unwrap_or(f).display())
    }

    /// Like [`Paper::locate`] but formatted `name:line`, using the path
    /// relative to the main file's directory where possible.
    #[must_use]
    pub fn locate_display(&self, offset: usize) -> String {
        let (file, line) = self.locate(offset);
        let base = self.main.parent().unwrap_or_else(|| Path::new(""));
        let shown = file.strip_prefix(base).unwrap_or(file);
        format!("{}:{line}", shown.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaped_percent_is_not_a_comment() {
        assert_eq!(
            strip_comment(r"92.4\% accuracy % real"),
            r"92.4\% accuracy "
        );
        assert_eq!(strip_comment(r"line \\% comment"), r"line \\");
    }

    #[test]
    fn includes_are_followed_and_commented_ones_ignored() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("main.tex"),
            "\\documentclass{article}\n\\input{sec/a}\n% \\input{sec/ghost}\n\\include{b}\nend\n",
        )
        .unwrap();
        std::fs::create_dir(d.path().join("sec")).unwrap();
        std::fs::write(d.path().join("sec/a.tex"), "alpha % hidden\n").unwrap();
        std::fs::write(d.path().join("b.tex"), "beta\n").unwrap();
        let p = Paper::load(d.path()).unwrap();
        assert!(p.text().contains("alpha"));
        assert!(p.text().contains("beta"));
        assert!(!p.text().contains("hidden"));
        assert!(p.missing.is_empty(), "{:?}", p.missing);
        let off = p.text().find("beta").unwrap();
        assert_eq!(p.locate_display(off), "b.tex:1");
        assert!(p.raw_text().contains("hidden"));
    }

    #[test]
    fn missing_include_is_recorded_and_cycles_terminate() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("main.tex"), "\\input{nope}\n\\input{loop}\n").unwrap();
        std::fs::write(d.path().join("loop.tex"), "\\input{loop}\nx\n").unwrap();
        let p = Paper::load(&d.path().join("main.tex")).unwrap();
        assert!(p.missing.iter().any(|m| m == "nope"));
        assert!(p.missing.iter().any(|m| m.contains("cycle")));
    }

    #[test]
    fn absolute_and_escaping_includes_are_refused() {
        let d = tempfile::tempdir().unwrap();
        let outer = d.path().join("outer.tex");
        std::fs::write(&outer, "SECRET\n").unwrap();
        std::fs::create_dir(d.path().join("src")).unwrap();
        std::fs::write(
            d.path().join("src/main.tex"),
            format!("\\input{{{}}}\n\\input{{../outer}}\nok\n", outer.display()),
        )
        .unwrap();
        let p = Paper::load(&d.path().join("src")).unwrap();
        assert!(!p.text().contains("SECRET"));
        assert_eq!(p.missing.len(), 2);
        assert_eq!(p.includes.len(), 2);
    }

    #[test]
    fn directory_without_main_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(Paper::load(d.path()), Err(TexError::NoMain(_))));
    }

    #[test]
    fn matching_brace_skips_escapes() {
        assert_eq!(matching_brace(r"{a\}b}", 0), Some(5));
        assert_eq!(matching_brace("{open", 0), None);
    }
}
