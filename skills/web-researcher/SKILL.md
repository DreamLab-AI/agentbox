---
name: web-researcher
authority_class: recoverable   # REC-6: read-only research; proceeds without an escalation wait
description: >
  Multi-source web research via the web-researcher-mcp Go server (deployed binary
  v1.43.0) — you pick the search ENGINE and the trusted SOURCES, and every citation
  is a real, checkable link. 21 live MCP tools (verified against tools/list):
  web/image/news/academic/patent search, search_and_scrape, sequential_search,
  awesome_list_search, brand_research; domain search (clinical_search,
  legal_search/CourtListener, econ_search/World Bank+FRED); scrape_page (full
  PDF/DOCX/PPTX/YouTube/HN, not snippets); citation integrity (verify_citation,
  verify_recommendation, audit_bibliography, citation_graph, archive_source/Wayback,
  format_bibliography APA/MLA/BibTeX/RIS/CSL); research session memory + export
  (get_research_session, research_export). Search LENSES restrict results to trusted
  domains (academic, clinical, legal, finance, government, journalism, devops, docs).
  Pluggable backends (Google PSE/Brave/Serper/SearXNG/SearchAPI/Exa), DuckDuckGo
  fallback. Use for reputation-attached research needing verifiable citations — the
  open, auditable, private counterpart to perplexity-research (fast closed synthesis).
  NOT for quick uncited lookups (use perplexity/ceramic), interactive browser flows or
  JS-rendered pages (headless scrape tier DISABLED here → delegate to the `browser`
  sidecar), or grounding in our own ontology (use ontology-augment).
version: 1.43.0
triggers:
  - /research
  - web search
  - academic search
  - patent search
  - legal / clinical / SEC filing search
  - verify citation
  - format bibliography
  - scrape page
  - news search
  - multi-source research
upstream: https://github.com/zoharbabin/web-researcher-mcp
upstream_version: 1.43.0
license: MIT
---

# Web Researcher Skill

Production-grade live-web research bridge: search across **the engine you choose**,
narrow to **the sources you trust** (lenses), read the **full source** (not snippets),
and get citations you can **verify** — never fabricated, never a closed pre-synthesized
garden. Runs locally/private; never invokes a browser from inside this skill.

## Which web-search skill? (read this first — avoids the common mix-up)

```
Search priority: 1. ceramic → 2. perplexity → 3. Claude WebSearch
Complex/important? → all three in parallel
Verifiable citations needed? → web-researcher (this)
```

| Need | Skill |
|------|-------|
| **Default web search** — keyword, rich 8k extracts, fast | **`ceramic-search`** (primary) |
| **Authoritative sources**, synthesized answer, academic/policy filters | **`perplexity-research`** (secondary) |
| **Quick built-in fallback** | **Claude WebSearch** (tertiary) |
| **Verifiable, reputation-attached research** — real citations, full sources, you control which domains are searched (lenses), private/local; client work, filings, publications, medical/legal/finance | **`web-researcher`** (this) |
| **Multi-agent deep report** — fan-out + adversarial verification + cited synthesis (orchestrates searchers; can use any of the above as a backend) | **`deep-research`** |
| Expand a single known URL | **`scrape_page`** (this skill, full text/PDF/YouTube) ; JS-rendered → **`browser`** sidecar |
| Interactive browser (login/click/JS render) | **`browser`** / **`playwright`** |

One-liner: **ceramic = primary keyword search with dense extracts; perplexity = secondary, synthesized + authoritative; web-researcher = verifiable citations + lenses; deep-research = the harness over all.**

## When To Use

- Research where your reputation is on the line — citations must be real and checkable.
- Restrict search to trusted sources via **lenses** (PubMed/arXiv/SEC/.gov, not random blogs).
- Read full articles — web pages, **PDF/DOCX/PPTX, YouTube transcripts, Hacker News** threads.
- Academic work: real papers + DOIs (`academic_search`), citation neighborhoods (`citation_graph`).
- Domain search: courts (`legal_search`), trials (`clinical_search`), macro/econ (`econ_search`).
- **Verify** a citation before relying on it (`verify_citation`) or audit a whole reference list (`audit_bibliography`); snapshot a source to Wayback (`archive_source`); export a bibliography (`format_bibliography`).
- Curated resource discovery (`awesome_list_search`) or a structured company/brand pass (`brand_research`).
- Session-tracked multi-step digs (`sequential_search`) with recovery + export.

