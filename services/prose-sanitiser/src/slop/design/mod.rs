//! Deterministic, no-LLM design anti-pattern scanner.
//!
//! Zero network, no rendering, no evaluation: regex and heuristic rules over
//! source, with inline disable comments and text or JSON output. Run as a
//! quality GATE (open-design Phase 6, design-audit Step 1).

pub mod rules;
pub mod whole_file;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

use rules::LINE_RULES;
use whole_file::file_rules;

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
        .map(|(_, names)| names.iter().any(|name| name == "*" || name == rule))
        .unwrap_or(false)
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
