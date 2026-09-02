//! Deterministic, no-LLM design anti-pattern scanner.
//!
//! Zero network, no rendering, no evaluation: regex and heuristic rules over
//! source, with inline disable comments and text or JSON output. Run as a
//! quality GATE (open-design Phase 6, design-audit Step 1).

pub mod rules;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

use rules::{
    hex_re, hue_of, is_bluish, is_grayish, is_named_family, is_pure_bw, is_purpleish,
    LINE_RULES, OVERUSED_FONTS,
};

/// File extensions scanned by default.
pub const SCAN_EXT: &[&str] = &[
    "css", "scss", "sass", "less", "html", "htm", "jsx", "tsx", "vue", "svelte", "astro",
];

const WALK_SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "vendor",
    "__pycache__",
];

/// How serious a finding is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warn => "warn",
            Severity::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "info" => Some(Severity::Info),
            "warn" => Some(Severity::Warn),
            "error" => Some(Severity::Error),
            _ => None,
        }
    }

    /// The ANSI colour used in the terminal rendering.
    pub fn colour(self) -> &'static str {
        match self {
            Severity::Error => "\x1b[31m",
            Severity::Warn => "\x1b[33m",
            Severity::Info => "\x1b[36m",
        }
    }
}

/// One reported anti-pattern.
#[derive(Debug, Clone)]
pub struct Finding {
    pub rule: String,
    pub severity: Severity,
    /// 1-based; zero for a whole-file finding.
    pub line: usize,
    pub file: String,
    pub snippet: String,
    pub message: String,
}

impl Finding {
    fn new(
        rule: &str,
        severity: Severity,
        line: usize,
        file: &str,
        snippet: &str,
        message: String,
    ) -> Self {
        Self {
            rule: rule.to_string(),
            severity,
            line,
            file: file.to_string(),
            snippet: snippet.trim().chars().take(120).collect(),
            message,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "rule": self.rule,
            "severity": self.severity.as_str(),
            "file": self.file,
            "line": self.line,
            "snippet": self.snippet,
            "message": self.message,
        })
    }
}

// ---------------------------------------------------------------------------
// Disable-comment handling
// ---------------------------------------------------------------------------

fn disable_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)slop-disable(?:-next-line)?\s+([a-z0-9 ,\-]+)")
            .expect("static regex compiles")
    })
}

fn disable_next_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)slop-disable-next-line\s+([a-z0-9 ,\-]+)").expect("static regex compiles")
    })
}

/// Suppressions keyed by line number; `*` means all rules.
pub type DisableMap = Vec<(usize, Vec<String>)>;

fn split_rules(raw: &str) -> Vec<String> {
    let names: Vec<String> = raw
        .split([' ', ','])
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    if names.is_empty() {
        vec!["*".to_string()]
    } else {
        names
    }
}

/// Build the per-line suppression map.
pub fn disabled_map(lines: &[&str]) -> DisableMap {
    let mut same: DisableMap = Vec::new();
    let mut next: DisableMap = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(captures) = disable_next_re().captures(line) {
            next.push((index + 2, split_rules(&captures[1])));
            continue;
        }
        if let Some(captures) = disable_re().captures(line) {
            same.push((index + 1, split_rules(&captures[1])));
        }
    }
    let mut merged = same;
    for (line, names) in next {
        match merged.iter_mut().find(|(existing, _)| *existing == line) {
            Some((_, existing)) => {
                for name in names {
                    if !existing.contains(&name) {
                        existing.push(name);
                    }
                }
            }
            None => merged.push((line, names)),
        }
    }
    merged
}

