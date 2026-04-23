#!/usr/bin/env python3
"""
Interactive Wardley Map Generator using D3.js
Creates dynamic, interactive HTML visualizations with:
- Pan and zoom capabilities
- Component filtering and highlighting
- Hover tooltips with detailed information
- Visual representation of strategic insights
"""

import json
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict

@dataclass
class ComponentMetadata:
    """Enhanced component metadata for visualization"""
    name: str
    visibility: float
    evolution: float
    description: Optional[str] = None
    category: Optional[str] = None
    insights: List[str] = None
    competitive_advantage: bool = False
    vulnerability: bool = False
    opportunity: bool = False
    threat: bool = False

class InteractiveMapGenerator:
    """Generates interactive Wardley Maps with D3.js"""

    def __init__(self, width: int = 1200, height: int = 800):
        self.width = width
        self.height = height
        self.margin = {'top': 50, 'right': 100, 'bottom': 100, 'left': 100}

    def create_interactive_map(self,
                              components: List[Dict],
                              dependencies: List[Tuple[str, str]],
                              strategic_insights: Optional[Dict] = None) -> str:
        """
        Create an interactive Wardley Map with D3.js

        Args:
            components: List of component dicts
            dependencies: List of (source, target) tuples
            strategic_insights: Optional dict with insight categorization

        Returns:
            HTML string with embedded D3.js visualization
        """
        # Prepare data
        component_data = self._prepare_component_data(components, strategic_insights)
        link_data = self._prepare_link_data(dependencies)

        # Generate HTML with D3.js
        html = self._generate_d3_html(component_data, link_data)

        return html

    def _prepare_component_data(self, components: List[Dict],
                               insights: Optional[Dict] = None) -> List[Dict]:
        """Prepare component data for D3 visualization"""
        insights = insights or {}
        prepared = []

        for comp in components:
            comp_data = {
                'id': comp.get('name', ''),
                'name': comp.get('name', ''),
                'visibility': comp.get('visibility', 0.5),
                'evolution': comp.get('evolution', 0.5),
                'description': comp.get('description', ''),
                'category': comp.get('category', 'Unknown'),
                'insights': comp.get('insights', []),
                'is_strength': comp['name'] in insights.get('competitive_advantages', []),
                'is_vulnerability': any(
                    comp['name'] in v for v in insights.get('vulnerabilities', [])
                ),
                'is_opportunity': comp['name'] in insights.get('opportunities', []),
                'is_threat': comp['name'] in insights.get('threats', []),
                'evolution_stage': self._get_evolution_stage(comp.get('evolution', 0.5)),
                'visibility_level': self._get_visibility_level(comp.get('visibility', 0.5))
            }
            prepared.append(comp_data)

        return prepared

    def _prepare_link_data(self, dependencies: List[Tuple[str, str]]) -> List[Dict]:
        """Prepare link data for D3 visualization"""
        links = []
        for source, target in dependencies:
            links.append({
                'source': source,
                'target': target,
                'type': 'dependency'
            })
        return links

    def _get_evolution_stage(self, evolution: float) -> str:
        """Convert evolution score to stage name"""
        if evolution < 0.25:
            return "Genesis"
        elif evolution < 0.55:
            return "Custom"
        elif evolution < 0.8:
            return "Product"
        else:
            return "Commodity"

    def _get_visibility_level(self, visibility: float) -> str:
        """Convert visibility score to level name"""
        if visibility < 0.35:
            return "Low"
        elif visibility < 0.65:
            return "Medium"
        else:
            return "High"

    def _generate_d3_html(self, components: List[Dict], links: List[Dict]) -> str:
        """Generate complete HTML with embedded D3.js"""
        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Interactive Wardley Map</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #f5f5f5;
        }}

        #container {{
            width: 100%;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }}

        #header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}

        h1 {{
            font-size: 24px;
            margin-bottom: 8px;
        }}

        #controls {{
            padding: 15px 20px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
        }}

        .control-group {{
            display: flex;
            gap: 10px;
            align-items: center;
        }}

        label {{
            font-weight: 600;
            color: #333;
        }}

        input, select {{
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }}

        button {{
            padding: 8px 16px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            transition: background 0.2s;
        }}

        button:hover {{
            background: #764ba2;
        }}

        #canvas {{
            flex: 1;
            background: white;
            position: relative;
            overflow: hidden;
        }}

        svg {{
            width: 100%;
            height: 100%;
        }}

        .evolution-stage {{
            fill-opacity: 0.05;
            pointer-events: none;
        }}

        .stage-label {{
            font-size: 14px;
            fill: #999;
            pointer-events: none;
            text-anchor: middle;
        }}

        .axis-label {{
            font-size: 12px;
            fill: #666;
            pointer-events: none;
        }}

        .axis-line {{
            stroke: #ccc;
            stroke-width: 2;
            stroke-dasharray: 5,5;
        }}

        .component {{
            cursor: pointer;
            transition: all 0.2s;
        }}

        .component-circle {{
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }}

        .component:hover .component-circle {{
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
            r: 20;
        }}

        .component-label {{
            font-size: 12px;
            text-anchor: middle;
            pointer-events: none;
            font-weight: 600;
            fill: #333;
        }}

        .link {{
            stroke: #999;
            stroke-opacity: 0.6;
            stroke-width: 2;
            marker-end: url(#arrowhead);
        }}

        .link.strength {{
            stroke: #ff6b6b;
            stroke-width: 3;
        }}

        .link.weak {{
            stroke: #95a5a6;
            stroke-dasharray: 5,5;
        }}

        .component.strength .component-circle {{
            fill: #51cf66;
            stroke: #2f9e44;
            stroke-width: 3;
        }}

        .component.vulnerability .component-circle {{
            fill: #ff8787;
            stroke: #d32f2f;
            stroke-width: 3;
        }}

        .component.opportunity .component-circle {{
            fill: #ffd93d;
            stroke: #f9a825;
            stroke-width: 3;
        }}

        .component.threat .component-circle {{
            fill: #ff922b;
            stroke: #d9480f;
            stroke-width: 3;
        }}

        .component.default .component-circle {{
            fill: #667eea;
            stroke: #764ba2;
            stroke-width: 2;
        }}

        .tooltip {{
            position: absolute;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            max-width: 300px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
        }}

        .tooltip.show {{
            opacity: 1;
        }}

        .tooltip-title {{
            font-weight: 600;
            color: #333;
            margin-bottom: 6px;
            font-size: 13px;
        }}

        .tooltip-item {{
            margin-bottom: 4px;
            color: #666;
        }}

        .legend {{
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            font-size: 12px;
        }}

        .legend-item {{
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .legend-color {{
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid;
        }}

        #instructions {{
            position: absolute;
            top: 20px;
            left: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            font-size: 12px;
            max-width: 250px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 999;
        }}

        .info-panel {{
            position: absolute;
            top: 20px;
            right: 20px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 350px;
            font-size: 12px;
            z-index: 999;
            max-height: 300px;
            overflow-y: auto;
        }}
    </style>
</head>
<body>
    <div id="container">
        <div id="header">
            <h1>Interactive Wardley Map</h1>
            <p>Visualizing organizational evolution and strategic positioning</p>
        </div>

        <div id="controls">
            <div class="control-group">
                <label>Filter by Evolution Stage:</label>
                <select id="stageFilter">
                    <option value="">All Stages</option>
                    <option value="Genesis">Genesis</option>
                    <option value="Custom">Custom</option>
                    <option value="Product">Product</option>
                    <option value="Commodity">Commodity</option>
                </select>
            </div>

            <div class="control-group">
                <label>Filter by Insight Type:</label>
                <select id="insightFilter">
                    <option value="">All Components</option>
                    <option value="strength">Strengths</option>
                    <option value="vulnerability">Vulnerabilities</option>
                    <option value="opportunity">Opportunities</option>
                    <option value="threat">Threats</option>
                </select>
            </div>

            <button id="resetZoom">Reset Zoom</button>
            <button id="toggleGrid">Toggle Grid</button>
        </div>

        <div id="canvas">
            <div id="instructions">
                <strong>Controls:</strong><br>
                • Scroll: Zoom<br>
                • Drag: Pan<br>
                • Click: Select component<br>
                • Hover: Details
            </div>

            <div id="infoPanel" class="info-panel" style="display: none;"></div>

            <svg></svg>

            <div class="tooltip"></div>

            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background: #667eea; border-color: #764ba2;"></div>
                    <span>Component</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #51cf66; border-color: #2f9e44;"></div>
                    <span>Strength</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ff8787; border-color: #d32f2f;"></div>
                    <span>Vulnerability</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ffd93d; border-color: #f9a825;"></div>
                    <span>Opportunity</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #ff922b; border-color: #d9480f;"></div>
                    <span>Threat</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const data = {{{json.dumps({
            'nodes': components,
            'links': links
        })}}};

        const width = document.getElementById('canvas').clientWidth;
        const height = document.getElementById('canvas').clientHeight;
        const margin = {{ top: 80, right: 100, bottom: 100, left: 100 }};
        const mapWidth = width - margin.left - margin.right;
        const mapHeight = height - margin.top - margin.bottom;

        // SVG setup
        const svg = d3.select('svg')
            .attr('width', width)
            .attr('height', height);

        // Create main group with margins
        const g = svg.append('g')
            .attr('transform', `translate(${{margin.left}},${{margin.top}})`);

        // Add background stages
        const stages = [
            {{ name: 'Genesis', x: 0, width: 0.15, color: '#f0f0f0' }},
            {{ name: 'Custom', x: 0.15, width: 0.2, color: '#e8e8e8' }},
            {{ name: 'Product', x: 0.35, width: 0.3, color: '#e0e0e0' }},
            {{ name: 'Commodity', x: 0.65, width: 0.35, color: '#d8d8d8' }}
        ];

        stages.forEach(stage => {{
            g.append('rect')
                .attr('class', 'evolution-stage')
                .attr('x', stage.x * mapWidth)
                .attr('y', 0)
                .attr('width', stage.width * mapWidth)
                .attr('height', mapHeight)
                .attr('fill', stage.color);

            g.append('text')
                .attr('class', 'stage-label')
                .attr('x', (stage.x + stage.width / 2) * mapWidth)
                .attr('y', mapHeight + 30)
                .attr('font-weight', 'bold')
                .text(stage.name);
        }});

        // Add axes
        g.append('line')
            .attr('class', 'axis-line')
            .attr('x1', 0)
            .attr('x2', mapWidth)
            .attr('y1', mapHeight)
            .attr('y2', mapHeight);

        g.append('line')
            .attr('class', 'axis-line')
            .attr('x1', 0)
            .attr('x2', 0)
            .attr('y1', 0)
            .attr('y2', mapHeight);

        g.append('text')
            .attr('class', 'axis-label')
            .attr('x', mapWidth / 2)
            .attr('y', mapHeight + 50)
            .attr('text-anchor', 'middle')
            .text('Evolution →');

        g.append('text')
            .attr('class', 'axis-label')
            .attr('x', -mapHeight / 2)
            .attr('y', -50)
            .attr('text-anchor', 'middle')
            .attr('transform', 'rotate(-90)')
            .text('Visibility →');

        // Arrow marker
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 8)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', '#999');

        // Create simulation
        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links)
                .id(d => d.id)
                .distance(100)
                .strength(0.3))
            .force('x', d3.forceX(d => d.evolution * mapWidth).strength(0.5))
            .force('y', d3.forceY(d => (1 - d.visibility) * mapHeight).strength(0.5))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('collision', d3.forceCollide().radius(25));

        // Create links
        const link = g.append('g')
            .selectAll('line')
            .data(data.links)
            .join('line')
            .attr('class', 'link');

        // Create nodes
        const node = g.append('g')
            .selectAll('g.component')
            .data(data.nodes)
            .join('g')
            .attr('class', d => 'component ' +
                (d.is_strength ? 'strength' :
                 d.is_vulnerability ? 'vulnerability' :
                 d.is_opportunity ? 'opportunity' :
                 d.is_threat ? 'threat' : 'default'));

        node.append('circle')
            .attr('class', 'component-circle')
            .attr('r', 15);

        node.append('text')
            .attr('class', 'component-label')
            .attr('dy', '0.3em')
            .text(d => d.name.substring(0, 10));

        // Zoom behavior
        const zoom = d3.zoom()
            .on('zoom', (event) => {{
                g.attr('transform', event.transform);
            }});

        svg.call(zoom);

        document.getElementById('resetZoom').addEventListener('click', () => {{
            svg.transition().duration(750).call(
                zoom.transform,
                d3.zoomIdentity
                    .translate(margin.left, margin.top)
            );
        }});

        // Drag behavior
        node.call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

        function dragstarted(event, d) {{
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }}

        function dragged(event, d) {{
            d.fx = event.x;
            d.fy = event.y;
        }}

        function dragended(event, d) {{
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }}

        // Update positions
        simulation.on('tick', () => {{
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node.attr('transform', d => `translate(${{d.x}},${{d.y}})`);
        }});

        // Tooltip
        const tooltip = document.querySelector('.tooltip');

        node.on('mouseover', (event, d) => {{
            tooltip.classList.add('show');
            tooltip.innerHTML = `
                <div class="tooltip-title">${{d.name}}</div>
                <div class="tooltip-item"><strong>Stage:</strong> ${{d.evolution_stage}}</div>
                <div class="tooltip-item"><strong>Visibility:</strong> ${{d.visibility_level}}</div>
                <div class="tooltip-item"><strong>Category:</strong> ${{d.category}}</div>
                ${{d.description ? `<div class="tooltip-item">${{d.description}}</div>` : ''}}
            `;
            const rect = event.target.getBoundingClientRect();
            tooltip.style.left = (rect.left + 20) + 'px';
            tooltip.style.top = (rect.top - 20) + 'px';
        }})
        .on('mousemove', (event) => {{
            tooltip.style.left = (event.clientX + 20) + 'px';
            tooltip.style.top = (event.clientY - 20) + 'px';
        }})
        .on('mouseout', () => {{
            tooltip.classList.remove('show');
        }})
        .on('click', (event, d) => {{
            const panel = document.getElementById('infoPanel');
            panel.style.display = 'block';
            panel.innerHTML = `
                <strong>${{d.name}}</strong><br>
                Stage: ${{d.evolution_stage}}<br>
                Visibility: ${{d.visibility_level}}<br>
                <br>
                <small>${{d.description || 'No description'}}</small>
            `;
        }});

        // Filters
        document.getElementById('stageFilter').addEventListener('change', (e) => {{
            const stage = e.target.value;
            node.style('opacity', d => !stage || d.evolution_stage === stage ? 1 : 0.2);
        }});

        document.getElementById('insightFilter').addEventListener('change', (e) => {{
            const insight = e.target.value;
            node.style('opacity', d => {{
                if (!insight) return 1;
                if (insight === 'strength') return d.is_strength ? 1 : 0.2;
                if (insight === 'vulnerability') return d.is_vulnerability ? 1 : 0.2;
                if (insight === 'opportunity') return d.is_opportunity ? 1 : 0.2;
                if (insight === 'threat') return d.is_threat ? 1 : 0.2;
                return 1;
            }});
        }});

        document.getElementById('toggleGrid').addEventListener('click', () => {{
            g.selectAll('.evolution-stage').style('opacity',
                (_, i, nodes) => nodes[0].style.opacity === '0.05' ? 0 : 0.05
            );
        }});
    </script>
