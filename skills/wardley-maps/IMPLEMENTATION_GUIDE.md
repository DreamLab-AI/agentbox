# Wardley Mapper Skill - Implementation Guide

## Quick Integration Checklist

### 1. Installation
```bash
# Install spaCy and download English model
pip install spacy
python -m spacy download en_core_web_sm
```

### 2. Verify Installation

Modules 2-5 below (`heuristics_engine.py`, `strategic_analyzer.py`,
`interactive_map_generator.py`, `wardley_mapper.py`) were ported to Rust and now ship
as `services/skill-tools` binaries -- there is no Python module to import for them any
more, so the smoke test is running the binary instead. Module 1
(`advanced_nlp_parser.py`, spaCy-based) stays Python and unchanged; its smoke test is
unchanged too.

```bash
cd <agentbox>/skills/wardley-maps/tools
python3 -c "from advanced_nlp_parser import AdvancedNLPParser; print('✓ NLP Parser ready')"

# Rust binaries (built once from services/skill-tools with `cargo build --release`):
wardley-heuristics >/dev/null && echo "✓ Heuristics Engine ready"
echo '{"method":"analyze_map","params":{"components":[{"name":"A","visibility":0.5,"evolution":0.5}],"dependencies":[]}}' \
  | wardley-mapper >/dev/null && echo "✓ Strategic Analyzer ready"
wardley-interactive >/dev/null && echo "✓ Interactive Maps ready"
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
**File**: `services/skill-tools/src/wardley/heuristics.rs` (Rust port; was
`tools/heuristics_engine.py`)

**Main type**: `skill_tools::wardley::heuristics::HeuristicsEngine`. There is no
importable Python module any more -- `HeuristicsEngine` is not a library end users
call directly. Two ways to reach it:

- **`wardley-heuristics`**: a standalone demo binary that runs a fixed set of test
  components through `score_component`/`get_component_rationale` and prints the same
  format the old `python3 heuristics_engine.py` demo did, plus the JSON knowledge-base
  export (`export_rules_to_json`). Good for exploring how a given component name
  scores.
- **`wardley-mapper`'s `create_map` method**: applies heuristics automatically to
  every component whose `name` is an *exact* match against a known pattern (see
  "Known Patterns" below) -- this is the production code path, not a library call.

**Known Patterns** (12 exact-match keys, each with fuzzy-match examples):
- Databases: PostgreSQL (commodity, 0.15 visibility), MySQL (commodity), MongoDB
  (product)
- Frontend: React (product, 0.8 visibility), Vue (product)
- Cloud: AWS (commodity, 0.1 visibility), Kubernetes (commodity, 0.05 visibility)
- ML: TensorFlow (product), PyTorch (product), "ML Model" (custom)
- API/Auth: REST API (commodity), OAuth2 (commodity)

**Example** -- `wardley-heuristics` output for two of its built-in test components:
```
$ wardley-heuristics
=== Heuristics Engine Testing ===

PostgreSQL Database:
  Evolution: 0.90 (Commodity)
  Visibility: 0.15 (Low (Infrastructure/Internal))
  Rationale: Infrastructure component typically at commodity stage
...
```

**Example** -- applying heuristics via `wardley-mapper`'s `create_map` (only an
*exact* pattern-name match gets its `evolution`/`visibility` overwritten; a fuzzy
match like `"PostgreSQL Database"` is scored internally but the score is discarded --
see the Wardley port report for why this is a faithful reproduction of the Python
original, not a simplification):
```bash
echo '{"method":"create_map","params":{"components":[{"name":"PostgreSQL","visibility":0.5,"evolution":0.5}]}}' \
  | wardley-mapper