/// Is `rule` suppressed on `line`?
pub fn is_disabled(map: &DisableMap, line: usize, rule: &str) -> bool {
    map.iter()
        .find(|(number, _)| *number == line)
        .map(|(_, names)| {
            names.iter().any(|name| name == "*" || name == rule)
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Per-file rules
// ---------------------------------------------------------------------------

/// A whole-file finding before suppression: `(rule, severity, line, snippet, message)`.
type FileFinding = (&'static str, Severity, usize, String, String);

/// The 1-based line number a byte offset falls on.
fn line_of(text: &str, offset: usize) -> usize {
    text[..offset].matches('\n').count() + 1
}

fn file_rule_overused_font(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r"(?i)font-family\s*:\s*([^;{}]+)").expect("static regex compiles")
    });
    let mut out = Vec::new();
    let mut seen_named: Vec<String> = Vec::new();
    for captures in pattern.captures_iter(text) {
        let raw = &captures[1];
        let names: Vec<String> = raw
            .split(',')
            .map(|name| name.trim().trim_matches(['\'', '"']).to_lowercase())
            .collect();
        for name in &names {
            if is_named_family(name) && !seen_named.contains(name) {
                seen_named.push(name.clone());
            }
        }
        let first = names.first().cloned().unwrap_or_default();
        if OVERUSED_FONTS.contains(&first.as_str()) {
            let start = captures.get(0).expect("group 0").start();
            out.push((
                "overused-font",
                Severity::Warn,
                line_of(text, start),
                raw.trim().chars().take(80).collect(),
                format!("'{first}' as primary face — the #1 AI tell. Pair with a distinctive display face."),
            ));
        }
    }
    // Single-font: only one non-generic family across the whole file.
    if seen_named.len() == 1 {
        out.push((
            "single-font",
            Severity::Info,
            0,
            seen_named[0].clone(),
            "Only one typeface family — no heading/body contrast. Add a display face.".to_string(),
        ));
    }
    out
}

fn file_rule_pure_bw(text: &str) -> Vec<FileFinding> {
    let mut out = Vec::new();
    for found in hex_re().find_iter(text) {
        if is_pure_bw(found.as_str()) {
            out.push((
                "pure-black-white",
                Severity::Info,
                line_of(text, found.start()),
                found.as_str().to_string(),
                "Pure #000/#fff — tint slightly toward the accent for a designed feel.".to_string(),
            ));
            if out.len() >= 6 {
                break;
            }
        }
    }
    out
}

fn file_rule_purple_blue_gradient(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r"(?i)linear-gradient\(([^)]*)\)").expect("static regex compiles")
    });
    let mut out = Vec::new();
    for found in pattern.find_iter(text) {
        let body = found.as_str();
        let colours: Vec<(u8, u8, u8)> = hex_re()
            .find_iter(body)
            .map(|hex| hue_of(hex.as_str()))
            .collect();
        if colours.iter().copied().any(is_bluish) && colours.iter().copied().any(is_purpleish) {
            out.push((
                "purple-blue-gradient",
                Severity::Warn,
                line_of(text, found.start()),
                body.chars().take(80).collect(),
                "Blue→purple gradient — the canonical AI SaaS hero. Use a flat brand color."
                    .to_string(),
            ));
        }
    }
    out
}

/// A rule block that sets both a coloured background and a grey text colour.
fn file_rule_gray_on_color(text: &str) -> Vec<FileFinding> {
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static BG: OnceLock<Regex> = OnceLock::new();
    static FG: OnceLock<Regex> = OnceLock::new();
    let block_re = BLOCK.get_or_init(|| Regex::new(r"\{[^{}]*\}").expect("static regex compiles"));
    let bg_re = BG.get_or_init(|| {
        Regex::new(r"(?i)background(?:-color)?\s*:\s*([^;]+)").expect("static regex compiles")
    });
    // The Python used a `(?<!-)` lookbehind to exclude `border-color`,
    // `background-color` and friends. Rust's regex has no lookaround, so the
    // preceding byte is checked directly — same rule, explicit.
    let fg_re = FG.get_or_init(|| Regex::new(r"(?i)color\s*:\s*([^;]+)").expect("static regex compiles"));

    let mut out = Vec::new();
    for block_match in block_re.find_iter(text) {
        let block = block_match.as_str();
        let Some(bg) = bg_re.captures(block) else {
            continue;
        };
        let Some(fg) = fg_re
            .captures_iter(block)
            .find(|captures| {
                let start = captures.get(0).expect("group 0").start();
                start == 0 || block.as_bytes()[start - 1] != b'-'
            })
        else {
            continue;
        };
        let (Some(bg_hex), Some(fg_hex)) = (hex_re().find(&bg[1]), hex_re().find(&fg[1])) else {
            continue;
        };
        let bg_rgb = hue_of(bg_hex.as_str());
        if !is_grayish(bg_rgb)
            && is_grayish(hue_of(fg_hex.as_str()))
            && !is_pure_bw(bg_hex.as_str())
            && bg_rgb.0.max(bg_rgb.1).max(bg_rgb.2) > 40
        {
            out.push((
                "gray-on-color",
                Severity::Warn,
                line_of(text, block_match.start()),
                block.chars().take(80).collect::<String>().replace('\n', " "),
                "Gray text on a colored background — muddy contrast. Use a tinted fg from the same hue.".to_string(),
            ));
        }
    }
    out
}

/// HTML/JSX heuristic: a `card` class nested inside another `card`.
fn file_rule_nested_cards(lines: &[&str]) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r#"class(Name)?\s*=\s*["'][^"']*\bcard\b"#).expect("static regex compiles")
    });
    let card_lines: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| pattern.is_match(line))
        .map(|(index, _)| index + 1)
        .collect();

    let mut out = Vec::new();
    if card_lines.len() >= 2 {
        // Two card declarations within six lines, with increasing indentation,
        // read as a nesting.
        for pair in card_lines.windows(2) {
            let (first, second) = (pair[0], pair[1]);
            if second > first && second - first <= 6 {
                let indent = |line: &str| line.len() - line.trim_start().len();
                if indent(lines[second - 1]) > indent(lines[first - 1]) {
                    out.push((
                        "nested-cards",
                        Severity::Info,
                        second,
                        lines[second - 1].trim().chars().take(80).collect(),
                        "Card nested inside a card — collapse one level; borders-in-borders is clutter.".to_string(),
                    ));
                }
            }
        }
    }
    out
}

