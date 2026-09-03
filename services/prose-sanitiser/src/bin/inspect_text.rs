//! Inspect text for invisible Unicode / space homoglyphs (Layer A).

use clap::Parser;
use prose_sanitiser::common::{emit_json, read_text_input, run_cli, CliError};
use prose_sanitiser::text::{human_report, inspect_text};

#[derive(Parser)]
#[command(about = "Inspect text for invisible Unicode / space homoglyphs (Layer A).")]
struct Args {
    /// Text file path, or - for stdin
    #[arg(default_value = "-")]
    path: String,
    /// JSON report
    #[arg(long)]
    json: bool,
    /// Also flag Latin confusable / fullwidth lookalikes
    #[arg(long)]
    aggressive: bool,
    /// Paranoid: flag all load-bearing invisibles too (emoji glue, script
    /// joiners, flag tags, same-script fillers/selectors, orthographic Cf)
    #[arg(long = "strip-emoji-glue")]
    strip_emoji_glue: bool,
    /// Scan even when the input looks like a binary container
    #[arg(long = "force-text")]
    force_text: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    let units = read_text_input(Some(&args.path), args.force_text, None)?;
    let report = inspect_text(&units, args.aggressive, args.strip_emoji_glue);
    if args.json {
        emit_json(&report.to_json());
    } else {
        println!("{}", human_report(&report));
    }
    Ok(i32::from(report.suspicious_total != 0))
}