## When Not To Use

- Quick casual lookup, no citing needed → `perplexity-research` or Claude built-in search.
- Single known URL summary → `scrape_page` (this skill); JS-rendered → `browser` sidecar.
- Interactive browser flows (login, click, form-fill) → `browser` / `playwright`.
- WebGPU/WebGL rendering validation → `browser` / `chrome-cdp`.
- Multi-agent report with adversarial verification → `deep-research` (it can call this skill).
- Iterative metric-optimisation experiment loops → `autoresearch`.
- Grounding in OUR formal ontology/KG → `ontology-augment`.

## Connection

MCP stdio server registered as `web-researcher` in `mcp/mcp.json`. Deployed binary is
**`web-researcher-mcp-1.43.0`** (Nix-baked, resolved from `$PATH`); the full v1.33+
toolset — the 21 tools tabled below — is registered and live, verified against the
running server's `tools/list`. Registration, version-bump (`flake.nix` pin) and
provider-gating detail: [`references/deployment.md`](references/deployment.md).

## Tools (live set depends on configured providers — see notes)

**Search & read**
| Tool | What it does |
|------|--------------|
| `web_search` | Search the web; optionally restrict to trusted sources via a **lens** |
| `search_and_scrape` | Search then read the best results, quality-scored + deduped |
| `scrape_page` | Read any URL in full — pages, PDF/DOCX/PPTX, YouTube transcripts, HN (API); `mode:raw` for verbatim |
| `image_search` | Images by size/type/colour/format |
| `news_search` | Recent news with date controls + source filtering |
| `sequential_search` | Multi-step research that remembers prior findings |
| `awesome_list_search` | Mine curated GitHub "awesome-*" lists for a topic's canonical resources |
| `brand_research` | Structured research pass on a company/brand |

**Domain search**
| Tool | Source |
|------|--------|
| `academic_search` | Real papers + DOIs (OpenAlex/Semantic Scholar/arXiv/PubMed/IEEE) |
| `citation_graph` | Walk a paper's citing/cited neighborhood — needs a citation-capable provider |
| `patent_search` | US/EP/WO/JP/CN/KR patent offices + classification |
| `legal_search` | US court opinions/dockets via CourtListener |
| `clinical_search` | ClinicalTrials.gov (discovery, not medical advice) |
| `econ_search` | World Bank indicators (keyless) + FRED US macro series |

**Citation integrity & output**
| Tool | What it does |
|------|--------------|
| `verify_citation` | Does a citation exist, match a real record, is it retracted/dead-link? Evidence, not a verdict |
| `audit_bibliography` | Audit a whole CSL-JSON/RIS/BibTeX list/session — per-entry + corpus flags |
| `verify_recommendation` | Check a recommended source before relying on it |
| `archive_source` | Capture a fresh Wayback snapshot so a cited page stays verifiable (write tool) |
| `format_bibliography` | APA / MLA / BibTeX / RIS / CSL-JSON (Zotero/EndNote/Mendeley-ready) |

**Session / memory**
| Tool | What it does |
|------|--------------|
| `get_research_session` | Recover a session after context loss |
| `research_export` | Export a provenance-tracked report (md/JSON) |

All 21 tools above are live in the deployed v1.43.0 binary (verified via `tools/list`).
Some are inert without provider keys — see [`references/deployment.md`](references/deployment.md).
`docs/TOOLS.md` upstream is the authoritative, CI-verified tool list + schemas.

## Search Lenses (the differentiator)

Lenses restrict results to a curated set of trusted domains for a field, instead of the
whole web. Built-in lenses ship with the binary (catalog at `lenses://catalog`):
`academic`, `academic-extended`, `clinical`, `legal`, `finance`, `government`,
`journalism`, `devops`, `docs` (+ custom JSON lenses). Reference by short name:

