//! Static knowledge-base data for [`super::heuristics::HeuristicsEngine`], split out
//! of `heuristics.rs` to keep that file under the 500-line guideline. Ported verbatim
//! from `heuristics_engine.py`'s four `_initialize_*_heuristics` methods and
//! `_initialize_evolution_characteristics`/`_initialize_patterns` — declaration order
//! preserved throughout (see `heuristics.rs`'s module docs for why order matters).

use super::heuristics::{
    ComponentPattern, EvolutionCharacteristics, EvolutionStage, HeuristicRule,
};

/// `_initialize_evolution_characteristics`: fixed Genesis -> Custom -> Product ->
/// Commodity order, matching the Python dict's insertion order.
pub(super) fn evolution_characteristics() -> Vec<(EvolutionStage, EvolutionCharacteristics)> {
    use EvolutionStage::*;
    vec![
        (
            Genesis,
            EvolutionCharacteristics {
                ubiquity: "Rare",
                certainty: "Poorly understood",
                market: "Undefined",
                failures: "High and unpredictable",
                competition: "N/A",
            },
        ),
        (
            Custom,
            EvolutionCharacteristics {
                ubiquity: "Slowly increasing",
                certainty: "Rapid learning",
                market: "Forming",
                failures: "High but reducing",
                competition: "Emerging",
            },
        ),
        (
            Product,
            EvolutionCharacteristics {
                ubiquity: "Rapidly increasing",
                certainty: "Rapid learning",
                market: "Growing",
                failures: "Low",
                competition: "High",
            },
        ),
        (
            Commodity,
            EvolutionCharacteristics {
                ubiquity: "Widespread",
                certainty: "Known",
                market: "Mature",
                failures: "Very low",
                competition: "Utility-focused",
            },
        ),
    ]
}

/// `_initialize_patterns`: `(pattern_key, pattern)` in Python declaration order —
/// order matters for the first-match-wins fuzzy scan in
/// [`super::heuristics::HeuristicsEngine::score_component`].
pub(super) fn component_patterns() -> Vec<(&'static str, ComponentPattern)> {
    use EvolutionStage::*;
    vec![
        (
            "PostgreSQL",
            ComponentPattern {
                name: "PostgreSQL",
                category: "Database",
                default_stage: Commodity,
                default_visibility: 0.15,
                examples: vec!["Relational DB", "RDBMS", "SQL Database"],
            },
        ),
        (
            "MySQL",
            ComponentPattern {
                name: "MySQL",
                category: "Database",
                default_stage: Commodity,
                default_visibility: 0.15,
                examples: vec!["MySQL", "MariaDB"],
            },
        ),
        (
            "MongoDB",
            ComponentPattern {
                name: "MongoDB",
                category: "Database",
                default_stage: Product,
                default_visibility: 0.15,
                examples: vec!["NoSQL DB", "Document Database"],
            },
        ),
        (
            "React",
            ComponentPattern {
                name: "React",
                category: "Frontend Framework",
                default_stage: Product,
                default_visibility: 0.8,
                examples: vec!["React.js", "ReactJS", "React Frontend"],
            },
        ),
        (
            "Vue",
            ComponentPattern {
                name: "Vue",
                category: "Frontend Framework",
                default_stage: Product,
                default_visibility: 0.8,
                examples: vec!["Vue.js", "VueJS"],
            },
        ),
        (
            "AWS",
            ComponentPattern {
                name: "AWS",
                category: "Cloud Infrastructure",
                default_stage: Commodity,
                default_visibility: 0.1,
                examples: vec!["Amazon Web Services", "EC2", "S3"],
            },
        ),
        (
            "Kubernetes",
            ComponentPattern {
                name: "Kubernetes",
                category: "Container Orchestration",
                default_stage: Commodity,
                default_visibility: 0.05,
                examples: vec!["K8s", "K8S", "Kubernetes"],
            },
        ),
        (
            "TensorFlow",
            ComponentPattern {
                name: "TensorFlow",
                category: "ML Framework",
                default_stage: Product,
                default_visibility: 0.3,
                examples: vec!["TensorFlow", "TF"],
            },
        ),
        (
            "PyTorch",
            ComponentPattern {
                name: "PyTorch",
                category: "ML Framework",
                default_stage: Product,
                default_visibility: 0.3,
                examples: vec!["PyTorch", "Torch"],
            },
        ),
        (
            "ML Model",
            ComponentPattern {
                name: "Custom ML Model",
                category: "ML Model",
                default_stage: Custom,
                default_visibility: 0.4,
                examples: vec!["Machine Learning", "Custom Model", "Proprietary Algorithm"],
            },
        ),
        (
            "REST API",
            ComponentPattern {
                name: "REST API",
                category: "API",
                default_stage: Commodity,
                default_visibility: 0.5,
                examples: vec!["API", "REST", "HTTP API"],
            },
        ),
        (
            "OAuth2",
            ComponentPattern {
                name: "OAuth2",
                category: "Authentication",
                default_stage: Commodity,
                default_visibility: 0.2,
                examples: vec!["OAuth", "OAuth2", "OpenID"],
            },
        ),
    ]
}

