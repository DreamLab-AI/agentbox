//! Port of `skills/ontology-core/tests/test_field_preservation.py`.
//!
//! Verifies:
//! - ALL 17+ fields are extracted and preserved
//! - Unknown fields are preserved via `additional_fields`
//! - Round-trip identity: `parse(write(parse(x))) == parse(x)`
//! - Real production-shaped files (Bitcoin, Feature Importance) work correctly

use std::collections::BTreeMap;

use ontology_tools::block::OntologyBlock;
use ontology_tools::parser::OntologyParser;
use ontology_tools::writer::write_ontology_block;

#[test]
fn bitcoin_field_preservation() {
    let bitcoin_content = "\
- ### OntologyBlock
  id:: bitcoin-ontology
  collapsed:: true

  - **Identification**
    - ontology:: true
    - term-id:: BC-0500
    - preferred-term:: Bitcoin
    - source-domain:: blockchain
    - status:: complete
    - public-access:: true
    - version:: 1.0.0
    - quality-score:: 0.96

  - **Definition**
    - definition:: The first decentralised peer-to-peer electronic cash system and cryptocurrency
    - maturity:: mature
    - source:: [[Bitcoin Whitepaper (Nakamoto 2008)]]
    - authority-score:: 1.0

  - **Semantic Classification**
    - owl:class:: bc:Bitcoin
    - owl:physicality:: VirtualEntity
    - owl:role:: Object
    - belongsToDomain:: [[BlockchainDomain]]

  - #### Relationships
    - is-subclass-of:: [[Cryptocurrency]], [[Blockchain]]
    - has-part:: [[Block]], [[Transaction]]
    - implements:: [[Proof of Work]]

- ## About Bitcoin
Content here...
";

    let parser = OntologyParser::new();
    let block = parser.parse_ontology_block(bitcoin_content, None);

    assert_eq!(block.id.as_deref(), Some("bitcoin-ontology"));
    assert_eq!(block.collapsed, Some(true));
    assert!(block.ontology);
    assert_eq!(block.term_id.as_deref(), Some("BC-0500"));
    assert_eq!(block.preferred_term.as_deref(), Some("Bitcoin"));
    assert_eq!(block.source_domain.as_deref(), Some("blockchain"));
    assert_eq!(block.status.as_deref(), Some("complete"));
    assert_eq!(block.public_access, Some(true));
    assert_eq!(block.version.as_deref(), Some("1.0.0"));
    assert_eq!(block.quality_score, Some(0.96));
    assert!(block
        .definition
        .as_deref()
        .unwrap()
        .contains("decentralised"));
    assert_eq!(block.maturity.as_deref(), Some("mature"));
    assert_eq!(block.authority_score, Some(1.0));
    assert_eq!(block.owl_class.as_deref(), Some("bc:Bitcoin"));
    assert_eq!(block.owl_physicality.as_deref(), Some("VirtualEntity"));
    assert_eq!(block.owl_role.as_deref(), Some("Object"));
    assert_eq!(
        block.belongs_to_domain.as_deref(),
        Some("[[BlockchainDomain]]")
    );

    assert!(block.relationships.contains_key("is-subclass-of"));
    assert!(block.relationships["is-subclass-of"].contains(&"Cryptocurrency".to_string()));
    assert!(block.relationships.contains_key("has-part"));
    assert!(block.relationships["has-part"].contains(&"Block".to_string()));

    // Round trip.
    let written = write_ontology_block(&block);
    let block2 = parser.parse_ontology_block(&written, None);

    assert_eq!(block.id, block2.id);
    assert_eq!(block.collapsed, block2.collapsed);
    assert_eq!(block.ontology, block2.ontology);
    assert_eq!(block.term_id, block2.term_id);
    assert_eq!(block.preferred_term, block2.preferred_term);
    assert_eq!(block.source_domain, block2.source_domain);
    assert_eq!(block.status, block2.status);
    assert_eq!(block.public_access, block2.public_access);
    assert_eq!(block.version, block2.version);
    assert_eq!(block.quality_score, block2.quality_score);
    assert_eq!(block.definition, block2.definition);
    assert_eq!(block.maturity, block2.maturity);
    assert_eq!(block.authority_score, block2.authority_score);
    assert_eq!(block.owl_class, block2.owl_class);
    assert_eq!(block.owl_physicality, block2.owl_physicality);
    assert_eq!(block.owl_role, block2.owl_role);
    assert_eq!(block.belongs_to_domain, block2.belongs_to_domain);
    assert_eq!(block.relationships, block2.relationships);
}

