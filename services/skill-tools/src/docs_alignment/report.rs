//! Port of `generate_report.py`'s `ReportGenerator`: aggregates the JSON
//! reports from the other four validators (plus the two still-Python
//! `archive_working_docs.py` / `scan_stubs.py`) into one Markdown report.
//!
//! Every upstream report is read as a generic [`serde_json::Value`] (not a
//! typed struct) because two of the five inputs (`archive`, `stubs`) come
//! from Python scripts this port does not own the schema of — this mirrors
//! Python's own `dict.get(key, default)` access pattern exactly.
//!
//! The seven `_generate_*_section` equivalents live in
//! [`super::report_sections`] (a second `impl ReportGenerator` block) purely
//! to keep this file under the crate's 500-line-per-file guideline; they are
//! still inherent methods on this same [`ReportGenerator`].

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use serde_json::Value;

fn empty_value() -> &'static Value {
    static EMPTY: OnceLock<Value> = OnceLock::new();
    EMPTY.get_or_init(|| Value::Object(serde_json::Map::new()))
}

pub(super) fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub(super) fn get_str<'a>(v: &'a Value, key: &str, default: &'a str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or(default)
}

pub(super) fn get_u64(v: &Value, key: &str, default: u64) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(default)
}

/// Mirrors Python's `str(d.get(key, default))` / an f-string `{d.get(key, default)}`:
/// numbers print as their bare number, strings print as-is, and a missing
/// (or `null`) key falls back to `default` verbatim.
pub(super) fn get_display(v: &Value, key: &str, default: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Null) | None => default.to_string(),
        Some(other) => other.to_string(),
    }
}

pub(super) fn get_array<'a>(v: &'a Value, key: &str) -> Vec<&'a Value> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

pub struct ReportGenerator {
    project_name: String,
    reports: BTreeMap<&'static str, Value>,
}

impl ReportGenerator {
    pub fn new(project_name: String) -> Self {
        Self {
            project_name,
            reports: BTreeMap::new(),
        }
    }

