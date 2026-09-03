//! Unified clean: text Layer A, PNG/JPEG/WebP metadata, and containers.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::io::max_input_bytes;
use prose_sanitiser::common::surrogate;
use prose_sanitiser::common::{
    backup_path, cleaned_path, eprint_line, guard_binary, run_cli, safe_write_text, to_pretty_json,
    CliError, ROUTER_ADVICE,
};
use prose_sanitiser::container::clean_container;
use prose_sanitiser::dispatch::{classify, Kind};
use prose_sanitiser::image::{clean_image, CleanImageOptions};
use prose_sanitiser::text::{clean_text, CleanOptions};
use serde_json::{json, Map, Value};

#[derive(Parser)]
#[command(about = "Unified clean: text Layer A, PNG/JPEG/WebP metadata, and containers.")]
struct Args {
    path: PathBuf,
    #[arg(short, long)]
    output: Option<PathBuf>,
    #[arg(long = "in-place")]
    in_place: bool,
    #[arg(long)]
    json: bool,
    /// Text: NFKC normalise
    #[arg(long)]
    nfkc: bool,
    #[arg(long = "aggressive-homoglyphs")]
    aggressive_homoglyphs: bool,
    /// Images: only drop C2PA/AI-looking segments
    #[arg(long = "keep-non-ai-metadata")]
    keep_non_ai_metadata: bool,
    #[arg(long = "as", value_parser = ["auto", "text", "image", "container"], default_value = "auto")]
    force_type: String,
    /// Clean as text even when the bytes look like a binary container
    #[arg(long = "force-text")]
    force_text: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn merge_kind(kind: &str, result: Value) -> Value {
    let mut map = Map::new();
    map.insert("kind".into(), json!(kind));
    if let Some(fields) = result.as_object() {
        for (key, value) in fields {
            map.insert(key.clone(), value.clone());
        }
    }
    Value::Object(map)
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
            CliError::new(2, format!("cannot read {}: {error}", args.path.display()))
        })?
    } else {
        Kind::parse(&args.force_type).expect("clap restricts the value set")
    };

    // `classify` falls back to text for unrecognised bytes, so an unknown
    // binary would otherwise be decoded, scrubbed and written back mangled.
    // Sniff before --in-place takes a backup: refusing afterwards would leave a
    // .bak sidecar behind for a file this run never touches.
    let raw = if kind == Kind::Text {
        let data = std::fs::read(&args.path).map_err(|error| {
            CliError::new(2, format!("cannot read {}: {error}", args.path.display()))
        })?;
        guard_binary(
            &data,
            &args.path.display().to_string(),
            args.force_text,
            ROUTER_ADVICE,
        )?;
        Some(data)
    } else {
        None
    };

    let (source, dest) = if args.in_place {
        (backup_path(&args.path)?, args.path.clone())
    } else {
        (
            args.path.clone(),
            args.output
                .clone()
                .unwrap_or_else(|| cleaned_path(&args.path, ".cleaned")),
        )
    };

    match kind {
        Kind::Text => {
            let units = surrogate::decode(&raw.expect("read above for the text branch"));
            let (cleaned, stats) = clean_text(
                &units,
                CleanOptions {
                    nfkc: args.nfkc,
                    aggressive_homoglyphs: args.aggressive_homoglyphs,
                    ..CleanOptions::default()
                },
            );
            if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent).map_err(|error| {
                    CliError::new(1, format!("cannot create {}: {error}", parent.display()))
                })?;
            }
            safe_write_text(&dest, &cleaned).map_err(|error| {
                CliError::new(1, format!("cannot write {}: {error}", dest.display()))
            })?;
            let result = json!({
                "kind": "text",
                "input": args.path.display().to_string(),
                "output": dest.display().to_string(),
                "stats": stats.to_json(),
            });
            if args.json {
                println!("{}", to_pretty_json(&result));
            } else {
                eprint_line(&format!(
                    "wrote {} removed={} replaced={}",
                    dest.display(),
                    stats.removed_count,
                    stats.replaced_count
                ));
            }
            Ok(0)
        }
        Kind::Image => {
            let result = clean_image(
                &source,
                &dest,
                &CleanImageOptions {
                    strip_all_metadata: !args.keep_non_ai_metadata,
                    ..CleanImageOptions::default()
                },
            )
            .map_err(|error| CliError::new(1, format!("error: {error}")))?;
            let residual = result["still_has_c2pa"].as_bool().unwrap_or(false)
                || result["still_has_ai_metadata"].as_bool().unwrap_or(false);
            let result = merge_kind("image", result);
            if args.json {
                println!("{}", to_pretty_json(&result));
            } else {
                eprint_line(&format!(
                    "wrote {} ({} -> {})",
                    result["output"].as_str().unwrap_or_default(),
                    result["bytes_in"],
                    result["bytes_out"]
                ));
                if let Some(actions) = result["actions"].as_array() {
                    for action in actions {
                        eprint_line(&format!("  - {}", action.as_str().unwrap_or_default()));
                    }
                }
                if residual {
                    eprint_line("warning: residual C2PA/AI signals may remain");
                }
            }
            Ok(i32::from(residual))
        }
        Kind::Container => {
            let result = clean_container(&source, &dest, true)
                .map_err(|error| CliError::new(1, format!("error: {error}")))?;
            let residual = result["still_has_c2pa"].as_bool().unwrap_or(false)
                || result["still_has_ai_metadata"].as_bool().unwrap_or(false);
            let degraded = result["meta"]["degraded"].as_bool().unwrap_or(false);
            let result = merge_kind("container", result);
            if args.json {
                println!("{}", to_pretty_json(&result));
            } else {
                eprint_line(&format!(
                    "wrote {} format={}",
                    result["output"].as_str().unwrap_or_default(),
                    result["format"].as_str().unwrap_or_default()
                ));
                if let Some(actions) = result["actions"].as_array() {
                    for action in actions {
                        eprint_line(&format!("  - {}", action.as_str().unwrap_or_default()));
                    }
                }
                if residual {
                    eprint_line("warning: residual C2PA/AI signals may remain");
                    if let Some(findings) = result["post_findings"].as_array() {
                        for finding in findings {
                            eprint_line(&format!("  ! {}", finding.as_str().unwrap_or_default()));
                        }
                    }
                }
            }
            // A degraded (best-effort) PDF copy warns but is not a hard failure.
            Ok(i32::from(residual && !degraded))
        }
    }
}
