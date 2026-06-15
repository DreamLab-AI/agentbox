---
name: "Perplexity Research"
description: "Three-API Perplexity client: Search API (/search) for structured web results with domain/date filters, Agent API (/v1/agent) for multi-step deep research with reasoning, and Chat Completions (/chat/completions) for quick sonar queries. Use when you need live web research, academic citation discovery, UK ecology/policy lookups, or deep multi-step investigations with provenance."
---

# Perplexity Research

> **Native MCP tools also available.** When `PERPLEXITY_API_KEY` is set at boot,
> the official `@perplexity-ai/mcp-server` is registered in `.mcp.json` and
> exposes four direct Claude Code tools: `perplexity_search`, `perplexity_ask`,
> `perplexity_research`, and `perplexity_reason`. Use those for quick one-shot
> queries. Use this skill when you need the richer three-API surface: structured
> `/search` with domain/date filters, `/v1/agent` deep research with multi-step
> reasoning, or the Chat Completions endpoint for sonar model variants.

Three-API Perplexity client covering the full platform surface (May 2025 contracts).

## Which web-search skill? (perplexity vs web-researcher vs deep-research)

Perplexity is a **closed engine that returns a synthesized answer** — fast, opinionated,
great for casual lookups and its tuned academic/policy filters, but you don't control which
sites are searched and citations aren't independently verifiable.

- **`perplexity-research`** (this) — quick synthesized answers from Perplexity's engine.
- **`web-researcher`** — you pick the engine + restrict to trusted-domain **lenses**, read
  full sources, and **verify** every citation (`verify_citation`, `citation_graph`,
  `audit_bibliography`). Use when your reputation is attached to the result.
- **`deep-research`** — multi-agent harness (fan-out + adversarial verify + cited report)
  that can call either of the above as its search backend.

## When To Use

- Live web search with structured results (title, URL, snippet, dates)
- Academic citation discovery (domain-filtered to scholar/pubmed/springer/nature)
- UK ecology and policy research (gov.uk, Natural England, JNCC, BTO)
- Deep multi-step research with reasoning and web search tools (Agent API)
- Quick factual queries with sonar models (Chat Completions, legacy)

## When Not To Use

- Known URLs needing expansion -- use `gemini-url-context`
- YouTube transcript summarisation -- use `web-summary`
- Interactive browser automation -- use `browser` or `playwright`
- arXiv/PubMed/IEEE structured metadata search -- use `web-researcher` (`academic_search`)
- Patent search -- use `web-researcher` (`patent_search`)
- Multi-agent research with provenance verification -- use `deep-research`
- Experiment optimisation loops -- use `autoresearch`

## Prerequisites

- `PERPLEXITY_API_KEY` environment variable (or in `.env`)
- `requests` package

---

## API Surface

### 1. Search API (`/search`) -- Structured Web Results

Returns structured results with title, URL, snippet, and dates. Supports domain filters, date filters, country, recency, and language.

```python
import os
import requests

API_KEY = os.environ["PERPLEXITY_API_KEY"]
BASE = "https://api.perplexity.ai"

def search(query, max_results=10, country="GB", domain_filter=None,
           date_after=None, date_before=None, recency=None):
    payload = {
        "query": query,
        "max_results": min(max_results, 20),
        "country": country,
        "max_tokens": 10000,
        "max_tokens_per_page": 4096,
    }
    if domain_filter:
        payload["search_domain_filter"] = domain_filter[:20]
    if date_after:
        payload["search_after_date_filter"] = date_after   # "YYYY-MM-DD"
    if date_before:
        payload["search_before_date_filter"] = date_before
    if recency:
        payload["search_recency_filter"] = recency  # "day"|"week"|"month"|"year"

    resp = requests.post(f"{BASE}/search",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json().get("results", [])
```

**Response shape** (per result):
```json
{"title": "...", "url": "...", "snippet": "...", "date": "...", "last_updated": "..."}
```

#### Domain Filter Presets

**Academic**:
```python
ACADEMIC_DOMAINS = [
    "scholar.google.com", "researchgate.net", "academia.edu",
    "semanticscholar.org", "pubmed.ncbi.nlm.nih.gov",
    "sciencedirect.com", "wiley.com", "springer.com",
    "nature.com", "jstor.org",
]
results = search(query, domain_filter=ACADEMIC_DOMAINS)
```

**UK Ecology / Government**:
```python
UK_ECOLOGY_DOMAINS = [
    "gov.uk", "naturalengland.org.uk", "jncc.gov.uk",
    "bto.org", "wildlifetrusts.org", "cieem.net",
    "magic.defra.gov.uk", "data.gov.uk", "legislation.gov.uk",
]
results = search(query, domain_filter=UK_ECOLOGY_DOMAINS, country="GB")
```

### 2. Agent API (`/v1/agent`) -- Deep Research with Reasoning

Multi-step research with model-driven reasoning, web search tools, and citation extraction.

