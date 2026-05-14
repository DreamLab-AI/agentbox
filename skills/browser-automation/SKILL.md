---
name: browser-automation
description: >
  Browser automation meta-skill. The official @playwright/mcp (61 tools) is the primary tool
  for all browser automation: navigation, interaction, screenshots, accessibility snapshots,
  network mocking, storage management, video recording, tracing, test assertions, coordinate-based
  vision, PDF generation, and WebGPU support on VNC Display :1. Use when automating browsers,
  testing UIs, scraping pages, or debugging web apps.
---

# Browser Automation

The official `@playwright/mcp` server is the primary browser automation tool. It replaces the
previous fragmented approach (6 separate tools) with a single 61-tool MCP server from Microsoft.

## When Not To Use

- For fetching page content without browser interaction -- use WebFetch, curl, web-summary, or gemini-url-context
- For API testing without a real browser -- use curl or httpx
- For building UI components -- use daisyui or ui-ux-pro-max-skill

## Primary Tool: @playwright/mcp

**61 tools** covering everything previously split across 6 separate tools:

```bash
claude mcp add playwright -- playwright-mcp --no-sandbox --caps vision,pdf,devtools,testing,network,storage
```

See the `playwright` skill for full tool reference.

### What It Covers

| Capability | @playwright/mcp tools | Previously required |
|---|---|---|
| Navigate, click, type, fill forms | `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form` | agent-browser or custom Playwright |
| Accessibility snapshots (LLM-friendly) | `browser_snapshot` | agent-browser snapshots |
| Screenshots (viewport or full-page) | `browser_take_screenshot` | Custom Playwright or CDP |
| JavaScript evaluation | `browser_evaluate`, `browser_run_code` | CDP eval or custom Playwright |
| Network mocking, offline simulation | `browser_route`, `browser_network_state_set` | Not available |
| Cookie/localStorage/sessionStorage CRUD | 15 `browser_cookie_*`/`browser_*storage_*` tools | Not available |
| Video recording with chapter markers | `browser_start_video`, `browser_video_chapter` | Not available |
| Performance tracing | `browser_start_tracing`, `browser_stop_tracing` | Not available |
| Coordinate-based mouse interactions | 6 `browser_mouse_*` tools | Not available |
| Test assertions | `browser_verify_*` (4 tools), `browser_generate_locator` | qe-browser only |
| Tab management | `browser_tabs` | CDP only |
| PDF generation | `browser_pdf_save` | Not available |
| Drag and drop | `browser_drag` | Not available |
| File upload | `browser_file_upload` | Not available |
| Dialog handling | `browser_handle_dialog` | Not available |

### Quick Start

```bash
# Navigate and take accessibility snapshot (preferred for LLM interaction)
browser_navigate({ url: "https://example.com" })
browser_snapshot()

# Screenshot for visual verification
browser_take_screenshot({ filename: "page.png", fullPage: true })

# Execute Playwright code directly
browser_run_code({ code: "async (page) => { await page.goto('https://example.com'); return await page.title(); }" })
```

## Retired / Niche Tools

These remain installed but are no longer the recommended first choice:

| Tool | Status | When still useful |
|------|--------|-------------------|
| **agent-browser** | Niche | Multi-session parallel scraping with `--session` isolation. Lighter context if you only need `@ref`-based interaction. |
| **Chrome CDP** | Niche | Attaching to an already-running Chromium with remote debugging enabled (inspect live tabs with login state). |
| **qe-browser** | Niche | AQE fleet integration, Vibium-specific features (14-pattern injection scan, semantic intent finder). |
| **host-webserver-debug** | Niche | Docker-to-host HTTPS bridge. No overlap with Playwright. |
| **Custom mcp-server/server.js** | Retired | Superseded by official @playwright/mcp (10 tools -> 61 tools). |

## Environment

| Setting | Value |
|---------|-------|
| Display | `:1` (i3 WM on Xvnc, 1920x1080) |
| VNC | Port 5901, password: `agentbox` |
| Chromium | 147.0.7727.137 (Nix, WebGPU-capable) |
| Playwright | 1.60.0 |
| @playwright/mcp | 0.0.70 |

## WebGPU

Chromium 147 supports WebGPU natively. The `@playwright/mcp` server launches Chromium with
the configured args. For WebGPU demos/testing, add launch flags:

```json
{
  "browser": {
    "launchOptions": {
      "args": ["--enable-features=Vulkan,WebGPU", "--enable-unsafe-webgpu"]
    }
  }
}
```

## Decision Tree

```
START: Browser task?
|
+- "Read page, no interaction" -> WebFetch / curl (no browser)
|
+- Everything else -> @playwright/mcp (61 tools)
   |
   +- Need multi-session parallel scraping? -> agent-browser --session
   +- Need to attach to live Chromium tabs? -> Chrome CDP
   +- Need AQE fleet injection scanning? -> qe-browser
   +- Need Docker-to-host bridge? -> host-webserver-debug
```
