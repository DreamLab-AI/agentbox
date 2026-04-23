#!/usr/bin/env python3
"""
Wardley Map Generator
Transforms components and dependencies into visual Wardley maps
"""

import json
import math
from typing import List, Dict, Tuple, Optional

class WardleyMapGenerator:
    """Generate Wardley maps in various formats"""
    
    def __init__(self, width=800, height=600):
        self.width = width
        self.height = height
        self.margin = 50
        self.map_width = width - 2 * self.margin
        self.map_height = height - 2 * self.margin
        
    def create_map(self, components: List[Dict], dependencies: List[Tuple] = None) -> str:
        """
        Create an HTML/SVG Wardley map
        
        Args:
            components: List of dicts with 'name', 'visibility', 'evolution'
            dependencies: List of tuples (from_component, to_component)
        
        Returns:
            HTML string with embedded SVG map
        """
        svg = self._generate_svg(components, dependencies or [])
        html = self._wrap_in_html(svg)
        return html
    
    def _generate_svg(self, components: List[Dict], dependencies: List[Tuple]) -> str:
        """Generate SVG content for the map"""
        
        svg_elements = []
        
        # Add background and grid
        svg_elements.append(self._create_background())
        svg_elements.append(self._create_evolution_axis())
        svg_elements.append(self._create_value_chain_axis())
        
        # Create component lookup
        comp_positions = {}
        for comp in components:
            x, y = self._component_to_coords(comp['evolution'], comp['visibility'])
            comp_positions[comp['name']] = (x, y)
        
        # Add dependencies (draw these first so components appear on top)
        for dep in dependencies:
            if dep in comp_positions and dep in comp_positions:
                svg_elements.append(self._create_dependency_line(
                    comp_positions[dep], 
                    comp_positions[dep]
                ))
        
        # Add components
        for comp in components:
            x, y = comp_positions[comp['name']]
            svg_elements.append(self._create_component_circle(
                x, y, comp['name'], comp.get('type', 'default')
            ))
        
        # Wrap in SVG tags
        svg = f'''<svg width="{self.width}" height="{self.height}" 
                      xmlns="http://www.w3.org/2000/svg">
            <defs>
                {self._create_svg_defs()}
            </defs>
            {"".join(svg_elements)}
        </svg>'''
        
        return svg
    
    def _create_background(self) -> str:
        """Create map background with evolution stages"""
        stages = [
            ('Genesis', 0, 0.15, '#f8f8f8'),
            ('Custom', 0.15, 0.35, '#f0f0f0'),
            ('Product', 0.35, 0.30, '#e8e8e8'),
            ('Commodity', 0.65, 0.35, '#e0e0e0')
        ]
        
        bg_elements = []
        for stage, start, width, color in stages:
            x = self.margin + start * self.map_width
            w = width * self.map_width
            bg_elements.append(
                f'<rect x="{x}" y="{self.margin}" '
                f'width="{w}" height="{self.map_height}" '
                f'fill="{color}" opacity="0.5"/>'
            )
            # Add stage label
            label_x = x + w / 2
            label_y = self.height - 20
            bg_elements.append(
                f'<text x="{label_x}" y="{label_y}" '
                f'text-anchor="middle" font-size="12" fill="#666">{stage}</text>'
            )
        
        return "".join(bg_elements)
    
    def _create_evolution_axis(self) -> str:
        """Create the evolution axis (x-axis)"""
        return f'''
        <line x1="{self.margin}" y1="{self.height - self.margin}" 
              x2="{self.width - self.margin}" y2="{self.height - self.margin}" 
              stroke="#333" stroke-width="2"/>
        <text x="{self.width / 2}" y="{self.height - 5}" 
              text-anchor="middle" font-size="14" font-weight="bold">
            Evolution →
        </text>'''
    
    def _create_value_chain_axis(self) -> str:
        """Create the value chain axis (y-axis)"""
        return f'''
        <line x1="{self.margin}" y1="{self.margin}" 
              x2="{self.margin}" y2="{self.height - self.margin}" 
              stroke="#333" stroke-width="2"/>
        <text x="15" y="{self.height / 2}" 
              text-anchor="middle" font-size="14" font-weight="bold" 
              transform="rotate(-90 15 {self.height / 2})">
            Value Chain →
        </text>
        <text x="{self.margin - 5}" y="{self.margin - 5}" 
              text-anchor="end" font-size="12" fill="#666">Visible</text>
        <text x="{self.margin - 5}" y="{self.height - self.margin + 15}" 
              text-anchor="end" font-size="12" fill="#666">Invisible</text>'''
    
    def _create_component_circle(self, x: float, y: float, 
                                 name: str, comp_type: str = 'default') -> str:
        """Create a component circle with label"""
        
        # Different colors for different types
        colors = {
            'default': '#4a90e2',
            'user': '#e74c3c',
            'custom': '#f39c12',
            'product': '#27ae60',
            'commodity': '#95a5a6'
        }
        color = colors.get(comp_type, colors['default'])
        
        return f'''
        <g class="component">
            <circle cx="{x}" cy="{y}" r="8" fill="{color}" 
                    stroke="#fff" stroke-width="2"/>
            <text x="{x}" y="{y - 12}" text-anchor="middle" 
                  font-size="11" fill="#333">{name}</text>
        </g>'''
    
    def _create_dependency_line(self, from_pos: Tuple, to_pos: Tuple) -> str:
        """Create a dependency line between components"""
        return f'''
        <line x1="{from_pos}" y1="{from_pos}" 
              x2="{to_pos}" y2="{to_pos}" 
              stroke="#666" stroke-width="1" stroke-dasharray="2,2" 
              marker-end="url(#arrowhead)"/>'''
    
    def _create_svg_defs(self) -> str:
        """Create SVG definitions (arrows, etc.)"""
        return '''
        <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
        </marker>'''
    
    def _component_to_coords(self, evolution: float, visibility: float) -> Tuple[float, float]:
        """Convert component evolution/visibility to SVG coordinates"""
        x = self.margin + evolution * self.map_width
        y = self.margin + (1 - visibility) * self.map_height
        return (x, y)
    
    def _wrap_in_html(self, svg: str) -> str:
        """Wrap SVG in HTML with styling and interactivity"""
        return f'''<!DOCTYPE html>
<html>
<head>
    <title>Wardley Map</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }}
        .map-container {{
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 20px;
            display: inline-block;
        }}
        h1 {{
            color: #333;
            margin-top: 0;
        }}
        .component {{
            cursor: pointer;
        }}
        .component:hover circle {{
            r: 10;
            transition: r 0.2s;
        }}
        .controls {{
            margin-top: 20px;
            padding: 15px;
            background: #f9f9f9;
            border-radius: 5px;
        }}
        button {{
            padding: 8px 15px;
            margin-right: 10px;
            background: #4a90e2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }}
        button:hover {{
            background: #357abd;
        }}
    </style>
</head>
<body>
    <div class="map-container">
        <h1>Wardley Map</h1>
        {svg}
        <div class="controls">
            <button onclick="exportSVG()">Export SVG</button>
            <button onclick="exportPNG()">Export PNG</button>
            <button onclick="toggleGrid()">Toggle Grid</button>
        </div>
    </div>
    
    <script>
        function exportSVG() {{
            const svg = document.querySelector('svg');
            const svgData = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgData], {{type: 'image/svg+xml'}});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'wardley-map.svg';
            a.click();
        }}
        
        function exportPNG() {{
            const svg = document.querySelector('svg');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            canvas.width = svg.getAttribute('width');
            canvas.height = svg.getAttribute('height');
            
            const svgData = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgData], {{type: 'image/svg+xml'}});
            const url = URL.createObjectURL(blob);
            
            img.onload = function() {{
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(function(blob) {{
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'wardley-map.png';
                    a.click();
                }});
            }};
            img.src = url;
        }}
        
        function toggleGrid() {{
            // Implementation for grid toggle
            console.log('Grid toggle not yet implemented');
        }}
    </script>
</body>
</html>'''