</body>
</html>"""

# Convenience function
def create_interactive_wardley_map(components: List[Dict],
                                  dependencies: List[Tuple[str, str]],
                                  insights: Optional[Dict] = None) -> str:
    """Create an interactive Wardley Map"""
    generator = InteractiveMapGenerator()
    return generator.create_interactive_map(components, dependencies, insights)

if __name__ == "__main__":
    # Test
    test_components = [
        {'name': 'Customer Portal', 'visibility': 0.95, 'evolution': 0.7, 'category': 'Frontend'},
        {'name': 'Recommendation Engine', 'visibility': 0.6, 'evolution': 0.35, 'category': 'ML'},
        {'name': 'PostgreSQL Database', 'visibility': 0.1, 'evolution': 0.9, 'category': 'Database'},
        {'name': 'AWS Infrastructure', 'visibility': 0.05, 'evolution': 0.95, 'category': 'Infrastructure'},
    ]

    test_dependencies = [
        ('Customer Portal', 'Recommendation Engine'),
        ('Recommendation Engine', 'PostgreSQL Database'),
        ('PostgreSQL Database', 'AWS Infrastructure'),
    ]

    html = create_interactive_wardley_map(test_components, test_dependencies)

    with open('interactive_wardley_map.html', 'w') as f:
        f.write(html)

    print("Interactive map created: interactive_wardley_map.html")
