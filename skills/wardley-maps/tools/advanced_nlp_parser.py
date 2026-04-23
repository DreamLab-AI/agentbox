#!/usr/bin/env python3
"""
Advanced NLP Parser for Wardley Maps
Uses spaCy for Named Entity Recognition and dependency parsing
Extracts components, relationships, and strategic positioning from unstructured text
"""

import re
import json
import logging
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass, asdict

try:
    import spacy
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    logging.warning("spaCy not installed. Install with: pip install spacy")

@dataclass
class Component:
    """Represents a system component with strategic positioning"""
    name: str
    visibility: float  # 0-1 scale, where 0 is hidden/infrastructure, 1 is customer-facing
    evolution: float   # 0-1 scale, where 0 is genesis/innovative, 1 is commodity
    description: Optional[str] = None
    category: Optional[str] = None
    confidence: float = 1.0

@dataclass
class Dependency:
    """Represents a relationship between components"""
    source: str
    target: str
    dependency_type: str  # 'strong', 'weak', 'constraint'
    confidence: float = 1.0

class AdvancedNLPParser:
    """
    Advanced NLP parser for extracting Wardley Map components from natural language
    """

    def __init__(self, use_spacy: bool = True):
        self.use_spacy = use_spacy and SPACY_AVAILABLE
        self.nlp = None

        if self.use_spacy:
            try:
                self.nlp = spacy.load("en_core_web_sm")
            except OSError:
                logging.warning("spaCy model 'en_core_web_sm' not found. Installing...")
                import subprocess
                subprocess.check_call(["python", "-m", "spacy", "download", "en_core_web_sm"])
                self.nlp = spacy.load("en_core_web_sm")

        # Evolution stage indicators
        self.evolution_keywords = {
            'genesis': {
                'keywords': ['innovative', 'experimental', 'novel', 'research', 'prototype',
                           'alpha', 'unprecedented', 'breakthrough', 'cutting-edge', 'pioneering',
                           'emerging', 'exploration', 'speculative', 'unproven', 'beta'],
                'range': (0.05, 0.25),
                'weight': 1.0
            },
            'custom': {
                'keywords': ['custom', 'bespoke', 'proprietary', 'differentiated', 'unique',
                           'specialized', 'in-house', 'homegrown', 'tailored', 'handcrafted',
                           'specific', 'proprietary', 'competitive advantage', 'strategic asset'],
                'range': (0.25, 0.55),
                'weight': 0.8
            },
            'product': {
                'keywords': ['product', 'solution', 'platform', 'service', 'offering', 'package',
                           'commercial', 'mature', 'stable', 'established', 'proven', 'mainstream',
                           'market-ready', 'production'],
                'range': (0.55, 0.8),
                'weight': 0.8
            },
            'commodity': {
                'keywords': ['commodity', 'utility', 'standard', 'outsourced', 'cloud', 'saas',
                           'off-the-shelf', 'cots', 'common', 'generic', 'widely-available',
                           'industry-standard', 'ubiquitous', 'commodity', 'fungible'],
                'range': (0.8, 0.98),
                'weight': 1.0
            }
        }

        # Visibility indicators (user-facing vs infrastructure)
        self.visibility_keywords = {
            'high': {
                'keywords': ['customer', 'user', 'client', 'consumer', 'interface', 'experience',
                           'facing', 'front', 'portal', 'dashboard', 'application', 'ui', 'ux',
                           'visible', 'direct', 'end-user'],
                'range': (0.75, 1.0),
                'weight': 1.0
            },
            'medium': {
                'keywords': ['api', 'integration', 'middleware', 'service', 'layer', 'backend',
                           'business logic', 'orchestration', 'coordination', 'gateway', 'broker'],
                'range': (0.4, 0.75),
                'weight': 0.9
            },
            'low': {
                'keywords': ['infrastructure', 'hosting', 'server', 'database', 'storage',
                           'internal', 'core', 'engine', 'foundation', 'network', 'computing',
                           'platform', 'underlying', 'system'],
                'range': (0.05, 0.4),
                'weight': 0.9
            }
        }

    def parse(self, text: str) -> Tuple[List[Component], List[Dependency]]:
        """
        Parse natural language text and extract components and dependencies

        Args:
            text: Unstructured text description

        Returns:
            Tuple of (components, dependencies)
        """
        if self.use_spacy and self.nlp:
            return self._parse_with_spacy(text)
        else:
            return self._parse_with_regex(text)

    def _parse_with_spacy(self, text: str) -> Tuple[List[Component], List[Dependency]]:
        """Parse using spaCy NLP pipeline"""
        doc = self.nlp(text)

        components = self._extract_entities(doc)
        dependencies = self._extract_dependencies(doc, components)

        return components, dependencies

    def _extract_entities(self, doc) -> List[Component]:
        """Extract components from named entities and noun phrases"""
        components = []
        seen_names: Set[str] = set()

        # Extract from spaCy NER
        for ent in doc.ents:
            if ent.label_ in ['PRODUCT', 'ORG', 'GPE']:
                comp = self._create_component_from_entity(ent, doc)
                if comp and comp.name.lower() not in seen_names:
                    components.append(comp)
                    seen_names.add(comp.name.lower())

        # Extract noun chunks as potential components
        for chunk in doc.noun_chunks:
            if len(chunk.text.split()) <= 4:  # Limit to reasonable length
                text_lower = chunk.text.lower()
                if text_lower not in seen_names and not self._is_stopword_chunk(chunk):
                    comp = self._create_component_from_chunk(chunk, doc)
                    if comp:
                        components.append(comp)
                        seen_names.add(text_lower)

        return components

    def _create_component_from_entity(self, ent, doc: 'spacy.Doc') -> Optional[Component]:
        """Create a component from a spaCy entity"""
        name = ent.text.strip()

        # Get surrounding context for positioning
        start_idx = max(0, ent.start_char - 200)
        end_idx = min(len(doc.text), ent.end_char + 200)
        context = doc.text[start_idx:end_idx].lower()

        evolution = self._score_evolution(name, context)
        visibility = self._score_visibility(name, context)

        return Component(
            name=name,
            visibility=visibility,
            evolution=evolution,
            category=ent.label_,
            confidence=0.85
        )

    def _create_component_from_chunk(self, chunk, doc: 'spacy.Doc') -> Optional[Component]:
        """Create a component from a noun chunk"""
        name = chunk.text.strip()

        # Get surrounding context
        start_idx = max(0, chunk.start_char - 200)
        end_idx = min(len(doc.text), chunk.end_char + 200)
        context = doc.text[start_idx:end_idx].lower()

        evolution = self._score_evolution(name, context)
        visibility = self._score_visibility(name, context)

        return Component(
            name=name,
            visibility=visibility,
            evolution=evolution,
            category='NOUN_CHUNK',
            confidence=0.65
        )

    def _extract_dependencies(self, doc, components: List[Component]) -> List[Dependency]:
        """Extract dependencies using spaCy dependency parsing"""
        dependencies = []
        component_names = {c.name.lower(): c.name for c in components}
        seen_deps: Set[Tuple[str, str]] = set()

        # Analyze syntactic dependencies
        for token in doc:
            if token.dep_ in ['nsubj', 'nmod', 'obl']:
                source_token = self._find_component_head(token, doc)

                # Look for object or target
                for child in token.head.children:
                    if child.dep_ in ['obj', 'nmod', 'obl']:
                        target_token = self._find_component_head(child, doc)

                        if source_token and target_token:
                            source_name = self._match_component_name(source_token.text, component_names)
                            target_name = self._match_component_name(target_token.text, component_names)

                            if source_name and target_name and source_name != target_name:
                                dep_key = (source_name.lower(), target_name.lower())
                                if dep_key not in seen_deps:
                                    dep_type = self._determine_dependency_type(token.head, doc)
                                    dependencies.append(Dependency(
                                        source=source_name,
                                        target=target_name,
                                        dependency_type=dep_type,
                                        confidence=0.7
                                    ))
                                    seen_deps.add(dep_key)

        # Also look for explicit relationship patterns
        explicit_deps = self._extract_explicit_dependencies(doc, component_names)
        for dep in explicit_deps:
            dep_key = (dep.source.lower(), dep.target.lower())
            if dep_key not in seen_deps:
                dependencies.append(dep)
                seen_deps.add(dep_key)

        return dependencies

    def _extract_explicit_dependencies(self, doc, component_names: Dict[str, str]) -> List[Dependency]:
        """Extract dependencies from explicit relationship patterns"""
        dependencies = []
        text_lower = doc.text.lower()

        # Pattern: "X depends on Y", "X uses Y", "X requires Y", "X built on Y"
        patterns = [
            (r'(\w+[\w\s]+?)\s+(?:depends on|requires|needs)\s+(\w+[\w\s]+)', 'strong'),
            (r'(\w+[\w\s]+?)\s+(?:uses|leverages|built on|runs on)\s+(\w+[\w\s]+)', 'strong'),
            (r'(\w+[\w\s]+?)\s+(?:powered by|driven by)\s+(\w+[\w\s]+)', 'strong'),
            (r'(\w+[\w\s]+?)\s+(?:integrated with|communicates with)\s+(\w+[\w\s]+)', 'weak'),
            (r'(\w+[\w\s]+?)\s+(?:constrained by|limited by)\s+(\w+[\w\s]+)', 'constraint'),
        ]

        for pattern, dep_type in patterns:
            for match in re.finditer(pattern, text_lower, re.IGNORECASE):
                source = match.group(1).strip().title()
                target = match.group(2).strip().title()

                source_matched = self._match_component_name(source, component_names)
                target_matched = self._match_component_name(target, component_names)

                if source_matched and target_matched and source_matched != target_matched:
                    dependencies.append(Dependency(
                        source=source_matched,
                        target=target_matched,
                        dependency_type=dep_type,
                        confidence=0.85
                    ))

        return dependencies

    def _find_component_head(self, token, doc) -> Optional:
        """Find the component head of a token's chunk"""
        return token.head if token.head else token

    def _match_component_name(self, text: str, component_names: Dict[str, str]) -> Optional[str]:
        """Match a text string to a component name"""
        text_lower = text.lower().strip()

        # Exact match
        if text_lower in component_names:
            return component_names[text_lower]

        # Partial match (check if text contains or is contained in component names)
        for comp_name_lower, comp_name in component_names.items():
            if comp_name_lower in text_lower or text_lower in comp_name_lower:
                return comp_name

        return None

    def _determine_dependency_type(self, token, doc) -> str:
        """Determine the type of dependency (strong, weak, constraint)"""
        text_lower = doc.text[max(0, token.idx-100):min(len(doc.text), token.idx+100)].lower()

        if any(w in text_lower for w in ['critical', 'essential', 'required', 'depends', 'must']):
            return 'strong'
        elif any(w in text_lower for w in ['constrain', 'limit', 'restrict', 'bound']):
            return 'constraint'
        else:
            return 'weak'

    def _score_evolution(self, name: str, context: str) -> float:
        """
        Score the evolution stage (0=genesis, 1=commodity)
        Uses weighted keyword matching from context
        """
        scores = []
        name_lower = name.lower()

        for stage, config in self.evolution_keywords.items():
            stage_score = 0
            keyword_matches = 0

            for keyword in config['keywords']:
                if keyword in context or keyword in name_lower:
                    keyword_matches += 1

            if keyword_matches > 0:
                min_val, max_val = config['range']
                stage_score = min_val + (max_val - min_val) * (keyword_matches / len(config['keywords']))
                scores.append(stage_score * config['weight'])

        # Return average or default middle position
        if scores:
            return min(1.0, max(0.0, sum(scores) / len(scores)))

        # Default positioning based on component name patterns
        if any(word in name_lower for word in ['database', 'server', 'cloud', 'hosting']):
            return 0.85
        elif any(word in name_lower for word in ['api', 'service', 'platform']):
            return 0.65
        elif any(word in name_lower for word in ['algorithm', 'ml', 'ai', 'model']):
            return 0.35

        return 0.5

    def _score_visibility(self, name: str, context: str) -> float:
        """
        Score the visibility (0=infrastructure, 1=customer-facing)
        Uses keyword matching from context and component name
        """
        scores = []
        name_lower = name.lower()

        for visibility_level, config in self.visibility_keywords.items():
            level_score = 0
            keyword_matches = 0

            for keyword in config['keywords']:
                if keyword in context or keyword in name_lower:
                    keyword_matches += 1

            if keyword_matches > 0:
                min_val, max_val = config['range']
                level_score = min_val + (max_val - min_val) * (keyword_matches / len(config['keywords']))
                scores.append(level_score * config['weight'])

        # Return average or default middle position
        if scores:
            return min(1.0, max(0.0, sum(scores) / len(scores)))

        # Default positioning based on component name patterns
        if any(word in name_lower for word in ['ui', 'interface', 'portal', 'dashboard', 'frontend']):
            return 0.9
        elif any(word in name_lower for word in ['api', 'gateway', 'service', 'layer']):
            return 0.55
        elif any(word in name_lower for word in ['database', 'storage', 'infrastructure', 'backend']):
            return 0.2

        return 0.5

    def _is_stopword_chunk(self, chunk) -> bool:
        """Check if a chunk is mostly stopwords"""
        stopwords = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                    'of', 'with', 'by', 'from', 'as', 'is', 'are', 'be', 'being', 'been'}
        words = [t.text.lower() for t in chunk if not t.is_punct]
        if not words:
            return True
        stopword_ratio = sum(1 for w in words if w in stopwords) / len(words)
        return stopword_ratio > 0.7

    def _parse_with_regex(self, text: str) -> Tuple[List[Component], List[Dependency]]:
        """Fallback regex-based parser"""
        components = []
        dependencies = []

        # Simple line-by-line parsing
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            # Parse: "Component Name - description"
            if ' - ' in line:
                parts = line.split(' - ', 1)
                name = parts[0].strip()
                description = parts[1].strip() if len(parts) > 1 else ""

                evolution = self._score_evolution(name, description)
                visibility = self._score_visibility(name, description)

                components.append(Component(
                    name=name,
                    visibility=visibility,
                    evolution=evolution,
                    description=description,
                    confidence=0.7
                ))

        return components, dependencies

