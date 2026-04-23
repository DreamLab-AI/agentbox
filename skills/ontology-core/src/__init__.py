"""
Ontology Core Library - Foundation for ontology manipulation with zero data loss.

This library provides:
- Complete OntologyBlock parsing and writing with ALL field preservation
- OWL2 validation with namespace consistency checks
- Safe modification operations with automatic rollback
- Immutable data patterns for reliable transformations

Usage:
    from ontology_core.ontology_parser import OntologyParser, OntologyBlock
    from ontology_core.owl2_validator import OWL2Validator
    from ontology_core.ontology_modifier import OntologyModifier
"""

__version__ = "1.0.0"
__all__ = [
    "OntologyBlock",
    "OntologyParser",
    "OWL2Validator",
    "OntologyModifier",
]
