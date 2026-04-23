---
name: wardley-mapper
description: Comprehensive Wardley mapping toolkit that transforms any input (structured data, unstructured text, business descriptions, technical architectures, competitive landscapes, or abstract concepts) into strategic Wardley maps. Creates visual maps showing component evolution and value chains for strategic decision-making.
---

# Wardley Mapper

Transform ANY input into a strategic Wardley map for understanding competitive positioning and evolution.

## Quick Start

1. **Identify the scope**: What system/business/concept are we mapping?
2. **Find the user**: Who is the primary beneficiary?
3. **Extract components**: What capabilities/activities exist?
4. **Determine evolution**: Where does each component sit on the evolution axis?
5. **Map dependencies**: How do components connect?
6. **Generate visualization**: Create the map

## Core Mapping Process

### Step 1: User & Scope Identification

```python
# Always start with the user need
user_need = identify_primary_user_need(input_data)
scope = define_boundary(input_data)
```

Key questions:
- Who is the primary user/customer?
- What need are we fulfilling?
- What is the boundary of our system?

### Step 2: Component Extraction

Components can be:
- **Activities**: Things we do (e.g., "customer support", "data analysis")
- **Practices**: How we do things (e.g., "agile methodology", "DevOps")
- **Data**: Information assets (e.g., "customer database", "analytics")
- **Knowledge**: Expertise and capabilities (e.g., "ML expertise", "domain knowledge")

For different input types:
- **Structured data**: Extract entities, relationships, processes
- **Text descriptions**: Use NLP to identify nouns (components) and verbs (activities)
- **Technical architectures**: Map services, infrastructure, dependencies
- **Business models**: Extract value propositions, channels, resources

### Step 3: Evolution Assessment

Use the evolution characteristics matrix:

| Stage | Genesis | Custom | Product | Commodity |
|-------|---------|--------|---------|-----------|
| **Ubiquity** | Rare | Slowly increasing | Rapidly increasing | Widespread |
| **Certainty** | Poorly understood | Rapid learning | Rapid learning | Known |
| **Market** | Undefined | Forming | Growing | Mature |
| **Failures** | High/unpredictable | High/reducing | Low | Very low |
| **Competition** | N/A | Emerging | High | Utility |

### Step 4: Value Chain Positioning

Position components on Y-axis by visibility/value:
- **Top (visible)**: User-facing, differentiating
- **Middle**: Supporting capabilities
- **Bottom (invisible)**: Infrastructure, utilities

### Step 5: Dependency Mapping

Connect components showing:
- Direct dependencies (solid lines)
- Data flows (dashed lines)
- Constraints (red lines)

## Input Type Handlers

### For Business Descriptions
See [references/business-mapper.md](references/business-mapper.md)

### For Technical Systems
See [references/technical-mapper.md](references/technical-mapper.md)

### For Competitive Analysis
See [references/competitive-mapper.md](references/competitive-mapper.md)

### For Data/Metrics
See [references/data-mapper.md](references/data-mapper.md)

## Map Generation

### HTML/SVG Visualization

```python
# Use scripts/generate_wardley_map.py
from scripts.generate_wardley_map import WardleyMapGenerator

generator = WardleyMapGenerator()
map_html = generator.create_map(components, dependencies)
```

### Text-Based Map

```
User Need
    |
    +-- [Visible Component] ------------> Product (0.7)
            |
            +-- [Supporting Component] ---> Custom (0.4)
                    |
                    +-- [Infrastructure] --> Commodity (0.9)
```

## Advanced Patterns

### Inertia Identification
Components resisting evolution despite market forces

### Gameplay Patterns
- **Commoditization play**: Push products to utility
- **Innovation play**: Create new genesis components
- **Ecosystem play**: Build platforms at product stage

### Strategic Movements
See [references/strategic-patterns.md](references/strategic-patterns.md)

## Validation Checklist

✓ User need clearly defined
✓ All components have evolution position
✓ Dependencies mapped
✓ No orphaned components
✓ Evolution positions justified
✓ Map tells coherent story

## Output Formats

1. **Interactive HTML**: Full visualization with tooltips
2. **Static SVG**: For presentations/documents
3. **JSON Structure**: For programmatic use
4. **Strategic Report**: Analysis and recommendations

## Quick Command

For instant mapping:
```python
# Read the input and generate map immediately
exec(open('scripts/quick_map.py').read())
```

## Quality Indicators

Good maps have:
- Clear user focus
- Logical value chains
- Justified evolution positions
- Actionable insights
- Strategic options visible
