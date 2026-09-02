//! Port of `skills/wardley-maps/tools/interactive_map_generator.py`.
//!
//! `InteractiveMapGenerator` renders a full D3.js force-directed interactive Wardley
//! map: pan/zoom, drag, hover tooltips, click-to-pin info panel, evolution-stage and
//! insight-type filters.
//!
//! ## Critical bug found and fixed (not merely replicated)
//!
//! The Python original's `_generate_d3_html` embeds the component/link data with:
//! ```python
//! const data = {{{json.dumps({'nodes': components, 'links': links})}}};
//! ```
//! In an f-string, `{{` and `}}` are literal braces, so `{{{X}}}` renders as a literal
//! `{` + the *string value* of `X` (which is itself already a complete `{...}` JSON
//! object from `json.dumps`) + a literal `}` — i.e. **the whole object gets wrapped in
//! an extra, spurious pair of braces**: `const data = {{"nodes": [...], "links":
//! [...]}};`. That is not valid JavaScript. Verified two ways: (1) running the actual
//! Python function and regex-extracting the `const data = ...;` line shows the literal
//! double-brace text; (2) feeding that exact text to `node -e` throws `SyntaxError:
//! Unexpected token '{'`. In other words, **every interactive map this tool has ever
//! generated is non-functional in a real browser** — the embedded `<script>` fails to
//! parse before a single line of the D3 rendering code runs, so the page loads a blank
//! `<svg>` with dead controls.
//!
//! This is unlike the `quick_map.py` bugs (which are silent no-ops caught by a bare
//! `except`, and which the port brief explicitly asks to reproduce as-is) or the
//! `advanced_nlp_parse` simple-line-format bug (an *uncaught* Python crash with no
//! sane Rust equivalent). This bug's blast radius is the entire feature working at
//! all, with an evident, unambiguous intended fix (drop the spurious outer brace
//! pair), so per the brief's engineering-judgement guidance for `advanced_nlp_parse`,
//! we implement the intended behaviour: a single `const data = {"nodes": [...],
//! "links": [...]};` JSON object, exactly what `json.dumps(...)` already produces on
//! its own. See the Wardley port report for the full before/after evidence.

use super::{interactive_template, interactive_template_script, CompDict, Dependency};
use serde_json::{json, Value};

/// Optional strategic-insight categorisation passed through to component styling
/// (`is_strength` / `is_vulnerability` / `is_opportunity` / `is_threat`), mirroring the
/// `strategic_insights: Optional[Dict]` parameter of `create_interactive_map`.
#[derive(Debug, Clone, Default)]
pub struct MapInsights {
    pub competitive_advantages: Vec<String>,
    pub vulnerabilities: Vec<String>,
    pub opportunities: Vec<String>,
    pub threats: Vec<String>,
}

impl MapInsights {
    /// Parse from the loose `{"competitive_advantages": [...], ...}` JSON shape used
    /// by the `wardley-mapper` `create_interactive_map` request `params.insights`.
    pub fn from_value(v: &Value) -> Self {
        let strs = |key: &str| -> Vec<String> {
            v.get(key)
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        MapInsights {
            competitive_advantages: strs("competitive_advantages"),
            vulnerabilities: strs("vulnerabilities"),
            opportunities: strs("opportunities"),
            threats: strs("threats"),
        }
    }
}

/// Generates interactive Wardley Maps with D3.js.
pub struct InteractiveMapGenerator {
    pub width: i64,
    pub height: i64,
}

impl Default for InteractiveMapGenerator {
    /// `InteractiveMapGenerator(width=1200, height=800)`. (Python's `self.margin`
    /// dict is set in `__init__` but never read anywhere else in the class — dead
    /// state — so it is not reproduced here.)
    fn default() -> Self {
        Self {
            width: 1200,
            height: 800,
        }
    }
}

impl InteractiveMapGenerator {
    /// `create_interactive_map(components, dependencies, strategic_insights=None) -> str`
    pub fn create_interactive_map(
        &self,
        components: &[CompDict],
        dependencies: &[Dependency],
        strategic_insights: Option<&MapInsights>,
    ) -> String {
        let component_data = self.prepare_component_data(components, strategic_insights);
        let link_data = Self::prepare_link_data(dependencies);
        self.generate_d3_html(component_data, link_data)
    }

    fn prepare_component_data(
        &self,
        components: &[CompDict],
        insights: Option<&MapInsights>,
    ) -> Vec<Value> {
        let empty = MapInsights::default();
        let insights = insights.unwrap_or(&empty);

        components
            .iter()
            .map(|comp| {
                let name = super::get_str(comp, "name", "");
                let visibility = super::get_f64(comp, "visibility", 0.5);
                let evolution = super::get_f64(comp, "evolution", 0.5);
                let description = super::get_str(comp, "description", "");
                let category = super::get_str(comp, "category", "Unknown");
                let comp_insights = comp
                    .get("insights")
                    .cloned()
                    .unwrap_or_else(|| Value::Array(vec![]));

                let is_strength = insights.competitive_advantages.iter().any(|s| s == &name);
                // `any(comp['name'] in v for v in vulnerabilities)`: substring test of
                // the component name *within* each vulnerability string, not list
                // membership (deliberately asymmetric vs. the other three flags).
                let is_vulnerability = insights.vulnerabilities.iter().any(|v| v.contains(&name));
                let is_opportunity = insights.opportunities.iter().any(|s| s == &name);
                let is_threat = insights.threats.iter().any(|s| s == &name);

                json!({
                    "id": name,
                    "name": name,
                    "visibility": visibility,
                    "evolution": evolution,
                    "description": description,
                    "category": category,
                    "insights": comp_insights,
                    "is_strength": is_strength,
                    "is_vulnerability": is_vulnerability,
                    "is_opportunity": is_opportunity,
                    "is_threat": is_threat,
                    "evolution_stage": Self::evolution_stage(evolution),
                    "visibility_level": Self::visibility_level(visibility),
                })
            })
            .collect()
    }

