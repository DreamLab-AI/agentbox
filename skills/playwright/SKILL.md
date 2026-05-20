---
name: playwright
description: >
  Browser automation, web scraping, visual testing, and WebGPU validation via the
  browsercontainer sidecar (chrome-devtools-mcp, 40+ tools). Use for navigating pages,
  clicking elements, filling forms, taking screenshots, executing JavaScript, accessibility
  snapshots, and WebGPU rendering validation. Visual access via VNC on port 5903.
  Hardware-accelerated Chrome Beta 149+ with NVIDIA Vulkan/ANGLE.
---

# Playwright Skill (Sidecar)

Browser automation via the `browsercontainer` Docker sidecar running `chrome-devtools-mcp`
(Google, 40+ tools) over MCP SSE. Chrome Beta 149+ with hardware-accelerated WebGPU and
WebGL via NVIDIA Vulkan/ANGLE on the RTX 6000. VNC monitoring on port 5903.

## Connection

All browser automation routes through the external sidecar. No local browser is used.

```
Claude Code (MCP Client)
  |  MCP Protocol (SSE)
  v
server.js SSE bridge (browsercontainer:8931)
  |  spawns chrome-devtools-mcp per session
  v
Chrome Beta 149+ (WebGPU, Vulkan/ANGLE)
  |  Xvfb :2
  v
x11vnc → VNC port 5903
```

### MCP Registration

Auto-registered at boot by `entrypoint-unified.sh` as `browser-gpu`. Manual registration:

```bash
claude mcp add browser-gpu --transport sse http://browsercontainer:8931/sse
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "browser-gpu": {
      "url": "http://browsercontainer:8931/sse"
    }
  }
}
```

### Quick Verification

```bash
# Health check
curl -s http://browsercontainer:8931/health

# List CDP tabs
curl -s http://browsercontainer:9222/json/list | jq '.[].url'

# VNC into Chrome desktop
vncviewer localhost:5903
```

## When To Use / Not To Use

**Use this skill when:**
- You need full browser interaction (click, type, navigate, fill forms)
- WebGPU/WebGL rendering validation (Three.js, R3F, Babylon.js)
- Visual regression testing with screenshots
- Multi-tab workflows
- Debugging web apps running on the host or inside Docker

**Consider alternatives:**
- **`browser`** -- lightweight AI-optimised snapshots, smaller context, faster
- **`qe-browser`** -- QE-grade typed assertions, visual-diff baselines, injection scanning
- **`chrome-cdp`** -- raw CDP protocol access for performance profiling and low-level debugging
- **`web-summary` / `gemini-url-context`** -- summarising page content without interaction
- **`curl` / `httpx`** -- API testing without a real browser

## Available Tools (40+)

| Category | Examples | Description |
|----------|---------|-------------|
| **Core** | `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_evaluate`, `browser_wait_for`, `browser_close` | Page navigation, interaction, screenshots, JS eval, accessibility snapshots |
| **Tabs** | `browser_tabs` | List, create, close, select tabs |
| **Vision** | `browser_mouse_move_xy`, `browser_mouse_click_xy`, `browser_mouse_drag_xy` | Coordinate-based interactions |
| **DevTools** | `browser_start_tracing`, `browser_stop_tracing` | Performance tracing |

### Key Tools

**`browser_snapshot`** (preferred over screenshots for LLM interaction)
Returns an accessibility tree of the page -- structured, deterministic, no vision model needed.

**`browser_take_screenshot`**
Capture viewport or full-page screenshot as PNG/JPEG. Returned as image content.

**`browser_evaluate`**
Execute JavaScript in the page context.

## WebGPU

The sidecar runs Chrome Beta 149+ with full WebGPU support via NVIDIA Vulkan/ANGLE:
- `--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,UseSkiaRenderer,SharedArrayBuffer,WebGPU`
- `--enable-unsafe-webgpu`
- GPU: Quadro RTX 6000 (24GB VRAM, Turing architecture)

WebGPU requires a secure context. `localhost` and `127.0.0.1` are secure by
default. For other HTTP origins, add them to the `TREAT_AS_SECURE` env var in
`docker-compose.browsercontainer.yml`. `about:blank` and `data:` URIs do NOT
have WebGPU access — always navigate to a real HTTP/HTTPS URL first.

## Network

The sidecar is on `visionclaw_network` and discoverable by hostname `browsercontainer`.

| Port | Service | Purpose |
|------|---------|---------|
| 8931 | MCP SSE bridge | Agent connection endpoint |
| 9223 | CDP (socat proxy, use from Docker network) | Chrome DevTools Protocol |
| 9222 | CDP (host-mapped to 9223) | Chrome DevTools Protocol (from host only) |
| 5903 | VNC (x11vnc) | Visual debugging |

## Visual Access

```bash
vncviewer localhost:5903   # no password, Display :2
```
