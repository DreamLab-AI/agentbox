//! `OntologyModifier` — safe modification operations with automatic
//! validation, backup, and rollback.
//!
//! Ported from `skills/ontology-core/src/ontology_modifier.py`. All
//! modifications are immutable: the original in-memory block is never
//! mutated, only replaced.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::block::FIELD_COUNT;
use crate::parser::{get_str_field, OntologyParser};
use crate::validator::OWL2Validator;

/// Result of a modification operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModificationResult {
    pub success: bool,
    pub changes_applied: BTreeMap<String, String>,
    pub fields_preserved: usize,
    pub validation_errors: Vec<String>,
    pub backup_path: Option<PathBuf>,
    pub error: Option<String>,
}

impl std::fmt::Display for ModificationResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(
            f,
            "Status: {}",
            if self.success {
                "\u{2705} SUCCESS"
            } else {
                "\u{274c} FAILED"
            }
        )?;
        if self.success {
            writeln!(f, "Changes Applied: {}", self.changes_applied.len())?;
            writeln!(f, "Fields Preserved: {}", self.fields_preserved)?;
            if !self.changes_applied.is_empty() {
                writeln!(f, "\nModified Fields:")?;
                for (field, value) in &self.changes_applied {
                    writeln!(f, "  - {field}: {value}")?;
                }
            }
            if let Some(backup) = &self.backup_path {
                writeln!(f, "\nBackup Created: {}", backup.display())?;
            }
        } else {
            writeln!(f, "Error: {}", self.error.as_deref().unwrap_or(""))?;
            if !self.validation_errors.is_empty() {
                writeln!(f, "\nValidation Errors:")?;
                for error in &self.validation_errors {
                    writeln!(f, "  - {error}")?;
                }
            }
        }
        Ok(())
    }
}

/// Safe modification operations with automatic validation.
pub struct OntologyModifier {
    validator: OWL2Validator,
    parser: OntologyParser,
}

impl Default for OntologyModifier {
    fn default() -> Self {
        Self::new()
    }
}

impl OntologyModifier {
    pub fn new() -> Self {
        Self {
            validator: OWL2Validator::new(),
            parser: OntologyParser::new(),
        }
    }

    /// Safely modify an ontology file with validation and backup.
    ///
    /// Process (matching the Python original exactly):
    /// 1. Read current file
    /// 2. Parse OntologyBlock (ALL fields preserved)
    /// 3. Pre-modification validation (if enabled)
    /// 4. Create backup (if enabled)
    /// 5. Apply updates (immutable merge)
    /// 6. Generate new OntologyBlock markdown
    /// 7. Replace OntologyBlock in full file content
    /// 8. Post-modification validation (if enabled)
    /// 9. Write to file, or roll back on failure
    /// 10. Return result
    pub fn modify_file(
        &self,
        file_path: &Path,
        updates: &BTreeMap<String, String>,
        validate: bool,
        backup: bool,
    ) -> ModificationResult {
        let mut backup_path: Option<PathBuf> = None;

        let result = self.modify_file_inner(file_path, updates, validate, backup, &mut backup_path);
        match result {
            Ok(r) => r,
            Err(e) => {
                if backup {
                    if let Some(bp) = &backup_path {
                        if bp.exists() {
                            let _ = Self::restore_backup(file_path, bp);
                        }
                    }
                }
                ModificationResult {
                    success: false,
                    changes_applied: updates.clone(),
                    fields_preserved: 0,
                    validation_errors: vec![],
                    backup_path,
                    error: Some(format!("Exception during modification: {e}")),
                }
            }
        }
    }

