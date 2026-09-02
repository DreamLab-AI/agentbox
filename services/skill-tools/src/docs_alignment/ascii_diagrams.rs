//! Port of `detect_ascii.py`'s `AsciiDiagramDetector`: a heuristic scan for
//! box-drawing / arrow / tree ASCII-art blocks that should probably be
//! Mermaid diagrams instead. Pure regex + counting heuristics, no external
//! process or network dependency, so this module is fully synchronous.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use regex::Regex;
use walkdir::WalkDir;

use super::models::{AsciiDiagram, AsciiReport};

const IGNORE_SUBSTRINGS: &[&str] = &["node_modules", ".git", "target"];

/// Unicode box-drawing characters (`detect_ascii.py::BOX_CHARS`).
const BOX_CHARS: &str = "─│┌┐└┘├┤┬┴┼╔╗╚╝║═╠╣╦╩╬┏┓┗┛┃━┣┫┳┻╋";

fn arrow_patterns() -> Vec<&'static str> {
    vec![
        r"-->", r"<--", r"<-->", r"==>", r"<==", r"\|->", r"<-\|", r"->", r"<-", r"\.\.>",
        r"<\.\.>",
    ]
}

fn flow_indicator_patterns() -> Vec<&'static str> {
    vec![
        r"\[\s*\w+\s*\]",
        r"\(\s*\w+\s*\)",
        r"\{\s*\w+\s*\}",
        r"<\s*\w+\s*>",
    ]
}

fn tree_patterns() -> Vec<&'static str> {
    vec![
        r"^\s*[\|│]\s*$",
        r"^\s*[\|│][-─]+",
        r"^\s*[├└┣┗]\s*[-─]*\s*",
        r"^\s*\+[-─]+",
    ]
}

pub struct AsciiDiagramDetector {
    root: PathBuf,
    min_lines: usize,

    ascii_box_open: Regex,
    ascii_box_pipe: Regex,
    arrow_re: Regex,
    flow_res: Vec<Regex>,
    tree_res: Vec<Regex>,
}

impl AsciiDiagramDetector {
    pub fn new(root: &Path, min_lines: usize) -> Self {
        Self {
            root: root.to_path_buf(),
            min_lines,
            ascii_box_open: Regex::new(r"\+[-+]+\+").unwrap(),
            ascii_box_pipe: Regex::new(r"\|[^|]+\|").unwrap(),
            arrow_re: Regex::new(&arrow_patterns().join("|")).unwrap(),
            flow_res: flow_indicator_patterns()
                .iter()
                .map(|p| Regex::new(p).unwrap())
                .collect(),
            tree_res: tree_patterns()
                .iter()
                .map(|p| Regex::new(p).unwrap())
                .collect(),
        }
    }

    fn has_box_chars(&self, line: &str) -> bool {
        line.chars().any(|c| BOX_CHARS.contains(c))
    }

    fn has_ascii_box(&self, line: &str) -> bool {
        self.ascii_box_open.is_match(line) || self.ascii_box_pipe.is_match(line)
    }

    fn has_arrows(&self, line: &str) -> bool {
        self.arrow_re.is_match(line)
    }

    fn has_flow_shapes(&self, line: &str) -> bool {
        self.flow_res.iter().filter(|re| re.is_match(line)).count() >= 2
    }

    fn is_tree_line(&self, line: &str) -> bool {
        self.tree_res.iter().any(|re| re.is_match(line))
    }

    fn is_diagram_line(&self, line: &str) -> bool {
        self.has_box_chars(line)
            || self.has_ascii_box(line)
            || self.has_arrows(line)
            || self.is_tree_line(line)
            || self.has_flow_shapes(line)
    }

    fn classify_diagram(&self, lines: &[String]) -> (String, f64, Option<String>) {
        let content = lines.join("\n");
        let total = lines.len() as f64;

        let box_lines = lines
            .iter()
            .filter(|l| self.has_box_chars(l) || self.has_ascii_box(l))
            .count() as f64;
        let arrow_lines = lines.iter().filter(|l| self.has_arrows(l)).count() as f64;
        let tree_lines = lines.iter().filter(|l| self.is_tree_line(l)).count() as f64;
        let flow_lines = lines.iter().filter(|l| self.has_flow_shapes(l)).count() as f64;

        if tree_lines / total > 0.5 {
            return (
                "tree".to_string(),
                0.8,
                Some("Consider: graph TD or mindmap".to_string()),
            );
        }

        if box_lines / total > 0.6 && arrow_lines / total > 0.2 {
            let re_flow = Regex::new(r"(?i)(start|begin|end|if|else|then)").unwrap();
            let re_seq = Regex::new(r"(?i)(request|response|send|receive)").unwrap();
            if re_flow.is_match(&content) {
                return (
                    "flowchart".to_string(),
                    0.9,
                    Some("Consider: flowchart TB".to_string()),
                );
            }
            if re_seq.is_match(&content) {
                return (
                    "sequence".to_string(),
                    0.85,
                    Some("Consider: sequenceDiagram".to_string()),
                );
            }
            return (
                "flowchart".to_string(),
                0.7,
                Some("Consider: flowchart LR or TB".to_string()),
            );
        }

        if flow_lines / total > 0.3 {
            return (
                "process".to_string(),
                0.75,
                Some("Consider: flowchart LR".to_string()),
            );
        }

        if box_lines / total > 0.4 {
            let all_table_like = lines
                .iter()
                .filter(|l| !l.trim().is_empty())
                .all(|l| l.matches('|').count() >= 2);
            if all_table_like {
                return (
                    "table".to_string(),
                    0.5,
                    Some("This may be a markdown table, not a diagram".to_string()),
                );
            }
            return (
                "box".to_string(),
                0.6,
                Some("Consider: flowchart or block-beta".to_string()),
            );
        }

        if arrow_lines / total > 0.3 {
            return (
                "flow".to_string(),
                0.65,
                Some("Consider: flowchart or sequenceDiagram".to_string()),
            );
        }

        (
            "unknown".to_string(),
            0.4,
            Some("Review manually for conversion potential".to_string()),
        )
    }

