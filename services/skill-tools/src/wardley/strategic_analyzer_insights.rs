//! Strategic-insight identification logic for [`super::strategic_analyzer`], split
//! out of `strategic_analyzer.rs` to keep that file under the 500-line guideline.
//! Ported from `strategic_analyzer.py`'s `_identify_*` / `_assess_*` /
//! `_generate_recommendations` methods and their private graph-traversal helpers
//! (`_build_dependency_graph`, `_build_reverse_dependency_graph`,
//! `_dfs_longest_path`, `_stage_label`). These were all instance methods on
//! `StrategicAnalyzer` in the Python original (never using `self` for anything but
//! method dispatch — `StrategicAnalyzer` carries no state) and on the analogous
//! `impl StrategicAnalyzer` block before this split; they are plain functions here,
//! called from [`super::strategic_analyzer::StrategicAnalyzer::analyze`].

use super::strategic_analyzer::{InsightType, MapAnalysis, StrategicInsight};
use super::{CompDict, Dependency};
use std::collections::{HashMap, HashSet};

pub(super) fn identify_strengths(components: &[CompDict], analysis: &mut MapAnalysis) {
    for comp in components {
        let name = super::get_str(comp, "name", "");
        let evolution = super::get_f64(comp, "evolution", 0.5);
        let visibility = super::get_f64(comp, "visibility", 0.5);

        if (0.25..=0.55).contains(&evolution) && visibility >= 0.4 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Strength,
                component: name.clone(),
                title: format!("{name}: Core Competitive Advantage"),
                description: format!(
                    "Custom-built component at {} stage. This is a key differentiator that competitors cannot easily replicate.",
                    stage_label(evolution)
                ),
                impact: "high",
                actionable: false,
                recommendation: Some(format!(
                    "Protect and continuously improve {name}. Monitor for commoditization signals."
                )),
                confidence: 0.85,
            });
            analysis.competitive_advantages.push(name.clone());
        }

        if evolution < 0.25 && visibility >= 0.5 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Strength,
                component: name.clone(),
                title: format!("{name}: Innovation Leader"),
                description: format!(
                    "Genesis-stage innovation in {name}. This represents your capability to drive market disruption."
                ),
                impact: "high",
                actionable: false,
                recommendation: Some(format!(
                    "Invest in scaling and productizing {name} quickly to capitalize on first-mover advantage."
                )),
                confidence: 0.9,
            });
            analysis.competitive_advantages.push(name);
        }
    }
}

pub(super) fn identify_vulnerabilities(
    components: &[CompDict],
    dependencies: &[Dependency],
    analysis: &mut MapAnalysis,
) {
    let dep_graph = build_dependency_graph(dependencies);

    for comp in components {
        let name = super::get_str(comp, "name", "");
        let visibility = super::get_f64(comp, "visibility", 0.5);
        let evolution = super::get_f64(comp, "evolution", 0.5);
        let deps = dep_graph.get(&name).cloned().unwrap_or_default();

        if visibility >= 0.7 {
            for dep_target in &deps {
                if let Some(target_comp) = components
                    .iter()
                    .find(|c| super::get_str(c, "name", "") == *dep_target)
                {
                    if super::get_f64(target_comp, "evolution", 0.5) >= 0.8 {
                        analysis.insights.push(StrategicInsight {
                            insight_type: InsightType::Vulnerability,
                            component: name.clone(),
                            title: format!("{name}: Infrastructure Risk"),
                            description: format!(
                                "{name} is a high-value component that depends on {dep_target}, a commodity component. Commodity components are subject to price compression, feature commoditization, and vendor lock-in risks."
                            ),
                            impact: "high",
                            actionable: true,
                            recommendation: Some(format!(
                                "Evaluate alternative providers for {dep_target} or develop in-house capability to reduce dependency."
                            )),
                            confidence: 0.8,
                        });
                        analysis
                            .vulnerabilities
                            .push(format!("{name} → {dep_target}"));
                    }
                }
            }
        }

        if (0.25..=0.55).contains(&evolution) && !deps.is_empty() {
            let providers: HashSet<&String> = deps.iter().collect();
            if providers.len() == 1 {
                let only = deps[0].clone();
                analysis.insights.push(StrategicInsight {
                    insight_type: InsightType::Vulnerability,
                    component: name.clone(),
                    title: format!("{name}: Single Point of Failure"),
                    description: format!(
                        "{name} is a critical custom component with a single dependency: {only}. This creates supply chain risk."
                    ),
                    impact: "medium",
                    actionable: true,
                    recommendation: Some(format!(
                        "Diversify dependencies for {name} by introducing redundancy or alternatives."
                    )),
                    confidence: 0.75,
                });
                analysis
                    .vulnerabilities
                    .push(format!("{name}: Single source - {only}"));
            }
        }
    }
}

