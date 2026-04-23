#!/usr/bin/env python3
"""
Strategic Analysis Module for Wardley Maps
Automatically generates strategic insights based on map structure
Identifies strengths, weaknesses, opportunities, and threats
"""

from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum
import json

class InsightType(Enum):
    """Types of strategic insights"""
    STRENGTH = "strength"
    VULNERABILITY = "vulnerability"
    OPPORTUNITY = "opportunity"
    THREAT = "threat"
    BOTTLENECK = "bottleneck"
    EVOLUTION_READINESS = "evolution_readiness"

@dataclass
class StrategicInsight:
    """Represents a strategic insight from the map"""
    type: InsightType
    component: str
    title: str
    description: str
    impact: str  # high, medium, low
    actionable: bool
    recommendation: Optional[str] = None
    confidence: float = 0.8

@dataclass
class MapAnalysis:
    """Complete strategic analysis of a Wardley Map"""
    total_components: int
    total_dependencies: int
    insights: List[StrategicInsight] = field(default_factory=list)
    vulnerabilities: List[str] = field(default_factory=list)
    opportunities: List[str] = field(default_factory=list)
    threats: List[str] = field(default_factory=list)
    strategic_recommendations: List[str] = field(default_factory=list)
    evolution_trajectory: Dict[str, str] = field(default_factory=dict)
    competitive_advantages: List[str] = field(default_factory=list)
    critical_path: List[str] = field(default_factory=list)

