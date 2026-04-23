"""
Wiki-link validation and automatic fixing for ontology files.

Detects broken [[wiki-link]] references and suggests/applies fixes.
"""

import logging
import re
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class LinkReport:
    """Report of link validation results."""
    file_path: str
    total_links: int
    valid_links: int
    broken_links: List[str]
    suggestions: Dict[str, str]
    fixes_applied: int


class LinkValidator:
    """
    Validator for wiki-link references in ontology files.

    Detects [[broken-links]] and suggests alternatives.
    """

    WIKI_LINK_PATTERN = re.compile(r'\[\[([^\]]+)\]\]')

    def __init__(self, knowledge_graph_root: str = "mainKnowledgeGraph/pages"):
        """
        Initialize link validator.

        Args:
            knowledge_graph_root: Root directory for knowledge graph pages
        """
        self.kg_root = Path(knowledge_graph_root)
        logger.info(f"LinkValidator initialized with root: {self.kg_root}")

    def validate_links(self, file_path: str) -> LinkReport:
        """
        Validate all wiki-links in a file.

        Args:
            file_path: Path to file to validate

        Returns:
            LinkReport with validation results
        """
        logger.info(f"Validating links in: {file_path}")

        # Read file content
        content = Path(file_path).read_text()

        # Extract all wiki-links
        links = self.WIKI_LINK_PATTERN.findall(content)

        if not links:
            logger.info("No wiki-links found")
            return LinkReport(
                file_path=file_path,
                total_links=0,
                valid_links=0,
                broken_links=[],
                suggestions={},
                fixes_applied=0
            )

        logger.info(f"Found {len(links)} wiki-links")

        # Validate each link
        broken = []
        suggestions = {}

        for link in links:
            if not self._link_exists(link):
                broken.append(link)
                suggestion = self._suggest_alternative(link)
                if suggestion:
                    suggestions[link] = suggestion

        valid_count = len(links) - len(broken)

        return LinkReport(
            file_path=file_path,
            total_links=len(links),
            valid_links=valid_count,
            broken_links=broken,
            suggestions=suggestions,
            fixes_applied=0
        )

    def auto_fix_links(
        self,
        file_path: str,
        broken_links: List[str],
        confidence_threshold: float = 0.8
    ) -> LinkReport:
        """
        Automatically fix broken links with high-confidence suggestions.

        Args:
            file_path: Path to file to fix
            broken_links: List of broken link targets
            confidence_threshold: Minimum confidence to auto-fix (0-1)

        Returns:
            LinkReport with fixes applied
        """
        logger.info(f"Auto-fixing {len(broken_links)} broken links")

        content = Path(file_path).read_text()
        fixes_applied = 0
        suggestions = {}

        for broken in broken_links:
            suggestion, confidence = self._suggest_alternative_with_confidence(broken)

            if suggestion and confidence >= confidence_threshold:
                logger.info(f"Fixing: [[{broken}]] → [[{suggestion}]] (confidence: {confidence:.2f})")

                # Replace all occurrences
                old_link = f"[[{broken}]]"
                new_link = f"[[{suggestion}]]"
                content = content.replace(old_link, new_link)

                fixes_applied += 1
                suggestions[broken] = suggestion
            else:
                logger.warning(f"Low confidence for [[{broken}]]: {confidence:.2f} < {confidence_threshold}")
                if suggestion:
                    suggestions[broken] = suggestion

        # Write fixed content
        if fixes_applied > 0:
            Path(file_path).write_text(content)
            logger.info(f"✓ Applied {fixes_applied} fixes to: {file_path}")

        # Re-validate to get updated counts
        final_report = self.validate_links(file_path)
        final_report.fixes_applied = fixes_applied
        final_report.suggestions = suggestions

        return final_report

    def _link_exists(self, link_target: str) -> bool:
        """
        Check if wiki-link target exists.

        Args:
            link_target: Link target (e.g., "AI_Agent")

        Returns:
            True if target file exists
        """
        # Convert wiki-link to file path
        # Format: [[AI_Agent]] → mainKnowledgeGraph/pages/AI_Agent.md

        target_file = self.kg_root / f"{link_target}.md"
        exists = target_file.exists()

        if not exists:
            logger.debug(f"Link target not found: {target_file}")

        return exists

    def _suggest_alternative(self, broken_link: str) -> Optional[str]:
        """
        Suggest alternative for broken link.

        Uses fuzzy matching to find similar existing files.

        Args:
            broken_link: Broken link target

        Returns:
            Suggested alternative or None
        """
        suggestion, _ = self._suggest_alternative_with_confidence(broken_link)
        return suggestion

    def _suggest_alternative_with_confidence(
        self,
        broken_link: str
    ) -> Tuple[Optional[str], float]:
        """
        Suggest alternative with confidence score.

        Args:
            broken_link: Broken link target

        Returns:
            Tuple of (suggestion, confidence) where confidence is 0-1
        """
        if not self.kg_root.exists():
            logger.warning(f"Knowledge graph root not found: {self.kg_root}")
            return None, 0.0

        # Get all existing files
        existing_files = list(self.kg_root.glob("*.md"))

        if not existing_files:
            return None, 0.0

        # Calculate similarity scores
        scores = []
        for file_path in existing_files:
            file_name = file_path.stem  # Remove .md extension
            similarity = self._calculate_similarity(broken_link, file_name)
            scores.append((file_name, similarity))

        # Sort by similarity
        scores.sort(key=lambda x: x[1], reverse=True)

        best_match, confidence = scores[0]

        # Require minimum similarity
        if confidence < 0.5:
            logger.debug(f"No good match for '{broken_link}' (best: '{best_match}' @ {confidence:.2f})")
            return None, confidence

        logger.debug(f"Suggested '{best_match}' for '{broken_link}' (confidence: {confidence:.2f})")
        return best_match, confidence

    def _calculate_similarity(self, str1: str, str2: str) -> float:
        """
        Calculate similarity between two strings.

        Uses Levenshtein distance normalized by length.

        Args:
            str1: First string
            str2: Second string

        Returns:
            Similarity score 0-1 (1 = identical)
        """
        # Normalize to lowercase
        s1 = str1.lower()
        s2 = str2.lower()

        # Exact match
        if s1 == s2:
            return 1.0

        # Substring match (high confidence)
        if s1 in s2 or s2 in s1:
            return 0.85

        # Levenshtein distance
        distance = self._levenshtein_distance(s1, s2)
        max_len = max(len(s1), len(s2))

        # Normalize to 0-1
        similarity = 1.0 - (distance / max_len)

        return similarity

    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """
        Calculate Levenshtein distance between two strings.

        Args:
            s1: First string
            s2: Second string

        Returns:
            Edit distance (number of operations)
        """
        if len(s1) < len(s2):
            return self._levenshtein_distance(s2, s1)

        if len(s2) == 0:
            return len(s1)

        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                # Cost of insertion, deletion, substitution
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row

        return previous_row[-1]
