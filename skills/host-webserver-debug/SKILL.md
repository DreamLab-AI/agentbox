---
name: host-webserver-debug
description: >
  Debug host web servers from inside Docker containers by bridging HTTPS to HTTP,
  taking screenshots with Playwright, and analyzing with Chrome DevTools.
  Solves cross-origin security issues when accessing host development servers.
version: 1.0.0
author: turbo-flow-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - chromium
  - playwright
  - openssl
triggers:
  - "debug host"
  - "https bridge"
  - "screenshot website"
  - "cross-origin"
  - "CORS error"
  - "host webserver"
---

# Host Webserver Debug Skill

Debug web applications running on the Docker host from inside containers.

## Installation

```bash
# Install dependencies
cd /home/devuser/.claude/skills/host-webserver-debug
npm install

# Add MCP server to Claude Code
claude mcp add host-webserver-debug -- node /home/devuser/.claude/skills/host-webserver-debug/mcp-server/server.js
```

### Quick Verification

```bash
# Detect host gateway IP
ip route | grep default | awk '{print $3}'

# Test MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node mcp-server/server.js
```

Bridges HTTPS to HTTP to bypass browser security restrictions, captures screenshots, and provides debugging tools.

## When to Use This Skill

- Access host development servers from container (e.g., http://192.168.0.51:3001)
- Bypass cross-origin security restrictions (HTTPS required for certain APIs)
- Take screenshots of web applications for visual verification
- Debug CORS issues between container and host
- Analyze web application performance from container perspective
- Visual regression testing of host applications

## Problem Solved

Browsers enforce security policies that prevent HTTP connections for certain features (clipboard API, service workers, etc.). When developing inside a Docker container and accessing a web server on the host, you need HTTPS. This skill creates an HTTPS bridge that proxies requests to the host HTTP server with proper certificates.

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

```
┌─────────────────────────────────────────────────────────────┐
│              Host Webserver Debug Skill                      │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │ HTTPS Bridge   │  │ Playwright     │  │ Screenshot    │ │
│  │ Proxy          │  │ Browser        │  │ Capture       │ │
│  │ (Port 3001)    │  │ (Display :1)   │  │ (PNG/PDF)     │ │
│  └───────┬────────┘  └───────┬────────┘  └───────┬───────┘ │
│          │                   │                   │          │
│          └───────────────────┴───────────────────┘          │
│                              │                               │
│                     MCP Server Interface                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                    Claude Code / AI Assistant
```

## Tools

| Tool | Description |
|------|-------------|
| `bridge_start` | Start HTTPS bridge proxy to host server |
| `bridge_status` | Check bridge connection status |
| `bridge_stop` | Stop HTTPS bridge proxy |
| `screenshot` | Take screenshot of bridged website |
| `screenshot_fullpage` | Take full-page screenshot |
| `navigate` | Navigate browser to URL via bridge |
| `debug_cors` | Analyze CORS headers and issues |
| `health_check` | Verify host server connectivity |
| `get_host_ip` | Detect Docker host gateway IP |

## Quick Start

### 1. Start the HTTPS Bridge

```bash
# Auto-detect host IP and start bridge
node /opt/https-bridge/https-proxy.js

# Or with custom settings
HOST_IP=192.168.0.51 HTTPS_PORT=3001 TARGET_PORT=3001 node /opt/https-bridge/https-proxy.js
```

### 2. Access via HTTPS

```bash
# Test connection
curl -sk https://localhost:3001

# Open in browser (via VNC)
DISPLAY=:1 chromium --ignore-certificate-errors https://localhost:3001
```

### 3. Take Screenshots

```javascript
// Using Playwright
const { chromium } = require('playwright');
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--ignore-certificate-errors', '--no-sandbox']
});
const page = await browser.newPage();
await page.goto('https://localhost:3001');
await page.screenshot({ path: 'screenshot.png', fullPage: true });
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_IP` | Auto-detected | Docker host IP address |
| `HOST_GATEWAY_IP` | Auto-detected | Same as HOST_IP (for supervisord) |
| `HTTPS_PORT` | `3001` | Local HTTPS port to listen on |
| `TARGET_PORT` | `3001` | Remote HTTP port on host |
| `CERT_DIR` | `/opt/https-bridge` | SSL certificate directory |
| `DISPLAY` | `:1` | X display for browser |
| `SCREENSHOT_DIR` | `/tmp/screenshots` | Screenshot output directory |

## Supervisord Integration

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

### Debug a Vite Dev Server

```bash
# On host: vite runs on http://localhost:3001
# In container:
curl -sk https://localhost:3001  # Access via bridge

# Take screenshot
DISPLAY=:1 node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://localhost:3001');
  await page.screenshot({ path: '/tmp/vite-app.png', fullPage: true });
  await browser.close();
})();
"
```

### Diagnose CORS Issues

```bash
# Check CORS headers
curl -sk -I -X OPTIONS https://localhost:3001/api/data \
  -H "Origin: https://localhost:3001" \
  -H "Access-Control-Request-Method: GET"

# The bridge adds these headers:
# Access-Control-Allow-Origin: *
# Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
# Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
```

### Multiple Ports

```bash
# Start additional bridges for different ports
HOST_IP=192.168.0.51 HTTPS_PORT=3002 TARGET_PORT=3002 node /opt/https-bridge/https-proxy.js &
HOST_IP=192.168.0.51 HTTPS_PORT=8080 TARGET_PORT=8080 node /opt/https-bridge/https-proxy.js &
```

### Visual Regression Testing

```javascript
// Take before/after screenshots for comparison
const { chromium } = require('playwright');

async function captureState(name) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.goto('https://localhost:3001');
  await page.waitForLoadState('networkidle');

  await page.screenshot({
    path: `/tmp/screenshots/${name}-${Date.now()}.png`,
    fullPage: true
  });

  await browser.close();
}
```

## Troubleshooting

### Bridge Won't Start

```bash
# Check if port is in use
ss -tlnp | grep 3001

# Kill existing process
pkill -f https-proxy

# Regenerate certificates
cd /opt/https-bridge
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt -subj "/CN=localhost"
```

### Host Unreachable

```bash
# Detect host gateway
ip route | grep default | awk '{print $3}'

# Test connectivity
ping -c 1 192.168.0.51
curl -s http://192.168.0.51:3001
```

### Browser Certificate Errors

```bash
# Chromium flags to ignore self-signed certs
chromium --ignore-certificate-errors --ignore-certificate-errors-spki-list

# Or in Playwright
const browser = await chromium.launch({
  args: ['--ignore-certificate-errors']
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true
});
```

### Check Bridge Logs

```bash
# Supervisord logs
sudo supervisorctl tail -f https-bridge

# Or direct log file
tail -f /var/log/https-bridge.log
```

## Security Notes

- Self-signed certificates are for **development only**
- The bridge adds permissive CORS headers - not for production
- Only accessible from within the container (localhost)
- Do not expose port 3001 externally without proper security

## Related Skills

- **playwright**: Browser automation and testing
- **chrome-devtools**: Advanced browser debugging
- **docker-manager**: Container management