#[test]
fn feature_importance_field_preservation() {
    let fi_content = "\
- ### OntologyBlock
    - term-id:: AI-0303
    - preferred-term:: Feature Importance
    - ontology:: true

## Feature Importance
Content here...
";

    let parser = OntologyParser::new();
    let block = parser.parse_ontology_block(fi_content, None);

    assert_eq!(block.term_id.as_deref(), Some("AI-0303"));
    assert_eq!(block.preferred_term.as_deref(), Some("Feature Importance"));
    assert!(block.ontology);

    let written = write_ontology_block(&block);
    let block2 = parser.parse_ontology_block(&written, None);

    assert_eq!(block.term_id, block2.term_id);
    assert_eq!(block.preferred_term, block2.preferred_term);
    assert_eq!(block.ontology, block2.ontology);
}

#[test]
fn unknown_fields_preservation() {
    let content = "\
- ### OntologyBlock
  id:: test-ontology
  collapsed:: true

  - ontology:: true
  - term-id:: TEST-001
  - preferred-term:: Test Concept
  - custom-field:: Custom Value
  - another-unknown:: Another Value
  - last-updated:: 2025-11-17
";

    let parser = OntologyParser::new();
    let block = parser.parse_ontology_block(content, None);

    assert_eq!(block.id.as_deref(), Some("test-ontology"));
    assert_eq!(block.collapsed, Some(true));
    assert_eq!(block.term_id.as_deref(), Some("TEST-001"));
    assert_eq!(block.preferred_term.as_deref(), Some("Test Concept"));

    assert_eq!(
        block
            .additional_fields
            .get("custom-field")
            .map(String::as_str),
        Some("Custom Value")
    );
    assert_eq!(
        block
            .additional_fields
            .get("another-unknown")
            .map(String::as_str),
        Some("Another Value")
    );
    assert_eq!(
        block
            .additional_fields
            .get("last-updated")
            .map(String::as_str),
        Some("2025-11-17")
    );

    let written = write_ontology_block(&block);
    assert!(written.contains("custom-field:: Custom Value"));
    assert!(written.contains("another-unknown:: Another Value"));
    assert!(written.contains("last-updated:: 2025-11-17"));

    let block2 = parser.parse_ontology_block(&written, None);
    assert_eq!(block.additional_fields, block2.additional_fields);
}

#[test]
fn immutable_field_update() {
    let parser = OntologyParser::new();

    let original = OntologyBlock {
        term_id: Some("TEST-001".to_string()),
        preferred_term: Some("Original Term".to_string()),
        definition: Some("Original definition".to_string()),
        ..OntologyBlock::default()
    };

    let updated = parser
        .update_field(&original, "preferred_term", "Updated Term")
        .unwrap();

    assert_eq!(original.preferred_term.as_deref(), Some("Original Term"));
    assert_eq!(updated.preferred_term.as_deref(), Some("Updated Term"));
    assert_eq!(updated.term_id.as_deref(), Some("TEST-001"));
    assert_eq!(updated.definition.as_deref(), Some("Original definition"));
}

#[test]
fn merge_blocks_preserves_and_merges() {
    let parser = OntologyParser::new();

    let mut additional_fields = BTreeMap::new();
    additional_fields.insert("custom-field".to_string(), "Custom Value".to_string());

    let existing = OntologyBlock {
        term_id: Some("TEST-001".to_string()),
        preferred_term: Some("Original Term".to_string()),
        definition: Some("Original definition".to_string()),
        status: Some("draft".to_string()),
        additional_fields,
        ..OntologyBlock::default()
    };

    let mut updates = BTreeMap::new();
    updates.insert("preferred_term".to_string(), "Updated Term".to_string());
    updates.insert("maturity".to_string(), "emerging".to_string());
    updates.insert("new-unknown-field".to_string(), "New Value".to_string());

    let merged = parser.merge_blocks(&existing, &updates);

    assert_eq!(merged.preferred_term.as_deref(), Some("Updated Term"));
    assert_eq!(merged.maturity.as_deref(), Some("emerging"));
    assert_eq!(merged.term_id.as_deref(), Some("TEST-001"));
    assert_eq!(merged.definition.as_deref(), Some("Original definition"));
    assert_eq!(merged.status.as_deref(), Some("draft"));

    assert_eq!(
        merged
            .additional_fields
            .get("custom-field")
            .map(String::as_str),
        Some("Custom Value")
    );
    assert_eq!(
        merged
            .additional_fields
            .get("new-unknown-field")
            .map(String::as_str),
        Some("New Value")
    );

    assert_eq!(existing.preferred_term.as_deref(), Some("Original Term"));
    assert!(!existing.additional_fields.contains_key("new-unknown-field"));
}