    fn modify_file_inner(
        &self,
        file_path: &Path,
        updates: &BTreeMap<String, String>,
        validate: bool,
        backup: bool,
        backup_path: &mut Option<PathBuf>,
    ) -> std::io::Result<ModificationResult> {
        if !file_path.exists() {
            return Ok(ModificationResult {
                success: false,
                changes_applied: BTreeMap::new(),
                fields_preserved: 0,
                validation_errors: vec![],
                backup_path: None,
                error: Some(format!("File not found: {}", file_path.display())),
            });
        }

        let original_content = fs::read_to_string(file_path)?;

        let block = self
            .parser
            .parse_ontology_block(&original_content, Some(file_path));

        if validate {
            let pre = self
                .validator
                .validate_file(&file_path.display().to_string(), Some(&original_content));
            if !pre.is_valid {
                return Ok(ModificationResult {
                    success: false,
                    changes_applied: BTreeMap::new(),
                    fields_preserved: 0,
                    validation_errors: pre.errors,
                    backup_path: None,
                    error: Some("Pre-validation failed".to_string()),
                });
            }
        }

        if backup {
            *backup_path = Some(Self::create_backup(file_path)?);
        }

        let updated_block = self.parser.merge_blocks(&block, updates);
        let new_block_markdown = crate::writer::write_ontology_block(&updated_block);
        let new_content = replace_ontology_block(&original_content, &new_block_markdown);

        if validate {
            let post = self
                .validator
                .validate_file(&file_path.display().to_string(), Some(&new_content));
            if !post.is_valid {
                if backup {
                    if let Some(bp) = backup_path {
                        Self::restore_backup(file_path, bp)?;
                    }
                }
                return Ok(ModificationResult {
                    success: false,
                    changes_applied: updates.clone(),
                    fields_preserved: FIELD_COUNT,
                    validation_errors: post.errors,
                    backup_path: backup_path.clone(),
                    error: Some("Post-validation failed (rollback performed)".to_string()),
                });
            }
        }

        fs::write(file_path, &new_content)?;

        Ok(ModificationResult {
            success: true,
            changes_applied: updates.clone(),
            fields_preserved: FIELD_COUNT,
            validation_errors: vec![],
            backup_path: backup_path.clone(),
            error: None,
        })
    }