    fn extract_preview(&self, lines: &[String], max_lines: usize) -> String {
        let mut preview: Vec<String> = lines.iter().take(max_lines).cloned().collect();
        if lines.len() > max_lines {
            preview.push("...".to_string());
        }
        preview.join("\n")
    }

    fn is_in_code_block(&self, file_lines: &[&str], start_idx: usize, end_idx: usize) -> bool {
        let mut in_block = false;
        for (i, line) in file_lines.iter().enumerate() {
            if i > end_idx {
                break;
            }
            if line.trim().starts_with("```") {
                in_block = !in_block;
            }
            if i >= start_idx && in_block {
                return true;
            }
        }
        false
    }

    fn scan_file(&self, file_path: &Path) -> Vec<AsciiDiagram> {
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
        let lines: Vec<&str> = content.split('\n').collect();

        let mut potential_start: Option<usize> = None;
        let mut potential_lines: Vec<(usize, String)> = Vec::new();

        let flush = |diagrams: &mut Vec<AsciiDiagram>,
                     potential_start: usize,
                     potential_lines: &[(usize, String)],
                     detector: &Self| {
            if potential_lines.len() < detector.min_lines {
                return;
            }
            let end_idx = potential_lines.last().unwrap().0;
            if detector.is_in_code_block(&lines, potential_start, end_idx) {
                return;
            }
            let diagram_lines: Vec<String> =
                potential_lines.iter().map(|(_, l)| l.clone()).collect();
            let (dtype, confidence, suggestion) = detector.classify_diagram(&diagram_lines);
            if dtype != "table" || confidence > 0.6 {
                diagrams.push(AsciiDiagram {
                    file: rel.clone(),
                    start_line: potential_start + 1,
                    end_line: end_idx + 1,
                    diagram_type: dtype,
                    preview: detector.extract_preview(&diagram_lines, 5),
                    confidence,
                    suggestion,
                });
            }
        };

        for (i, line) in lines.iter().enumerate() {
            if self.is_diagram_line(line) {
                if potential_start.is_none() {
                    potential_start = Some(i);
                }
                potential_lines.push((i, line.to_string()));
            } else {
                if let Some(start) = potential_start {
                    flush(&mut diagrams, start, &potential_lines, self);
                }
                potential_start = None;
                potential_lines.clear();
            }
        }

        if let Some(start) = potential_start {
            flush(&mut diagrams, start, &potential_lines, self);
        }

        diagrams
    }

    pub fn run(&self) -> AsciiReport {
        println!("Scanning {} for ASCII diagrams...", self.root.display());

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
            diagrams.extend(self.scan_file(md_file));
        }

        let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
        for d in &diagrams {
            *by_type.entry(d.diagram_type.clone()).or_insert(0) += 1;
        }

        let mut high_confidence: Vec<AsciiDiagram> = diagrams
            .iter()
            .filter(|d| d.confidence >= 0.7)
            .cloned()
            .collect();
        let high_confidence_count = high_confidence.len();

        high_confidence.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let priority_conversions: Vec<AsciiDiagram> =
            high_confidence.into_iter().take(10).collect();

        AsciiReport {
            total_detected: diagrams.len(),
            high_confidence: high_confidence_count,
            by_type,
            ascii_diagrams: diagrams,
            priority_conversions,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_box_diagram_above_min_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let content = "\
Some prose here.

+--------+     +--------+
| Client | --> | Server |
+--------+     +--------+

More prose.
";
        std::fs::write(tmp.path().join("doc.md"), content).unwrap();

        let detector = AsciiDiagramDetector::new(tmp.path(), 3);
        let report = detector.run();

        assert!(report.total_detected >= 1);
    }

    #[test]
    fn prose_alone_is_not_detected() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("doc.md"),
            "This is just prose.\nNo diagrams anywhere in this document.\nJust more words.\n",
        )
        .unwrap();

        let detector = AsciiDiagramDetector::new(tmp.path(), 3);
        let report = detector.run();

        assert_eq!(report.total_detected, 0);
    }

    #[test]
    fn min_lines_threshold_is_respected() {
        let tmp = tempfile::tempdir().unwrap();
        // Only two arrow lines -> below a min_lines=3 threshold.
        std::fs::write(tmp.path().join("doc.md"), "a --> b\nc --> d\n").unwrap();

        let detector = AsciiDiagramDetector::new(tmp.path(), 3);
        let report = detector.run();
        assert_eq!(report.total_detected, 0);

        let detector2 = AsciiDiagramDetector::new(tmp.path(), 2);
        let report2 = detector2.run();
        assert!(report2.total_detected >= 1);
    }
}
