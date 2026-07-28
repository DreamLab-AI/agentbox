---
name: browser-automation
description: >
  Router for browser-automation tasks — picks the right tool and points to the
  canonical sidecar setup. Use when driving a real browser: navigating pages,
  clicking, filling forms, taking screenshots, reading console or network traffic,
  debugging a web UI, or validating WebGPU/WebGL/GPU rendering on hardware. Sends
  GPU and standard automation to the browsercontainer sidecar, raw CDP scripting
  to chrome-cdp, and AQE injection scanning to qe-browser.
---

# Browser Automation — routing meta-skill

This skill decides *which* browser tool fits the task. The sidecar connection,
registration, and management details are owned by the **`browser`** skill
(`../browser/SKILL.md`); the full sidecar reference is in
[`references/sidecar.md`](references/sidecar.md). Don't restate them here.

## Quick path

- **Any browser automation** (WebGPU/WebGL tests, GPU rendering, console/network
  monitoring, performance traces, form automation, DOM inspection, accessibility
  snapshots) → **browsercontainer sidecar** via `http://browsercontainer:8931/sse`.
  Setup: see the `browser` skill or `references/sidecar.md`.
- **Raw CDP scripting** against live tabs → `chrome-cdp` skill (`cdp-sidecar.sh`).
- **AQE injection scanning / typed QE assertions** → `qe-browser` skill.

## When not to use

- Fetching page content without interaction — use WebFetch, curl, or web-summary.
- API testing — use curl or httpx.
- Building UI components — use daisyui or ui-ux-pro-max-skill.

## Niche tools

| Tool | When still useful |
|------|-------------------|
| **Chrome CDP (cdp.mjs)** | Raw CDP to live tabs — especially sidecar via `cdp-sidecar.sh` |
| **qe-browser** | AQE fleet integration, injection scanning |
| **host-webserver-debug** | Docker-to-host HTTPS bridge |

## Decision tree

```
START: Browser task?
│
├─ "Read page, no interaction" → WebFetch / curl
│
├─ WebGPU / WebGL / GPU rendering?
│  └─ YES → browsercontainer sidecar
│     ├─ Agent/MCP integration → http://browsercontainer:8931/sse
│     ├─ Raw CDP scripting → cdp-sidecar.sh (chrome-cdp skill)
│     └─ Visual debugging → VNC :5903
│
├─ Standard page automation?
│  └─ browsercontainer sidecar (chrome-devtools-mcp via SSE)
│
├─ Attach to live logged-in tabs?
│  └─ Chrome CDP (cdp.mjs / cdp-sidecar.sh)
│
└─ AQE fleet injection scanning?
   └─ qe-browser
```

Full sidecar setup, capabilities, and environment table:
[`references/sidecar.md`](references/sidecar.md).
