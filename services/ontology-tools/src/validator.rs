//! `OWL2Validator` — regex/structural validation of OWL2 functional-syntax
//! axioms embedded in ```clojure fences within vault OntologyBlock markdown.
//!
//! This is NOT a general OWL2/DL reasoner — it checks functional-syntax
//! shape, namespace consistency, and a handful of common antipatterns, the
//! same way the Python original does.
//!
//! Ported from `skills/ontology-core/src/owl2_validator.py`.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::markdown::extract_owl_axioms;

/// Result of OWL2 validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub file_path: Option<String>,
}

impl std::fmt::Display for ValidationResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(path) = &self.file_path {
            writeln!(f, "File: {path}")?;
        }
        writeln!(
            f,
            "Status: {}",
            if self.is_valid {
                "\u{2705} VALID"
            } else {
                "\u{274c} INVALID"
            }
        )?;
        if !self.errors.is_empty() {
            writeln!(f, "\nErrors:")?;
            for error in &self.errors {
                writeln!(f, "  - {error}")?;
            }
        }
        if !self.warnings.is_empty() {
            writeln!(f, "\nWarnings:")?;
            for warning in &self.warnings {
                writeln!(f, "  - {warning}")?;
            }
        }
        Ok(())
    }
}

/// Valid namespace prefixes (documented as in the Python original; not
/// currently enforced beyond the standard-namespace exclusion in
/// [`validate_namespaces`] — the Python original leaves the non-standard
/// check commented out too).
pub const VALID_NAMESPACES: &[&str] = &["ai", "bc", "mv", "rb", "dt", "owl", "rdf", "rdfs", "xsd"];

static NAMESPACE_USE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\w+):").unwrap());
static NAMESPACE_DECL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Prefix\((\w+):=").unwrap());
static DECLARED_CLASS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Declaration\(Class\((\w+:\w+)\)\)").unwrap());
static SUBCLASS_OF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"SubClassOf\((\w+:\w+)").unwrap());
static SOME_VALUES_FROM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"ObjectSomeValuesFrom\(\w+:\w+\s+(\w+:\w+)").unwrap());

/// Validate OWL2 compliance in ontology files.
#[derive(Debug, Default, Clone, Copy)]
pub struct OWL2Validator;

impl OWL2Validator {
    pub fn new() -> Self {
        Self
    }

    /// Validate OWL2 compliance in an ontology file.
    ///
    /// If `content` is `None`, the file at `file_path` is read. `file_path`
    /// need not exist as an actual filesystem path when `content` is
    /// supplied — it is only used for the report label, matching the Python
    /// original.
    pub fn validate_file(&self, file_path: &str, content: Option<&str>) -> ValidationResult {
        let owned_content;
        let content: &str = match content {
            Some(c) => c,
            None => match fs::read_to_string(file_path) {
                Ok(c) => {
                    owned_content = c;
                    &owned_content
                }
                Err(e) => {
                    return ValidationResult {
                        is_valid: false,
                        errors: vec![format!("Failed to read file: {e}")],
                        warnings: vec![],
                        file_path: Some(file_path.to_string()),
                    };
                }
            },
        };

        let axioms = extract_owl_axioms(content);

        if axioms.is_empty() {
            return ValidationResult {
                is_valid: true,
                errors: vec![],
                warnings: vec!["No OWL axioms found in file".to_string()],
                file_path: Some(file_path.to_string()),
            };
        }

        let mut errors = Vec::new();
        for (idx, axiom) in axioms.iter().enumerate() {
            errors.extend(Self::validate_axiom_block(axiom, idx + 1));
        }

        let warnings = Self::check_antipatterns(content);

        ValidationResult {
            is_valid: errors.is_empty(),
            errors,
            warnings,
            file_path: Some(file_path.to_string()),
        }
    }

    fn validate_axiom_block(axiom: &str, block_num: usize) -> Vec<String> {
        let mut errors = Vec::new();

        if !axiom.contains("Prefix(") {
            errors.push(format!("Block {block_num}: Missing Prefix declarations"));
        }
        if !axiom.contains("Ontology(") {
            errors.push(format!("Block {block_num}: Missing Ontology declaration"));
        }

        errors.extend(Self::validate_namespaces(axiom, block_num));

        if !Self::check_balanced_parens(axiom) {
            errors.push(format!("Block {block_num}: Unbalanced parentheses"));
        }

        errors.extend(Self::validate_class_declarations(axiom, block_num));

        errors
    }

    fn validate_namespaces(axiom: &str, block_num: usize) -> Vec<String> {
        let mut used: BTreeSet<String> = NAMESPACE_USE_RE
            .captures_iter(axiom)
            .map(|c| c[1].to_string())
            .filter(|ns| ns != "http" && ns != "https")
            .collect();

        let declared: BTreeSet<String> = NAMESPACE_DECL_RE
            .captures_iter(axiom)
            .map(|c| c[1].to_string())
            .collect();

        for ns in &declared {
            used.remove(ns);
        }
        for standard in ["owl", "rdf", "rdfs", "xsd"] {
            used.remove(standard);
        }

        if used.is_empty() {
            Vec::new()
        } else {
            vec![format!(
                "Block {block_num}: Undeclared namespace prefixes: {}",
                used.into_iter().collect::<Vec<_>>().join(", ")
            )]
        }
    }

