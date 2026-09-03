//! Extract a normalised intermediate representation (IR) from a draw.io file.
//!
//! The deterministic half of the draw.io import flow: this program never makes
//! a design decision. It decodes whatever draw.io wrote (raw XML, deflate +
//! base64 payloads, PNG/SVG files with an embedded `mxfile`), flattens the
//! `mxGraphModel` into absolute-positioned nodes and edges, and reports
//! structural signals — hubs, containers, depth, cycles, leaf clusters — that
//! the skill uses to pick a diagram type and a level of detail.
//!
//! Default output is a compact Markdown digest meant to be read into context.
//! `--json` emits the full IR instead (every node, every edge, every style).
//!
//! Exit codes: 0 ok, 2 unreadable / unsupported input.

use clap::Parser;

use diagram_ir::drawio::decode::MAX_INPUT_BYTES;
use diagram_ir::drawio::digest::{digest, select_pages, to_json};
use diagram_ir::drawio::model::{load_mxfile, parse_file};
use diagram_ir::pyfmt::{char_len, path_name, path_str};
use diagram_ir::Failable;

#[derive(Parser, Debug)]
#[command(
    name = "drawio-extract",
    about = "Extract a normalised intermediate representation (IR) from a draw.io file."
)]
struct Args {
    /// .drawio / .xml / .drawio.png / .drawio.svg
    file: String,
    /// page index, page name, or 'all' (default: first page)
    #[arg(long)]
    page: Option<String>,
    /// emit the full IR as JSON
    #[arg(long)]
    json: bool,
    /// rows per table in the Markdown digest (default 40)
    #[arg(long = "max-rows", default_value_t = 40)]
    max_rows: i64,
    /// write to this path instead of stdout
    #[arg(long)]
    out: Option<String>,
}

fn fail(message: &str) -> ! {
    eprintln!("drawio_extract: {message}");
    std::process::exit(2);
}

fn run(args: &Args) -> Failable<String> {
    let path = path_str(&args.file);
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return Err(diagram_ir::Fail::new(format!("{path}: no such file"))),
    };
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(diagram_ir::Fail::new(format!(
            "{}: input is {} bytes; maximum is {} MiB",
            path_name(&path),
            metadata.len(),
            MAX_INPUT_BYTES / (1024 * 1024)
        )));
    }
    let data =
        std::fs::read(&path).map_err(|error| diagram_ir::Fail::new(format!("{path}: {error}")))?;
    let xml = load_mxfile(&path, &data)?;
    let pages = parse_file(&path, &xml)?;
    let selected = select_pages(&pages, args.page.as_deref())?;
    let selected: Vec<_> = selected.into_iter().cloned().collect();
    Ok(if args.json {
        to_json(&path, &pages, &selected)
    } else {
        digest(&path, &pages, &selected, args.max_rows as usize)
    })
}

fn main() {
    let args = Args::parse();
    if args.max_rows < 1 {
        fail("--max-rows must be at least 1");
    }
    let text = match run(&args) {
        Ok(text) => text,
        Err(error) => fail(&error.0),
    };
    match &args.out {
        Some(out) => {
            if let Err(error) = std::fs::write(out, &text) {
                fail(&format!("cannot write {out}: {error}"));
            }
            println!("wrote {out} ({} bytes)", char_len(&text));
        }
        None => {
            if text.ends_with('\n') {
                print!("{text}");
            } else {
                println!("{text}");
            }
        }
    }
}
