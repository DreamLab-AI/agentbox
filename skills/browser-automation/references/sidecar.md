# GPU Browser Sidecar — full reference

Canonical setup lives in the **`browser`** skill (`../browser/SKILL.md`). This
file holds the connection, registration, management, and environment detail that
`browser-automation` used to restate inline, kept here to avoid duplicating the
routing surface while preserving the full guidance.

For WebGPU/WebGL/3D testing with hardware GPU, use the `browsercontainer` sidecar.
It runs one Chrome Beta 149+ on one fixed 16:9 display with hardware WebGPU and
WebGL (NVIDIA, Vulkan/ANGLE) and exposes Google's `chrome-devtools-mcp` (40+ tools)
over MCP SSE (ADR-2207).

## Connection from agentbox

```bash
# MCP SSE (chrome-devtools-mcp — preferred for agents)
http://browsercontainer:8931/sse

# CDP direct (for cdp.mjs scripts) — in-network, by name (cdp-proxy.js)
# 9222 is the host-mapped port only, from the host machine
http://browsercontainer:9223

# Files: one volume, the same absolute path in agentbox and the sidecar
/home/devuser/exchange          # /home/devuser/gui-tools in agentbox is the same volume

# VNC desktop (visual debugging)
vnc://localhost:5903   # from host
```

## Register as MCP server

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

## Sidecar management

```bash
agentbox.sh browsercontainer up        # start
agentbox.sh browsercontainer health    # 200 healthy, 503 bridge up but Chrome down
agentbox.sh browsercontainer diagnose  # display size, WebGPU adapter + compute round trip
agentbox.sh browsercontainer cdp       # list CDP tabs
agentbox.sh browsercontainer shell     # shell into container
agentbox.sh browsercontainer rebuild   # full rebuild
agentbox.sh browsercontainer down      # stop
```

## chrome-devtools-mcp capabilities

Screenshots, accessibility snapshots, console reading, JS evaluation, performance
traces, memory profiling, DOM inspection, network monitoring, input simulation,
WebMCP discovery (Chrome 149+), extension management. Experimental flags enabled:
`--category-experimental-webmcp`, `--experimental-vision`, `--experimental-memory`;
usage statistics and update checks are off. Pinned 1.13.0.

## Bridge endpoints (8931)

`GET /health` (503 when Chrome is down), `GET /display`, `POST /display/fullscreen
{"on":true|false}`, `GET /record`, `POST /record/start {"name":"…"}`, `POST
/record/stop`. Recordings go to `/home/devuser/exchange/recordings/` (one at a time,
at most 1 h). The POSTs refuse any request with an `Origin` header.

## Environment — Sidecar

| Setting | Value |
|---------|-------|
| Display | `:2`, `BROWSER_DISPLAY_SIZE` (default 1920x1080, 16:9 only), openbox maximises Chrome |
| VNC | Port 5903, no password |
| Chrome | Beta 149+ (Arch, AUR) |
| GPU | NVIDIA, operator-selected (Vulkan/ANGLE; WebGPU and WebGL) |
| MCP | chrome-devtools-mcp via SSE bridge |
| Network | `visionclaw_network` (Docker) |
| Files | `/home/devuser/exchange` (volume `agentbox_gui-tools-exchange`) |
