"""
Test OWL2 validation functionality.

Tests:
- Valid OWL2 axioms pass validation
- Invalid syntax detected
- Namespace consistency checks
- Missing declarations detected
"""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from owl2_validator import OWL2Validator


def test_valid_owl2_axioms():
    """Test that valid OWL2 axioms pass validation."""

    content = """- ### OntologyBlock
  - term-id:: BC-0500
  - preferred-term:: Bitcoin
  - definition:: Cryptocurrency
  - owl:class:: bc:Bitcoin

  - #### OWL Axioms
    - ```clojure
      Prefix(:=<http://purl.org/blockchain-ontology#>)
      Prefix(bc:=<http://purl.org/blockchain-ontology#>)
      Prefix(owl:=<http://www.w3.org/2002/07/owl#>)

      Ontology(<http://purl.org/blockchain-ontology/BC-0500>
        Declaration(Class(bc:Bitcoin))
        SubClassOf(bc:Bitcoin bc:Cryptocurrency)
      )
      ```
"""

    validator = OWL2Validator()
    result = validator.validate_file("test.md", content)

    assert result.is_valid, f"Expected valid, got errors: {result.errors}"
    print("✅ Valid OWL2 axioms test PASSED")


def test_missing_prefix_declarations():
    """Test detection of missing prefix declarations."""

    content = """- ### OntologyBlock
  - #### OWL Axioms
    - ```clojure
      Ontology(<http://purl.org/blockchain-ontology/BC-0500>
        Declaration(Class(bc:Bitcoin))
      )
      ```
"""

    validator = OWL2Validator()
    result = validator.validate_file("test.md", content)

    assert not result.is_valid
    assert any("Missing Prefix" in error for error in result.errors)
    print("✅ Missing prefix declarations test PASSED")


def test_unbalanced_parentheses():
    """Test detection of unbalanced parentheses."""

    content = """- ### OntologyBlock
  - #### OWL Axioms
    - ```clojure
      Prefix(bc:=<http://purl.org/blockchain-ontology#>)

      Ontology(<http://purl.org/blockchain-ontology/BC-0500>
        Declaration(Class(bc:Bitcoin)
      )
      ```
"""

    validator = OWL2Validator()
    result = validator.validate_file("test.md", content)

    assert not result.is_valid
    assert any("Unbalanced parentheses" in error for error in result.errors)
    print("✅ Unbalanced parentheses test PASSED")


def test_undeclared_namespace():
    """Test detection of undeclared namespace prefixes."""

    content = """- ### OntologyBlock
  - #### OWL Axioms
    - ```clojure
      Prefix(bc:=<http://purl.org/blockchain-ontology#>)
      Prefix(owl:=<http://www.w3.org/2002/07/owl#>)

      Ontology(<http://purl.org/blockchain-ontology/BC-0500>
        Declaration(Class(bc:Bitcoin))
        SubClassOf(bc:Bitcoin ai:Concept)
      )
      ```
"""

    validator = OWL2Validator()
    result = validator.validate_file("test.md", content)

    assert not result.is_valid
    assert any("Undeclared namespace" in error for error in result.errors)
    print("✅ Undeclared namespace test PASSED")


def test_no_axioms():
    """Test handling of files without OWL axioms."""

    content = """- ### OntologyBlock
  - term-id:: AI-0303
  - preferred-term:: Feature Importance
  - ontology:: true
"""

    validator = OWL2Validator()
    result = validator.validate_file("test.md", content)

    # Should be valid but with warning
    assert result.is_valid
    assert any("No OWL axioms" in warning for warning in result.warnings)
    print("✅ No axioms test PASSED")


if __name__ == "__main__":
    test_valid_owl2_axioms()
    test_missing_prefix_declarations()
    test_unbalanced_parentheses()
    test_undeclared_namespace()
    test_no_axioms()

    print("\n" + "=" * 50)
    print("ALL OWL2 VALIDATION TESTS PASSED ✅")
    print("=" * 50)
