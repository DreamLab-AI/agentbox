//! Scan prose / Markdown for AI writing tells.
//!
//! It catches the MECHANICAL tells only; narrative defaults and altitude/voice
//! need a human read against Section C of the skill.

use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{json, Value};

use super::rules::{
    Rule, Severity, EMDASH, EMDASH_PER_WINDOW, EXTS, IGNORE_MARK, RULES, SKIP_DIRS, TIER2,
    TRANSITIONS, TRANS_PER_WINDOW, WORDS_PER_PAGE,
};

/// One reported tell.
#[derive(Debug, Clone)]
pub struct Finding {
    pub rule: String,
    pub label: String,
    pub severity: Severity,
    pub fix: String,
    pub file: String,
    /// 1-based; zero for a whole-file aggregate.
    pub line: usize,
    pub snippet: String,
}

impl Finding {
    pub fn to_json(&self) -> Value {
        json!({
            "rule": self.rule,
            "label": self.label,
            "sev": self.severity.as_str(),
            "fix": self.fix,
            "file": self.file,
            "line": self.line,
            "snippet": self.snippet,
        })
    }
}

/// A rule with its patterns compiled.
pub struct CompiledRule {
    rule: &'static Rule,
    patterns: Vec<Regex>,
}

/// Compile the rules at or above `floor`.
fn compile_rules(floor: Severity) -> Vec<CompiledRule> {
    RULES
        .iter()
        .filter(|rule| rule.severity.rank() <= floor.rank())
        .map(|rule| CompiledRule {
            rule,
            patterns: rule
                .patterns
                .iter()
                .map(|pattern| {
                    let source = if rule.cased {
                        (*pattern).to_string()
                    } else {
                        format!("(?i){pattern}")
                    };
                    Regex::new(&source).expect("rule patterns are validated by a unit test")
                })
                .collect(),
        })
        .collect()
}