    fn validate_class_declarations(axiom: &str, block_num: usize) -> Vec<String> {
        let declared: BTreeSet<String> = DECLARED_CLASS_RE
            .captures_iter(axiom)
            .map(|c| c[1].to_string())
            .collect();

        let mut used: BTreeSet<String> = SUBCLASS_OF_RE
            .captures_iter(axiom)
            .map(|c| c[1].to_string())
            .collect();
        used.extend(
            SOME_VALUES_FROM_RE
                .captures_iter(axiom)
                .map(|c| c[1].to_string()),
        );

        let undeclared: Vec<String> = used.difference(&declared).cloned().collect();

        if undeclared.is_empty() {
            Vec::new()
        } else {
            vec![format!(
                "Block {block_num}: Classes used but not declared: {}",
                undeclared.join(", ")
            )]
        }
    }

    fn check_balanced_parens(axiom: &str) -> bool {
        let mut count = 0i64;
        for ch in axiom.chars() {
            match ch {
                '(' => count += 1,
                ')' => {
                    count -= 1;
                    if count < 0 {
                        return false;
                    }
                }
                _ => {}
            }
        }
        count == 0
    }

    fn check_antipatterns(content: &str) -> Vec<String> {
        let mut warnings = Vec::new();

        if !content.contains("term-id::") {
            warnings.push("Missing term-id field".to_string());
        }
        if !content.contains("definition::") {
            warnings.push("Missing definition field".to_string());
        }
        if !content.contains("owl:class::") {
            warnings.push("Missing owl:class field".to_string());
        }
        if content.matches("SubClassOf").count() > 20 {
            warnings.push(
                "Large number of SubClassOf axioms - check for circular dependencies".to_string(),
            );
        }

        warnings
    }
}

/// Convenience wrapper for the CLI: read `path` from disk and validate it.
pub fn validate_path(path: &Path) -> ValidationResult {
    OWL2Validator::new().validate_file(&path.display().to_string(), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_owl2_axioms_pass() {
        let content = "- ### OntologyBlock\n  - term-id:: BC-0500\n  - preferred-term:: Bitcoin\n  - definition:: Cryptocurrency\n  - owl:class:: bc:Bitcoin\n\n  - #### OWL Axioms\n    - ```clojure\n      Prefix(:=<http://purl.org/blockchain-ontology#>)\n      Prefix(bc:=<http://purl.org/blockchain-ontology#>)\n      Prefix(owl:=<http://www.w3.org/2002/07/owl#>)\n\n      Ontology(<http://purl.org/blockchain-ontology/BC-0500>\n        Declaration(Class(bc:Bitcoin))\n        SubClassOf(bc:Bitcoin bc:Cryptocurrency)\n      )\n      ```\n";
        let result = OWL2Validator::new().validate_file("test.md", Some(content));
        assert!(
            result.is_valid,
            "expected valid, got errors: {:?}",
            result.errors
        );
    }

    #[test]
    fn missing_prefix_declarations_detected() {
        let content = "- ### OntologyBlock\n  - #### OWL Axioms\n    - ```clojure\n      Ontology(<http://purl.org/blockchain-ontology/BC-0500>\n        Declaration(Class(bc:Bitcoin))\n      )\n      ```\n";
        let result = OWL2Validator::new().validate_file("test.md", Some(content));
        assert!(!result.is_valid);
        assert!(result.errors.iter().any(|e| e.contains("Missing Prefix")));
    }

    #[test]
    fn unbalanced_parentheses_detected() {
        let content = "- ### OntologyBlock\n  - #### OWL Axioms\n    - ```clojure\n      Prefix(bc:=<http://purl.org/blockchain-ontology#>)\n\n      Ontology(<http://purl.org/blockchain-ontology/BC-0500>\n        Declaration(Class(bc:Bitcoin)\n      )\n      ```\n";
        let result = OWL2Validator::new().validate_file("test.md", Some(content));
        assert!(!result.is_valid);
        assert!(result
            .errors
            .iter()
            .any(|e| e.contains("Unbalanced parentheses")));
    }

    #[test]
    fn undeclared_namespace_detected() {
        let content = "- ### OntologyBlock\n  - #### OWL Axioms\n    - ```clojure\n      Prefix(bc:=<http://purl.org/blockchain-ontology#>)\n      Prefix(owl:=<http://www.w3.org/2002/07/owl#>)\n\n      Ontology(<http://purl.org/blockchain-ontology/BC-0500>\n        Declaration(Class(bc:Bitcoin))\n        SubClassOf(bc:Bitcoin ai:Concept)\n      )\n      ```\n";
        let result = OWL2Validator::new().validate_file("test.md", Some(content));
        assert!(!result.is_valid);
        assert!(result
            .errors
            .iter()
            .any(|e| e.contains("Undeclared namespace")));
    }

    #[test]
    fn no_axioms_is_valid_with_warning() {
        let content = "- ### OntologyBlock\n  - term-id:: AI-0303\n  - preferred-term:: Feature Importance\n  - ontology:: true\n";
        let result = OWL2Validator::new().validate_file("test.md", Some(content));
        assert!(result.is_valid);
        assert!(result.warnings.iter().any(|w| w.contains("No OWL axioms")));
    }
}
