//! Direct port of `design_system.py`'s `DesignSystemGenerator` class.

use std::collections::HashMap;

use super::data::UI_REASONING_CSV;
use super::design_system::{Colors, DesignSystem, Pattern, Style, Typography};
use super::outcome::{OrderedRow, SearchOutcome};
use super::search_core::{load_csv, search};

/// Result of `_apply_reasoning`: the matched (or default) reasoning rule.
#[derive(Debug, Clone)]
struct Reasoning {
    pattern: String,
    style_priority: Vec<String>,
    #[allow(dead_code)] // ported for fidelity; unused by any formatter, exactly as in Python
    color_mood: String,
    typography_mood: String,
    key_effects: String,
    anti_patterns: String,
    severity: String,
}

impl Default for Reasoning {
    /// The fallback returned by `_apply_reasoning` when `_find_reasoning_rule` finds
    /// no matching row at all.
    fn default() -> Self {
        Self {
            pattern: "Hero + Features + CTA".to_string(),
            style_priority: vec!["Minimalism".to_string(), "Flat Design".to_string()],
            color_mood: "Professional".to_string(),
            typography_mood: "Clean".to_string(),
            key_effects: "Subtle hover transitions".to_string(),
            anti_patterns: String::new(),
            severity: "MEDIUM".to_string(),
        }
    }
}

/// `SEARCH_CONFIG` from `design_system.py`, in insertion order (`_multi_domain_search`
/// iterates it in this order — order itself has no behavioural effect here since each
/// domain search is independent, but it is preserved for read-alignment with the
/// Python source).
const SEARCH_CONFIG: &[(&str, usize)] = &[
    ("product", 1),
    ("style", 3),
    ("color", 2),
    ("landing", 2),
    ("typography", 2),
];

/// Generates design system recommendations from aggregated domain searches, matching
/// `design_system.py`'s `DesignSystemGenerator`.
pub struct DesignSystemGenerator {
    reasoning_data: Vec<HashMap<String, String>>,
}

impl Default for DesignSystemGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl DesignSystemGenerator {
    pub fn new() -> Self {
        Self {
            reasoning_data: load_csv(UI_REASONING_CSV),
        }
    }

    /// `_find_reasoning_rule`: exact match -> partial substring match -> keyword-split
    /// match, in that priority order; first match at each stage wins.
    fn find_reasoning_rule(&self, category: &str) -> Option<&HashMap<String, String>> {
        let category_lower = category.to_lowercase();

        // Stage 1: exact match.
        if let Some(rule) = self.reasoning_data.iter().find(|rule| {
            rule.get("UI_Category")
                .map(|c| c.to_lowercase() == category_lower)
                .unwrap_or(false)
        }) {
            return Some(rule);
        }

        // Stage 2: partial substring match (either direction).
        if let Some(rule) = self.reasoning_data.iter().find(|rule| {
            let ui_cat = rule
                .get("UI_Category")
                .map(|c| c.to_lowercase())
                .unwrap_or_default();
            ui_cat.contains(category_lower.as_str()) || category_lower.contains(ui_cat.as_str())
        }) {
            return Some(rule);
        }

        // Stage 3: keyword-split match — any whitespace-split keyword of the rule's
        // UI_Category (with '/' and '-' normalised to spaces first) found in the query
        // category string.
        self.reasoning_data.iter().find(|rule| {
            let ui_cat = rule
                .get("UI_Category")
                .map(|c| c.to_lowercase())
                .unwrap_or_default();
            let normalised = ui_cat.replace(['/', '-'], " ");
            normalised
                .split_whitespace()
                .any(|kw| category_lower.contains(kw))
        })
    }

    /// `_apply_reasoning`: apply a matched reasoning rule (or the hard-coded default).
    fn apply_reasoning(&self, category: &str) -> Reasoning {
        let Some(rule) = self.find_reasoning_rule(category) else {
            return Reasoning::default();
        };

        let style_priority = rule
            .get("Style_Priority")
            .map(|s| s.as_str())
            .unwrap_or("")
            .split('+')
            .map(|s| s.trim().to_string())
            .collect();

        Reasoning {
            pattern: rule.get("Recommended_Pattern").cloned().unwrap_or_default(),
            style_priority,
            color_mood: rule.get("Color_Mood").cloned().unwrap_or_default(),
            typography_mood: rule.get("Typography_Mood").cloned().unwrap_or_default(),
            key_effects: rule.get("Key_Effects").cloned().unwrap_or_default(),
            anti_patterns: rule.get("Anti_Patterns").cloned().unwrap_or_default(),
            severity: rule
                .get("Severity")
                .cloned()
                .unwrap_or_else(|| "MEDIUM".to_string()),
        }
    }

