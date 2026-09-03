//! Deterministic draw.io and Mermaid extraction to a normalised diagram IR,
//! plus the packaged accessible-diagram self-check.
//!
//! Trust boundary: every entry point here parses bounded text or bytes. Nothing
//! in this crate evaluates, renders, fetches or executes its input — no network,
//! no subprocesses, no DTD or entity expansion, and hard caps on input size,
//! decompressed size, node count and edge count.

pub mod drawio;
pub mod entities;
mod entities_table;
pub mod markdown;
pub mod mermaid;
pub mod pyfmt;
pub mod selfcheck;
pub mod xmldom;

/// A fatal, user-facing condition. The binaries print it behind their own
/// `drawio_extract: ` / `mermaid_extract: ` prefix and exit 2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail(pub String);

impl Fail {
    pub fn new(message: impl Into<String>) -> Self {
        Fail(message.into())
    }
}

impl std::fmt::Display for Fail {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Fail {}

pub type Failable<T> = std::result::Result<T, Fail>;
