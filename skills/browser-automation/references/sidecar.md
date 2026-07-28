# GPU Browser Sidecar — full reference

Canonical setup lives in the **`browser`** skill (`../browser/SKILL.md`). This
file holds the connection, registration, management, and environment detail that
`browser-automation` used to restate inline, kept here to avoid duplicating the
routing surface while preserving the full guidance.

For WebGPU/WebGL/3D testing with hardware GPU, use the `browsercontainer` sidecar.
It runs Chrome Beta 149+ with NVIDIA RTX 6000 (Vulkan/ANGLE) and exposes
Google's `chrome-devtools-mcp` (40+ tools) over MCP SSE.

## Connection from agentbox

```bash
# MCP SSE (chrome-devtools-mcp — preferred for agents)
http://browsercontainer:8931/sse

# CDP direct (for cdp.mjs scripts)
browsercontainer:9222

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
agentbox.sh browsercontainer health    # check all 5 services
agentbox.sh browsercontainer cdp       # list CDP tabs
agentbox.sh browsercontainer shell     # shell into container
agentbox.sh browsercontainer rebuild   # full rebuild
agentbox.sh browsercontainer down      # stop
```

## chrome-devtools-mcp capabilities

Screenshots, accessibility snapshots, console reading, JS evaluation, performance
traces, memory profiling, DOM inspection, network monitoring, input simulation,
WebMCP discovery (Chrome 149+), extension management. Experimental flags enabled:
`--category-experimental-webmcp`, `--experimental-vision`, `--experimental-memory`.

## Environment — Sidecar

| Setting | Value |
|---------|-------|
| Display | `:2` (Xvfb, 1920x1080) |
| VNC | Port 5903, no password |
| Chrome | Beta 149+ (Arch, AUR) |
| GPU | NVIDIA RTX 6000 (Vulkan/ANGLE) |
| MCP | chrome-devtools-mcp via SSE bridge |
| Network | `visionclaw_network` (Docker) |
