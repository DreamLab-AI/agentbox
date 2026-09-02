# Wardley Mapper Skill - Advanced Strategic Mapping Engine

## 🎯 Overview

This comprehensive Claude skill transforms ANY input into strategic Wardley maps with **automatic strategic analysis**. Features include:

- 🧠 **Advanced NLP**: spaCy-based entity extraction and dependency parsing
- 📊 **Intelligent Positioning**: Heuristics engine for accurate component placement
- 💡 **Strategic Analysis**: Automatic SWOT, opportunities, threats, and recommendations
- 🎨 **Interactive Visualization**: D3.js-powered interactive maps with filtering and insights
- ⚙️ **Smart Heuristics**: Machine-readable knowledge base from strategic frameworks

Whether you have structured data, unstructured text, business descriptions, technical architectures, or competitive landscapes - this skill will create insightful visual maps with actionable strategic recommendations.

## 🚀 Quick Start

### Method 1: MCP Tool Interface (Claude Native)
```json
// Parse text to extract components
{
  "method": "parse_text",
  "params": {
    "text": "Our platform uses React frontend with PostgreSQL database hosted on AWS...",
    "use_advanced_nlp": true
  }
}

// Create and analyze map
{
  "method": "create_map",
  "params": {
    "text": "Our platform uses React frontend...",
    "use_advanced_nlp": true
  }
}

// Generate strategic analysis
{
  "method": "analyze_map",
  "params": {
    "components": [...],
    "dependencies": [...]
  }
}

// Create interactive D3.js visualization
{
  "method": "create_interactive_map",
  "params": {
    "components": [...],
    "dependencies": [...],
    "insights": {...}
  }
}
```

### Method 2: Interactive CLI Mode
```bash
# quick_map.py was ported to Rust -- same 3-choice menu (interactive / parse-from-file
# / quick-example), same prompts, now a compiled binary instead of a Python script.
wardley-quick-map
# Follow the prompts to create your map
```

### Method 3: Advanced NLP Parsing
```python
from tools.advanced_nlp_parser import parse_components_text

# Natural language parsing with spaCy
text = "We provide cloud-based analytics with custom ML models on AWS infrastructure"
components, dependencies = parse_components_text(text, use_advanced_nlp=True)

# Result:
# components: [
#   {'name': 'Cloud Analytics', 'visibility': 0.9, 'evolution': 0.65},
#   {'name': 'Custom ML Models', 'visibility': 0.4, 'evolution': 0.35},
#   {'name': 'AWS Infrastructure', 'visibility': 0.05, 'evolution': 0.95}
# ]
# dependencies: [
#   ('Cloud Analytics', 'Custom ML Models'),
#   ('Custom ML Models', 'AWS Infrastructure')
# ]
```

### Method 4: Intelligent Heuristics-Based Positioning

`heuristics_engine.py` was ported to Rust; there is no importable
`get_heuristics_engine()` any more. Heuristics are applied automatically inside
`create_map` (Method 1, exact pattern-name matches only), or explored directly with
the `wardley-heuristics` demo binary:
```bash
$ wardley-heuristics
PostgreSQL Database:
  Evolution: 0.90 (Commodity)
  Visibility: 0.15 (Low (Infrastructure/Internal))
  Rationale: Infrastructure component typically at commodity stage
```

### Method 5: Strategic Analysis

`strategic_analyzer.py` was ported to Rust; use `wardley-mapper`'s `analyze_map`
method (Method 1) instead of importing `analyze_wardley_map`:
```bash
echo '{"method":"analyze_map","params":{"components":COMPONENTS,"dependencies":DEPENDENCIES}}' \
  | wardley-mapper | jq '.result.analysis'
# -> {"competitive_advantages": [...], "vulnerabilities": [...],
#     "opportunities": [...], "threats": [...], ...}

# The markdown report is included in the same response:
echo '{"method":"analyze_map","params":{"components":COMPONENTS,"dependencies":DEPENDENCIES}}' \
  | wardley-mapper | jq -r '.result.markdown_report'
```

### Method 6: Interactive Visualization

`interactive_map_generator.py` was ported to Rust; use `wardley-mapper`'s
`create_interactive_map` method:
```bash
echo '{"method":"create_interactive_map","params":{
  "components": COMPONENTS,
  "dependencies": DEPENDENCIES,
  "insights": {
    "competitive_advantages": ["Custom ML Model"],
    "vulnerabilities": ["PostgreSQL dependency"],
    "opportunities": ["Expand ML services"],
    "threats": ["Competitive ML platforms"]
  }
}}' | wardley-mapper | jq -r '.result.interactive_map_html' > interactive_map.html
```

### Method 7: From Structured Data

