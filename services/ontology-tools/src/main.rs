//! `ontology-tools` CLI — parse, validate, modify, link-check and enrich
//! vault OntologyBlock markdown.
//!
//! There was no `python -m` / argparse CLI in the Python originals
//! (`ontology-core` and `ontology-enrich` were library-only skills; the only
//! documented CLI surface was `ontology-enrich/README.md`'s aspirational
//! `python -m ontology_enrich.{validate,enrich,fix_links}`, which never
//! existed as actual modules). This CLI is a fresh, coherent surface over
//! the ported library covering everything both skills' docs describe.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use ontology_tools::{
    link_validator::LinkValidator, modifier::OntologyModifier, parser::OntologyParser,
    validator::OWL2Validator, writer::write_ontology_block, EnrichmentConfig, EnrichmentWorkflow,
};

#[derive(Parser)]
#[command(
    name = "ontology-tools",
    version,
    about = "Vault OntologyBlock parsing, OWL2 validation, field-preserving edits, wiki-link validation and Perplexity enrichment for agentbox."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Parse an OntologyBlock from a markdown file and print it as JSON.
    Parse {
        file: PathBuf,
        /// Pretty-print the JSON output.
        #[arg(long)]
        pretty: bool,
    },
    /// Validate OWL2 functional-syntax axioms embedded in a file.
    Validate { file: PathBuf },
    /// Parse, write back, and re-parse a file's OntologyBlock, reporting
    /// whether the round trip is lossless (the crate's headline contract).
    Roundtrip { file: PathBuf },
    /// Apply field-preserving updates to an OntologyBlock, with automatic
    /// backup and OWL2-validated rollback.
    Modify {
        file: PathBuf,
        /// A `field=value` pair; may be repeated.
        #[arg(long = "set", value_parser = parse_key_val, required = true)]
        set: Vec<(String, String)>,
        /// Skip pre/post OWL2 validation.
        #[arg(long)]
        no_validate: bool,
        /// Skip creating a timestamped backup before modifying.
        #[arg(long)]
        no_backup: bool,
    },
    /// Check (and optionally fix) wiki-links in a file.
    Links {
        file: PathBuf,
        /// Automatically replace broken links with the best high-confidence
        /// suggestion found under the knowledge-graph root.
        #[arg(long)]
        auto_fix: bool,
        /// Minimum similarity score (0-1) required to auto-fix a link.
        #[arg(long, default_value_t = 0.8)]
        confidence_threshold: f64,
        /// Knowledge-graph root to search for `*.md` targets. Defaults to
        /// `$VAULT_PAGES` (ADR-2028).
        #[arg(long)]
        kg_root: Option<PathBuf>,
    },
    /// Enrich a single field via the Perplexity API. Requires
    /// `PERPLEXITY_API_KEY` in the environment.
    Enrich {
        file: PathBuf,
        #[arg(long)]
        field: String,
        /// Additional context for the query; defaults to the block's
        /// `preferred-term`.
        #[arg(long)]
        context: Option<String>,
    },
    /// Enrich a field across multiple files, rate-limited. Requires
    /// `PERPLEXITY_API_KEY` in the environment.
    BatchEnrich {
        files: Vec<PathBuf>,
        #[arg(long)]
        field: String,
    },
}

fn parse_key_val(s: &str) -> Result<(String, String), String> {
    match s.split_once('=') {
        Some((k, v)) => Ok((k.to_string(), v.to_string())),
        None => Err(format!("expected `field=value`, got {s:?}")),
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    match run(cli.command).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(command: Commands) -> anyhow::Result<ExitCode> {
    match command {
        Commands::Parse { file, pretty } => {
            let content = std::fs::read_to_string(&file)?;
            let block = OntologyParser::new().parse_ontology_block(&content, Some(&file));
            let json = if pretty {
                serde_json::to_string_pretty(&block)?
            } else {
                serde_json::to_string(&block)?
            };
            println!("{json}");
            Ok(ExitCode::SUCCESS)
        }

        Commands::Validate { file } => {
            let result = OWL2Validator::new().validate_file(&file.display().to_string(), None);
            println!("{result}");
            Ok(if result.is_valid {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }

        Commands::Roundtrip { file } => {
            let content = std::fs::read_to_string(&file)?;
            let parser = OntologyParser::new();
            let first = parser.parse_ontology_block(&content, Some(&file));
            let written = write_ontology_block(&first);
            let second = parser.parse_ontology_block(&written, Some(&file));

            if first.content_eq(&second) {
                println!("\u{2705} round-trip identity holds for {}", file.display());
                Ok(ExitCode::SUCCESS)
            } else {
                println!("\u{274c} round-trip identity BROKEN for {}", file.display());
                println!(
                    "--- parsed(original) ---\n{}",
                    serde_json::to_string_pretty(&first)?
                );
                println!(
                    "--- parsed(written) ---\n{}",
                    serde_json::to_string_pretty(&second)?
                );
                Ok(ExitCode::FAILURE)
            }
        }

        Commands::Modify {
            file,
            set,
            no_validate,
            no_backup,
        } => {
            let updates: BTreeMap<String, String> = set.into_iter().collect();
            let result =
                OntologyModifier::new().modify_file(&file, &updates, !no_validate, !no_backup);
            println!("{result}");
            Ok(if result.success {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }

        Commands::Links {
            file,
            auto_fix,
            confidence_threshold,
            kg_root,
        } => {
            let kg_root_str = kg_root.map(|p| p.display().to_string()).unwrap_or_default();
            let validator = LinkValidator::new(&kg_root_str);
            let report = validator.validate_links(&file)?;

            let report = if auto_fix && !report.broken_links.is_empty() {
                validator.auto_fix_links(&file, &report.broken_links, confidence_threshold)?
            } else {
                report
            };

            println!("{}", serde_json::to_string_pretty(&report)?);
            Ok(if report.broken_links.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }

        Commands::Enrich {
            file,
            field,
            context,
        } => {
            let api_key = std::env::var("PERPLEXITY_API_KEY")
                .map_err(|_| anyhow::anyhow!("PERPLEXITY_API_KEY is not set"))?;
            let workflow = EnrichmentWorkflow::new(api_key, EnrichmentConfig::from_env());
            let result = workflow
                .enrich_field(&file, &field, context.as_deref())
                .await;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(if result.success {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }

        Commands::BatchEnrich { files, field } => {
            let api_key = std::env::var("PERPLEXITY_API_KEY")
                .map_err(|_| anyhow::anyhow!("PERPLEXITY_API_KEY is not set"))?;
            let workflow = EnrichmentWorkflow::new(api_key, EnrichmentConfig::from_env());
            let results = workflow.batch_enrich(&files, &field).await;
            let successful = results.iter().filter(|r| r.success).count();
            println!("{}", serde_json::to_string_pretty(&results)?);
            eprintln!("Batch complete: {successful}/{} successful", results.len());
            Ok(if successful == results.len() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }
    }
}
