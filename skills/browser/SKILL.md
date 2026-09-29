---
name: browser
description: >-
  The entry point for all browser work in this estate. Drive a real Chrome via the
  browsercontainer sidecar over MCP SSE (`browser-gpu`). Use when a task needs a live
  browser — navigate, click, fill forms, screenshot, read the accessibility tree, run
  JavaScript in-page, or validate WebGPU/WebGL rendering. Canonical owner of the
  sidecar connection details. Not for raw CDP scripting (use chrome-cdp); when unsure
  which browser tool fits, `/route` reaches the unregistered browser-automation router.
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

## Connection (canonical)

This is the canonical sidecar-connection block; the `chrome-cdp`, `playwright`,
and `browser-automation` skills point here rather than restating it.

```
MCP SSE:  http://browsercontainer:8931/sse   (chrome-devtools-mcp)
CDP:      browsercontainer:9223              (raw Chrome DevTools Protocol, socat proxy, in-network)
VNC:      localhost:5903                     (visual debugging, Display :2)
```

9222 is the host-mapped port (socat rebinds Chrome's localhost-only :9222 to :9223
in-network); use it only from the host, never from inside agentbox.

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
- Mermaid diagram rendering (via `/render-mermaid` HTTP endpoint; see `mermaid-diagrams` skill)

## When Not To Use

- Fetching page content without interaction -- use `web-summary` or `gemini-url-context`
- API testing without a browser -- use `curl` or `httpx`
- Raw CDP protocol scripting -- use the **chrome-cdp** skill
- QE-grade typed assertions, visual-diff baselines -- use **qe-browser**

## Key Tools

Tool names below are the `browser-gpu` server's (`mcp__browser-gpu__<name>`).

### `take_snapshot` (preferred for LLM interaction)
Returns an accessibility tree -- structured, deterministic, no vision model needed. Element `uid`s from it feed `click`, `fill`, `hover`.

### `take_screenshot`
Capture viewport, full page (`fullPage: true`) or one element (`uid`); `filePath` saves instead of attaching.

### `navigate_page`
Go to a URL (`type: "url"`), or back/forward/reload. `new_page` / `select_page` / `list_pages` manage tabs.

### `click` / `type_text` / `fill` / `fill_form`
Interact with page elements.

### `evaluate_script`
Execute JavaScript in the page context.

### `list_console_messages`
Read browser console output.

## Quick Start

```javascript
navigate_page({ type: "url", url: "https://example.com" })
take_snapshot()
take_screenshot({ filePath: "page.png", fullPage: true })
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
curl -s http://browsercontainer:9223/json/list | jq '.[].url'
```

## LaTeX and Diagram Workflows

Rendering Mermaid `.mmd` files (works around the broken Nix `mmdc`) and
spot-checking compiled LaTeX/PDF pages via the sidecar are covered in
[`references/latex-diagram-workflows.md`](references/latex-diagram-workflows.md).
