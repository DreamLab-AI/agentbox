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
cd multi-agent-docker/skills/wardley-maps/tools
python3 quick_map.py
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
```python
from tools.heuristics_engine import get_heuristics_engine

engine = get_heuristics_engine()

# Score components with domain knowledge
evolution, visibility = engine.score_component(
    'PostgreSQL',
    {'is_infrastructure': True}
)
# Returns: (0.9, 0.15) - correctly identified as commodity infrastructure

# Get positioning rationale
rationale = engine.get_component_rationale('PostgreSQL', 0.9, 0.15)
# Returns: "Matches known Database pattern (commodity)"
```

### Method 5: Strategic Analysis
```python
from tools.strategic_analyzer import analyze_wardley_map

components = [...]
dependencies = [...]

analysis = analyze_wardley_map(components, dependencies)

# Access strategic insights
print(f"Strengths: {analysis.competitive_advantages}")
print(f"Risks: {analysis.vulnerabilities}")
print(f"Opportunities: {analysis.opportunities}")
print(f"Threats: {analysis.threats}")

# Export as markdown report
markdown_report = analysis.__class__.export_analysis_to_markdown(analysis)
```

### Method 6: Interactive Visualization
```python
from tools.interactive_map_generator import create_interactive_wardley_map

html = create_interactive_wardley_map(
    components=components,
    dependencies=dependencies,
    insights={
        'competitive_advantages': ['Custom ML Model'],
        'vulnerabilities': ['PostgreSQL dependency'],
        'opportunities': ['Expand ML services'],
        'threats': ['Competitive ML platforms']
    }
)

with open('interactive_map.html', 'w') as f:
    f.write(html)
```

### Method 7: From Structured Data
```python
from tools.generate_wardley_map import WardleyMapGenerator

# Define components with visibility and evolution
components = [
    {"name": "User Interface", "visibility": 0.9, "evolution": 0.7},
    {"name": "Backend API", "visibility": 0.6, "evolution": 0.5},
    {"name": "Database", "visibility": 0.3, "evolution": 0.8}
]

# Define relationships
dependencies = [
    ("User Interface", "Backend API"),
    ("Backend API", "Database")
]

# Generate map
generator = WardleyMapGenerator()
html = generator.create_map(components, dependencies)
```

### Method 8: Use Pre-built Templates
```python
import json
from tools.generate_wardley_map import WardleyMapGenerator

# Load templates
with open('assets/templates.json') as f:
    templates = json.load(f)

# Get e-commerce template
ecommerce = templates['templates']['e-commerce']
components = ecommerce['components']
dependencies = ecommerce['dependencies']

# Generate map
generator = WardleyMapGenerator()
html = generator.create_map(components, dependencies)
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

#### Programmatic Heuristics Engine (`heuristics_engine.py`)
- **Knowledge Base**: Machine-readable heuristics from Wardley theory
- **Pattern Matching**: 40+ component patterns (PostgreSQL, React, Kubernetes, etc.)
- **Domain-Specific Rules**: Technical, business, competitive, financial scoring
- **Confidence Scoring**: Rationale for each component positioning

```python
from tools.heuristics_engine import get_heuristics_engine

engine = get_heuristics_engine()
evolution, visibility = engine.score_component('PostgreSQL', context)
rationale = engine.get_component_rationale('PostgreSQL', evolution, visibility)
```

### Phase 2: Automated Strategic Analysis

#### Strategic Analyzer (`strategic_analyzer.py`)
Automatically generates strategic insights:
- **Competitive Advantages**: Custom differentiators in Genesis/Custom stages
- **Vulnerabilities**: High-value components dependent on unstable infrastructure
- **Opportunities**: Components ready for commoditization or market expansion
- **Threats**: Commoditization risks and competitive pressures
- **Evolution Readiness**: Components approaching next evolution stage
- **Critical Path**: Longest dependency chains indicating execution complexity

```python
from tools.strategic_analyzer import analyze_wardley_map

analysis = analyze_wardley_map(components, dependencies)
print(analysis.strategic_recommendations)  # AI-generated strategy advice
print(analysis.vulnerabilities)  # Risk identification
print(analysis.opportunities)  # Growth opportunities
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

#### D3.js-Powered Interactive Maps (`interactive_map_generator.py`)
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
Modify `tools/quick_map.py` parsing functions

### Style Customization
Edit HTML/CSS in `tools/generate_wardley_map.py`

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

1. **Open the example**: `examples/visionflow_wardley_map.html`
2. **Read the analysis**: `examples/visionflow_analysis.md`
3. **Try the interactive tool**: Run `tools/quick_map.py`
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