fn file_rule_skipped_heading(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern =
        RE.get_or_init(|| Regex::new(r"(?i)<h([1-6])\b").expect("static regex compiles"));
    let mut out = Vec::new();
    let mut previous = 0u32;
    for captures in pattern.captures_iter(text) {
        let level: u32 = captures[1].parse().unwrap_or(0);
        let line = line_of(text, captures.get(0).expect("group 0").start());
        if previous > 0 && level > previous + 1 {
            out.push((
                "skipped-heading",
                Severity::Warn,
                line,
                format!("<h{level}>"),
                format!("Heading jumps h{previous}→h{level} — breaks document outline / a11y."),
            ));
        }
        previous = level;
    }
    out
}

fn file_rule_everything_centered(text: &str) -> Vec<FileFinding> {
    static CSS: OnceLock<Regex> = OnceLock::new();
    static TAILWIND: OnceLock<Regex> = OnceLock::new();
    let count = CSS
        .get_or_init(|| Regex::new(r"(?i)text-align\s*:\s*center").expect("static regex compiles"))
        .find_iter(text)
        .count()
        + TAILWIND
            .get_or_init(|| Regex::new(r"\btext-center\b").expect("static regex compiles"))
            .find_iter(text)
            .count();
    if count >= 5 {
        return vec![(
            "everything-centered",
            Severity::Info,
            0,
            format!("{count} center declarations"),
            format!("{count} center-aligned blocks — default-centering flattens hierarchy. Left-align body, center sparingly."),
        )];
    }
    Vec::new()
}

/// Run every whole-file rule.
fn file_rules(text: &str, lines: &[&str]) -> Vec<FileFinding> {
    let mut out = Vec::new();
    out.extend(file_rule_overused_font(text));
    out.extend(file_rule_pure_bw(text));
    out.extend(file_rule_purple_blue_gradient(text));
    out.extend(file_rule_gray_on_color(text));
    out.extend(file_rule_nested_cards(lines));
    out.extend(file_rule_skipped_heading(text));
    out.extend(file_rule_everything_centered(text));
    out
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/// Which rules to run.
#[derive(Debug, Clone, Default)]
pub struct RuleFilter {
    /// Run only this rule.
    pub only: Option<String>,
    /// Rules to skip.
    pub ignore: Vec<String>,
}

impl RuleFilter {
    fn keeps(&self, rule: &str) -> bool {
        if self.ignore.iter().any(|name| name == rule) {
            return false;
        }
        match &self.only {
            Some(only) => only == rule,
            None => true,
        }
    }
}

/// Scan one file.
pub fn scan_file(path: &Path, filter: &RuleFilter) -> Vec<Finding> {
    let Ok(raw) = std::fs::read(path) else {
        return Vec::new();
    };
    // Python read with errors="replace".
    let text = String::from_utf8_lossy(&raw).into_owned();
    let lines: Vec<&str> = text.split('\n').collect();
    let map = disabled_map(&lines);
    let file = path.display().to_string();
    let mut findings = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        let number = index + 1;
        if line.contains("slop-disable") {
            continue;
        }
        for (rule, check) in LINE_RULES {
            if !filter.keeps(rule) {
                continue;
            }
            if let Some((severity, message)) = check(line) {
                if !is_disabled(&map, number, rule) {
                    findings.push(Finding::new(rule, severity, number, &file, line, message));
                }
            }
        }
    }

    for (rule, severity, line, snippet, message) in file_rules(&text, &lines) {
        if !filter.keeps(rule) || is_disabled(&map, line, rule) {
            continue;
        }
        findings.push(Finding::new(rule, severity, line, &file, &snippet, message));
    }

    findings
}

/// Expand the given paths into scannable files.
pub fn walk(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in paths {
        if root.is_file() {
            out.push(root.clone());
            continue;
        }
        if !root.is_dir() {
            continue;
        }
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            let mut dirs = Vec::new();
            let mut files = Vec::new();
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if !WALK_SKIP_DIRS.contains(&name.as_str()) {
                        dirs.push(path);
                    }
                } else {
                    let extension = path
                        .extension()
                        .map(|ext| ext.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    if SCAN_EXT.contains(&extension.as_str()) {
                        files.push((name, path));
                    }
                }
            }
            files.sort_by(|a, b| a.0.cmp(&b.0));
            out.extend(files.into_iter().map(|(_, path)| path));
            dirs.sort();
            for dir in dirs.into_iter().rev() {
                stack.push(dir);
            }
        }
    }
    out
}

/// Scan every file under `paths`, keeping findings at or above `floor`.
pub fn scan(paths: &[PathBuf], filter: &RuleFilter, floor: Severity) -> Vec<Finding> {
    walk(paths)
        .iter()
        .flat_map(|path| scan_file(path, filter))
        .filter(|finding| finding.severity >= floor)
        .collect()
}

/// Findings grouped by rule, in descending count order.
pub fn by_rule(findings: &[Finding]) -> Vec<(String, usize)> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for finding in findings {
        match counts.iter_mut().find(|(rule, _)| *rule == finding.rule) {
            Some((_, count)) => *count += 1,
            None => counts.push((finding.rule.clone(), 1)),
        }
    }
    counts.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    counts
}

#[cfg(test)]
mod tests;
