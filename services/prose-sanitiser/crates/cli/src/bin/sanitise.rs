//! Run every layer over a file or tree, on one confidence scale.
//!
//! The umbrella pass. `inspect-text`, `slop-scan`, `inspect-image` and
//! `inspect-file` each own one layer; this runs the ones that apply to each
//! file and reports them together, with the confidence tier deciding what may
//! be changed.
//!
//! Report-only by default. `--fix` applies the mechanical tier, `--fix --write`
//! adds the high-confidence-stylistic tier, and the judgement tier is never
//! applied. Image and container provenance is reported, never rewritten:
//! `clean-image` and `clean-file` own that byte surgery.

use std::path::{Path, PathBuf};

use clap::Parser;
use prose_sanitiser::common::{run_cli, CliError};
use prose_sanitiser::dispatch::Kind;
use prose_sanitiser::exit;
use prose_sanitiser::output::{render, text_line, OutputFormat};
use prose_sanitiser::sanitise::{
    all_rule_meta, configure, fixability_table, is_prose, kind_of, media_finding, read_text,
    FileOutcome, RULE_MEDIA_PROVENANCE,
};
use prose_sanitiser::settings::Settings;
use prose_sanitiser::slop::rules::RULESET_VERSION;
use prose_sanitiser::slop::SlopChecker;
use prose_sanitiser::{container, image};
use prose_sanitiser_core::{Check, Config, Report, Severity, ToolMeta};
use prose_sanitiser_unicode::bidi::BidiContext;
use prose_sanitiser_unicode::check::{check_text, TextPolicy};

/// Extensions whose bidi policy is the source-code one.
///
/// Trojan Source (CVE-2021-42574) turns a balanced bidi override into a
/// compiler-versus-reviewer disagreement, so bidi controls are rejected outright
/// in code and preserved in prose. Getting this the wrong way round is a
/// security bug in one direction and mangled Hebrew in the other.
const CODE_EXTS: &[&str] = &[
    "rs", "py", "js", "ts", "jsx", "tsx", "go", "c", "h", "cc", "cpp", "hpp", "cs", "java", "rb",
    "php", "sh", "bash", "fish", "sql", "sol", "toml", "yaml", "yml", "json",
];

#[derive(Parser)]
#[command(
    about = "Run every sanitiser layer over a file or tree, on one confidence scale.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// File or directory to check
    path: PathBuf,
    /// Output format
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,
    /// Minimum severity to report
    #[arg(long, value_parser = ["high", "medium", "low"], default_value = "low")]
    severity: String,
    /// Apply the certain-mechanical findings
    #[arg(long)]
    fix: bool,
    /// Apply the certain-mechanical and high-confidence-stylistic findings.
    /// Implies --fix; the low-confidence-judgement tier is never applied.
    #[arg(long)]
    write: bool,
    /// Show what would change, without writing
    #[arg(long)]
    diff: bool,
    /// Also report the whole-document structural measures
    #[arg(long)]
    structural: bool,
    /// Report every character with an ASCII confusable prototype, not only the
    /// ones the mixed-script rules flag. Flags honest Greek and Cyrillic prose.
    #[arg(long)]
    aggressive: bool,
    /// Offer to rewrite exotic spaces (U+00A0, U+202F and the rest) to U+0020.
    ///
    /// Off by default, mirroring `clean-text`. Exotic whitespace is always
    /// *reported* either way; this decides only whether a fix is offered, so
    /// the preview and the cleaner cannot disagree.
    #[arg(long = "normalize-spaces")]
    normalize_spaces: bool,
    /// Scan every span, whatever language it reads as
    #[arg(long = "no-language-filter")]
    no_language_filter: bool,
    /// Ignore the HTML-comment suppression directives
    #[arg(long = "no-suppressions")]
    no_suppressions: bool,
    /// Use Oxford -ize spelling
    #[arg(long)]
    oxford: bool,
    /// Rule to skip; repeatable
    #[arg(long = "disable")]
    disable: Vec<String>,
    /// Configuration file (default: nearest .prose-sanitiser.toml)
    #[arg(long)]
    config: Option<PathBuf>,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

/// The bidi policy for a path: code files reject, prose preserves.
///
/// Built from `TextPolicy::default()` rather than field by field, so a field
/// added to the policy arrives here at its safe default instead of failing the
/// build or, worse, being set to whatever happened to be typed first.
fn policy_for(path: &Path, aggressive: bool, normalize_spaces: bool) -> TextPolicy {
    let code = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .is_some_and(|ext| CODE_EXTS.contains(&ext.as_str()));
    TextPolicy {
        context: if code {
            BidiContext::Code
        } else {
            BidiContext::Prose
        },
        context_free_homoglyphs: aggressive,
        // Paired with `CleanOptions::normalize_spaces`, per the policy table
        // `prose-sanitiser-unicode` documents. Setting one without the other
        // makes this pass a preview that lies about what a clean would do.
        normalize_spaces,
        ..TextPolicy::default()
    }
}

/// Every file under `root` the umbrella pass will look at.
fn files(root: &Path) -> Vec<PathBuf> {
    if root.is_file() {
        return vec![root.to_path_buf()];
    }
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        let mut found: Vec<PathBuf> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                if !prose_sanitiser::slop::rules::SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
            } else {
                found.push(path);
            }
        }
        found.sort();
        out.extend(found);
    }
    out.sort();
    out
}

