---
name: web-summary
description: >
  Summarize web content including YouTube videos with semantic topic links for
  Logseq and Obsidian. Uses Z.AI service (port 9600) for cost-effective summarization.
  Supports markdown, plain text, and note-taking formats.
version: 2.0.0
author: turbo-flow-claude
mcp_server: true
protocol: fastmcp
entry_point: mcp-server/server.py
dependencies:
  - httpx
  - youtube-transcript-api
---

# Web Summary Skill

URL content summarization and topic extraction via FastMCP, using Z.AI service for LLM processing.

## When to Use This Skill

- Summarize web articles, blog posts, documentation
- Extract and summarize YouTube video transcripts
- Generate semantic topic links for note-taking (Logseq, Obsidian)
- Create short, medium, or long summaries
- Extract key concepts from text

## Architecture

```
┌─────────────────────────────┐
│  Claude Code / VisionFlow   │
│  (MCP Client)               │
└──────────────┬──────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────┐
│  Web Summary MCP Server     │
│  (FastMCP - Python only)    │
└──────────────┬──────────────┘
               │ HTTP (port 9600)
               ▼
┌─────────────────────────────┐
│  Z.AI Service               │
│  (Cost-effective Claude)    │
└─────────────────────────────┘
```

## Tools

| Tool | Description |
|------|-------------|
| `summarize_url` | Summarize content from any URL (web or YouTube) |
| `youtube_transcript` | Extract full transcript from YouTube video |
| `generate_topics` | Generate semantic topic links from text |
| `health_check` | Verify Z.AI service connectivity |

## Examples

```python
# Summarize a web article
summarize_url({
    "url": "https://example.com/article",
    "length": "medium",
    "include_topics": True,
    "format": "logseq"
})

# Get YouTube transcript
youtube_transcript({
    "video_id": "dQw4w9WgXcQ",  # or full URL
    "language": "en"
})

# Generate topic links
generate_topics({
    "text": "Your text content here...",
    "max_topics": 10,
    "format": "obsidian"
})
```

## Output Formats

### Logseq
```markdown
- [[Topic One]]
- [[Topic Two]]
- [[Machine Learning]]
```

### Obsidian
```markdown
- [[Topic One]]
- [[Topic Two]]
- [[Machine Learning]]
```

### Plain
```markdown
- Topic One
- Topic Two
- Machine Learning
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZAI_URL` | `http://localhost:9600/chat` | Z.AI service endpoint |
| `ZAI_TIMEOUT` | `60` | Request timeout in seconds |

## Troubleshooting

**Z.AI connection failed:**
```bash
# Check Z.AI service status
supervisorctl status claude-zai

# Test Z.AI directly
curl -X POST http://localhost:9600/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello"}'
```

## VisionFlow Integration

This skill exposes `web-summary://capabilities` resource for discovery by VisionFlow's MCP TCP client on port 9500.