/// Files the scanner reads: a single file, or every matching file in a tree.
pub fn iter_files(root: &Path) -> Vec<PathBuf> {
    if root.is_file() {
        return vec![root.to_path_buf()];
    }
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
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
                if !SKIP_DIRS.contains(&name.as_str()) {
                    dirs.push(path);
                }
            } else {
                let extension = path
                    .extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if EXTS.contains(&extension.as_str()) {
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
    out
}

fn is_list_line(line: &str) -> bool {
    Regex::new(r"^\s*([-*+]|\d+\.)\s+")
        .expect("static regex compiles")
        .is_match(line)
}

/// Truncate to `limit` characters, as Python's `text[:limit]` does.
fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// Scan one file, returning its per-line and whole-file findings.
pub fn scan_file(path: &Path, rules: &[CompiledRule], floor: Severity) -> Vec<Finding> {
    let Ok(raw) = std::fs::read(path) else {
        return Vec::new();
    };
    // Python opened with errors="ignore", which drops undecodable bytes.
    let text = prose_sanitiser_core::surrogate::decode_ignore(&raw);
    let file = path.display().to_string();

    let transitions = Regex::new(&format!(r"(?i)\b({})\b", TRANSITIONS.join("|")))
        .expect("static regex compiles");
    let tier2 =
        Regex::new(&format!(r"(?i)\b({})\b", TIER2.join("|"))).expect("static regex compiles");

    let mut findings = Vec::new();
    let mut in_fence = false;
    let mut word_count = 0usize;
    let mut emdash_total = 0usize;
    let mut emdash_list_lines: Vec<(usize, String)> = Vec::new();
    let mut transition_total = 0usize;
    // Insertion-ordered, so `min(values)` and the sorted rendering agree with
    // the Python dict.
    let mut tier2_seen: Vec<(String, usize)> = Vec::new();

    for (index, raw_line) in text.split('\n').enumerate() {
        let number = index + 1;
        let line = raw_line.trim_end_matches('\r');
        let stripped = line.trim();

        // Toggle fenced code blocks; never scan code.
        if stripped.starts_with("```") || stripped.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // Skip blockquotes (often other people's words) and the explicit opt-out.
        if stripped.starts_with('>') || line.to_lowercase().contains(IGNORE_MARK) {
            continue;
        }

        word_count += stripped.split_whitespace().count();

        // Whole-file accumulation. The Unicode em-dash plus the LaTeX-source
        // "---" (both render as an em-dash).
        let em = line.matches(EMDASH).count() + line.matches("---").count();
        if em > 0 {
            emdash_total += em;
            if is_list_line(line) {
                emdash_list_lines.push((number, clip(stripped, 160)));
            }
        }
        transition_total += transitions.find_iter(line).count();
        for found in tier2.find_iter(line) {
            let word = found.as_str().to_lowercase();
            if !tier2_seen.iter().any(|(seen, _)| *seen == word) {
                tier2_seen.push((word, number));
            }
        }

        // Per-line rules: the first matching pattern in a rule reports once.
        for compiled in rules {
            if compiled
                .patterns
                .iter()
                .any(|pattern| pattern.is_match(line))
            {
                findings.push(Finding {
                    rule: compiled.rule.id.to_string(),
                    label: compiled.rule.label.to_string(),
                    severity: compiled.rule.severity,
                    fix: compiled.rule.fix.to_string(),
                    file: file.clone(),
                    line: number,
                    snippet: clip(stripped, 160),
                });
            }
        }
    }

    // ---- Aggregate (whole-file) findings ----
    let windows = (word_count as f64 / WORDS_PER_PAGE).max(1.0);
    let mut emit = |severity: Severity, label: &str, fix: String, line: usize, snippet: String| {
        if severity.rank() <= floor.rank() {
            findings.push(Finding {
                rule: "agg".to_string(),
                label: label.to_string(),
                severity,
                fix,
                file: file.clone(),
                line,
                snippet,
            });
        }
    };

    if emdash_total as f64 > EMDASH_PER_WINDOW * windows {
        emit(
            Severity::High,
            "Em-dash density over threshold",
            format!(
                "Max {} per {} words. Replace with comma / full stop / colon. See SKILL.md B1.",
                EMDASH_PER_WINDOW as i64, WORDS_PER_PAGE as i64
            ),
            0,
            format!(
                "{emdash_total} em-dashes across ~{word_count} words (budget {})",
                (EMDASH_PER_WINDOW * windows) as i64
            ),
        );
    }
    for (line, snippet) in emdash_list_lines {
        emit(
            Severity::Medium,
            "Em-dash inside a list item",
            "Zero em-dashes in lists. Recast the bullet. See SKILL.md B1.".to_string(),
            line,
            snippet,
        );
    }
    if transition_total as f64 > TRANS_PER_WINDOW * windows {
        emit(
            Severity::Medium,
            "Transition-word overuse",
            format!(
                "Max {} per {} words (furthermore, moreover, ...). See SKILL.md B10.",
                TRANS_PER_WINDOW as i64, WORDS_PER_PAGE as i64
            ),
            0,
            format!("{transition_total} transition words across ~{word_count} words"),
        );
    }
    if tier2_seen.len() >= 3 {
        let mut words: Vec<&str> = tier2_seen.iter().map(|(word, _)| word.as_str()).collect();
        words.sort_unstable();
        let first_line = tier2_seen.iter().map(|(_, line)| *line).min().unwrap_or(0);
        emit(
            Severity::Low,
            "Tier-2 cluster words (3+ distinct in file)",
            "Vary the register; these read as AI when stacked. See SKILL.md B5.".to_string(),
            first_line,
            words.join(", "),
        );
    }

    findings
}

/// The overall verdict from the severity counts and weighted score.
pub fn verdict(high: u32, weighted: u32) -> &'static str {
    if high >= 5 || weighted >= 20 {
        return "STRONG AI writing fingerprint";
    }
    if high >= 1 || weighted >= 6 {
        return "Some AI tells present";
    }
    if weighted > 0 {
        return "Mostly clean, minor tells";
    }
    "Clean, no mechanical tells detected"
}

/// A completed scan over one path.
pub struct ScanResult {
    pub findings: Vec<Finding>,
    pub files_scanned: usize,
}

impl ScanResult {
    pub fn counts(&self) -> [(Severity, u32); 3] {
        let mut counts = [
            (Severity::High, 0),
            (Severity::Medium, 0),
            (Severity::Low, 0),
        ];
        for finding in &self.findings {
            for slot in counts.iter_mut() {
                if slot.0 == finding.severity {
                    slot.1 += 1;
                }
            }
        }
        counts
    }

    pub fn high(&self) -> u32 {
        self.counts()[0].1
    }

    pub fn weighted(&self) -> u32 {
        self.counts()
            .iter()
            .map(|(severity, count)| severity.weight() * count)
            .sum()
    }

    pub fn verdict(&self) -> &'static str {
        verdict(self.high(), self.weighted())
    }
}

/// Scan `root`, honouring the minimum severity.
pub fn scan(root: &Path, floor: Severity) -> ScanResult {
    let rules = compile_rules(floor);
    let mut findings = Vec::new();
    let files = iter_files(root);
    for path in &files {
        findings.extend(scan_file(path, &rules, floor));
    }
    ScanResult {
        findings,
        files_scanned: files.len(),
    }
}

#[cfg(test)]
mod tests;
