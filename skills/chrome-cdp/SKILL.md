---
name: chrome-cdp
description: >
  Connect to Chrome/Chromium via Chrome DevTools Protocol — locally or to the
  browsercontainer GPU sidecar (Chrome Beta 149+, NVIDIA Vulkan/ANGLE,
  chrome-devtools-mcp 40+ tools). Use for WebGPU/WebGL testing on hardware GPU,
  console monitoring, JS evaluation, screenshots, performance traces, and
  raw CDP access to live browser sessions.
---

# Chrome CDP Skill

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket to live Chrome sessions — no Puppeteer, instant connection to existing tabs.

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

# Screenshot
scripts/cdp-sidecar.sh shot <target>

# Accessibility snapshot
scripts/cdp-sidecar.sh snap <target>

# Evaluate JS (check WebGPU availability)
scripts/cdp-sidecar.sh eval <target> "navigator.gpu ? 'WebGPU available' : 'No WebGPU'"

# Check GPU renderer
scripts/cdp-sidecar.sh eval <target> \
  "document.createElement('canvas').getContext('webgl2')?.getParameter(0x1F01)"
```

## Quick Start — Local

```bash
DISPLAY=:1 chromium --remote-debugging-port=9222 --no-sandbox &
scripts/cdp-connect.sh 9222 list
```

## Quick Start — Any Remote Host

```bash
scripts/cdp-connect.sh 192.168.2.48:9222 list

# Or via env vars
export BROWSER_CDP_HOST=browsercontainer BROWSER_CDP_PORT=9222
scripts/cdp-connect.sh list
```

## MCP SSE Bridge (chrome-devtools-mcp)

The sidecar exposes Google's `chrome-devtools-mcp` (40+ tools) over SSE at port 8931.
Each SSE connection spawns a dedicated `chrome-devtools-mcp` subprocess attached to the
persistent Chrome instance. This is the preferred way for Claude Code agents to interact.

```bash
# Health check
curl -s http://browsercontainer:8931/health | python3 -m json.tool

# From host
curl -s http://localhost:8931/health
```

Register as MCP server in `.mcp.json`:

```json
{
  "mcpServers": {
    "browser-gpu": {
      "url": "http://browsercontainer:8931/sse"
    }
  }
}
```

### chrome-devtools-mcp Tool Categories

| Category | Examples | Description |
|----------|---------|-------------|
| Screenshots | `screenshot`, `captureFullPageScreenshot` | Viewport and full-page captures |
| Accessibility | `getAccessibilityTree`, `getAccessibilitySnapshot` | Semantic page structure for LLMs |
| Console | `getConsoleMessages`, `evaluateJavaScript` | Read console output, execute JS |
| Performance | `startPerformanceTrace`, `stopPerformanceTrace` | Chrome DevTools performance traces |
| Memory | `takeHeapSnapshot`, `getMemoryInfo` | Heap analysis |
| DOM | `querySelector`, `getElementProperties` | DOM inspection |
| Network | `getNetworkRequests`, `enableNetworkInterception` | Request monitoring |
| Navigation | `navigateTo`, `reload`, `goBack` | Page navigation |
| Input | `click`, `type`, `pressKey`, `dispatchMouseEvent` | User interaction |
| WebMCP | `discoverWebMCPServers` | Chrome 149+ WebMCP server discovery |
| Extensions | `listExtensions`, `enableExtension` | Extension management |

Flags enabled on the sidecar: `--category-experimental-webmcp`, `--experimental-vision`,
`--experimental-memory`.

## Commands (cdp.mjs)

| Command | Description |
|---------|-------------|
| `list` | List all open pages with targetIds |
| `shot <target> [file]` | Screenshot viewport |
| `snap <target>` | Accessibility tree snapshot |
| `html <target> [selector]` | Full or element HTML |
| `eval <target> <expr>` | Evaluate JS in page context |
| `nav <target> <url>` | Navigate and wait for load |
| `net <target>` | Network resource timing |
| `click <target> <selector>` | Click by CSS selector |
| `clickxy <target> <x> <y>` | Click at CSS pixel coords |
| `type <target> <text>` | Insert text at focus |
| `loadall <target> <selector> [ms]` | Repeat-click "load more" |
| `evalraw <target> <method> [json]` | Raw CDP passthrough |
| `open [url]` | Open new tab |
| `stop [target]` | Stop daemon(s) |

The `<target>` is a unique prefix of the targetId from `list` (minimum 8 chars).

## WebGPU/WebGL Testing Workflow

```bash
# 1. Start sidecar
agentbox.sh browsercontainer up