def parse_components_json(text: str) -> Tuple[List[Component], List[Dependency]]:
    """
    Convenience function to parse components from JSON text
    """
    try:
        data = json.loads(text)
        components = [Component(**c) for c in data.get('components', [])]
        dependencies = [Dependency(**d) for d in data.get('dependencies', [])]
        return components, dependencies
    except:
        return [], []

def parse_components_text(text: str, use_advanced_nlp: bool = True) -> Tuple[List[Component], List[Dependency]]:
    """
    Main entry point for parsing components from various formats

    Args:
        text: Input text in various formats (JSON, natural language, CSV)
        use_advanced_nlp: Use advanced NLP if available

    Returns:
        Tuple of (components, dependencies)
    """
    # Try JSON first
    if text.strip().startswith('{') or text.strip().startswith('['):
        components, dependencies = parse_components_json(text)
        if components:
            return components, dependencies

    # Use advanced NLP parser
    parser = AdvancedNLPParser(use_spacy=use_advanced_nlp)
    components, dependencies = parser.parse(text)

    # Convert from dataclass to dict format for compatibility
    comp_dicts = [asdict(c) for c in components]
    dep_tuples = [(d.source, d.target) for d in dependencies]

    return comp_dicts, dep_tuples

if __name__ == "__main__":
    # Example usage
    sample_text = """
    Our platform consists of a customer-facing web interface that provides
    a user experience for managing their data. This interface communicates with
    a backend API layer which handles business logic and orchestration.

    The backend uses a custom machine learning model for recommendations, which is
    trained on user data stored in a PostgreSQL database. The database is hosted
    on AWS cloud infrastructure.

    We also integrate with a third-party payment processor for handling transactions.
    The system is constrained by the latency of the payment API.
    """

    parser = AdvancedNLPParser(use_spacy=True)
    components, dependencies = parser.parse(sample_text)

    print("=== Components ===")
    for comp in components:
        print(f"{comp.name}: visibility={comp.visibility:.2f}, evolution={comp.evolution:.2f}")

    print("\n=== Dependencies ===")
    for dep in dependencies:
        print(f"{dep.source} --[{dep.dependency_type}]--> {dep.target}")
