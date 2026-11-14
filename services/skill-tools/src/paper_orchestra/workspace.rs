//! Workspace scaffolding, input validation and the idea/log consistency gate.
//!
//! Derived from `init_workspace.py`, `validate_inputs.py`,
//! `check_idea_density.py` and `validate_consistency.py`. The skill is tuned
//! for arXiv preprints, so the workspace has two required inputs
//! (`idea.md`, `experimental_log.md`) and an optional `figures/` directory;
//! there is no `template.tex` and no conference-guidelines file.

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

/// Directories created by [`init_workspace`], relative to the workspace root.
pub const WORKSPACE_DIRS: &[&str] = &[
    "inputs",
    "inputs/figures",
    "figures",
    "drafts",
    "refinement",
    "final",
];

const INPUTS_README: &str = "# Inputs\n\n\
The paper-orchestra pipeline expects the two files below in this directory\n\
before you start. Optional figures go in `figures/`.\n\n\
## Required\n\n\
- `idea.md`             — Idea Summary (sparse or dense; see io-contract.md)\n\
- `experimental_log.md` — Setup, raw numeric data, qualitative observations\n\n\
## Optional\n\n\
- `figures/`            — Pre-existing figures (PNG/PDF/JPG). If empty, the\n\
                          plotting agent generates everything from scratch.\n\n\
Target venue is arXiv: no page limit, no anonymisation, no template file.\n\
The skill supplies the arXiv defaults.\n";

/// Outcome of [`init_workspace`].
#[derive(Debug)]
pub enum InitOutcome {
    /// Scaffolded; carries the absolute workspace path.
    Created(std::path::PathBuf),
    /// The directory is non-empty and `force` was not set.
    NonEmpty(std::path::PathBuf),
}

/// Scaffolds a workspace tree and a README inside `inputs/`.
///
/// # Errors
///
/// Any I/O error from creating directories or writing the README.
pub fn init_workspace(out: &Path, force: bool) -> std::io::Result<InitOutcome> {
    let out = if out.is_absolute() {
        out.to_path_buf()
    } else {
        std::env::current_dir()?.join(out)
    };
    if out.is_dir() && std::fs::read_dir(&out)?.next().is_some() && !force {
        return Ok(InitOutcome::NonEmpty(out));
    }
    for sub in WORKSPACE_DIRS {
        std::fs::create_dir_all(out.join(sub))?;
    }
    let readme = out.join("inputs").join("README.md");
    if !readme.exists() {
        std::fs::write(&readme, INPUTS_README)?;
    }
    Ok(InitOutcome::Created(out))
}

/// Severity of one validation message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Informational or passing.
    Pass,
    /// Non-blocking.
    Warn,
    /// Blocking.
    Fail,
}

/// One validation message.
#[derive(Debug, Clone)]
pub struct Check {
    /// Severity.
    pub level: Level,
    /// Human-readable text.
    pub message: String,
}

impl Check {
    fn new(level: Level, message: impl Into<String>) -> Self {
        Self {
            level,
            message: message.into(),
        }
    }
}

/// Thresholds for the density checks.
#[derive(Debug, Clone, Copy)]
pub struct DensityOpts {
    /// Minimum word count of `idea.md`.
    pub min_idea_words: usize,
    /// Minimum markdown tables in the log (a shortfall only warns).
    pub min_tables: usize,
    /// Minimum numeric values in the log.
    pub min_numeric_values: usize,
}

impl Default for DensityOpts {
    fn default() -> Self {
        Self {
            min_idea_words: 50,
            min_tables: 1,
            min_numeric_values: 5,
        }
    }
}

static NUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-?\d+\.?\d*").expect("num regex"));
static TABLE_SEP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\|[-| :]+\|").expect("table sep regex"));
static WORD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[a-z]+").expect("word regex"));
static LEAK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:see|in|from)\s+(?:Figure|Fig\.|Table|Tab\.)\s*\d+").expect("leak regex")
});