# -> components[0].visibility becomes 0.15 (exact pattern match, overwritten)
```

### Module 3: Strategic Analyzer
**File**: `services/skill-tools/src/wardley/strategic_analyzer.rs` (Rust port; was
`tools/strategic_analyzer.py`)

> **Note**: the Python original could never actually run this module -- its `analyze`
> method's return-type annotation referenced an undefined name (`StrategicAnalysis`
> instead of the `MapAnalysis` class actually defined and returned), which raises
> `NameError` at import time, unconditionally, every time. `wardley_mapper.py` imports
> this module at its own top level, so the entire MCP tool was dead on arrival. The
> Rust port fixes this one dangling annotation and is otherwise a straight port -- see
> the Wardley port report for the full writeup and verification.

**Main type**: `skill_tools::wardley::strategic_analyzer::StrategicAnalyzer`. Reached
via:

- **`wardley-strategic-analyzer`**: standalone demo binary, same test data and
  markdown output as the (never-actually-runnable) Python `__main__` demo.
- **`wardley-mapper`'s `analyze_map` method**: the production JSON entry point (see
  Module 5 below).

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

**Example** -- via `wardley-mapper`'s `analyze_map` (see Module 5 for the full JSON
contract):
```bash
echo '{"method":"analyze_map","params":{
  "components":[
    {"name":"Frontend","visibility":0.95,"evolution":0.7},
    {"name":"Custom Engine","visibility":0.4,"evolution":0.35},
    {"name":"Database","visibility":0.1,"evolution":0.9}
  ],
  "dependencies":[["Frontend","Custom Engine"],["Custom Engine","Database"]]
}}' | wardley-mapper
```
```json
{"result": {
  "success": true,
  "analysis": {
    "competitive_advantages": ["Custom Engine"],
    "vulnerabilities": ["Custom Engine → Database"],
    "strategic_recommendations": [
      "COMPETITIVE MOAT: Protect your custom differentiators (Custom Engine) ...",
      "..."
    ]
  },
  "markdown_report": "# Wardley Map Strategic Analysis Report\n..."
}}
```

### Module 4: Interactive Map Generator
**File**: `services/skill-tools/src/wardley/interactive.rs` (Rust port; was
`tools/interactive_map_generator.py`)

> **Critical bug fixed, not merely replicated**: the Python original's embedded
> `const data = {{{json.dumps(...)}}};` double-brace f-string escaping produced
> **invalid JavaScript** (`SyntaxError: Unexpected token '{'`, verified with `node -e`)
> -- every interactive map this tool ever generated failed to render anything in a
> real browser. The Rust port emits a single, valid `const data = {...};` JSON object.
> See the Wardley port report for the full before/after evidence.

**Main type**: `skill_tools::wardley::interactive::InteractiveMapGenerator`. Reached
via:

- **`wardley-interactive`**: standalone demo binary, writes
  `interactive_wardley_map.html` from the same fixed test data the Python demo used.
- **`wardley-mapper`'s `create_interactive_map` method**: the production JSON entry
  point.

**Insights Format** (unchanged JSON shape, still passed as the `insights` param):
```json
{
  "competitive_advantages": ["Custom ML Model"],
  "vulnerabilities": ["High-value component dependent on commodity"],
  "opportunities": ["Expand ML services"],
  "threats": ["Competitive ML platforms"]
}
```

**Example**:
```bash
echo '{"method":"create_interactive_map","params":{
  "components":[{"name":"Custom ML Model","visibility":0.4,"evolution":0.35}],
  "dependencies":[],
  "insights":{"competitive_advantages":["Custom ML Model"]}
}}' | wardley-mapper > response.json

# Extract the HTML and open it in a browser -- full D3.js interactive experience.
# Features: zoom, pan, filter, tooltips, insights highlighting.
python3 -c "import json,sys; print(json.load(open('response.json'))['result']['interactive_map_html'])" > map.html
```

### Module 5: MCP Tool (wardley-mapper)
**File**: `services/skill-tools/src/wardley/mapper.rs` + `src/bin/wardley_mapper.rs`
(Rust port; was `tools/wardley_mapper.py`)

> **Note**: as committed, the Python original could never actually start -- it imports
> `strategic_analyzer` at module scope, and that module's `NameError` (see Module 3)
> aborted the import before `main()` was ever reachable. `wardley-mapper` fixes that
> and is otherwise the same protocol: read one `{"method": ..., "params": {...}}` JSON
> object per line from stdin, dispatch to `create_map` / `analyze_map` / `parse_text` /
> `create_interactive_map`, write one `{"result": ...}` (or `{"error": ...}`) JSON
> response per line to stdout, flushing after each. Field names, nesting, and
> conditional presence in every response below are unchanged from the Python
> original's dict shapes (JSON object *key order* may differ -- this crate's
> `serde_json` has no `preserve_order` feature, so keys serialise alphabetically
> rather than in Python's insertion order; this has no effect on any spec-compliant
> JSON consumer).

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

All four examples below now go through `wardley-mapper`'s stdin/stdout JSON-line
protocol (Module 5) instead of Python function imports -- there is no importable
library for any of these any more. `jq` builds/reads the JSON; any language able to
spawn a subprocess and speak line-delimited JSON works equally well.

### Example 1: Simple Business Description
```bash
text="We're a SaaS company with a React frontend, Node backend, and PostgreSQL database"

# Parse business description
parsed=$(jq -n --arg t "$text" '{method:"parse_text", params:{text:$t}}' | wardley-mapper)
components=$(echo "$parsed" | jq '.result.components')
dependencies=$(echo "$parsed" | jq '.result.dependencies')

# Create visualization
map_result=$(jq -n --argjson c "$components" --argjson d "$dependencies" \
  '{method:"create_map", params:{components:$c, dependencies:$d}}' | wardley-mapper)

# Analyze strategy
analysis=$(jq -n --argjson c "$components" --argjson d "$dependencies" \
  '{method:"analyze_map", params:{components:$c, dependencies:$d}}' | wardley-mapper)

echo "$analysis" | jq '.result.analysis.competitive_advantages'
echo "$analysis" | jq '.result.analysis.vulnerabilities'
echo "$analysis" | jq '.result.analysis.strategic_recommendations'
```

### Example 2: Technical Architecture
```bash
architecture="We use a microservices architecture:
- Angular frontend for user experience
- Multiple Node.js APIs for business logic
- Message queue (RabbitMQ) for async processing
- MongoDB for document storage
- Redis for caching
- Elasticsearch for search
- Deployed on Kubernetes on AWS"

