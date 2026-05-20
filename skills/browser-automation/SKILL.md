---
name: browser-automation
description: >
  Browser automation meta-skill with GPU sidecar integration. Routes tasks to the
  right tool: browsercontainer sidecar (Chrome Beta 149+, chrome-devtools-mcp 40+ tools,
  NVIDIA Vulkan GPU at browsercontainer:8931) for all browser automation including
  WebGPU/WebGL testing; chrome-cdp for raw CDP scripting. Use when automating
  browsers, testing UIs, or debugging web apps.
---

## GPU Browser Sidecar (browsercontainer)

For WebGPU/WebGL/3D testing with hardware GPU, use the `browsercontainer` sidecar.
It runs Chrome Beta 149+ with NVIDIA RTX 6000 (Vulkan/ANGLE) and exposes
Google's `chrome-devtools-mcp` (40+ tools) over MCP SSE.

### Connection from agentbox

```bash
# MCP SSE (chrome-devtools-mcp — preferred for agents)
http://browsercontainer:8931/sse

# CDP direct (for cdp.mjs scripts)
browsercontainer:9222

# VNC desktop (visual debugging)
vnc://localhost:5903   # from host
```

### Register as MCP server

Add to `.mcp.json` in the project or `~/.claude/.mcp.json` globally:

```json
{
  "mcpServers": {
    "browser-gpu": {
      "url": "http://browsercontainer:8931/sse"
    }
  }
}
```

### Sidecar management

```bash
agentbox.sh browsercontainer up        # start
agentbox.sh browsercontainer health    # check all 5 services
agentbox.sh browsercontainer cdp       # list CDP tabs
agentbox.sh browsercontainer shell     # shell into container
agentbox.sh browsercontainer rebuild   # full rebuild
agentbox.sh browsercontainer down      # stop
```

### chrome-devtools-mcp capabilities

Screenshots, accessibility snapshots, console reading, JS evaluation, performance
traces, memory profiling, DOM inspection, network monitoring, input simulation,
WebMCP discovery (Chrome 149+), extension management. Experimental flags enabled:
`--category-experimental-webmcp`, `--experimental-vision`, `--experimental-memory`.

**Priority order:**
1. **Sidecar (browsercontainer)** — all browser automation: WebGPU/WebGL tests, GPU rendering, console monitoring, performance traces, form automation, DOM inspection, accessibility snapshots

## When Not To Use

- Fetching page content without interaction — use WebFetch, curl, web-summary
- API testing — use curl or httpx
- Building UI components — use daisyui or ui-ux-pro-max-skill

## Niche Tools

| Tool | When still useful |
|------|-------------------|
| **Chrome CDP (cdp.mjs)** | Raw CDP to live tabs — especially sidecar via `cdp-sidecar.sh` |
| **qe-browser** | AQE fleet integration, injection scanning |
| **host-webserver-debug** | Docker-to-host HTTPS bridge |

## Environment — Sidecar

| Setting | Value |
|---------|-------|
| Display | `:2` (Xvfb, 1920x1080) |
| VNC | Port 5903, no password |
| Chrome | Beta 149+ (Arch, AUR) |
| GPU | NVIDIA RTX 6000 (Vulkan/ANGLE) |
| MCP | chrome-devtools-mcp via SSE bridge |
| Network | `visionclaw_network` (Docker) |

## Decision Tree

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
