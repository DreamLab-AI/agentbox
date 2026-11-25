//! Raw, order-preserving access to a page's top-level frontmatter keys.
//!
//! A writer that refreshes a page must change only the keys it owns and leave
//! every other key byte-for-byte as it found it, including keys a later
//! vocabulary added. So the header is handled as blocks of raw text (one per
//! top-level key), never parsed and re-serialised.

/// One top-level frontmatter key and its raw text (the key line plus every
/// continuation line), each line newline-terminated.
#[derive(Debug, Clone)]
pub struct Block {
    /// The key, without the colon.
    pub key: String,
    /// The raw text of the key line and its continuation lines.
    pub text: String,
}

impl Block {
    /// A block from a key and its complete raw text.
    pub fn new(key: &str, text: String) -> Block {
        Block {
            key: key.to_string(),
            text,
        }
    }

    /// The first line's value after `key:`, trimmed.
    pub fn scalar(&self) -> &str {
        self.text
            .lines()
            .next()
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim())
            .unwrap_or_default()
    }
}

/// Split the frontmatter's inner text into top-level blocks. A line starting
/// with a space, tab, `-` or `#` belongs to the block before it.
pub fn parse_blocks(inner: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    for line in inner.split_inclusive('\n') {
        let continuation = line.starts_with([' ', '\t', '-', '#']) || line.trim().is_empty();
        match blocks.last_mut() {
            Some(b) if continuation => b.text.push_str(line),
            _ => blocks.push(Block {
                key: line
                    .split(':')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                text: line.to_string(),
            }),
        }
    }
    for b in &mut blocks {
        if !b.text.ends_with('\n') {
            b.text.push('\n');
        }
    }
    blocks
}

/// `(frontmatter blocks, body)` of a page; no frontmatter gives no blocks.
pub fn split_page(text: &str) -> (Vec<Block>, &str) {
    let (head, body) = crate::promote::splice::split_frontmatter(text);
    let inner = head
        .strip_prefix("---\n")
        .or_else(|| head.strip_prefix("---\r\n"))
        .unwrap_or("");
    let inner = inner
        .trim_end_matches(['\n', '\r'])
        .strip_suffix("---")
        .unwrap_or("");
    (parse_blocks(inner), body)
}

/// Render blocks and a body back into a page.
pub fn join_page(blocks: &[Block], body: &str) -> String {
    let mut out = String::from("---\n");
    for b in blocks {
        out.push_str(&b.text);
    }
    out.push_str("---\n");
    out.push_str(body);
    out
}

/// Append one `contributors` entry (already rendered, newline-terminated, as a
/// list item) to the blocks: to the existing block, or as a new one. An
/// existing block must be a block list (or empty); anything else is an error,
/// so a page with an unfamiliar `contributors` form is never rewritten.
pub fn push_contributor(blocks: &mut Vec<Block>, entry: &str) -> Result<(), String> {
    match blocks.iter_mut().find(|b| b.key == "contributors") {
        Some(b) => {
            let first = b.text.lines().next().unwrap_or_default().trim_end();
            if first != "contributors:" && first != "contributors: []" {
                return Err("contributors is not a block list".to_string());
            }
            let rest = b.text.split_once('\n').map(|(_, r)| r).unwrap_or("");
            b.text = format!("contributors:\n{rest}{entry}");
        }
        None => blocks.push(Block::new(
            "contributors",
            format!("contributors:\n{entry}"),
        )),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_round_trip_byte_for_byte() {
        let page = "---\ntype: Brief\ngenerated:\n  by: x\n  at: y\nsources:\n- id: a\n  rel: b\n---\nbody\n";
        let (blocks, body) = split_page(page);
        assert_eq!(
            blocks.iter().map(|b| b.key.as_str()).collect::<Vec<_>>(),
            ["type", "generated", "sources"]
        );
        assert_eq!(join_page(&blocks, body), page);
    }

    #[test]
    fn a_contributor_is_appended_never_replaced() {
        let (mut blocks, _) = split_page("---\ncontributors: []\n---\n");
        push_contributor(&mut blocks, "- by: a\n  at: 1\n").unwrap();
        push_contributor(&mut blocks, "- by: a\n  at: 2\n").unwrap();
        assert_eq!(
            blocks[0].text,
            "contributors:\n- by: a\n  at: 1\n- by: a\n  at: 2\n"
        );
        let (mut odd, _) = split_page("---\ncontributors: nobody\n---\n");
        assert!(push_contributor(&mut odd, "- by: a\n").is_err());
    }
}
