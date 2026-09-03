//! Scan prose / Markdown for AI writing tells.
//!
//! It catches the MECHANICAL tells only; narrative defaults and altitude/voice
//! need a human read against Section C of the skill.

use std::path::{Path, PathBuf};

use prose_sanitiser_core::{Check, ConfidenceTier, ReportEntry, RuleMeta};
use regex::Regex;
use serde_json::{json, Value};

use super::rules::uk;
use super::rules::{
    rule_meta, Rule, Severity, EMDASH, EMDASH_PER_WINDOW, EXTS, IGNORE_MARK, RULES, SKIP_DIRS,
    TIER2, TRANSITIONS, TRANS_PER_WINDOW, WORDS_PER_PAGE,
};
use super::structural::StructuralMetrics;

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
    /// 1-based column of the match within the line; zero for an aggregate.
    ///
    /// Not serialised by [`Finding::to_json`]: the JSON report shape is fixed
    /// by every consumer that already diffs it. The offsets exist so a SARIF
    /// or JSON Lines report can point at the match rather than the line.
    pub column: usize,
    /// Byte offset of the match within the file; zero for an aggregate.
    pub byte_start: usize,
    /// Exclusive byte offset of the end of the match.
    pub byte_end: usize,
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

    /// The rule metadata behind this finding, if the table documents it.
    pub fn meta(&self) -> Option<&'static RuleMeta> {
        rule_meta().iter().find(|entry| entry.id == self.rule)
    }

    /// The confidence tier, defaulting to report-only for an undocumented rule.
    ///
    /// Defaulting downward is the safe direction: an unknown rule is treated as
    /// a judgement call, never as something a machine may act on.
    pub fn confidence(&self) -> ConfidenceTier {
        self.meta()
            .map(|meta| meta.confidence)
            .unwrap_or(ConfidenceTier::LowConfidenceJudgement)
    }

    /// Convert to the located-finding shape a SARIF or JSON Lines report needs.
    pub fn to_report_entry(&self) -> ReportEntry {
        ReportEntry::new(
            self.file.clone(),
            self.line,
            self.column,
            prose_sanitiser_core::Finding {
                rule_id: self.rule.clone(),
                label: self.label.clone(),
                span: prose_sanitiser_core::Span::new(self.byte_start, self.byte_end),
                matched: self.snippet.clone(),
                severity: self.severity,
                confidence: self.confidence(),
                advice: self.fix.clone(),
                replacement: None,
            },
        )
        .with_snippet(self.snippet.clone())
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
                .pattern_sources()
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

/// The snippet width a report shows for one finding.
pub const SNIPPET_CHARS: usize = 160;

/// Truncate to `limit` characters, as Python's `text[:limit]` does.
///
/// Used only where there is no match to centre on: the whole-file aggregates,
/// whose snippet is a summary rather than a quotation.
fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// A `limit`-character window of `text` centred on the matched span.
///
/// Taking the first 160 characters of the line, which is what this did before,
/// silently hides the match on any long line: a baseline run over the
/// documentation corpus found 75 of 120 findings quoting a snippet that did not
/// contain the thing being reported. A snippet that omits the match is worse
/// than no snippet, because the reader trusts it and goes looking in the wrong
/// place.
///
/// `start` and `end` are character offsets into `text`. Clipped ends are marked
/// with an ASCII ellipsis so the reader can see the line continues.
fn snippet_around(text: &str, start: usize, end: usize, limit: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= limit {
        return text.to_string();
    }

    const MARK: &str = "...";
    let start = start.min(chars.len());
    let end = end.clamp(start, chars.len());

    // Centre on the match, then slide the window back inside the line. A match
    // longer than the window keeps its own start rather than being centred on
    // its middle, which would show neither end of it.
    let matched = end - start;
    let padding = limit.saturating_sub(matched) / 2;
    let mut from = start.saturating_sub(padding);
    if from + limit > chars.len() {
        from = chars.len() - limit;
    }
    let to = (from + limit).min(chars.len());

    let mut out = String::with_capacity(limit + 2 * MARK.len());
    if from > 0 {
        out.push_str(MARK);
    }
    out.extend(&chars[from..to]);
    if to < chars.len() {
        out.push_str(MARK);
    }
    out
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

    // The UK-English rules run over the whole document, because sense
    // disambiguation and the organisation gazetteer both need more context than
    // one line. Their findings are indexed by line and emitted at the position
    // the `us-spelling` marker holds in the table, so the report keeps its
    // long-standing rule order.
    let uk_by_line = uk_findings_by_line(&text, floor);

    let mut findings = Vec::new();
    let mut in_fence = false;
    let mut line_offset = 0usize;
    let mut word_count = 0usize;
    let mut emdash_total = 0usize;
    let mut emdash_list_lines: Vec<(usize, String)> = Vec::new();
    let mut transition_total = 0usize;
    // Insertion-ordered, so `min(values)` and the sorted rendering agree with
    // the Python dict.
    let mut tier2_seen: Vec<(String, usize)> = Vec::new();

    for (index, raw_line) in text.split('\n').enumerate() {
        let number = index + 1;
        let line_start = line_offset;
        // `split` drops the separator, so the next line starts one byte later.
        line_offset += raw_line.len() + 1;
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
            if compiled.rule.is_delegated() {
                for (rule_id, label, column, start, end) in
                    uk_by_line.get(&number).into_iter().flatten()
                {
                    let lead = line.len() - line.trim_start().len();
                    let within = start.saturating_sub(line_start).max(lead);
                    let from = line[lead..within.min(line.len())].chars().count();
                    let span = line
                        [within.min(line.len())..end.saturating_sub(line_start).min(line.len())]
                        .chars()
                        .count();
                    findings.push(Finding {
                        rule: rule_id.clone(),
                        label: label.clone(),
                        severity: compiled.rule.severity,
                        fix: compiled.rule.fix.to_string(),
                        file: file.clone(),
                        line: number,
                        snippet: snippet_around(stripped, from, from + span, SNIPPET_CHARS),
                        column: *column,
                        byte_start: *start,
                        byte_end: *end,
                    });
                }
                continue;
            }
            let Some(found) = compiled
                .patterns
                .iter()
                .find_map(|pattern| pattern.find(line))
            else {
                continue;
            };
            // Offsets are into `line`; the snippet quotes `stripped`, so shift
            // them by the leading whitespace `trim` removed.
            let lead = line.len() - line.trim_start().len();
            let from = line[lead..found.start().max(lead)].chars().count();
            let span = line[found.start().max(lead)..found.end().max(lead)]
                .chars()
                .count();
            findings.push(Finding {
                rule: compiled.rule.id.to_string(),
                label: compiled.rule.label.to_string(),
                severity: compiled.rule.severity,
                fix: compiled.rule.fix.to_string(),
                file: file.clone(),
                line: number,
                snippet: snippet_around(stripped, from, from + span, SNIPPET_CHARS),
                column: line[..found.start()].chars().count() + 1,
                byte_start: line_start + found.start(),
                byte_end: line_start + found.end(),
            });
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
                column: 0,
                byte_start: 0,
                byte_end: 0,
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

/// The UK-English findings for a document, indexed by 1-based line.
///
/// At most one finding per rule per line, matching the one-report-per-rule-line
/// shape every other rule in the table has.
#[allow(clippy::type_complexity)]
fn uk_findings_by_line(
    text: &str,
    floor: Severity,
) -> std::collections::HashMap<usize, Vec<(String, String, usize, usize, usize)>> {
    use std::collections::HashMap;

    let config = prose_sanitiser_core::Config::new().with_min_severity(floor);
    let mut line_starts = vec![0usize];
    for (index, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            line_starts.push(index + 1);
        }
    }

    let mut out: HashMap<usize, Vec<(String, String, usize, usize, usize)>> = HashMap::new();
    for finding in uk::checker().check(text, &config) {
        let line = match line_starts.binary_search(&finding.span.start) {
            Ok(index) => index,
            Err(index) => index - 1,
        };
        let start = line_starts[line];
        let column = text[start..finding.span.start].chars().count() + 1;
        let bucket = out.entry(line + 1).or_default();
        if bucket.iter().any(|(rule, ..)| *rule == finding.rule_id) {
            continue;
        }
        bucket.push((
            finding.rule_id,
            finding.label,
            column,
            finding.span.start,
            finding.span.end,
        ));
    }
    out
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
    /// Per-file structural measures, empty unless the scan asked for them.
    pub structural: Vec<(String, StructuralMetrics)>,
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
///
/// The structural measures are off: this is the long-standing default and its
/// output shape is fixed by every consumer that diffs it.
pub fn scan(root: &Path, floor: Severity) -> ScanResult {
    scan_with(root, floor, false)
}

/// Scan `root`, optionally adding the whole-document structural measures.
///
/// Structural findings report under their own `structural-*` rule ids and never
/// under `agg`, so a consumer of the default output sees nothing new.
pub fn scan_with(root: &Path, floor: Severity, structural: bool) -> ScanResult {
    let rules = compile_rules(floor);
    let mut findings = Vec::new();
    let mut measures = Vec::new();
    let files = iter_files(root);
    for path in &files {
        findings.extend(scan_file(path, &rules, floor));
        if !structural {
            continue;
        }
        let Ok(raw) = std::fs::read(path) else {
            continue;
        };
        let text = prose_sanitiser_core::surrogate::decode_ignore(&raw);
        let file = path.display().to_string();
        let metrics = StructuralMetrics::measure(&text);
        for finding in metrics.findings() {
            if finding.severity.rank() > floor.rank() {
                continue;
            }
            findings.push(Finding {
                rule: finding.rule_id,
                label: finding.label,
                severity: finding.severity,
                fix: finding.advice,
                file: file.clone(),
                line: 0,
                snippet: finding.matched,
                column: 0,
                byte_start: 0,
                byte_end: 0,
            });
        }
        measures.push((file, metrics));
    }
    ScanResult {
        findings,
        files_scanned: files.len(),
        structural: measures,
    }
}

#[cfg(test)]
mod tests;
