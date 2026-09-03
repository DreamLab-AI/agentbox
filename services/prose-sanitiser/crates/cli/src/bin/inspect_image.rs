//! Inspect PNG/JPEG/WebP for C2PA and AI-related metadata.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::{classify_finding_confidence, emit_json, run_cli, CliError};
use prose_sanitiser::exit;
use prose_sanitiser::image::inspect_image;
use serde_json::Value;

#[derive(Parser)]
#[command(about = "Inspect PNG/JPEG/WebP for C2PA and AI-related metadata.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// Image path (PNG, JPEG, or WebP)
    path: PathBuf,
    #[arg(long)]
    json: bool,
    /// reverse-SynthID checkout root for optional pixel SynthID scoring
    #[arg(long = "synthid-dir")]
    synthid_dir: Option<String>,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if !args.path.is_file() {
        return Err(CliError::new(
            2,
            format!("not a file: {}", args.path.display()),
        ));
    }
    let report = inspect_image(&args.path, args.synthid_dir.as_deref()).map_err(|error| {
        CliError::new(
            exit::ERROR,
            format!("cannot read {}: {error}", args.path.display()),
        )
    })?;

    if args.json {
        emit_json(&report.to_json());
    } else {
        println!("Path: {}", report.path);
        println!("Format: {}", report.format);
        println!("C2PA: {}", python_bool(report.has_c2pa));
        println!("AI metadata: {}", python_bool(report.has_ai_metadata));
        if !report.findings.is_empty() {
            println!("Findings:");
            for finding in &report.findings {
                println!("  - [{}] {finding}", classify_finding_confidence(finding));
            }
        }
        let available = |tool: &str| report.tools[tool]["available"].as_bool().unwrap_or(false);
        println!(
            "c2patool: {}",
            if available("c2patool") { "yes" } else { "no" }
        );
        println!(
            "exiftool: {}",
            if available("exiftool") { "yes" } else { "no" }
        );
        if let Some(lines) = report.tools["exiftool"]["interesting_lines"].as_array() {
            if !lines.is_empty() {
                println!("exiftool highlights:");
                for line in lines.iter().take(20) {
                    println!("  {}", line.as_str().unwrap_or_default());
                }
            }
        }
        if let Some(synthid) = &report.synthid {
            if synthid["available"].as_bool().unwrap_or(false) {
                let watermarked = synthid["is_watermarked"].as_bool().unwrap_or(false);
                let confidence = synthid["confidence"].as_f64().unwrap_or(0.0);
                println!(
                    "SynthID score: confidence {confidence:.3} (watermarked: {})",
                    if watermarked { "yes" } else { "no" }
                );
                if watermarked {
                    println!(
                        "Hint: optional pixel removal is available via clean-image IMG \
                         --remove-pixel ctrlregen --ctrlregen-dir $NOAI_WATERMARK_DIR"
                    );
                }
            } else if let Some(Value::String(error)) = synthid.get("error") {
                println!("SynthID score: error: {error}");
            }
        }
    }
    Ok(exit::from_flag(report.has_c2pa || report.has_ai_metadata))
}

/// Python prints booleans capitalised.
fn python_bool(value: bool) -> &'static str {
    if value {
        "True"
    } else {
        "False"
    }
}
