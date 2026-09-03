//! Report-only per-rule counts over a set of files.
//!
//! Point it at a corpus of known-good British prose and every finding is, by
//! construction, a false positive. The `per 10k words` column is then the
//! per-rule false-positive rate, which is the number the crate should be
//! judged on.
//!
//! ```text
//! cargo run -p prose-sanitiser-uk --example uk-report -- \
//!     [--oxford] [--verbose] [--write] [--allow WORD]... <path>...
//! ```
//!
//! `--allow` declares house vocabulary that is not really a dialect choice, and
//! is the honest way to separate "the tool is wrong" from "this project spells
//! it that way on purpose".
//!
//! Directories are walked recursively. Files that are not valid UTF-8 are
//! skipped and counted, because a corpus always contains one.

use std::path::{Path, PathBuf};

use prose_sanitiser_core::{Check, Config};
use prose_sanitiser_uk::{report::Summary, UkEnglish, UkOptions};

const USAGE: &str = "usage: uk-report [--oxford] [--verbose] [--write] [--allow WORD]... <path>...";

fn main() {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut config = Config::new();
    let mut allowed: Vec<String> = Vec::new();
    let mut verbose = false;
    let mut expecting_word = false;

    for argument in std::env::args().skip(1) {
        if expecting_word {
            allowed.push(argument);
            expecting_word = false;
            continue;
        }
        match argument.as_str() {
            "--oxford" => config = config.with_oxford(true),
            "--write" => config = config.with_write(true),
            "--verbose" => verbose = true,
            "--allow" => expecting_word = true,
            "--help" | "-h" => {
                println!("{USAGE}");
                return;
            }
            other => paths.push(PathBuf::from(other)),
        }
    }

    if paths.is_empty() || expecting_word {
        eprintln!("{USAGE}");
        std::process::exit(2);
    }

    let checker = UkEnglish::with_options(UkOptions::new().with_allowed_words(&allowed));
    let mut summary = Summary::new();
    let mut skipped = 0usize;

    for path in &paths {
        for file in collect(path) {
            let Ok(document) = std::fs::read_to_string(&file) else {
                skipped += 1;
                continue;
            };
            let findings = checker.check(&document, &config);
            if verbose {
                for finding in &findings {
                    println!(
                        "{}:{}: [{}] {} -- {}",
                        file.display(),
                        line_of(&document, finding.span.start),
                        finding.rule_id,
                        finding.matched,
                        finding.advice,
                    );
                }
            }
            summary.record(&document, &findings, &config);
        }
    }

    print!("{}", summary.render());
    if skipped > 0 {
        println!("skipped (not UTF-8): {skipped}");
    }
}

/// Every file under `path`, or `path` itself if it is a file.
fn collect(path: &Path) -> Vec<PathBuf> {
    if path.is_file() {
        return vec![path.to_path_buf()];
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .flat_map(|entry| collect(&entry.path()))
        .collect();
    files.sort();
    files
}

/// One-based line number of `offset`, for the verbose listing.
fn line_of(document: &str, offset: usize) -> usize {
    document[..offset].matches('\n').count() + 1
}