/// `_initialize_technical_heuristics` + `_initialize_business_heuristics` +
/// `_initialize_competitive_heuristics` + `_initialize_financial_heuristics`,
/// concatenated in that order (matching `self.rules.extend(...)` call order in
/// `HeuristicsEngine.__init__`).
pub(super) fn heuristic_rules() -> Vec<HeuristicRule> {
    use EvolutionStage::*;
    vec![
        // Technical
        HeuristicRule {
            condition: "is_customer_interface and is_web",
            stage: Product,
            confidence: 0.85,
            domain: "technical",
            priority: 1,
        },
        HeuristicRule {
            condition: "handles_core_business_logic",
            stage: Product,
            confidence: 0.8,
            domain: "technical",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_proprietary and high_business_value",
            stage: Custom,
            confidence: 0.9,
            domain: "technical",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_infrastructure or is_hosting",
            stage: Commodity,
            confidence: 0.9,
            domain: "technical",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_open_source and widely_used",
            stage: Commodity,
            confidence: 0.85,
            domain: "technical",
            priority: 1,
        },
        // Business
        HeuristicRule {
            condition: "directly_serves_customer",
            stage: Product,
            confidence: 0.85,
            domain: "business",
            priority: 1,
        },
        HeuristicRule {
            condition: "provides_competitive_advantage",
            stage: Custom,
            confidence: 0.9,
            domain: "business",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_support_function and can_be_outsourced",
            stage: Commodity,
            confidence: 0.8,
            domain: "business",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_new_market_category",
            stage: Genesis,
            confidence: 0.85,
            domain: "business",
            priority: 1,
        },
        // Competitive
        HeuristicRule {
            condition: "is_market_leader and dominant_position",
            stage: Product,
            confidence: 0.85,
            domain: "competitive",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_disruptive_innovation",
            stage: Genesis,
            confidence: 0.9,
            domain: "competitive",
            priority: 1,
        },
        HeuristicRule {
            condition: "is_highly_competitive and low_margin",
            stage: Commodity,
            confidence: 0.9,
            domain: "competitive",
            priority: 1,
        },
        // Financial
        HeuristicRule {
            condition: "gross_margin_high",
            stage: Custom,
            confidence: 0.85,
            domain: "financial",
            priority: 1,
        },
        HeuristicRule {
            condition: "gross_margin_medium",
            stage: Product,
            confidence: 0.8,
            domain: "financial",
            priority: 1,
        },
        HeuristicRule {
            condition: "gross_margin_low",
            stage: Commodity,
            confidence: 0.9,
            domain: "financial",
            priority: 1,
        },
        HeuristicRule {
            condition: "rapid_revenue_growth",
            stage: Custom,
            confidence: 0.7,
            domain: "financial",
            priority: 1,
        },
        HeuristicRule {
            condition: "stable_low_revenue_growth",
            stage: Commodity,
            confidence: 0.8,
            domain: "financial",
            priority: 1,
        },
    ]
}