    /// `_multi_domain_search`: search product/style/color/landing/typography with
    /// per-domain result caps; for `style`, prepend up to 2 style-priority keywords to
    /// the query.
    fn multi_domain_search(
        &self,
        query: &str,
        style_priority: &[String],
    ) -> HashMap<&'static str, SearchOutcome> {
        let mut results = HashMap::new();
        for (domain, max_results) in SEARCH_CONFIG {
            let outcome = if *domain == "style" && !style_priority.is_empty() {
                let priority_query = style_priority
                    .iter()
                    .take(2)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ");
                let combined = format!("{query} {priority_query}");
                search(&combined, Some(domain), *max_results)
            } else {
                search(query, Some(domain), *max_results)
            };
            results.insert(*domain, outcome);
        }
        results
    }

    /// `_select_best_match`: pick the best style result for the priority keywords —
    /// exact style-name substring match first (in priority order), then a scored
    /// fallback (style name match > keyword field match > any-field match), else the
    /// first result.
    fn select_best_match(results: &[OrderedRow], priority_keywords: &[String]) -> OrderedRow {
        if results.is_empty() {
            return OrderedRow::default();
        }
        if priority_keywords.is_empty() {
            return results[0].clone();
        }

        for priority in priority_keywords {
            let priority_lower = priority.to_lowercase();
            let priority_lower = priority_lower.trim();
            for result in results {
                let style_name = result.get("Style Category").unwrap_or("").to_lowercase();
                if style_name.contains(priority_lower)
                    || priority_lower.contains(style_name.as_str())
                {
                    return result.clone();
                }
            }
        }

        let mut scored: Vec<(i32, &OrderedRow)> = results
            .iter()
            .map(|result| {
                let result_str = python_dict_repr(result).to_lowercase();
                let mut score = 0i32;
                for kw in priority_keywords {
                    let kw_lower = kw.to_lowercase();
                    let kw_lower = kw_lower.trim();
                    let style_name = result.get("Style Category").unwrap_or("").to_lowercase();
                    let keywords_field = result.get("Keywords").unwrap_or("").to_lowercase();
                    if style_name.contains(kw_lower) {
                        score += 10;
                    } else if keywords_field.contains(kw_lower) {
                        score += 3;
                    } else if result_str.contains(kw_lower) {
                        score += 1;
                    }
                }
                (score, result)
            })
            .collect();

        // Python's `list.sort(reverse=True)` is stable; Rust's `sort_by` is too.
        scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));

        match scored.first() {
            Some((score, result)) if *score > 0 => (*result).clone(),
            _ => results[0].clone(),
        }
    }

    /// `generate()`: build the complete design system recommendation.
    pub fn generate(&self, query: &str, project_name: Option<&str>) -> DesignSystem {
        // Step 1: search product to get category.
        let product_outcome = search(query, Some("product"), 1);
        let product_results = extract_results(&product_outcome);
        let category = product_results
            .first()
            .and_then(|r| r.get("Product Type"))
            .unwrap_or("General")
            .to_string();

        // Step 2: reasoning rules for this category.
        let reasoning = self.apply_reasoning(&category);

        // Step 3: multi-domain search with style-priority hints.
        let mut search_results = self.multi_domain_search(query, &reasoning.style_priority);
        search_results.insert("product", product_outcome);

        // Step 4: best matches per domain.
        let style_results = search_results
            .get("style")
            .map(extract_results)
            .unwrap_or_default();
        let color_results = search_results
            .get("color")
            .map(extract_results)
            .unwrap_or_default();
        let typography_results = search_results
            .get("typography")
            .map(extract_results)
            .unwrap_or_default();
        let landing_results = search_results
            .get("landing")
            .map(extract_results)
            .unwrap_or_default();

        let best_style = Self::select_best_match(&style_results, &reasoning.style_priority);
        let best_color = color_results.first().cloned().unwrap_or_default();
        let best_typography = typography_results.first().cloned().unwrap_or_default();
        let best_landing = landing_results.first().cloned().unwrap_or_default();

        // Step 5: combine effects (style search result wins over the reasoning default).
        let style_effects = best_style
            .get("Effects & Animation")
            .unwrap_or("")
            .to_string();
        let combined_effects = if !style_effects.is_empty() {
            style_effects.clone()
        } else {
            reasoning.key_effects.clone()
        };

        DesignSystem {
            project_name: project_name
                .map(|s| s.to_string())
                .unwrap_or_else(|| query.to_uppercase()),
            category,
            pattern: Pattern {
                name: best_landing
                    .get("Pattern Name")
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| reasoning.pattern.clone()),
                sections: best_landing
                    .get("Section Order")
                    .unwrap_or("Hero > Features > CTA")
                    .to_string(),
                cta_placement: best_landing
                    .get("Primary CTA Placement")
                    .unwrap_or("Above fold")
                    .to_string(),
                color_strategy: best_landing.get("Color Strategy").unwrap_or("").to_string(),
                conversion: best_landing
                    .get("Conversion Optimization")
                    .unwrap_or("")
                    .to_string(),
            },
            style: Style {
                name: best_style
                    .get("Style Category")
                    .unwrap_or("Minimalism")
                    .to_string(),
                type_: best_style.get("Type").unwrap_or("General").to_string(),
                effects: style_effects,
                keywords: best_style.get("Keywords").unwrap_or("").to_string(),
                best_for: best_style.get("Best For").unwrap_or("").to_string(),
                performance: best_style.get("Performance").unwrap_or("").to_string(),
                accessibility: best_style.get("Accessibility").unwrap_or("").to_string(),
            },
            colors: Colors {
                primary: best_color
                    .get("Primary (Hex)")
                    .unwrap_or("#2563EB")
                    .to_string(),
                secondary: best_color
                    .get("Secondary (Hex)")
                    .unwrap_or("#3B82F6")
                    .to_string(),
                cta: best_color.get("CTA (Hex)").unwrap_or("#F97316").to_string(),
                background: best_color
                    .get("Background (Hex)")
                    .unwrap_or("#F8FAFC")
                    .to_string(),
                text: best_color
                    .get("Text (Hex)")
                    .unwrap_or("#1E293B")
                    .to_string(),
                notes: best_color.get("Notes").unwrap_or("").to_string(),
            },
            typography: Typography {
                heading: best_typography
                    .get("Heading Font")
                    .unwrap_or("Inter")
                    .to_string(),
                body: best_typography
                    .get("Body Font")
                    .unwrap_or("Inter")
                    .to_string(),
                mood: best_typography
                    .get("Mood/Style Keywords")
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| reasoning.typography_mood.clone()),
                best_for: best_typography.get("Best For").unwrap_or("").to_string(),
                google_fonts_url: best_typography
                    .get("Google Fonts URL")
                    .unwrap_or("")
                    .to_string(),
                css_import: best_typography.get("CSS Import").unwrap_or("").to_string(),
            },
            key_effects: combined_effects,
            anti_patterns: reasoning.anti_patterns,
            severity: reasoning.severity,
        }
    }
}