    /// Validate that a modification preserved all required fields.
    ///
    /// Ported from `validate_modification`. `required_fields` are checked by
    /// (already snake_case) struct field name — see [`get_str_field`] for
    /// the supported set.
    pub fn validate_modification(
        &self,
        original: &str,
        modified: &str,
        required_fields: &[String],
    ) -> crate::validator::ValidationResult {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        let original_block = self.parser.parse_ontology_block(original, None);
        let modified_block = self.parser.parse_ontology_block(modified, None);

        for field in required_fields {
            let original_value = get_str_field(&original_block, field);
            let modified_value = get_str_field(&modified_block, field);

            let original_truthy = original_value.as_deref().is_some_and(|s| !s.is_empty());
            let modified_truthy = modified_value.as_deref().is_some_and(|s| !s.is_empty());

            if original_truthy && !modified_truthy {
                errors.push(format!("Field '{field}' was stripped"));
            } else if original_value != modified_value {
                warnings.push(format!("Field '{field}' value changed"));
            }
        }

        let lost_fields: Vec<&String> = original_block
            .additional_fields
            .keys()
            .filter(|k| !modified_block.additional_fields.contains_key(*k))
            .collect();
        if !lost_fields.is_empty() {
            errors.push(format!(
                "Lost additional fields: {}",
                lost_fields
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        let lost_rels: Vec<&String> = original_block
            .relationships
            .keys()
            .filter(|k| !modified_block.relationships.contains_key(*k))
            .collect();
        if !lost_rels.is_empty() {
            warnings.push(format!(
                "Lost relationships: {}",
                lost_rels
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        crate::validator::ValidationResult {
            is_valid: errors.is_empty(),
            errors,
            warnings,
            file_path: None,
        }
    }

    /// Create a timestamped backup under `<file's dir>/.backups/`.
    fn create_backup(file_path: &Path) -> std::io::Result<PathBuf> {
        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_dir = file_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(".backups");
        fs::create_dir_all(&backup_dir)?;

        let stem = file_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let backup_path = backup_dir.join(format!("{stem}_{timestamp}.md"));
        fs::copy(file_path, &backup_path)?;

        Ok(backup_path)
    }

    /// Restore `file_path` from `backup_path`.
    fn restore_backup(file_path: &Path, backup_path: &Path) -> std::io::Result<()> {
        if backup_path.exists() {
            fs::copy(backup_path, file_path)?;
        }
        Ok(())
    }
}

/// `(-\s*###\s*OntologyBlock.*?)(?=\n-\s*##|\Z)` replaced with `new_block`,
/// with the same "insert if absent" fallback as the Python original.
///
/// Ported from `_replace_ontology_block`; see [`crate::markdown`] for why
/// this is hand-rolled rather than a single lookahead regex. Exposed at
/// crate visibility so [`crate::enrichment`] can reuse it without going
/// through a full [`OntologyModifier::modify_file`] round trip.
pub(crate) fn replace_ontology_block(full_content: &str, new_block: &str) -> String {
    static START_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"-\s*###\s*OntologyBlock").unwrap());
    static TERM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n-\s*##").unwrap());

    let mut result = String::new();
    let mut pos = 0usize;
    let mut replaced_any = false;

    while let Some(start_m) = START_RE.find(&full_content[pos..]) {
        let abs_start = pos + start_m.start();
        result.push_str(&full_content[pos..abs_start]);

        let rest = &full_content[abs_start..];
        let block_len = match TERM_RE.find(rest) {
            Some(term_m) => term_m.start(),
            None => rest.len(),
        };

        result.push_str(new_block);
        replaced_any = true;
        pos = abs_start + block_len;
    }
    result.push_str(&full_content[pos..]);

    if !replaced_any && !result.contains("### OntologyBlock") {
        let mut parts = full_content.splitn(2, '\n');
        let first = parts.next().unwrap_or("");
        match parts.next() {
            Some(rest) => format!("{first}\n\n{new_block}\n\n{rest}"),
            None => format!("{new_block}\n\n{full_content}"),
        }
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Each test gets its own isolated temp directory (rather than sharing
    /// the process-wide OS temp dir) so that `.backups/` subdirectories
    /// created by `create_backup` — and any cleanup of them — never race
    /// against other tests running in parallel.
    fn write_temp(content: &str) -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.md");
        fs::write(&path, content).unwrap();
        (dir, path)
    }

    #[test]
    fn successful_modification_preserves_untouched_fields() {
        let content = "- ### OntologyBlock\n  id:: test-ontology\n  collapsed:: true\n\n  - **Identification**\n    - ontology:: true\n    - term-id:: TEST-001\n    - preferred-term:: Original Term\n    - source-domain:: ai\n    - status:: draft\n\n  - **Definition**\n    - definition:: Original definition\n    - maturity:: emerging\n\n- ## Content\nTest content here...\n";
        let (_dir, path) = write_temp(content);

        let modifier = OntologyModifier::new();
        let mut updates = BTreeMap::new();
        updates.insert("preferred_term".to_string(), "Updated Term".to_string());
        updates.insert("maturity".to_string(), "mature".to_string());
        updates.insert("status".to_string(), "complete".to_string());

        let result = modifier.modify_file(&path, &updates, false, true);

        assert!(result.success, "modification failed: {:?}", result.error);
        assert_eq!(result.changes_applied.len(), 3);
        let backup_path = result.backup_path.expect("backup path");
        assert!(backup_path.exists());

        let modified = fs::read_to_string(&path).unwrap();
        assert!(modified.contains("Updated Term"));
        assert!(modified.contains("mature"));
        assert!(modified.contains("complete"));
        assert!(modified.contains("TEST-001"));
        assert!(modified.contains("ai"));
    }

    #[test]
    fn backup_contains_original_content() {
        let original = "- ### OntologyBlock\n  id:: test-ontology\n  collapsed:: true\n\n  - **Identification**\n    - ontology:: true\n    - term-id:: TEST-001\n    - preferred-term:: Original Term\n\n- ## Content\nTest content...\n";
        let (_dir, path) = write_temp(original);

        let modifier = OntologyModifier::new();
        let mut updates = BTreeMap::new();
        updates.insert("preferred_term".to_string(), "Updated Term".to_string());

        let result = modifier.modify_file(&path, &updates, false, true);
        let backup_path = result.backup_path.expect("backup path");
        assert!(backup_path.exists());
        let backup_content = fs::read_to_string(&backup_path).unwrap();
        assert!(backup_content.contains("Original Term"));
    }

    #[test]
    fn field_preservation_across_single_field_update() {
        let original = "- ### OntologyBlock\n  id:: test-ontology\n  collapsed:: true\n\n  - **Identification**\n    - ontology:: true\n    - term-id:: TEST-001\n    - preferred-term:: Original Term\n    - source-domain:: ai\n    - status:: draft\n    - public-access:: true\n    - version:: 1.0.0\n    - quality-score:: 0.85\n\n  - **Definition**\n    - definition:: Original definition\n    - maturity:: emerging\n    - authority-score:: 0.75\n\n  - **Semantic Classification**\n    - owl:class:: ai:Concept\n    - owl:physicality:: ConceptualEntity\n    - owl:role:: Concept\n    - belongsToDomain:: [[AIDomain]]\n\n- ## Content\nTest content...\n";
        let (_dir, path) = write_temp(original);

        let modifier = OntologyModifier::new();
        let mut updates = BTreeMap::new();
        updates.insert("status".to_string(), "complete".to_string());

        let result = modifier.modify_file(&path, &updates, false, true);
        assert!(result.success);

        let modified = fs::read_to_string(&path).unwrap();
        for needle in [
            "TEST-001",
            "Original Term",
            "public-access:: true",
            "version:: 1.0.0",
            "quality-score:: 0.85",
            "Original definition",
            "emerging",
            "authority-score:: 0.75",
            "owl:class:: ai:Concept",
            "owl:physicality:: ConceptualEntity",
            "owl:role:: Concept",
            "belongsToDomain:: [[AIDomain]]",
        ] {
            assert!(
                modified.contains(needle),
                "missing {needle:?} in:\n{modified}"
            );
        }
    }
}
