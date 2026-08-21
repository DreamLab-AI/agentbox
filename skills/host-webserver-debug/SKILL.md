---
name: host-webserver-debug
description: >
  Trigger on "https bridge", "CORS error accessing host", "debug host webserver",
  "reach host dev server from container", or needing a secure-context (HTTPS) origin for a
  host HTTP server (Vite/Next/Express on the Docker host). Stands up a self-signed HTTPS
  bridge that proxies container→host so browser secure-context APIs work. NOT for general
  browser automation, screenshots, form filling, or scraping (use the browser/playwright
  skills — this skill delegates all browser work to the browsercontainer sidecar), NOT for
  API testing without a browser (use curl), and NOT for apps that are not on the Docker host.
version: 1.1.0
author: agentbox-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - openssl
triggers:
  - "https bridge"
  - "cross-origin"
  - "CORS error"
  - "host webserver"
  - "reach host dev server"
---

# Host Webserver Debug Skill

Bridge HTTPS→HTTP so a browser can hit a web server running on the Docker **host** from
inside a container, with a proper secure-context origin. This skill owns only the
container-specific **HTTPS-bridge proxy**; all browser work (navigate, screenshot,
DevTools) is delegated to the **browsercontainer sidecar** via `chrome-devtools-mcp` — see
the `browser` and `playwright` skills. There is no local Playwright/Chromium here.

## When not to use

- General browser automation, form filling, scraping → `browser` / `playwright`.
- Summarising page content → `web-summary` / `gemini-url-context`.
- API testing without a browser → `curl` / `httpx`.
- Apps not running on the Docker host → standard debugging tools.

## Tools

| Tool | Description |
|------|-------------|
| `bridge_start` | Start HTTPS bridge proxy to host server |
| `bridge_status` | Check bridge connection status |
| `bridge_stop` | Stop HTTPS bridge proxy |
| `debug_cors` | Analyse CORS headers and issues |
| `health_check` | Verify host server connectivity |
| `get_host_ip` | Detect Docker host gateway IP |

Screenshots and navigation are performed through the sidecar's `browser-gpu` MCP tools
(`mcp__browser-gpu__new_page`, `navigate_page`, `take_screenshot`), not by this skill.

## Installation

```bash
# Install dependencies (skill lives at /opt/agentbox/skills/host-webserver-debug in the image)
cd /opt/agentbox/skills/host-webserver-debug
npm install

# Add MCP server to Claude Code
claude mcp add host-webserver-debug -- \
  node /opt/agentbox/skills/host-webserver-debug/mcp-server/server.js
```

## Quick start

```bash
# 1. Detect host gateway IP
ip route | grep default | awk '{print $3}'

# 2. Start the bridge (auto-detects host IP)
node /opt/https-bridge/https-proxy.js
# ...or with custom settings:
HOST_IP=192.168.0.51 HTTPS_PORT=3001 TARGET_PORT=3001 node /opt/https-bridge/https-proxy.js

# 3. Reach the host server over HTTPS
curl -sk https://localhost:3001
```

To screenshot it, drive the sidecar (see the `browser` skill for connection details):

```
mcp__browser-gpu__new_page          { url: "https://<bridge-host>:3001" }
mcp__browser-gpu__take_screenshot   { fullPage: true }
```

The sidecar Chrome ignores certificate errors, so self-signed bridge certs are accepted.

## Depth

- Architecture, environment variables, supervisord wiring, worked examples →
  [`references/usage.md`](references/usage.md)
- Bridge/host/cert/sidecar troubleshooting →
  [`references/troubleshooting.md`](references/troubleshooting.md)

## Related skills

- **browser** — canonical browsercontainer sidecar owner (screenshots, navigation).
- **playwright** — higher-level automation over the same sidecar.
- **chrome-cdp** — raw CDP debugging via the sidecar.
