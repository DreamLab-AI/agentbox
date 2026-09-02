//! Port of `check_mermaid.py`'s `MermaidValidator`: fenced-block extraction
//! (via `pulldown-cmark` instead of the Python regex, per the port brief),
//! syntax heuristics, and — when `mmdc` is on `PATH` — real validation by
//! shelling out to `mmdc` exactly as the Python did (`mmdc -i <tmp> -o
//! /dev/null --quiet`), with the same 5s/10s timeouts via `tokio::time::timeout`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use walkdir::WalkDir;

use super::models::{MermaidDiagram, MermaidReport};

const IGNORE_SUBSTRINGS: &[&str] = &["node_modules", ".git", "target"];

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_temp_mmd_path() -> PathBuf {
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "docs-check-mermaid-{}-{n}-{nanos}.mmd",
        std::process::id()
    ))
}

fn strip_ansi(s: &str) -> String {
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    re.replace_all(s, "").to_string()
}

fn find_line_number(content: &str, byte_offset: usize) -> usize {
    let offset = byte_offset.min(content.len());
    content[..offset].matches('\n').count() + 1
}

/// Extract `(start_byte, end_byte, block_content)` for every fenced code
/// block tagged `mermaid`, using pulldown-cmark's offset iterator so line
/// numbers can be recovered exactly as `check_mermaid.py::_find_line_number`
/// does from the raw regex match span.
fn find_mermaid_blocks(content: &str) -> Vec<(usize, usize, String)> {
    let mut blocks = Vec::new();
    let mut current: Option<(usize, String)> = None;

    for (event, range) in Parser::new_ext(content, Options::empty()).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang))) => {
                if lang.trim().eq_ignore_ascii_case("mermaid") {
                    current = Some((range.start, String::new()));
                }
            }
            Event::Text(text) => {
                if let Some((_, acc)) = current.as_mut() {
                    acc.push_str(&text);
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((start, acc)) = current.take() {
                    let body = acc.strip_suffix('\n').unwrap_or(&acc).to_string();
                    blocks.push((start, range.end, body));
                }
            }
            _ => {}
        }
    }

    blocks
}

fn check_brackets(content: &str) -> Option<String> {
    let brackets: HashMap<char, char> = [('(', ')'), ('[', ']'), ('{', '}')].into_iter().collect();
    let closers: HashSet<char> = brackets.values().copied().collect();
    let mut stack: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut string_char: Option<char> = None;

    let chars: Vec<char> = content.chars().collect();
    for i in 0..chars.len() {
        let ch = chars[i];
        if matches!(ch, '"' | '\'' | '`') && (i == 0 || chars[i - 1] != '\\') {
            if !in_string {
                in_string = true;
                string_char = Some(ch);
            } else if Some(ch) == string_char {
                in_string = false;
                string_char = None;
            }
        } else if !in_string {
            if let Some(&close) = brackets.get(&ch) {
                stack.push(close);
            } else if closers.contains(&ch) && stack.pop() != Some(ch) {
                return Some(format!("Unbalanced bracket '{ch}'"));
            }
        }
    }

    if !stack.is_empty() {
        return Some(format!("Unclosed bracket(s): {stack:?}"));
    }
    None
}

