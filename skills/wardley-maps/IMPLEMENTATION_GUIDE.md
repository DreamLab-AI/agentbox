# Wardley Mapper Skill - Implementation Guide

## Quick Integration Checklist

### 1. Installation
```bash
# Install spaCy and download English model
pip install spacy
python -m spacy download en_core_web_sm
```

### 2. Verify Installation
```bash
cd multi-agent-docker/skills/wardley-maps/tools
python3 -c "from advanced_nlp_parser import AdvancedNLPParser; print('✓ NLP Parser ready')"
python3 -c "from heuristics_engine import get_heuristics_engine; print('✓ Heuristics Engine ready')"
python3 -c "from strategic_analyzer import StrategicAnalyzer; print('✓ Strategic Analyzer ready')"
python3 -c "from interactive_map_generator import InteractiveMapGenerator; print('✓ Interactive Maps ready')"
```

### 3. Register with Claude Code
```bash
# The skill should be auto-registered via MCP protocol
# Verify in Claude Code: /help or skill menu
```

## Module Reference

### Module 1: Advanced NLP Parser
**File**: `tools/advanced_nlp_parser.py`

**Main Class**: `AdvancedNLPParser`

**Methods**:
```python
parser = AdvancedNLPParser(use_spacy=True)

# Main parsing method
components, dependencies = parser.parse(text)

# Parse from JSON
components, deps = parse_components_json(json_string)

# Parse from text with NLP
components, deps = parse_components_text(text, use_advanced_nlp=True)
```

**Input Formats**:
- Natural language text
- JSON (structured)
- CSV/TSV (tabular)
- Plain list format

**Output**:
- `components`: List of dicts with `name`, `visibility`, `evolution`, `description`
- `dependencies`: List of tuples (source, target)

**Example**:
```python
text = """
Our platform has a customer-facing web interface built with React.
It communicates with a backend API for business logic.
The backend uses a custom machine learning model.
The ML model analyzes data from a PostgreSQL database.
Everything is hosted on AWS cloud infrastructure.
"""

parser = AdvancedNLPParser()
components, deps = parser.parse(text)

# Output:
# components: [
#   {'name': 'Customer Portal', 'visibility': 0.95, 'evolution': 0.7, ...},
#   {'name': 'Backend API', 'visibility': 0.6, 'evolution': 0.5, ...},
#   {'name': 'Machine Learning', 'visibility': 0.4, 'evolution': 0.35, ...},
#   {'name': 'PostgreSQL', 'visibility': 0.1, 'evolution': 0.9, ...},
#   {'name': 'AWS', 'visibility': 0.05, 'evolution': 0.95, ...}
# ]
# dependencies: [
#   ('Customer Portal', 'Backend API'),
#   ('Backend API', 'Machine Learning'),
#   ('Machine Learning', 'PostgreSQL'),
#   ('PostgreSQL', 'AWS')
# ]
```

### Module 2: Heuristics Engine
**File**: `tools/heuristics_engine.py`

**Main Class**: `HeuristicsEngine`

**Methods**:
```python
engine = get_heuristics_engine()

# Score a component
evolution, visibility = engine.score_component(name, context)

# Get rationale
rationale = engine.get_component_rationale(name, evolution, visibility)

# Export knowledge base
json_kb = engine.export_rules_to_json()
```

**Known Patterns** (40+):
- Databases: PostgreSQL (0.9 commodity), MongoDB (0.7 product), etc.
- Frontend: React (0.7 product), Vue (0.7 product)
- Cloud: AWS (0.95 commodity), Kubernetes (0.9 commodity)
- ML: TensorFlow (0.7 product), Custom Model (0.4 custom)

**Example**:
```python
engine = get_heuristics_engine()

# Known pattern - perfect accuracy
evo, vis = engine.score_component('PostgreSQL', {'is_database': True})
# Returns: (0.9, 0.15) - commodity infrastructure

# Unknown component - heuristic scoring
evo, vis = engine.score_component('CustomAuth', {'is_proprietary': True})
# Returns: (0.4, 0.3) - custom component with internal visibility

# Get rationale
engine.get_component_rationale('PostgreSQL', 0.9, 0.15)
# "Matches known Database pattern (commodity)"
```

### Module 3: Strategic Analyzer
**File**: `tools/strategic_analyzer.py`

**Main Class**: `StrategicAnalyzer`

**Methods**:
```python
analyzer = StrategicAnalyzer()

# Analyze a map
analysis = analyzer.analyze(components, dependencies)

# Export as markdown
markdown = StrategicAnalyzer.export_analysis_to_markdown(analysis)
```

**Analysis Output** (`MapAnalysis` dataclass):
- `total_components`: Count
- `total_dependencies`: Count
- `insights`: List of strategic insights
- `competitive_advantages`: List of component names
- `vulnerabilities`: List of risk descriptions
- `opportunities`: List of opportunities
- `threats`: List of threats
- `strategic_recommendations`: List of AI-generated strategies
- `evolution_trajectory`: Dict of component → "Stage → NextStage"
- `critical_path`: List of longest dependency chain