pub(super) fn identify_opportunities(components: &[CompDict], analysis: &mut MapAnalysis) {
    for comp in components {
        let name = super::get_str(comp, "name", "");
        let evolution = super::get_f64(comp, "evolution", 0.5);
        let visibility = super::get_f64(comp, "visibility", 0.5);

        if (0.4..=0.55).contains(&evolution) && visibility >= 0.4 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Opportunity,
                component: name.clone(),
                title: format!("{name}: Commoditization Opportunity"),
                description: format!(
                    "{name} is a mature custom component approaching the product stage. This is an opportunity to package it as a standalone product or service offering."
                ),
                impact: "high",
                actionable: true,
                recommendation: Some(format!(
                    "Evaluate productizing {name} as a separate offering or licensing it to partners."
                )),
                confidence: 0.8,
            });
            analysis.opportunities.push(name.clone());
        }

        if evolution < 0.25 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Opportunity,
                component: name.clone(),
                title: format!("{name}: Market Disruption Potential"),
                description: format!(
                    "{name} is a genesis-stage innovation. This represents an untapped market opportunity before competitors enter."
                ),
                impact: "high",
                actionable: true,
                recommendation: Some(format!(
                    "Accelerate development and market entry for {name} to establish market leadership."
                )),
                confidence: 0.85,
            });
            analysis.opportunities.push(name.clone());
        }

        if evolution >= 0.85 && visibility >= 0.7 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Opportunity,
                component: name.clone(),
                title: format!("{name}: Expansion Opportunity"),
                description: format!(
                    "{name} is a mature, customer-facing component. This is an opportunity to expand feature set or enter adjacent markets."
                ),
                impact: "medium",
                actionable: true,
                recommendation: Some(format!("Identify adjacent use cases and markets for {name} expansion.")),
                confidence: 0.75,
            });
            analysis.opportunities.push(format!("{name} (expansion)"));
        }
    }
}

pub(super) fn identify_threats(components: &[CompDict], analysis: &mut MapAnalysis) {
    for comp in components {
        let name = super::get_str(comp, "name", "");
        let evolution = super::get_f64(comp, "evolution", 0.5);

        if (0.3..=0.45).contains(&evolution) {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Threat,
                component: name.clone(),
                title: format!("{name}: Commoditization Threat"),
                description: format!(
                    "{name} is transitioning from custom to product stage. Competitors may be developing similar solutions, threatening your competitive advantage."
                ),
                impact: "high",
                actionable: true,
                recommendation: Some(format!(
                    "Accelerate feature development and market education for {name} to maintain competitive lead."
                )),
                confidence: 0.8,
            });
            analysis.threats.push(name.clone());
        }

        if (0.55..0.8).contains(&evolution) {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Threat,
                component: name.clone(),
                title: format!("{name}: Increasing Competition"),
                description: format!(
                    "{name} is at product stage with multiple competitors likely entering the market. Margin compression is inevitable."
                ),
                impact: "medium",
                actionable: true,
                recommendation: Some(format!(
                    "Plan cost reduction and feature differentiation for {name} to compete on value, not just price."
                )),
                confidence: 0.75,
            });
            analysis.threats.push(format!("{name} (competition)"));
        }
    }
}

pub(super) fn identify_bottlenecks(
    components: &[CompDict],
    dependencies: &[Dependency],
    analysis: &mut MapAnalysis,
) {
    let reverse_dep_graph = build_reverse_dependency_graph(dependencies);

    for comp in components {
        let name = super::get_str(comp, "name", "");
        let evolution = super::get_f64(comp, "evolution", 0.5);
        let dependents = reverse_dep_graph.get(&name).cloned().unwrap_or_default();

        if dependents.len() >= 3 && evolution < 0.7 {
            analysis.insights.push(StrategicInsight {
                insight_type: InsightType::Bottleneck,
                component: name.clone(),
                title: format!("{name}: Critical Bottleneck"),
                description: format!(
                    "{name} is a critical infrastructure component that {} other components depend on. Its unstable nature ({}) creates system-wide risk.",
                    dependents.len(),
                    stage_label(evolution)
                ),
                impact: "high",
                actionable: true,
                recommendation: Some(format!(
                    "Stabilize and harden {name}. Consider introducing redundancy or failover mechanisms."
                )),
                confidence: 0.85,
            });
        }
    }
}

pub(super) fn assess_evolution_readiness(components: &[CompDict], analysis: &mut MapAnalysis) {
    for comp in components {
        let name = super::get_str(comp, "name", "");
        let evolution = super::get_f64(comp, "evolution", 0.5);

        let (current, stage_target) = if evolution < 0.25 {
            ("Genesis", "Product")
        } else if evolution < 0.55 {
            ("Custom", "Product")
        } else if evolution < 0.8 {
            ("Product", "Commodity")
        } else {
            continue;
        };

        analysis.insights.push(StrategicInsight {
            insight_type: InsightType::EvolutionReadiness,
            component: name.clone(),
            title: format!("{name}: Evolution Path {current} → {stage_target}"),
            description: format!(
                "{name} is approaching maturity for evolution to {stage_target}. Preparation should begin now."
            ),
            impact: "medium",
            actionable: true,
            recommendation: Some(format!(
                "Start preparing {name} for evolution to {stage_target}: standardize interfaces, increase reliability, reduce cost."
            )),
            confidence: 0.8,
        });
        analysis
            .evolution_trajectory
            .push((name, format!("{current} → {stage_target}")));
    }
}

