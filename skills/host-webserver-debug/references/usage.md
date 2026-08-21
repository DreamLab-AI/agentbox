# Host Webserver Debug — Usage & Architecture

Depth for the `host-webserver-debug` skill. The lean trigger/tool surface lives in
`../SKILL.md`; this file holds architecture, environment variables, supervisord wiring,
and worked examples.

## Problem solved

Browsers enforce security policies that block certain features (clipboard API, service
workers, secure-context-only APIs) over plain HTTP. When you develop inside a Docker
container and access a web server running on the Docker host, you need an HTTPS origin.
This skill stands up an HTTPS bridge that terminates TLS with a self-signed certificate
and proxies to the host's HTTP server.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Container                              │
│  ┌──────────────────┐     ┌──────────────────┐                  │
│  │  Browser/Client  │────▶│  HTTPS Bridge    │                  │
│  │  https://localhost:3001│  (self-signed)   │                  │
│  └──────────────────┘     └────────┬─────────┘                  │
└────────────────────────────────────┼────────────────────────────┘
                                     │ HTTP proxy
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Host                                   │
│  ┌──────────────────┐                                           │
│  │  Web Server      │  (Vite, Next.js, Express, etc.)           │
│  │  http://192.168.0.51:3001                                    │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

This skill owns the **HTTPS-bridge proxy** — the genuinely container-specific piece.
Anything involving a real browser (navigation, screenshots, DevTools) is delegated to the
**browsercontainer sidecar** via `chrome-devtools-mcp` (the `browser`/`playwright`
skills). Do **not** run a local Playwright/Chromium on `DISPLAY :1` — that pre-sidecar
path is deprecated and removed from this skill.

```
┌─────────────────────────────────────────────────────────────┐
│              Host Webserver Debug Skill                      │
│                                                              │
│  ┌────────────────┐   ┌──────────────────────────────────┐ │
│  │ HTTPS Bridge   │   │  Browser work delegated to the   │ │
│  │ Proxy          │──▶│  browsercontainer sidecar        │ │
│  │ (Port 3001)    │   │  (chrome-devtools-mcp / MCP SSE) │ │
│  └───────┬────────┘   └──────────────────────────────────┘ │
│          │                                                  │
│                     MCP Server Interface                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                    Claude Code / AI Assistant
```

The sidecar reaches the bridge over the container network. Publish the bridge on an
address the sidecar can resolve (e.g. the container hostname or a shared Docker network)
rather than `localhost`, which is container-local.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_IP` | Auto-detected | Docker host IP address |
| `HOST_GATEWAY_IP` | Auto-detected | Same as HOST_IP (for supervisord) |
| `HTTPS_PORT` | `3001` | Local HTTPS port to listen on |
| `TARGET_PORT` | `3001` | Remote HTTP port on host |
| `CERT_DIR` | `/opt/https-bridge` | SSL certificate directory |
| `SCREENSHOT_DIR` | `/tmp/screenshots` | Screenshot output directory (sidecar writes here) |

## Supervisord integration

The bridge runs as a managed service:

```ini
[program:https-bridge]
command=/usr/local/bin/node /opt/https-bridge/https-proxy.js
directory=/opt/https-bridge
user=devuser
environment=HOME="/home/devuser",HOST_IP="%(ENV_HOST_GATEWAY_IP)s",HTTPS_PORT="3001",TARGET_PORT="3001"
autostart=true
autorestart=true
priority=350
stdout_logfile=/var/log/https-bridge.log
stderr_logfile=/var/log/https-bridge.error.log
```

## Examples

### Debug a Vite dev server

```bash
# On host: vite runs on http://localhost:3001
# In container: reach it through the bridge
curl -sk https://localhost:3001
```

Then screenshot it through the sidecar. In Claude Code, drive the `browser-gpu` MCP
server (see the `browser` skill for connection details):

```
mcp__browser-gpu__new_page          { url: "https://<bridge-host>:3001" }
mcp__browser-gpu__take_screenshot   { fullPage: true }
```

The sidecar Chrome is launched with certificate errors ignored, so self-signed bridge
certs are accepted. If you script it directly, navigate then capture:

```
mcp__browser-gpu__navigate_page     { url: "https://<bridge-host>:3001" }
mcp__browser-gpu__take_screenshot   { fullPage: true, filePath: "/tmp/screenshots/vite-app.png" }
```

### Diagnose CORS issues

```bash
# Check CORS headers through the bridge
curl -sk -I -X OPTIONS https://localhost:3001/api/data \
  -H "Origin: https://localhost:3001" \
  -H "Access-Control-Request-Method: GET"

# The bridge adds these headers:
# Access-Control-Allow-Origin: *
# Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
# Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
```

### Multiple ports

```bash
# Start additional bridges for different ports
HOST_IP=192.168.0.51 HTTPS_PORT=3002 TARGET_PORT=3002 node /opt/https-bridge/https-proxy.js &
HOST_IP=192.168.0.51 HTTPS_PORT=8080 TARGET_PORT=8080 node /opt/https-bridge/https-proxy.js &
```

### Visual regression testing

Bring the app up on the bridge, then take before/after screenshots through the sidecar
and diff them. Capture each state with `mcp__browser-gpu__take_screenshot` after
`mcp__browser-gpu__navigate_page` + `mcp__browser-gpu__wait_for` (network idle), writing
to timestamped files under `SCREENSHOT_DIR`. Compare with the `qe-browser` visual-diff
tooling or ImageMagick. Set the viewport with `mcp__browser-gpu__resize_page`
(e.g. 1920×1080) before capturing so baselines are stable.

## Security notes

- Self-signed certificates are for **development only**.
- The bridge adds permissive CORS headers — not for production.
- Only accessible from within the container network.
- Do not expose port 3001 externally without proper security.
