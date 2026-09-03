//! Port of `skills/wardley-maps/tools/heuristics_engine.py`.
//!
//! `HeuristicsEngine` codifies a small knowledge base of known component name/keyword
//! patterns plus domain heuristic rules (technical / business / competitive /
//! financial) used to score a component's evolution stage and visibility.
//!
//! The Python original `import yaml`s at the top of the file but never actually uses
//! the `yaml` module anywhere in its body (confirmed by reading the whole file and by
//! `grep -n yaml heuristics_engine.py`, which matches only the `import` line) — it is
//! dead. No `yaml` (or any YAML) crate is used here.
//!
//! ## JSON key order
//!
//! [`HeuristicsEngine::export_rules_to_json`] uses `serde_json::Map`, which (this
//! crate's `serde_json` dependency has no `preserve_order` feature) serialises object
//! keys in sorted (`BTreeMap`) order. Python's `dict`/`json.dumps` instead preserves
//! insertion order, so the Python original's `patterns` object is keyed
//! `PostgreSQL, MySQL, MongoDB, React, Vue, AWS, Kubernetes, TensorFlow, PyTorch, ML
//! Model, REST API, OAuth2` (declaration order) while this port emits the same
//! key/value pairs alphabetically sorted. The `rules_by_domain` key order in the
//! Python original is additionally non-deterministic across runs (`set(...)` iteration
//! order depends on Python's per-process string hash randomisation), so this port's
//! deterministic alphabetical order is arguably *more* reproducible than the original.
//! Content (keys present, values) is otherwise identical; JSON object key order is not
//! semantically significant to a spec-compliant consumer.

use super::CompDict;
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EvolutionStage {
    Genesis,
    Custom,
    Product,
    Commodity,
}

impl EvolutionStage {
    pub fn value(self) -> &'static str {
        match self {
            EvolutionStage::Genesis => "genesis",
            EvolutionStage::Custom => "custom",
            EvolutionStage::Product => "product",
            EvolutionStage::Commodity => "commodity",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EvolutionCharacteristics {
    pub ubiquity: &'static str,
    pub certainty: &'static str,
    pub market: &'static str,
    pub failures: &'static str,
    pub competition: &'static str,
}

#[derive(Debug, Clone)]
pub struct HeuristicRule {
    pub condition: &'static str,
    pub stage: EvolutionStage,
    pub confidence: f64,
    pub domain: &'static str,
    pub priority: i32,
}

#[derive(Debug, Clone)]
pub struct ComponentPattern {
    pub name: &'static str,
    pub category: &'static str,
    pub default_stage: EvolutionStage,
    pub default_visibility: f64,
    pub examples: Vec<&'static str>,
}

pub struct HeuristicsEngine {
    rules: Vec<HeuristicRule>,
    /// `(pattern_key, pattern)` in Python declaration order — order matters for the
    /// first-match-wins fuzzy scan in [`Self::score_component`].
    patterns: Vec<(&'static str, ComponentPattern)>,
    /// Fixed Genesis -> Custom -> Product -> Commodity order, matching the Python
    /// dict's insertion order.
    evolution_characteristics: Vec<(EvolutionStage, EvolutionCharacteristics)>,
}

impl Default for HeuristicsEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl HeuristicsEngine {
    /// Builds the engine from the static knowledge base in
    /// [`super::heuristics_patterns`] (see that module for the actual pattern/rule
    /// data, split out to keep this file under the 500-line guideline).
    pub fn new() -> Self {
        HeuristicsEngine {
            rules: super::heuristics_patterns::heuristic_rules(),
            patterns: super::heuristics_patterns::component_patterns(),
            evolution_characteristics: super::heuristics_patterns::evolution_characteristics(),
        }
    }

    /// `score_component(name, context) -> (evolution_score, visibility_score)`
    pub fn score_component(&self, name: &str, context: &CompDict) -> (f64, f64) {
        // Exact pattern-name match.
        if let Some((_, pattern)) = self.patterns.iter().find(|(key, _)| *key == name) {
            return (
                Self::stage_to_score(pattern.default_stage),
                pattern.default_visibility,
            );
        }

        // Fuzzy match against pattern key or any of its examples, first match wins in
        // declaration order (matches Python dict iteration order).
        for (pattern_key, pattern) in &self.patterns {
            let matched = Self::fuzzy_match(name, pattern_key, 0.8)
                || pattern
                    .examples
                    .iter()
                    .any(|ex| Self::fuzzy_match(name, ex, 0.8));
            if matched {
                return (
                    Self::stage_to_score(pattern.default_stage),
                    pattern.default_visibility,
                );
            }
        }

        let evolution_score = self.apply_heuristics(context);
        let visibility_score = self.score_visibility_heuristic(name, context);
        (evolution_score, visibility_score)
    }

    fn apply_heuristics(&self, context: &CompDict) -> f64 {
        let mut applicable: Vec<&HeuristicRule> = self
            .rules
            .iter()
            .filter(|rule| Self::evaluate_rule_condition(rule.condition, context))
            .collect();

        if applicable.is_empty() {
            return 0.5;
        }

        // sort(key=lambda r: (r.priority, r.confidence), reverse=True): a descending
        // stable sort — ties keep their original relative order.
        applicable.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| b.confidence.partial_cmp(&a.confidence).unwrap())
        });

        Self::stage_to_score(applicable[0].stage)
    }

