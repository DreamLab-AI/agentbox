---
name: web-summary
description: "Summarises one web page or YouTube video into short, medium or long notes with semantic topic links for an Obsidian vault (agentbox-mcp web-summary via the Ontology Loom). Use for 'summarise this URL, article or video', 'get the YouTube transcript' or 'make vault topic links from this'. Not for side-by-side comparison or structured extraction across pages (gemini-url-context), cited multi-source search (web-researcher), interactive pages (browser) or text you already hold."
version: 2.2.0
author: agentbox-claude
mcp_server: true
protocol: rmcp
entry_point: agentbox-mcp web-summary
dependencies:
  - agentbox-mcp
---

# Web Summary Skill

Single-URL content summarisation and topic extraction via the `web-summary`
subcommand of `agentbox-mcp` — a single Rust `rmcp` binary
(`services/agentbox-mcp`) that also serves the `imagemagick` and
`gemini-url-context` skills. It replaces the former Python FastMCP server
one-for-one, including its own direct YouTube transcript fetch (watch page +
timedtext, no `youtube-transcript-api` dependency). It fetches the page (or
YouTube transcript) and summarises it through the Ontology Loom facade — the
load-bearing, model-swappable LLM door (agentbox ADR-051). The former Z.AI
service on port 9600 is retired; see `references/architecture.md`.

## When to use

- Summarise one web article, blog post, or documentation page
- Extract and summarise a YouTube video transcript
- Generate semantic topic links for note-taking in the vault (Obsidian)
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
    "format": "obsidian"
})

# Get a YouTube transcript
youtube_transcript({"video_id": "dQw4w9WgXcQ", "language": "en"})

# Generate topic links
generate_topics({"text": "Your text content here...", "max_topics": 10, "format": "obsidian"})
```

## Output formats

`obsidian` is the **default** (ADR-2028 D4) and emits `- [[Topic]]` wiki-links
ready to paste into a vault page; `plain` emits `- Topic`.

URL summaries also accept `markdown`. Unsupported format names are rejected.
Pages this skill's output lands in carry YAML frontmatter; see
`project/docs/VAULT-corpus-format.md`.

## Deeper reference

Architecture diagram, LLM backend wiring, environment variables (`LLM_URL`,
`LLM_MODEL`, `LLM_TIMEOUT`), troubleshooting, and VisionClaw integration:
[`references/architecture.md`](references/architecture.md).
