//! Aggregate AI-provenance audit over the URLs listed in a sitemap.

use clap::Parser;
use prose_sanitiser::audit::website::{
    collect_urls, discover_sitemap, fetch, inspect_remote, DEFAULT_MAX_BYTES, DEFAULT_MAX_PAGES,
    DEFAULT_TIMEOUT,
};
use prose_sanitiser::audit::{aggregate, human_report};
use prose_sanitiser::common::{emit_json, run_cli, CliError};
use prose_sanitiser::exit;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(about = "Aggregate AI-provenance audit over the URLs listed in a sitemap.",
    after_help = prose_sanitiser::exit::HELP_EPILOGUE
)]
struct Args {
    /// Sitemap URL to audit
    #[arg(long)]
    sitemap: Option<String>,
    /// Base URL; discover the sitemap automatically
    #[arg(long)]
    base: Option<String>,
    #[arg(long = "max-pages", default_value_t = DEFAULT_MAX_PAGES)]
    max_pages: usize,
    #[arg(long, default_value_t = DEFAULT_TIMEOUT)]
    timeout: u64,
    #[arg(long = "max-bytes", default_value_t = DEFAULT_MAX_BYTES)]
    max_bytes: usize,
    #[arg(long)]
    json: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if args.sitemap.is_none() && args.base.is_none() {
        return Err(CliError::new(
            exit::ERROR,
            "provide --sitemap URL or --base URL",
        ));
    }

    let sitemap_url = match &args.sitemap {
        Some(url) => url.clone(),
        None => {
            let base = args.base.as_deref().expect("checked above");
            match discover_sitemap(base, args.timeout) {
                Ok(Some(url)) => url,
                Ok(None) => {
                    return Err(CliError::new(
                        exit::ERROR,
                        format!("no sitemap found for {base}"),
                    ))
                }
                Err(error) => {
                    return Err(CliError::new(
                        exit::ERROR,
                        format!("invalid base URL: {error}"),
                    ))
                }
            }
        }
    };

    let urls = collect_urls(&sitemap_url, args.timeout, args.max_pages).map_err(|error| {
        CliError::new(
            2,
            format!("could not collect URLs from {sitemap_url}: {error}"),
        )
    })?;
    if urls.is_empty() {
        return Err(CliError::new(exit::ERROR, "no URLs collected from sitemap"));
    }

    let mut files: Vec<Value> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    for url in urls.iter().take(args.max_pages) {
        match fetch(url, args.timeout, args.max_bytes, None) {
            Ok((data, content_type)) => {
                files.push(inspect_remote(url, &data, content_type.as_deref()));
            }
            Err(error) => failures.push(json!({"url": url, "error": error})),
        }
    }

    let summary = aggregate(&files);
    let actionable = summary["actionable_files"].as_u64().unwrap_or(0);

    if args.json {
        emit_json(&json!({
            "sitemap": sitemap_url,
            "base": args.base,
            "urls_collected": urls.len(),
            "urls_scanned": files.len(),
            "urls_failed": failures,
            "summary": summary,
            "files": files,
        }));
    } else {
        println!(
            "{}",
            human_report(
                &files,
                &summary,
                &[
                    ("Sitemap".into(), sitemap_url.clone()),
                    ("URLs collected".into(), urls.len().to_string()),
                    ("URLs scanned".into(), files.len().to_string()),
                    ("URLs failed".into(), failures.len().to_string()),
                ],
            )
        );
        for failure in &failures {
            println!(
                "  [error] {}: {}",
                failure["url"].as_str().unwrap_or_default(),
                failure["error"].as_str().unwrap_or_default()
            );
        }
    }

    Ok(exit::from_flag(actionable > 0))
}