`generate_wardley_map.py` was ported to Rust; use `wardley-mapper`'s `create_map`
method:
```bash
echo '{"method":"create_map","params":{
  "components": [
    {"name": "User Interface", "visibility": 0.9, "evolution": 0.7},
    {"name": "Backend API", "visibility": 0.6, "evolution": 0.5},
    {"name": "Database", "visibility": 0.3, "evolution": 0.8}
  ],
  "dependencies": [["User Interface", "Backend API"], ["Backend API", "Database"]]
}}' | wardley-mapper | jq -r '.result.map_html' > map.html
```
Or the standalone `wardley-generate` demo binary for the fixed example map.

### Method 8: Use Pre-built Templates
```bash
# Load a template's components/dependencies from assets/templates.json and pipe them
# straight into wardley-mapper's create_map (templates.json itself doesn't invoke any
# ported script -- it's plain data, unaffected by the Rust port).
components=$(jq '.templates["e-commerce"].components' assets/templates.json)
dependencies=$(jq '.templates["e-commerce"].dependencies' assets/templates.json)

jq -n --argjson c "$components" --argjson d "$dependencies" \
  '{method:"create_map", params:{components:$c, dependencies:$d}}' \
  | wardley-mapper | jq -r '.result.map_html' > map.html
```

## 🎨 Key Features

### Phase 1: Advanced Input Processing

#### Advanced NLP Parser (`advanced_nlp_parser.py`)
- **spaCy Integration**: Named Entity Recognition (NER) for component identification
- **Dependency Parsing**: Automatic relationship extraction
- **Context Analysis**: Multi-observer synthesis of evolution and visibility
- **Multiple Input Formats**: Natural language, JSON, CSV, plain text

```python
from tools.advanced_nlp_parser import parse_components_text

# Natural language parsing with spaCy
text = "Our platform uses React frontend with a custom ML engine..."
components, dependencies = parse_components_text(text, use_advanced_nlp=True)
```

#### Programmatic Heuristics Engine (Rust: `services/skill-tools/src/wardley/heuristics.rs`; was `heuristics_engine.py`)
- **Knowledge Base**: Machine-readable heuristics from Wardley theory
- **Pattern Matching**: 12 exact-match component patterns (PostgreSQL, React,
  Kubernetes, etc.), each with 2-3 fuzzy-match examples
- **Domain-Specific Rules**: Technical, business, competitive, financial scoring
- **Confidence Scoring**: Rationale for each component positioning

Applied automatically inside `create_map` (exact pattern-name matches only), or
explored directly:
```bash
$ wardley-heuristics   # runs score_component + get_component_rationale over a fixed
                        # set of test components, then prints the JSON knowledge base
```

### Phase 2: Automated Strategic Analysis

#### Strategic Analyzer (Rust: `services/skill-tools/src/wardley/strategic_analyzer.rs`; was `strategic_analyzer.py`)
Automatically generates strategic insights:
- **Competitive Advantages**: Custom differentiators in Genesis/Custom stages
- **Vulnerabilities**: High-value components dependent on unstable infrastructure
- **Opportunities**: Components ready for commoditization or market expansion
- **Threats**: Commoditization risks and competitive pressures
- **Evolution Readiness**: Components approaching next evolution stage
- **Critical Path**: Longest dependency chains indicating execution complexity

```bash
echo '{"method":"analyze_map","params":{"components":COMPONENTS,"dependencies":DEPENDENCIES}}' \
  | wardley-mapper | jq '.result.analysis | {strategic_recommendations, vulnerabilities, opportunities}'
```

#### Markdown Report Generation
Export strategic analysis as formatted markdown:

```markdown
# Wardley Map Strategic Analysis Report

## Competitive Advantages
- Custom Recommendation Engine: Custom-built competitive moat
- Proprietary ML Model: Custom-built competitive moat

## Vulnerabilities
- Recommendation Engine → PostgreSQL Database (infrastructure risk)
- Custom ML Model → AWS Infrastructure (single point of failure)

## Strategic Recommendations
1. INNOVATION LEADERSHIP: Accelerate development of genesis-stage innovations...
2. COMPETITIVE MOAT: Protect your custom differentiators from commoditization...
```

### Phase 3: Interactive Visualization

#### D3.js-Powered Interactive Maps (Rust: `services/skill-tools/src/wardley/interactive.rs`; was `interactive_map_generator.py`)
- **Pan & Zoom**: Explore large maps
- **Component Filtering**: Filter by evolution stage or insight type
- **Hover Tooltips**: Detailed component information on hover
- **Strategic Highlighting**: Components colored by insight type
- **Real-time Insights**: Visual indication of strengths, vulnerabilities, opportunities, threats

#### Interactive Features
- **Legend**: Color-coded component types
- **Instructions**: Built-in user guide
- **Info Panel**: Click components for detailed analysis
- **Grid Toggle**: Show/hide evolution stages
- **Reset Zoom**: Return to default view