```javascript
web_search({ query: "ML-KEM constant-time implementations", lens: "academic", count: 8 })
web_search({ query: "FDA breakthrough designation 2026", lens: "clinical" })
```

## MCP Resources & Prompts

Live status/diagnostics the agent can read: `stats://tools`, `stats://sessions`,
`stats://rate-limits`, `stats://providers`, `lenses://catalog`,
`diagnostics://errors/recent`, `diagnostics://health`, and a large-payload artifact
store `research://artifact/{id}`. Ready-made research prompt templates appear as `/` commands.

## Browser Delegation (Critical)

`web-researcher-mcp`'s tier-4 scrape (`go-rod` + stealth) would auto-download its own
Chromium per pod. In agentbox this is **disabled** — a second Chromium duplicates the
`browsercontainer` sidecar (Chrome Beta 149+, NVIDIA Vulkan, VNC :5903, MCP SSE :8931):

```
SCRAPER_DISABLE_BROWSER=true
CHROME_PATH=                       # empty -> tier 4 hard-fails fast
```

When tiers 1–3 (markdown negotiation, stealth HTTP, HTML parser) can't extract a
JS-rendered page (`NEEDS_BROWSER`), switch to the `browser` skill — do **not** retry inside this MCP:

```
1. scrape_page(url)  -> tiers 1-3 ok => done ; all fail => NEEDS_BROWSER
2. browser_navigate({url}) on browser-gpu
3. browser_snapshot() / browser_evaluate(...)
```

One Chrome surface, one GPU allocation, one audit trail.

## Required Configuration

Set at least one search provider (read from session env):

```
GOOGLE_CUSTOM_SEARCH_API_KEY  GOOGLE_CUSTOM_SEARCH_ID   # PSE (default)
BRAVE_API_KEY                                           # Brave
SERPER_API_KEY                                          # Serper.dev
SEARCHAPI_API_KEY                                       # SearchAPI.io
EXA_API_KEY                                             # Exa (neural search + citation-graph provider)
SEARXNG_URL                                             # self-hosted
```

Multi-provider routing with per-provider circuit breakers + failover:

```bash
export SEARCH_ROUTING=brave,google,serper
# or per-operation JSON:
export SEARCH_ROUTING='{"web":"brave,google","news":"brave,serper","images":"google,brave","default":"brave,google"}'
```

## Composition Patterns

| Goal | Recipe |
|------|--------|
| Deep cited report | `web-researcher` (search/verify) → `deep-research` (parallel agents + adversarial verify) |
| Trustworthy academic claim | `academic_search` → `verify_citation` → `citation_graph` → `format_bibliography` |
| Keep a cited source alive | `archive_source` (Wayback) before publishing |
| Fast casual answer | `perplexity-research` instead |
| Single known URL | `scrape_page` (this skill); JS-rendered → `browser` sidecar |
| JS-rendered SPA | `scrape_page` → fallback to `browser` skill |
| Add provenance sidecars to a deliverable | pair with `provenance-tracking` |

## Health Check

Hold stdin open long enough for the response (the server exits on EOF):

```bash
{ printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 3; } \
  | web-researcher-mcp 2>/dev/null | grep -o '"name":"[a-z_]*"' | sort -u
```

## References

- Deployment / Nix pin / provider gating: [`references/deployment.md`](references/deployment.md)
- Upstream (binary v1.43.0): https://github.com/zoharbabin/web-researcher-mcp
- Authoritative tools: `docs/TOOLS.md` ; deployment: `docs/DEPLOYMENT.md` (upstream)
- Related skills: `perplexity-research` (fast closed synthesis), `deep-research`
  (multi-agent harness), `browser` (JS-rendered pages / interactive flows),
  `provenance-tracking`, `autoresearch`, `ontology-augment`

> Note: `gemini-url-context` / `web-summary` are referenced by some older skill docs but
> the backing `gemini` CLI is **not on PATH** here — those routes are non-functional
> pending a gemini CLI install. Use `scrape_page` (this skill) or the `browser` sidecar
> for single-URL expansion instead.