**Insight Types**:
- `STRENGTH`: Competitive advantages
- `VULNERABILITY`: Risk areas
- `OPPORTUNITY`: Growth potential
- `THREAT`: Competitive pressure
- `BOTTLENECK`: System constraints
- `EVOLUTION_READINESS`: Maturation signals

**Example**:
```python
analyzer = StrategicAnalyzer()

analysis = analyzer.analyze(
    components=[
        {'name': 'Frontend', 'visibility': 0.95, 'evolution': 0.7},
        {'name': 'Custom Engine', 'visibility': 0.4, 'evolution': 0.35},
        {'name': 'Database', 'visibility': 0.1, 'evolution': 0.9},
    ],
    dependencies=[
        ('Frontend', 'Custom Engine'),
        ('Custom Engine', 'Database')
    ]
)

print(analysis.competitive_advantages)
# ['Custom Engine'] - custom differentiator

print(analysis.strategic_recommendations)
# [
#   'INNOVATION LEADERSHIP: Accelerate development...',
#   'COMPETITIVE MOAT: Protect custom differentiators...',
#   ...
# ]

print(analysis.vulnerabilities)
# ['Custom Engine → Database (infrastructure risk)']
```

### Module 4: Interactive Map Generator
**File**: `tools/interactive_map_generator.py`

**Main Class**: `InteractiveMapGenerator`

**Methods**:
```python
gen = InteractiveMapGenerator(width=1200, height=800)

# Create interactive map with insights
html = gen.create_interactive_map(
    components=components,
    dependencies=dependencies,
    strategic_insights=insights_dict
)
```

**Insights Format**:
```python
insights = {
    'competitive_advantages': ['Custom ML Model'],
    'vulnerabilities': ['High-value component dependent on commodity'],
    'opportunities': ['Expand ML services'],
    'threats': ['Competitive ML platforms']
}
```

**Example**:
```python
from interactive_map_generator import create_interactive_wardley_map

html = create_interactive_wardley_map(
    components=[...],
    dependencies=[...],
    insights={...}
)

# Save to file
with open('map.html', 'w') as f:
    f.write(html)

# Open in browser - full D3.js interactive experience
# Features: zoom, pan, filter, tooltips, insights highlighting
```

### Module 5: MCP Tool (wardley_mapper.py)
**File**: `tools/wardley_mapper.py`

**Available Methods**:

#### parse_text
```json
{
  "method": "parse_text",
  "params": {
    "text": "Business description...",
    "use_advanced_nlp": true
  }
}
```

**Response**:
```json
{
  "success": true,
  "components": [...],
  "dependencies": [...],
  "component_count": 5,
  "dependency_count": 4
}
```

#### create_map
```json
{
  "method": "create_map",
  "params": {
    "text": "Business description...",
    "use_advanced_nlp": true
  }
}
```

**Response**:
```json
{
  "success": true,
  "map_html": "<html>...</html>",
  "component_count": 5,
  "dependency_count": 4,
  "components": [...],
  "dependencies": [...]
}
```

#### analyze_map
```json
{
  "method": "analyze_map",
  "params": {
    "components": [...],
    "dependencies": [...]
  }
}
```

**Response**:
```json
{
  "success": true,
  "analysis": {
    "total_components": 5,
    "competitive_advantages": ["Custom ML Model"],
    "vulnerabilities": ["..."],
    "opportunities": ["..."],
    "threats": ["..."],
    "strategic_recommendations": ["..."],
    "evolution_trajectory": {"Custom ML Model": "Custom → Product"},
    "critical_path": ["Frontend", "ML Model", "Database", "AWS"]
  },
  "markdown_report": "# Wardley Map Strategic Analysis...",
  "insights_count": 8,
  "insights": [...]
}
```

#### create_interactive_map
```json
{
  "method": "create_interactive_map",
  "params": {
    "components": [...],
    "dependencies": [...],
    "insights": {...}
  }
}
```

**Response**:
```json
{
  "success": true,
  "interactive_map_html": "<html>...</html>",
  "component_count": 5,
  "dependency_count": 4
}
```

## Usage Examples

### Example 1: Simple Business Description
```python
from tools.wardley_mapper import parse_text, create_map, analyze_map

# Parse business description
text = "We're a SaaS company with a React frontend, Node backend, and PostgreSQL database"

result = parse_text(text)
components = result['components']
dependencies = result['dependencies']

# Create visualization
map_result = create_map({'components': components, 'dependencies': dependencies})

# Analyze strategy
analysis = analyze_map({'components': components, 'dependencies': dependencies})

print(f"Competitive Advantages: {analysis['competitive_advantages']}")
print(f"Vulnerabilities: {analysis['vulnerabilities']}")
print(f"Recommendations: {analysis['strategic_recommendations']}")
```