/// Run every applicable layer over one file.
fn sanitise_one(
    path: &Path,
    config: &Config,
    checker: &SlopChecker,
    aggressive: bool,
    normalize_spaces: bool,
) -> Result<FileOutcome, CliError> {
    let kind = kind_of(path)?;
    if is_prose(path, kind) || kind == Kind::Text {
        let text = read_text(path)?;
        let mut findings = check_text(&text, &policy_for(path, aggressive, normalize_spaces));
        findings.retain(|finding| config.rule_enabled(&finding.rule_id));
        // The UK rule reaches this pass through the slop table's `us-spelling`
        // entry, which sources its alternation from the VarCon table in
        // `prose-sanitiser-uk`. There is one spelling list in the workspace.
        findings.extend(checker.check(&text, config));
        return Ok(FileOutcome {
            path: path.to_path_buf(),
            kind,
            findings,
            text: Some(text),
        });
    }

    let notes = match kind {
        Kind::Image => image::inspect_image(path, None)
            .map(|report| report.findings)
            .map_err(|error| {
                CliError::new(
                    exit::ERROR,
                    format!("cannot read {}: {error}", path.display()),
                )
            })?,
        _ => container::inspect_container(path)
            .map(|report| report.findings)
            .map_err(|error| {
                CliError::new(
                    exit::ERROR,
                    format!("cannot read {}: {error}", path.display()),
                )
            })?,
    };
    let findings = notes
        .iter()
        .map(|note| media_finding(note))
        .filter(|finding| config.rule_enabled(&finding.rule_id))
        .collect();
    Ok(FileOutcome {
        path: path.to_path_buf(),
        kind,
        findings,
        text: None,
    })
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if !args.path.exists() {
        return Err(CliError::new(
            exit::ERROR,
            format!("path not found: {}", args.path.display()),
        ));
    }

    let severity = Severity::parse(&args.severity).expect("clap restricts the value set");
    let settings = Settings::resolve(args.config.as_deref(), &args.path)?.apply_flags(
        if args.write { Some(true) } else { None },
        Some(severity),
        if args.oxford { Some(true) } else { None },
        if args.no_language_filter {
            Some(false)
        } else {
            None
        },
        if args.no_suppressions {
            Some(false)
        } else {
            None
        },
        &args.disable,
    );
    // Apply the declared fixability overrides before anything builds a patch,
    // so a finding with no possible repair can never become an edit.
    let config = configure(settings.config);
    let checker = SlopChecker::new().with_structural(args.structural);

    let mut outcomes = Vec::new();
    for path in files(&args.path) {
        match sanitise_one(
            &path,
            &config,
            &checker,
            args.aggressive,
            args.normalize_spaces,
        ) {
            Ok(outcome) => outcomes.push(outcome),
            // One unreadable file in a tree must not abort the sweep; a single
            // named file that cannot be read still fails the run.
            Err(error) if args.path.is_file() => return Err(error),
            Err(error) => eprintln!("{}", error.message),
        }
    }

    let mut entries = Vec::new();
    for outcome in &outcomes {
        entries.extend(outcome.entries(&config));
    }
    let found = !entries.is_empty();

    let mut changed = 0usize;
    let applying = args.fix || args.write;
    if applying || args.diff {
        for outcome in &outcomes {
            let patch = outcome.patch(&config);
            if patch.is_empty() {
                continue;
            }
            let Some(text) = &outcome.text else { continue };
            let Some(rewritten) = patch.apply(text) else {
                return Err(CliError::new(
                    exit::ERROR,
                    format!("patch does not apply to {}", outcome.path.display()),
                ));
            };
            if args.diff {
                println!(
                    "{}: {} edit{} would be applied",
                    outcome.path.display(),
                    patch.len(),
                    if patch.len() == 1 { "" } else { "s" }
                );
                continue;
            }
            std::fs::write(&outcome.path, rewritten).map_err(|error| {
                CliError::new(
                    exit::ERROR,
                    format!("cannot write {}: {error}", outcome.path.display()),
                )
            })?;
            changed += patch.len();
        }
    }

    let report = Report::new(
        ToolMeta::new("sanitise", env!("CARGO_PKG_VERSION")),
        all_rule_meta(),
    )
    .with_ruleset_version(RULESET_VERSION)
    .with_fixability_table(fixability_table())
    .with_entries(entries);

    if let Some(rendered) = render(&report, args.format) {
        println!("{rendered}");
        return Ok(exit::from_flag(found));
    }

    let mut tiers = [0usize; 3];
    for outcome in &outcomes {
        let counts = outcome.tier_counts(&config);
        for (slot, count) in tiers.iter_mut().zip(counts) {
            *slot += count;
        }
    }

    for entry in report.entries() {
        println!("{}", text_line(entry));
        println!("    {}", entry.finding.advice);
    }
    println!(
        "\n{} file{} checked, {} finding{}: {} mechanical, {} stylistic, {} judgement.",
        outcomes.len(),
        if outcomes.len() == 1 { "" } else { "s" },
        report.entries().len(),
        if report.entries().len() == 1 { "" } else { "s" },
        tiers[0],
        tiers[1],
        tiers[2]
    );
    if args.fix {
        println!(
            "{changed} edit{} applied.",
            if changed == 1 { "" } else { "s" }
        );
    } else if tiers[0] > 0 || tiers[1] > 0 {
        println!("Nothing was rewritten. Pass --fix to apply the mechanical tier, --fix --write to add the stylistic tier.");
    }
    if tiers[2] > 0 {
        println!("The judgement tier is never applied automatically; read those and decide.");
    }
    if report
        .entries()
        .iter()
        .any(|entry| entry.finding.rule_id == RULE_MEDIA_PROVENANCE)
    {
        println!("Container metadata is reported, not stripped. Run clean-image or clean-file.");
    }
    Ok(exit::from_flag(found))
}
