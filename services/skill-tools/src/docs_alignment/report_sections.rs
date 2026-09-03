//! The seven `generate_report.py::ReportGenerator._generate_*_section`
//! equivalents, split out of [`super::report`] purely to keep that file
//! under the crate's 500-line-per-file guideline — these are still inherent
//! methods on [`ReportGenerator`], just declared in a second `impl` block.

use serde_json::Value;

use super::report::{get_array, get_display, get_str, get_u64, truncate_chars, ReportGenerator};

impl ReportGenerator {
    pub(super) fn generate_summary(&self) -> String {
        let links = self.get("links");
        let mermaid = self.get("mermaid");
        let ascii_report = self.get("ascii");
        let archive = self.get("archive");
        let stubs = self.get("stubs");

        let mut rows: Vec<Vec<String>> = Vec::new();

        let broken_links = get_array(links, "broken_links").len();
        if broken_links > 0 {
            rows.push(vec![
                "Broken Links".into(),
                broken_links.to_string(),
                "High".into(),
            ]);
        }

        let orphan_docs = get_array(links, "orphan_docs").len();
        if orphan_docs > 0 {
            rows.push(vec![
                "Orphan Documents".into(),
                orphan_docs.to_string(),
                "Medium".into(),
            ]);
        }

        let invalid_mermaid = get_u64(mermaid, "invalid_diagrams", 0);
        if invalid_mermaid > 0 {
            rows.push(vec![
                "Invalid Mermaid Diagrams".into(),
                invalid_mermaid.to_string(),
                "Medium".into(),
            ]);
        }

        let ascii_diagrams = get_u64(ascii_report, "high_confidence", 0);
        if ascii_diagrams > 0 {
            rows.push(vec![
                "ASCII Diagrams to Convert".into(),
                ascii_diagrams.to_string(),
                "Low".into(),
            ]);
        }

        let working_docs = get_u64(archive, "total_found", 0);
        if working_docs > 0 {
            rows.push(vec![
                "Working Documents to Archive".into(),
                working_docs.to_string(),
                "Low".into(),
            ]);
        }

        let stubs_summary = stubs
            .get("summary")
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
        let error_count = get_u64(&stubs_summary, "error_count", 0);
        if error_count > 0 {
            rows.push(vec![
                "Critical Stubs (Errors)".into(),
                error_count.to_string(),
                "High".into(),
            ]);
        }
        let warning_count = get_u64(&stubs_summary, "warning_count", 0);
        if warning_count > 0 {
            rows.push(vec![
                "TODOs/FIXMEs".into(),
                warning_count.to_string(),
                "Medium".into(),
            ]);
        }

        if rows.is_empty() {
            return "**No issues found!** Documentation is clean.\n".to_string();
        }

        Self::format_table(&["Category", "Count", "Severity"], &rows)
    }

    pub(super) fn generate_broken_links_section(&self) -> String {
        let links = self.get("links");
        let broken = get_array(links, "broken_links");

        if broken.is_empty() {
            return "_No broken links found._\n".to_string();
        }

        let internal: Vec<&Value> = broken
            .iter()
            .filter(|b| get_str(b, "link_type", "") != "external")
            .copied()
            .collect();
        let external: Vec<&Value> = broken
            .iter()
            .filter(|b| get_str(b, "link_type", "") == "external")
            .copied()
            .collect();

        let mut sections = Vec::new();

        if !internal.is_empty() {
            sections.push("### Internal Links\n".to_string());
            let rows: Vec<Vec<String>> = internal
                .iter()
                .take(20)
                .map(|b| {
                    vec![
                        get_str(b, "source_file", "N/A").to_string(),
                        get_display(b, "line_number", "N/A"),
                        truncate_chars(get_str(b, "link_target", "N/A"), 50),
                        truncate_chars(get_str(b, "error_message", "Not found"), 30),
                    ]
                })
                .collect();
            sections.push(Self::format_table(
                &["File", "Line", "Link", "Error"],
                &rows,
            ));
            if internal.len() > 20 {
                sections.push(format!("_...and {} more_\n", internal.len() - 20));
            }
        }

        if !external.is_empty() {
            sections.push("### External Links\n".to_string());
            let rows: Vec<Vec<String>> = external
                .iter()
                .take(10)
                .map(|b| {
                    vec![
                        get_str(b, "source_file", "N/A").to_string(),
                        get_display(b, "line_number", "N/A"),
                        truncate_chars(get_str(b, "link_target", "N/A"), 40),
                        truncate_chars(get_str(b, "error_message", "Failed"), 20),
                    ]
                })
                .collect();
            sections.push(Self::format_table(
                &["File", "Line", "URL", "Status"],
                &rows,
            ));
        }

        sections.join("\n")
    }

    pub(super) fn generate_orphan_docs_section(&self) -> String {
        let links = self.get("links");
        let orphans = get_array(links, "orphan_docs");

        if orphans.is_empty() {
            return "_No orphan documents found._\n".to_string();
        }

        let mut lines = vec!["Documents with no inbound links:\n".to_string()];
        for orphan in orphans.iter().take(20) {
            lines.push(format!("- `{}`", orphan.as_str().unwrap_or_default()));
        }
        if orphans.len() > 20 {
            lines.push(format!("\n_...and {} more_", orphans.len() - 20));
        }

        format!("{}\n", lines.join("\n"))
    }