fn tokens(text: &str) -> BTreeSet<String> {
    WORD_RE
        .find_iter(&text.to_lowercase())
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Jaccard similarity of two token sets (0.0 when both are empty).
#[must_use]
pub fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

/// Density checks over the two input texts (word count, hypothesis signal,
/// tables, numeric values, duplication).
#[must_use]
pub fn density_checks(idea: &str, log: &str, opts: DensityOpts) -> Vec<Check> {
    let mut out = Vec::new();
    let words = idea.split_whitespace().count();
    if words >= opts.min_idea_words {
        out.push(Check::new(
            Level::Pass,
            format!("idea.md: {words} words (min: {})", opts.min_idea_words),
        ));
    } else {
        out.push(Check::new(
            Level::Fail,
            format!(
                "idea.md: {words} words (min: {}) — word count {words} < {}",
                opts.min_idea_words, opts.min_idea_words
            ),
        ));
    }
    let lower = idea.to_lowercase();
    match [
        "hypothesis",
        "propose",
        "method",
        "approach",
        "contribution",
    ]
    .iter()
    .find(|s| lower.contains(**s))
    {
        Some(s) => out.push(Check::new(
            Level::Pass,
            format!("idea.md: contains hypothesis signal (\"{s}\")"),
        )),
        None => out.push(Check::new(
            Level::Fail,
            "idea.md: no hypothesis signal found (need one of: hypothesis, propose, method, \
             approach, contribution)",
        )),
    }
    let tables = TABLE_SEP_RE.find_iter(log).count();
    if tables >= opts.min_tables {
        out.push(Check::new(
            Level::Pass,
            format!(
                "experimental_log.md: {tables} tables found (min: {})",
                opts.min_tables
            ),
        ));
    } else {
        out.push(Check::new(
            Level::Warn,
            format!(
                "experimental_log.md: {tables} markdown tables found (min: {}). Prose-format \
                 logs are accepted when numeric values meet the threshold.",
                opts.min_tables
            ),
        ));
    }
    let numerics = NUM_RE.find_iter(log).count();
    if numerics >= opts.min_numeric_values {
        out.push(Check::new(
            Level::Pass,
            format!(
                "experimental_log.md: {numerics} numeric values (min: {})",
                opts.min_numeric_values
            ),
        ));
    } else {
        out.push(Check::new(
            Level::Fail,
            format!(
                "experimental_log.md: {numerics} numeric values (min: {}) — too few",
                opts.min_numeric_values
            ),
        ));
    }
    let sim = jaccard(&tokens(idea), &tokens(log));
    if sim < 0.5 {
        out.push(Check::new(
            Level::Pass,
            format!("idea.md / experimental_log.md not duplicates (Jaccard: {sim:.2})"),
        ));
    } else {
        out.push(Check::new(
            Level::Fail,
            format!(
                "idea.md / experimental_log.md appear to be duplicates (Jaccard: {sim:.2} >= 0.50)"
            ),
        ));
    }
    out
}

/// Structural checks of the two input texts: recommended headings (warnings)
/// and figure/table references in the log (an error: the log must be
/// self-contained).
#[must_use]
pub fn structure_checks(idea: &str, log: &str) -> Vec<Check> {
    let mut out = Vec::new();
    let missing: Vec<&str> = ["Problem Statement", "Core Hypothesis"]
        .into_iter()
        .filter(|h| {
            Regex::new(&format!(r"(?m)^#+\s*{}", regex::escape(h)))
                .map(|r| !r.is_match(idea))
                .unwrap_or(true)
        })
        .collect();
    if !missing.is_empty() {
        out.push(Check::new(
            Level::Warn,
            format!("idea.md missing recommended headings: {missing:?}"),
        ));
    }
    static SETUP: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?m)^##\s+1\.?\s*Experimental Setup").expect("setup re"));
    static RAW: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?m)^##\s+2\.?\s*Raw Numeric Data").expect("raw re"));
    if !SETUP.is_match(log) {
        out.push(Check::new(
            Level::Warn,
            "experimental_log.md missing '## 1. Experimental Setup' heading",
        ));
    }
    if !RAW.is_match(log) {
        out.push(Check::new(
            Level::Warn,
            "experimental_log.md missing '## 2. Raw Numeric Data' heading",
        ));
    }
    let leaks: Vec<&str> = LEAK_RE.find_iter(log).map(|m| m.as_str()).take(3).collect();
    if !leaks.is_empty() {
        out.push(Check::new(
            Level::Fail,
            format!(
                "experimental_log.md contains figure/table references ({leaks:?}...). Per \
                 App. F.2 the log must be self-contained."
            ),
        ));
    }
    out
}