    fn score_visibility_heuristic(&self, name: &str, context: &CompDict) -> f64 {
        let name_lower = name.to_lowercase();

        let high = [
            "customer",
            "user",
            "interface",
            "portal",
            "dashboard",
            "ui",
            "ux",
            "frontend",
        ];
        let medium = ["api", "service", "layer", "gateway", "orchestration"];
        let low = [
            "database",
            "storage",
            "infrastructure",
            "hosting",
            "backend",
            "core",
            "engine",
        ];

        if high.iter().any(|w| name_lower.contains(w)) {
            return 0.85;
        } else if medium.iter().any(|w| name_lower.contains(w)) {
            return 0.5;
        } else if low.iter().any(|w| name_lower.contains(w)) {
            return 0.2;
        }

        if super::get_bool(context, "is_customer_facing", false) {
            return 0.85;
        } else if super::get_bool(context, "is_internal", false) {
            return 0.3;
        }

        0.5
    }

    /// `condition.lower().replace(' ', '_')` then `context.get(condition_key, False)`.
    fn evaluate_rule_condition(condition: &str, context: &CompDict) -> bool {
        let key = condition.to_lowercase().replace(' ', "_");
        super::get_bool(context, &key, false)
    }

    fn fuzzy_match(text1: &str, text2: &str, threshold: f64) -> bool {
        let t1 = text1.to_lowercase();
        let t1 = t1.trim();
        let t2 = text2.to_lowercase();
        let t2 = t2.trim();

        if t1 == t2 {
            return true;
        }
        if t2.contains(t1) || t1.contains(t2) {
            return true;
        }
        Self::levenshtein_similarity(t1, t2) > threshold
    }

    fn levenshtein_similarity(s1: &str, s2: &str) -> f64 {
        // Compare by Unicode scalar value, matching Python's per-character comparison.
        let (s1, s2) = if s1.chars().count() < s2.chars().count() {
            (s2, s1)
        } else {
            (s1, s2)
        };
        let s1: Vec<char> = s1.chars().collect();
        let s2: Vec<char> = s2.chars().collect();

        if s2.is_empty() {
            return 0.0;
        }

        let mut previous_row: Vec<usize> = (0..=s2.len()).collect();
        for (i, c1) in s1.iter().enumerate() {
            let mut current_row = vec![i + 1];
            for (j, c2) in s2.iter().enumerate() {
                let insertions = previous_row[j + 1] + 1;
                let deletions = current_row[j] + 1;
                let substitutions = previous_row[j] + usize::from(c1 != c2);
                current_row.push(insertions.min(deletions).min(substitutions));
            }
            previous_row = current_row;
        }

        let distance = *previous_row.last().unwrap();
        let max_length = s1.len().max(s2.len());
        1.0 - (distance as f64 / max_length as f64)
    }

    fn stage_to_score(stage: EvolutionStage) -> f64 {
        match stage {
            EvolutionStage::Genesis => 0.15,
            EvolutionStage::Custom => 0.4,
            EvolutionStage::Product => 0.7,
            EvolutionStage::Commodity => 0.9,
        }
    }

    /// `export_rules_to_json() -> str` — see the module docs for the JSON key-order
    /// caveat vs. the Python original.
    pub fn export_rules_to_json(&self) -> String {
        let mut evolution_characteristics = Map::new();
        for (stage, chars) in &self.evolution_characteristics {
            evolution_characteristics.insert(
                stage.value().to_string(),
                json!({
                    "ubiquity": chars.ubiquity,
                    "certainty": chars.certainty,
                    "market": chars.market,
                    "failures": chars.failures,
                    "competition": chars.competition,
                }),
            );
        }

        let mut patterns = Map::new();
        for (key, p) in &self.patterns {
            patterns.insert(
                key.to_string(),
                json!({
                    "category": p.category,
                    "default_stage": p.default_stage.value(),
                    "default_visibility": p.default_visibility,
                    "examples": p.examples,
                }),
            );
        }

        let mut rules_by_domain: std::collections::BTreeMap<&str, usize> =
            std::collections::BTreeMap::new();
        for rule in &self.rules {
            *rules_by_domain.entry(rule.domain).or_insert(0) += 1;
        }

        let out = json!({
            "evolution_characteristics": Value::Object(evolution_characteristics),
            "patterns": Value::Object(patterns),
            "rules_count": self.rules.len(),
            "rules_by_domain": rules_by_domain,
        });

        serde_json::to_string_pretty(&out).unwrap_or_default()
    }