pub(super) fn identify_critical_path(
    components: &[CompDict],
    dependencies: &[Dependency],
    analysis: &mut MapAnalysis,
) {
    let dep_graph = build_dependency_graph(dependencies);
    let mut longest_paths: Vec<Vec<String>> = Vec::new();

    for comp in components {
        let evolution = super::get_f64(comp, "evolution", 0.5);
        if evolution < 0.25 {
            let name = super::get_str(comp, "name", "");
            let path = dfs_longest_path(&name, &dep_graph, &mut HashSet::new());
            if !path.is_empty() {
                longest_paths.push(path);
            }
        }
    }

    if !longest_paths.is_empty() {
        // `sort(key=len, reverse=True)`: stable descending sort by length.
        longest_paths.sort_by_key(|p| std::cmp::Reverse(p.len()));
        analysis.critical_path = longest_paths.into_iter().next().unwrap();
    }
}

pub(super) fn generate_recommendations(components: &[CompDict], analysis: &mut MapAnalysis) {
    let mut recommendations = Vec::new();

    let genesis_comps: Vec<&CompDict> = components
        .iter()
        .filter(|c| super::get_f64(c, "evolution", 0.5) < 0.25)
        .collect();
    if !genesis_comps.is_empty() {
        let names: Vec<String> = genesis_comps
            .iter()
            .take(3)
            .map(|c| super::get_str(c, "name", ""))
            .collect();
        recommendations.push(format!(
            "INNOVATION LEADERSHIP: Accelerate development of genesis-stage innovations ({}) to establish market leadership before competitors enter.",
            names.join(", ")
        ));
    }

    let custom_comps: Vec<&CompDict> = components
        .iter()
        .filter(|c| {
            let e = super::get_f64(c, "evolution", 0.5);
            (0.25..=0.55).contains(&e) && super::get_f64(c, "visibility", 0.5) >= 0.4
        })
        .collect();
    if !custom_comps.is_empty() {
        let names: Vec<String> = custom_comps
            .iter()
            .take(3)
            .map(|c| super::get_str(c, "name", ""))
            .collect();
        recommendations.push(format!(
            "COMPETITIVE MOAT: Protect your custom differentiators ({}) from commoditization through continuous innovation and network effects.",
            names.join(", ")
        ));
    }

    let commodity_deps_present = components.iter().any(|c| {
        let name = super::get_str(c, "name", "");
        let visibility = super::get_f64(c, "visibility", 0.5);
        visibility >= 0.7 && analysis.vulnerabilities.iter().any(|d| d.contains(&name))
    });
    if commodity_deps_present {
        recommendations.push(
            "SUPPLY CHAIN RESILIENCE: Diversify or develop in-house alternatives for critical commodity dependencies to reduce vendor lock-in risk."
                .to_string(),
        );
    }

    let product_ready: Vec<&CompDict> = components
        .iter()
        .filter(|c| (0.4..=0.55).contains(&super::get_f64(c, "evolution", 0.5)))
        .collect();
    if !product_ready.is_empty() {
        let names: Vec<String> = product_ready
            .iter()
            .take(3)
            .map(|c| super::get_str(c, "name", ""))
            .collect();
        recommendations.push(format!(
            "NEW REVENUE STREAMS: Evaluate productizing mature custom components ({}) for external monetization.",
            names.join(", ")
        ));
    }

    if !analysis.evolution_trajectory.is_empty() {
        recommendations.push(
            "EVOLUTIONARY PLANNING: Begin preparation for components approaching next evolution stage. Standardize interfaces, increase reliability, optimize cost."
                .to_string(),
        );
    }

    analysis.strategic_recommendations = recommendations;
}

pub(super) fn build_dependency_graph(dependencies: &[Dependency]) -> HashMap<String, Vec<String>> {
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    for (source, target) in dependencies {
        graph
            .entry(source.clone())
            .or_default()
            .push(target.clone());
    }
    graph
}

pub(super) fn build_reverse_dependency_graph(
    dependencies: &[Dependency],
) -> HashMap<String, Vec<String>> {
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    for (source, target) in dependencies {
        graph
            .entry(target.clone())
            .or_default()
            .push(source.clone());
    }
    graph
}

/// `_dfs_longest_path(start, graph, components, visited=None) -> List[str]`
/// (the `components` parameter is accepted but never used in the Python
/// original, so it is dropped here).
pub(super) fn dfs_longest_path(
    start: &str,
    graph: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
) -> Vec<String> {
    if visited.contains(start) {
        return vec![start.to_string()];
    }
    let mut visited = visited.clone();
    visited.insert(start.to_string());

    let Some(neighbors) = graph.get(start).filter(|n| !n.is_empty()) else {
        return vec![start.to_string()];
    };

    let mut longest = vec![start.to_string()];
    for neighbor in neighbors {
        let path = dfs_longest_path(neighbor, graph, &mut visited);
        if path.len() + 1 > longest.len() {
            let mut new_longest = vec![start.to_string()];
            new_longest.extend(path);
            longest = new_longest;
        }
    }
    longest
}

pub(super) fn stage_label(evolution: f64) -> &'static str {
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
