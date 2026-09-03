//! Direct port of `search.py`'s CLI: argument parsing (`argparse` -> `clap`) and
//! `format_output`. The `uiux-search` binary (`src/bin/uiux_search.rs`) is a thin
//! wrapper that calls [`run`].

use std::path::PathBuf;

use clap::Parser;

use super::config;
use super::design_system::generate_design_system_text;
use super::outcome::{OrderedRow, SearchOutcome};
use super::search_core::{search, search_stack};

/// `python search.py "<query>" [--domain <domain>] [--stack <stack>] [--max-results 3]`
/// `python search.py "<query>" --design-system [-p "Project Name"]`
/// `python search.py "<query>" --design-system --persist [-p "Project Name"] [--page "dashboard"]`
#[derive(Parser, Debug)]
#[command(
    name = "uiux-search",
    about = "UI Pro Max Search",
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Search query
    pub query: String,

    /// Search domain
    #[arg(short = 'd', long = "domain", value_parser = clap::builder::PossibleValuesParser::new(config::domain_names()))]
    pub domain: Option<String>,

    /// Stack-specific search (html-tailwind, react, nextjs, ...)
    #[arg(short = 's', long = "stack", value_parser = clap::builder::PossibleValuesParser::new(config::available_stacks()))]
    pub stack: Option<String>,

    /// Max results (default: 3)
    #[arg(short = 'n', long = "max-results", default_value_t = config::MAX_RESULTS)]
    pub max_results: usize,

    /// Output as JSON
    #[arg(long = "json")]
    pub json: bool,

    /// Generate complete design system recommendation
    #[arg(long = "design-system")]
    pub design_system: bool,

    /// Project name for design system output
    #[arg(short = 'p', long = "project-name")]
    pub project_name: Option<String>,

    /// Output format for design system
    #[arg(short = 'f', long = "format", default_value = "ascii", value_parser = ["ascii", "markdown"])]
    pub format: String,

    /// Save design system to design-system/MASTER.md (creates hierarchical structure)
    #[arg(long = "persist")]
    pub persist: bool,

    /// Create page-specific override file in design-system/pages/
    #[arg(long = "page")]
    pub page: Option<String>,

    /// Output directory for persisted files (default: current directory)
    #[arg(short = 'o', long = "output-dir")]
    pub output_dir: Option<String>,
}

/// argparse registered `--design-system` under BOTH `--design-system` and the
/// two-character short form `-ds`. `clap`'s `short` is restricted to a single
/// character, so `-ds` can't be declared as a normal derive short flag; instead we
/// rewrite the literal `-ds` token to `--design-system` before `clap` ever sees the
/// argv, which reproduces the exact same accepted command line.
pub fn normalize_argv<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .map(|arg| {
            if arg == "-ds" {
                "--design-system".to_string()
            } else {
                arg
            }
        })
        .collect()
}

/// `format_output`: format search/stack results for Claude consumption
/// (token-optimized text), or `Error: <message>` for an error outcome.
pub fn format_output(outcome: &SearchOutcome) -> String {
    match outcome {
        SearchOutcome::DomainError { error, .. }
        | SearchOutcome::StackUnknownError { error }
        | SearchOutcome::StackFileError { error, .. } => format!("Error: {error}"),
        SearchOutcome::Domain {
            domain,
            query,
            file,
            count,
            results,
        } => {
            let mut out = vec![
                "## UI Pro Max Search Results".to_string(),
                format!("**Domain:** {domain} | **Query:** {query}"),
                format!("**Source:** {file} | **Found:** {count} results\n"),
            ];
            push_results(&mut out, results);
            out.join("\n")
        }
        SearchOutcome::Stack {
            stack,
            query,
            file,
            count,
            results,
        } => {
            let mut out = vec![
                "## UI Pro Max Stack Guidelines".to_string(),
                format!("**Stack:** {stack} | **Query:** {query}"),
                format!("**Source:** {file} | **Found:** {count} results\n"),
            ];
            push_results(&mut out, results);
            out.join("\n")
        }
    }
}

fn push_results(out: &mut Vec<String>, results: &[OrderedRow]) {
    for (i, row) in results.iter().enumerate() {
        out.push(format!("### Result {}", i + 1));
        for (key, value) in row.iter() {
            let value_str = if value.chars().count() > 300 {
                let truncated: String = value.chars().take(300).collect();
                format!("{truncated}...")
            } else {
                value.to_string()
            };
            out.push(format!("- **{key}:** {value_str}"));
        }
        out.push(String::new());
    }
}

