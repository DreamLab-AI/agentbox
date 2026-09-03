//! Mermaid import: parse bounded text into the same IR shape as the draw.io
//! side. Nothing here evaluates, renders, fetches or executes Mermaid,
//! JavaScript, URLs, directives or label content — click targets and styling
//! are counted and discarded, and retained labels are inert text.

pub mod analyse;
pub mod digest;
pub mod er;
pub mod flowchart;
pub mod label;
pub mod lex;
pub mod model;
pub mod sequence;
pub mod shapes;
pub mod state;

use crate::Failable;

pub const MAX_SOURCE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_NODES: usize = 2000;
pub const MAX_EDGES: usize = 5000;
pub const SUPPORTED_KINDS: &str = "flowchart, sequenceDiagram, stateDiagram-v2, erDiagram";

/// `parse_block`.
pub fn parse_block(block: &lex::SourceBlock) -> Failable<model::Diagram> {
    let lines = lex::prepared_lines(block);
    let (kind, direction, header_position) = lex::kind_and_direction(&lines)?;
    let mut diagram = model::Diagram::new(block.index, &kind, block.source_line, &direction);
    match kind.as_str() {
        "flowchart" => flowchart::parse(&mut diagram, &lines, header_position)?,
        "sequenceDiagram" => sequence::parse(&mut diagram, &lines, header_position)?,
        "stateDiagram-v2" => state::parse(&mut diagram, &lines, header_position)?,
        _ => er::parse(&mut diagram, &lines, header_position)?,
    }
    diagram.finalise_degrees();
    Ok(diagram)
}
