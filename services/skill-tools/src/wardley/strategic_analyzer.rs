//! Port of `skills/wardley-maps/tools/strategic_analyzer.py`.
//!
//! `StrategicAnalyzer` walks a component/dependency list and generates strategic
//! insights: strengths, vulnerabilities, opportunities, threats, bottlenecks,
//! evolution-readiness, a critical path, and a set of recommendations.
//!
//! ## Critical bug found and fixed: the Python module cannot be imported at all
//!
//! ```python
//! class StrategicAnalyzer:
//!     def analyze(self, components: List[Dict], dependencies: List[Tuple[str, str]]) -> StrategicAnalysis:
//! ```
//! `StrategicAnalysis` is never defined anywhere in the file (only `MapAnalysis` is —
//! evidently the intended name, and what `analyze` actually constructs and returns).
//! Python evaluates function *annotations* at `def` time (no `from __future__ import
//! annotations` is present here), so this raises `NameError: name 'StrategicAnalysis'
//! is not defined` while the class body itself is being executed — i.e. **the module
//! fails to import**, unconditionally, every time. Verified directly:
//! `python3 strategic_analyzer.py` and `python3 wardley_mapper.py` (which imports
//! `from strategic_analyzer import analyze_wardley_map` at module scope) both crash
//! immediately with this `NameError` before any of their own code runs — the entire
//! `wardley_mapper.py` MCP tool, as committed, has never been able to start up.
//!
//! There is no reasonable Rust equivalent of "a module that cannot load" — this isn't
//! a runtime data-path bug we could silently no-op like the `quick_map.py` CSV branch,
//! it is dead-on-arrival source code. Per the brief's engineering-judgement guidance
//! for exactly this shape of issue (an evident typo with an unambiguous fix and no
//! sane crash-equivalent), we implement the obviously intended behaviour: `analyze`
//! returns [`MapAnalysis`]. Every other line of `analyze` and its twelve helper
//! methods is otherwise a straight, working port — the class body was correct except
//! for that one dangling type name.
//!
//! ## `export_analysis_to_markdown`: bound vs. unbound call site, ported literally
//!
//! ```python
//! def export_analysis_to_markdown(analysis: MapAnalysis) -> str:
//! ```
//! is a method with no `self` parameter and no `@staticmethod`. `wardley_mapper.py`
//! calls it unbound-style, `StrategicAnalyzer.export_analysis_to_markdown(analysis)`
//! (which works: no implicit `self` binding occurs through the class object) — never
//! through an instance. [`StrategicAnalyzer::export_analysis_to_markdown`] is ported
//! as an inherent associated function taking `&MapAnalysis` directly (no `&self`),
//! matching that real call site exactly.

use super::{CompDict, Dependency};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsightType {
    Strength,
    Vulnerability,
    Opportunity,
    Threat,
    Bottleneck,
    EvolutionReadiness,
}

impl InsightType {
    pub fn value(self) -> &'static str {
        match self {
            InsightType::Strength => "strength",
            InsightType::Vulnerability => "vulnerability",
            InsightType::Opportunity => "opportunity",
            InsightType::Threat => "threat",
            InsightType::Bottleneck => "bottleneck",
            InsightType::EvolutionReadiness => "evolution_readiness",
        }
    }
}

#[derive(Debug, Clone)]
pub struct StrategicInsight {
    pub insight_type: InsightType,
    pub component: String,
    pub title: String,
    pub description: String,
    pub impact: &'static str,
    pub actionable: bool,
    pub recommendation: Option<String>,
    #[allow(dead_code)]
    pub confidence: f64,
}

#[derive(Debug, Clone, Default)]
pub struct MapAnalysis {
    pub total_components: usize,
    pub total_dependencies: usize,
    pub insights: Vec<StrategicInsight>,
    pub vulnerabilities: Vec<String>,
    pub opportunities: Vec<String>,
    pub threats: Vec<String>,
    pub strategic_recommendations: Vec<String>,
    /// Insertion-ordered (Python dict preserves insertion order); a `Vec` of pairs
    /// avoids re-sorting or losing order the way a `HashMap` would.
    pub evolution_trajectory: Vec<(String, String)>,
    pub competitive_advantages: Vec<String>,
    pub critical_path: Vec<String>,
}

