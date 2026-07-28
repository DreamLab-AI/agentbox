---
name: "perplexity-research"
description: "Live web research through Perplexity's closed synthesis engine — structured web results, deep multi-step investigations with reasoning, and quick sonar answers. Use when you need authoritative primary sources (gov/academic), academic citation discovery, or UK ecology/policy lookups; reach for it as the secondary engine after ceramic-search, or alongside it for important queries."
---

# Perplexity Research

Perplexity is a **closed engine that returns a synthesized answer**. Authoritative
primary sources (gov, academic) rank higher than keyword search, and the
academic/policy domain filters are tuned — but you don't control which sites are
searched and citations aren't independently verifiable.

> **Native MCP tools also available.** When `PERPLEXITY_API_KEY` is set at boot, the
> official `@perplexity-ai/mcp-server` is registered in `.mcp.json` and exposes four
> direct Claude Code tools: `perplexity_search`, `perplexity_ask`, `perplexity_research`,
> and `perplexity_reason`. Use those for quick one-shot queries. Use this skill when you
> need the richer three-API surface: structured `/search` with domain/date filters,
> `/v1/agent` deep research with multi-step reasoning, or Chat Completions for sonar
> model variants.

## Where this sits (secondary engine)

```
1. ceramic-search         — default for web search. Keyword, fast, rich 8k extracts
2. perplexity-research    — (this) Authoritative sources, academic/policy filters, synthesized
3. Claude WebSearch       — tertiary fallback. Built-in, no API key
★  Complex/important?     — run all three in parallel, dedupe + cross-verify
```

- **`ceramic-search`** — primary. High-recall keyword search with dense page extracts.
- **`perplexity-research`** (this) — secondary. Synthesized answers, authoritative source ranking.
- **`web-researcher`** — you pick the engine + restrict to trusted-domain **lenses**, read
  full sources, and **verify** every citation (`verify_citation`, `citation_graph`,
  `audit_bibliography`). Use when your reputation is attached to the result.
- **`deep-research`** — multi-agent harness (fan-out + adversarial verify + cited report)
  that can call any of the above as its search backend.

## When to use

- Live web search with structured results (title, URL, snippet, dates)
- Academic citation discovery (domain-filtered to scholar/pubmed/springer/nature)
- UK ecology and policy research (gov.uk, Natural England, JNCC, BTO)
- Deep multi-step research with reasoning and web search tools (Agent API)
- Quick factual queries with sonar models (Chat Completions, legacy)

## When not to use

- Known URLs needing expansion → use `gemini-url-context`
- YouTube transcript summarisation → use `web-summary`
- Interactive browser automation → use `browser` or `playwright`
- arXiv/PubMed/IEEE structured metadata search → use `web-researcher` (`academic_search`)
- Patent search → use `web-researcher` (`patent_search`)
- Multi-agent research with provenance verification → use `deep-research`
- Experiment optimisation loops → use `autoresearch`

## Quick path

Fastest route for most needs is the native MCP `perplexity_search` /
`perplexity_research` tools. Drop to the raw three-API client when you need
domain/date filters, agent presets, or sonar model selection. Minimal `/search` call:

```python
import os, requests

def search(query, max_results=10, country="GB", domain_filter=None):
    payload = {"query": query, "max_results": min(max_results, 20), "country": country}
    if domain_filter:
        payload["search_domain_filter"] = domain_filter[:20]
    resp = requests.post("https://api.perplexity.ai/search",
        headers={"Authorization": f"Bearer {os.environ['PERPLEXITY_API_KEY']}",
                 "Content-Type": "application/json"},
        json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json().get("results", [])
```

**Full three-API surface** — parameter tables, the `/v1/agent` deep-research client,
Chat Completions + sonar models, domain-filter presets (academic, UK ecology),
academic-citation-mining and BNG cookbooks, and retry/error handling:
see [`references/api-surface.md`](references/api-surface.md).

## Related skills

| Need | Skill |
|------|-------|
| Structured academic metadata (DOI, authors) | `web-researcher` (`academic_search`) |
| Patent search | `web-researcher` (`patent_search`) |
| Multi-agent research with provenance | `deep-research` |
| URL content expansion | `gemini-url-context` |
| Experiment optimisation loops | `autoresearch` |
| Ontology enrichment with Perplexity | `ontology-enrich` |
