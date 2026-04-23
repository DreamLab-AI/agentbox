#!/usr/bin/env python3
"""
Wardley Mapper MCP Tool
Executes Wardley mapping operations based on MCP requests.
Supports map creation, strategic analysis, and NLP parsing.
"""

import sys
import json
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generate_wardley_map import WardleyMapGenerator
from quick_map import quick_parse_input
from advanced_nlp_parser import parse_components_text
from strategic_analyzer import analyze_wardley_map
from heuristics_engine import get_heuristics_engine
from interactive_map_generator import create_interactive_wardley_map

def create_map(params):
    """
    Creates a Wardley map from components and dependencies.
    Supports multiple input formats: structured JSON, natural language, or CSV.
    """
    components = params.get('components', [])
    dependencies = params.get('dependencies', [])
    input_text = params.get('text', '')
    use_nlp = params.get('use_advanced_nlp', True)

    if not components and input_text:
        # Use advanced NLP parser if available
        if use_nlp:
            try:
                components, dependencies = parse_components_text(input_text, use_advanced_nlp=True)
            except Exception as e:
                # Fallback to simple parser
                components, dependencies = quick_parse_input(input_text)
        else:
            components, dependencies = quick_parse_input(input_text)
    elif not components:
        return {"success": False, "error": "No components or text provided."}

    # Apply heuristics to improve component positioning
    engine = get_heuristics_engine()
    enhanced_components = []
    for comp in components:
        comp_dict = comp if isinstance(comp, dict) else comp.__dict__
        # Apply heuristics for better positioning
        evo, vis = engine.score_component(
            comp_dict.get('name', ''),
            comp_dict
        )
        # Use heuristic values if they're more confident
        if engine.patterns.get(comp_dict.get('name')):
            comp_dict['evolution'] = evo
            comp_dict['visibility'] = vis
        enhanced_components.append(comp_dict)

    generator = WardleyMapGenerator()
    html_map = generator.create_map(enhanced_components, dependencies)

    return {
        "success": True,
        "map_html": html_map,
        "component_count": len(enhanced_components),
        "dependency_count": len(dependencies),
        "components": enhanced_components,
        "dependencies": dependencies
    }

def analyze_map(params):
    """
    Analyzes a Wardley map and generates strategic insights.
    Identifies strengths, vulnerabilities, opportunities, threats, and recommendations.
    """
    components = params.get('components', [])
    dependencies = params.get('dependencies', [])

    if not components:
        return {"success": False, "error": "No components provided for analysis."}

    # Convert to proper format if needed
    comp_list = []
    for comp in components:
        if isinstance(comp, dict):
            comp_list.append(comp)
        else:
            comp_list.append(comp.__dict__)

    # Perform analysis
    analysis = analyze_wardley_map(comp_list, dependencies)

    # Export to markdown
    analyzer = type(analysis).__module__
    from strategic_analyzer import StrategicAnalyzer
    markdown_report = StrategicAnalyzer.export_analysis_to_markdown(analysis)

    return {
        "success": True,
        "analysis": {
            "total_components": analysis.total_components,
            "total_dependencies": analysis.total_dependencies,
            "competitive_advantages": analysis.competitive_advantages,
            "vulnerabilities": analysis.vulnerabilities,
            "opportunities": analysis.opportunities,
            "threats": analysis.threats,
            "strategic_recommendations": analysis.strategic_recommendations,
            "evolution_trajectory": analysis.evolution_trajectory,
            "critical_path": analysis.critical_path
        },
        "markdown_report": markdown_report,
        "insights_count": len(analysis.insights),
        "insights": [
            {
                "type": insight.type.value,
                "component": insight.component,
                "title": insight.title,
                "description": insight.description,
                "impact": insight.impact,
                "recommendation": insight.recommendation
            }
            for insight in analysis.insights
        ]
    }

def parse_text(params):
    """
    Parses natural language text to extract components and dependencies.
    Uses advanced NLP when available (spaCy).
    """
    text = params.get('text', '')
    use_nlp = params.get('use_advanced_nlp', True)

    if not text:
        return {"success": False, "error": "No text provided."}

    try:
        if use_nlp:
            components, dependencies = parse_components_text(text, use_advanced_nlp=True)
        else:
            components, dependencies = quick_parse_input(text)

        return {
            "success": True,
            "components": components,
            "dependencies": dependencies,
            "component_count": len(components),
            "dependency_count": len(dependencies)
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to parse text: {str(e)}"}

def create_interactive_map(params):
    """
    Creates an interactive Wardley map with D3.js visualization.
    Includes strategic insights visualization.
    """
    components = params.get('components', [])
    dependencies = params.get('dependencies', [])
    insights = params.get('insights', None)

    if not components:
        return {"success": False, "error": "No components provided."}

    # Create interactive map
    html_map = create_interactive_wardley_map(components, dependencies, insights)

    return {
        "success": True,
        "interactive_map_html": html_map,
        "component_count": len(components),
        "dependency_count": len(dependencies)
    }

def main():
    """Main loop to handle MCP requests."""
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get('method')
            params = request.get('params', {})

            response = {}
            if method == 'create_map':
                response['result'] = create_map(params)
            elif method == 'analyze_map':
                response['result'] = analyze_map(params)
            elif method == 'parse_text':
                response['result'] = parse_text(params)
            elif method == 'create_interactive_map':
                response['result'] = create_interactive_map(params)
            else:
                response['error'] = f"Unknown method: {method}"

            sys.stdout.write(json.dumps(response) + '\n')
            sys.stdout.flush()

        except json.JSONDecodeError:
            error_response = {"error": "Invalid JSON received"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()
        except Exception as e:
            error_response = {"error": f"An unexpected error occurred: {str(e)}"}
            sys.stdout.write(json.dumps(error_response) + '\n')
            sys.stdout.flush()

if __name__ == "__main__":
    main()