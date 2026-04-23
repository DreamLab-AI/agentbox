---
name: chrome-cdp
description: >
  Connect to live Chromium/Chrome browser sessions via Chrome DevTools Protocol.
  Lightweight CDP CLI with persistent per-tab daemons, no Puppeteer dependency.
  Use when you need to inspect, debug, or interact with pages already open in
  Chromium, access logged-in sessions, or execute raw CDP commands. Works with
  100+ tabs reliably. Requires Chromium with remote debugging enabled.
---

# Chrome CDP Skill

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket to live Chromium sessions -- no Puppeteer, no fresh browser, instant connection to tabs you already have open.

## When Not To Use

- For launching a fresh browser and automating forms/scraping -- use the browser or playwright skills instead
- For AI-optimised accessibility snapshots without CDP setup -- use the browser skill (agent-browser) instead
- For visual testing with screenshots on Display :1 -- use the playwright skill instead
- For debugging host web servers from inside Docker -- use the host-webserver-debug skill instead
- For simple page content fetching -- use curl, web-summary, or gemini-url-context instead

## Prerequisites

Chromium must be running with remote debugging enabled:

```bash
# Option A: Launch Chromium with remote debugging (headless)
chromium --remote-debugging-port=9222 --no-sandbox --headless &

# Option B: Launch on VNC display with debugging
DISPLAY=:1 chromium --remote-debugging-port=9222 --no-sandbox &

# Option C: Connect to existing Chromium via DevToolsActivePort
# Enable at chrome://inspect/#remote-debugging (toggle switch)
```

Verify CDP is responding:

```bash
curl -s http://localhost:9222/json/version | head -5
```

## Quick Start

```bash
# List all open tabs
scripts/cdp.mjs list

# Take screenshot of a tab (use targetId prefix from list)
scripts/cdp.mjs shot <target>

# Get accessibility tree (compact, semantic)
scripts/cdp.mjs snap <target>

# Evaluate JavaScript in page context
scripts/cdp.mjs eval <target> "document.title"

# Navigate to URL
scripts/cdp.mjs nav <target> https://example.com

# Click element
scripts/cdp.mjs click <target> "#submit-btn"

# Type text at focused element
scripts/cdp.mjs type <target> "Hello world"
```

The `<target>` is a unique prefix of the targetId shown by `list` (minimum 8 characters).

## Commands

| Command | Description |
|---------|-------------|
| `list` | List all open pages with targetIds |
| `shot <target> [file]` | Screenshot viewport (saves to runtime dir) |
| `snap <target>` | Accessibility tree snapshot (compact, semantic) |
| `html <target> [selector]` | Full HTML or element HTML via CSS selector |
| `eval <target> <expr>` | Evaluate JavaScript in page context |
| `nav <target> <url>` | Navigate and wait for load |
| `net <target>` | Network resource timing entries |
| `click <target> <selector>` | Click element by CSS selector |
| `clickxy <target> <x> <y>` | Click at CSS pixel coordinates |
| `type <target> <text>` | Insert text at focus (works cross-origin) |
| `loadall <target> <selector> [ms]` | Click "load more" until gone |
| `evalraw <target> <method> [json]` | Raw CDP command passthrough |
| `open [url]` | Open new tab |
| `stop [target]` | Stop daemon(s) |

## Coordinates

`shot` saves at native resolution: image px = CSS px x DPR. CDP input events use **CSS pixels**.

```
CSS px = screenshot px / DPR
```

The `shot` command prints the DPR for the current page.

## How It Works

```
┌──────────────────────────────┐
│  cdp.mjs CLI                 │
│  (Node.js 22+, no deps)     │
└──────────┬───────────────────┘
           │ Unix socket / named pipe
           ▼
┌──────────────────────────────┐
│  Per-Tab Daemon              │
│  (auto-spawned, 20min idle)  │
└──────────┬───────────────────┘
           │ WebSocket (raw CDP)
           ▼
┌──────────────────────────────┐
│  Chromium CDP endpoint       │
│  ws://localhost:9222/...     │
└──────────────────────────────┘
```

On first access to a tab, a background daemon spawns and holds the CDP session open. Subsequent commands reuse the daemon silently. Daemons auto-exit after 20 minutes of inactivity.

## Container-Specific Setup

In our Docker container, Chromium is at `/usr/bin/chromium` and can run on Display :1 (VNC port 5901).

### Headless CDP Session

```bash
# Start headless Chromium with CDP
chromium --remote-debugging-port=9222 --no-sandbox --headless --disable-gpu &
sleep 2

# Verify
curl -s http://localhost:9222/json/list | python3 -m json.tool

# Use
scripts/cdp.mjs list
```

### Visual CDP Session (VNC)

```bash
# Start Chromium on VNC display with CDP
DISPLAY=:1 chromium --remote-debugging-port=9222 --no-sandbox https://example.com &
sleep 3

# Now visible on VNC :5901 AND controllable via CDP
scripts/cdp.mjs list
scripts/cdp.mjs shot <target>
```

### Using with agent-browser CDP Connect

agent-browser can also connect to CDP endpoints:

```bash
# Connect agent-browser to existing CDP session
agent-browser connect 9222

# Then use agent-browser commands on the connected session
agent-browser snapshot -i
agent-browser click @e2
```

## Tips

1. **Prefer `snap` over `html`** for understanding page structure -- it is compact and semantic
2. **Use `type` not `eval`** to enter text in cross-origin iframes -- `click`/`clickxy` to focus first, then `type`
3. **Avoid index-based selectors across calls** -- DOM can change between `eval` calls. Collect all data in one `eval` or use stable selectors
4. **DPR matters for clickxy** -- divide screenshot coordinates by DPR (typically 2 on Retina) to get CSS pixel coordinates
5. **Daemons are persistent** -- once a tab is accessed, subsequent commands are instant (no reconnect)
6. **100+ tabs work** -- unlike Puppeteer-based tools that timeout during target enumeration
7. **Raw CDP passthrough** -- `evalraw` lets you call any CDP domain method directly

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_PORT_FILE` | Auto-detected | Path to DevToolsActivePort file |
| `CDP_HOST` | `127.0.0.1` | CDP host address |

## Related Skills

- **browser**: AI-optimised snapshots via agent-browser (lightweight, no CDP setup)
- **playwright**: Full Playwright API with MCP server on Display :1
- **host-webserver-debug**: HTTPS bridge for accessing Docker host servers
- **browser-automation**: Meta skill for choosing the right browser tool
