//! Strip invisible Unicode / normalise space homoglyphs (Layer A).

use std::path::Path;

use clap::Parser;
use prose_sanitiser::common::{
    backup_path, cleaned_path, eprint_line, read_text_input, run_cli, to_pretty_json,
    write_text_output, CliError,
};
use prose_sanitiser::exit;
use prose_sanitiser::text::bidi::BidiContext;
use prose_sanitiser::text::{clean_text, CleanOptions};

#[derive(Parser)]
#[command(about = "Strip invisible Unicode / normalise space homoglyphs (Layer A).",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
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
    /// With --aggressive-homoglyphs, fold every ASCII-confusable character, not
    /// only the ones the mixed-script rules flag. This mangles honest Greek,
    /// Cyrillic and Turkish prose, so it is off by default.
    #[arg(long = "fold-all-confusables")]
    fold_all_confusables: bool,
    /// Treat the input as source code: reject bidi controls outright rather
    /// than preserving balanced ones (Trojan Source, CVE-2021-42574)
    #[arg(long)]
    code: bool,
    /// Rewrite exotic spaces (U+00A0, U+202F and the rest) to U+0020.
    ///
    /// Off by default. A no-break space is load-bearing typography as often as
    /// it is a carrier: it holds "10 km" and "Figure 3" together, and French
    /// orthography requires one before ; : ! and ?. It is also the one rewrite
    /// in this layer a diff cannot show, because both characters render as a
    /// space.
    #[arg(long = "normalize-spaces")]
    normalize_spaces: bool,
    /// Deprecated no-op, accepted so existing invocations keep running.
    ///
    /// Space normalisation is off by default now, so asking for it to be off
    /// changes nothing. Use `--normalize-spaces` to turn it on.
    #[arg(long = "no-normalize-spaces", hide = true)]
    no_normalize_spaces: bool,
    /// Paranoid: strip all load-bearing invisibles too
    #[arg(long = "strip-emoji-glue")]
    strip_emoji_glue: bool,
    /// Remove U+00AD SOFT HYPHEN. Off by default: it is a legitimate
    /// hyphenation hint as often as it is a steganographic carrier, so removing
    /// it unconditionally damages correctly typeset text.
    #[arg(long = "strip-soft-hyphen")]
    strip_soft_hyphen: bool,
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
    if args.no_normalize_spaces {
        eprint_line(
            "note: --no-normalize-spaces is a no-op and will be removed. Space normalisation \
             is off by default; pass --normalize-spaces to turn it on.",
        );
    }
    let units = read_text_input(Some(&args.path), args.force_text, None)?;
    // The struct spread is deliberate and clippy's `needless_update` is wrong
    // here. Every field happens to be set today, but `CleanOptions` is owned by
    // `prose-sanitiser-unicode` and has gained three fields this sprint alone
    // (`mixed_script_only`, `bidi_context`, `strip_soft_hyphen`), each of which
    // broke this literal in a shared worktree and reddened the build for every
    // other worker. Keeping the spread means the next field arrives at its safe
    // default instead of failing the build.
    #[allow(clippy::needless_update)]
    let options = CleanOptions {
        nfkc: args.nfkc,
        aggressive_homoglyphs: args.aggressive_homoglyphs,
        mixed_script_only: !args.fold_all_confusables,
        normalize_spaces: args.normalize_spaces,
        strip_emoji_glue: args.strip_emoji_glue,
        strip_soft_hyphen: args.strip_soft_hyphen,
        bidi_context: if args.code {
            BidiContext::Code
        } else {
            BidiContext::Prose
        },
        ..CleanOptions::default()
    };
    let (cleaned, stats) = clean_text(&units, options);

    let mut out = args.output.clone();
    if args.in_place {
        if args.path == "-" {
            return Err(CliError::new(
                exit::ERROR,
                "--in-place requires a file path",
            ));
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
    Ok(exit::CLEAN)
}
