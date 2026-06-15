---
name: web-researcher
description: >
  Multi-source web research via the web-researcher-mcp Go server (tracks upstream
  v1.33.0) — you pick the search ENGINE and the trusted SOURCES, and every citation
  is a real, checkable link. ~26 MCP tools: web/image/news/academic/patent/structured
  search, search_and_scrape, sequential_search; domain search (clinical_search,
  legal_search/CourtListener, econ_search/World Bank+FRED, filing_search/SEC EDGAR);
  scrape_page (full PDF/DOCX/PPTX/YouTube/HN, not snippets); citation integrity
  (verify_citation, audit_bibliography, citation_graph, archive_source/Wayback,
  format_bibliography APA/MLA/BibTeX/RIS/CSL); a grounded `answer` that cites real
  sources; research session memory + export. Search LENSES restrict results to
  trusted domains (academic, clinical, legal, finance, government, journalism, devops,
  docs). Pluggable backends (Google PSE/Brave/Serper/SearXNG/SearchAPI/Exa) with
  failover. Use for reputation-attached research needing verifiable citations — the
  open, auditable, private counterpart to perplexity-research (fast closed synthesis).
  Headless scrape tier is DISABLED here → delegate JS-rendered pages to the `browser` sidecar.
version: 1.33.0
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
upstream_version: 1.33.0
license: MIT
---

# Web Researcher Skill

Production-grade live-web research bridge: search across **the engine you choose**,
narrow to **the sources you trust** (lenses), read the **full source** (not snippets),
and get citations you can **verify** — never fabricated, never a closed pre-synthesized
garden. Runs locally/private; never invokes a browser from inside this skill.

## Which web-search skill? (read this first — avoids the common mix-up)

| Need | Skill |
|------|-------|
| **Verifiable, reputation-attached research** — real citations, full sources, you control which domains are searched (lenses), private/local; client work, filings, publications, medical/legal/finance | **`web-researcher`** (this) |
| **Fast synthesized answer** from a closed engine, casual lookups, Perplexity's sonar/agent surface + their academic/policy filters | **`perplexity-research`** |
| **Multi-agent deep report** — fan-out + adversarial verification + cited synthesis (orchestrates searchers; can use either of the above as a backend) | **`deep-research`** |
| Expand a single known URL | **`gemini-url-context`** ; YouTube/page summary → **`web-summary`** |
| Interactive browser (login/click/JS render) | **`browser`** / **`playwright`** |

One-liner: **perplexity-research = closed engine, synthesized answer; web-researcher = your engine + trusted lenses, real verifiable sources; deep-research = the harness over both.**

## When To Use

- Research where your reputation is on the line — citations must be real and checkable.
- Restrict search to trusted sources via **lenses** (PubMed/arXiv/SEC/.gov, not random blogs).
- Read full articles — web pages, **PDF/DOCX/PPTX, YouTube transcripts, Hacker News** threads.
- Academic work: real papers + DOIs (`academic_search`), citation neighborhoods (`citation_graph`).
- Domain search: courts (`legal_search`), trials (`clinical_search`), macro/econ (`econ_search`), SEC (`filing_search`).
- **Verify** a citation before relying on it (`verify_citation`) or audit a whole reference list (`audit_bibliography`); snapshot a source to Wayback (`archive_source`); export a bibliography (`format_bibliography`).
- A direct, source-cited `answer` instead of a reading list; structured JSON extraction (`structured_search`).
- Session-tracked multi-step digs (`sequential_search`) with recovery + export.

## When Not To Use

- Quick casual lookup, no citing needed → `perplexity-research` or Claude built-in search.
- Single known URL summary → `gemini-url-context` or `web-summary`.
- Interactive browser flows (login, click, form-fill) → `browser` / `playwright`.
- WebGPU/WebGL rendering validation → `browser` / `chrome-cdp`.
- Multi-agent report with adversarial verification → `deep-research` (it can call this skill).
- Iterative metric-optimisation experiment loops → `autoresearch`.
- Grounding in OUR formal ontology/KG → `ontology-augment`.

## Connection

MCP stdio server registered as `web-researcher` in `mcp/mcp.json`. Binary resolved from
`$PATH` (Nix-baked when `[skills.research].web_researcher = true`, else
`go install github.com/zoharbabin/web-researcher-mcp/cmd/web-researcher-mcp@latest`).

```bash
# Manual registration (auto-registered at boot):
claude mcp add --scope user --transport stdio web-researcher -- web-researcher-mcp
```