# 2. Navigate to app
scripts/cdp-sidecar.sh open http://192.168.2.132:3001
sleep 5

# 3. Check rendering state
scripts/cdp-sidecar.sh eval <target> "JSON.stringify({
  gpu: !!navigator.gpu,
  secure: window.isSecureContext,
  sab: typeof SharedArrayBuffer !== 'undefined',
  canvases: document.querySelectorAll('canvas').length,
  renderer: document.createElement('canvas').getContext('webgl2')?.getParameter(0x1F01)
}, null, 2)"

# 4. Screenshot
scripts/cdp-sidecar.sh shot <target> /tmp/webgpu-test.png

# 5. Performance check
scripts/cdp-sidecar.sh eval <target> "JSON.stringify(
  performance.getEntriesByType('resource')
    .filter(r => r.duration > 100)
    .map(r => ({ name: r.name.split('/').pop(), ms: Math.round(r.duration) }))
)"

# 6. Full diagnostic (runs inside sidecar)
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js http://192.168.2.132:3001
```

## VNC Monitoring

View the sidecar Chrome desktop for visual debugging:

```bash
open vnc://localhost:5903   # no password
```

## Coordinates

`shot` saves at native resolution: image px = CSS px × DPR. CDP input events use **CSS pixels**.

## How It Works

```
┌──────────────────────────────┐
│  cdp.mjs CLI (agentbox)     │
└──────────┬───────────────────┘
           │ Unix socket / named pipe
           ▼
┌──────────────────────────────┐
│  Per-Tab Daemon              │
│  (auto-spawned, 20min idle)  │
└──────────┬───────────────────┘
           │ WebSocket (raw CDP)
           ▼
┌──────────────────────────────────────┐
│  Chrome CDP endpoint                 │
│  browsercontainer:9222 (sidecar)     │
│  or localhost:9222 (local)           │
└──────────────────────────────────────┘
```

## Network Topology

```
┌──────────────────────────────────────────────┐
│  visionclaw_network                          │
│                                              │
│  ┌──────────┐      ┌─────────────────────┐   │
│  │ agentbox │─────▶│  browsercontainer   │   │
│  │          │      │  Chrome Beta 149+   │   │
│  │ cdp.mjs  │      │  RTX 6000 GPU       │   │
│  │ skills/  │      │                     │   │
│  └──────────┘      │  :8931 MCP SSE      │   │
│                     │  :9222 CDP          │   │
│                     │  :5903 VNC          │   │
│                     └─────────────────────┘   │
└──────────────────────────────────────────────┘
        Host ports: 9222 (CDP), 8931 (MCP), 5903 (VNC)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_CDP_HOST` | `browsercontainer` | CDP target host for sidecar scripts |
| `BROWSER_CDP_PORT` | `9222` | CDP target port |
| `CDP_PORT_FILE` | Auto-detected | DevToolsActivePort file path |
| `CDP_HOST` | `127.0.0.1` | Host used by cdp.mjs internally |

## Troubleshooting

```bash
# Sidecar health
curl -s http://browsercontainer:8931/health | python3 -m json.tool

# CDP reachable?
curl -s http://browsercontainer:9222/json/version

# List tabs
curl -s http://browsercontainer:9222/json/list | python3 -m json.tool

# GPU check
docker exec browsercontainer nvidia-smi

# Restart sidecar
agentbox.sh browsercontainer down && agentbox.sh browsercontainer up
```

## Tips

1. **Prefer `snap` over `html`** — compact and semantic, better for LLMs
2. **Use `type` not `eval`** for text in cross-origin iframes
3. **Daemons are persistent** — subsequent commands to the same tab are instant
4. **100+ tabs work** — unlike Puppeteer-based tools
5. **`evalraw`** lets you call any CDP domain method directly

## Related Skills

- **browser-automation**: Meta skill — routing to the right browser tool
- **browser**: Browser automation via browsercontainer sidecar (chrome-devtools-mcp SSE)
- **playwright**: Browser automation via browsercontainer sidecar (chrome-devtools-mcp SSE)
- **host-webserver-debug**: HTTPS bridge for Docker-to-host servers