parsed=$(jq -n --arg t "$architecture" '{method:"parse_text", params:{text:$t}}' | wardley-mapper)
analysis=$(jq -n --argjson c "$(echo "$parsed" | jq '.result.components')" \
                  --argjson d "$(echo "$parsed" | jq '.result.dependencies')" \
  '{method:"analyze_map", params:{components:$c, dependencies:$d}}' | wardley-mapper)

echo "Strategic Recommendations:"
echo "$analysis" | jq -r '.result.analysis.strategic_recommendations[] | "  - " + .'
```

### Example 3: Competitive Analysis
```bash
competition="We compete with Competitor A who uses standard AWS + SalesForce.
Our advantage is our custom ML recommendation engine built in-house.
We also developed a proprietary database indexing technique.
Our weakness is our reliance on off-the-shelf payment processor."

parsed=$(jq -n --arg t "$competition" '{method:"parse_text", params:{text:$t}}' | wardley-mapper)
analysis=$(jq -n --argjson c "$(echo "$parsed" | jq '.result.components')" \
                  --argjson d "$(echo "$parsed" | jq '.result.dependencies')" \
  '{method:"analyze_map", params:{components:$c, dependencies:$d}}' | wardley-mapper)

echo "Our Strengths:"
echo "$analysis" | jq -r '.result.analysis.competitive_advantages[] | "  + " + .'
echo "Our Vulnerabilities:"
echo "$analysis" | jq -r '.result.analysis.vulnerabilities[] | "  - " + .'
echo "Market Threats:"
echo "$analysis" | jq -r '.result.analysis.threats[] | "  ⚠️  " + .'
```

### Example 4: Interactive Visualization with Insights
```bash
# Given $components / $dependencies from a prior parse_text / analyze_map step:
analysis=$(jq -n --argjson c "$components" --argjson d "$dependencies" \
  '{method:"analyze_map", params:{components:$c, dependencies:$d}}' | wardley-mapper)

insights=$(echo "$analysis" | jq '{
  competitive_advantages: .result.analysis.competitive_advantages,
  vulnerabilities: .result.analysis.vulnerabilities,
  opportunities: .result.analysis.opportunities,
  threats: .result.analysis.threats
}')

jq -n --argjson c "$components" --argjson d "$dependencies" --argjson i "$insights" \
  '{method:"create_interactive_map", params:{components:$c, dependencies:$d, insights:$i}}' \
  | wardley-mapper | jq -r '.result.interactive_map_html' > strategic_map.html

echo "Open strategic_map.html in browser"
echo "Features: Filter by stage/insight, hover for details, click for analysis"
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
```bash
# View known patterns (prints the JSON knowledge-base export as its last block)
wardley-heuristics

# Add custom pattern if needed: edit the `init_patterns` table in
# services/skill-tools/src/wardley/heuristics.rs and rebuild (manual for now)
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

The Heuristics Engine / Strategic Analyzer / Interactive Map Generator / MCP tool
modules are now Rust, and their unit + integration tests live in the crate itself --
run them with `cargo test --lib wardley::` from `services/skill-tools/` (32 tests
covering scoring buckets, HTML/JSON structural assertions, the two intentionally-
replicated `quick_map` bugs, the `wardley-mapper` binary over stdio, and more). The
NLP parser (Module 1) is unchanged Python:
```python
from advanced_nlp_parser import AdvancedNLPParser

# Test NLP
parser = AdvancedNLPParser()
comps, deps = parser.parse("React frontend with PostgreSQL backend")
assert len(comps) >= 2, "Failed to extract components"

print("✓ NLP test passed")
```
```bash
# Test Heuristics (Rust): PostgreSQL should score as commodity (visibility 0.15).
echo '{"method":"create_map","params":{"components":[{"name":"PostgreSQL","visibility":0.5,"evolution":0.5}]}}' \
  | wardley-mapper | jq '.result.components[0].visibility'
# -> 0.15

echo "✓ All tests passed"
```

## API Documentation

Complete API reference in docstrings for the one module that stayed Python; the four
Rust modules have no `help()` equivalent (Rust binaries aren't importable like Python
modules) -- read their doc comments (`cargo doc --open -p skill-tools`, or just the
`.rs` source, which documents every ported function, bug found, and deviation inline):
```bash
# View module docstrings
python3 -c "import tools.advanced_nlp_parser; help(tools.advanced_nlp_parser.AdvancedNLPParser)"

# Rust equivalents: generated rustdoc, or read the source directly.
cargo doc --open -p skill-tools   # from services/skill-tools/
# services/skill-tools/src/wardley/heuristics.rs
# services/skill-tools/src/wardley/strategic_analyzer.rs
# services/skill-tools/src/wardley/interactive.rs
```

---

For questions or issues, refer to the main README.md and SKILL_UPGRADE_SUMMARY.md