```python
def agent_research(prompt, instructions=None, model="anthropic/claude-sonnet-4-6",
                   preset=None, max_steps=5, reasoning_effort="medium",
                   search_domains=None, country="GB"):
    payload = {
        "input": prompt,
        "max_output_tokens": 4096,
        "stream": False,
        "reasoning": {"effort": reasoning_effort},  # "low"|"medium"|"high"
    }
    if preset:
        payload["preset"] = preset  # e.g. "pro-search"
    else:
        payload["model"] = model
    if instructions:
        payload["instructions"] = instructions
    if max_steps > 1:
        payload["max_steps"] = min(max_steps, 10)

    tool_config = {"type": "web_search"}
    if search_domains:
        tool_config["filters"] = {"domain": search_domains}
    tool_config["user_location"] = {
        "country": country, "region": "Derbyshire",
        "city": "Matlock", "latitude": 53.0694, "longitude": -1.5456,
    }
    payload["tools"] = [tool_config]

    resp = requests.post(f"{BASE}/v1/agent",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    text = ""
    citations = []
    for item in data.get("output", []):
        if item.get("type") == "message":
            for part in item.get("content", []):
                if isinstance(part, dict) and part.get("type") == "text":
                    text += part.get("text", "")
                elif isinstance(part, str):
                    text += part
        elif item.get("type") == "search_results":
            for sr in item.get("results", []):
                citations.append({
                    "title": sr.get("title", ""),
                    "url": sr.get("url", ""),
                    "snippet": sr.get("snippet", ""),
                })
    return {"text": text, "citations": citations, "usage": data.get("usage", {})}
```

**Agent presets**: `"pro-search"` for deep research with maximum web search steps.

**Model options**: Any model string accepted by Perplexity (e.g. `"anthropic/claude-sonnet-4-6"`, `"gpt-4.1"`). When using `preset`, omit `model`.

### 3. Chat Completions (`/chat/completions`) -- Quick Sonar Queries (Legacy)

Standard OpenAI-compatible chat endpoint. Still supported but Search + Agent APIs are preferred for new work.

```python
def chat_query(prompt, model="sonar-pro", temperature=0.2, max_tokens=4000):
    resp = requests.post(f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": "Research assistant. Provide detailed answers with citations."},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return {
        "content": data["choices"][0]["message"]["content"],
        "citations": data.get("citations", []),
    }
```

| Model | Use Case |
|-------|----------|
| `sonar` | Quick lookups |
| `sonar-pro` | Comprehensive research, 2x citations |
| `sonar-reasoning` | Multi-step logical reasoning |
| `sonar-reasoning-pro` | Advanced inference (DeepSeek-R1) |
| `sonar-deep-research` | Deep research sessions |

---

## Academic Reference Mining

Combine Search API domain filters with Agent API deep research for citation discovery:

```python
def find_academic_citations(topic, n=10):
    academic = search(f"{topic}", max_results=n,
                      domain_filter=ACADEMIC_DOMAINS)
    uk_policy = search(f"{topic} UK", max_results=n,
                       domain_filter=UK_ECOLOGY_DOMAINS, country="GB")
    seen = set()
    unique = []
    for r in academic + uk_policy:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)
    return unique[:n]

def deep_academic_research(topic):
    return agent_research(
        prompt=topic,
        instructions=(
            "You are an academic research assistant. Provide detailed, factual responses "
            "with specific citations to peer-reviewed papers, government publications, "
            "and authoritative technical documentation. Prioritise primary sources."
        ),
        preset="pro-search",
        max_steps=5,
        reasoning_effort="high",
    )
```

For structured academic metadata (DOI, authors, abstract), prefer the `web-researcher` skill's `academic_search` tool which queries arXiv, PubMed, IEEE, Nature, and Springer APIs directly.

---

## UK Ecology and BNG Research

Preset configuration for Biodiversity Net Gain and UK habitat surveys:

```python
def research_biodiversity(topic):
    return agent_research(
        prompt=topic,
        instructions=(
            "You are a UK ecology research assistant specialising in Biodiversity Net Gain, "
            "the Statutory Biodiversity Metric 4.0, UKHab habitat classification, and "
            "Derbyshire/Peak District ecology. Provide detailed, factual responses with "
            "specific citations. Focus on peer-reviewed sources, DEFRA guidance, and "
            "Natural England publications. All spatial references should use British "
            "National Grid (EPSG:27700)."
        ),
        preset="pro-search",
        max_steps=5,
        reasoning_effort="high",
        search_domains=UK_ECOLOGY_DOMAINS,
        country="GB",
    )
```

---

## Error Handling

```python
from requests.exceptions import HTTPError
import time

def query_with_retry(fn, *args, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
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
| Structured academic metadata (DOI, authors) | `web-researcher` (`academic_search`) |
| Patent search | `web-researcher` (`patent_search`) |
| Multi-agent research with provenance | `deep-research` |
| URL content expansion | `gemini-url-context` |
| Experiment optimisation loops | `autoresearch` |
| Ontology enrichment with Perplexity | `ontology-enrich` |

---

## References

- Search API: `POST https://api.perplexity.ai/search` (May 2025)
- Agent API: `POST https://api.perplexity.ai/v1/agent` (May 2025)
- Chat Completions: `POST https://api.perplexity.ai/chat/completions` (legacy, still supported)
- Full docs: https://docs.perplexity.ai