### Example 2: Technical Architecture
```python
# Complex architecture
architecture = """
We use a microservices architecture:
- Angular frontend for user experience
- Multiple Node.js APIs for business logic
- Message queue (RabbitMQ) for async processing
- MongoDB for document storage
- Redis for caching
- Elasticsearch for search
- Deployed on Kubernetes on AWS
"""

components, deps = parse_components_text(architecture)
analysis = analyze_wardley_map(components, deps)

# Get recommendations
print("Strategic Recommendations:")
for rec in analysis.strategic_recommendations:
    print(f"  - {rec}")
```

### Example 3: Competitive Analysis
```python
competition = """
We compete with Competitor A who uses standard AWS + SalesForce.
Our advantage is our custom ML recommendation engine built in-house.
We also developed a proprietary database indexing technique.
Our weakness is our reliance on off-the-shelf payment processor.
"""

components, deps = parse_components_text(competition)
analysis = analyze_wardley_map(components, deps)

print("Our Strengths:")
for strength in analysis.competitive_advantages:
    print(f"  + {strength}")

print("Our Vulnerabilities:")
for vuln in analysis.vulnerabilities:
    print(f"  - {vuln}")

print("Market Threats:")
for threat in analysis.threats:
    print(f"  ⚠️  {threat}")
```

### Example 4: Interactive Visualization with Insights
```python
from interactive_map_generator import create_interactive_wardley_map
from strategic_analyzer import analyze_wardley_map

# Get analysis
analysis = analyze_wardley_map(components, deps)

# Create interactive map with insights
html = create_interactive_wardley_map(
    components=components,
    dependencies=deps,
    insights={
        'competitive_advantages': analysis.competitive_advantages,
        'vulnerabilities': [v for v in analysis.vulnerabilities],
        'opportunities': analysis.opportunities,
        'threats': analysis.threats
    }
)

# Save and open
with open('strategic_map.html', 'w') as f:
    f.write(html)

print("Open strategic_map.html in browser")
print("Features: Filter by stage/insight, hover for details, click for analysis")
```

## Troubleshooting

### Issue: spaCy model not found
**Solution**:
```bash
python -m spacy download en_core_web_sm
```

### Issue: NLP parser returning empty results
**Diagnosis**:
```python
# Check if spaCy is available
from advanced_nlp_parser import SPACY_AVAILABLE
print(f"spaCy available: {SPACY_AVAILABLE}")

# Test with fallback
parser = AdvancedNLPParser(use_spacy=False)  # Uses regex fallback
```

### Issue: Components positioned inaccurately
**Solution**: Check heuristics engine patterns
```python
from heuristics_engine import get_heuristics_engine
engine = get_heuristics_engine()

# View known patterns
patterns_json = engine.export_rules_to_json()

# Add custom pattern if needed (manual for now)
# Future: extend patterns database
```

### Issue: Strategic analysis too generic
**Solution**: Provide better context
```python
# Instead of:
components = [{'name': 'Database', 'visibility': 0.5, 'evolution': 0.5}]

# Provide:
components = [{
    'name': 'PostgreSQL Database',
    'visibility': 0.1,  # Better: clearly infrastructure
    'evolution': 0.9,   # Better: clear commodity
    'description': 'Our primary relational database'
}]
```

## Performance Considerations

### Large Maps (100+ components)
- NLP parsing: ~2-5 seconds
- Heuristics scoring: ~0.1 seconds per component
- Strategic analysis: ~0.5-1 second
- Interactive map generation: ~1-2 seconds
- **Total**: ~5-10 seconds end-to-end

### Memory Usage
- NLP parser + spaCy model: ~150MB
- Heuristics engine: ~5MB
- Strategic analyzer: ~2MB
- Interactive map HTML: ~100KB per component

### Optimization Tips
1. Use heuristics-only mode for speed (disable spaCy)
2. Batch analysis for multiple maps
3. Cache analysis results
4. Limit component count to 50-100 for interactive maps

## Testing

### Unit Test Example
```python
from advanced_nlp_parser import AdvancedNLPParser
from heuristics_engine import get_heuristics_engine

# Test NLP
parser = AdvancedNLPParser()
comps, deps = parser.parse("React frontend with PostgreSQL backend")
assert len(comps) >= 2, "Failed to extract components"

# Test Heuristics
engine = get_heuristics_engine()
evo, vis = engine.score_component('PostgreSQL', {})
assert evo > 0.8, "PostgreSQL should be commodity"

print("✓ All tests passed")
```

## API Documentation

Complete API reference in docstrings:
```bash
# View module docstrings
python3 -c "import tools.advanced_nlp_parser; help(tools.advanced_nlp_parser.AdvancedNLPParser)"
python3 -c "import tools.heuristics_engine; help(tools.heuristics_engine.HeuristicsEngine)"
python3 -c "import tools.strategic_analyzer; help(tools.strategic_analyzer.StrategicAnalyzer)"
python3 -c "import tools.interactive_map_generator; help(tools.interactive_map_generator.InteractiveMapGenerator)"
```

---

For questions or issues, refer to the main README.md and SKILL_UPGRADE_SUMMARY.md
