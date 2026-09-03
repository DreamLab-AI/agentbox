//! Deterministic, no-LLM design anti-pattern scanner.
//!
//! Zero dependencies on a model or the network: regex/heuristic rules, inline
//! disable comments, text or JSON output. Implements the CLI-detectable layer
//! of the slop catalogue; the browser- and LLM-only layers are documented in
//! `references/slop-rules-catalog.md` for the agent to apply by judgment.
//!
//! Inline suppression (per-line or block):
//!     /* slop-disable overused-font */
//!     <!-- slop-disable nested-cards gradient-text -->
//!     /* slop-disable-next-line tiny-text */
//!
//! Exit code: the number of findings at or above --min-severity (capped at
//! 250), 0 when clean — so it can fail CI.

use std::io::IsTerminal;
use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::{run_cli, to_pretty_json_ascii, CliError};
use prose_sanitiser::exit;
use prose_sanitiser::slop::design::{by_rule, by_rule_ranked, scan, RuleFilter, Severity};
use serde_json::{json, Map, Value};

const RESET: &str = "\x1b[0m";

#[derive(Parser)]
#[command(about = "Deterministic design anti-pattern (slop) detector.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// Files or directories to scan
    #[arg(required = true)]
    paths: Vec<PathBuf>,
    /// Machine-readable output
    #[arg(long)]
    json: bool,
    /// Run only this rule
    #[arg(long)]
    rule: Option<String>,
    /// Rule id to skip (repeatable)
    #[arg(long)]
    ignore: Vec<String>,
    #[arg(long = "min-severity", value_parser = ["info", "warn", "error"], default_value = "info")]
    min_severity: String,
    /// Summary only
    #[arg(long)]
    quiet: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    let floor = Severity::parse(&args.min_severity).expect("clap restricts the value set");
    let filter = RuleFilter {
        only: args.rule.clone(),
        ignore: args.ignore.clone(),
    };
    // A path that is not there is a tool error, not a clean scan. Reporting
    // "clean" for a typo in a CI invocation is the worst possible answer: the
    // gate passes and nothing was ever read.
    if let Some(missing) = args.paths.iter().find(|path| !path.exists()) {
        return Err(CliError::new(
            exit::ERROR,
            format!("path not found: {}", missing.display()),
        ));
    }
    let shown = scan(&args.paths, &filter, floor);

    if args.json {
        let mut counts = Map::new();
        for (rule, count) in by_rule(&shown) {
            counts.insert(rule, json!(count));
        }
        println!(
            "{}",
            to_pretty_json_ascii(&json!({
                "findings": shown.iter().map(|f| f.to_json()).collect::<Vec<_>>(),
                "count": shown.len(),
                "by_rule": Value::Object(counts),
            }))
        );
        return Ok(exit::from_findings(shown.len()));
    }

    if shown.is_empty() {
        println!(
            "clean — no deterministic slop signals at or above '{}'.",
            args.min_severity
        );
        return Ok(exit::CLEAN);
    }

    if !args.quiet {
        let use_colour = std::io::stdout().is_terminal();
        // Sort a view for display only: the by-rule summary below counts in
        // scan order, so mutating `shown` here would reorder that summary.
        let mut ordered: Vec<&_> = shown.iter().collect();
        ordered.sort_by(|a, b| (&a.file, a.line).cmp(&(&b.file, b.line)));
        let mut current: Option<String> = None;
        for finding in ordered {
            if current.as_deref() != Some(finding.file.as_str()) {
                current = Some(finding.file.clone());
                println!("\n{}", finding.file);
            }
            let severity = finding.severity.as_str().to_uppercase();
            let severity = if use_colour {
                format!("{}{severity}{RESET}", finding.severity.colour())
            } else {
                severity
            };
            let location = if finding.line > 0 {
                format!(":{}", finding.line)
            } else {
                String::new()
            };
            println!(
                "  {location:<6} [{}] {severity}  {}",
                finding.rule, finding.message
            );
            if !finding.snippet.is_empty() {
                println!("          ↳ {}", finding.snippet);
            }
        }
    }

    let grouped = by_rule_ranked(&shown);
    println!(
        "\n{} finding(s) across {} rule(s):",
        shown.len(),
        grouped.len()
    );
    for (rule, count) in &grouped {
        println!("  {count:>3}  {rule}");
    }
    println!("\nThese are deterministic CLI-layer signals only. Apply the browser- and");
    println!("LLM-only layers from references/slop-rules-catalog.md by judgment.");
    Ok(exit::from_findings(shown.len()))
}