def parse_text_to_components(text: str) -> List[Dict]:
    """
    Parse natural language or structured text into components
    """
    components = []
    
    # Simple keyword-based extraction (can be enhanced with NLP)
    keywords_evolution = {
        'innovative': 0.1, 'novel': 0.1, 'experimental': 0.15,
        'custom': 0.3, 'proprietary': 0.35, 'differentiated': 0.4,
        'product': 0.6, 'solution': 0.65, 'platform': 0.7,
        'commodity': 0.85, 'utility': 0.9, 'standard': 0.95
    }
    
    # This is a simplified version - enhance with proper NLP
    lines = text.split('\n')
    for line in lines:
        if '-' in line or ':' in line:
            # Try to extract component name and characteristics
            parts = line.replace('-', ':').split(':')
            if len(parts) >= 2:
                name = parts.strip()
                description = parts.strip().lower()
                
                # Determine evolution
                evolution = 0.5  # default
                for keyword, evo_value in keywords_evolution.items():
                    if keyword in description:
                        evolution = evo_value
                        break
                
                # Determine visibility (simplified heuristic)
                if any(word in description for word in ['user', 'customer', 'client']):
                    visibility = 0.9
                elif any(word in description for word in ['api', 'service', 'platform']):
                    visibility = 0.6
                elif any(word in description for word in ['data', 'database', 'storage']):
                    visibility = 0.3
                else:
                    visibility = 0.5
                
                components.append({
                    'name': name,
                    'evolution': evolution,
                    'visibility': visibility
                })
    
    return components

# Example usage
if __name__ == "__main__":
    # Example components
    example_components = [
        {'name': 'User Interface', 'visibility': 0.95, 'evolution': 0.7, 'type': 'user'},
        {'name': 'Business Logic', 'visibility': 0.7, 'evolution': 0.5, 'type': 'custom'},
        {'name': 'Data Processing', 'visibility': 0.5, 'evolution': 0.6, 'type': 'product'},
        {'name': 'Database', 'visibility': 0.3, 'evolution': 0.8, 'type': 'commodity'},
        {'name': 'Cloud Infrastructure', 'visibility': 0.1, 'evolution': 0.9, 'type': 'commodity'}
    ]
    
    example_dependencies = [
        ('User Interface', 'Business Logic'),
        ('Business Logic', 'Data Processing'),
        ('Data Processing', 'Database'),
        ('Database', 'Cloud Infrastructure')
    ]
    
    generator = WardleyMapGenerator()
    html_map = generator.create_map(example_components, example_dependencies)
    
    # Save to file
    with open('wardley_map.html', 'w') as f:
        f.write(html_map)
    
    print("Wardley map generated: wardley_map.html")