pub struct MermaidValidator {
    root: PathBuf,
    strict: bool,
    has_mmdc: bool,
    diagram_types: Vec<(&'static str, Regex)>,
    common_errors: Vec<(Regex, &'static str)>,
    github_issues: Vec<(Regex, &'static str)>,
}

impl MermaidValidator {
    pub async fn new(root: &Path, strict: bool) -> Self {
        let has_mmdc = check_mmdc_available().await;
        Self {
            root: root.to_path_buf(),
            strict,
            has_mmdc,
            diagram_types: vec![
                (
                    "flowchart",
                    Regex::new(r"(?i)^(flowchart|graph)\s+(TB|TD|BT|RL|LR)").unwrap(),
                ),
                (
                    "sequenceDiagram",
                    Regex::new(r"(?i)^sequenceDiagram").unwrap(),
                ),
                ("classDiagram", Regex::new(r"(?i)^classDiagram").unwrap()),
                (
                    "stateDiagram",
                    Regex::new(r"(?i)^stateDiagram(-v2)?").unwrap(),
                ),
                ("erDiagram", Regex::new(r"(?i)^erDiagram").unwrap()),
                ("gantt", Regex::new(r"(?i)^gantt").unwrap()),
                ("pie", Regex::new(r"(?i)^pie").unwrap()),
                ("journey", Regex::new(r"(?i)^journey").unwrap()),
                ("gitGraph", Regex::new(r"(?i)^gitGraph").unwrap()),
                ("mindmap", Regex::new(r"(?i)^mindmap").unwrap()),
                ("timeline", Regex::new(r"(?i)^timeline").unwrap()),
                ("quadrantChart", Regex::new(r"(?i)^quadrantChart").unwrap()),
                ("xychart-beta", Regex::new(r"(?i)^xychart-beta").unwrap()),
                ("block-beta", Regex::new(r"(?i)^block-beta").unwrap()),
                ("sankey-beta", Regex::new(r"(?i)^sankey-beta").unwrap()),
                (
                    "requirement",
                    Regex::new(r"(?i)^requirementDiagram").unwrap(),
                ),
                (
                    "c4",
                    Regex::new(r"(?i)^C4(Context|Container|Component|Deployment)").unwrap(),
                ),
            ],
            common_errors: vec![
                (
                    Regex::new(r"-->>\s").unwrap(),
                    "Arrow with text needs label in pipes",
                ),
                (
                    Regex::new(r"-->\s+\|").unwrap(),
                    "Label should follow arrow directly",
                ),
                (
                    Regex::new(r"\bclass\s+\w+\s*\{").unwrap(),
                    "Use classDiagram syntax for class definitions",
                ),
                (
                    Regex::new(r"Note\s+over").unwrap(),
                    r#"Note syntax: "Note over Actor: Text""#,
                ),
            ],
            github_issues: vec![
                (
                    Regex::new(r"%%\{init:").unwrap(),
                    "GitHub may not support all init directives",
                ),
                (
                    Regex::new(r"callback\s").unwrap(),
                    "Callbacks not supported in GitHub rendering",
                ),
                (
                    Regex::new(r"click\s").unwrap(),
                    "Click events not rendered in GitHub",
                ),
                (
                    Regex::new(r"linkStyle\s+default").unwrap(),
                    "Default linkStyle may render differently",
                ),
            ],
        }
    }

    fn detect_diagram_type(&self, content: &str) -> String {
        let stripped = content.trim();
        for (name, re) in &self.diagram_types {
            if re.is_match(stripped) {
                return name.to_string();
            }
        }
        "unknown".to_string()
    }

    async fn validate_syntax(&self, content: &str) -> (bool, Option<String>, Vec<String>) {
        let mut warnings = Vec::new();

        for (re, message) in &self.common_errors {
            if re.is_match(content) {
                return (false, Some(message.to_string()), warnings);
            }
        }

        for (re, warning) in &self.github_issues {
            if re.is_match(content) {
                warnings.push(warning.to_string());
            }
        }

        if let Some(err) = check_brackets(content) {
            return (false, Some(err), warnings);
        }

        if self.has_mmdc {
            let (ok, err, mmdc_warnings) = run_mmdc_validation(content).await;
            warnings.extend(mmdc_warnings);
            if !ok {
                return (false, err, warnings);
            }
        }

        (true, None, warnings)
    }

    async fn scan_file(&self, file_path: &Path) -> Vec<MermaidDiagram> {
        let mut diagrams = Vec::new();
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => {
                println!("Warning: Could not read {}: {e}", file_path.display());
                return diagrams;
            }
        };

        let rel = file_path
            .strip_prefix(&self.root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        for (start, end, block_content) in find_mermaid_blocks(&content) {
            let start_line = find_line_number(&content, start);
            let end_line = find_line_number(&content, end);
            let diagram_type = self.detect_diagram_type(&block_content);
            let (mut is_valid, mut error_message, warnings) =
                self.validate_syntax(&block_content).await;

            if self.strict && !warnings.is_empty() {
                is_valid = false;
                error_message = Some(
                    error_message.unwrap_or_else(|| format!("Warnings: {}", warnings.join("; "))),
                );
            }

            let preview: String = if block_content.chars().count() > 500 {
                let mut s: String = block_content.chars().take(500).collect();
                s.push_str("...");
                s
            } else {
                block_content.clone()
            };

            diagrams.push(MermaidDiagram {
                file: rel.clone(),
                start_line,
                end_line,
                diagram_type,
                content: preview,
                is_valid,
                error_message,
                warnings: if warnings.is_empty() {
                    None
                } else {
                    Some(warnings)
                },
            });
        }

        diagrams
    }

    pub async fn run(&self) -> MermaidReport {
        println!("Scanning {} for mermaid diagrams...", self.root.display());
        println!("Mermaid CLI (mmdc) available: {}", self.has_mmdc);

        let md_files: Vec<PathBuf> = WalkDir::new(&self.root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .filter(|p| p.extension().is_some_and(|ext| ext == "md"))
            .filter(|p| {
                let s = p.to_string_lossy();
                !IGNORE_SUBSTRINGS.iter().any(|ig| s.contains(ig))
            })
            .collect();
        println!("Found {} markdown files", md_files.len());

        let mut diagrams = Vec::new();
        for md_file in &md_files {
            diagrams.extend(self.scan_file(md_file).await);
        }

        let valid_diagrams: Vec<MermaidDiagram> =
            diagrams.iter().filter(|d| d.is_valid).cloned().collect();
        let invalid_diagrams: Vec<MermaidDiagram> =
            diagrams.iter().filter(|d| !d.is_valid).cloned().collect();

        let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
        for d in &diagrams {
            *by_type.entry(d.diagram_type.clone()).or_insert(0) += 1;
        }

        let mut suggestions = Vec::new();
        if !self.has_mmdc {
            suggestions.push(
                "Install mermaid-cli for full syntax validation: npm install -g @mermaid-js/mermaid-cli".to_string(),
            );
        }
        let unknown_types = diagrams
            .iter()
            .filter(|d| d.diagram_type == "unknown")
            .count();
        if unknown_types > 0 {
            suggestions.push(format!(
                "{unknown_types} diagram(s) have unknown types. Consider adding explicit type declarations (e.g., 'flowchart TB')"
            ));
        }
        let warnings_count: usize = diagrams
            .iter()
            .map(|d| d.warnings.as_ref().map_or(0, Vec::len))
            .sum();
        if warnings_count > 0 {
            suggestions.push(format!(
                "{warnings_count} warning(s) about GitHub compatibility. Review diagrams for features that may not render on GitHub."
            ));
        }

        MermaidReport {
            total_diagrams: diagrams.len(),
            valid_diagrams: valid_diagrams.len(),
            invalid_diagrams: invalid_diagrams.len(),
            by_type,
            mmdc_available: self.has_mmdc,
            valid_diagram_list: valid_diagrams,
            invalid_diagram_list: invalid_diagrams,
            suggestions,
        }
    }
}

async fn check_mmdc_available() -> bool {
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("mmdc")
            .arg("--version")
            .output(),
    )
    .await;
    matches!(result, Ok(Ok(output)) if output.status.success())
}

async fn run_mmdc_validation(content: &str) -> (bool, Option<String>, Vec<String>) {
    let mut warnings = Vec::new();
    let tmp_path = unique_temp_mmd_path();

    if let Err(e) = std::fs::write(&tmp_path, content) {
        warnings.push(format!("Could not run mmdc: {e}"));
        return (true, None, warnings);
    }

    let result = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new("mmdc")
            .arg("-i")
            .arg(&tmp_path)
            .arg("-o")
            .arg("/dev/null")
            .arg("--quiet")
            .output(),
    )
    .await;

    let _ = std::fs::remove_file(&tmp_path);

    match result {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let mut msg = stderr.trim().to_string();
                if msg.is_empty() {
                    msg = "Mermaid syntax error".to_string();
                }
                let msg = strip_ansi(&msg);
                let truncated: String = msg.chars().take(200).collect();
                return (false, Some(truncated), warnings);
            }
        }
        Ok(Err(e)) => warnings.push(format!("Could not run mmdc: {e}")),
        Err(_) => warnings.push("Validation timeout - diagram may be too complex".to_string()),
    }

    (true, None, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn valid_flowchart_is_classified_and_valid() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("doc.md"),
            "# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
        )
        .unwrap();

        let validator = MermaidValidator::new(tmp.path(), false).await;
        let report = validator.run().await;

        assert_eq!(report.total_diagrams, 1);
        assert_eq!(report.valid_diagrams, 1);
        assert_eq!(report.valid_diagram_list[0].diagram_type, "flowchart");
    }

    #[tokio::test]
    async fn malformed_diagram_is_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("doc.md"),
            "```mermaid\nflowchart TD\n  A --> B[Unclosed\n```\n",
        )
        .unwrap();

        let validator = MermaidValidator::new(tmp.path(), false).await;
        let report = validator.run().await;

        assert_eq!(report.total_diagrams, 1);
        assert_eq!(report.invalid_diagrams, 1);
    }

    #[test]
    fn bracket_checker_flags_unbalanced() {
        assert!(check_brackets("flowchart TD\n  A --> B[Unclosed").is_some());
        assert!(check_brackets("flowchart TD\n  A --> B[Closed]").is_none());
    }
}
