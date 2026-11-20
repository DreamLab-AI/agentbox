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

This is the canonical sidecar-connection block; the `chrome-cdp`
and `browser-automation` skills point here rather than restating it.

```
MCP SSE:  http://browsercontainer:8931/sse   (chrome-devtools-mcp)
CDP:      http://browsercontainer:9223       (DevTools by name, in-network; cdp-proxy.js)
VNC:      localhost:5903                     (visual debugging, Display :2)
Files:    /home/devuser/exchange             (same path in agentbox and the sidecar)
```

9222 is the host-mapped port (host `127.0.0.1:9222` → proxy `:9223` → Chrome);
use it only from the host, never from inside agentbox. The proxy accepts only IP,
`localhost` and `browsercontainer` as Host (Chrome's DNS-rebinding defence), and
returns `ws://` URLs for the host you called it by (ADR-2207).

Display: one Chrome window on one fixed 16:9 screen, 1920x1080 by default
(`BROWSER_DISPLAY_SIZE`), always maximised and at 100 % zoom on start.

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
- Visual PDF comparison and page review (see the workflow reference below)

## When Not To Use

- Fetching page content without interaction -- use `web-summary` or `gemini-url-context`
- API testing without a browser -- use `curl` or `httpx`
- Raw CDP protocol scripting -- use the **chrome-cdp** skill
- visual-diff baselines and accessibility checks via agentic-qe -- use **qe-browser**

## Key Tools

Tool names below are the `browser-gpu` server's (`mcp__browser-gpu__<name>`).
Connector 1.13 requires `pageId` on page-scoped calls. Use the intended page's
ID from `new_page` or `list_pages`; a selected tab is not an implicit target.
Element `uid`s must come from a snapshot of that same page.

### `take_snapshot` (preferred for LLM interaction)
Returns an accessibility tree -- structured, deterministic, no vision model needed. Element `uid`s from it feed `click`, `fill`, `hover`.

### `take_screenshot`
Capture viewport, full page (`fullPage: true`) or one element (`uid`); `filePath` saves instead of attaching.
On the headful GPU sidecar, a background-page capture can stall. Bring only your
owned test page to the front with `select_page({ pageId, bringToFront: true })`
before capturing, then close that page to return to the operator's tab. This
briefly changes the VNC display; coordinate if the owner is using it. Never
capture an unrelated operator tab to work around a timeout.

### `navigate_page`
Go to a URL (`type: "url"`), or back/forward/reload. `new_page` / `select_page` / `list_pages` manage tabs.

### `click` / `type_text` / `fill`
Interact with page elements.

### `evaluate_script`
Execute JavaScript in the page context.

### `list_console_messages`
Read browser console output.

## Quick Start

```javascript
new_page({ url: "https://example.com", background: true })
const pageId = 3 // example only: replace with the new page's returned ID
take_snapshot({ pageId })
select_page({ pageId, bringToFront: true }) // owned fixture only; briefly changes VNC
take_screenshot({ pageId, filePath: "/home/devuser/exchange/mcp/page.png", fullPage: true })
upload_file({ pageId, uid: "<file input uid from this page>", filePaths: ["/home/devuser/exchange/in/report.pdf"] })
```

## Passing files

`/home/devuser/exchange` is one volume at the same absolute path on both sides:
write a file there in agentbox and pass that path to `upload_file`; a screenshot
saved there is readable in agentbox at once. The MCP child runs with that directory
as its cwd and temp dir, so a relative `filePath` lands there too. No `docker cp`.
`/home/devuser/gui-tools` in agentbox is the same volume under its older name.

## Recording and fullscreen

```bash
curl -s -X POST http://browsercontainer:8931/record/start -d '{"name":"demo"}'
curl -s -X POST http://browsercontainer:8931/record/stop    # file is finalised on return
curl -s http://browsercontainer:8931/record                  # status and last path
curl -s -X POST http://browsercontainer:8931/display/fullscreen -d '{"on":true}'
curl -s http://browsercontainer:8931/display                 # size, window bounds and state
```

Recordings land in `/home/devuser/exchange/recordings/<name>-<UTC>.mkv` (one at a
time, at most 1 h). The POST endpoints refuse requests that carry an `Origin`
header, so call them from a shell, not from a web page.

## Sidecar Management

```bash
agentbox.sh browsercontainer up        # start
agentbox.sh browsercontainer health    # 200 healthy, 503 bridge up but Chrome down
agentbox.sh browsercontainer diagnose  # display size, WebGPU adapter + compute round trip
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

Rendering Mermaid `.mmd` files with Pele (`mmdc` / `pele-render`, no sidecar) and
comparing or spot-checking compiled LaTeX/PDF pages via the sidecar are covered in
[`references/latex-diagram-workflows.md`](references/latex-diagram-workflows.md).
