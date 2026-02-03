---
name: gemini-url-context
description: >
  Expand and analyze URLs using Google Gemini 2.5 Flash URL Context API.
  Efficiently fetches, summarizes, and extracts information from up to 20 URLs
  per request with grounding metadata and source citations.
version: 1.0.0
author: turbo-flow-claude
mcp_server: true
protocol: fastmcp
entry_point: mcp-server/server.py
dependencies:
  - httpx
env_vars:
  - GOOGLE_GEMINI_API_KEY
---

# Gemini URL Context Skill

Leverage Google's Gemini 2.5 Flash model to expand, summarize, and analyze web content directly from URLs.

## When to Use This Skill

- **URL Expansion**: Fetch and summarize content from any URL
- **Multi-URL Analysis**: Compare or synthesize content from up to 20 URLs
- **Document Extraction**: Extract structured data from web pages
- **Research Aggregation**: Gather information from multiple sources
- **Content Grounding**: Get AI responses grounded in specific web sources

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────┐
│  Gemini URL Context MCP Server  │
│  (FastMCP - Python)             │
└──────────────┬──────────────────┘
               │ HTTPS REST API
               ▼
┌─────────────────────────────────┐
│  Google Gemini 2.5 Flash API    │
│  (with url_context tool)        │
└─────────────────────────────────┘
```

## Tools

| Tool | Description |
|------|-------------|
| `expand_url` | Expand and summarize a single URL |
| `expand_urls` | Batch expand multiple URLs (up to 20) |
| `compare_urls` | Compare content from 2+ URLs |
| `extract_from_url` | Extract specific data from URL content |
| `health_check` | Verify API connectivity |

## Examples

```python
# Expand a single URL
expand_url({
    "url": "https://example.com/article",
    "prompt": "Summarize the key points"
})

# Batch expand multiple URLs
expand_urls({
    "urls": [
        "https://example.com/page1",
        "https://example.com/page2"
    ],
    "prompt": "List the main topics from each page"
})

# Compare URLs
compare_urls({
    "urls": [
        "https://site1.com/product",
        "https://site2.com/product"
    ],
    "prompt": "Compare features and pricing"
})

# Extract structured data
extract_from_url({
    "url": "https://example.com/api-docs",
    "schema": {
        "endpoints": "list of API endpoints",
        "auth_method": "authentication method used",
        "rate_limits": "any rate limiting info"
    }
})
```

## Capabilities & Limits

| Feature | Limit |
|---------|-------|
| URLs per request | 20 max |
| Content size per URL | 34 MB max |
| Supported content | Text, Images, PDFs |
| Not supported | Paywalled, YouTube, Google Workspace, Video/Audio |

## Response Metadata

Responses include `urlContextMetadata` with:
- `retrievedUrl`: The URL that was fetched
- `urlRetrievalStatus`: SUCCESS, FAILED, or PARTIAL

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_GEMINI_API_KEY` | Yes | Gemini API key from https://aistudio.google.com/app/apikey |
| `GEMINI_MODEL` | No | Model override (default: gemini-2.5-flash) |
| `GEMINI_TIMEOUT` | No | Request timeout in seconds (default: 60) |

## Setup

```bash
# Set API key (add to .env or export)
export GOOGLE_GEMINI_API_KEY="your-api-key"

# Or add to /home/devuser/.claude/skills/.env
echo 'GOOGLE_GEMINI_API_KEY=your-key' >> /home/devuser/.claude/skills/.env
```

## Troubleshooting

**API Key Issues:**
```bash
# Test API key
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GEMINI_API_KEY" | jq '.models[0].name'
```

**URL Not Retrieved:**
- Check URL is publicly accessible (no paywall)
- Verify URL returns text/HTML/PDF content
- Check content size < 34MB

## Integration with Other Skills

Combine with:
- `web-summary`: For YouTube transcript extraction (Gemini doesn't support YouTube)
- `perplexity-research`: For broader web search before URL expansion
- `playwright`: For JavaScript-rendered pages that need browser execution