pub struct StrategicAnalyzer;

impl StrategicAnalyzer {
    /// `analyze(components, dependencies) -> MapAnalysis` (see module docs for the
    /// `-> StrategicAnalysis` NameError fix).
    pub fn analyze(components: &[CompDict], dependencies: &[Dependency]) -> MapAnalysis {
        let mut analysis = MapAnalysis {
            total_components: components.len(),
            total_dependencies: dependencies.len(),
            ..Default::default()
        };

        use super::strategic_analyzer_insights as insights;
        insights::identify_strengths(components, &mut analysis);
        insights::identify_vulnerabilities(components, dependencies, &mut analysis);
        insights::identify_opportunities(components, &mut analysis);
        insights::identify_threats(components, &mut analysis);
        insights::identify_bottlenecks(components, dependencies, &mut analysis);
        insights::assess_evolution_readiness(components, &mut analysis);
        insights::identify_critical_path(components, dependencies, &mut analysis);
        insights::generate_recommendations(components, &mut analysis);

        analysis
    }

    /// `export_analysis_to_markdown(analysis) -> str` — see module docs: this is an
    /// inherent associated function (no `&self`), matching the Python original's
    /// missing-`self` signature and its unbound `StrategicAnalyzer.export_analysis_to_markdown(analysis)`
    /// call site in `wardley_mapper.py`.
    pub fn export_analysis_to_markdown(analysis: &MapAnalysis) -> String {
        let mut lines: Vec<String> = vec![
            "# Wardley Map Strategic Analysis Report".to_string(),
            String::new(),
            "## Overview".to_string(),
            format!("- **Total Components**: {}", analysis.total_components),
            format!("- **Total Dependencies**: {}", analysis.total_dependencies),
            format!("- **Insights Generated**: {}", analysis.insights.len()),
            String::new(),
        ];

        if !analysis.competitive_advantages.is_empty() {
            lines.push("## Competitive Advantages".to_string());
            lines.push(format!(
                "Your organization has {} key differentiators:",
                analysis.competitive_advantages.len()
            ));
            lines.push(String::new());
            for adv in &analysis.competitive_advantages {
                lines.push(format!("- **{adv}**: Custom-built competitive moat"));
            }
            lines.push(String::new());
        }

        if !analysis.vulnerabilities.is_empty() {
            lines.push("## Vulnerabilities & Risks".to_string());
            lines.push(format!(
                "Identified {} critical vulnerabilities:",
                analysis.vulnerabilities.len()
            ));
            lines.push(String::new());
            for vuln in &analysis.vulnerabilities {
                lines.push(format!("- {vuln}"));
            }
            lines.push(String::new());
        }

        if !analysis.opportunities.is_empty() {
            lines.push("## Strategic Opportunities".to_string());
            lines.push(format!(
                "Found {} growth opportunities:",
                analysis.opportunities.len()
            ));
            lines.push(String::new());
            for opp in &analysis.opportunities {
                lines.push(format!("- **{opp}**: Market expansion opportunity"));
            }
            lines.push(String::new());
        }

        if !analysis.threats.is_empty() {
            lines.push("## Competitive Threats".to_string());
            lines.push(format!(
                "Identified {} areas under competitive pressure:",
                analysis.threats.len()
            ));
            lines.push(String::new());
            for threat in &analysis.threats {
                lines.push(format!("- {threat}"));
            }
            lines.push(String::new());
        }

        if !analysis.strategic_recommendations.is_empty() {
            lines.push("## Strategic Recommendations".to_string());
            lines.push(String::new());
            for (i, rec) in analysis.strategic_recommendations.iter().enumerate() {
                lines.push(format!("{}. {rec}", i + 1));
            }
            lines.push(String::new());
        }

        if !analysis.evolution_trajectory.is_empty() {
            lines.push("## Evolution Planning".to_string());
            lines.push("Components approaching next evolution stage:".to_string());
            lines.push(String::new());
            for (comp, trajectory) in &analysis.evolution_trajectory {
                lines.push(format!("- {comp}: {trajectory}"));
            }
            lines.push(String::new());
        }

        if !analysis.critical_path.is_empty() {
            // Minor formatting quirk in the Python original, verified by execution:
            // the list literal passed to `lines.extend([...])` here is
            //   ["## Critical Dependency Path",
            //    "Longest dependency chain (indicates execution complexity):",
            //    ""             <- note: no comma after this line
            //    f"```",
            //    " → ".join(analysis.critical_path),
            //    "```",
            //    ""]
            // The missing comma between the empty string `""` and `f"```"` makes
            // Python treat them as adjacent string-literal concatenation (`"" +
            // "```"` = `"```"`), silently merging away what looks like an intended
            // blank line before the opening code fence. Every *other* section in
            // this function does have a blank line before its content; this one
            // doesn't. We reproduce that exact (slightly inconsistent) output.
            lines.push("## Critical Dependency Path".to_string());
            lines.push("Longest dependency chain (indicates execution complexity):".to_string());
            lines.push("```".to_string());
            lines.push(analysis.critical_path.join(" → "));
            lines.push("```".to_string());
            lines.push(String::new());
        }

        lines.join("\n")
    }
}

