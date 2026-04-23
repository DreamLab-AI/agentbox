"""
Ontology Modifier - Safe modification operations with automatic validation and rollback.

This module provides high-level modification operations with safety guarantees:
- Atomic updates with rollback capability
- Pre/post validation hooks
- Automatic backups before modification
- Field-level change tracking
- Complete field preservation

All modifications are immutable - original data is never mutated.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import shutil
import re

try:
    from .ontology_parser import OntologyParser, OntologyBlock
    from .owl2_validator import OWL2Validator, ValidationResult
except ImportError:
    # Fallback for standalone test execution
    from ontology_parser import OntologyParser, OntologyBlock
    from owl2_validator import OWL2Validator, ValidationResult


@dataclass
class ModificationResult:
    """Result of modification operation."""

    success: bool
    changes_applied: Dict[str, Any]
    fields_preserved: int
    validation_errors: List[str]
    backup_path: Optional[Path] = None
    error: Optional[str] = None

    def __str__(self) -> str:
        """Format modification result for display."""
        lines = []

        status = "✅ SUCCESS" if self.success else "❌ FAILED"
        lines.append(f"Status: {status}")

        if self.success:
            lines.append(f"Changes Applied: {len(self.changes_applied)}")
            lines.append(f"Fields Preserved: {self.fields_preserved}")

            if self.changes_applied:
                lines.append("\nModified Fields:")
                for field, value in self.changes_applied.items():
                    lines.append(f"  - {field}: {value}")

            if self.backup_path:
                lines.append(f"\nBackup Created: {self.backup_path}")
        else:
            lines.append(f"Error: {self.error}")

            if self.validation_errors:
                lines.append("\nValidation Errors:")
                for error in self.validation_errors:
                    lines.append(f"  - {error}")

        return '\n'.join(lines)


class OntologyModifier:
    """
    Safe modification operations with automatic validation.

    Features:
    - Pre/post validation with OWL2 compliance checks
    - Automatic backup creation before modification
    - Rollback on validation failure
    - Complete field preservation
    - Immutable modification patterns
    """

    def __init__(self, validator: Optional[OWL2Validator] = None):
        """
        Initialize modifier.

        Args:
            validator: Optional OWL2Validator instance (created if not provided)
        """
        self.validator = validator or OWL2Validator()
        self.parser = OntologyParser()

    def modify_file(
        self,
        file_path: Path,
        updates: Dict[str, Any],
        validate: bool = True,
        backup: bool = True
    ) -> ModificationResult:
        """
        Safely modify ontology file with validation and backup.

        Args:
            file_path: Path to markdown file
            updates: Dictionary of field updates
            validate: Run OWL2 validation before/after
            backup: Create backup before modification

        Returns:
            ModificationResult with success status and changes

        Process:
        1. Read current file
        2. Parse OntologyBlock (ALL fields preserved)
        3. Pre-modification validation (if enabled)
        4. Create backup (if enabled)
        5. Apply updates (immutable merge)
        6. Generate new OntologyBlock markdown
        7. Replace OntologyBlock in full file content
        8. Post-modification validation (if enabled)
        9. Write to file or rollback on failure
        10. Return result
        """
        backup_path = None

        try:
            # 1. Read current file
            if not file_path.exists():
                return ModificationResult(
                    success=False,
                    changes_applied={},
                    fields_preserved=0,
                    validation_errors=[],
                    error=f"File not found: {file_path}"
                )

            original_content = file_path.read_text(encoding='utf-8')

            # 2. Parse OntologyBlock (ALL fields preserved)
            block = self.parser.parse_ontology_block(original_content, file_path)

            # 3. Pre-modification validation
            if validate:
                pre_validation = self.validator.validate_file(str(file_path), original_content)
                if not pre_validation.is_valid:
                    return ModificationResult(
                        success=False,
                        changes_applied={},
                        fields_preserved=0,
                        validation_errors=pre_validation.errors,
                        error="Pre-validation failed"
                    )

            # 4. Create backup
            if backup:
                backup_path = self._create_backup(file_path)

            # 5. Apply updates (immutable merge)
            updated_block = self.parser.merge_blocks(block, updates)

            # 6. Generate new OntologyBlock markdown
            new_block_markdown = self.parser.write_ontology_block(updated_block)

            # 7. Replace OntologyBlock in full file content
            new_content = self._replace_ontology_block(original_content, new_block_markdown)

            # 8. Post-modification validation
            if validate:
                post_validation = self.validator.validate_file(
                    str(file_path),
                    new_content
                )
                if not post_validation.is_valid:
                    # Rollback from backup
                    if backup and backup_path:
                        self._restore_backup(file_path, backup_path)

                    return ModificationResult(
                        success=False,
                        changes_applied=updates,
                        fields_preserved=len(vars(updated_block)),
                        validation_errors=post_validation.errors,
                        backup_path=backup_path,
                        error="Post-validation failed (rollback performed)"
                    )

            # 9. Write to file
            file_path.write_text(new_content, encoding='utf-8')

            # 10. Return success result
            return ModificationResult(
                success=True,
                changes_applied=updates,
                fields_preserved=len(vars(updated_block)),
                validation_errors=[],
                backup_path=backup_path
            )

        except Exception as e:
            # Rollback on any exception
            if backup and backup_path and backup_path.exists():
                self._restore_backup(file_path, backup_path)

            return ModificationResult(
                success=False,
                changes_applied=updates,
                fields_preserved=0,
                validation_errors=[],
                backup_path=backup_path,
                error=f"Exception during modification: {e}"
            )

    def validate_modification(
        self,
        original: str,
        modified: str,
        required_fields: Optional[List[str]] = None
    ) -> ValidationResult:
        """
        Validate that modification preserved all required fields.

        Args:
            original: Original file content
            modified: Modified file content
            required_fields: Optional list of required fields to check

        Returns:
            ValidationResult with field-level checks
        """
        errors = []
        warnings = []

        # Parse both versions
        original_block = self.parser.parse_ontology_block(original)
        modified_block = self.parser.parse_ontology_block(modified)

        # Check field preservation
        if required_fields:
            for field in required_fields:
                original_value = getattr(original_block, field, None)
                modified_value = getattr(modified_block, field, None)

                if original_value and not modified_value:
                    errors.append(f"Field '{field}' was stripped")
                elif original_value != modified_value:
                    warnings.append(f"Field '{field}' value changed")

        # Check additional_fields preservation
        lost_fields = set(original_block.additional_fields.keys()) - set(modified_block.additional_fields.keys())
        if lost_fields:
            errors.append(f"Lost additional fields: {', '.join(lost_fields)}")

        # Check relationships preservation
        lost_rels = set(original_block.relationships.keys()) - set(modified_block.relationships.keys())
        if lost_rels:
            warnings.append(f"Lost relationships: {', '.join(lost_rels)}")

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )

    def _create_backup(self, file_path: Path) -> Path:
        """
        Create timestamped backup.

        Args:
            file_path: Path to file to backup

        Returns:
            Path to backup file
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = file_path.parent / ".backups"
        backup_dir.mkdir(exist_ok=True)

        backup_path = backup_dir / f"{file_path.stem}_{timestamp}.md"
        shutil.copy2(file_path, backup_path)

        return backup_path

    def _restore_backup(self, file_path: Path, backup_path: Path):
        """
        Restore from backup.

        Args:
            file_path: Path to file to restore
            backup_path: Path to backup file
        """
        if backup_path.exists():
            shutil.copy2(backup_path, file_path)

    def _replace_ontology_block(
        self,
        full_content: str,
        new_block: str
    ) -> str:
        """
        Replace OntologyBlock section in full file.

        Args:
            full_content: Full markdown content
            new_block: New OntologyBlock markdown

        Returns:
            Modified content with replaced OntologyBlock
        """
        # Pattern: from "- ### OntologyBlock" to first "- ##" section or end
        pattern = r'(-\s*###\s*OntologyBlock.*?)(?=\n-\s*##|\Z)'

        def replacer(match):
            # Keep everything before the block content
            return new_block

        # Replace the block
        new_content = re.sub(pattern, replacer, full_content, flags=re.DOTALL)

        # If pattern didn't match, append at beginning (after title)
        if new_content == full_content and '### OntologyBlock' not in new_content:
            # Insert after first line (title)
            lines = full_content.split('\n', 1)
            if len(lines) == 2:
                new_content = f"{lines[0]}\n\n{new_block}\n\n{lines[1]}"
            else:
                new_content = f"{new_block}\n\n{full_content}"

        return new_content