/// Result of [`validate_workspace`].
#[derive(Debug)]
pub struct InputsReport {
    /// Messages in print order.
    pub checks: Vec<Check>,
    /// Process exit code: 0 pass, 1 blocking failure, 2 file not found.
    pub exit: i32,
}

/// Validates `<workspace>/inputs/{idea.md,experimental_log.md}`.
///
/// Missing directory or files exit 2 (as `check_idea_density.py` did for a
/// missing file); empty files and blocking checks exit 1; warnings alone exit 0.
#[must_use]
pub fn validate_workspace(ws: &Path, opts: DensityOpts) -> InputsReport {
    let inputs = ws.join("inputs");
    let mut checks = Vec::new();
    if !inputs.is_dir() {
        checks.push(Check::new(
            Level::Fail,
            format!(
                "{} does not exist. Run `paper-orchestra init` first.",
                inputs.display()
            ),
        ));
        return InputsReport { checks, exit: 2 };
    }
    let mut texts = Vec::new();
    for name in ["idea.md", "experimental_log.md"] {
        let p = inputs.join(name);
        if !p.is_file() {
            checks.push(Check::new(Level::Fail, format!("MISSING: {}", p.display())));
            continue;
        }
        match std::fs::read(&p) {
            Ok(b) if b.is_empty() => {
                checks.push(Check::new(Level::Fail, format!("EMPTY: {}", p.display())));
            }
            Ok(b) => texts.push(String::from_utf8_lossy(&b).into_owned()),
            Err(e) => checks.push(Check::new(
                Level::Fail,
                format!("cannot read {}: {e}", p.display()),
            )),
        }
    }
    if checks.iter().any(|c| c.level == Level::Fail) {
        let missing = checks.iter().any(|c| c.message.starts_with("MISSING"));
        return InputsReport {
            checks,
            exit: if missing { 2 } else { 1 },
        };
    }
    let (idea, log) = (&texts[0], &texts[1]);
    checks.extend(structure_checks(idea, log));
    checks.extend(density_checks(idea, log, opts));
    let figs = inputs.join("figures");
    let n_figs = std::fs::read_dir(&figs)
        .map(|rd| {
            rd.flatten()
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    [".png", ".pdf", ".jpg", ".jpeg"]
                        .iter()
                        .any(|x| n.ends_with(x))
                })
                .count()
        })
        .ok();
    checks.push(Check::new(
        Level::Pass,
        match n_figs {
            Some(n) => format!("{n} pre-existing figure(s) in inputs/figures/"),
            None => "no inputs/figures/ — plotting agent will generate everything".to_string(),
        },
    ));
    let exit = i32::from(checks.iter().any(|c| c.level == Level::Fail));
    InputsReport { checks, exit }
}

// ---------------------------------------------------------------- consistency

static TABLE_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\|(.+)\|\s*$\n\|[-| :]+\|").expect("header re"));
static CELL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z][\w\s\-@%]*$").expect("cell re"));
static METRIC_COLON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b([A-Z][a-zA-Z0-9\-@%]{1,20})\s*:").expect("colon re"));
static DATASET_CTX_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:dataset|benchmark|evaluated\s+on|trained\s+on|tested\s+on|on\s+the)\s+([A-Z][A-Za-z0-9\-_]{2,30}(?:\s*[-/]\s*[A-Za-z0-9]+)?)",
    )
    .expect("dataset re")
});
static ALLCAPS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b([A-Z]{3,10}(?:-[A-Z0-9]+)?)\b").expect("caps re"));
static TABLE_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)((?:^\|.+\|\s*$\n)+)").expect("block re"));

