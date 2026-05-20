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
