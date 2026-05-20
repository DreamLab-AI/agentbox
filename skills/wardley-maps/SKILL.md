---
name: wardley-maps
description: "Comprehensive Wardley mapping toolkit that transforms any input (structured data, unstructured text, business descriptions, technical architectures, competitive landscapes, or abstract concepts) into strategic Wardley maps. Default render path is **Mermaid `wardley-beta`** (mmdc 11.15.0+) -- pure code, version-controllable, GitHub-native, no external service. Legacy OnlineWardleyMaps `.owm` and OWM->Mermaid conversion via tractorjuice/wardley-maps-mermaid tooling. Use when creating strategic Wardley maps showing component evolution and value chains for decision-making."
---

# Wardley Mapper

Transform ANY input into a strategic Wardley map for understanding competitive positioning and evolution.

## Render Paths (pick one)

| Path | Tooling | When |
|------|---------|------|
| **Mermaid `wardley-beta`** *(default)* | `mmdc` 11.15.0+ from the `mermaid-diagrams` skill | Plain `.mmd` files, GitHub-native preview, embed in markdown/LaTeX, version-control friendly |
| OnlineWardleyMaps (`.owm`) | https://onlinewardleymaps.com or tractorjuice converter | Editing in the canonical web tool, exporting CC-BY-SA assets |
| Custom HTML/SVG | `scripts/generate_wardley_map.py` here | Bespoke interactivity / report-builder dark-theme dashboards |

Mermaid 11.15.0 (2026-05-11) finalised `wardley-beta` grammar -- hyphenated
names render unquoted, label sanitisation no longer mangles parentheses,
all 147 maps in the upstream `WARDLEY-MAP-REPOSITORY` parse cleanly. This
is now the recommended default.

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

### Mermaid `wardley-beta` (default)

Emit `.mmd` text; render with `mmdc` from the `mermaid-diagrams` skill.

```
wardley-beta
title AI Assistant Stack -- 2026-05
size [1100, 700]
evolution genesis / concept -> custom / emerging -> product / converging -> commodity / accepted

anchor user [0.95, 0.45]
anchor regulator [0.95, 0.10]

component "Chat UX" [0.86, 0.45] label [12, -6]
component "Agent loop" [0.62, 0.45] label [12, -6]
component "Frontier LLM" [0.55, 0.45] label [12, -6]
component "GPU fleet" [0.20, 0.45] label [12, -6]
component "Eval / Guardrails" [0.42, 0.18] label [-6, -12]

user -> "Chat UX"
"Chat UX" -> "Agent loop"
"Agent loop" -> "Frontier LLM"
"Frontier LLM" -> "GPU fleet"
regulator -> "Eval / Guardrails"
"Eval / Guardrails" -> "Frontier LLM"

evolve "Frontier LLM" 0.80
evolve "Eval / Guardrails" 0.40
```

Render:

```bash
mmdc -i map.mmd -o map.svg                                # vector
mmdc -i map.mmd -o map.png -w 2000 -H 1200 -b transparent # high-DPI raster
mmdc -i map.mmd -o map.pdf                                # LaTeX inclusion
```

Grammar reference (Mermaid 11.15.0): https://mermaid.js.org/syntax/wardleyMap.html
Curated example corpus (147 maps, lossless OWM->Mermaid): https://github.com/tractorjuice/wardley-maps-mermaid

### OWM (`.owm`) input -> Mermaid

The upstream tractorjuice repo ships a pure-stdlib Node.js converter:

```bash
# One-off: convert a single .owm to .mmd
git clone https://github.com/tractorjuice/wardley-maps-mermaid /tmp/wmm
node /tmp/wmm/tools/regenerate.mjs --root /path/with/owm/files

# Or batch via the converter package (no npm deps, Node 18+)
node /tmp/wmm/tools/regenerate.mjs --dry-run   # preview
node /tmp/wmm/tools/regenerate.mjs              # write .mmd siblings
```

Fidelity: 100% component / anchor / link retention, evolution-coordinate
drift exactly 0.0, mean visibility drift 0.008 (grammar-level pipeline-
block inheritance, not a converter bug).

### Custom HTML/SVG (bespoke interactivity)

```python
# scripts/generate_wardley_map.py -- retained for report-builder
from scripts.generate_wardley_map import WardleyMapGenerator
generator = WardleyMapGenerator()
map_html = generator.create_map(components, dependencies)
```

### Text-Based Sketch

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

1. **Mermaid `.mmd`** *(default, version-controllable, GitHub-native)*
2. **SVG / PNG / PDF** via `mmdc` (calls into the `mermaid-diagrams` skill)
3. **Interactive HTML**: Full visualization with tooltips (custom path)
4. **JSON Structure**: For programmatic use
5. **Strategic Report**: Analysis and recommendations

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
