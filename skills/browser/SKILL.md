---
name: browser
description: >
  Browser automation via the external browsercontainer sidecar (chrome-devtools-mcp).
  Use for navigating web pages, screenshots, accessibility snapshots, form-filling,
  JavaScript evaluation, and WebGPU rendering validation. Connects over MCP SSE.
version: 2.0.0
triggers:
  - /browser
  - browse
  - web automation
  - scrape
  - navigate
  - screenshot
---

# Browser Automation Skill

All browser automation runs on the external `browsercontainer` sidecar via
`chrome-devtools-mcp` (40+ tools) over MCP SSE. No local browser is installed
in the agentbox image.

## Connection

```
MCP SSE:  http://browsercontainer:8931/sse   (chrome-devtools-mcp)
CDP:      browsercontainer:9222              (raw Chrome DevTools Protocol)
VNC:      localhost:5903                     (visual debugging, Display :2)
```

Auto-registered at boot as `browser-gpu` in `.mcp.json`. Manual registration:

```bash
claude mcp add browser-gpu --transport sse http://browsercontainer:8931/sse
```

## When To Use

- Page navigation, clicking, typing, form fills
- Screenshots and accessibility snapshots
- JavaScript evaluation in page context
- WebGPU/WebGL rendering validation
- Console log monitoring
- Multi-tab workflows

## When Not To Use

- Fetching page content without interaction -- use `web-summary` or `gemini-url-context`
- API testing without a browser -- use `curl` or `httpx`
- Raw CDP protocol scripting -- use the **chrome-cdp** skill
- QE-grade typed assertions, visual-diff baselines -- use **qe-browser**

## Key Tools

### `browser_snapshot` (preferred for LLM interaction)
Returns an accessibility tree -- structured, deterministic, no vision model needed.

### `browser_take_screenshot`
Capture viewport or full-page screenshot as PNG/JPEG.

### `browser_navigate`
Navigate to a URL.

### `browser_click` / `browser_type` / `browser_fill_form`
Interact with page elements.

### `browser_evaluate`
Execute JavaScript in the page context.

### `browser_console_messages`
Read browser console output.

## Quick Start

```javascript
browser_navigate({ url: "https://example.com" })
browser_snapshot()
browser_take_screenshot({ filename: "page.png", fullPage: true })
```

## Sidecar Management

```bash
agentbox.sh browsercontainer up        # start
agentbox.sh browsercontainer health    # check all 5 services
agentbox.sh browsercontainer cdp       # list CDP tabs
agentbox.sh browsercontainer shell     # shell into container
agentbox.sh browsercontainer rebuild   # full rebuild
```

## Health Check

```bash
curl -s http://browsercontainer:8931/health
curl -s http://browsercontainer:9222/json/list | jq '.[].url'
```

## LaTeX and Diagram Workflows

### Mermaid Rendering Workaround

**`mmdc` 11.14.0 in the Nix store has a broken puppeteer dependency.** Use the browser sidecar instead to render `.mmd` files:

```python
mmd_content = pathlib.Path("map.mmd").read_text()
html = f"""<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({{startOnLoad:true,theme:'default'}});</script>
</head><body style="background:white;margin:0;padding:20px">
<div class="mermaid">{mmd_content}</div>
</body></html>"""

html_path = "/tmp/mermaid_render.html"
pathlib.Path(html_path).write_text(html)
```

Then in the browser sidecar:
```javascript
browser_navigate({ url: `file://${html_path}` })
// Wait for Mermaid to render (evaluate or snapshot to verify)
browser_evaluate({ expression: "document.querySelector('.mermaid svg') !== null" })
browser_take_screenshot({ filename: "/tmp/wardley_map.png" })
// For high-DPI: use viewport scaling or take at larger viewport width
```

For 2x resolution, set a wider viewport before screenshotting:
```javascript
browser_evaluate({ expression: "document.body.style.zoom='200%'" })
browser_take_screenshot({ filename: "/tmp/wardley_map_2x.png" })
```

### PDF Preview During LaTeX Builds

Use the sidecar to visually verify LaTeX output during iterative builds:

```javascript
// Open the compiled PDF
browser_navigate({ url: "file:///path/to/book/main.pdf" })

// Screenshot specific pages for spot-checking
browser_take_screenshot({ filename: "/tmp/page_check.png" })

// Use browser_evaluate to jump to a specific page (PDF.js viewer)
browser_evaluate({ expression: "PDFViewerApplication.page = 42" })
browser_take_screenshot({ filename: "/tmp/page_42.png" })
```

This is the correct approach for arXiv/book builds — no local PDF viewer required.
