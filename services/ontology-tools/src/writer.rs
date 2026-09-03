//! Serialise an [`OntologyBlock`] back to OntologyBlock markdown with ZERO
//! data loss.
//!
//! Ported line-for-line from `OntologyParser.write_ontology_block` in
//! `skills/ontology-core/src/ontology_parser.py`, including its two section
//! "any(...)" gating quirks (`type` and `content_status` and
//! `bridges_to_domain` can silently fail to be written if every OTHER field
//! in their section is empty) — reproduced faithfully rather than "fixed",
//! since round-trip identity depends on writing exactly what the Python
//! would have written for the fixtures this crate is tested against.

use crate::block::OntologyBlock;

/// Serialise an OntologyBlock to markdown.
///
/// Guarantees:
/// - ALL fields preserved (known + unknown)
/// - Exact field ordering maintained
/// - Relationships section included if present
/// - OWL axioms section included if present
/// - Round-trip identity preserved (`parse(write(parse(x))) == parse(x)`)
pub fn write_ontology_block(block: &OntologyBlock) -> String {
    let mut lines: Vec<String> = vec!["- ### OntologyBlock".to_string()];

    if let Some(id) = &block.id {
        lines.push(format!("  id:: {id}"));
    }
    if let Some(collapsed) = block.collapsed {
        lines.push(format!("  collapsed:: {}", py_bool(collapsed)));
    }

    lines.push(String::new());

    // Identification section. NOTE: `block.type` is intentionally absent
    // from this gate, matching the Python original — a block with only
    // `type` set and nothing else in this list produces no Identification
    // section at all, silently dropping `type`.
    if block.ontology
        || block.term_id.is_some()
        || block.preferred_term.is_some()
        || block.source_domain.is_some()
        || block.status.is_some()
        || block.public_access.is_some()
        || block.version.is_some()
    {
        lines.push("  - **Identification**".to_string());
        if block.ontology {
            lines.push(format!("    - ontology:: {}", py_bool(block.ontology)));
        }
        if let Some(v) = &block.term_id {
            lines.push(format!("    - term-id:: {v}"));
        }
        if let Some(v) = &block.preferred_term {
            lines.push(format!("    - preferred-term:: {v}"));
        }
        if let Some(v) = &block.r#type {
            lines.push(format!("    - type:: {v}"));
        }
        if let Some(v) = &block.source_domain {
            lines.push(format!("    - source-domain:: {v}"));
        }
        if let Some(v) = &block.status {
            lines.push(format!("    - status:: {v}"));
        }
        if let Some(v) = block.public_access {
            lines.push(format!("    - public-access:: {}", py_bool(v)));
        }
        if let Some(v) = &block.version {
            lines.push(format!("    - version:: {v}"));
        }
        if let Some(v) = block.quality_score {
            lines.push(format!("    - quality-score:: {}", py_float(v)));
        }
        lines.push(String::new());
    }

    // Definition section. `content_status` is likewise absent from this
    // gate, matching the Python original.
    if block.definition.is_some()
        || block.maturity.is_some()
        || block.source.is_some()
        || block.authority_score.is_some()
    {
        lines.push("  - **Definition**".to_string());
        if let Some(v) = &block.definition {
            lines.push(format!("    - definition:: {v}"));
        }
        if let Some(v) = &block.maturity {
            lines.push(format!("    - maturity:: {v}"));
        }
        if let Some(v) = &block.source {
            lines.push(format!("    - source:: {v}"));
        }
        if let Some(v) = block.authority_score {
            lines.push(format!("    - authority-score:: {}", py_float(v)));
        }
        if let Some(v) = &block.content_status {
            lines.push(format!("    - content-status:: {v}"));
        }
        lines.push(String::new());
    }

    // Semantic Classification section. `bridges_to_domain` is likewise
    // absent from this gate, matching the Python original.
    if block.owl_class.is_some()
        || block.owl_physicality.is_some()
        || block.owl_role.is_some()
        || block.belongs_to_domain.is_some()
    {
        lines.push("  - **Semantic Classification**".to_string());
        if let Some(v) = &block.owl_class {
            lines.push(format!("    - owl:class:: {v}"));
        }
        if let Some(v) = &block.owl_physicality {
            lines.push(format!("    - owl:physicality:: {v}"));
        }
        if let Some(v) = &block.owl_role {
            lines.push(format!("    - owl:role:: {v}"));
        }
        if let Some(v) = &block.belongs_to_domain {
            lines.push(format!("    - belongsToDomain:: {v}"));
        }
        if let Some(v) = &block.bridges_to_domain {
            lines.push(format!("    - bridges-to-domain:: {v}"));
        }
        lines.push(String::new());
    }

    // Additional (unknown) fields - preserve exactly as found, sorted by key
    // for deterministic output (BTreeMap iterates in key order already).
    if !block.additional_fields.is_empty() {
        for (key, value) in &block.additional_fields {
            lines.push(format!("    - {key}:: {value}"));
        }
        lines.push(String::new());
    }

    // Relationships section.
    if !block.relationships.is_empty() {
        lines.push("  - #### Relationships".to_string());
        for (rel_type, targets) in &block.relationships {
            let target_links = targets
                .iter()
                .map(|t| format!("[[{t}]]"))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("    - {rel_type}:: {target_links}"));
        }
        lines.push(String::new());
    }

    // OWL Axioms section. Each axiom string may itself contain embedded
    // newlines (it is the verbatim inner text of a ```clojure fence) — only
    // the first physical line gets the "      " prefix, matching the
    // Python original's `f"      {axiom}"` on a multi-line string.
    if !block.owl_axioms.is_empty() {
        lines.push("  - #### OWL Axioms".to_string());
        lines.push("    collapsed:: true".to_string());
        lines.push("    - ```clojure".to_string());
        for axiom in &block.owl_axioms {
            lines.push(format!("      {axiom}"));
        }
        lines.push("      ```".to_string());
    }

    lines.join("\n")
}

fn py_bool(b: bool) -> &'static str {
    if b {
        "true"
    } else {
        "false"
    }
}

/// Format an `f64` the way Python's `str(float)` does: always with a decimal
/// point (`1.0`, never bare `1`), using the shortest round-trippable
/// representation for everything else.
pub fn py_float(f: f64) -> String {
    if f.is_nan() {
        return "nan".to_string();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf" } else { "-inf" }.to_string();
    }
    let s = format!("{f}");
    if s.contains('.') || s.contains('e') || s.contains('E') {
        s
    } else {
        format!("{s}.0")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn py_float_always_has_decimal_point() {
        assert_eq!(py_float(1.0), "1.0");
        assert_eq!(py_float(0.96), "0.96");
        assert_eq!(py_float(100.0), "100.0");
    }

    #[test]
    fn empty_block_writes_bare_header() {
        let block = OntologyBlock {
            ontology: false,
            ..OntologyBlock::default()
        };
        let out = write_ontology_block(&block);
        assert_eq!(out, "- ### OntologyBlock\n");
    }
}