### Phase 4: Universal Input Processing
- **Business Descriptions** → Strategic maps with analysis
- **Technical Architectures** → System maps with risk identification
- **Competitive Intelligence** → Market maps with threat assessment
- **Financial Data** → Value chain maps with evolution predictions
- **Organizational Structures** → Capability maps with bottleneck detection

### Intelligent Component Positioning
- **Advanced Scoring**: Multi-factor evolution/visibility assessment
- **Y-Axis (Value Chain)**: Automatic visibility assessment
- **X-Axis (Evolution)**: Smart evolution stage detection
  - Genesis (0.0-0.2): Novel, experimental
  - Custom (0.2-0.5): Differentiated, proprietary
  - Product (0.5-0.8): Standardizing, competing
  - Commodity (0.8-1.0): Utility, outsourced

### Visual Output Options
- **Interactive HTML**: D3.js visualization with insights
- **Static SVG**: For presentations
- **PNG Export**: For documents
- **JSON Format**: For programmatic use
- **Markdown Reports**: Strategic analysis documents

## 🧠 How It Works

### 1. Input Analysis
The skill uses pattern recognition to identify:
- Components (nouns, entities, capabilities)
- Relationships (dependencies, flows)
- Evolution indicators (maturity keywords)
- Value indicators (user proximity)

### 2. Intelligent Mapping
- **NLP Processing**: Extracts meaning from text
- **Pattern Matching**: Identifies strategic patterns
- **Context Analysis**: Understands domain specifics
- **Relationship Inference**: Detects dependencies

### 3. Strategic Analysis
Beyond visualization, the skill provides:
- Evolution predictions
- Competitive positioning
- Strategic options
- Risk identification
- Opportunity detection

## 📊 Example Use Cases

### Startup Strategy```
"We're building an AI chatbot platform using GPT-4, 
with custom training on industry data, deployed on AWS"
```
→ Map shows GPT-4 as commodity, custom training as differentiator

### Digital Transformation```
"Modernizing our legacy mainframe systems with cloud-native 
microservices and API-first architecture"```
→ Map reveals evolution gaps and transformation pathway

### Competitive Analysis
```
"Competitors use standard CRM, we've built proprietary 
customer intelligence with predictive analytics"
```
→ Map highlights competitive advantage in custom analytics

## 🛠️ Customization

### Modify Evolution Assessment
Edit `references/business-mapper.md` evolution keywords

### Add Industry Templates
Add to `assets/templates.json`

### Enhance NLP Processing
Modify `services/skill-tools/src/wardley/quick_map.rs` (`quick_parse_input`,
`advanced_nlp_parse`) and rebuild -- was `tools/quick_map.py`.

### Style Customization
Edit the embedded HTML/CSS in `services/skill-tools/src/wardley/generator_template.rs`
and rebuild -- was `tools/generate_wardley_map.py`.

## 📈 Strategic Patterns Included

The skill includes advanced strategic patterns:
- **Commoditization plays**
- **Innovation strategies**
- **Ecosystem building**
- **Disruption patterns**
- **Platform strategies**
- **Red Queen dynamics**

## 🔍 Validation

Each generated map includes:
- ✅ Clear user need
- ✅ Justified evolution positions
- ✅ Mapped dependencies
- ✅ No orphaned components
- ✅ Actionable insights

## 💡 Pro Tips

1. **Start Simple**: Begin with high-level components, refine later
2. **Challenge Positions**: Question evolution assumptions
3. **Look for Gaps**: Empty spaces often reveal opportunities
4. **Track Movement**: Components evolve over time
5. **Consider Inertia**: Not everything evolves at same pace

## 📚 References

Based on Simon Wardley's pioneering work in strategic mapping:
- Book: "Wardley Maps" (included as source)
- Evolution characteristics
- Climatic patterns
- Doctrine principles
- Strategic gameplay

## 🚦 Getting Started

1. **Open the example**: `examples/visionclaw_wardley_map.html`
2. **Read the analysis**: `examples/visionclaw_analysis.md`
3. **Try the interactive tool**: Run `wardley-quick-map`
4. **Create your own map**: Use any input method above

## 🎯 This Skill Enables You To

- **See** your competitive landscape clearly
- **Understand** evolution and change
- **Identify** strategic opportunities
- **Predict** market movements
- **Communicate** strategy visually
- **Make** better decisions

## 🔮 Future Enhancements

Potential additions:
- Real-time collaboration features
- AI-powered strategy suggestions
- Industry benchmark overlays
- Evolution simulation over time
- Competitive war gaming
- API integration for live data

---

**Created with the Wardley Mapper Skill v1.0**
Transform anything into strategic insight! 🗺️