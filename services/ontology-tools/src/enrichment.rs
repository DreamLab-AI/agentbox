//! `EnrichmentWorkflow` — orchestration with OWL2 validation and rollback.
//!
//! Ported from `skills/ontology-enrich/src/enrichment_workflow.py`.
//!
//! ## A note on fidelity
//!
//! The Python original imports from module paths that do not exist
//! (`ontology_core.src.ontology_parser.parse_ontology_block`,
//! `.ontology_modifier.modify_field`, `.owl2_validator.validate_ontology`
//! — none of these free functions are defined anywhere in `ontology-core`,
//! which exposes only the class-based `OntologyParser` /
//! `OntologyModifier` / `OWL2Validator` API) and reads a non-existent
//! `ontology.title` attribute (`OntologyBlock` has `preferred_term`, not
//! `title`). Neither is exercised by `ontology-core`'s or
//! `ontology-enrich`'s own test suite, and both would raise at first call —
//! this module was dead code. This port preserves the documented *intent*
//! (parse -> pre-validate -> query Perplexity -> immutably update the field
//! -> re-validate -> write back, with automatic `git checkout` rollback on
//! any failure) using the real, working `ontology-core` APIs, and uses
//! `preferred_term` wherever the Python used `ontology.title`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::link_validator::{LinkReport, LinkValidator};
use crate::modifier::replace_ontology_block;
use crate::parser::{get_str_field, OntologyParser};
use crate::perplexity::{Citation, PerplexityClient};
use crate::validator::{OWL2Validator, ValidationResult};
use crate::writer::write_ontology_block;

/// Result of an enrichment operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnrichmentResult {
    pub success: bool,
    pub file_path: String,
    pub field_modified: String,
    pub original_content: String,
    pub enriched_content: String,
    pub citations: Vec<Citation>,
    pub validation_errors: Vec<String>,
    pub rollback_performed: bool,
}

/// Configuration for the enrichment workflow.
///
/// Defaults match the Python original's `EnrichmentConfig` dataclass
/// defaults; [`EnrichmentConfig::from_env`] reads the canonical
/// `ONTOLOGY_ENRICH_*` environment variables (see repo-root `.env.example`).
#[derive(Debug, Clone)]
pub struct EnrichmentConfig {
    pub uk_english: bool,
    pub strict_owl2: bool,
    pub require_citations: bool,
    pub min_definition_length: usize,
    pub auto_rollback: bool,
    pub preserve_all_fields: bool,
    pub rate_limit_per_minute: u32,
}

impl Default for EnrichmentConfig {
    fn default() -> Self {
        Self {
            uk_english: true,
            strict_owl2: true,
            require_citations: true,
            min_definition_length: 50,
            auto_rollback: true,
            preserve_all_fields: true,
            rate_limit_per_minute: 10,
        }
    }
}

impl EnrichmentConfig {
    /// Build a config from the canonical `ONTOLOGY_ENRICH_*` environment
    /// variables, falling back to the same defaults as the Python original
    /// for anything unset or unparsable.
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            uk_english: env_bool("ONTOLOGY_ENRICH_UK_ENGLISH", defaults.uk_english),
            auto_rollback: env_bool("ONTOLOGY_ENRICH_AUTO_ROLLBACK", defaults.auto_rollback),
            rate_limit_per_minute: std::env::var("ONTOLOGY_ENRICH_RATE_LIMIT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(defaults.rate_limit_per_minute),
            ..defaults
        }
    }
}

fn env_bool(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(v) => crate::parser::parse_bool(Some(&v)).unwrap_or(default),
        Err(_) => default,
    }
}

/// Main orchestration class for ontology enrichment operations.
///
/// Delegates all parsing/modification to `ontology-core`'s real API.
/// Ensures OWL2 validation and automatic `git checkout HEAD` rollback on
/// failures.
pub struct EnrichmentWorkflow {
    perplexity: PerplexityClient,
    link_validator: LinkValidator,
    parser: OntologyParser,
    validator: OWL2Validator,
    config: EnrichmentConfig,
}

impl EnrichmentWorkflow {
    pub fn new(api_key: impl Into<String>, config: EnrichmentConfig) -> Self {
        Self {
            perplexity: PerplexityClient::new(api_key),
            link_validator: LinkValidator::default(),
            parser: OntologyParser::new(),
            validator: OWL2Validator::new(),
            config,
        }
    }

