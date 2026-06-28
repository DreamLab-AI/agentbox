---
name: ceramic-search
description: >
  Ceramic Search API client for high-recall keyword web search with rich page
  extracts (up to 8k chars per result). Returns 10 structured results per query
  with title, URL, and long-form description. Exact-match keyword engine — best
  for LLM-augmented retrieval where you need dense source context, not a
  synthesized answer. Complements perplexity-research (authoritative primary
  sources) and web-researcher (verifiable citations + lenses).
version: 1.0.0
triggers:
  - /ceramic
  - ceramic search
  - keyword web search
  - web search with descriptions
---

# Ceramic Search

Keyword web search via [Ceramic.ai](https://docs.ceramic.ai) — a fast,
exact-match engine that returns 10 results with rich page extracts (up to 8,000
characters per result). The long descriptions make it particularly useful as an
LLM retrieval source where you need dense context, not just snippets.

## Search Priority (this skill is PRIMARY)

```
1. ceramic-search  (this) — DEFAULT for all web search. Keyword, fast, rich extracts
2. perplexity-research    — Secondary. Authoritative sources, academic/policy filters, synthesized answers
3. Claude WebSearch       — Tertiary fallback. Built-in, no API key, synthesized
★  Complex/important?     — Run ALL THREE in parallel, dedupe + cross-verify
```

| Need | Skill |
|------|-------|
| **Default web search** — keyword, 10 results, up to 8k char extracts, fast exact matching | **`ceramic-search`** (this — primary) |
| **Authoritative sources**, academic/policy filters, synthesized answer | **`perplexity-research`** (secondary) |
| **Quick built-in fallback**, no API key needed | **Claude WebSearch** (tertiary) |
| **Complex or important** — cross-engine triangulation | **All three in parallel** |
| **Verifiable citations** — you pick the engine + trusted-domain lenses, full source reading, citation audit | **`web-researcher`** |
| **Multi-agent deep report** — fan-out + adversarial verification + cited synthesis | **`deep-research`** |
| Expand a single known URL | **`gemini-url-context`** / **`web-summary`** |

## When To Use

- LLM-augmented search where you need long page extracts for in-context grounding
- Keyword-based web search with specific entities, dates, locations
- Multi-query retrieval strategies (issue several focused keyword queries, aggregate)
- Quick structured web results when you don't need citation verification
- Feeding search context into other skills or agent pipelines

## When Not To Use

- Authoritative primary sources (gov, academic) at top of results → `perplexity-research`
- Citation verification, audit, or bibliography formatting → `web-researcher`
- Conversational/natural-language queries (Ceramic is exact-match, not semantic)
- Known URL expansion → `gemini-url-context`
- Interactive browser automation → `browser` / `playwright`
- Multi-agent deep research → `deep-research`

## Prerequisites

- `CERAMIC_API_KEY` environment variable (get one at https://platform.ceramic.ai/keys)
- Free tier: 1,000 credits on signup
- Rate limits: 20 QPS (pay-as-you-go), 50 QPS (pro)

---

## API Surface

### Search (`POST https://api.ceramic.ai/search`)

Single endpoint. Returns 10 structured results with rich descriptions.

```bash
curl https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "California rental laws"}'
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Keyword search query, 1–50 words |
| `maxDescriptionLength` | integer | no | 3000 | Character limit per result description (1,000–8,000) |

### Response

```json
{
  "requestId": "ae2ebd93-194f-4460-9996-15e3f86b05d8",
  "result": {
    "results": [
      {
        "title": "California Tenant Rights Guide",
        "url": "https://example.com/tenant-rights",
        "description": "Comprehensive guide to California rental laws..."
      }
    ],
    "searchMetadata": {
      "executionTime": 0.097
    },
    "totalResults": 10
  }
}
```

---

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

---

## Query Best Practices

Ceramic is an **exact-match keyword engine**, not semantic. Queries that work
well with conversational search engines will underperform here.

| Do | Don't |
|----|-------|
| `California rent increase causes 2026` | `Why is rent so high in California?` |
| `OpenAI GPT-5 announcement 2025` | `What's the latest on GPT-5?` |
| `college university tuition costs US` | `tuition` (too broad) |
| `cat house building plans` | Rely on synonym expansion |
| Use 2–8 specific keywords | Use articles (the, a, an) or filler words |
| Include entities, dates, locations | Use conversational phrasing |
| Issue multiple synonym variants | Craft one complex query |

**Word order matters.** `cat house` and `house cat` return different results.

---

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

---

## MCP Server

Ceramic offers an MCP endpoint at `https://mcp.ceramic.ai/mcp` with a
`ceramic_search` tool. For Claude Code, register via their plugin system:

```bash
claude plugin marketplace add CeramicTeam/ceramic-claude-code-plugins
claude plugin install ceramic-search@ceramic-ai
```

Authentication is handled via WorkOS OAuth on first session start.

---

## Composition Patterns

| Goal | Recipe |
|------|--------|
| Dense context for LLM grounding | `ceramic-search` (8k descriptions) → feed into prompt |
| Cross-engine triangulation | `ceramic-search` + `perplexity-research` → dedupe + rank |
| Verified research with context | `ceramic-search` (find sources) → `web-researcher` (`verify_citation`) |
| Deep cited report | `ceramic-search` as discovery → `deep-research` (parallel agents + verify) |
| Multi-query sweep | 3–5 ceramic queries with synonym variants → aggregate + dedupe |

---

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | — |
| 401 | Invalid or missing API key | Check `CERAMIC_API_KEY` |
| 422 | Invalid request (query too long, bad params) | Fix request body |
| 429 | Rate limited | Back off; check QPS tier |
| 500 | Server error | Retry with exponential backoff |

```python
from requests.exceptions import HTTPError
import time

def ceramic_search_with_retry(query, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            return ceramic_search(query, **kwargs)
        except HTTPError as e:
            if e.response.status_code == 429:
                time.sleep(2 ** attempt)
            else:
                raise
```

---

## Related Skills

| Need | Skill |
|------|-------|
| Authoritative gov/academic sources | `perplexity-research` |
| Verifiable citations + lenses | `web-researcher` |
| Multi-agent deep research | `deep-research` |
| Known URL expansion | `gemini-url-context` |
| Experiment optimisation loops | `autoresearch` |
| Ontology grounding | `ontology-augment` |

---

## References

- API: `POST https://api.ceramic.ai/search`
- Docs: https://docs.ceramic.ai
- Best practices: https://docs.ceramic.ai/api/search/best-practices
- MCP: https://docs.ceramic.ai/mcp/ceramic-mcp
- Platform / API keys: https://platform.ceramic.ai/keys
- Rate limits: 20 QPS (PAYG), 50 QPS (Pro), custom (Enterprise)
