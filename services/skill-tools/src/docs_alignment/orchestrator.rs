//! Port of `docs_alignment.py`'s `DocumentationAligner`: runs the four
//! ported validators as sibling Rust binaries, the two still-Python scripts
//! (`archive_working_docs.py`, `scan_stubs.py`) via `python3`, then the
//! report generator, printing the same progress/summary output.
//!
//! ## Sibling-process path resolution
//!
//! - The four ported binaries (`docs-validate-links`, `docs-check-mermaid`,
//!   `docs-detect-ascii`, `docs-generate-report`) are resolved relative to
//!   `std::env::current_exe()`'s parent directory — cargo places every `[[bin]]`
//!   from one crate in the same `target/<profile>/` directory, so this is the
//!   direct Rust equivalent of Python's `Path(__file__).parent`.
//! - The two remaining Python scripts are resolved via a `scripts_dir`: an
//!   explicit `--scripts-dir` override if given, otherwise the first
//!   `skills/docs-alignment/scripts/` directory found by walking upward from
//!   the current working directory (falling back to
//!   `<cwd>/skills/docs-alignment/scripts` so a missing directory still hits
//!   the same non-fatal "Script not found" path as Python did for a missing
//!   file).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

/// Which kind of sibling process to invoke for a validation step.
enum ScriptKind {
    /// A sibling Rust binary in the same `target/<profile>/` directory.
    Binary,
    /// A sibling Python script, invoked as `python3 <scripts_dir>/<name>`.
    Python,
}

pub struct DocumentationAligner {
    project_root: PathBuf,
    output_dir: PathBuf,
    bin_dir: PathBuf,
    scripts_dir: PathBuf,
    /// Step name -> output report path, populated eagerly (before the step
    /// actually runs) exactly as `docs_alignment.py::self.reports` is.
    reports: std::collections::BTreeMap<&'static str, PathBuf>,
}

/// Walk upward from `start` looking for `skills/docs-alignment/scripts/`;
/// falls back to `<start>/skills/docs-alignment/scripts` if never found.
fn find_scripts_dir(start: &Path) -> PathBuf {
    let mut dir = start.to_path_buf();
    loop {
        let candidate = dir.join("skills/docs-alignment/scripts");
        if candidate.is_dir() {
            return candidate;
        }
        if !dir.pop() {
            break;
        }
    }
    start.join("skills/docs-alignment/scripts")
}

impl DocumentationAligner {
    pub fn new(
        project_root: &Path,
        output_dir: Option<PathBuf>,
        scripts_dir_override: Option<PathBuf>,
    ) -> Self {
        let project_root =
            std::fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
        let output_dir = output_dir.unwrap_or_else(|| project_root.join(".doc-alignment-reports"));
        let bin_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."));
        let scripts_dir = scripts_dir_override.unwrap_or_else(|| {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            find_scripts_dir(&cwd)
        });

        Self {
            project_root,
            output_dir,
            bin_dir,
            scripts_dir,
            reports: std::collections::BTreeMap::new(),
        }
    }

    fn setup(&self) {
        let _ = std::fs::create_dir_all(&self.output_dir);
        println!("Output directory: {}", self.output_dir.display());
    }

