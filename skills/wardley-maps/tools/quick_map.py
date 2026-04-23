#!/usr/bin/env python3
"""
Quick Wardley Map Generator
Instant mapping from clipboard or interactive input
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from generate_wardley_map import WardleyMapGenerator, parse_text_to_components
import json
import re

def quick_parse_input(text):
    """
    Enhanced parser for various input formats
    """
    components = []
    dependencies = []
    
    # Check if it's JSON
    if text.strip().startswith('{') or text.strip().startswith('['):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                components = data
            elif isinstance(data, dict):
                components = data.get('components', [])
                dependencies = data.get('dependencies', [])
            return components, dependencies
        except:
            pass
    
    # Check for CSV-like format
    if '\t' in text or ',' in text:
        lines = text.strip().split('\n')
        for line in lines:
            parts = line.split('\t') if '\t' in line else line.split(',')
            if len(parts) >= 3:
                try:
                    components.append({
                        'name': parts.strip(),
                        'visibility': float(parts),
                        'evolution': float(parts)
                    })
                except:
                    pass
    
    # Parse natural language with enhanced patterns
    if not components:
        components, dependencies = advanced_nlp_parse(text)
    
    return components, dependencies

def advanced_nlp_parse(text):
    """
    Advanced natural language parsing for Wardley maps
    """
    components = []
    dependencies = []
    
    # Component extraction patterns
    component_patterns = [
        r'(?:our|the|a)\s+(\w+[\w\s]+?)\s+(?:is|are|provides|handles)',
        r'(?:using|leverage|built on)\s+(\w+[\w\s]+?)(?:\s+for|\s+to|\.|,)',
        r'(\w+[\w\s]+?)\s+(?:service|system|platform|component|tool)',
        r'(?:customer|user|client)\s+(\w+[\w\s]+)',
    ]
    
    # Evolution keywords
    evolution_map = {
        # Genesis
        'innovative': 0.1, 'experimental': 0.1, 'novel': 0.1, 
        'research': 0.15, 'prototype': 0.15, 'alpha': 0.1,
        'unprecedented': 0.05, 'breakthrough': 0.1,
        
        # Custom
        'custom': 0.3, 'bespoke': 0.35, 'proprietary': 0.35,
        'differentiated': 0.4, 'unique': 0.35, 'specialized': 0.4,
        'in-house': 0.35, 'homegrown': 0.3, 'tailored': 0.35,
        
        # Product
        'product': 0.6, 'solution': 0.65, 'platform': 0.65,
        'service': 0.6, 'offering': 0.6, 'package': 0.65,
        'commercial': 0.7, 'mature': 0.7, 'stable': 0.7,
        
        # Commodity
        'commodity': 0.85, 'utility': 0.9, 'standard': 0.85,
        'outsourced': 0.9, 'cloud': 0.85, 'saas': 0.8,
        'off-the-shelf': 0.85, 'cots': 0.85, 'common': 0.8
    }
    
    # Visibility keywords
    visibility_map = {
        'customer': 0.9, 'user': 0.9, 'client': 0.9, 'consumer': 0.9,
        'interface': 0.85, 'experience': 0.85, 'facing': 0.85,
        'api': 0.6, 'integration': 0.6, 'middleware': 0.5,
        'backend': 0.4, 'database': 0.3, 'storage': 0.3,
        'infrastructure': 0.2, 'hosting': 0.2, 'server': 0.2,
        'internal': 0.4, 'core': 0.5, 'engine': 0.4
    }
    
    # Extract components
    seen_components = set()
    text_lower = text.lower()
    
    for pattern in component_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            component_name = match.group(1).strip()
            if component_name and component_name not in seen_components:
                seen_components.add(component_name)
                
                # Determine evolution
                evolution = 0.5  # default
                for keyword, score in evolution_map.items():
                    if keyword in text_lower:
                        context = text_lower[max(0, text_lower.index(component_name.lower())-50):
                                            min(len(text_lower), text_lower.index(component_name.lower())+50)]
                        if keyword in context:
                            evolution = score
                            break
                
                # Determine visibility
                visibility = 0.5  # default
                for keyword, score in visibility_map.items():
                    if keyword in component_name.lower():
                        visibility = score
                        break
                
                components.append({
                    'name': component_name.title(),
                    'visibility': visibility,
                    'evolution': evolution
                })
    
    # Extract dependencies using relationship patterns
    dep_patterns = [
        r'(\w+[\w\s]+?)\s+(?:depends on|requires|needs)\s+(\w+[\w\s]+)',
        r'(\w+[\w\s]+?)\s+(?:uses|leverages|built on)\s+(\w+[\w\s]+)',
        r'(\w+[\w\s]+?)\s+(?:→|->|connects to)\s+(\w+[\w\s]+)',
    ]
    
    for pattern in dep_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            from_comp = match.group(1).strip().title()
            to_comp = match.group(2).strip().title()
            
            # Check if both components exist
            comp_names = [c['name'] for c in components]
            if from_comp in comp_names and to_comp in comp_names:
                dependencies.append((from_comp, to_comp))
    
    # If no components found, try a simpler approach
    if not components:
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if line and not line.startswith('#'):
                # Simple format: "Component Name - description"
                if ' - ' in line:
                    name = line.split(' - ').strip()
                    desc = line.split(' - ').strip().lower()
                    
                    evolution = 0.5
                    for keyword, score in evolution_map.items():
                        if keyword in desc:
                            evolution = score
                            break
                    
                    visibility = 0.5
                    for keyword, score in visibility_map.items():
                        if keyword in desc:
                            visibility = score
                            break
                    
                    components.append({
                        'name': name,
                        'visibility': visibility,
                        'evolution': evolution
                    })
    
    return components, dependencies

def interactive_mode():
    """
    Interactive mode for creating Wardley maps
    """
    print("=== Wardley Map Quick Generator ===")
    print("\nEnter components in one of these formats:")
    print("1. Natural language description")
    print("2. 'Name, visibility, evolution' (CSV format)")
    print("3. 'Name - description' format")
    print("4. JSON format")
    print("\nType 'done' when finished, 'help' for more info\n")
    
    components = []
    dependencies = []
    
    while True:
        line = input("> ").strip()
        
        if line.lower() == 'done':
            break
        elif line.lower() == 'help':
            print_help()
            continue
        elif line.startswith('dep:'):
            # Dependency format: "dep: Component1 -> Component2"
            dep_match = re.match(r'dep:\s*(.+?)\s*->\s*(.+)', line, re.IGNORECASE)
            if dep_match:
                dependencies.append((dep_match.group(1).strip(), dep_match.group(2).strip()))
                print(f"Added dependency: {dep_match.group(1)} -> {dep_match.group(2)}")
            continue
        elif not line:
            continue
        
        # Try to parse the line
        parsed_comps, parsed_deps = quick_parse_input(line)
        if parsed_comps:
            components.extend(parsed_comps)
            dependencies.extend(parsed_deps)
            print(f"Added {len(parsed_comps)} component(s)")
    
    return components, dependencies

def print_help():
    """Print help information"""
    print("\n=== Help ===")
    print("Examples of input formats:")
    print("1. Natural: 'Our customer portal is built on a custom platform'")
    print("2. CSV: 'Customer Portal, 0.9, 0.7'")
    print("3. Simple: 'Customer Portal - user-facing web interface'")
    print("4. Dependency: 'dep: Customer Portal -> API Gateway'")
    print("\nEvolution keywords:")
    print("- Genesis/Custom: innovative, experimental, proprietary, custom")
    print("- Product: platform, solution, service, stable")
    print("- Commodity: standard, utility, cloud, outsourced")
    print("\nVisibility keywords:")
    print("- High: customer, user, interface")
    print("- Medium: api, backend, integration")
    print("- Low: infrastructure, database, hosting\n")

def main():
    """Main execution"""
    
    print("Choose input method:")
    print("1. Interactive mode")
    print("2. Parse from file")
    print("3. Quick example")
    
    choice = input("\nSelect (1-3): ").strip()
    
    if choice == '1':
        components, dependencies = interactive_mode()
    elif choice == '2':
        filename = input("Enter filename: ").strip()
        with open(filename, 'r') as f:
            text = f.read()
        components, dependencies = quick_parse_input(text)
    else:
        # Quick example
        print("\nGenerating example map...")
        components = [
            {'name': 'User Interface', 'visibility': 0.95, 'evolution': 0.7},
            {'name': 'Business Logic', 'visibility': 0.7, 'evolution': 0.5},
            {'name': 'Custom Algorithm', 'visibility': 0.5, 'evolution': 0.3},
            {'name': 'Database', 'visibility': 0.3, 'evolution': 0.8},
            {'name': 'Cloud Hosting', 'visibility': 0.1, 'evolution': 0.9}
        ]
        dependencies = [
            ('User Interface', 'Business Logic'),
            ('Business Logic', 'Custom Algorithm'),
            ('Custom Algorithm', 'Database'),
            ('Database', 'Cloud Hosting')
        ]
    
    if not components:
        print("No components found. Exiting.")
        return
    
    # Generate the map
    print(f"\nGenerating map with {len(components)} components and {len(dependencies)} dependencies...")
    
    generator = WardleyMapGenerator()
    html_map = generator.create_map(components, dependencies)
    
    # Save the map
    output_file = 'quick_wardley_map.html'
    with open(output_file, 'w') as f:
        f.write(html_map)
    
    print(f"✓ Map saved to {output_file}")
    print("\nComponent Summary:")
    for comp in components:
        evolution_stage = (
            "Genesis" if comp['evolution'] < 0.2 else
            "Custom" if comp['evolution'] < 0.5 else
            "Product" if comp['evolution'] < 0.8 else
            "Commodity"
        )
        print(f"  - {comp['name']}: {evolution_stage} (vis:{comp['visibility']:.1f}, evo:{comp['evolution']:.1f})")

if __name__ == "__main__":
    main()