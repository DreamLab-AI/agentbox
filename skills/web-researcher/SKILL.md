---
name: web-researcher
description: >
  Multi-source web research via the web-researcher-mcp Go server. 8 MCP tools:
  web_search, scrape_page, search_and_scrape, image_search, news_search,
  academic_search (arXiv/PubMed/IEEE), patent_search (US/EP/WO/JP/CN/KR),
  sequential_search (multi-step session-tracked investigation). Pluggable
  search backends (Google PSE, Brave, Serper, SearXNG, SearchAPI) with
  multi-provider routing and automatic fallback. 4-tier content extraction
  (markdown -> stealth HTTP -> HTML parser -> headless browser). For JS-heavy
  pages the headless tier is DISABLED in this deployment; agents delegate to
  the `browser` skill (browsercontainer chrome-devtools-mcp sidecar) instead.
version: 1.0.0
triggers:
  - /research
  - web search
  - academic search
  - patent search
  - scrape page
  - news search
  - multi-source research
upstream: https://github.com/zoharbabin/web-researcher-mcp
license: MIT
---

# Web Researcher Skill

Production-grade live-web research bridge. Provides search, multi-tier
extraction, and domain lenses (programming, news, legal, medical) without
ever invoking a local browser from inside this skill.

## When To Use

- Multi-source research with citation aggregation
- Academic search across arXiv, PubMed, IEEE, Nature, Springer
- Patent search with CPC classification and office filters
- News with freshness controls + source allow/deny
- Combined search-and-scrape pipelines with quality scoring + dedup
- Sequential / session-tracked investigations
- Image search with size/colour/format filters
- Scraping non-JS pages (PDF, DOCX, PPTX, YouTube transcripts included)

## When Not To Use

- Single known URL summary -- use `gemini-url-context` or `web-summary`
- UK-pricing / vendor lookup with structured deliverable -- use
  `perplexity-research` (sonar-pro is tuned for that shape)
- Interactive browser flows (login, click, fill form) -- use `browser`
- WebGPU/WebGL rendering validation -- use `browser` or `chrome-cdp`
- Deep multi-agent research with provenance sidecars -- use `deep-research`
- Iterative metric-optimisation experiment loops -- use `autoresearch`

## Connection

This skill ships as an MCP stdio server registered as `web-researcher` in
`skills/mcp.json`. The runtime resolves the binary from `$PATH` (Nix-baked
when `[skills.research].web_researcher = true`, otherwise via
`go install github.com/zoharbabin/web-researcher-mcp/cmd/web-researcher-mcp@latest`).

```bash
# Manual registration (rarely needed -- auto-registered at boot):
claude mcp add --scope user --transport stdio web-researcher -- web-researcher-mcp
```

## Browser Delegation (Critical)

`web-researcher-mcp`'s tier-4 scrape strategy (`go-rod` + stealth) would
normally auto-download and run its own Chromium per pod. In agentbox this
is **disabled**:

```
SCRAPER_DISABLE_BROWSER=true
CHROME_PATH=                       # empty -> tier 4 hard-fails fast
```

Rationale: a second Chromium pool inside the agentbox image duplicates the
`browsercontainer` sidecar (Chrome Beta 149+, NVIDIA Vulkan, VNC :5903, MCP
SSE on 8931). When tiers 1-3 (markdown negotiation, stealth HTTP, HTML
parser) cannot extract a JS-rendered page, the agent MUST switch to the
`browser` skill rather than retry inside this MCP. Pseudo-flow:

```
1. scrape_page(url) on web-researcher
   -> tiers 1-3 succeed                    => done
   -> all tiers fail with NEEDS_BROWSER    => switch skill
2. browser_navigate({url}) on browser-gpu
3. browser_snapshot() / browser_evaluate(...)
```

This keeps a single Chrome surface, a single GPU allocation, and a single
audit trail for browser activity.

## Required Configuration

Search-provider keys are read from session env. Set at least one provider:

```
GOOGLE_CUSTOM_SEARCH_API_KEY   GOOGLE_CUSTOM_SEARCH_ID   # PSE (default)
BRAVE_API_KEY                                            # Brave
SERPER_API_KEY                                           # Serper.dev
SEARCHAPI_API_KEY                                        # SearchAPI.io
SEARXNG_URL                                              # self-hosted
```

Optional multi-provider routing with circuit breakers:

```bash
export SEARCH_ROUTING=brave,google,serper
# or per-operation JSON:
export SEARCH_ROUTING='{"web":"brave,google","news":"brave,serper","images":"google,brave","default":"brave,google"}'
```

## Tools

| Tool | Returns | Notes |
|------|---------|-------|
| `web_search` | Ranked results | Supports lens (programming/news/legal/medical/...) |
| `scrape_page` | Cleaned markdown + metadata | 3-tier (browser tier off); handles PDF/DOCX/PPTX/YouTube |
| `search_and_scrape` | Search + extraction with quality scoring + dedup | |
| `image_search` | Image hits with filters | size/type/colour/format |
| `news_search` | Freshness + source filtering | |
| `academic_search` | Scholarly papers | arXiv/PubMed/IEEE/Nature/Springer |
| `patent_search` | Patents | CPC classification, office filter US/EP/WO/JP/CN/KR |
| `sequential_search` | Session-tracked multi-step research | per-tenant session memory |

## Quick Start

```javascript
// General search with lens
web_search({ query: "rust async runtime comparison 2026", lens: "programming", count: 8 })

// Scrape a single URL (HTML / markdown / PDF / DOCX / PPTX / YouTube)
scrape_page({ url: "https://arxiv.org/abs/2401.12345", format: "markdown" })

// Combined pipeline
search_and_scrape({ query: "post-quantum signature standards NIST 2026", top_k: 5 })

// Multi-step session
sequential_search({ session_id: "pqc-review", step: "1", query: "ML-KEM benchmark CPU" })
sequential_search({ session_id: "pqc-review", step: "2", query: "ML-KEM constant-time impls" })
```

## Lenses

JSON lens files under `lenses/` in the upstream repo bias `site:` operators
toward a domain. Ship with the binary; reference by short name:

| Lens | Focuses on |
|------|------------|
| `programming` | GitHub, StackOverflow, dev.to, MDN, language docs |
| `news` | Reuters, AP, BBC, FT, NYT, Guardian |
| `legal` | EU Lex, Westlaw, legal blogs, .gov |
| `medical` | PubMed, NIH, Cochrane, WHO |

## Caching, Rate Limits, Audit

The server has built-in hybrid cache (memory + disk), three-tier rate
limiting, circuit breakers per provider, Prometheus metrics, and structured
audit logging. Defaults are sane for an agent session; tune via env if
running at high QPS (see `docs/DEPLOYMENT.md` upstream).

## Composition Patterns

| Goal | Recipe |
|------|--------|
| Deep cited report | `web-researcher` (search) -> `deep-research` (parallel agents + provenance) |
| UK pricing / SKUs  | `perplexity-research` (better at structured deliverables) |
| Single known URL  | `gemini-url-context` or `web-summary` |
| JS-rendered SPA   | `web-researcher.scrape_page` -> fallback to `browser` skill |
| Session-tracked iterative dig | `sequential_search` with persistent `session_id` |

## Health Check

```bash
# Server reports health on stdio init; for a quick sanity test:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | web-researcher-mcp 2>/dev/null | head -1
```

## References

- Upstream: https://github.com/zoharbabin/web-researcher-mcp
- Deployment guide: `docs/DEPLOYMENT.md` upstream
- Related skills: `browser`, `perplexity-research`, `deep-research`,
  `autoresearch`, `gemini-url-context`, `web-summary`
