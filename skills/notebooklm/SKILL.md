---
name: notebooklm
description: >
  Trigger when creating Google NotebookLM notebooks, ingesting sources (URLs, PDFs, YouTube,
  Drive, text), chatting with those sources, or generating NotebookLM artifacts — audio
  overviews (podcasts), video explainers, slide decks, quizzes, mind maps, reports,
  infographics. Wraps the notebooklm-py SDK via an MCP server. NOT for simple URL
  summarisation (use gemini-url-context), broad web search (use perplexity-research),
  local document processing without Google, or general browser automation (use browser /
  browser-automation — the local Playwright here is only the SDK's own OAuth session).
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

Programmatic access to Google NotebookLM via the [notebooklm-py](https://github.com/teng-lin/notebooklm-py) SDK, exposed as a FastMCP server. Create notebooks, ingest sources, chat with them, and generate rich artifacts (audio, video, slides, quizzes, mind maps, reports).

## When to Use

- **Research automation** — create notebooks and ingest multiple sources programmatically
- **Content generation** — audio overviews (podcasts), video explainers, slide decks from sources
- **Study material** — quizzes, flashcards, mind maps from research material
- **Report writing** — briefings, study guides, or blog posts from ingested sources
- **Knowledge management** — organise sources, chat with them, extract structured data

## When Not to Use

- Simple URL summarisation → `gemini-url-context`
- Broad web search → `perplexity-research`
- Local document processing without Google → direct file tools
- Real-time browser automation → `browser` / `browser-automation` (see the auth note below on why the SDK's local Playwright is not this)

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

> **Local Playwright is a scoped exception, not a policy breach.** The `playwright install chromium` here provisions the notebooklm-py SDK's *own* OAuth browser session to obtain Google credentials — it is not general-purpose browser automation and does **not** replace the browsercontainer GPU sidecar. The container's local-Playwright deprecation rule targets automation workloads; this is the SDK's authentication flow, so that rule is not being violated.

Credentials are stored in `~/.notebooklm/` (configurable via `NOTEBOOKLM_STORAGE_DIR`). For headless containers, authenticate once on a machine with a browser, then copy or mount `~/.notebooklm/` into the container.

## Reference

Tool catalogue, worked examples, environment variables, capability limits, troubleshooting, and cross-skill integration: [`references/reference.md`](references/reference.md).
