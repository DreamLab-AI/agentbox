//! Small regex-based markdown extraction helpers shared between the parser
//! and the OWL2 validator.
//!
//! Rust's `regex` crate has no look-ahead/look-behind support (it is a
//! linear-time automaton, not a backtracking engine), so the Python
//! originals' `(?=...)` terminator lookaheads are re-expressed here as
//! "find the terminator, then slice" — which is exactly what the lookahead
//! was doing under the hood, and produces identical results for every
//! pattern in this crate (none of them use backreferences).

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

/// `-\s*###\s*OntologyBlock` — the start of an OntologyBlock section, found
/// anywhere in the content (not anchored to line start), mirroring
/// `re.search` semantics in the Python original.
static BLOCK_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-\s*###\s*OntologyBlock").unwrap());

/// `\n-\s*##` — a *top-level* (column-zero, unindented) line starting with
/// `-` and a `##` heading marker. This is the OntologyBlock section
/// terminator. Deliberately requires the dash to sit immediately after the
/// newline (no leading whitespace) so that indented sub-headings such as
/// `  - #### Relationships` do NOT terminate the block.
static BLOCK_TERMINATOR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n-\s*##").unwrap());

/// Extract the OntologyBlock section from full markdown content.
///
/// Ported from `OntologyParser._extract_block_section`. If no
/// `### OntologyBlock` heading is found, the entire input is returned
/// unchanged (matching the Python fallback).
pub fn extract_block_section(content: &str) -> String {
    let Some(start_m) = BLOCK_START_RE.find(content) else {
        return content.to_string();
    };
    let rest = &content[start_m.start()..];
    match BLOCK_TERMINATOR_RE.find(rest) {
        Some(term_m) => rest[..term_m.start()].to_string(),
        None => rest.to_string(),
    }
}

/// ```` ```clojure\s*\n(.*?)\n\s*``` ```` — extract every fenced `clojure`
/// code block's inner content (each capture may itself contain embedded
/// newlines; it is treated as ONE axiom string, never split into lines).
static OWL_AXIOM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)```clojure\s*\n(.*?)\n\s*```").unwrap());

/// Extract OWL axioms from ```clojure blocks.
///
/// Ported from `OntologyParser._extract_owl_axioms` /
/// `OWL2Validator._extract_owl_axioms` (identical in both Python originals).
pub fn extract_owl_axioms(content: &str) -> Vec<String> {
    OWL_AXIOM_RE
        .captures_iter(content)
        .map(|c| c[1].to_string())
        .collect()
}

/// `\[\[([^\]]+)\]\]` — a single WikiLink target.
static WIKI_LINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

/// Extract all `[[WikiLink]]` targets from content, in first-seen order with
/// duplicates removed (order is irrelevant to every caller — both Rust and
/// Python callers use it as a set).
pub fn extract_cross_references(content: &str) -> BTreeSet<String> {
    WIKI_LINK_RE
        .captures_iter(content)
        .map(|c| c[1].to_string())
        .collect()
}

/// Extract all `[[WikiLink]]` targets in a string, preserving order and
/// duplicates (used when parsing a Relationships target list, e.g.
/// `[[Block]], [[Transaction]]`).
pub fn find_wiki_links(text: &str) -> Vec<String> {
    WIKI_LINK_RE
        .captures_iter(text)
        .map(|c| c[1].to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_section_stops_at_top_level_heading_not_indented_subheading() {
        let content = "\
- ### OntologyBlock
  id:: bitcoin-ontology

  - **Identification**
    - term-id:: BC-0500

  - #### Relationships
    - is-subclass-of:: [[Cryptocurrency]]

- ## About Bitcoin
Content here...
";
        let section = extract_block_section(content);
        assert!(section.contains("#### Relationships"));
        assert!(section.contains("is-subclass-of"));
        assert!(!section.contains("About Bitcoin"));
    }

    #[test]
    fn block_section_falls_back_to_whole_content_when_no_heading() {
        let content = "no ontology block here";
        assert_eq!(extract_block_section(content), content);
    }

    #[test]
    fn owl_axioms_extracted_as_single_multiline_strings() {
        let content = "```clojure\nPrefix(:=<http://x#>)\nOntology(<http://x/1>\n  Declaration(Class(bc:X))\n)\n```\n";
        let axioms = extract_owl_axioms(content);
        assert_eq!(axioms.len(), 1);
        assert!(axioms[0].contains("Prefix("));
        assert!(axioms[0].contains("Declaration(Class(bc:X))"));
    }

    #[test]
    fn cross_references_deduplicated() {
        let content = "[[A]] and [[B]] and [[A]] again";
        let refs = extract_cross_references(content);
        assert_eq!(refs.len(), 2);
        assert!(refs.contains("A"));
        assert!(refs.contains("B"));
    }
}
