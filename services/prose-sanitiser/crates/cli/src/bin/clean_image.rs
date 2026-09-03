//! Strip C2PA and AI-related metadata from PNG/JPEG/WebP.

use std::path::PathBuf;

use clap::Parser;
use prose_sanitiser::common::{
    backup_path, cleaned_path, eprint_line, run_cli, to_pretty_json, CliError,
};
use prose_sanitiser::exit;
use prose_sanitiser::image::harness::{CtrlRegenOptions, MarkDiffusionOptions};
use prose_sanitiser::image::{clean_image, engine_label, CleanImageOptions, PixelRemover};
use serde_json::Value;

#[derive(Parser)]
#[command(about = "Strip C2PA and AI-related metadata from PNG/JPEG/WebP.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// Input PNG, JPEG, or WebP
    path: PathBuf,
    /// Output path (default: *.cleaned.*)
    #[arg(short, long)]
    output: Option<PathBuf>,
    /// Overwrite the input (writes a .bak backup first)
    #[arg(long = "in-place")]
    in_place: bool,
    /// Only drop segments/chunks that look like C2PA/AI (less aggressive)
    #[arg(long = "keep-non-ai-metadata")]
    keep_non_ai_metadata: bool,
    /// JSON result on stdout
    #[arg(long)]
    json: bool,
    /// reverse-SynthID checkout root for optional pixel SynthID scoring
    #[arg(long = "synthid-dir")]
    synthid_dir: Option<String>,
    /// Run optional pixel-watermark removal after metadata cleaning
    #[arg(long = "remove-pixel", value_parser = ["ctrlregen", "diffusion"])]
    remove_pixel: Option<String>,
    /// noai-watermark checkout root (default: $NOAI_WATERMARK_DIR)
    #[arg(long = "ctrlregen-dir")]
    ctrlregen_dir: Option<String>,
    /// CtrlRegen strength in (0, 1]
    #[arg(long = "ctrlregen-strength", default_value_t = 0.25)]
    ctrlregen_strength: f64,
    /// CtrlRegen diffusion steps
    #[arg(long = "ctrlregen-steps", default_value_t = 50)]
    ctrlregen_steps: u32,
    /// CtrlRegen device: auto|cpu|cuda|mps
    #[arg(long = "ctrlregen-device")]
    ctrlregen_device: Option<String>,
    /// Optional CtrlRegen RNG seed
    #[arg(long = "ctrlregen-seed")]
    ctrlregen_seed: Option<i64>,
    /// CtrlRegen subprocess timeout in seconds
    #[arg(long = "ctrlregen-timeout", default_value_t = 3600)]
    ctrlregen_timeout: u64,
    /// MarkDiffusion bootstrap dir (default: $MARKDIFFUSION_DIR)
    #[arg(long = "markdiffusion-dir")]
    markdiffusion_dir: Option<String>,
    /// DiffusionPurification strength in (0, 1]
    #[arg(long = "markdiffusion-strength", default_value_t = 0.3)]
    markdiffusion_strength: f64,
    /// Stable Diffusion model for purification (default: SD 2.1 base)
    #[arg(long = "markdiffusion-model")]
    markdiffusion_model: Option<String>,
    /// Purification working size in px
    #[arg(long = "markdiffusion-size", default_value_t = 512)]
    markdiffusion_size: u32,
    /// Purification diffusion steps
    #[arg(long = "markdiffusion-steps", default_value_t = 50)]
    markdiffusion_steps: u32,
    /// Purification device: auto|cpu|cuda|mps
    #[arg(long = "markdiffusion-device")]
    markdiffusion_device: Option<String>,
    /// Purification subprocess timeout in seconds
    #[arg(long = "markdiffusion-timeout", default_value_t = 3600)]
    markdiffusion_timeout: u64,
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

    // --in-place cleans from the backup into the original path, so the
    // original is never partially lost.
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

    let remover = args.remove_pixel.as_deref().and_then(PixelRemover::parse);
    let options = CleanImageOptions {
        strip_all_metadata: !args.keep_non_ai_metadata,
        synthid_dir: args.synthid_dir.clone(),
        remove_pixel: remover,
        ctrlregen: CtrlRegenOptions {
            upstream_dir: args.ctrlregen_dir.clone(),
            strength: args.ctrlregen_strength,
            steps: args.ctrlregen_steps,
            device: args.ctrlregen_device.clone(),
            seed: args.ctrlregen_seed,
            timeout_secs: args.ctrlregen_timeout,
        },
        markdiffusion: MarkDiffusionOptions {
            upstream_dir: args.markdiffusion_dir.clone(),
            strength: args.markdiffusion_strength,
            model: args.markdiffusion_model.clone(),
            size: args.markdiffusion_size,
            steps: args.markdiffusion_steps,
            device: args.markdiffusion_device.clone(),
            timeout_secs: args.markdiffusion_timeout,
        },
    };

    let result = clean_image(&source, &dest, &options)
        .map_err(|error| CliError::new(exit::ERROR, format!("error: {error}")))?;

    let residual = result["still_has_c2pa"].as_bool().unwrap_or(false)
        || result["still_has_ai_metadata"].as_bool().unwrap_or(false);
    let pixel = result.get("pixel_removal").filter(|value| !value.is_null());
    let pixel_failed = pixel
        .map(|value| !value["available"].as_bool().unwrap_or(false))
        .unwrap_or(false);

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
        report_synthid(&result["synthid_before"], "before");
        report_synthid(&result["synthid_after"], "after");
        if let Some(pixel) = pixel {
            let engine = remover.map(engine_label).unwrap_or("pixel remover");
            if pixel["available"].as_bool().unwrap_or(false) {
                eprint_line(&format!(
                    "{engine}: removed on {}",
                    pixel["device"].as_str().unwrap_or("unknown device")
                ));
            } else {
                eprint_line(&format!(
                    "{engine}: unavailable: {}",
                    pixel["error"].as_str().unwrap_or("unknown error")
                ));
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
    Ok(exit::from_flag(residual || pixel_failed))
}

fn report_synthid(value: &Value, phase: &str) {
    if !value["available"].as_bool().unwrap_or(false) {
        return;
    }
    let watermarked = value["is_watermarked"].as_bool().unwrap_or(false);
    eprint_line(&format!(
        "SynthID {phase}: confidence {:.3} (watermarked: {})",
        value["confidence"].as_f64().unwrap_or(0.0),
        if watermarked { "yes" } else { "no" }
    ));
}