class StrategicAnalyzer:
    """Analyzes Wardley Maps to generate strategic insights"""

    def analyze(self, components: List[Dict], dependencies: List[Tuple[str, str]]) -> StrategicAnalysis:
        """
        Analyze a Wardley Map and generate strategic insights

        Args:
            components: List of component dicts with name, visibility, evolution
            dependencies: List of (source, target) dependency tuples

        Returns:
            Complete strategic analysis
        """
        analysis = MapAnalysis(
            total_components=len(components),
            total_dependencies=len(dependencies)
        )

        # Identify strengths (custom differentiators)
        self._identify_strengths(components, analysis)

        # Identify vulnerabilities (dependencies on changing components)
        self._identify_vulnerabilities(components, dependencies, analysis)

        # Identify opportunities (components ready for commoditization)
        self._identify_opportunities(components, analysis)

        # Identify threats (competitive pressures, commoditization)
        self._identify_threats(components, analysis)

        # Identify bottlenecks
        self._identify_bottlenecks(components, dependencies, analysis)

        # Determine evolution readiness
        self._assess_evolution_readiness(components, analysis)

        # Identify critical path
        self._identify_critical_path(components, dependencies, analysis)

        # Generate strategic recommendations
        self._generate_recommendations(components, dependencies, analysis)

        return analysis

    def _identify_strengths(self, components: List[Dict], analysis: MapAnalysis):
        """Identify competitive strengths (custom stage, high visibility differentiators)"""
        for comp in components:
            name = comp['name']
            evolution = comp['evolution']
            visibility = comp['visibility']

            # Custom stage components with significant visibility = strengths
            if 0.25 <= evolution <= 0.55 and visibility >= 0.4:
                insight = StrategicInsight(
                    type=InsightType.STRENGTH,
                    component=name,
                    title=f"{name}: Core Competitive Advantage",
                    description=f"Custom-built component at {self._stage_label(evolution)} stage. "
                               f"This is a key differentiator that competitors cannot easily replicate.",
                    impact="high",
                    actionable=False,
                    recommendation=f"Protect and continuously improve {name}. Monitor for commoditization signals.",
                    confidence=0.85
                )
                analysis.insights.append(insight)
                analysis.competitive_advantages.append(name)

            # Genesis stage innovations with execution capability
            if evolution < 0.25 and visibility >= 0.5:
                insight = StrategicInsight(
                    type=InsightType.STRENGTH,
                    component=name,
                    title=f"{name}: Innovation Leader",
                    description=f"Genesis-stage innovation in {name}. This represents your capability "
                               f"to drive market disruption.",
                    impact="high",
                    actionable=False,
                    recommendation=f"Invest in scaling and productizing {name} quickly to capitalize on first-mover advantage.",
                    confidence=0.9
                )
                analysis.insights.append(insight)
                analysis.competitive_advantages.append(name)

    def _identify_vulnerabilities(self, components: List[Dict], dependencies: List[Tuple],
                                 analysis: MapAnalysis):
        """Identify vulnerabilities (high-value components dependent on moving platforms)"""
        # Build dependency graph
        dep_graph = self._build_dependency_graph(dependencies)

        for comp in components:
            name = comp['name']
            visibility = comp['visibility']
            evolution = comp['evolution']

            # High-visibility components dependent on commodity infrastructure
            if visibility >= 0.7:
                deps = dep_graph.get(name, [])
                for dep_target in deps:
                    # Find the dependency target in components
                    target_comp = next((c for c in components if c['name'] == dep_target), None)
                    if target_comp and target_comp['evolution'] >= 0.8:
                        insight = StrategicInsight(
                            type=InsightType.VULNERABILITY,
                            component=name,
                            title=f"{name}: Infrastructure Risk",
                            description=f"{name} is a high-value component that depends on {dep_target}, "
                                       f"a commodity component. Commodity components are subject to price compression, "
                                       f"feature commoditization, and vendor lock-in risks.",
                            impact="high",
                            actionable=True,
                            recommendation=f"Evaluate alternative providers for {dep_target} or develop "
                                          f"in-house capability to reduce dependency.",
                            confidence=0.8
                        )
                        analysis.insights.append(insight)
                        analysis.vulnerabilities.append(f"{name} → {dep_target}")

            # Custom components with single points of failure
            if 0.25 <= evolution <= 0.55:
                if len(deps) > 0:
                    # Check if all dependencies are on single provider
                    providers = set(deps)
                    if len(providers) == 1:
                        insight = StrategicInsight(
                            type=InsightType.VULNERABILITY,
                            component=name,
                            title=f"{name}: Single Point of Failure",
                            description=f"{name} is a critical custom component with a single dependency: "
                                       f"{list(providers)[0]}. This creates supply chain risk.",
                            impact="medium",
                            actionable=True,
                            recommendation=f"Diversify dependencies for {name} by introducing redundancy or alternatives.",
                            confidence=0.75
                        )
                        analysis.insights.append(insight)
                        analysis.vulnerabilities.append(f"{name}: Single source - {list(providers)[0]}")

    def _identify_opportunities(self, components: List[Dict], analysis: MapAnalysis):
        """Identify opportunities (components ready for commoditization, market expansion)"""
        for comp in components:
            name = comp['name']
            evolution = comp['evolution']
            visibility = comp['visibility']

            # Custom stage approaching product stage = commoditization opportunity
            if 0.4 <= evolution <= 0.55 and visibility >= 0.4:
                insight = StrategicInsight(
                    type=InsightType.OPPORTUNITY,
                    component=name,
                    title=f"{name}: Commoditization Opportunity",
                    description=f"{name} is a mature custom component approaching the product stage. "
                               f"This is an opportunity to package it as a standalone product or service offering.",
                    impact="high",
                    actionable=True,
                    recommendation=f"Evaluate productizing {name} as a separate offering or licensing it to partners.",
                    confidence=0.8
                )
                analysis.insights.append(insight)
                analysis.opportunities.append(name)

            # Genesis stage innovation = market opportunity
            if evolution < 0.25:
                insight = StrategicInsight(
                    type=InsightType.OPPORTUNITY,
                    component=name,
                    title=f"{name}: Market Disruption Potential",
                    description=f"{name} is a genesis-stage innovation. This represents an untapped market opportunity "
                               f"before competitors enter.",
                    impact="high",
                    actionable=True,
                    recommendation=f"Accelerate development and market entry for {name} to establish market leadership.",
                    confidence=0.85
                )
                analysis.insights.append(insight)
                analysis.opportunities.append(name)

            # High-visibility commodity = service expansion opportunity
            if evolution >= 0.85 and visibility >= 0.7:
                insight = StrategicInsight(
                    type=InsightType.OPPORTUNITY,
                    component=name,
                    title=f"{name}: Expansion Opportunity",
                    description=f"{name} is a mature, customer-facing component. This is an opportunity "
                               f"to expand feature set or enter adjacent markets.",
                    impact="medium",
                    actionable=True,
                    recommendation=f"Identify adjacent use cases and markets for {name} expansion.",
                    confidence=0.75
                )
                analysis.insights.append(insight)
                analysis.opportunities.append(f"{name} (expansion)")

    def _identify_threats(self, components: List[Dict], analysis: MapAnalysis):
        """Identify threats (commoditization of custom components, competitive pressures)"""
        for comp in components:
            name = comp['name']
            evolution = comp['evolution']
            visibility = comp['visibility']

            # Custom components moving toward commodity = competitive threat
            if 0.3 <= evolution <= 0.45:
                insight = StrategicInsight(
                    type=InsightType.THREAT,
                    component=name,
                    title=f"{name}: Commoditization Threat",
                    description=f"{name} is transitioning from custom to product stage. Competitors may be "
                               f"developing similar solutions, threatening your competitive advantage.",
                    impact="high",
                    actionable=True,
                    recommendation=f"Accelerate feature development and market education for {name} to maintain competitive lead.",
                    confidence=0.8
                )
                analysis.insights.append(insight)
                analysis.threats.append(name)

            # Product stage components = increasing competition
            if 0.55 <= evolution < 0.8:
                insight = StrategicInsight(
                    type=InsightType.THREAT,
                    component=name,
                    title=f"{name}: Increasing Competition",
                    description=f"{name} is at product stage with multiple competitors likely entering the market. "
                               f"Margin compression is inevitable.",
                    impact="medium",
                    actionable=True,
                    recommendation=f"Plan cost reduction and feature differentiation for {name} to compete on value, not just price.",
                    confidence=0.75
                )
                analysis.insights.append(insight)
                analysis.threats.append(f"{name} (competition)")

    def _identify_bottlenecks(self, components: List[Dict], dependencies: List[Tuple],
                            analysis: MapAnalysis):
        """Identify bottlenecks (critical dependencies with poor characteristics)"""
        dep_graph = self._build_dependency_graph(dependencies)
        reverse_dep_graph = self._build_reverse_dependency_graph(dependencies)

        for comp in components:
            name = comp['name']

            # Components that many things depend on = critical infrastructure
            dependents = reverse_dep_graph.get(name, [])
            if len(dependents) >= 3:
                # Check stability of this component
                if comp['evolution'] < 0.7:
                    insight = StrategicInsight(
                        type=InsightType.BOTTLENECK,
                        component=name,
                        title=f"{name}: Critical Bottleneck",
                        description=f"{name} is a critical infrastructure component that {len(dependents)} other "
                                   f"components depend on. Its unstable nature ({self._stage_label(comp['evolution'])}) "
                                   f"creates system-wide risk.",
                        impact="high",
                        actionable=True,
                        recommendation=f"Stabilize and harden {name}. Consider introducing redundancy or failover mechanisms.",
                        confidence=0.85
                    )
                    analysis.insights.append(insight)

    def _assess_evolution_readiness(self, components: List[Dict], analysis: MapAnalysis):
        """Assess which components are ready for evolution to the next stage"""
        for comp in components:
            name = comp['name']
            evolution = comp['evolution']

            if evolution < 0.25:
                stage_target = "Product"
                current = "Genesis"
            elif evolution < 0.55:
                stage_target = "Product"
                current = "Custom"
            elif evolution < 0.8:
                stage_target = "Commodity"
                current = "Product"
            else:
                continue

            insight = StrategicInsight(
                type=InsightType.EVOLUTION_READINESS,
                component=name,
                title=f"{name}: Evolution Path {current} → {stage_target}",
                description=f"{name} is approaching maturity for evolution to {stage_target}. "
                           f"Preparation should begin now.",
                impact="medium",
                actionable=True,
                recommendation=f"Start preparing {name} for evolution to {stage_target}: "
                              f"standardize interfaces, increase reliability, reduce cost.",
                confidence=0.8
            )
            analysis.insights.append(insight)
            analysis.evolution_trajectory[name] = f"{current} → {stage_target}"

    def _identify_critical_path(self, components: List[Dict], dependencies: List[Tuple],
                               analysis: MapAnalysis):
        """Identify critical path (longest dependency chain from genesis to commodity)"""
        dep_graph = self._build_dependency_graph(dependencies)

        # Find longest dependency chains
        longest_paths = []

        for comp in components:
            if comp['evolution'] < 0.25:  # Start from genesis components
                path = self._dfs_longest_path(comp['name'], dep_graph, components)
                if path:
                    longest_paths.append(path)

        if longest_paths:
            longest_paths.sort(key=len, reverse=True)
            analysis.critical_path = longest_paths[0]

    def _generate_recommendations(self, components: List[Dict], dependencies: List[Tuple],
                                 analysis: MapAnalysis):
        """Generate strategic recommendations based on analysis"""
        recommendations = []

        # If have genesis innovations, recommend acceleration
        genesis_comps = [c for c in components if c['evolution'] < 0.25]
        if genesis_comps:
            recs_str = ", ".join([c['name'] for c in genesis_comps[:3]])
            recommendations.append(
                f"INNOVATION LEADERSHIP: Accelerate development of genesis-stage innovations ({recs_str}) "
                f"to establish market leadership before competitors enter."
            )

        # If have custom differentiators, recommend protection
        custom_comps = [c for c in components if 0.25 <= c['evolution'] <= 0.55 and c['visibility'] >= 0.4]
        if custom_comps:
            recommendations.append(
                f"COMPETITIVE MOAT: Protect your custom differentiators ({', '.join([c['name'] for c in custom_comps[:3]])}) "
                f"from commoditization through continuous innovation and network effects."
            )

        # If have commodity dependencies at high visibility, recommend diversification
        commodity_deps = [
            (c['name'], d) for c in components for d in analysis.vulnerabilities
            if c['name'] in d and c['visibility'] >= 0.7
        ]
        if commodity_deps:
            recommendations.append(
                f"SUPPLY CHAIN RESILIENCE: Diversify or develop in-house alternatives for critical "
                f"commodity dependencies to reduce vendor lock-in risk."
            )

        # If have mature customs approaching product stage, recommend productization
        product_ready = [c for c in components if 0.4 <= c['evolution'] <= 0.55]
        if product_ready:
            recommendations.append(
                f"NEW REVENUE STREAMS: Evaluate productizing mature custom components "
                f"({', '.join([c['name'] for c in product_ready[:3]])}) for external monetization."
            )

        # Evolutionary readiness
        if analysis.evolution_trajectory:
            recommendations.append(
                f"EVOLUTIONARY PLANNING: Begin preparation for components approaching next evolution stage. "
                f"Standardize interfaces, increase reliability, optimize cost."
            )

        analysis.strategic_recommendations = recommendations

    def _build_dependency_graph(self, dependencies: List[Tuple[str, str]]) -> Dict[str, List[str]]:
        """Build directed graph of component dependencies"""
        graph = {}
        for source, target in dependencies:
            if source not in graph:
                graph[source] = []
            graph[source].append(target)
        return graph

    def _build_reverse_dependency_graph(self, dependencies: List[Tuple[str, str]]) -> Dict[str, List[str]]:
        """Build reverse dependency graph (what depends on each component)"""
        graph = {}
        for source, target in dependencies:
            if target not in graph:
                graph[target] = []
            graph[target].append(source)
        return graph

    def _dfs_longest_path(self, start: str, graph: Dict[str, List[str]],
                         components: List[Dict], visited: Optional[set] = None) -> List[str]:
        """Find longest dependency path using DFS"""
        if visited is None:
            visited = set()

        if start in visited:
            return [start]

        visited = visited.copy()
        visited.add(start)

        if start not in graph or not graph[start]:
            return [start]

        longest = [start]
        for neighbor in graph[start]:
            path = self._dfs_longest_path(neighbor, graph, components, visited)
            if len(path) + 1 > len(longest):
                longest = [start] + path

        return longest

    def _stage_label(self, evolution: float) -> str:
        """Convert evolution score to stage label"""
        if evolution < 0.25:
            return "Genesis"
        elif evolution < 0.55:
            return "Custom"
        elif evolution < 0.8:
            return "Product"
        else:
            return "Commodity"

    def export_analysis_to_markdown(analysis: MapAnalysis) -> str:
        """Export analysis as markdown report"""
        lines = [
            "# Wardley Map Strategic Analysis Report",
            "",
            f"## Overview",
            f"- **Total Components**: {analysis.total_components}",
            f"- **Total Dependencies**: {analysis.total_dependencies}",
            f"- **Insights Generated**: {len(analysis.insights)}",
            "",
        ]

        # Competitive Advantages
        if analysis.competitive_advantages:
            lines.extend([
                "## Competitive Advantages",
                f"Your organization has {len(analysis.competitive_advantages)} key differentiators:",
                ""
            ])
            for adv in analysis.competitive_advantages:
                lines.append(f"- **{adv}**: Custom-built competitive moat")
            lines.append("")

        # Vulnerabilities
        if analysis.vulnerabilities:
            lines.extend([
                "## Vulnerabilities & Risks",
                f"Identified {len(analysis.vulnerabilities)} critical vulnerabilities:",
                ""
            ])
            for vuln in analysis.vulnerabilities:
                lines.append(f"- {vuln}")
            lines.append("")

        # Opportunities
        if analysis.opportunities:
            lines.extend([
                "## Strategic Opportunities",
                f"Found {len(analysis.opportunities)} growth opportunities:",
                ""
            ])
            for opp in analysis.opportunities:
                lines.append(f"- **{opp}**: Market expansion opportunity")
            lines.append("")

        # Threats
        if analysis.threats:
            lines.extend([
                "## Competitive Threats",
                f"Identified {len(analysis.threats)} areas under competitive pressure:",
                ""
            ])
            for threat in analysis.threats:
                lines.append(f"- {threat}")
            lines.append("")

        # Strategic Recommendations
        if analysis.strategic_recommendations:
            lines.extend([
                "## Strategic Recommendations",
                ""
            ])
            for i, rec in enumerate(analysis.strategic_recommendations, 1):
                lines.append(f"{i}. {rec}")
            lines.append("")

        # Evolution Trajectory
        if analysis.evolution_trajectory:
            lines.extend([
                "## Evolution Planning",
                "Components approaching next evolution stage:",
                ""
            ])
            for comp, trajectory in analysis.evolution_trajectory.items():
                lines.append(f"- {comp}: {trajectory}")
            lines.append("")

        # Critical Path
        if analysis.critical_path:
            lines.extend([
                "## Critical Dependency Path",
                "Longest dependency chain (indicates execution complexity):",
                ""
                f"```",
                " → ".join(analysis.critical_path),
                "```",
                ""
            ])

        return "\n".join(lines)