/// Metric names found in the log: table header cells plus `Name:` labels.
#[must_use]
pub fn extract_metric_names(log: &str) -> Vec<String> {
    const NON_METRICS: &[&str] = &[
        "Note",
        "Warning",
        "Error",
        "Table",
        "Figure",
        "Section",
        "Results",
        "Setup",
        "Config",
        "Method",
        "Model",
        "Dataset",
        "Baseline",
        "Experiment",
        "Run",
        "Step",
        "Epoch",
        "Loss",
    ];
    let mut metrics = BTreeSet::new();
    for m in TABLE_HEADER_RE.captures_iter(log) {
        for cell in m[1].split('|').map(str::trim).filter(|c| !c.is_empty()) {
            let n = cell.chars().count();
            if CELL_RE.is_match(cell) && (2..=30).contains(&n) {
                metrics.insert(cell.to_string());
            }
        }
    }
    for m in METRIC_COLON_RE.captures_iter(log) {
        if !NON_METRICS.contains(&&m[1]) {
            metrics.insert(m[1].to_string());
        }
    }
    metrics.into_iter().collect()
}

/// Dataset or benchmark names found in the log.
#[must_use]
pub fn extract_dataset_names(log: &str) -> Vec<String> {
    const EXCLUDE: &[&str] = &[
        "GPU", "CPU", "RAM", "SSD", "API", "LLM", "NLP", "CV", "ML", "DL", "AI", "SGD", "RNN",
        "CNN", "GAN", "VAE", "BERT", "TODO", "FIXME", "NOTE", "MAX", "MIN", "AVG", "STD",
    ];
    let mut out = BTreeSet::new();
    for m in DATASET_CTX_RE.captures_iter(log) {
        let cand = m[1].trim();
        if cand.starts_with(|c: char| c.is_ascii_uppercase()) && cand.chars().count() >= 3 {
            out.insert(cand.to_string());
        }
    }
    for line in log
        .lines()
        .filter(|l| l.contains('|') && !l.contains("---"))
    {
        for m in ALLCAPS_RE.captures_iter(line) {
            if !EXCLUDE.contains(&&m[1]) {
                out.insert(m[1].to_string());
            }
        }
    }
    out.into_iter().collect()
}

/// For each markdown table block (1-based), the count of non-zero numbers.
#[must_use]
pub fn nonzero_numerics_per_table(log: &str) -> Vec<(usize, usize)> {
    TABLE_BLOCK_RE
        .captures_iter(log)
        .enumerate()
        .map(|(i, m)| {
            let n = NUM_RE
                .find_iter(&m[1])
                .filter(|n| n.as_str().parse::<f64>().map(|v| v != 0.0).unwrap_or(false))
                .count();
            (i + 1, n)
        })
        .collect()
}

/// Result of [`consistency_check`].
#[derive(Debug)]
pub struct ConsistencyReport {
    /// Printed report.
    pub text: String,
    /// Number of warnings (exit 1 when non-zero).
    pub warnings: usize,
}

