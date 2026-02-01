---
name: playwright
description: >
  FALLBACK browser automation. Use @claude-flow/browser as PRIMARY.
  Browser automation, web scraping, and visual testing with Playwright on Display :1.
  Use for navigating web pages, clicking elements, filling forms, taking screenshots,
  executing JavaScript, and visual verification of web applications. Visual access
  available via VNC on port 5901.
version: 2.0.0
author: turbo-flow-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
priority: 10
dependencies:
  - chromium
  - playwright
---

# Playwright Skill (FALLBACK)

> **NOTE**: This is a FALLBACK browser skill. Use `@claude-flow/browser` as the PRIMARY browser system.
> It offers 59 MCP tools, 93% context reduction, trajectory learning, and swarm coordination.
> Only use Playwright when @claude-flow/browser is unavailable or you need Playwright-specific APIs.

Browser automation and visual testing via MCP SDK, with direct browser control on Display :1.

## Installation

```bash
# Add MCP server to Claude Code
claude mcp add playwright -- node /home/devuser/.claude/skills/playwright/mcp-server/server.js

# Or for project-specific install
cd /path/to/skill
npm install
```

### Quick Verification

```bash
# Test browser works on Display :1
DISPLAY=:1 chromium --no-sandbox https://example.com &

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  DISPLAY=:1 node mcp-server/server.js
```

## When to Use This Skill

- Navigate to web pages and capture screenshots
- Click buttons, links, and interactive elements
- Fill forms and submit data
- Execute JavaScript in page context
- Wait for dynamic content and AJAX responses
- Visual verification of web applications
- Web scraping and data extraction
- End-to-end testing of web UIs

## Architecture

```
┌─────────────────────────────┐
│  Claude Code / VisionFlow   │
│  (MCP Client)               │
└──────────────┬──────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────┐
│  Playwright MCP Server      │
│  (Consolidated from 3 files)│
└──────────────┬──────────────┘
               │ Direct Playwright API
               ▼
┌─────────────────────────────┐
│  Chromium Browser           │
│  Display :1 (VNC 5901)      │
└─────────────────────────────┘
```

## Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate browser to URL |
| `screenshot` | Capture screenshot (full page or viewport) |
| `click` | Click an element by CSS/XPath selector |
| `type` | Type text into input field |
| `evaluate` | Execute JavaScript in page context |
| `wait_for_selector` | Wait for element to appear/disappear |
| `get_content` | Get full HTML content of page |
| `get_url` | Get current page URL and title |
| `close_browser` | Close browser instance |
| `health_check` | Check browser connection health |

## Examples

```javascript
// Navigate and screenshot
await navigate({ url: "https://example.com" })
await screenshot({ filename: "homepage.png", fullPage: true })

// Fill and submit a form
await type({ selector: "#email", text: "user@example.com" })
await type({ selector: "#password", text: "secret123" })
await click({ selector: "button[type=submit]" })

// Wait for dynamic content
await wait_for_selector({ selector: ".results-loaded" })

// Execute JavaScript
await evaluate({ script: "document.querySelectorAll('.item').length" })
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X display for browser |
| `CHROMIUM_PATH` | `/usr/bin/chromium` | Path to Chromium binary |
| `PLAYWRIGHT_HEADLESS` | `false` | Run headless (no display) |
| `SCREENSHOT_DIR` | `/tmp/playwright-screenshots` | Screenshot output directory |
| `PLAYWRIGHT_TIMEOUT` | `30000` | Default timeout in ms |
| `VIEWPORT_WIDTH` | `1920` | Browser viewport width |
| `VIEWPORT_HEIGHT` | `1080` | Browser viewport height |

## Visual Access

Browser is visible via VNC:
```bash
# Connect with VNC client
vncviewer localhost:5901

# Password: turboflow
```

## VisionFlow Integration

This skill exposes `playwright://capabilities` and `playwright://status` resources for discovery by VisionFlow's MCP TCP client on port 9500.