    pub fn load_report(&mut self, name: &'static str, path: Option<&str>) {
        let value = match path {
            Some(p) if Path::new(p).exists() => match std::fs::read_to_string(p) {
                Ok(text) => match serde_json::from_str::<Value>(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        println!("Warning: Could not load {name} report: {e}");
                        Value::Object(serde_json::Map::new())
                    }
                },
                Err(e) => {
                    println!("Warning: Could not load {name} report: {e}");
                    Value::Object(serde_json::Map::new())
                }
            },
            _ => Value::Object(serde_json::Map::new()),
        };
        self.reports.insert(name, value);
    }

    pub(super) fn get(&self, name: &str) -> &Value {
        self.reports.get(name).unwrap_or_else(|| empty_value())
    }

    pub(super) fn format_table(headers: &[&str], rows: &[Vec<String>]) -> String {
        if rows.is_empty() {
            return "_No items found._\n".to_string();
        }

        let mut widths: Vec<usize> = headers.iter().map(|h| h.chars().count()).collect();
        for row in rows {
            for (i, cell) in row.iter().enumerate() {
                if i < widths.len() {
                    widths[i] = widths[i].max(cell.chars().count());
                }
            }
        }

        let mut lines = Vec::new();

        let header_line = format!(
            "| {} |",
            headers
                .iter()
                .enumerate()
                .map(|(i, h)| format!("{:<w$}", h, w = widths[i]))
                .collect::<Vec<_>>()
                .join(" | ")
        );
        lines.push(header_line);

        let sep_line = format!(
            "|{}|",
            widths
                .iter()
                .map(|w| "-".repeat(w + 2))
                .collect::<Vec<_>>()
                .join("|")
        );
        lines.push(sep_line);

        for row in rows {
            let row_line = format!(
                "| {} |",
                row.iter()
                    .enumerate()
                    .map(|(i, c)| if i < widths.len() {
                        format!("{:<w$}", c, w = widths[i])
                    } else {
                        c.clone()
                    })
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
            lines.push(row_line);
        }

        format!("{}\n", lines.join("\n"))
    }

    pub fn generate(&self) -> String {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");

        format!(
            "# Documentation Issues Report\n\n\
**Generated:** {now}\n\
**Project:** {project_name}\n\n\
---\n\n\
## Summary\n\n\
{summary}\n\
---\n\n\
## Broken Links\n\n\
{broken_links}\n\
---\n\n\
## Orphan Documents\n\n\
{orphan_docs}\n\
---\n\n\
## Invalid Mermaid Diagrams\n\n\
{mermaid}\n\
---\n\n\
## ASCII Diagrams to Convert\n\n\
{ascii_section}\n\
---\n\n\
## Working Documents to Archive\n\n\
{archive}\n\
---\n\n\
## Stubs and TODOs\n\n\
{stubs}\n\
---\n\n\
## Recommendations\n\n\
### High Priority\n\
1. Fix all broken internal links\n\
2. Resolve unimplemented stubs (error severity)\n\
3. Address FIXME markers\n\n\
### Medium Priority\n\
1. Fix invalid mermaid diagrams\n\
2. Link orphan documents or archive them\n\
3. Review TODOs for relevance\n\n\
### Low Priority\n\
1. Convert ASCII diagrams to mermaid\n\
2. Archive working documents\n\
3. Clean up placeholder comments\n\n\
---\n\n\
_Report generated by Documentation Alignment Skill_\n",
            now = now,
            project_name = self.project_name,
            summary = self.generate_summary(),
            broken_links = self.generate_broken_links_section(),
            orphan_docs = self.generate_orphan_docs_section(),
            mermaid = self.generate_mermaid_section(),
            ascii_section = self.generate_ascii_section(),
            archive = self.generate_archive_section(),
            stubs = self.generate_stubs_section(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn generates_summary_and_headings_from_fixture_reports() {
        let tmp = tempfile::tempdir().unwrap();

        let link_report = tmp.path().join("link-report.json");
        fs::write(
            &link_report,
            serde_json::json!({
                "broken_links": [
                    {"source_file": "docs/a.md", "line_number": 3, "link_target": "missing.md", "link_type": "internal", "error_message": "File not found"}
                ],
                "orphan_docs": ["docs/orphan.md"]
            })
            .to_string(),
        )
        .unwrap();

        let mermaid_report = tmp.path().join("mermaid-report.json");
        fs::write(
            &mermaid_report,
            serde_json::json!({"invalid_diagrams": 1, "invalid_diagram_list": []}).to_string(),
        )
        .unwrap();

        let mut gen = ReportGenerator::new("TestProject".to_string());
        gen.load_report("links", Some(link_report.to_str().unwrap()));
        gen.load_report("mermaid", Some(mermaid_report.to_str().unwrap()));
        gen.load_report("ascii", None);
        gen.load_report("archive", None);
        gen.load_report("stubs", None);

        let report = gen.generate();

        assert!(report.contains("# Documentation Issues Report"));
        assert!(report.contains("**Project:** TestProject"));
        assert!(report.contains("## Broken Links"));
        assert!(report.contains("docs/a.md"));
        assert!(report.contains("## Orphan Documents"));
        assert!(report.contains("docs/orphan.md"));
        assert!(report.contains("Broken Links"));
        assert!(report.contains("| Category"));
    }

    #[test]
    fn missing_reports_render_clean_placeholders() {
        let mut gen = ReportGenerator::new("Empty".to_string());
        gen.load_report("links", None);
        gen.load_report("mermaid", None);
        gen.load_report("ascii", None);
        gen.load_report("archive", None);
        gen.load_report("stubs", None);

        let report = gen.generate();
        assert!(report.contains("**No issues found!** Documentation is clean."));
        assert!(report.contains("_No broken links found._"));
        assert!(report.contains("_No orphan documents found._"));
    }
}
