---
name: notebooklm
description: >
  Programmatic access to Google NotebookLM for notebook management, source ingestion,
  AI chat, and content generation (audio overviews, video, slides, quizzes, mind maps,
  reports, infographics). Wraps the notebooklm-py SDK via MCP.
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: fastmcp
entry_point: mcp-server/server.py
dependencies:
  - notebooklm-py
  - playwright
env_vars:
  - NOTEBOOKLM_STORAGE_DIR
---

# NotebookLM Skill

Programmatic access to Google NotebookLM via the [notebooklm-py](https://github.com/teng-lin/notebooklm-py) SDK. Create notebooks, ingest sources (URLs, PDFs, YouTube, Drive), chat with your sources, and generate rich artifacts — audio overviews, videos, slide decks, quizzes, mind maps, reports, and more.

## When to Use This Skill

- **Research Automation**: Create notebooks and ingest multiple sources programmatically
- **Content Generation**: Generate audio overviews (podcasts), video explainers, slide decks from sources
- **Study Material**: Create quizzes, flashcards, and mind maps from research material
- **Report Writing**: Generate briefings, study guides, or blog posts from ingested sources
- **Knowledge Management**: Organise sources, chat with them, extract structured data

## When Not To Use

- For simple URL summarisation — use the gemini-url-context skill instead
- For broad web search — use the perplexity-research skill instead
- For local document processing without Google — use direct file tools
- For real-time browser automation — use the playwright or browser-automation skills

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────┐
│  NotebookLM MCP Server          │
│  (FastMCP - Python)             │
└──────────────┬──────────────────┘
               │ notebooklm-py SDK (async)
               ▼
┌─────────────────────────────────┐
│  Google NotebookLM API          │
│  (Browser OAuth2 credentials)   │
└─────────────────────────────────┘
```

## Authentication

NotebookLM uses browser-based OAuth2 — NOT an API key.

### First-Time Setup
```bash
# Install with browser support
pip install "notebooklm-py[browser]"
playwright install chromium

# Login (opens browser for Google OAuth)
notebooklm login

# Or with Edge SSO
notebooklm login --browser msedge

# Verify auth
notebooklm auth check --test
```

Credentials are stored in `~/.notebooklm/` (configurable via `NOTEBOOKLM_STORAGE_DIR`).

### Container Usage
For headless containers, authenticate once on a machine with a browser, then copy `~/.notebooklm/` into the container or mount it as a volume.

## Tools

| Tool | Description |
|------|-------------|
| `notebooklm_create_notebook` | Create a new notebook |
| `notebooklm_list_notebooks` | List all notebooks |
| `notebooklm_delete_notebook` | Delete a notebook |
| `notebooklm_add_source` | Add a source (URL, file, YouTube, text) |
| `notebooklm_list_sources` | List sources in a notebook |
| `notebooklm_chat` | Ask questions about notebook sources |
| `notebooklm_generate_audio` | Generate audio overview (podcast) |
| `notebooklm_generate_video` | Generate video overview |
| `notebooklm_generate_slides` | Generate slide deck |
| `notebooklm_generate_quiz` | Generate quiz from sources |
| `notebooklm_generate_mind_map` | Generate mind map |
| `notebooklm_generate_report` | Generate report (briefing/study guide/blog) |
| `notebooklm_download_artifact` | Download generated artifact to file |
| `notebooklm_share` | Manage notebook sharing |
| `notebooklm_health_check` | Check auth status and connectivity |

## Examples

```python
# Create notebook and add sources
notebooklm_create_notebook({"name": "AI Research 2026"})

notebooklm_add_source({
    "notebook_id": "abc123",
    "source_type": "url",
    "source": "https://arxiv.org/abs/2401.12345"
})

# Add text content with a title
notebooklm_add_source({
    "notebook_id": "abc123",
    "source_type": "text",
    "title": "Research Notes",
    "source": "Content goes here..."
})

# Chat with sources
notebooklm_chat({
    "notebook_id": "abc123",
    "question": "What are the key findings?"
})

# Generate audio podcast
notebooklm_generate_audio({
    "notebook_id": "abc123",
    "format": "deep-dive",
    "length": "medium",
    "instructions": "Focus on practical applications"
})

# Download
notebooklm_download_artifact({
    "notebook_id": "abc123",
    "artifact_type": "audio",
    "output_path": "/tmp/podcast.mp3"
})
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOTEBOOKLM_STORAGE_DIR` | No | Credential storage (default: `~/.notebooklm`) |
| `NOTEBOOKLM_TIMEOUT` | No | Request timeout in seconds (default: 300) |

## Capabilities & Limits

| Feature | Details |
|---------|---------|
| Audio formats | deep-dive, brief, critique, debate |
| Audio lengths | short, medium, long |
| Video formats | explainer, brief, cinematic |
| Slide formats | detailed, presenter |
| Quiz difficulty | easy, medium, hard |
| Report formats | briefing, study-guide, blog-post |
| Languages | 50+ for audio generation |
| Source types | URL, PDF, YouTube, Google Drive, text, audio, video, images |

## Troubleshooting

**Auth Expired:**
```bash
notebooklm login          # Re-authenticate
notebooklm auth check --test
```

**Headless Container:**
```bash
# Copy credentials from authenticated machine
docker cp ~/.notebooklm agentbox:/home/devuser/.notebooklm
```

**Playwright Issues on Linux:**
```bash
playwright install --with-deps chromium
```

## Integration with Other Skills

- `perplexity-research`: Research topics first, then ingest findings into NotebookLM
- `gemini-url-context`: Quick URL analysis before adding to notebooks
- `report-builder`: Combine NotebookLM reports with LaTeX formatting
- `ffmpeg-processing`: Post-process generated audio/video
