---
name: chrome-cdp
description: >
  Raw Chrome DevTools Protocol scripting against a live Chrome session — direct
  WebSocket, no Puppeteer. Use when you need low-level CDP access: WebGPU/WebGL
  GPU testing, console/JS evaluation, screenshots, or performance traces on the
  browsercontainer GPU sidecar. For higher-level browser automation prefer the
  `browser` skill (chrome-devtools-mcp), which owns the canonical sidecar setup.
---

# Chrome CDP Skill

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket to live
Chrome sessions — no Puppeteer, instant connection to existing tabs. Reach for this
over the `browser`/`playwright` skills only when you need raw CDP domain calls or the
`cdp.mjs` command surface; for ordinary automation those MCP-backed skills are simpler.

## Two Chrome Targets

| Target | Address (from agentbox) | Address (from host) | Use Case |
|--------|------------------------|---------------------|----------|
| **browsercontainer sidecar** | `browsercontainer:9223` | `localhost:9222` | All browser automation — WebGPU/WebGL, screenshots, DOM |

No local browser is installed in agentbox. All CDP goes through the sidecar.

**WebGPU note:** `about:blank` and `data:` URIs do not support WebGPU.
Navigate to a real HTTP URL first (`localhost`/`127.0.0.1` are secure by default;
other HTTP origins need `TREAT_AS_SECURE` in docker-compose.browsercontainer.yml).

## Quick Start — Sidecar (Recommended)

```bash
# Ensure sidecar is running
agentbox.sh browsercontainer up
agentbox.sh browsercontainer health

# List tabs in sidecar Chrome
scripts/cdp-sidecar.sh list

# Open your WebGPU app
scripts/cdp-sidecar.sh open http://192.168.2.132:3001

# Screenshot / accessibility snapshot
scripts/cdp-sidecar.sh shot <target>
scripts/cdp-sidecar.sh snap <target>

# Evaluate JS (check WebGPU availability)
scripts/cdp-sidecar.sh eval <target> "navigator.gpu ? 'WebGPU available' : 'No WebGPU'"

# Check GPU renderer
scripts/cdp-sidecar.sh eval <target> \
  "document.createElement('canvas').getContext('webgl2')?.getParameter(0x1F01)"
```

`<target>` is a unique prefix of the targetId from `list` (min 8 chars).

## Quick Start — Local / Remote

```bash
# Local Chrome
DISPLAY=:1 chromium --remote-debugging-port=9222 --no-sandbox &
scripts/cdp-connect.sh 9222 list

# Any remote host (or via env vars). Canonical GPU target is the sidecar:
# browsercontainer:9223 (raw CDP via socat) — see the browser skill.
scripts/cdp-connect.sh remote-host.example:9222 list
export BROWSER_CDP_HOST=browsercontainer BROWSER_CDP_PORT=9222
scripts/cdp-connect.sh list
```

## Where the detail lives

The full catalogs and workflows are in [`references/reference.md`](references/reference.md):

- **MCP SSE bridge** (`chrome-devtools-mcp`, `.mcp.json` registration) + the
  40+ tool categories table
- **Full `cdp.mjs` command table** (`html`, `nav`, `net`, `click`, `clickxy`,
  `type`, `loadall`, `evalraw`, `stop`, …)
- **End-to-end WebGPU/WebGL testing workflow** + full diagnostic
- **VNC monitoring**, coordinates/DPR notes, architecture + network topology
  diagrams
- **Environment variables** and **troubleshooting** commands

## Related Skills

- **browser** — canonical sidecar path (chrome-devtools-mcp SSE). Owns the shared
  sidecar setup block; start here for ordinary browser automation.
- **browser-automation** — meta skill routing to the right browser tool.
- **playwright** — browser automation via the same sidecar (chrome-devtools-mcp SSE).
- **host-webserver-debug** — HTTPS bridge for Docker-to-host servers.
