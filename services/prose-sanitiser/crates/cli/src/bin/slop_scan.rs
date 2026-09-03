//! Scan prose / Markdown for AI writing tells.
//!
//! Detection mirrors Section B of the prose-sanitiser SKILL.md (lexical,
//! structural and spelling tells) plus the file-level density checks. It
//! catches the MECHANICAL tells only; narrative defaults (Section C) and
//! altitude/voice need a human read.
//!
//! Any line containing `slop-ignore` is skipped, as is any span the
//! `<!-- prose-sanitiser-disable RULE -->` directives cover, so a deliberate
//! stylistic choice does not nag the audit.
//!
//! # Compatibility
//!
//! `--json` and the default text layout are byte-compatible with the previous
//! release: same keys, same order, same wording. Everything added here is
//! behind a new flag. The one deliberate change is the exit code, which is now
//! the workspace contract (0 clean, 1 findings, 2 error) rather than a count of
//! high-severity findings.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::{run_cli, to_pretty_json_ascii, CliError};
use prose_sanitiser::exit;
use prose_sanitiser::output::{render, OutputFormat};
use prose_sanitiser::settings::Settings;
use prose_sanitiser::slop::prose::{scan_with, Finding};
use prose_sanitiser::slop::rules::{rule_meta, Severity, CHANGELOG, RULESET_VERSION};
use prose_sanitiser_core::{Report, ToolMeta};
use serde_json::{json, Map, Value};

#[derive(Parser)]
#[command(
    about = "Scan prose/markdown for AI writing tells.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    path: PathBuf,
    /// Minimum severity to report (default: low = everything)
    #[arg(long, value_parser = ["high", "medium", "low"], default_value = "low")]
    severity: String,
    /// Machine-readable output (alias for --format json)
    #[arg(long)]
    json: bool,
    /// Output format
    #[arg(long, value_enum)]
    format: Option<OutputFormat>,
    /// Max examples shown per rule (text mode)
    #[arg(long, default_value_t = 10)]
    max: usize,
    /// Also report the whole-document structural measures
    #[arg(long)]
    structural: bool,
    /// Print the rule table with tiers, dates and sources, then exit
    #[arg(long = "explain-rules")]
    explain_rules: bool,
    /// Configuration file (default: nearest .prose-sanitiser.toml)
    #[arg(long)]
    config: Option<PathBuf>,
    /// Rule to skip; repeatable
    #[arg(long = "disable")]
    disable: Vec<String>,
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

/// The rule table, its tiers, its dates and the ruleset changelog.
fn explain_rules() -> i32 {
    println!("prose-sanitiser slop ruleset {RULESET_VERSION}\n");
    println!(
        "  {:<42}  {:<8}  {:<26}  {:<10}  REVIEWED",
        "RULE", "SEVERITY", "CONFIDENCE", "SINCE"
    );
    for meta in rule_meta() {
        println!(
            "  {:<42}  {:<8}  {:<26}  {:<10}  {}",
            meta.id,
            meta.severity.as_str(),
            meta.confidence.as_str(),
            meta.since,
            meta.reviewed
        );
    }
    println!("\nNo slop rule is certain-mechanical, so none is ever auto-fixed.");
    println!(
        "These are population-level signals. A clean scan is not evidence of human authorship.\n"
    );
    for entry in CHANGELOG {
        println!("  {} ({})", entry.version, entry.date);
        for note in entry.notes {
            println!("    - {note}");
        }
        println!();
    }
    exit::CLEAN
}

/// Build the SARIF / JSON Lines report from a scan.
fn build_report(findings: &[Finding]) -> Report {
    Report::new(
        ToolMeta::new("slop-scan", env!("CARGO_PKG_VERSION")),
        rule_meta(),
    )
    .with_ruleset_version(RULESET_VERSION)
    .with_entries(findings.iter().map(Finding::to_report_entry).collect())
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if args.explain_rules {
        return Ok(explain_rules());
    }
    if !args.path.exists() {
        return Err(CliError::new(
            exit::ERROR,
            format!("path not found: {}", args.path.display()),
        ));
    }

    let format = args.format.unwrap_or(if args.json {
        OutputFormat::Json
    } else {
        OutputFormat::Text
    });

    // The configuration file settles the disabled rules; the severity floor
    // stays a flag here, because it also selects which rules are compiled.
    let settings = Settings::resolve(args.config.as_deref(), &args.path)?.apply_flags(
        None,
        None,
        None,
        None,
        None,
        &args.disable,
    );

    let floor = Severity::parse(&args.severity).expect("clap restricts the value set");
    let result = scan_with(&args.path, floor, args.structural);
    let findings: Vec<Finding> = result
        .findings
        .into_iter()
        .filter(|finding| settings.config.rule_enabled(&finding.rule))
        .collect();

    let mut counts = [
        (Severity::High, 0u32),
        (Severity::Medium, 0u32),
        (Severity::Low, 0u32),
    ];
    for finding in &findings {
        for slot in counts.iter_mut() {
            if slot.0 == finding.severity {
                slot.1 += 1;
            }
        }
    }
    let weighted: u32 = counts
        .iter()
        .map(|(severity, count)| severity.weight() * count)
        .sum();
    let verdict = prose_sanitiser::slop::prose::verdict(counts[0].1, weighted);
    let code = exit::from_findings(findings.len());

    if let Some(rendered) = render(&build_report(&findings), format) {
        println!("{rendered}");
        return Ok(code);
    }

    if format == OutputFormat::Json {
        let mut by_severity = Map::new();
        for (severity, count) in counts {
            if count > 0 {
                by_severity.insert(severity.as_str().to_string(), json!(count));
            }
        }
        let mut payload = Map::new();
        payload.insert("path".into(), json!(args.path.display().to_string()));
        payload.insert("files_scanned".into(), json!(result.files_scanned));
        payload.insert("counts".into(), Value::Object(by_severity));
        payload.insert("slop_score".into(), json!(weighted));
        payload.insert("verdict".into(), json!(verdict));
        payload.insert(
            "findings".into(),
            json!(findings.iter().map(Finding::to_json).collect::<Vec<_>>()),
        );
        // Additive: absent unless asked for, so the default document is
        // byte-identical to the previous release.
        if args.structural {
            payload.insert("ruleset_version".into(), json!(RULESET_VERSION));
            payload.insert(
                "structural".into(),
                json!(result
                    .structural
                    .iter()
                    .map(|(file, metrics)| {
                        let mut entry = metrics.to_json();
                        entry["file"] = json!(file);
                        entry
                    })
                    .collect::<Vec<_>>()),
            );
        }
        println!("{}", to_pretty_json_ascii(&Value::Object(payload)));
        return Ok(code);
    }

    let mut groups = group(&findings);
    // Most severe first, then the busiest rule.
    groups.sort_by_key(|(_, items)| (items[0].severity.rank(), std::cmp::Reverse(items.len())));

    println!("\n  prose-sanitiser slop scan: {}", args.path.display());
    println!(
        "  files scanned: {}   findings: {}   slop score: {weighted}",
        result.files_scanned,
        findings.len()
    );
    println!("  verdict: {verdict}");
    println!(
        "  high: {}   medium: {}   low: {}\n",
        counts[0].1, counts[1].1, counts[2].1
    );

    if findings.is_empty() {
        println!(
            "  Nothing flagged. Either it is clean or the tells are narrative/voice ones a\n  \
             regex cannot see. Read it against Section C of SKILL.md.\n"
        );
        return Ok(exit::CLEAN);
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
    Ok(code)
}