/// `analyze_wardley_map(components, dependencies) -> MapAnalysis`
pub fn analyze_wardley_map(components: &[CompDict], dependencies: &[Dependency]) -> MapAnalysis {
    StrategicAnalyzer::analyze(components, dependencies)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comp(name: &str, visibility: f64, evolution: f64) -> CompDict {
        let mut c = CompDict::new();
        c.insert("name".into(), name.into());
        c.insert("visibility".into(), visibility.into());
        c.insert("evolution".into(), evolution.into());
        c
    }

    fn demo_data() -> (Vec<CompDict>, Vec<Dependency>) {
        let components = vec![
            comp("Customer Portal", 0.95, 0.7),
            comp("Recommendation Engine", 0.6, 0.35),
            comp("PostgreSQL Database", 0.1, 0.9),
            comp("Custom ML Model", 0.4, 0.2),
            comp("AWS Infrastructure", 0.05, 0.95),
        ];
        let dependencies = vec![
            (
                "Customer Portal".to_string(),
                "Recommendation Engine".to_string(),
            ),
            (
                "Recommendation Engine".to_string(),
                "Custom ML Model".to_string(),
            ),
            (
                "Custom ML Model".to_string(),
                "PostgreSQL Database".to_string(),
            ),
            (
                "PostgreSQL Database".to_string(),
                "AWS Infrastructure".to_string(),
            ),
        ];
        (components, dependencies)
    }

    #[test]
    fn analyze_produces_same_insight_shape_as_python_demo() {
        let (components, dependencies) = demo_data();
        let analysis = StrategicAnalyzer::analyze(&components, &dependencies);

        assert_eq!(analysis.total_components, 5);
        assert_eq!(analysis.total_dependencies, 4);
        assert!(!analysis.insights.is_empty());

        // Custom ML Model (evolution 0.2 < 0.25, visibility 0.4 >= ... ) contributes an
        // Opportunity (Market Disruption Potential) insight.
        assert!(analysis.insights.iter().any(
            |i| i.insight_type == InsightType::Opportunity && i.component == "Custom ML Model"
        ));

        // AWS Infrastructure (evolution 0.95, visibility 0.05) is pure commodity and
        // low-visibility: should not itself register as a strength.
        assert!(!analysis.insights.iter().any(
            |i| i.insight_type == InsightType::Strength && i.component == "AWS Infrastructure"
        ));

        // Critical path should start from the genesis-stage component.
        assert!(!analysis.critical_path.is_empty());
    }

    #[test]
    fn export_analysis_to_markdown_contains_expected_sections() {
        let (components, dependencies) = demo_data();
        let analysis = StrategicAnalyzer::analyze(&components, &dependencies);
        let md = StrategicAnalyzer::export_analysis_to_markdown(&analysis);

        assert!(md.starts_with("# Wardley Map Strategic Analysis Report"));
        assert!(md.contains("## Overview"));
        assert!(md.contains("**Total Components**: 5"));
    }

    #[test]
    fn analyze_wardley_map_free_function_matches_method() {
        let (components, dependencies) = demo_data();
        let a = analyze_wardley_map(&components, &dependencies);
        let b = StrategicAnalyzer::analyze(&components, &dependencies);
        assert_eq!(a.insights.len(), b.insights.len());
    }
}