    /// `get_component_rationale(name, evolution, visibility) -> Dict[str, str]`
    pub fn get_component_rationale(
        &self,
        name: &str,
        evolution: f64,
        visibility: f64,
    ) -> Map<String, Value> {
        let mut rationale = Map::new();
        rationale.insert("component".into(), json!(name));
        rationale.insert(
            "evolution_stage".into(),
            json!(Self::score_to_stage(evolution)),
        );
        rationale.insert(
            "visibility_level".into(),
            json!(Self::score_to_visibility_level(visibility)),
        );
        rationale.insert(
            "evolution_rationale".into(),
            json!(self.get_evolution_rationale(name, evolution)),
        );
        rationale.insert(
            "visibility_rationale".into(),
            json!(Self::get_visibility_rationale(name, visibility)),
        );
        rationale
    }

    fn score_to_stage(score: f64) -> &'static str {
        if score < 0.25 {
            "Genesis"
        } else if score < 0.55 {
            "Custom"
        } else if score < 0.8 {
            "Product"
        } else {
            "Commodity"
        }
    }

    fn score_to_visibility_level(score: f64) -> &'static str {
        if score < 0.35 {
            "Low (Infrastructure/Internal)"
        } else if score < 0.65 {
            "Medium (Integration/APIs)"
        } else {
            "High (Customer-facing)"
        }
    }

    fn get_evolution_rationale(&self, name: &str, score: f64) -> String {
        let stage = Self::score_to_stage(score);
        if let Some((_, pattern)) = self.patterns.iter().find(|(key, _)| *key == name) {
            return format!(
                "Matches known {} pattern ({})",
                pattern.category,
                pattern.default_stage.value()
            );
        }
        let name_lower = name.to_lowercase();
        if name_lower.contains("database") || name_lower.contains("storage") {
            return "Infrastructure component typically at commodity stage".to_string();
        }
        if name_lower.contains("algorithm") || name_lower.contains("model") {
            return "ML/algorithmic component - custom or product stage".to_string();
        }
        format!("Positioned in {stage} based on context analysis")
    }

    fn get_visibility_rationale(name: &str, score: f64) -> String {
        let level = Self::score_to_visibility_level(score);
        let name_lower = name.to_lowercase();
        if name_lower.contains("customer")
            || name_lower.contains("user")
            || name_lower.contains("interface")
        {
            return "Directly visible to customers/users".to_string();
        }
        if name_lower.contains("database") || name_lower.contains("infrastructure") {
            return "Hidden infrastructure - not directly user-visible".to_string();
        }
        if name_lower.contains("api") || name_lower.contains("service") {
            return "Integration layer - medium visibility".to_string();
        }
        format!("Positioned at {level} based on user exposure")
    }

    /// Read-only access to the pattern table, keyed by pattern name — used by
    /// `wardley-mapper`'s `create_map` to replicate
    /// `engine.patterns.get(comp_dict.get('name'))`.
    pub fn has_pattern(&self, name: &str) -> bool {
        self.patterns.iter().any(|(key, _)| *key == name)
    }
}

/// `get_heuristics_engine() -> HeuristicsEngine` — singleton factory in name only (the
/// Python version constructs a fresh engine on every call too; there is no actual
/// caching in the original).
pub fn get_heuristics_engine() -> HeuristicsEngine {
    HeuristicsEngine::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(pairs: &[(&str, bool)]) -> CompDict {
        let mut m = CompDict::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), Value::Bool(*v));
        }
        m
    }

    /// Matches the Python `__main__` demo's `test_components` list — asserts each
    /// falls in the same evolution-stage bucket the Python demo prints.
    #[test]
    fn score_component_matches_demo_buckets() {
        let engine = HeuristicsEngine::new();

        let (evo, vis) =
            engine.score_component("PostgreSQL Database", &ctx(&[("is_infrastructure", true)]));
        assert_eq!(HeuristicsEngine::score_to_stage(evo), "Commodity");
        assert!((vis - 0.15).abs() < 1e-9);

        let (evo, _vis) =
            engine.score_component("React Frontend", &ctx(&[("is_customer_facing", true)]));
        assert_eq!(HeuristicsEngine::score_to_stage(evo), "Product");

        let (evo, vis) = engine.score_component(
            "Custom Recommendation Engine",
            &ctx(&[("provides_competitive_advantage", true)]),
        );
        assert_eq!(HeuristicsEngine::score_to_stage(evo), "Custom");
        assert!((vis - 0.2).abs() < 1e-9); // "engine" substring -> low visibility

        let (evo, vis) =
            engine.score_component("AWS Hosting", &ctx(&[("is_infrastructure", true)]));
        assert_eq!(HeuristicsEngine::score_to_stage(evo), "Commodity");
        assert!((vis - 0.1).abs() < 1e-9);
    }

    #[test]
    fn export_rules_to_json_is_valid_and_complete() {
        let engine = HeuristicsEngine::new();
        let json_str = engine.export_rules_to_json();
        let parsed: Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed["rules_count"], 17);
        assert!(parsed["patterns"]["PostgreSQL"].is_object());
        assert_eq!(
            parsed["evolution_characteristics"]["genesis"]["ubiquity"],
            "Rare"
        );
    }

    #[test]
    fn no_pattern_no_context_defaults_to_midpoint() {
        let engine = HeuristicsEngine::new();
        let (evo, _vis) = engine.score_component("Totally Unknown Widget", &CompDict::new());
        assert_eq!(evo, 0.5);
    }
}
