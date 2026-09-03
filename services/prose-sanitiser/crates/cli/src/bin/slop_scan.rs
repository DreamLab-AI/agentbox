//! Scan prose / Markdown for AI writing tells.
//!
//! Detection mirrors Section B of the prose-sanitiser SKILL.md (lexical,
//! structural and spelling tells) plus the file-level density checks. It
//! catches the MECHANICAL tells only; narrative defaults (Section C) and
//! altitude/voice need a human read.
//!
//! Any line containing `slop-ignore` is skipped, so a deliberate stylistic
//! choice does not nag the audit.
//!
//! The exit code is the number of HIGH-severity findings, so CI can gate on it.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::{run_cli, to_pretty_json_ascii, CliError};
use prose_sanitiser::slop::prose::{scan, Finding};
use prose_sanitiser::slop::rules::Severity;
use serde_json::{json, Map, Value};

#[derive(Parser)]
#[command(about = "Scan prose/markdown for AI writing tells.")]
struct Args {
    path: PathBuf,
    /// Minimum severity to report (default: low = everything)
    #[arg(long, value_parser = ["high", "medium", "low"], default_value = "low")]
    severity: String,
    /// Machine-readable output
    #[arg(long)]
    json: bool,
    /// Max examples shown per rule (text mode)
    #[arg(long, default_value_t = 10)]
    max: usize,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

/// Group findings by `rule|label`, preserving first-seen order.
fn group(findings: &[Finding]) -> Vec<(String, Vec<&Finding>)> {
    let mut groups: Vec<(String, Vec<&Finding>)> = Vec::new();
    for finding in findings {
        let key = format!("{}|{}", finding.rule, finding.label);
        match groups.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, bucket)) => bucket.push(finding),
            None => groups.push((key, vec![finding])),
        }
    }
    groups
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if !args.path.exists() {
        return Err(CliError::new(
            2,
            format!("path not found: {}", args.path.display()),
        ));
    }
    let floor = Severity::parse(&args.severity).expect("clap restricts the value set");
    let result = scan(&args.path, floor);
    let counts = result.counts();
    let high = result.high();
    let weighted = result.weighted();
    let verdict = result.verdict();

    if args.json {
        let mut by_severity = Map::new();
        for (severity, count) in counts {
            if count > 0 {
                by_severity.insert(severity.as_str().to_string(), json!(count));
            }
        }
        println!(
            "{}",
            to_pretty_json_ascii(&json!({
                "path": args.path.display().to_string(),
                "files_scanned": result.files_scanned,
                "counts": Value::Object(by_severity),
                "slop_score": weighted,
                "verdict": verdict,
                "findings": result.findings.iter().map(Finding::to_json).collect::<Vec<_>>(),
            }))
        );
        return Ok(high as i32);
    }

    let mut groups = group(&result.findings);
    // Most severe first, then the busiest rule.
    groups.sort_by_key(|(_, items)| (items[0].severity.rank(), std::cmp::Reverse(items.len())));

    println!("\n  prose-sanitiser slop scan: {}", args.path.display());
    println!(
        "  files scanned: {}   findings: {}   slop score: {weighted}",
        result.files_scanned,
        result.findings.len()
    );
    println!("  verdict: {verdict}");
    println!(
        "  high: {}   medium: {}   low: {}\n",
        counts[0].1, counts[1].1, counts[2].1
    );

    if result.findings.is_empty() {
        println!(
            "  Nothing flagged. Either it is clean or the tells are narrative/voice ones a\n  \
             regex cannot see. Read it against Section C of SKILL.md.\n"
        );
        return Ok(0);
    }

    for (_, items) in &groups {
        let first = items[0];
        println!(
            "  [{}] {}  ({} hit{})",
            first.severity.as_str().to_uppercase(),
            first.label,
            items.len(),
            if items.len() == 1 { "" } else { "s" }
        );
        println!("        fix: {}", first.fix);
        for item in items.iter().take(args.max) {
            let location = if item.line > 0 {
                format!("{}:{}", item.file, item.line)
            } else {
                item.file.clone()
            };
            println!("        {location}  {}", item.snippet);
        }
        if items.len() > args.max {
            println!("        ... +{} more", items.len() - args.max);
        }
        println!();
    }

    let top: Vec<String> = groups
        .iter()
        .take(3)
        .map(|(_, items)| items[0].label.clone())
        .collect();
    println!("  Top things to change: {}", top.join("; "));
    println!("  Narrative and voice tells need eyes too. See Section C of SKILL.md.\n");
    Ok(high as i32)
}