fn extract_results(outcome: &SearchOutcome) -> Vec<OrderedRow> {
    match outcome {
        SearchOutcome::Domain { results, .. } => results.clone(),
        SearchOutcome::Stack { results, .. } => results.clone(),
        _ => Vec::new(),
    }
}

/// Rough equivalent of Python's `str(dict)` for an `OrderedRow`, e.g.
/// `{'Style Category': 'Glassmorphism', 'Keywords': 'blur'}`. Used only as the
/// lowest-priority "any field contains this keyword" fallback in
/// `_select_best_match`; Python builds this from `str(result)` where `result` is the
/// row dict, so key order (== `output_cols` order) and the `'key': 'value'` shape are
/// reproduced. Values containing an embedded single quote would make Python switch to
/// double-quoted repr — that edge case is not replicated (single-quote reprs only),
/// since it can only ever change which substring matches at the *weakest* fallback
/// tier of an already-heuristic scorer.
fn python_dict_repr(row: &OrderedRow) -> String {
    let mut out = String::from("{");
    for (i, (k, v)) in row.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push('\'');
        out.push_str(k);
        out.push_str("': '");
        out.push_str(v);
        out.push('\'');
    }
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_saas_dashboard_end_to_end() {
        let generator = DesignSystemGenerator::new();
        let ds = generator.generate("SaaS dashboard", Some("Test"));
        assert_eq!(ds.project_name, "Test");
        assert!(!ds.style.name.is_empty());
        assert!(!ds.colors.primary.is_empty());
        assert!(!ds.typography.heading.is_empty());
        // Cross-checked against `python3 design_system.py "SaaS dashboard" -p Test`:
        // style => Flat Design, colors.primary => #6366F1, typography => Fira Code / Fira Sans.
        assert_eq!(ds.style.name, "Flat Design");
        assert_eq!(ds.colors.primary, "#6366F1");
        assert_eq!(ds.typography.heading, "Fira Code");
        assert_eq!(ds.typography.body, "Fira Sans");
        assert_eq!(ds.pattern.name, "Minimal & Direct + Demo");
        assert_eq!(
            ds.anti_patterns,
            "Complex onboarding flow + Cluttered layout"
        );
    }

    #[test]
    fn generate_uses_uppercased_query_when_no_project_name() {
        let generator = DesignSystemGenerator::new();
        let ds = generator.generate("fintech app", None);
        assert_eq!(ds.project_name, "FINTECH APP");
    }

    #[test]
    fn select_best_match_returns_default_for_empty_results() {
        let best = DesignSystemGenerator::select_best_match(&[], &["Minimalism".to_string()]);
        assert_eq!(best, OrderedRow::default());
    }

    #[test]
    fn select_best_match_returns_first_when_no_priority_keywords() {
        let row = OrderedRow(vec![(
            "Style Category".to_string(),
            "Brutalism".to_string(),
        )]);
        let best = DesignSystemGenerator::select_best_match(std::slice::from_ref(&row), &[]);
        assert_eq!(best, row);
    }

    #[test]
    fn select_best_match_prefers_exact_style_name_substring() {
        let glass = OrderedRow(vec![
            ("Style Category".to_string(), "Glassmorphism".to_string()),
            ("Keywords".to_string(), "blur".to_string()),
        ]);
        let flat = OrderedRow(vec![
            ("Style Category".to_string(), "Flat Design".to_string()),
            ("Keywords".to_string(), "simple".to_string()),
        ]);
        let results = vec![flat.clone(), glass.clone()];
        let best =
            DesignSystemGenerator::select_best_match(&results, &["Glassmorphism".to_string()]);
        assert_eq!(best, glass);
    }
}
