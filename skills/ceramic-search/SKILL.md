---
name: ceramic-search
description: >
  Keyword web search that returns long page extracts for grounding an LLM in
  dense source context rather than a synthesized answer. Use when you need
  exact-match keyword retrieval over the live web — specific entities, dates,
  or locations — and want raw source text to feed into a prompt or agent
  pipeline. Not for conversational/semantic queries or citation verification.
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

## Quick start

Needs `CERAMIC_API_KEY` (get one at https://platform.ceramic.ai/keys; free tier
1,000 credits). Single endpoint:

```bash
curl -s https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "California rental laws", "maxDescriptionLength": 8000}'
```

Ceramic is **exact-match keyword**, not semantic — use 2–8 specific keywords
(entities, dates, locations), not conversational phrasing, and issue synonym
variants for recall. See `references/query-best-practices.md`.

## Choosing a search skill

Ceramic is a strong default when you want dense source text to feed back into a
prompt — keyword, fast, rich extracts. It is not the only choice; pick by intent,
and for anything complex or high-stakes, run more than one engine in parallel and
cross-verify.

| Need | Skill |
|------|-------|
| **Dense keyword retrieval** — long extracts to ground an LLM, fast exact matching | **`ceramic-search`** (this) |
| **Authoritative sources**, academic/policy filters, synthesized answer | **`perplexity-research`** |
| **Quick built-in fallback**, no API key needed | **Claude WebSearch** |
| **Complex or important** — cross-engine triangulation | run several in parallel, dedupe + cross-verify |
| **Verifiable citations** — you pick the engine + trusted-domain lenses, full source reading, citation audit | **`web-researcher`** |
| **Multi-agent deep report** — fan-out + adversarial verification + cited synthesis | **`deep-research`** |
| Expand a single known URL | **`gemini-url-context`** / **`web-summary`** |

## References

- `references/api-reference.md` — endpoint, parameters, response schema, rate limits, error handling with retry.
- `references/cookbook.md` — runnable curl/Python/shell patterns, multi-query retrieval, Anthropic tool-use definition, MCP server registration, composition recipes.
- `references/query-best-practices.md` — do/don't query table for the exact-match engine and word-order notes.

## Related Skills

| Need | Skill |
|------|-------|
| Authoritative gov/academic sources | `perplexity-research` |
| Verifiable citations + lenses | `web-researcher` |
| Multi-agent deep research | `deep-research` |
| Known URL expansion | `gemini-url-context` |
| Experiment optimisation loops | `autoresearch` |
| Ontology grounding | `ontology-augment` |