# Convenience function
def analyze_wardley_map(components: List[Dict], dependencies: List[Tuple]) -> MapAnalysis:
    """Analyze a Wardley Map and return strategic insights"""
    analyzer = StrategicAnalyzer()
    return analyzer.analyze(components, dependencies)

if __name__ == "__main__":
    # Example analysis
    test_components = [
        {'name': 'Customer Portal', 'visibility': 0.95, 'evolution': 0.7},
        {'name': 'Recommendation Engine', 'visibility': 0.6, 'evolution': 0.35},
        {'name': 'PostgreSQL Database', 'visibility': 0.1, 'evolution': 0.9},
        {'name': 'Custom ML Model', 'visibility': 0.4, 'evolution': 0.2},
        {'name': 'AWS Infrastructure', 'visibility': 0.05, 'evolution': 0.95},
    ]

    test_dependencies = [
        ('Customer Portal', 'Recommendation Engine'),
        ('Recommendation Engine', 'Custom ML Model'),
        ('Custom ML Model', 'PostgreSQL Database'),
        ('PostgreSQL Database', 'AWS Infrastructure'),
    ]

    analyzer = StrategicAnalyzer()
    analysis = analyzer.analyze(test_components, test_dependencies)

    print("=== Strategic Analysis Results ===\n")
    print(analyzer.export_analysis_to_markdown(analysis))
