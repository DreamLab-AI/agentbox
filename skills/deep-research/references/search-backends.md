# Search backends

Deep research never relies on one engine. Each researcher queries several backends in
parallel, keeps the ones that returned real pages, and cites the **page it fetched**, never
the engine's answer. This file says which backend does what, how to call it, and how the
results feed the integrity gates.

## The four backends

| Backend | What it is good at | How to call it | What it returns |
|---|---|---|---|
| `ceramic-search` | Exact-match keyword retrieval: named entities, dates, places, product and standard names | the `ceramic-search` skill, or its `curl https://api.ceramic.ai/search` call (needs `CERAMIC_API_KEY`); 2-8 keywords, not a sentence; issue synonym variants for recall | ranked URLs with long page extracts (set `maxDescriptionLength` high) |
| `perplexity-research` | Synthesis across the web, authoritative primary sources (government, academic), citation discovery, a first map of an unfamiliar topic | direct tools `perplexity_search` (URLs and snippets), `perplexity_ask` (quick cited answer), `perplexity_research` (slow, deep, multi-source), `perplexity_reason` (step-by-step analysis); the `perplexity-research` skill for domain/date filters and agent presets | an answer plus the URLs it drew on |
| `web-researcher` | Engine and source control: pick the backend (Google PSE, Brave, Serper, SearXNG, SearchAPI, Exa, DuckDuckGo fallback) and a trusted-domain **lens** (academic, clinical, legal, finance, government, journalism, devops, docs); news, academic, patent, clinical, legal and economics search; full-page scraping of PDF, DOCX, PPTX, YouTube and HN; citation integrity | `web-researcher` MCP tools: `web_search`, `search_and_scrape`, `academic_search`, `news_search`, `patent_search`, `clinical_search`, `legal_search`, `econ_search`, `scrape_page`, `citation_graph`, `verify_citation`, `audit_bibliography`, `archive_source`, `format_bibliography`, `research_export` | real links with the engine named; scraped page text; verification verdicts |
| Native `WebSearch` / `WebFetch` | Always available fallback; `WebFetch` reads one page | built-in tools | results list; one page's text |

JavaScript-rendered pages and interactive flows are out of scope for all four: the
`web-researcher` headless tier is disabled here, so hand those to the `browser` skill.
Questions about the estate's own knowledge graph go to `ontology-augment`, not to web search.

## The default fan-out

For every research question a researcher owns, run three backends **in parallel, in one
tool round**:

1. `ceramic-search` with 2-3 keyword variants of the question.
2. `perplexity_search` (or `perplexity_research` for the `deep` tier) with the question in
   plain words.
3. `web-researcher` `search_and_scrape` (or the domain search that fits: `academic_search`,
   `legal_search`, `clinical_search`, `econ_search`, `news_search`, `patent_search`) with a
   lens chosen for the dimension.

Fall back to native `WebSearch` only when a backend is unavailable (missing key, server
down) and **say so in the research file** under a `Backends` line, so the reader knows the
fan-out was narrower than planned. Never retry a failing backend in a loop.

Scale with the tier from `SKILL.md`: `quick` uses one backend (Perplexity or Ceramic, by
whether the question is semantic or keyword-shaped); `brief` uses the three-way fan-out per
dimension; `deep` adds `perplexity_research` and a second `web-researcher` pass with a
different engine or lens on anything contested.

## Answers are leads, pages are evidence

A synthesis engine's prose is not a source. Perplexity's answer, a search snippet, or a
Ceramic extract tells you **where to look**. Before a claim enters a research file:

1. Open the underlying page (`WebFetch`, `scrape_page`, or the extract when it holds the
   quoted text verbatim).
2. Quote from that page inside an `<untrusted-source url=… retrieved=…>` fence under its
   `### [n]` block, as `workflow.md` requires.
3. Cite the page's URL, never `perplexity.ai`, `api.ceramic.ai` or a search results page.

A claim that only a synthesis answer supports is `unresolved`, however confident the
answer sounded.

## Engine agreement is not source independence

Three engines returning the same article is **one** witness. The independence gate in
`integrity-gates.md` groups by origin, not by the engine that surfaced a page. Record in
each `### [n]` block which backend found the page (`Found via: ceramic | perplexity |
web-researcher/<engine> | websearch`). That lets the lead see when a "corroborated" claim
rests on one page that every engine indexed.

What cross-engine search *is* good for is **recall**: pages one engine misses, another
finds. Disagreement between engines about what exists is a prompt to look harder, not a
vote.

## Verification and provenance with web-researcher

The verifier (step 6 of `workflow.md`) uses `web-researcher` rather than a bare URL check:

- `verify_citation` on every critical citation: the URL resolves and the quoted text is on
  the page.
- `audit_bibliography` on the final brief's source list: dead links, duplicates, mismatched
  titles.
- `archive_source` on the sources a decision rests on, so the brief survives link rot; put
  the archive URL beside the live one in the provenance record.
- `format_bibliography` for the final reference list when the reader expects a citation
  style.

These complement the executable integrity gates, which check the brief against the
research files. They do not replace them: run `research-gates.mjs` as before.

## Codex / GPT-6 Astra fallback

Without the Agent tool the fan-out runs sequentially in one session, and without the MCP
tools use the HTTP forms: Ceramic's `curl` call, the `perplexity-research` skill's raw API
client, and native search. Record the narrower fan-out in `Backends`.
