---
name: web-summary
description: >
  Summarise a single web page or YouTube video into short/medium/long notes and
  extract semantic topic links for Logseq or Obsidian. Trigger when the user says
  "summarise this URL/article/video", "get the YouTube transcript", "pull the key
  points from this page", or "make Logseq/Obsidian topic links from this". Runs an
  MCP FastMCP server that scrapes the URL and summarises via the Ontology Loom
  facade (model-swappable LLM door). NOT for interactive browser automation (use
  browser/playwright), NOT for multi-URL comparison or structured extraction (use
  web-researcher scrape_page or the browser sidecar), NOT for broad multi-source
  cited web search (use perplexity-research/web-researcher), and NOT for text you
  already hold locally (summarise it directly).
version: 2.1.0
author: agentbox-claude
mcp_server: true
protocol: fastmcp
entry_point: mcp-server/server.py
dependencies:
  - httpx
  - youtube-transcript-api
---

# Web Summary Skill

Single-URL content summarisation and topic extraction via a FastMCP server. It
fetches the page (or YouTube transcript) and summarises it through the Ontology
Loom facade — the load-bearing, model-swappable LLM door (agentbox ADR-051). The
former Z.AI service on port 9600 is retired; see `references/architecture.md`.

## When to use

- Summarise one web article, blog post, or documentation page
- Extract and summarise a YouTube video transcript
- Generate semantic topic links for note-taking (Logseq, Obsidian)
- Produce short, medium, or long summaries; extract key concepts from text

## When not to use

- Interactive browser automation (clicking, filling forms, live scraping) — use the `browser` or `playwright` skills.
- Multi-URL comparison or structured data extraction from URLs — use `web-researcher` (`scrape_page` / `search_and_scrape`) or the `browser` sidecar for JS-rendered pages.
- Broad, multi-source web search with citations — use `perplexity-research` or `web-researcher`.
- Content you already have as local text — summarise it directly without this pipeline.

## Tools

| Tool | Description |
|------|-------------|
| `summarize_url` | Summarise content from any single URL (web or YouTube) |
| `youtube_transcript` | Extract full transcript from a YouTube video |
| `generate_topics` | Generate semantic topic links from text |
| `health_check` | Verify Ontology Loom facade connectivity |

## Examples

```python
# Summarise a web article
summarize_url({
    "url": "https://example.com/article",
    "length": "medium",
    "include_topics": True,
    "format": "logseq"
})

# Get a YouTube transcript
youtube_transcript({"video_id": "dQw4w9WgXcQ", "language": "en"})

# Generate topic links
generate_topics({"text": "Your text content here...", "max_topics": 10, "format": "obsidian"})
```

## Output formats

`logseq` and `obsidian` emit `- [[Topic]]` wiki-links; `plain` emits `- Topic`.

## Deeper reference

Architecture diagram, LLM backend wiring, environment variables (`LLM_URL`,
`LLM_MODEL`, `LLM_TIMEOUT`), troubleshooting, and VisionClaw integration:
[`references/architecture.md`](references/architecture.md).
