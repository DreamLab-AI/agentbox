//! Extract a normalised intermediate representation (IR) from Mermaid text.
//!
//! Trust boundary: this program parses bounded text. It never evaluates,
//! renders, fetches, or executes Mermaid, JavaScript, URLs, directives, or
//! label content. Every label and directive value is untrusted data. Click
//! targets and styling are counted and discarded; retained labels are emitted
//! only as inert text.
//!
//! Supported grammars are flowchart/graph, sequenceDiagram, stateDiagram-v2,
//! and erDiagram. Inputs may be .mmd, .mermaid, or Markdown files containing
//! fenced `mermaid` blocks.
//!
//! Exit codes: 0 success, 2 unreadable, unsupported, malformed, or over limits.

use std::io::Read;

use clap::Parser;

use diagram_ir::mermaid::digest::{digest, select_diagrams, to_json};
use diagram_ir::mermaid::lex::{check_suffix, split_blocks};
use diagram_ir::mermaid::{parse_block, MAX_SOURCE_BYTES};
use diagram_ir::pyfmt::{char_len, path_name, path_str};
use diagram_ir::{Fail, Failable};

#[derive(Parser, Debug)]
#[command(
    name = "mermaid-extract",
    about = "Extract a normalised intermediate representation (IR) from Mermaid text."
)]
struct Args {
    /// .mmd, .mermaid, or Markdown with mermaid fences
    file: String,
    /// diagram index or 'all' (default: first diagram)
    #[arg(long)]
    diagram: Option<String>,
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
    eprintln!("mermaid_extract: {message}");
    std::process::exit(2);
}

/// `_read_bounded` — reads one byte past the cap so the limit can be detected
/// without loading an unbounded file.
fn read_bounded(path: &str) -> Failable<String> {
    let file = std::fs::File::open(path).map_err(|error| Fail::new(format!("{path}: {error}")))?;
    let mut data = Vec::new();
    file.take(MAX_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| Fail::new(format!("{path}: {error}")))?;
    if data.len() > MAX_SOURCE_BYTES {
        return Err(Fail::new(format!(
            "source exceeds the {} MiB limit",
            MAX_SOURCE_BYTES / (1024 * 1024)
        )));
    }
    String::from_utf8(data).map_err(|_| {
        Fail::new(format!(
            "{}: source is not valid UTF-8 text",
            path_name(path)
        ))
    })
}

fn run(args: &Args) -> Failable<String> {
    let path = path_str(&args.file);
    if !std::fs::metadata(&path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
    {
        return Err(Fail::new(format!("{path}: no such file")));
    }
    check_suffix(&path)?;
    let source = read_bounded(&path)?;
    let blocks = split_blocks(&path, &source)?;
    let mut diagrams = Vec::new();
    for block in &blocks {
        diagrams.push(parse_block(block)?);
    }
    let selected = select_diagrams(&diagrams, args.diagram.as_deref())?;
    Ok(if args.json {
        to_json(&path, &diagrams, &selected)
    } else {
        digest(&path, &diagrams, &selected, args.max_rows as usize)
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
