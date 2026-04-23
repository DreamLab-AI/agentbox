#!/usr/bin/env python3
"""
Programmatic Heuristics Engine for Wardley Maps
Converts knowledge from reference guides into machine-readable rules
for accurate component positioning and strategic analysis
"""

import json
import yaml
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum

class EvolutionStage(Enum):
    """Wardley Map evolution stages"""
    GENESIS = "genesis"
    CUSTOM = "custom"
    PRODUCT = "product"
    COMMODITY = "commodity"

@dataclass
class EvolutionCharacteristics:
    """Characteristics for each evolution stage"""
    ubiquity: str  # Rare, Slowly increasing, Rapidly increasing, Widespread
    certainty: str  # Poorly understood, Rapid learning, Rapid learning, Known
    market: str  # Undefined, Forming, Growing, Mature
    failures: str  # High/unpredictable, High/reducing, Low, Very low
    competition: str  # N/A, Emerging, High, Utility

@dataclass
class HeuristicRule:
    """Represents a heuristic rule for component positioning"""
    condition: str  # The condition to check
    stage: EvolutionStage
    confidence: float = 0.8
    domain: str = "generic"  # technical, business, competitive, data
    priority: int = 1  # Priority level (higher = apply first)

@dataclass
class ComponentPattern:
    """Represents a known component pattern"""
    name: str
    category: str
    default_stage: EvolutionStage
    default_visibility: float
    examples: List[str] = field(default_factory=list)
    characteristics: Dict = field(default_factory=dict)

