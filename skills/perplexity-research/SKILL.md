---
name: "Perplexity Research"
description: "Execute real-time web research using Perplexity AI API with citations. Use when you need current information, UK market pricing, product availability, or technical specifications that require live web search."
---

# Perplexity Research with Citations

## What This Skill Does

Executes research queries against the Perplexity AI API to get real-time web information with citations. Ideal for market research, pricing queries, product availability, technical specifications, and any information requiring current web data.

**Capabilities**: Real-time web search, citation tracking, UK market focus, structured research outputs.

## Prerequisites

- Python 3.8+
- Perplexity API key in `.env` file
- `requests` and `python-dotenv` packages

---

## Quick Start

### 1. Configure API Key

Ensure your Perplexity API key is configured:

```bash
# In your project root or NetworkPlan/.env
echo "PERPLEXITY_API_KEY=your_key_here" >> .env
```

### 2. Execute Research Query

Use this skill when you need to:
- Research current product availability and pricing
- Get technical specifications from multiple sources
- Find UK-specific market information
- Gather information with citations for verification

---

## Research Execution Pattern

When activated, this skill will:

1. **Construct Optimized Query**: Format your research request with context, task, focus, and deliverable structure
2. **Call Perplexity API**: Use `llama-3.1-sonar-huge-128k-online` model for comprehensive research
3. **Extract Citations**: Capture source URLs and references
4. **Format Results**: Present findings with structured citations

### API Query Template

```python
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load API key
load_dotenv()
API_KEY = os.getenv("PERPLEXITY_API_KEY")
API_URL = "https://api.perplexity.ai/chat/completions"

def research_query(prompt: str, model: str = "sonar-pro"):
    """Execute Perplexity research query with citations."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful research assistant. Provide detailed, accurate information with current pricing and purchase links. Today's date is November 15, 2025."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2,
        "max_tokens": 4000,
    }

    response = requests.post(API_URL, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    return response.json()
```

---

## Prompt Structure Guidelines

### Optimal Prompt Format

```
Context: [Background information about the project/need]

Task: Research [specific topic] available in [region] (November 2025) that support:
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

Focus: [Specific products, brands, or technical criteria]

Deliverable: [Expected output format - table, comparison, recommendation, etc.]
```

### Example Research Prompts

#### UK Technology Procurement
```python
prompt = """Context: Designing a UK residential network with dual-WAN (5G + legacy broadband).

Task: Research Ubiquiti gateway/router options available in UK market (November 2025) that support:
- Dual-WAN with load balancing and failover
- 10G SFP+ uplink capability
- VLAN support and policy-based routing

Focus: UniFi Dream Machine Pro, UXG-Pro, or newer 2024-2025 models.

Deliverable: Comparison table with model names, specs, current UK pricing from at least 3 retailers, and stock availability. Include purchase links."""
```

#### Market Availability Research
```python
prompt = """Context: Need 5G modem for UK mobile networks with external antenna support.

Task: Research 5G CPE/modem options compatible with Ubiquiti networking (November 2025):
- Ethernet WAN output (RJ45)
- External antenna support (TS9, SMA, N-type)
- UK 5G band support (n1, n3, n7, n20, n28, n78)

Focus: Industrial/prosumer modems from Teltonika, Peplink, Mikrotik.

Deliverable: Table with models, supported bands, antenna connectors, UK pricing and availability."""
```

---

## Response Processing

### Extract Content and Citations

```python
def process_response(result: dict) -> dict:
    """Extract content and citations from Perplexity response."""
    content = result["choices"][0]["message"]["content"]
    citations = result.get("citations", [])

    return {
        "content": content,
        "citations": citations,
        "timestamp": result.get("created", "Unknown")
    }
```

### Save Research Results

```python
def save_research(topic: str, result: dict, output_dir: Path):
    """Save research with citations to markdown."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"{topic}.md"

    processed = process_response(result)

    with output_file.open("w") as f:
        f.write(f"# {topic.replace('_', ' ').title()}\n\n")
        f.write(f"*Research conducted: {processed['timestamp']}*\n\n")
        f.write(processed["content"])
        f.write("\n\n")

        if processed["citations"]:
            f.write("## Sources\n\n")
            for i, citation in enumerate(processed["citations"], 1):
                f.write(f"{i}. {citation}\n")
```

---

## Available Models

| Model | Use Case | Context |
|-------|----------|---------|
| `sonar` | Quick queries, simple lookups | 128k tokens |
| `sonar-pro` | Comprehensive research with 2x citations | 128k tokens |
| `sonar-reasoning` | Logical reasoning, multi-step evaluations | 128k tokens |
| `sonar-reasoning-pro` | Advanced inference with DeepSeek-R1 | 128k tokens |
| `sonar-deep-research` | Deep research sessions | 128k tokens |

**Default**: `sonar-pro` for comprehensive research with maximum citations.

---

## Integration with Existing Scripts

The skill complements the existing `NetworkPlan/scripts/perplexity_research.py` script:

- **Script**: Batch research execution for predefined topics
- **Skill**: Interactive research for ad-hoc queries via Claude Code

### Example: Extend Existing Script

