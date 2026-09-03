//! Shared fixture plumbing for the integration tests.

#![allow(dead_code)]

use diagram_ir::drawio::model::{load_mxfile, parse_file, Page};
use diagram_ir::mermaid::lex::{check_suffix, split_blocks};
use diagram_ir::mermaid::model::Diagram;
use diagram_ir::mermaid::parse_block;
use diagram_ir::{Fail, Failable};

pub fn fixture(name: &str) -> String {
    format!("tests/fixtures/{name}")
}

pub fn golden(name: &str) -> String {
    std::fs::read_to_string(format!("tests/golden/{name}"))
        .unwrap_or_else(|error| panic!("golden {name}: {error}"))
}

pub fn drawio_pages(path: &str) -> Failable<Vec<Page>> {
    let data = std::fs::read(path).map_err(|error| Fail::new(format!("{path}: {error}")))?;
    let xml = load_mxfile(path, &data)?;
    parse_file(path, &xml)
}

pub fn drawio_output(name: &str, page: Option<&str>, json: bool, max_rows: usize) -> String {
    let path = fixture(name);
    let pages = drawio_pages(&path).expect("fixture parses");
    let selected: Vec<Page> = diagram_ir::drawio::digest::select_pages(&pages, page)
        .expect("page selection")
        .into_iter()
        .cloned()
        .collect();
    if json {
        diagram_ir::drawio::digest::to_json(&path, &pages, &selected)
    } else {
        diagram_ir::drawio::digest::digest(&path, &pages, &selected, max_rows)
    }
}

pub fn mermaid_diagrams(path: &str) -> Failable<Vec<Diagram>> {
    check_suffix(path)?;
    let source =
        std::fs::read_to_string(path).map_err(|error| Fail::new(format!("{path}: {error}")))?;
    mermaid_from_source(path, &source)
}

pub fn mermaid_from_source(path: &str, source: &str) -> Failable<Vec<Diagram>> {
    let blocks = split_blocks(path, source)?;
    blocks.iter().map(parse_block).collect()
}

/// Parse a bare Mermaid snippet as if it were a `.mmd` file.
pub fn mermaid_one(source: &str) -> Diagram {
    mermaid_from_source("snippet.mmd", source)
        .expect("snippet parses")
        .into_iter()
        .next()
        .expect("one diagram")
}

pub fn mermaid_error(source: &str) -> String {
    mermaid_from_source("snippet.mmd", source)
        .expect_err("snippet should fail")
        .0
}

pub fn mermaid_output(name: &str, selector: Option<&str>, json: bool, max_rows: usize) -> String {
    let path = fixture(name);
    let diagrams = mermaid_diagrams(&path).expect("fixture parses");
    let selected = diagram_ir::mermaid::digest::select_diagrams(&diagrams, selector)
        .expect("diagram selection");
    if json {
        diagram_ir::mermaid::digest::to_json(&path, &diagrams, &selected)
    } else {
        diagram_ir::mermaid::digest::digest(&path, &diagrams, &selected, max_rows)
    }
}

pub fn motion_template() -> String {
    "../../skills/diagram-design/assets/template-motion.html".to_string()
}
