# NotebookLM Skill — Reference

Depth for the `notebooklm` skill. Load on demand; the lean routing lives in `../SKILL.md`.

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
