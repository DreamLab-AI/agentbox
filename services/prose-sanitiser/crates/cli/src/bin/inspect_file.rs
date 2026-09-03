//! Unified inspect: text, images (PNG/JPEG/WebP), and document containers.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::io::max_input_bytes;
use prose_sanitiser::common::{
    classify_finding_confidence, emit_json, read_text_input, run_cli, CliError, ROUTER_ADVICE,
};
use prose_sanitiser::container::inspect_container;
use prose_sanitiser::dispatch::{classify, Kind};
use prose_sanitiser::exit;
use prose_sanitiser::image::inspect_image;
use prose_sanitiser::text::{human_report, inspect_text};
use serde_json::{json, Map, Value};

#[derive(Parser)]
#[command(about = "Unified inspect: text, images (PNG/JPEG/WebP), and document containers.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// File to inspect
    path: PathBuf,
    #[arg(long)]
    json: bool,
    /// Text: flag confusables
    #[arg(long)]
    aggressive: bool,
    #[arg(long = "as", value_parser = ["text", "image", "container", "auto"], default_value = "auto")]
    force_type: String,
    /// Scan as text even when the bytes look like a binary container
    #[arg(long = "force-text")]
    force_text: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

/// `{"kind": ..., "path": ..., **report}` — the Python's dict-splat ordering.
fn envelope(kind: &str, path: &str, report: Value) -> Value {
    let mut map = Map::new();
    map.insert("kind".into(), json!(kind));
    map.insert("path".into(), json!(path));
    if let Some(fields) = report.as_object() {
        for (key, value) in fields {
            map.insert(key.clone(), value.clone());
        }
    }
    Value::Object(map)
}

fn python_bool(value: bool) -> &'static str {
    if value {
        "True"
    } else {
        "False"
    }
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if !args.path.is_file() {
        return Err(CliError::new(
            2,
            format!("not a file: {}", args.path.display()),
        ));
    }
    let size = std::fs::metadata(&args.path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let cap = max_input_bytes();
    if size > cap {
        return Err(CliError::new(
            2,
            format!(
                "refusing input larger than {cap} bytes: {}",
                args.path.display()
            ),
        ));
    }

    let kind = if args.force_type == "auto" {
        classify(&args.path).map_err(|error| {
            CliError::new(
                exit::ERROR,
                format!("cannot read {}: {error}", args.path.display()),
            )
        })?
    } else {
        Kind::parse(&args.force_type).expect("clap restricts the value set")
    };
    let label = std::fs::canonicalize(&args.path)
        .unwrap_or_else(|_| args.path.clone())
        .display()
        .to_string();

    match kind {
        Kind::Text => {
            let units = read_text_input(
                Some(&args.path.display().to_string()),
                args.force_text,
                Some(ROUTER_ADVICE),
            )?;
            let report = inspect_text(&units, args.aggressive, false);
            if args.json {
                emit_json(&envelope("text", &label, report.to_json()));
            } else {
                println!("File: {label}");
                println!("Kind: text");
                println!("{}", human_report(&report));
            }
            Ok(exit::from_flag(report.suspicious_total != 0))
        }
        Kind::Image => {
            let report = inspect_image(&args.path, None).map_err(|error| {
                CliError::new(
                    exit::ERROR,
                    format!("cannot read {}: {error}", args.path.display()),
                )
            })?;
            if args.json {
                emit_json(&envelope("image", &label, report.to_json()));
            } else {
                println!("File: {label}");
                println!("Kind: image");
                println!("Path: {}", report.path);
                println!("Format: {}", report.format);
                println!("C2PA: {}", python_bool(report.has_c2pa));
                println!("AI metadata: {}", python_bool(report.has_ai_metadata));
                for finding in &report.findings {
                    println!("  - [{}] {finding}", classify_finding_confidence(finding));
                }
            }
            Ok(exit::from_flag(report.has_c2pa || report.has_ai_metadata))
        }
        Kind::Container => {
            let report = inspect_container(&args.path).map_err(|error| {
                CliError::new(
                    exit::ERROR,
                    format!("cannot read {}: {error}", args.path.display()),
                )
            })?;
            if args.json {
                emit_json(&envelope("container", &label, report.to_json()));
            } else {
                println!("File: {label}");
                println!("Kind: container");
                println!("Path: {}", report.path);
                println!("Format: {}", report.format);
                println!("C2PA: {}", python_bool(report.has_c2pa));
                println!("AI metadata: {}", python_bool(report.has_ai_metadata));
                for finding in &report.findings {
                    println!("  - [{}] {finding}", classify_finding_confidence(finding));
                }
            }
            Ok(exit::from_flag(report.has_c2pa || report.has_ai_metadata))
        }
    }
}