/// The `uiux-search` binary's entry point: parse argv, dispatch, print to stdout.
/// Returns the process exit code (`0` on success, `1` on an I/O error while
/// persisting a design system — matching a Python `Traceback` producing a non-zero
/// exit; `search.py` itself has no other failure exit path since it never raises on
/// bad domains/stacks, only returns an `{"error": ...}` result that still exits 0).
pub fn run() -> i32 {
    let argv = normalize_argv(std::env::args());
    let args = Cli::parse_from(argv);

    if args.design_system {
        let output_dir = args.output_dir.as_ref().map(PathBuf::from);
        let result = generate_design_system_text(
            &args.query,
            args.project_name.as_deref(),
            &args.format,
            args.persist,
            args.page.as_deref(),
            output_dir.as_deref(),
        );

        let text = match result {
            Ok(text) => text,
            Err(err) => {
                eprintln!("Error: {err}");
                return 1;
            }
        };
        println!("{text}");

        if args.persist {
            let project_slug = args
                .project_name
                .as_deref()
                .map(super::persist::slugify)
                .unwrap_or_else(|| "default".to_string());
            println!("\n{}", "=".repeat(60));
            println!("\u{2705} Design system persisted to design-system/{project_slug}/");
            println!(
                "   \u{1f4c4} design-system/{project_slug}/MASTER.md (Global Source of Truth)"
            );
            if let Some(page) = &args.page {
                let page_filename = super::persist::slugify(page);
                println!(
                    "   \u{1f4c4} design-system/{project_slug}/pages/{page_filename}.md (Page Overrides)"
                );
            }
            println!();
            println!(
                "\u{1f4d6} Usage: When building a page, check design-system/{project_slug}/pages/[page].md first."
            );
            println!("   If exists, its rules override MASTER.md. Otherwise, use MASTER.md.");
            println!("{}", "=".repeat(60));
        }
    } else if let Some(stack) = &args.stack {
        let outcome = search_stack(&args.query, stack, args.max_results);
        print_outcome(&outcome, args.json);
    } else {
        let outcome = search(&args.query, args.domain.as_deref(), args.max_results);
        print_outcome(&outcome, args.json);
    }

    0
}

fn print_outcome(outcome: &SearchOutcome, json: bool) {
    if json {
        match serde_json::to_string_pretty(outcome) {
            Ok(text) => println!("{text}"),
            Err(err) => eprintln!("Error: {err}"),
        }
    } else {
        println!("{}", format_output(outcome));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_argv_rewrites_bare_ds_flag() {
        let argv = vec![
            "uiux-search".to_string(),
            "query".to_string(),
            "-ds".to_string(),
        ];
        let normalized = normalize_argv(argv);
        assert_eq!(normalized, vec!["uiux-search", "query", "--design-system"]);
    }

    #[test]
    fn normalize_argv_leaves_other_args_untouched() {
        let argv = vec![
            "uiux-search".to_string(),
            "-d".to_string(),
            "style".to_string(),
        ];
        let normalized = normalize_argv(argv.clone());
        assert_eq!(normalized, argv);
    }

    #[test]
    fn cli_parses_full_flag_set() {
        let argv = normalize_argv(vec![
            "uiux-search".to_string(),
            "glassmorphism".to_string(),
            "-d".to_string(),
            "style".to_string(),
            "-n".to_string(),
            "5".to_string(),
            "--json".to_string(),
        ]);
        let cli = Cli::parse_from(argv);
        assert_eq!(cli.query, "glassmorphism");
        assert_eq!(cli.domain.as_deref(), Some("style"));
        assert_eq!(cli.max_results, 5);
        assert!(cli.json);
        assert!(!cli.design_system);
        assert_eq!(cli.format, "ascii");
    }

    #[test]
    fn cli_parses_ds_shorthand_via_normalization() {
        let argv = normalize_argv(vec![
            "uiux-search".to_string(),
            "saas dashboard".to_string(),
            "-ds".to_string(),
            "-p".to_string(),
            "Test".to_string(),
        ]);
        let cli = Cli::parse_from(argv);
        assert!(cli.design_system);
        assert_eq!(cli.project_name.as_deref(), Some("Test"));
    }

    #[test]
    fn cli_rejects_unknown_domain() {
        let argv = vec![
            "uiux-search".to_string(),
            "query".to_string(),
            "-d".to_string(),
            "not-a-real-domain".to_string(),
        ];
        let result = Cli::try_parse_from(argv);
        assert!(result.is_err());
    }

    #[test]
    fn format_output_error_variant() {
        let outcome = SearchOutcome::StackUnknownError {
            error: "Unknown stack: foo".to_string(),
        };
        assert_eq!(format_output(&outcome), "Error: Unknown stack: foo");
    }

    #[test]
    fn format_output_domain_results() {
        let outcome = SearchOutcome::Domain {
            domain: "style".to_string(),
            query: "glassmorphism".to_string(),
            file: "styles.csv".to_string(),
            count: 1,
            results: vec![OrderedRow(vec![(
                "Style Category".to_string(),
                "Glassmorphism".to_string(),
            )])],
        };
        let text = format_output(&outcome);
        assert!(text.contains("## UI Pro Max Search Results"));
        assert!(text.contains("**Domain:** style | **Query:** glassmorphism"));
        assert!(text.contains("### Result 1"));
        assert!(text.contains("- **Style Category:** Glassmorphism"));
    }

    #[test]
    fn json_serialization_matches_python_key_order() {
        let outcome = SearchOutcome::Domain {
            domain: "style".to_string(),
            query: "q".to_string(),
            file: "styles.csv".to_string(),
            count: 0,
            results: vec![],
        };
        let json = serde_json::to_string_pretty(&outcome).unwrap();
        let domain_pos = json.find("\"domain\"").unwrap();
        let query_pos = json.find("\"query\"").unwrap();
        let file_pos = json.find("\"file\"").unwrap();
        let count_pos = json.find("\"count\"").unwrap();
        let results_pos = json.find("\"results\"").unwrap();
        assert!(domain_pos < query_pos);
        assert!(query_pos < file_pos);
        assert!(file_pos < count_pos);
        assert!(count_pos < results_pos);
    }
}