```python
# Add to RESEARCH_PROMPTS in perplexity_research.py
RESEARCH_PROMPTS = {
    # ... existing prompts ...

    "custom_query": """Your custom research prompt here""",
}
```

---

## Execution Workflow

When you invoke this skill, Claude will:

1. **Load API credentials** from `.env` file
2. **Construct optimized prompt** based on your query
3. **Execute Perplexity API call** with appropriate model
4. **Parse response** and extract citations
5. **Format results** as markdown with sources
6. **Save output** to specified location (optional)

### Usage Pattern

```
User: Research UK availability of 10G SFP+ switches under £500

Claude:
[Loads perplexity-research skill]
[Constructs prompt with UK market focus, pricing constraint, technical specs]
[Calls Perplexity API]
[Returns formatted research with citations]
```

---

## Error Handling

### Common Issues

**API Key Not Found**
```bash
# Verify .env file exists and contains key
cat NetworkPlan/.env | grep PERPLEXITY_API_KEY
```

**Rate Limiting**
```python
# Add retry logic with exponential backoff
import time
from requests.exceptions import HTTPError

def query_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            return research_query(prompt)
        except HTTPError as e:
            if e.response.status_code == 429:
                wait = 2 ** attempt
                time.sleep(wait)
            else:
                raise
```

**Timeout Errors**
```python
# Increase timeout for complex queries
response = requests.post(API_URL, headers=headers, json=payload, timeout=180)
```

---

## Best Practices

### Prompt Optimization
- Include date context (November 2025)
- Specify region (UK market)
- Request structured output (tables, comparisons)
- Define clear deliverables

### Citation Management
- Always extract and save citations
- Include source URLs in markdown output
- Cross-reference multiple sources
- Verify pricing with retailer links

### Token Efficiency
- Use `sonar-small` for simple lookups
- Use `sonar-huge` for comprehensive research
- Set `temperature: 0.2` for consistent results
- Limit `max_tokens` based on expected response length

---

## Advanced Features

### Multi-Query Research

```python
def batch_research(queries: dict) -> dict:
    """Execute multiple research queries in sequence."""
    results = {}
    for topic, prompt in queries.items():
        result = research_query(prompt)
        results[topic] = process_response(result)
        time.sleep(1)  # Rate limiting
    return results
```

### Citation Aggregation

```python
def aggregate_citations(results: dict) -> list:
    """Combine citations from multiple queries."""
    all_citations = []
    for topic, data in results.items():
        all_citations.extend(data.get("citations", []))
    return list(set(all_citations))  # Deduplicate
```

---

## Example: Complete Research Flow

```python
#!/usr/bin/env python3
import os
from pathlib import Path
from dotenv import load_dotenv
import requests

# Setup
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
API_KEY = os.getenv("PERPLEXITY_API_KEY")

# Research query
prompt = """Context: Building UK home network with 10G backbone.

Task: Research OM4 fibre components from UK suppliers (November 2025):
- Pre-terminated LC-LC cables (20-30m)
- 10GBASE-SR SFP+ transceivers (Ubiquiti-compatible)
- LC patch panels (12-24 port)

Focus: FS.com UK, Broadband Buyer, CPC Farnell.

Deliverable: Component list with part numbers, specs, UK pricing."""

# Execute
result = research_query(prompt)
processed = process_response(result)

# Output
print(processed["content"])
print("\n## Sources")
for i, cite in enumerate(processed["citations"], 1):
    print(f"{i}. {cite}")
```

---

## When to Use This Skill

- Need current market information (pricing, availability)
- Researching UK-specific products or services
- Require citation tracking for verification
- Building Bills of Materials with current pricing
- Comparing technical specifications across products
- Finding retailer stock availability

## When NOT to Use

- Information already in codebase or documentation
- Historical data (use WebFetch or other tools)
- Internal project context (use Grep/Read tools)
- Simple factual queries (use Claude's knowledge base)

---

## Integration Example

```bash
# From Claude Code CLI
> Research Ubiquiti 10G switches available in UK under £800

[perplexity-research skill activates]
[Constructs prompt with UK market, pricing, availability focus]
[Calls API, extracts results with citations]
[Presents formatted research with purchase links]
```

---

## Output Format

Research results include:
- **Summary**: Key findings and recommendations
- **Comparison Table**: Product specs, pricing, availability
- **Purchase Links**: Direct URLs to UK retailers
- **Citations**: Source URLs for verification
- **Timestamp**: Research execution date

---

## Maintenance

Keep API key secure:
```bash
# Add .env to .gitignore
echo ".env" >> .gitignore

# Verify exclusion
git check-ignore NetworkPlan/.env
```

Update model selection as Perplexity releases new versions:
```python
# Check latest models at https://docs.perplexity.ai/models
model = "llama-3.1-sonar-huge-128k-online"  # Update as needed
```

---

## Related Skills

- `perplexity-prompt-generator`: Generate optimized prompts for Perplexity
- `skill-builder`: Create custom research skills
- `verification-quality`: Validate research results with truth scoring

---

## References

- Perplexity API Docs: https://docs.perplexity.ai
- NetworkPlan Script: `NetworkPlan/scripts/perplexity_research.py`
- Example Prompts: See `RESEARCH_PROMPTS` in script