/// Cross-validates `idea` against `log`: metric alignment, dataset alignment
/// (at least half of the datasets named) and non-zero results in every table.
#[must_use]
pub fn consistency_check(idea: &str, log: &str) -> ConsistencyReport {
    let mut text = String::new();
    let mut warnings: Vec<String> = Vec::new();
    let idea_lower = idea.to_lowercase();

    let metrics = extract_metric_names(log);
    if metrics.is_empty() {
        let _ = writeln!(
            text,
            "[WARN] Metric extraction: no metric names detected in experimental_log.md tables — \
             check table formatting"
        );
        warnings.push("Could not extract metric names from experimental_log.md".into());
    } else {
        let matched: Vec<&String> = metrics
            .iter()
            .filter(|m| idea_lower.contains(&m.to_lowercase()))
            .collect();
        if matched.is_empty() {
            let _ = writeln!(
                text,
                "[WARN] Metric alignment: 0/{} metrics from experimental_log.md appear in idea.md",
                metrics.len()
            );
            let _ = writeln!(
                text,
                "       Metrics detected in log: {:?}",
                &metrics[..metrics.len().min(10)]
            );
            let _ = writeln!(
                text,
                "       The idea should mention what it is measuring. Verify the idea describes \
                 the same evaluation as the experiments."
            );
            warnings.push("No metrics from experimental_log.md found in idea.md".into());
        } else {
            let _ = writeln!(
                text,
                "[PASS] Metric alignment: {}/{} metrics from log found in idea.md (e.g., {:?})",
                matched.len(),
                metrics.len(),
                &matched[..matched.len().min(3)]
            );
        }
    }

    let datasets = extract_dataset_names(log);
    if datasets.is_empty() {
        let _ = writeln!(
            text,
            "[WARN] Dataset extraction: no dataset names detected in experimental_log.md — check \
             that dataset names appear in table context"
        );
        warnings.push("Could not extract dataset names from experimental_log.md".into());
    } else {
        let matched = datasets
            .iter()
            .filter(|d| idea_lower.contains(&d.to_lowercase()))
            .count();
        let coverage = matched as f64 / datasets.len() as f64;
        if coverage >= 0.5 {
            let _ = writeln!(
                text,
                "[PASS] Dataset alignment: {matched}/{} datasets from log found in idea.md \
                 ({:.0}% coverage)",
                datasets.len(),
                coverage * 100.0
            );
        } else {
            let _ = writeln!(
                text,
                "[WARN] Dataset alignment: {matched}/{} datasets from log found in idea.md \
                 ({:.0}% coverage, need >=50%)",
                datasets.len(),
                coverage * 100.0
            );
            let missing: Vec<&String> = datasets
                .iter()
                .filter(|d| !idea_lower.contains(&d.to_lowercase()))
                .take(5)
                .collect();
            let _ = writeln!(
                text,
                "       Datasets in log not mentioned in idea: {missing:?}"
            );
            warnings.push(format!(
                "Only {:.0}% of datasets from log mentioned in idea.md",
                coverage * 100.0
            ));
        }
    }

    let tables = nonzero_numerics_per_table(log);
    if tables.is_empty() {
        let _ = writeln!(
            text,
            "[WARN] No tables found in experimental_log.md — run `paper-orchestra validate-inputs` \
             to verify table count"
        );
        warnings.push("No tables found in experimental_log.md".into());
    } else {
        let zero: Vec<usize> = tables.iter().filter(|t| t.1 == 0).map(|t| t.0).collect();
        if zero.is_empty() {
            let _ = writeln!(
                text,
                "[PASS] Result coverage: all {} table(s) contain at least one non-zero numeric value",
                tables.len()
            );
        } else {
            let _ = writeln!(
                text,
                "[WARN] Zero-result tables: table(s) {zero:?} contain only zero or no numeric \
                 values — verify results are present"
            );
            warnings.push(format!("Tables {zero:?} have no non-zero numeric results"));
        }
    }

    text.push('\n');
    if warnings.is_empty() {
        text.push_str("Consistency check: PASS\n");
    } else {
        let _ = writeln!(
            text,
            "Consistency check: WARN ({} issue(s) found — non-blocking)",
            warnings.len()
        );
        for w in &warnings {
            let _ = writeln!(text, "  - {w}");
        }
        text.push_str(
            "\nThese are warnings, not errors. The pipeline will continue. Address warnings \
             before submission.\n",
        );
    }
    ConsistencyReport {
        text,
        warnings: warnings.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDEA: &str = "# Problem Statement\nWe study CIFAR-10 accuracy.\n# Core Hypothesis\n\
We propose a method that improves Accuracy on CIFAR-10 by regularising features across \
training epochs, which is our main approach and contribution to the field of vision, and we validate it \
with controlled comparisons against strong published baselines under matched training budgets.";
    const LOG: &str = "## 1. Experimental Setup\nTrained on CIFAR-10.\n## 2. Raw Numeric Data\n\
| Model | Accuracy | F1 |\n|---|---|---|\n| Ours | 91.2 | 0.88 |\n| Base | 89.5 | 0.84 |\n";

    #[test]
    fn init_creates_tree_and_refuses_non_empty() {
        let d = tempfile::tempdir().unwrap();
        let ws = d.path().join("ws");
        assert!(matches!(
            init_workspace(&ws, false).unwrap(),
            InitOutcome::Created(_)
        ));
        assert!(ws.join("inputs/figures").is_dir());
        assert!(!ws.join("inputs/template.tex").exists());
        let readme = std::fs::read_to_string(ws.join("inputs/README.md")).unwrap();
        assert!(readme.contains("idea.md") && !readme.contains("template.tex"));
        assert!(matches!(
            init_workspace(&ws, false).unwrap(),
            InitOutcome::NonEmpty(_)
        ));
        assert!(matches!(
            init_workspace(&ws, true).unwrap(),
            InitOutcome::Created(_)
        ));
    }

    #[test]
    fn validate_reports_missing_empty_and_ok() {
        let d = tempfile::tempdir().unwrap();
        let r = validate_workspace(d.path(), DensityOpts::default());
        assert_eq!(r.exit, 2);
        std::fs::create_dir_all(d.path().join("inputs")).unwrap();
        let r = validate_workspace(d.path(), DensityOpts::default());
        assert_eq!(r.exit, 2);
        std::fs::write(d.path().join("inputs/idea.md"), "").unwrap();
        std::fs::write(d.path().join("inputs/experimental_log.md"), LOG).unwrap();
        let r = validate_workspace(d.path(), DensityOpts::default());
        assert_eq!(r.exit, 1);
        std::fs::write(d.path().join("inputs/idea.md"), IDEA).unwrap();
        let r = validate_workspace(d.path(), DensityOpts::default());
        assert_eq!(r.exit, 0, "{:?}", r.checks);
    }

    #[test]
    fn leaks_and_duplicates_are_fatal() {
        let leaky = format!("{LOG}\nAs shown in Figure 3 the gap widens.\n");
        let c = structure_checks(IDEA, &leaky);
        assert!(c.iter().any(|c| c.level == Level::Fail));
        let c = density_checks(IDEA, IDEA, DensityOpts::default());
        assert!(c
            .iter()
            .any(|c| c.level == Level::Fail && c.message.contains("duplicates")));
    }

    #[test]
    fn prose_log_without_tables_only_warns_on_tables() {
        let log = "Accuracy was 91.2 then 92.3 then 93.4 then 94.5 then 95.6 overall.";
        let c = density_checks(IDEA, log, DensityOpts::default());
        assert!(c.iter().any(|c| c.level == Level::Warn));
        assert!(!c
            .iter()
            .any(|c| c.level == Level::Fail && c.message.contains("tables")));
    }

    #[test]
    fn consistency_passes_aligned_inputs_and_warns_on_zero_tables() {
        let r = consistency_check(IDEA, LOG);
        assert_eq!(r.warnings, 0, "{}", r.text);
        let zero = "| Model | Accuracy |\n|---|---|\n| Ours | 0 |\n";
        let r = consistency_check(IDEA, zero);
        assert!(r.warnings >= 1);
        assert!(r.text.contains("Zero-result"));
    }

    #[test]
    fn consistency_warns_when_metrics_absent_from_idea() {
        let r = consistency_check("Totally unrelated words only.", LOG);
        assert!(r.text.contains("Metric alignment: 0/"));
        assert!(r.warnings >= 1);
    }
}