class HeuristicsEngine:
    """
    Machine-readable heuristics engine for Wardley Map component positioning
    Codifies knowledge from reference guides
    """

    def __init__(self):
        self.rules: List[HeuristicRule] = []
        self.patterns: Dict[str, ComponentPattern] = {}
        self.evolution_characteristics: Dict[EvolutionStage, EvolutionCharacteristics] = {}
        self.domain_knowledge: Dict[str, Dict] = {}

        self._initialize_evolution_characteristics()
        self._initialize_patterns()
        self._initialize_technical_heuristics()
        self._initialize_business_heuristics()
        self._initialize_competitive_heuristics()
        self._initialize_financial_heuristics()

    def _initialize_evolution_characteristics(self):
        """Initialize evolution stage characteristics from Wardley theory"""
        self.evolution_characteristics = {
            EvolutionStage.GENESIS: EvolutionCharacteristics(
                ubiquity="Rare",
                certainty="Poorly understood",
                market="Undefined",
                failures="High and unpredictable",
                competition="N/A"
            ),
            EvolutionStage.CUSTOM: EvolutionCharacteristics(
                ubiquity="Slowly increasing",
                certainty="Rapid learning",
                market="Forming",
                failures="High but reducing",
                competition="Emerging"
            ),
            EvolutionStage.PRODUCT: EvolutionCharacteristics(
                ubiquity="Rapidly increasing",
                certainty="Rapid learning",
                market="Growing",
                failures="Low",
                competition="High"
            ),
            EvolutionStage.COMMODITY: EvolutionCharacteristics(
                ubiquity="Widespread",
                certainty="Known",
                market="Mature",
                failures="Very low",
                competition="Utility-focused"
            )
        }

    def _initialize_patterns(self):
        """Initialize known component patterns"""
        # Database technologies
        patterns = {
            # Databases - most are commodity
            'PostgreSQL': ComponentPattern(
                name='PostgreSQL',
                category='Database',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.15,
                examples=['Relational DB', 'RDBMS', 'SQL Database'],
                characteristics={'maturity': 'mature', 'adoption': 'widespread', 'margin': 'low'}
            ),
            'MySQL': ComponentPattern(
                name='MySQL',
                category='Database',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.15,
                examples=['MySQL', 'MariaDB'],
                characteristics={'maturity': 'mature', 'adoption': 'widespread', 'margin': 'low'}
            ),
            'MongoDB': ComponentPattern(
                name='MongoDB',
                category='Database',
                default_stage=EvolutionStage.PRODUCT,
                default_visibility=0.15,
                examples=['NoSQL DB', 'Document Database'],
                characteristics={'maturity': 'product', 'adoption': 'growing', 'margin': 'medium'}
            ),

            # Frontend Frameworks - product stage
            'React': ComponentPattern(
                name='React',
                category='Frontend Framework',
                default_stage=EvolutionStage.PRODUCT,
                default_visibility=0.8,
                examples=['React.js', 'ReactJS', 'React Frontend'],
                characteristics={'maturity': 'product', 'adoption': 'rapidly increasing', 'margin': 'medium'}
            ),
            'Vue': ComponentPattern(
                name='Vue',
                category='Frontend Framework',
                default_stage=EvolutionStage.PRODUCT,
                default_visibility=0.8,
                examples=['Vue.js', 'VueJS'],
                characteristics={'maturity': 'product', 'adoption': 'rapidly increasing', 'margin': 'medium'}
            ),

            # Cloud Infrastructure - commodity
            'AWS': ComponentPattern(
                name='AWS',
                category='Cloud Infrastructure',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.1,
                examples=['Amazon Web Services', 'EC2', 'S3'],
                characteristics={'maturity': 'mature', 'adoption': 'widespread', 'margin': 'low'}
            ),
            'Kubernetes': ComponentPattern(
                name='Kubernetes',
                category='Container Orchestration',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.05,
                examples=['K8s', 'K8S', 'Kubernetes'],
                characteristics={'maturity': 'mature', 'adoption': 'widespread', 'margin': 'low'}
            ),

            # ML Frameworks - product to custom
            'TensorFlow': ComponentPattern(
                name='TensorFlow',
                category='ML Framework',
                default_stage=EvolutionStage.PRODUCT,
                default_visibility=0.3,
                examples=['TensorFlow', 'TF'],
                characteristics={'maturity': 'product', 'adoption': 'growing', 'margin': 'medium'}
            ),
            'PyTorch': ComponentPattern(
                name='PyTorch',
                category='ML Framework',
                default_stage=EvolutionStage.PRODUCT,
                default_visibility=0.3,
                examples=['PyTorch', 'Torch'],
                characteristics={'maturity': 'product', 'adoption': 'growing', 'margin': 'medium'}
            ),

            # Custom ML Models - genesis/custom
            'ML Model': ComponentPattern(
                name='Custom ML Model',
                category='ML Model',
                default_stage=EvolutionStage.CUSTOM,
                default_visibility=0.4,
                examples=['Machine Learning', 'Custom Model', 'Proprietary Algorithm'],
                characteristics={'maturity': 'custom', 'adoption': 'proprietary', 'margin': 'high'}
            ),

            # APIs - product/commodity
            'REST API': ComponentPattern(
                name='REST API',
                category='API',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.5,
                examples=['API', 'REST', 'HTTP API'],
                characteristics={'maturity': 'mature', 'adoption': 'widespread', 'margin': 'low'}
            ),

            # Authentication - commodity
            'OAuth2': ComponentPattern(
                name='OAuth2',
                category='Authentication',
                default_stage=EvolutionStage.COMMODITY,
                default_visibility=0.2,
                examples=['OAuth', 'OAuth2', 'OpenID'],
                characteristics={'maturity': 'standard', 'adoption': 'widespread', 'margin': 'low'}
            ),
        }

        self.patterns.update(patterns)

    def _initialize_technical_heuristics(self):
        """Initialize heuristics from technical-mapper.md"""
        technical_rules = [
            # Frontend
            HeuristicRule(
                condition="is_customer_interface and is_web",
                stage=EvolutionStage.PRODUCT,
                confidence=0.85,
                domain="technical"
            ),

            # Backend/Business Logic
            HeuristicRule(
                condition="handles_core_business_logic",
                stage=EvolutionStage.PRODUCT,
                confidence=0.8,
                domain="technical"
            ),

            # Custom implementations
            HeuristicRule(
                condition="is_proprietary and high_business_value",
                stage=EvolutionStage.CUSTOM,
                confidence=0.9,
                domain="technical"
            ),

            # Infrastructure
            HeuristicRule(
                condition="is_infrastructure or is_hosting",
                stage=EvolutionStage.COMMODITY,
                confidence=0.9,
                domain="technical"
            ),

            # Open source libraries
            HeuristicRule(
                condition="is_open_source and widely_used",
                stage=EvolutionStage.COMMODITY,
                confidence=0.85,
                domain="technical"
            ),
        ]

        self.rules.extend(technical_rules)

    def _initialize_business_heuristics(self):
        """Initialize heuristics from business-mapper.md"""
        business_rules = [
            # Customer-facing components
            HeuristicRule(
                condition="directly_serves_customer",
                stage=EvolutionStage.PRODUCT,
                confidence=0.85,
                domain="business"
            ),

            # Core differentiators
            HeuristicRule(
                condition="provides_competitive_advantage",
                stage=EvolutionStage.CUSTOM,
                confidence=0.9,
                domain="business"
            ),

            # Support functions
            HeuristicRule(
                condition="is_support_function and can_be_outsourced",
                stage=EvolutionStage.COMMODITY,
                confidence=0.8,
                domain="business"
            ),

            # Innovation
            HeuristicRule(
                condition="is_new_market_category",
                stage=EvolutionStage.GENESIS,
                confidence=0.85,
                domain="business"
            ),
        ]

        self.rules.extend(business_rules)

    def _initialize_competitive_heuristics(self):
        """Initialize heuristics from competitive-mapper.md"""
        competitive_rules = [
            # Market leader positioning
            HeuristicRule(
                condition="is_market_leader and dominant_position",
                stage=EvolutionStage.PRODUCT,
                confidence=0.85,
                domain="competitive"
            ),

            # Disruptor positioning
            HeuristicRule(
                condition="is_disruptive_innovation",
                stage=EvolutionStage.GENESIS,
                confidence=0.9,
                domain="competitive"
            ),

            # Commodity positioning
            HeuristicRule(
                condition="is_highly_competitive and low_margin",
                stage=EvolutionStage.COMMODITY,
                confidence=0.9,
                domain="competitive"
            ),
        ]

        self.rules.extend(competitive_rules)

    def _initialize_financial_heuristics(self):
        """Initialize heuristics from financial metrics (data-mapper.md)"""
        financial_rules = [
            # High margin = likely custom
            HeuristicRule(
                condition="gross_margin_high",  # > 60%
                stage=EvolutionStage.CUSTOM,
                confidence=0.85,
                domain="financial"
            ),

            # Medium margin = likely product
            HeuristicRule(
                condition="gross_margin_medium",  # 30-60%
                stage=EvolutionStage.PRODUCT,
                confidence=0.8,
                domain="financial"
            ),

            # Low margin = likely commodity
            HeuristicRule(
                condition="gross_margin_low",  # < 30%
                stage=EvolutionStage.COMMODITY,
                confidence=0.9,
                domain="financial"
            ),

            # Rapid revenue growth = fast evolution
            HeuristicRule(
                condition="rapid_revenue_growth",
                stage=EvolutionStage.CUSTOM,  # Moving towards commodity
                confidence=0.7,
                domain="financial"
            ),

            # Stable revenue = commodity
            HeuristicRule(
                condition="stable_low_revenue_growth",
                stage=EvolutionStage.COMMODITY,
                confidence=0.8,
                domain="financial"
            ),
        ]

        self.rules.extend(financial_rules)

    def score_component(self, name: str, context: Dict) -> Tuple[float, float]:
        """
        Score a component's evolution and visibility based on heuristic rules
        Returns: (evolution_score, visibility_score)
        """
        # Check if it matches a known pattern
        if name in self.patterns:
            pattern = self.patterns[name]
            evolution = self._stage_to_score(pattern.default_stage)
            visibility = pattern.default_visibility
            return evolution, visibility

        # Check fuzzy matching against patterns
        for pattern_name, pattern in self.patterns.items():
            if self._fuzzy_match(name, pattern_name) or any(
                self._fuzzy_match(name, ex) for ex in pattern.examples
            ):
                evolution = self._stage_to_score(pattern.default_stage)
                visibility = pattern.default_visibility
                return evolution, visibility

        # Apply heuristic rules
        evolution_score = self._apply_heuristics(name, context)
        visibility_score = self._score_visibility_heuristic(name, context)

        return evolution_score, visibility_score

    def _apply_heuristics(self, name: str, context: Dict) -> float:
        """Apply heuristic rules to determine evolution stage"""
        applicable_rules = [
            rule for rule in self.rules
            if self._evaluate_rule_condition(rule.condition, context)
        ]

        if not applicable_rules:
            return 0.5  # Default middle position

        # Sort by priority and confidence
        applicable_rules.sort(key=lambda r: (r.priority, r.confidence), reverse=True)

        # Use highest priority/confidence rule
        best_rule = applicable_rules[0]
        return self._stage_to_score(best_rule.stage)

    def _score_visibility_heuristic(self, name: str, context: Dict) -> float:
        """Score visibility based on context"""
        name_lower = name.lower()

        # Direct visibility keywords
        high_visibility = ['customer', 'user', 'interface', 'portal', 'dashboard', 'ui', 'ux', 'frontend']
        medium_visibility = ['api', 'service', 'layer', 'gateway', 'orchestration']
        low_visibility = ['database', 'storage', 'infrastructure', 'hosting', 'backend', 'core', 'engine']

        if any(word in name_lower for word in high_visibility):
            return 0.85
        elif any(word in name_lower for word in medium_visibility):
            return 0.5
        elif any(word in name_lower for word in low_visibility):
            return 0.2

        # Check context
        if context.get('is_customer_facing'):
            return 0.85
        elif context.get('is_internal'):
            return 0.3

        return 0.5

    def _evaluate_rule_condition(self, condition: str, context: Dict) -> bool:
        """Evaluate if a rule condition is met"""
        # Simple condition evaluation (can be extended for complex logic)
        condition_key = condition.lower().replace(' ', '_')
        return context.get(condition_key, False)

    def _fuzzy_match(self, text1: str, text2: str, threshold: float = 0.8) -> bool:
        """Simple fuzzy matching between component names"""
        text1_lower = text1.lower().strip()
        text2_lower = text2.lower().strip()

        if text1_lower == text2_lower:
            return True

        # Check if one contains the other
        if text1_lower in text2_lower or text2_lower in text1_lower:
            return True

        # Levenshtein distance (simple version)
        if self._levenshtein_similarity(text1_lower, text2_lower) > threshold:
            return True

        return False

    def _levenshtein_similarity(self, s1: str, s2: str) -> float:
        """Calculate similarity ratio between two strings"""
        if len(s1) < len(s2):
            return self._levenshtein_similarity(s2, s1)

        if len(s2) == 0:
            return 0.0

        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row

        distance = previous_row[-1]
        max_length = max(len(s1), len(s2))
        return 1.0 - (distance / max_length)

    def _stage_to_score(self, stage: EvolutionStage) -> float:
        """Convert evolution stage to score (0-1)"""
        mapping = {
            EvolutionStage.GENESIS: 0.15,
            EvolutionStage.CUSTOM: 0.4,
            EvolutionStage.PRODUCT: 0.7,
            EvolutionStage.COMMODITY: 0.9
        }
        return mapping.get(stage, 0.5)

    def export_rules_to_json(self) -> str:
        """Export all rules as JSON for inspection/validation"""
        rules_data = {
            'evolution_characteristics': {
                stage.value: {
                    'ubiquity': chars.ubiquity,
                    'certainty': chars.certainty,
                    'market': chars.market,
                    'failures': chars.failures,
                    'competition': chars.competition
                }
                for stage, chars in self.evolution_characteristics.items()
            },
            'patterns': {
                name: {
                    'category': p.category,
                    'default_stage': p.default_stage.value,
                    'default_visibility': p.default_visibility,
                    'examples': p.examples
                }
                for name, p in self.patterns.items()
            },
            'rules_count': len(self.rules),
            'rules_by_domain': {
                domain: len([r for r in self.rules if r.domain == domain])
                for domain in set(r.domain for r in self.rules)
            }
        }

        return json.dumps(rules_data, indent=2)

    def get_component_rationale(self, name: str, evolution: float, visibility: float) -> Dict[str, str]:
        """
        Generate rationale for why a component was positioned at specific coordinates
        """
        rationale = {
            'component': name,
            'evolution_stage': self._score_to_stage(evolution),
            'visibility_level': self._score_to_visibility_level(visibility),
            'evolution_rationale': self._get_evolution_rationale(name, evolution),
            'visibility_rationale': self._get_visibility_rationale(name, visibility),
        }

        return rationale

    def _score_to_stage(self, score: float) -> str:
        """Convert score to evolution stage name"""
        if score < 0.25:
            return 'Genesis'
        elif score < 0.55:
            return 'Custom'
        elif score < 0.8:
            return 'Product'
        else:
            return 'Commodity'

    def _score_to_visibility_level(self, score: float) -> str:
        """Convert score to visibility level"""
        if score < 0.35:
            return 'Low (Infrastructure/Internal)'
        elif score < 0.65:
            return 'Medium (Integration/APIs)'
        else:
            return 'High (Customer-facing)'

    def _get_evolution_rationale(self, name: str, score: float) -> str:
        """Get rationale for evolution positioning"""
        stage = self._score_to_stage(score)

        # Check patterns
        if name in self.patterns:
            pattern = self.patterns[name]
            return f"Matches known {pattern.category} pattern ({pattern.default_stage.value})"

        if 'database' in name.lower() or 'storage' in name.lower():
            return "Infrastructure component typically at commodity stage"

        if 'algorithm' in name.lower() or 'model' in name.lower():
            return "ML/algorithmic component - custom or product stage"

        return f"Positioned in {stage} based on context analysis"

    def _get_visibility_rationale(self, name: str, score: float) -> str:
        """Get rationale for visibility positioning"""
        level = self._score_to_visibility_level(score)

        if 'customer' in name.lower() or 'user' in name.lower() or 'interface' in name.lower():
            return "Directly visible to customers/users"

        if 'database' in name.lower() or 'infrastructure' in name.lower():
            return "Hidden infrastructure - not directly user-visible"

        if 'api' in name.lower() or 'service' in name.lower():
            return "Integration layer - medium visibility"

        return f"Positioned at {level} based on user exposure"

# Export for use in other modules
def get_heuristics_engine() -> HeuristicsEngine:
    """Singleton factory for heuristics engine"""
    return HeuristicsEngine()

if __name__ == "__main__":
    engine = HeuristicsEngine()

    # Test scoring
    test_components = [
        ('PostgreSQL Database', {'is_infrastructure': True}),
        ('React Frontend', {'is_customer_facing': True}),
        ('Custom Recommendation Engine', {'provides_competitive_advantage': True}),
        ('AWS Hosting', {'is_infrastructure': True}),
    ]

    print("=== Heuristics Engine Testing ===\n")
    for name, context in test_components:
        evo, vis = engine.score_component(name, context)
        rationale = engine.get_component_rationale(name, evo, vis)
        print(f"{name}:")
        print(f"  Evolution: {evo:.2f} ({rationale['evolution_stage']})")
        print(f"  Visibility: {vis:.2f} ({rationale['visibility_level']})")
        print(f"  Rationale: {rationale['evolution_rationale']}\n")

    # Export rules
    print("\n=== Knowledge Base Summary ===")
    print(engine.export_rules_to_json())