    pub(super) fn generate_mermaid_section(&self) -> String {
        let mermaid = self.get("mermaid");
        let invalid = get_array(mermaid, "invalid_diagram_list");

        if invalid.is_empty() {
            return "_All mermaid diagrams are valid._\n".to_string();
        }

        let rows: Vec<Vec<String>> = invalid
            .iter()
            .take(15)
            .map(|d| {
                vec![
                    get_str(d, "file", "N/A").to_string(),
                    get_display(d, "start_line", "N/A"),
                    get_str(d, "diagram_type", "unknown").to_string(),
                    truncate_chars(get_str(d, "error_message", "Unknown error"), 40),
                ]
            })
            .collect();

        let mut result = Self::format_table(&["File", "Line", "Type", "Error"], &rows);
        if invalid.len() > 15 {
            result.push_str(&format!("\n_...and {} more_\n", invalid.len() - 15));
        }
        result
    }

    pub(super) fn generate_ascii_section(&self) -> String {
        let ascii_report = self.get("ascii");
        let diagrams = get_array(ascii_report, "priority_conversions");

        if diagrams.is_empty() {
            return "_No ASCII diagrams requiring conversion._\n".to_string();
        }

        let rows: Vec<Vec<String>> = diagrams
            .iter()
            .take(10)
            .map(|d| {
                vec![
                    get_str(d, "file", "N/A").to_string(),
                    format!(
                        "{}-{}",
                        get_display(d, "start_line", "?"),
                        get_display(d, "end_line", "?")
                    ),
                    get_str(d, "diagram_type", "unknown").to_string(),
                    truncate_chars(get_str(d, "suggestion", ""), 30),
                ]
            })
            .collect();

        let mut result = Self::format_table(&["File", "Lines", "Type", "Suggestion"], &rows);

        let total = get_u64(ascii_report, "total_detected", 0);
        if total > 10 {
            result.push_str(&format!(
                "\n_...and {} more potential diagrams_\n",
                total - 10
            ));
        }
        result
    }

    pub(super) fn generate_archive_section(&self) -> String {
        let archive = self.get("archive");
        let docs = get_array(archive, "working_docs");

        if docs.is_empty() {
            return "_No working documents to archive._\n".to_string();
        }

        let rows: Vec<Vec<String>> = docs
            .iter()
            .take(15)
            .map(|d| {
                vec![
                    get_str(d, "file", "N/A").to_string(),
                    get_str(d, "suggested_archive_path", "N/A").to_string(),
                    truncate_chars(get_str(d, "reason", "N/A"), 40),
                ]
            })
            .collect();

        let mut result =
            Self::format_table(&["Current Location", "Suggested Archive", "Reason"], &rows);
        if docs.len() > 15 {
            result.push_str(&format!("\n_...and {} more_\n", docs.len() - 15));
        }
        result
    }

    pub(super) fn generate_stubs_section(&self) -> String {
        let stubs = self.get("stubs");
        let mut sections = Vec::new();

        let stub_list = get_array(stubs, "stubs");
        if !stub_list.is_empty() {
            sections.push("### Critical Stubs\n".to_string());
            let rows: Vec<Vec<String>> = stub_list
                .iter()
                .take(10)
                .map(|s| {
                    vec![
                        get_str(s, "file", "N/A").to_string(),
                        get_display(s, "line_number", "N/A"),
                        get_str(s, "marker_type", "N/A").replace("STUB:", ""),
                        truncate_chars(get_str(s, "content", "N/A"), 40),
                    ]
                })
                .collect();
            sections.push(Self::format_table(
                &["File", "Line", "Type", "Content"],
                &rows,
            ));
        }

        let fixmes = get_array(stubs, "fixmes");
        if !fixmes.is_empty() {
            sections.push("### FIXMEs and Bugs\n".to_string());
            let rows: Vec<Vec<String>> = fixmes
                .iter()
                .take(10)
                .map(|f| {
                    vec![
                        get_str(f, "file", "N/A").to_string(),
                        get_display(f, "line_number", "N/A"),
                        get_str(f, "marker_type", "N/A").to_string(),
                        truncate_chars(get_str(f, "content", "N/A"), 40),
                    ]
                })
                .collect();
            sections.push(Self::format_table(
                &["File", "Line", "Type", "Content"],
                &rows,
            ));
        }

        let todos = get_array(stubs, "todos");
        if !todos.is_empty() {
            sections.push("### TODOs\n".to_string());
            let rows: Vec<Vec<String>> = todos
                .iter()
                .take(15)
                .map(|t| {
                    vec![
                        get_str(t, "file", "N/A").to_string(),
                        get_display(t, "line_number", "N/A"),
                        truncate_chars(get_str(t, "content", "N/A"), 50),
                    ]
                })
                .collect();
            sections.push(Self::format_table(&["File", "Line", "Content"], &rows));
            if todos.len() > 15 {
                sections.push(format!("_...and {} more TODOs_\n", todos.len() - 15));
            }
        }

        if sections.is_empty() {
            return "_No stubs or TODOs found._\n".to_string();
        }

        sections.join("\n")
    }
}
