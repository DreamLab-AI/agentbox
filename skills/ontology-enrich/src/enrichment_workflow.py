"""
Enrichment workflow orchestration with OWL2 validation and rollback.

Integrates with ontology-core for all parsing/modification operations.
Uses Perplexity API for content enrichment with UK English focus.
"""

import logging
from pathlib import Path
from typing import Optional, Dict, List, Any
from dataclasses import dataclass
import json

# Import ontology-core components
from ontology_core.src.ontology_parser import parse_ontology_block, write_ontology_block
from ontology_core.src.ontology_modifier import modify_field, validate_modification
from ontology_core.src.owl2_validator import validate_ontology, ValidationResult

from .perplexity_client import PerplexityClient, EnrichedContent
from .link_validator import LinkValidator, LinkReport

logger = logging.getLogger(__name__)


@dataclass
class EnrichmentResult:
    """Result of enrichment operation."""
    success: bool
    file_path: str
    field_modified: str
    original_content: str
    enriched_content: str
    citations: List[Dict[str, Any]]
    validation_errors: List[str]
    rollback_performed: bool


@dataclass
class EnrichmentConfig:
    """Configuration for enrichment workflow."""
    uk_english: bool = True
    strict_owl2: bool = True
    require_citations: bool = True
    min_definition_length: int = 50
    auto_rollback: bool = True
    preserve_all_fields: bool = True