    /// Validate OWL2 compliance without modification.
    pub fn validate_file(&self, file_path: &Path) -> ValidationResult {
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => {
                return ValidationResult {
                    is_valid: false,
                    errors: vec![format!("Validation exception: {e}")],
                    warnings: vec![],
                    file_path: Some(file_path.display().to_string()),
                };
            }
        };
        self.validator
            .validate_file(&file_path.display().to_string(), Some(&content))
    }

    /// Enrich a specific field with Perplexity API content.
    ///
    /// Process:
    /// 1. Parse with full field preservation
    /// 2. Validate OWL2 compliance
    /// 3. Query Perplexity API with UK English context
    /// 4. Extract citations and structured content
    /// 5. Immutably update the field
    /// 6. Re-validate the written-out block
    /// 7. Write back, or roll back to `git HEAD` on any failure
    pub async fn enrich_field(
        &self,
        file_path: &Path,
        field_name: &str,
        context: Option<&str>,
    ) -> EnrichmentResult {
        let mut result = EnrichmentResult {
            file_path: file_path.display().to_string(),
            field_modified: field_name.to_string(),
            ..EnrichmentResult::default()
        };

        // Step 1: parse with FULL field preservation.
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => return self.fail(result, format!("Exception during enrichment: {e}")),
        };
        let block = self.parser.parse_ontology_block(&content, Some(file_path));

        let current_content = get_str_field(&block, field_name).unwrap_or_default();
        result.original_content = current_content.clone();
        if current_content.is_empty() {
            return self.fail(
                result,
                format!("Field '{field_name}' is empty or does not exist"),
            );
        }

        // Step 2: validate OWL2 compliance BEFORE modification.
        let validation = self
            .validator
            .validate_file(&file_path.display().to_string(), Some(&content));
        if !validation.is_valid {
            result.validation_errors = validation.errors.clone();
            return self.fail(
                result,
                format!("OWL2 validation failed: {:?}", validation.errors),
            );
        }

        // Step 3: query Perplexity with UK English context. `context`
        // defaults to `preferred_term` (see module docs on the Python
        // original's non-existent `.title` attribute).
        let context_str = context
            .map(str::to_string)
            .or_else(|| block.preferred_term.clone())
            .unwrap_or_default();

        let enriched = match self
            .perplexity
            .enrich_definition(&current_content, &context_str, self.config.uk_english)
            .await
        {
            Ok(e) => e,
            Err(e) => return self.fail(result, e.to_string()),
        };
        result.enriched_content = enriched.definition.clone();
        result.citations = enriched.citations.clone();

        if self.config.require_citations && enriched.citations.is_empty() {
            return self.fail(
                result,
                "No citations in enriched content (required by config)".into(),
            );
        }
        if enriched.definition.len() < self.config.min_definition_length {
            return self.fail(
                result,
                format!(
                    "Enriched content too short: {} < {}",
                    enriched.definition.len(),
                    self.config.min_definition_length
                ),
            );
        }

        // Step 4: immutably update the field.
        let modified = match self
            .parser
            .update_field(&block, field_name, &enriched.definition)
        {
            Ok(m) => m,
            Err(e) => return self.fail(result, e.to_string()),
        };

        // Step 5: re-validate the written-out block (see module docs — the
        // Python original re-validated the stale in-memory object, which is
        // a near-no-op; validating the actual new markdown is the sane
        // reading of its intent).
        let new_block_markdown = write_ontology_block(&modified);
        let new_content = replace_ontology_block(&content, &new_block_markdown);

        let final_validation = self
            .validator
            .validate_file(&file_path.display().to_string(), Some(&new_content));
        if !final_validation.is_valid {
            result.validation_errors = final_validation.errors.clone();
            return self.fail(
                result,
                format!(
                    "Modified ontology failed OWL2 validation: {:?}",
                    final_validation.errors
                ),
            );
        }

        // Step 6: write back (preserving ALL fields).
        if let Err(e) = std::fs::write(file_path, &new_content) {
            return self.fail(result, format!("Exception during enrichment: {e}"));
        }

        result.success = true;
        result
    }

    /// Apply the automatic-rollback failure path shared by every early
    /// return in [`Self::enrich_field`].
    fn fail(&self, mut result: EnrichmentResult, message: String) -> EnrichmentResult {
        result.success = false;
        if result.validation_errors.is_empty() {
            result.validation_errors = vec![message];
        }
        if self.config.auto_rollback {
            result.rollback_performed = self.rollback(Path::new(&result.file_path));
        }
        result
    }

    /// Detect and optionally fix broken wiki-link references.
    pub fn fix_broken_links(
        &self,
        file_path: &Path,
        auto_fix: bool,
    ) -> std::io::Result<LinkReport> {
        let report = self.link_validator.validate_links(file_path)?;

        if auto_fix && !report.broken_links.is_empty() {
            let fixed_report =
                self.link_validator
                    .auto_fix_links(file_path, &report.broken_links, 0.8)?;

            let validation = self.validate_file(file_path);
            if !validation.is_valid {
                self.rollback(file_path);
                return Ok(report);
            }

            return Ok(fixed_report);
        }

        Ok(report)
    }

    /// Enrich multiple files with rate limiting.
    pub async fn batch_enrich(
        &self,
        file_paths: &[PathBuf],
        field_name: &str,
    ) -> Vec<EnrichmentResult> {
        let mut results = Vec::with_capacity(file_paths.len());
        let delay = Duration::from_secs_f64(60.0 / self.config.rate_limit_per_minute.max(1) as f64);

        for (i, file_path) in file_paths.iter().enumerate() {
            let result = self.enrich_field(file_path, field_name, None).await;
            results.push(result);

            if i + 1 < file_paths.len() {
                tokio::time::sleep(delay).await;
            }
        }

        results
    }

    /// Roll back `file_path` to its last `git HEAD` commit.
    fn rollback(&self, file_path: &Path) -> bool {
        Command::new("git")
            .args(["checkout", "HEAD", "--"])
            .arg(file_path)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
}

/// Build a `--set field=value` update map, used by the CLI `modify` command.
pub fn parse_updates(pairs: &[(String, String)]) -> BTreeMap<String, String> {
    pairs.iter().cloned().collect()
}
