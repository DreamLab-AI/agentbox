//! Strip invisible Unicode / normalise space homoglyphs (Layer A).

use std::path::Path;

use clap::Parser;
use prose_sanitiser::common::{
    backup_path, cleaned_path, eprint_line, read_text_input, run_cli, to_pretty_json,
    write_text_output, CliError,
};
use prose_sanitiser::text::{clean_text, CleanOptions};

#[derive(Parser)]
#[command(about = "Strip invisible Unicode / normalise space homoglyphs (Layer A).")]
struct Args {
    /// Input text file, or - for stdin
    #[arg(default_value = "-")]
    path: String,
    /// Output path (default: stdout or *.cleaned.*)
    #[arg(short, long)]
    output: Option<String>,
    /// Apply Unicode NFKC after the scrub
    #[arg(long)]
    nfkc: bool,
    /// Map Cyrillic/fullwidth Latin confusables to ASCII Latin
    #[arg(long = "aggressive-homoglyphs")]
    aggressive_homoglyphs: bool,
    /// Do not rewrite exotic spaces to U+0020
    #[arg(long = "no-normalize-spaces")]
    no_normalize_spaces: bool,
    /// Paranoid: strip all load-bearing invisibles too
    #[arg(long = "strip-emoji-glue")]
    strip_emoji_glue: bool,
    /// Print stats JSON to stderr
    #[arg(long)]
    stats: bool,
    /// Clean even when the input looks like a binary container (this rewrites
    /// the bytes and will corrupt the file)
    #[arg(long = "force-text")]
    force_text: bool,
    /// Overwrite the input file (creates a .bak backup)
    #[arg(long = "in-place")]
    in_place: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    let units = read_text_input(Some(&args.path), args.force_text, None)?;
    let (cleaned, stats) = clean_text(
        &units,
        CleanOptions {
            nfkc: args.nfkc,
            aggressive_homoglyphs: args.aggressive_homoglyphs,
            normalize_spaces: !args.no_normalize_spaces,
            strip_emoji_glue: args.strip_emoji_glue,
        },
    );

    let mut out = args.output.clone();
    if args.in_place {
        if args.path == "-" {
            return Err(CliError::new(2, "--in-place requires a file path"));
        }
        let source = Path::new(&args.path);
        backup_path(source)?;
        out = Some(args.path.clone());
    } else if out.is_none() && args.path != "-" {
        out = Some(
            cleaned_path(Path::new(&args.path), ".cleaned")
                .display()
                .to_string(),
        );
    }

    write_text_output(&cleaned, out.as_deref())?;

    if args.stats {
        eprint_line(&to_pretty_json(&stats.to_json()));
    } else {
        eprint_line(&format!(
            "removed={} replaced={} len {}->{}",
            stats.removed_count, stats.replaced_count, stats.input_length, stats.output_length
        ));
    }
    Ok(0)
}