> **Version gap (read this):** this doc tracks upstream **v1.33.0**, but the **deployed
> Nix binary is currently v1.2.2** (the original 8 tools: web/image/news/academic/patent/
> sequential search + scrape_page + search_and_scrape). The newer tools below (domain
> search, citation integrity, `answer`, session/memory) and the expanded lens set go live
> only after bumping the `flake.nix` pin (`webResearcherMcpPkg`: `version = "1.33.0"`,
> rev `v1.33.0` = commit `8ccf4c7e`, refresh `hash` + `vendorHash` via
> `nix-prefetch-github zoharbabin web-researcher-mcp --rev v1.33.0` and the first build's
> printed `vendorHash`) and rebuilding agentbox. Until then, **only the 8 v1.2.2 tools are
> live** — run `tools/list` (Health Check) to confirm what the server actually exposes.

## Tools (live set depends on configured providers — see notes)

**Search & read**
| Tool | What it does |
|------|--------------|
| `web_search` | Search the web; optionally restrict to trusted sources via a **lens** |
| `search_and_scrape` | Search then read the best results, quality-scored + deduped |
| `scrape_page` | Read any URL in full — pages, PDF/DOCX/PPTX, YouTube transcripts, HN (API); `mode:raw` for verbatim |
| `image_search` | Images by size/type/colour/format |
| `news_search` | Recent news with date controls + source filtering |
| `structured_search` | Search + extract structured JSON per result (supply a schema) — needs an Exa-class provider |
| `sequential_search` | Multi-step research that remembers prior findings |

**Domain search**
| Tool | Source |
|------|--------|
| `academic_search` | Real papers + DOIs (OpenAlex/Semantic Scholar/arXiv/PubMed/IEEE) |
| `citation_graph` | Walk a paper's citing/cited neighborhood — needs a citation-capable provider |
| `patent_search` | US/EP/WO/JP/CN/KR patent offices + classification |
| `legal_search` | US court opinions/dockets via CourtListener |
| `clinical_search` | ClinicalTrials.gov (discovery, not medical advice) |
| `econ_search` | World Bank indicators (keyless) + FRED US macro series |
| `filing_search` | SEC EDGAR filings + XBRL company facts — needs `EDGAR_CONTACT_EMAIL` |

**Citation integrity & output**
| Tool | What it does |
|------|--------------|
| `verify_citation` | Does a citation exist, match a real record, is it retracted/dead-link? Evidence, not a verdict |
| `audit_bibliography` | Audit a whole CSL-JSON/RIS/BibTeX list/session — per-entry + corpus flags |
| `verify_recommendation` | Check a recommended source before relying on it |
| `archive_source` | Capture a fresh Wayback snapshot so a cited page stays verifiable (write tool) |
| `format_bibliography` | APA / MLA / BibTeX / RIS / CSL-JSON (Zotero/EndNote/Mendeley-ready) |
| `answer` | One synthesized answer **with real citations** (needs an answer-capable provider, e.g. Exa) |

**Session / memory / collaboration** (some are opt-in, consent-gated by the operator)
| Tool | What it does |
|------|--------------|
| `get_research_session` / `research_export` | Recover a session after context loss; export a provenance-tracked report (md/JSON) |
| `memory_save` / `memory_recall` | Long-term research memory (opt-in) |
| `workspace_contribute` / `workspace_read` | Shared team workspace (opt-in) |
| `get_my_analytics` | Per-user usage/limits (opt-in) |

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
EXA_API_KEY                                             # Exa (enables `answer` + `structured_search`)
SEARXNG_URL                                             # self-hosted
EDGAR_CONTACT_EMAIL                                     # enables filing_search (SEC EDGAR)
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
| Single known URL | `gemini-url-context` / `web-summary` |
| JS-rendered SPA | `scrape_page` → fallback to `browser` skill |
| Add provenance sidecars to a deliverable | pair with `provenance-tracking` |

## Health Check

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | web-researcher-mcp 2>/dev/null | head -1
```

## References

- Upstream (v1.33.0): https://github.com/zoharbabin/web-researcher-mcp
- Authoritative tools: `docs/TOOLS.md` ; deployment: `docs/DEPLOYMENT.md` (upstream)
- Related skills: `perplexity-research` (fast closed synthesis), `deep-research`
  (multi-agent harness), `browser`, `gemini-url-context`, `web-summary`,
  `provenance-tracking`, `autoresearch`, `ontology-augment`
