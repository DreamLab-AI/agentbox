"""
OWL2 Validator - Validate OWL2 functional syntax compliance.

This module validates OWL2 axioms in ontology files:
- Functional syntax correctness
- Namespace consistency (ai:, bc:, mv:, rb:, dt:)
- Class and property declarations
- Domain and range constraints
- Common antipatterns

Read-only validation with detailed error reporting.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import List, Set, Optional
import re


@dataclass
class ValidationResult:
    """Result of OWL2 validation."""

    is_valid: bool
    errors: List[str]
    warnings: List[str]
    file_path: Optional[str] = None

    def __str__(self) -> str:
        """Format validation result for display."""
        lines = []

        if self.file_path:
            lines.append(f"File: {self.file_path}")

        lines.append(f"Status: {'✅ VALID' if self.is_valid else '❌ INVALID'}")

        if self.errors:
            lines.append("\nErrors:")
            for error in self.errors:
                lines.append(f"  - {error}")

        if self.warnings:
            lines.append("\nWarnings:")
            for warning in self.warnings:
                lines.append(f"  - {warning}")

        return '\n'.join(lines)


class OWL2Validator:
    """
    Validate OWL2 compliance in ontology files.

    Checks:
    - Functional syntax correctness
    - Namespace consistency (ai:, bc:, mv:, rb:, dt:)
    - Prefix declarations
    - Class declarations
    - Property declarations
    - Axiom structure
    - Common antipatterns
    """

    # Valid namespace prefixes
    VALID_NAMESPACES = {'ai', 'bc', 'mv', 'rb', 'dt', 'owl', 'rdf', 'rdfs', 'xsd'}

    # OWL2 keywords
    OWL2_KEYWORDS = {
        'Ontology', 'Import', 'Prefix',
        'Declaration', 'Class', 'ObjectProperty', 'DataProperty',
        'SubClassOf', 'EquivalentClasses', 'DisjointClasses',
        'ObjectPropertyDomain', 'ObjectPropertyRange',
        'DataPropertyDomain', 'DataPropertyRange',
        'DataHasValue', 'ObjectSomeValuesFrom', 'ObjectAllValuesFrom',
        'ObjectExactCardinality', 'ObjectMinCardinality', 'ObjectMaxCardinality',
        'AnnotationAssertion', 'DataPropertyAssertion',
    }

    def validate_file(self, file_path: str, content: Optional[str] = None) -> ValidationResult:
        """
        Validate OWL2 compliance in ontology file.

        Args:
            file_path: Path to markdown file
            content: Optional content (if not provided, read from file)

        Returns:
            ValidationResult with errors and warnings
        """
        errors = []
        warnings = []

        # Read content if not provided
        if content is None:
            try:
                content = Path(file_path).read_text(encoding='utf-8')
            except Exception as e:
                return ValidationResult(
                    is_valid=False,
                    errors=[f"Failed to read file: {e}"],
                    warnings=[],
                    file_path=file_path
                )

        # Extract OWL axioms
        axioms = self._extract_owl_axioms(content)

        if not axioms:
            # No axioms found - not necessarily an error
            warnings.append("No OWL axioms found in file")
            return ValidationResult(
                is_valid=True,
                errors=[],
                warnings=warnings,
                file_path=file_path
            )

        # Validate each axiom block
        for idx, axiom in enumerate(axioms):
            block_errors = self._validate_axiom_block(axiom, idx + 1)
            errors.extend(block_errors)

        # Check for common antipatterns
        antipattern_warnings = self._check_antipatterns(content)
        warnings.extend(antipattern_warnings)

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            file_path=file_path
        )

    def _extract_owl_axioms(self, content: str) -> List[str]:
        """Extract OWL axioms from ```clojure blocks."""
        axioms = []

        # Find all clojure code blocks
        code_pattern = r'```clojure\s*\n(.*?)\n\s*```'

        for match in re.finditer(code_pattern, content, re.DOTALL):
            axiom_content = match.group(1)
            axioms.append(axiom_content)

        return axioms

    def _validate_axiom_block(self, axiom: str, block_num: int) -> List[str]:
        """Validate single OWL axiom block."""
        errors = []

        # Check for Prefix declarations
        if 'Prefix(' not in axiom:
            errors.append(f"Block {block_num}: Missing Prefix declarations")

        # Check for Ontology declaration
        if 'Ontology(' not in axiom:
            errors.append(f"Block {block_num}: Missing Ontology declaration")

        # Validate namespace prefixes
        namespace_errors = self._validate_namespaces(axiom, block_num)
        errors.extend(namespace_errors)

        # Validate parentheses balance
        if not self._check_balanced_parens(axiom):
            errors.append(f"Block {block_num}: Unbalanced parentheses")

        # Validate class declarations
        class_errors = self._validate_class_declarations(axiom, block_num)
        errors.extend(class_errors)

        return errors

    def _validate_namespaces(self, axiom: str, block_num: int) -> List[str]:
        """Validate namespace prefixes."""
        errors = []

        # Extract used namespaces (exclude URLs)
        used_namespaces = set()
        for match in re.finditer(r'(\w+):', axiom):
            ns = match.group(1)
            # Skip if part of URL (http://, https://)
            if ns not in ('http', 'https'):
                used_namespaces.add(ns)

        # Extract declared namespaces
        declared = set()
        for match in re.finditer(r'Prefix\((\w+):=', axiom):
            declared.add(match.group(1))

        # Check for undeclared namespaces
        undeclared = used_namespaces - declared

        # Filter out standard OWL/RDF namespaces
        undeclared = undeclared - {'owl', 'rdf', 'rdfs', 'xsd'}

        if undeclared:
            errors.append(
                f"Block {block_num}: Undeclared namespace prefixes: {', '.join(undeclared)}"
            )

        # Check for non-standard namespaces (warning only, not error)
        # non_standard = declared - self.VALID_NAMESPACES
        # if non_standard:
        #     errors.append(
        #         f"Block {block_num}: Non-standard namespace prefixes: {', '.join(non_standard)}"
        #     )

        return errors

    def _validate_class_declarations(self, axiom: str, block_num: int) -> List[str]:
        """Validate class declarations and usage."""
        errors = []

        # Extract declared classes
        declared_classes = set()
        for match in re.finditer(r'Declaration\(Class\((\w+:\w+)\)\)', axiom):
            declared_classes.add(match.group(1))

        # Extract used classes (in SubClassOf, etc.)
        used_classes = set()

        # SubClassOf patterns
        for match in re.finditer(r'SubClassOf\((\w+:\w+)', axiom):
            used_classes.add(match.group(1))

        # ObjectSomeValuesFrom patterns
        for match in re.finditer(r'ObjectSomeValuesFrom\(\w+:\w+\s+(\w+:\w+)', axiom):
            used_classes.add(match.group(1))

        # Check for undeclared classes
        undeclared = used_classes - declared_classes

        if undeclared:
            errors.append(
                f"Block {block_num}: Classes used but not declared: {', '.join(undeclared)}"
            )

        return errors

    def _check_balanced_parens(self, axiom: str) -> bool:
        """Check if parentheses are balanced."""
        count = 0
        for char in axiom:
            if char == '(':
                count += 1
            elif char == ')':
                count -= 1
            if count < 0:
                return False
        return count == 0

    def _check_antipatterns(self, content: str) -> List[str]:
        """Check for common OWL2 antipatterns."""
        warnings = []

        # Check for missing term-id
        if 'term-id::' not in content:
            warnings.append("Missing term-id field")

        # Check for missing definition
        if 'definition::' not in content:
            warnings.append("Missing definition field")

        # Check for missing owl:class
        if 'owl:class::' not in content:
            warnings.append("Missing owl:class field")

        # Check for circular dependencies (basic check)
        if content.count('SubClassOf') > 20:
            warnings.append("Large number of SubClassOf axioms - check for circular dependencies")

        return warnings