    /// Run a sibling process the same way `docs_alignment.py::run_script`
    /// did: non-fatal "Script not found" if missing, a 300s timeout, stderr
    /// snippet on failure, and — crucially — a non-zero exit code is *not*
    /// treated as failure (it just means the validator found issues).
    async fn run_script(&self, kind: ScriptKind, name: &str, args: &[String]) -> bool {
        let (program, mut full_args): (PathBuf, Vec<String>) = match kind {
            ScriptKind::Binary => {
                let path = self.bin_dir.join(name);
                if !path.exists() {
                    println!("Warning: Script not found: {}", path.display());
                    return false;
                }
                (path, Vec::new())
            }
            ScriptKind::Python => {
                let path = self.scripts_dir.join(name);
                if !path.exists() {
                    println!("Warning: Script not found: {}", path.display());
                    return false;
                }
                (PathBuf::from("python3"), vec![path.display().to_string()])
            }
        };
        full_args.extend(args.iter().cloned());

        let preview: Vec<String> = std::iter::once(program.display().to_string())
            .chain(full_args.iter().cloned())
            .take(3)
            .collect();
        println!("\nRunning: {}...", preview.join(" "));

        let mut command = tokio::process::Command::new(&program);
        command.args(&full_args);

        match tokio::time::timeout(Duration::from_secs(300), command.output()).await {
            Ok(Ok(output)) => {
                // Non-zero exit is OK for validation scripts (means issues found).
                if !output.stderr.is_empty() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let snippet: String = stderr.chars().take(200).collect();
                    println!("  Stderr: {snippet}");
                }
                true
            }
            Ok(Err(e)) => {
                println!("  Error running {name}: {e}");
                false
            }
            Err(_) => {
                println!("  Timeout running {name}");
                false
            }
        }
    }

    async fn validate_links(&mut self) -> bool {
        let output_path = self.output_dir.join("link-report.json");
        self.reports.insert("links", output_path.clone());
        self.run_script(
            ScriptKind::Binary,
            "docs-validate-links",
            &[
                "--root".to_string(),
                self.project_root.display().to_string(),
                "--docs-dir".to_string(),
                "docs".to_string(),
                "--output".to_string(),
                output_path.display().to_string(),
            ],
        )
        .await
    }

    async fn check_mermaid(&mut self) -> bool {
        let output_path = self.output_dir.join("mermaid-report.json");
        self.reports.insert("mermaid", output_path.clone());

        let mut docs_path = self.project_root.join("docs");
        if !docs_path.exists() {
            docs_path = self.project_root.clone();
        }

        self.run_script(
            ScriptKind::Binary,
            "docs-check-mermaid",
            &[
                "--root".to_string(),
                docs_path.display().to_string(),
                "--output".to_string(),
                output_path.display().to_string(),
            ],
        )
        .await
    }

    async fn detect_ascii(&mut self) -> bool {
        let output_path = self.output_dir.join("ascii-report.json");
        self.reports.insert("ascii", output_path.clone());

        let mut docs_path = self.project_root.join("docs");
        if !docs_path.exists() {
            docs_path = self.project_root.clone();
        }

        self.run_script(
            ScriptKind::Binary,
            "docs-detect-ascii",
            &[
                "--root".to_string(),
                docs_path.display().to_string(),
                "--output".to_string(),
                output_path.display().to_string(),
            ],
        )
        .await
    }

    async fn archive_working(&mut self) -> bool {
        let output_path = self.output_dir.join("archive-report.json");
        self.reports.insert("archive", output_path.clone());
        self.run_script(
            ScriptKind::Python,
            "archive_working_docs.py",
            &[
                "--root".to_string(),
                self.project_root.display().to_string(),
                "--output".to_string(),
                output_path.display().to_string(),
            ],
        )
        .await
    }

    async fn scan_stubs(&mut self) -> bool {
        let output_path = self.output_dir.join("stubs-report.json");
        self.reports.insert("stubs", output_path.clone());
        self.run_script(
            ScriptKind::Python,
            "scan_stubs.py",
            &[
                "--root".to_string(),
                self.project_root.display().to_string(),
                "--output".to_string(),
                output_path.display().to_string(),
            ],
        )
        .await
    }

    async fn generate_report(&mut self) -> bool {
        let output_path = self
            .project_root
            .join("docs")
            .join("DOCUMENTATION_ISSUES.md");
        if let Some(parent) = output_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut args = vec![
            "--output".to_string(),
            output_path.display().to_string(),
            "--project-name".to_string(),
            self.project_root
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
        ];

        if let Some(p) = self.reports.get("links") {
            args.push("--link-report".to_string());
            args.push(p.display().to_string());
        }
        if let Some(p) = self.reports.get("mermaid") {
            args.push("--mermaid-report".to_string());
            args.push(p.display().to_string());
        }
        if let Some(p) = self.reports.get("ascii") {
            args.push("--ascii-report".to_string());
            args.push(p.display().to_string());
        }
        if let Some(p) = self.reports.get("archive") {
            args.push("--archive-report".to_string());
            args.push(p.display().to_string());
        }
        if let Some(p) = self.reports.get("stubs") {
            args.push("--stubs-report".to_string());
            args.push(p.display().to_string());
        }

        let success = self
            .run_script(ScriptKind::Binary, "docs-generate-report", &args)
            .await;

        if success {
            println!("\n{}", "=".repeat(60));
            println!("Final report: {}", output_path.display());
            println!("{}", "=".repeat(60));
        }

        success
    }

    pub async fn run_all(&mut self) -> Vec<(&'static str, bool)> {
        self.setup();

        println!("\n{}", "=".repeat(60));
        println!("Documentation Alignment - Full Scan");
        println!("Project: {}", self.project_root.display());
        println!("Started: {}", chrono::Local::now().to_rfc3339());
        println!("{}", "=".repeat(60));

        let mut results: Vec<(&'static str, bool)> = Vec::new();
        results.push(("links", self.validate_links().await));
        results.push(("mermaid", self.check_mermaid().await));
        results.push(("ascii", self.detect_ascii().await));
        results.push(("archive", self.archive_working().await));
        results.push(("stubs", self.scan_stubs().await));
        results.push(("report", self.generate_report().await));

        println!("\n{}", "=".repeat(60));
        println!("Scan Complete - Summary");
        println!("{}", "=".repeat(60));
        for (name, success) in &results {
            println!(
                "  {} {name}",
                if *success { "\u{2713}" } else { "\u{2717}" }
            );
        }

        self.print_quick_summary();

        results
    }

    fn print_quick_summary(&self) {
        println!("\n{}", "=".repeat(60));
        println!("Quick Summary");
        println!("{}", "=".repeat(60));

        let read_json = |path: &Path| -> Option<Value> {
            if !path.exists() {
                return None;
            }
            std::fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        };

        if let Some(path) = self.reports.get("links") {
            if let Some(data) = read_json(path) {
                let valid = data.get("valid_links").and_then(Value::as_u64).unwrap_or(0);
                let broken = data
                    .get("broken_links")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                let orphans = data
                    .get("orphan_docs")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                println!("  Links: {valid} valid, {broken} broken");
                println!("  Orphan docs: {orphans}");
            }
        }

        if let Some(path) = self.reports.get("mermaid") {
            if let Some(data) = read_json(path) {
                let valid = data
                    .get("valid_diagrams")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let invalid = data
                    .get("invalid_diagrams")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                println!("  Mermaid: {valid} valid, {invalid} invalid");
            }
        }

        if let Some(path) = self.reports.get("ascii") {
            if let Some(data) = read_json(path) {
                let total = data
                    .get("total_detected")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                println!("  ASCII diagrams: {total} detected");
            }
        }

        if let Some(path) = self.reports.get("archive") {
            if let Some(data) = read_json(path) {
                let total = data.get("total_found").and_then(Value::as_u64).unwrap_or(0);
                println!("  Working docs: {total} to archive");
            }
        }

        if let Some(path) = self.reports.get("stubs") {
            if let Some(data) = read_json(path) {
                let summary = data.get("summary").cloned().unwrap_or(Value::Null);
                let errors = summary
                    .get("error_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let warnings = summary
                    .get("warning_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                println!("  Stubs: {errors} errors, {warnings} warnings");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A missing sibling binary/script is a non-fatal warning, not a crash.
    #[tokio::test]
    async fn missing_sibling_script_is_non_fatal() {
        let tmp = tempfile::tempdir().unwrap();
        let aligner = DocumentationAligner::new(
            tmp.path(),
            None,
            Some(tmp.path().join("nonexistent-scripts")),
        );

        let ok = aligner
            .run_script(ScriptKind::Python, "does_not_exist.py", &[])
            .await;
        assert!(!ok);
    }

    /// A non-zero exit code from a sibling process is treated as success
    /// (matches `docs_alignment.py`: exit code is never inspected).
    #[tokio::test]
    async fn nonzero_exit_from_sibling_is_still_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let scripts_dir = tmp.path().join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        let fake_script = scripts_dir.join("fake_validator.py");
        fs::write(
            &fake_script,
            "#!/usr/bin/env python3\nimport sys\nsys.exit(1)\n",
        )
        .unwrap();

        let aligner = DocumentationAligner::new(tmp.path(), None, Some(scripts_dir));
        let ok = aligner
            .run_script(ScriptKind::Python, "fake_validator.py", &[])
            .await;
        assert!(ok);
    }

    #[test]
    fn find_scripts_dir_walks_upward() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("a/b/c");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(tmp.path().join("skills/docs-alignment/scripts")).unwrap();

        let found = find_scripts_dir(&nested);
        assert_eq!(found, tmp.path().join("skills/docs-alignment/scripts"));
    }
}
