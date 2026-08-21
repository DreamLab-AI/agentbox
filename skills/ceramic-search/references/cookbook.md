# Ceramic Search — Cookbook

Runnable usage patterns, helper functions, tool-use / MCP integration, and
composition recipes.

## Usage Patterns

### Basic Search

```bash
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "UK biodiversity net gain metric 4.0"}' \
  | python3 -m json.tool
```

### Extended Descriptions (for deep LLM context)

```bash
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "GDPR data processing agreements", "maxDescriptionLength": 8000}'
```

### Compact Descriptions (for token-constrained pipelines)

```bash
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "rust async runtime comparison", "maxDescriptionLength": 1500}'
```

### Multi-Query Retrieval (recommended for complex topics)

Issue several focused keyword queries and aggregate — better recall than one
complex query. Ceramic is exact-match, so synonym variants help:

```bash
# Query 1: primary terminology
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "ML-KEM post-quantum key encapsulation"}'

# Query 2: synonym variant
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "CRYSTALS-Kyber NIST PQC standard"}'
```

### Python Helper

```python
import os, requests

CERAMIC_API_KEY = os.environ["CERAMIC_API_KEY"]

def ceramic_search(query, max_description_length=3000):
    resp = requests.post(
        "https://api.ceramic.ai/search",
        headers={
            "Authorization": f"Bearer {CERAMIC_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "query": query,
            "maxDescriptionLength": max_description_length,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["result"]["results"]
```

### Shell Helper (for piping into other tools)

```bash
ceramic() {
  curl -s https://api.ceramic.ai/search \
    -H "Authorization: Bearer $CERAMIC_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$1\", \"maxDescriptionLength\": ${2:-3000}}"
}

# Usage: ceramic "query terms" [maxDescriptionLength]
ceramic "WebGPU compute shader performance" 5000
```

## Anthropic Tool Use Integration

Ceramic provides a tool definition for Claude's tool_use:

```json
{
  "name": "ceramic_search",
  "description": "Search the web for information. Returns structured results with title, URL, and description. Use keyword-based queries with 2-8 specific words.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Keyword search query, 2-8 words with specific entities/topics/dates"
      }
    },
    "required": ["query"]
  }
}
```

## MCP Server

Ceramic offers an MCP endpoint at `https://mcp.ceramic.ai/mcp` with a
`ceramic_search` tool. For Claude Code, register via their plugin system:

```bash
claude plugin marketplace add CeramicTeam/ceramic-claude-code-plugins
claude plugin install ceramic-search@ceramic-ai
```

Authentication is handled via WorkOS OAuth on first session start.

## Composition Patterns

| Goal | Recipe |
|------|--------|
| Dense context for LLM grounding | `ceramic-search` (8k descriptions) → feed into prompt |
| Cross-engine triangulation | `ceramic-search` + `perplexity-research` → dedupe + rank |
| Verified research with context | `ceramic-search` (find sources) → `web-researcher` (`verify_citation`) |
| Deep cited report | `ceramic-search` as discovery → `deep-research` (parallel agents + verify) |
| Multi-query sweep | 3–5 ceramic queries with synonym variants → aggregate + dedupe |