    fn prepare_link_data(dependencies: &[Dependency]) -> Vec<Value> {
        dependencies
            .iter()
            .map(|(source, target)| json!({"source": source, "target": target, "type": "dependency"}))
            .collect()
    }

    fn evolution_stage(evolution: f64) -> &'static str {
        if evolution < 0.25 {
            "Genesis"
        } else if evolution < 0.55 {
            "Custom"
        } else if evolution < 0.8 {
            "Product"
        } else {
            "Commodity"
        }
    }

    fn visibility_level(visibility: f64) -> &'static str {
        if visibility < 0.35 {
            "Low"
        } else if visibility < 0.65 {
            "Medium"
        } else {
            "High"
        }
    }

    fn generate_d3_html(&self, components: Vec<Value>, links: Vec<Value>) -> String {
        let data = json!({"nodes": components, "links": links});
        let data_str = serde_json::to_string(&data)
            .unwrap_or_else(|_| "{\"nodes\":[],\"links\":[]}".to_string());

        let mut out = String::with_capacity(
            interactive_template::HTML_HEAD.len()
                + data_str.len()
                + interactive_template_script::HTML_TAIL.len(),
        );
        out.push_str(interactive_template::HTML_HEAD);
        // Fixed (see module docs): a single JSON object, not the Python original's
        // spurious double-brace wrap.
        out.push_str(&data_str);
        out.push_str(interactive_template_script::HTML_TAIL);
        out
    }
}

/// `create_interactive_wardley_map(components, dependencies, insights=None) -> str`
pub fn create_interactive_wardley_map(
    components: &[CompDict],
    dependencies: &[Dependency],
    insights: Option<&MapInsights>,
) -> String {
    InteractiveMapGenerator::default().create_interactive_map(components, dependencies, insights)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comp(name: &str, visibility: f64, evolution: f64, category: &str) -> CompDict {
        let mut c = CompDict::new();
        c.insert("name".into(), name.into());
        c.insert("visibility".into(), visibility.into());
        c.insert("evolution".into(), evolution.into());
        c.insert("category".into(), category.into());
        c
    }

    #[test]
    fn produces_valid_json_data_block_not_double_braced() {
        let components = vec![comp("Customer Portal", 0.95, 0.7, "Frontend")];
        let html = create_interactive_wardley_map(&components, &[], None);

        // The fixed embed should NOT contain the broken double-brace pattern that
        // made the Python original's script unparseable (`{{"..."` right after
        // `const data = `), regardless of which JSON key happens to serialise first
        // (this crate's `serde_json` has no `preserve_order` feature, so object keys
        // serialise alphabetically rather than in Python's insertion order — see the
        // module docs).
        assert!(!html.contains("const data = {{"));

        let start = html.find("const data = ").unwrap() + "const data = ".len();
        let end = html[start..]
            .find(";\n")
            .map(|i| start + i)
            .unwrap_or(html.len());
        let data_str = &html[start..end];
        let parsed: Value =
            serde_json::from_str(data_str).expect("embedded data must be valid JSON");
        assert_eq!(parsed["nodes"][0]["name"], "Customer Portal");
        assert!(parsed["links"].is_array());
    }

    #[test]
    fn html_contains_component_names_and_svg_scaffold() {
        let components = vec![
            comp("Customer Portal", 0.95, 0.7, "Frontend"),
            comp("PostgreSQL Database", 0.1, 0.9, "Database"),
        ];
        let deps = vec![(
            "Customer Portal".to_string(),
            "PostgreSQL Database".to_string(),
        )];
        let html = create_interactive_wardley_map(&components, &deps, None);
        assert!(html.contains("<svg"));
        assert!(html.contains("<html"));
        assert!(html.contains("Customer Portal"));
        assert!(html.contains("PostgreSQL Database"));
        assert!(html.contains("d3.v7.min.js"));
    }

    #[test]
    fn vulnerability_flag_is_substring_match_others_are_exact() {
        let components = vec![comp("API Gateway", 0.6, 0.5, "Integration")];
        let insights = MapInsights {
            competitive_advantages: vec![],
            vulnerabilities: vec!["API Gateway → Legacy DB".to_string()],
            opportunities: vec![],
            threats: vec![],
        };
        let html = create_interactive_wardley_map(&components, &[], Some(&insights));
        let start = html.find("const data = ").unwrap() + "const data = ".len();
        let end = html[start..]
            .find(";\n")
            .map(|i| start + i)
            .unwrap_or(html.len());
        let parsed: Value = serde_json::from_str(&html[start..end]).unwrap();
        assert_eq!(parsed["nodes"][0]["is_vulnerability"], true);
    }
}