class EnrichmentWorkflow:
    """
    Main orchestration class for ontology enrichment operations.

    Delegates all parsing/modification to ontology-core.
    Ensures OWL2 validation and automatic rollback on failures.
    """

    def __init__(
        self,
        api_key: str,
        config: Optional[EnrichmentConfig] = None
    ):
        """
        Initialize enrichment workflow.

        Args:
            api_key: Perplexity API key
            config: Enrichment configuration (uses defaults if None)
        """
        self.perplexity = PerplexityClient(api_key)
        self.link_validator = LinkValidator()
        self.config = config or EnrichmentConfig()

        logger.info("EnrichmentWorkflow initialized")
        logger.info(f"UK English: {self.config.uk_english}")
        logger.info(f"Strict OWL2: {self.config.strict_owl2}")

    def validate_file(self, file_path: str) -> ValidationResult:
        """
        Validate OWL2 compliance without modification.

        Args:
            file_path: Path to ontology file

        Returns:
            ValidationResult with status and errors
        """
        logger.info(f"Validating: {file_path}")

        try:
            # Parse with full field preservation
            ontology = parse_ontology_block(file_path)

            # Validate OWL2 compliance
            validation = validate_ontology(
                ontology,
                strict=self.config.strict_owl2
            )

            if validation.is_valid:
                logger.info(f"✓ OWL2 validation passed: {file_path}")
            else:
                logger.warning(f"✗ OWL2 validation failed: {file_path}")
                for error in validation.errors:
                    logger.warning(f"  - {error}")

            return validation

        except Exception as e:
            logger.error(f"Validation error: {e}")
            return ValidationResult(
                is_valid=False,
                errors=[f"Validation exception: {str(e)}"],
                warnings=[]
            )

    def enrich_field(
        self,
        file_path: str,
        field_name: str,
        context: Optional[str] = None
    ) -> EnrichmentResult:
        """
        Enrich specific field with Perplexity API content.

        Process:
        1. Parse with full field preservation (via ontology-core)
        2. Validate OWL2 compliance
        3. Query Perplexity API with UK English context
        4. Extract citations and structured content
        5. Immutably modify field (via ontology-core)
        6. Validate modification
        7. Write back or rollback on failure

        Args:
            file_path: Path to ontology file
            field_name: Name of field to enrich (e.g., 'definition')
            context: Optional additional context for API query

        Returns:
            EnrichmentResult with success status and details
        """
        logger.info(f"Enriching field '{field_name}' in: {file_path}")

        rollback_performed = False
        original_content = ""
        enriched_content = ""
        citations = []
        validation_errors = []

        try:
            # Step 1: Parse with FULL field preservation
            logger.info("⏳ Parsing ontology block...")
            ontology = parse_ontology_block(file_path)

            # Get current field content
            current_content = getattr(ontology, field_name, "")
            original_content = current_content

            if not current_content:
                raise ValueError(f"Field '{field_name}' is empty or does not exist")

            # Step 2: Validate OWL2 compliance BEFORE modification
            logger.info("⏳ Validating OWL2 compliance...")
            validation = validate_ontology(ontology, strict=self.config.strict_owl2)

            if not validation.is_valid:
                validation_errors = validation.errors
                raise ValueError(f"OWL2 validation failed: {validation.errors}")

            logger.info("✓ OWL2 validation passed")

            # Step 3: Query Perplexity API with UK English context
            logger.info("⏳ Querying Perplexity API (UK English context)...")
            enriched = self.perplexity.enrich_definition(
                current_def=current_content,
                context=context or ontology.title,
                uk_english=self.config.uk_english
            )

            enriched_content = enriched.definition
            citations = enriched.citations

            logger.info(f"✓ Received enriched content with {len(citations)} citations")

            # Validate enriched content meets requirements
            if self.config.require_citations and not citations:
                raise ValueError("No citations in enriched content (required by config)")

            if len(enriched_content) < self.config.min_definition_length:
                raise ValueError(
                    f"Enriched content too short: {len(enriched_content)} < "
                    f"{self.config.min_definition_length}"
                )

            # Step 4: Immutably modify field (via ontology-core)
            logger.info("⏳ Creating immutable modification...")
            modified = modify_field(ontology, field_name, enriched_content)

            # Step 5: Validate modification
            logger.info("⏳ Validating modification...")
            if not validate_modification(modified):
                raise ValueError("Modification validation failed")

            # Final OWL2 validation of modified ontology
            final_validation = validate_ontology(modified, strict=self.config.strict_owl2)
            if not final_validation.is_valid:
                validation_errors = final_validation.errors
                raise ValueError(f"Modified ontology failed OWL2 validation: {final_validation.errors}")

            logger.info("✓ Modification validated")

            # Step 6: Write back (preserving ALL fields)
            logger.info("⏳ Writing modified ontology...")
            write_ontology_block(file_path, modified)

            logger.info(f"✓ File updated: {file_path}")

            return EnrichmentResult(
                success=True,
                file_path=file_path,
                field_modified=field_name,
                original_content=original_content,
                enriched_content=enriched_content,
                citations=citations,
                validation_errors=[],
                rollback_performed=False
            )

        except Exception as e:
            logger.error(f"Enrichment failed: {e}")

            # Step 7: Automatic rollback on failure
            if self.config.auto_rollback:
                logger.warning("⏳ Performing automatic rollback...")
                rollback_performed = self._rollback(file_path)

                if rollback_performed:
                    logger.info("✓ Rollback completed")
                else:
                    logger.error("✗ Rollback failed")

            return EnrichmentResult(
                success=False,
                file_path=file_path,
                field_modified=field_name,
                original_content=original_content,
                enriched_content=enriched_content,
                citations=citations,
                validation_errors=validation_errors or [str(e)],
                rollback_performed=rollback_performed
            )

    def fix_broken_links(
        self,
        file_path: str,
        auto_fix: bool = False
    ) -> LinkReport:
        """
        Detect and optionally fix broken wiki-link references.

        Args:
            file_path: Path to ontology file
            auto_fix: Whether to automatically fix broken links

        Returns:
            LinkReport with broken links and fixes applied
        """
        logger.info(f"Scanning links in: {file_path}")

        report = self.link_validator.validate_links(file_path)

        if report.broken_links:
            logger.warning(f"Found {len(report.broken_links)} broken links")
            for link in report.broken_links:
                logger.warning(f"  ✗ {link}")
        else:
            logger.info("✓ All links valid")

        if auto_fix and report.broken_links:
            logger.info("⏳ Auto-fixing broken links...")
            fixed_report = self.link_validator.auto_fix_links(
                file_path,
                report.broken_links
            )

            # Validate after fixing
            validation = self.validate_file(file_path)
            if not validation.is_valid:
                logger.error("Link fixes caused OWL2 validation failure - rolling back")
                self._rollback(file_path)
                return report  # Return original report

            logger.info(f"✓ Fixed {len(fixed_report.fixes_applied)} links")
            return fixed_report

        return report

    def batch_enrich(
        self,
        file_paths: List[str],
        field_name: str,
        rate_limit: int = 10
    ) -> List[EnrichmentResult]:
        """
        Enrich multiple files with rate limiting.

        Args:
            file_paths: List of file paths to enrich
            field_name: Field to enrich in each file
            rate_limit: Maximum requests per minute

        Returns:
            List of EnrichmentResults
        """
        import time

        results = []
        delay = 60.0 / rate_limit  # Seconds between requests

        logger.info(f"Batch enriching {len(file_paths)} files")
        logger.info(f"Rate limit: {rate_limit} requests/minute")

        for i, file_path in enumerate(file_paths, 1):
            logger.info(f"[{i}/{len(file_paths)}] Processing: {file_path}")

            result = self.enrich_field(file_path, field_name)
            results.append(result)

            if i < len(file_paths):  # Don't delay after last file
                logger.info(f"⏳ Rate limiting: waiting {delay:.1f}s...")
                time.sleep(delay)

        successful = sum(1 for r in results if r.success)
        logger.info(f"✓ Batch complete: {successful}/{len(file_paths)} successful")

        return results

    def _rollback(self, file_path: str) -> bool:
        """
        Rollback file to last git commit.

        Args:
            file_path: Path to file to rollback

        Returns:
            True if rollback successful
        """
        import subprocess

        try:
            # Use git checkout to restore file
            result = subprocess.run(
                ['git', 'checkout', 'HEAD', file_path],
                capture_output=True,
                text=True,
                check=True
            )
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"Git rollback failed: {e.stderr}")
            return False
        except Exception as e:
            logger.error(f"Rollback error: {e}")
            return False
