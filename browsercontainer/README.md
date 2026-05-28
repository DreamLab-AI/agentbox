# browsercontainer — headless Chrome with CDP + MCP bridge

Hardware-accelerated Chrome instance for browser automation, testing, and AI agent interaction via chrome-devtools-mcp.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  browsercontainer (Docker, visionclaw_network)               │
│                                                              │
│  ┌──────────┐  ┌─────────────────────────────────┐           │
│  │  Xvfb    │  │  Chrome Beta 149+               │           │
│  │  :2      │──│  Vulkan/ANGLE hardware accel     │           │
│  │  1920x   │  │  CDP on 127.0.0.1:9222          │           │
│  │  1080    │  │  --unsafely-treat-insecure-...   │           │
│  └──────────┘  └───────────┬─────────────────────┘           │
│       │                    │                                  │
│  ┌────┴─────┐  ┌───────────┴─────────────────────┐           │
│  │ x11vnc   │  │  socat CDP proxy                │           │
│  │ :5903    │  │  0.0.0.0:9223 → 127.0.0.1:9222  │           │
│  └──────────┘  └─────────────────────────────────┘           │
│                                                              │
│  ┌───────────────────────────────────────────────┐           │
│  │  MCP SSE bridge (server.js)                   │           │
│  │  spawns chrome-devtools-mcp per session        │           │
│  │  0.0.0.0:8931                                  │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

## Port layout

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 5903 | x11vnc | VNC | View Chrome desktop (debugging) |
| 8931 | server.js | HTTP/SSE | MCP bridge — agents connect here |
| 9222 | Chrome | HTTP/WS | CDP (internal, localhost only) |
| 9223 | socat | TCP | CDP proxy (exposed as host:9222) |

**CDP proxy mapping**: host `:9222` → container socat `:9223` → Chrome `:9222`.
socat rebinds the listening address so that `/json/list` returns `ws://` URLs
that external clients can connect to directly.

## Usage

```bash
# Start
agentbox.sh browsercontainer up

# Check health
agentbox.sh browsercontainer health

# View CDP tabs
agentbox.sh browsercontainer cdp

# Run diagnostic against a target URL
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js http://192.168.2.132:3001

# VNC into the desktop
open vnc://localhost:5903

# Shell access
agentbox.sh browsercontainer shell

# Full rebuild
agentbox.sh browsercontainer rebuild
```

## TREAT_AS_SECURE

Chrome treats HTTP origins as insecure by default, which blocks
`SharedArrayBuffer` (needed for the VisionClaw zero-copy position pipeline).
The `TREAT_AS_SECURE` env var lists comma-separated origins that Chrome should
treat as secure contexts. Set in `docker-compose.browsercontainer.yml`:

```yaml
- TREAT_AS_SECURE=http://192.168.2.132:3001,http://192.168.2.132:3000
```

The `launch-chromium.sh` script expands these into individual
`--unsafely-treat-insecure-origin-as-secure=<origin>` flags. Combined with
`--test-type` to suppress the warning banner.

For `SharedArrayBuffer` to work, the target page must also serve:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`)

VisionClaw's nginx.dev.conf adds these headers.

## Rendering

Both **WebGPU** and **WebGL** are hardware-accelerated via Vulkan/ANGLE on the
NVIDIA RTX 6000. Chrome is launched with `--enable-features=WebGPU` and
`--enable-unsafe-webgpu` so that WebGPU works on both HTTPS and HTTP origins.
VisionClaw currently uses WebGL (Three.js / React Three Fiber).
GPU passthrough is not strictly required — Chrome falls back to software
rendering without it. The healthcheck treats missing GPU as a warning, not a failure.

## CDP diagnostics

The built-in `cdp-diagnose.js` script navigates Chrome to a target URL,
waits for it to load, then reports:

- Page state (readyState, isSecureContext, crossOriginIsolated, SAB availability)
- WebSocket connections
- Console messages and errors
- Runtime.evaluate latency (detects main thread freezes)
- Screenshot saved to `/tmp/visionclaw-diagnose.png`

```bash
# Default target (192.168.2.132:3001), 15s wait
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js

# Custom target and wait time
docker exec browsercontainer node /opt/browsercontainer/cdp-diagnose.js http://example.com 20000
```

## MCP integration

Agents on the `visionclaw_network` connect via SSE:

```
http://browsercontainer:8931/sse
```

This spawns a `chrome-devtools-mcp` subprocess per session, providing
40+ browser automation tools (screenshots, accessibility snapshots,
performance traces, memory profiling, DOM inspection).

For Claude Code / agentbox agents, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "browser": {
      "url": "http://browsercontainer:8931/sse"
    }
  }
}
```
