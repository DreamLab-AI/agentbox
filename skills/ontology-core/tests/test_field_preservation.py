"""
Test field preservation with real ontology files.

This test suite verifies:
- ALL 17+ fields are extracted and preserved
- Unknown fields are preserved via additional_fields
- Round-trip identity: parse(write(parse(x))) == parse(x)
- Real production files (Bitcoin.md, Feature Importance.md) work correctly
"""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from ontology_parser import OntologyParser, OntologyBlock


def test_bitcoin_field_preservation():
    """Test complete field preservation with Bitcoin.md."""

    # Bitcoin.md content (from real file)
    bitcoin_content = """- ### OntologyBlock
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
"""

    parser = OntologyParser()

    # Parse
    block = parser.parse_ontology_block(bitcoin_content)

    # Verify ALL fields extracted
    assert block.id == "bitcoin-ontology"
    assert block.collapsed == True
    assert block.ontology == True
    assert block.term_id == "BC-0500"
    assert block.preferred_term == "Bitcoin"
    assert block.source_domain == "blockchain"
    assert block.status == "complete"
    assert block.public_access == True
    assert block.version == "1.0.0"
    assert block.quality_score == 0.96
    assert block.definition is not None
    assert "decentralised" in block.definition
    assert block.maturity == "mature"
    assert block.authority_score == 1.0
    assert block.owl_class == "bc:Bitcoin"
    assert block.owl_physicality == "VirtualEntity"
    assert block.owl_role == "Object"
    assert block.belongs_to_domain == "[[BlockchainDomain]]"

    # Verify relationships
    assert "is-subclass-of" in block.relationships
    assert "Cryptocurrency" in block.relationships["is-subclass-of"]
    assert "has-part" in block.relationships
    assert "Block" in block.relationships["has-part"]

    # Write back
    written = parser.write_ontology_block(block)

    # Parse again (round-trip)
    block2 = parser.parse_ontology_block(written)

    # Verify round-trip identity
    assert block.id == block2.id
    assert block.collapsed == block2.collapsed
    assert block.ontology == block2.ontology
    assert block.term_id == block2.term_id
    assert block.preferred_term == block2.preferred_term
    assert block.source_domain == block2.source_domain
    assert block.status == block2.status
    assert block.public_access == block2.public_access
    assert block.version == block2.version
    assert block.quality_score == block2.quality_score
    assert block.definition == block2.definition
    assert block.maturity == block2.maturity
    assert block.authority_score == block2.authority_score
    assert block.owl_class == block2.owl_class
    assert block.owl_physicality == block2.owl_physicality
    assert block.owl_role == block2.owl_role
    assert block.belongs_to_domain == block2.belongs_to_domain
    assert block.relationships == block2.relationships

    print("✅ Bitcoin.md field preservation test PASSED")


def test_feature_importance_field_preservation():
    """Test field preservation with Feature Importance.md."""

    # Feature Importance.md content (from real file)
    fi_content = """- ### OntologyBlock
    - term-id:: AI-0303
    - preferred-term:: Feature Importance
    - ontology:: true

## Feature Importance
Content here...
"""

    parser = OntologyParser()

    # Parse
    block = parser.parse_ontology_block(fi_content)

    # Verify fields extracted
    assert block.term_id == "AI-0303"
    assert block.preferred_term == "Feature Importance"
    assert block.ontology == True

    # Write back
    written = parser.write_ontology_block(block)

    # Parse again
    block2 = parser.parse_ontology_block(written)

    # Verify round-trip
    assert block.term_id == block2.term_id
    assert block.preferred_term == block2.preferred_term
    assert block.ontology == block2.ontology

    print("✅ Feature Importance.md field preservation test PASSED")


def test_unknown_fields_preservation():
    """Test that unknown fields are preserved via additional_fields."""

    content = """- ### OntologyBlock
  id:: test-ontology
  collapsed:: true

  - ontology:: true
  - term-id:: TEST-001
  - preferred-term:: Test Concept
  - custom-field:: Custom Value
  - another-unknown:: Another Value
  - last-updated:: 2025-11-17
"""

    parser = OntologyParser()

    # Parse
    block = parser.parse_ontology_block(content)

    # Verify known fields
    assert block.id == "test-ontology"
    assert block.collapsed == True
    assert block.term_id == "TEST-001"
    assert block.preferred_term == "Test Concept"

    # Verify unknown fields in additional_fields
    assert "custom-field" in block.additional_fields
    assert block.additional_fields["custom-field"] == "Custom Value"
    assert "another-unknown" in block.additional_fields
    assert block.additional_fields["another-unknown"] == "Another Value"
    assert "last-updated" in block.additional_fields
    assert block.additional_fields["last-updated"] == "2025-11-17"

    # Write back
    written = parser.write_ontology_block(block)

    # Verify unknown fields present in output
    assert "custom-field:: Custom Value" in written
    assert "another-unknown:: Another Value" in written
    assert "last-updated:: 2025-11-17" in written

    # Parse again
    block2 = parser.parse_ontology_block(written)

    # Verify round-trip for unknown fields
    assert block.additional_fields == block2.additional_fields

    print("✅ Unknown fields preservation test PASSED")


def test_immutable_modification():
    """Test immutable modification pattern."""

    parser = OntologyParser()

    # Create initial block
    original = OntologyBlock(
        term_id="TEST-001",
        preferred_term="Original Term",
        definition="Original definition"
    )

    # Immutable update
    updated = parser.update_field(original, "preferred_term", "Updated Term")

    # Verify original unchanged
    assert original.preferred_term == "Original Term"

    # Verify updated has new value
    assert updated.preferred_term == "Updated Term"

    # Verify other fields preserved
    assert updated.term_id == "TEST-001"
    assert updated.definition == "Original definition"

    print("✅ Immutable modification test PASSED")


def test_merge_blocks():
    """Test safe block merging."""

    parser = OntologyParser()

    # Create existing block
    existing = OntologyBlock(
        term_id="TEST-001",
        preferred_term="Original Term",
        definition="Original definition",
        status="draft",
        additional_fields={"custom-field": "Custom Value"}
    )

    # Merge updates
    updates = {
        "preferred_term": "Updated Term",
        "maturity": "emerging",
        "new-unknown-field": "New Value"
    }

    merged = parser.merge_blocks(existing, updates)

    # Verify known field updated
    assert merged.preferred_term == "Updated Term"
    assert merged.maturity == "emerging"

    # Verify existing fields preserved
    assert merged.term_id == "TEST-001"
    assert merged.definition == "Original definition"
    assert merged.status == "draft"

    # Verify unknown fields merged
    assert "custom-field" in merged.additional_fields
    assert merged.additional_fields["custom-field"] == "Custom Value"
    assert "new-unknown-field" in merged.additional_fields
    assert merged.additional_fields["new-unknown-field"] == "New Value"

    # Verify original unchanged
    assert existing.preferred_term == "Original Term"
    assert "new-unknown-field" not in existing.additional_fields

    print("✅ Merge blocks test PASSED")


if __name__ == "__main__":
    test_bitcoin_field_preservation()
    test_feature_importance_field_preservation()
    test_unknown_fields_preservation()
    test_immutable_modification()
    test_merge_blocks()

    print("\n" + "=" * 50)
    print("ALL FIELD PRESERVATION TESTS PASSED ✅")
    print("=" * 50)
