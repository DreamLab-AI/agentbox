---
name: browser-automation
description: >
  Unified browser automation meta-skill with progressive disclosure. Helps agents choose
  between agent-browser (AI snapshots), Playwright (full API + visual), Chrome CDP (live sessions),
  qe-browser (Vibium/WebDriver BiDi — typed assertions, visual-diff, injection scan, AQE fleet),
  and host-webserver-debug (Docker bridge). Covers headless and VNC Display :1 desktop modes.
  Use when you need to automate browsers, scrape pages, test UIs, debug web apps, or interact
  with live browser sessions. Invoke for any browser-related task to get the optimal tool selection.
---

# Browser Automation

Unified decision framework for browser automation in this container. Six tools are available, each optimised for different scenarios. This skill helps you choose -- or combine -- them.

## When Not To Use

- If you already know which browser tool to use -- invoke that skill directly (browser, playwright, qe-browser, chrome-cdp, host-webserver-debug)
- For fetching page content without browser interaction -- use WebFetch, curl, web-summary, or gemini-url-context
- For API testing without a real browser -- use curl or httpx directly
- For building UI components -- use the daisyui or ui-ux-pro-max-skill skills instead

## Quick Decision

**What do you need?**

| Need | Best Tool | Invoke |
|------|-----------|--------|
| Desktop Chrome with login state, GIF recording, CAPTCHA handling | **Claude in Chrome** (official) | `claude --chrome` or `/chrome` |
| Fill a form, click buttons, scrape data (headless) | **agent-browser** | `agent-browser open <url>` |
| Screenshot, visual test, full Playwright API | **Playwright** | MCP `playwright` tools |
| QE-grade: typed assertions, visual-diff baselines, prompt-injection scan, semantic element finder | **qe-browser** (AQE fleet) | `aqe init` to install; see `qe-browser` skill |
| Inspect a live Chromium session, logged-in pages | **Chrome CDP** | `scripts/cdp.mjs list` |
| Access host web server from Docker | **host-webserver-debug** | MCP `host-webserver-debug` tools |
| Read page content without interaction | **WebFetch** or `curl` | Direct tool call |

**Desktop users**: If running Claude Code on a machine with Chrome installed, prefer `claude --chrome` — it shares your login state and handles CAPTCHAs.

**Container users**: Start with **agent-browser** for headless tasks. Use Playwright for visual testing on VNC Display :1.

---

## Claude in Chrome (Official Beta)

Anthropic's native Chrome integration, available since Claude Code 2.0.73. Unlike our container-based tools, it connects directly to a desktop Chrome browser via the Claude in Chrome extension.

**Key advantages over container tools:**
- Shares your browser's login state (Google Docs, Gmail, Notion, CRMs — no auth setup)
- Visible real-time browser window (not headless)
- Pauses for human intervention on CAPTCHAs and login pages
- Built-in GIF recording of browser interactions
- Chained browser + coding workflows in a single session

**Requirements:** Chrome or Edge, Claude in Chrome extension v1.0.36+, direct Anthropic plan (not available via Bedrock/Vertex).

**Usage:**
```bash
claude --chrome              # Start with Chrome
/chrome                      # Enable mid-session
/chrome                      # Check status, reconnect, manage permissions
```

**Container note:** This integration requires a desktop Chrome install. In our Docker container, use Playwright (VNC Display :1) or agent-browser (headless) instead. If the host machine has Chrome, the integration works via SSH-forwarded Claude Code sessions.

---

## Environment

This container has two browser execution modes:

### Headless Mode (Default)
- No display required
- All tools work: agent-browser, Playwright (headless), Chrome CDP (headless)
- Fastest execution, lowest resource usage
- Use for: scraping, form automation, API testing, data extraction

### VNC Display :1 (Visual Desktop)
- Full desktop visible via VNC on port 5901 (password: `agentbox`)
- Chromium renders visually -- you can see what the browser is doing
- Use for: visual regression testing, debugging CSS layouts, interactive debugging, screenshots of rendered state
- Connect: `vncviewer localhost:5901`

```bash
# Launch browser on VNC display
DISPLAY=:1 chromium --no-sandbox https://example.com &

# Launch headless
chromium --headless --no-sandbox --disable-gpu about:blank &
```

---

## Tool Details

### 1. agent-browser (Vercel)

**Best for**: Quick interactions, form filling, scraping, AI-friendly page understanding.

**Strengths**:
- AI-optimised accessibility snapshots (93% smaller than full DOM)
- Element refs (@e1, @e2) for reliable interaction
- Multi-session support for parallel work
- CDP connect mode for attaching to existing browsers
- Smallest context footprint of all tools

**Limitations**:
- No visual rendering pipeline (headless only by default)
- No screenshot comparison / visual regression
- No full Playwright API (no network interception, no tracing)

```bash
# Basic workflow
agent-browser open https://example.com
agent-browser snapshot -i          # interactive elements only
agent-browser fill @e2 "text"
agent-browser click @e3
agent-browser snapshot -i          # re-check after action

# Connect to existing CDP session
agent-browser connect 9222
agent-browser snapshot -i

# Isolated sessions for parallel agents
agent-browser --session agent1 open https://site-a.com
agent-browser --session agent2 open https://site-b.com
```

**MCP tools**: `browser/open`, `browser/snapshot`, `browser/click`, `browser/fill`, `browser/screenshot`, `browser/close`

---

### 2. Playwright

**Best for**: Visual testing, full browser control, complex multi-page flows, Display :1 rendering.

**Strengths**:
- Full Playwright API (network interception, tracing, HAR recording)
- Visual rendering on Display :1 (VNC accessible)
- Screenshot + full-page PDF capture
- CSS selector + XPath + text selectors
- Wait strategies (networkidle, domcontentloaded, selector)
- MCP server with structured tool interface

**Limitations**:
- Heavier than agent-browser (larger context per operation)
- Launches fresh browser instance (no live session reuse)
- Requires Display :1 for visual mode

```bash
# Add MCP server (if not already configured)
claude mcp add playwright -- node /home/devuser/.claude/skills/playwright/mcp-server/server.js
```

```javascript
// MCP tool usage
await navigate({ url: "https://example.com" })
await screenshot({ filename: "page.png", fullPage: true })
await click({ selector: "#submit" })
await type({ selector: "#email", text: "user@example.com" })
await wait_for_selector({ selector: ".loaded" })
await evaluate({ script: "document.querySelectorAll('.item').length" })
```

**Environment**:
| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X display for visual mode |
| `PLAYWRIGHT_HEADLESS` | `false` | Set `true` for headless |
| `CHROMIUM_PATH` | `/usr/bin/chromium` | Browser path |

---

### 3. Chrome CDP (Live Session)

**Best for**: Inspecting running Chromium, debugging live pages, logged-in session access, raw CDP commands.

**Strengths**:
- Connects to already-running Chromium (tabs you have open)
- Persistent per-tab daemons (no reconnection overhead)
- Handles 100+ tabs reliably
- Raw CDP command passthrough
- Works in both headless and visual modes
- No Puppeteer dependency, Node.js 22+ only

**Limitations**:
- Requires Chromium to be running with remote debugging enabled
- No built-in element refs like agent-browser
- Manual target selection via ID prefixes

```bash
# Start Chromium with CDP enabled
chromium --remote-debugging-port=9222 --no-sandbox --headless &
# Or on VNC: DISPLAY=:1 chromium --remote-debugging-port=9222 --no-sandbox &

# Use CDP
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs list
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs snap <target>
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs eval <target> "document.title"
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs click <target> "#button"
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs shot <target>
```

---

### 4. qe-browser (AQE Fleet — v3.9.9+)

**Best for**: QE-grade assertion validation, visual regression baselines, injection scanning during debugging or CI. Part of the Agentic QE fleet.

**Strengths**:
- **10MB Vibium binary** (WebDriver BiDi, W3C standard) vs 300MB Playwright install
- **16 typed assertion kinds**: `url_contains`, `selector_visible`, `no_console_errors`, `no_failed_requests`, `visual_match`, `text_equals`, `attribute_equals`, and more
- **Batch pre-validation**: steps validated before any are executed — catches config errors early
- **Pixel-perfect visual diff** against baselines stored in `.aqe/visual-baselines/`
- **14-pattern prompt-injection scanner** — useful when testing AI-facing UIs
- **15-intent semantic element finder**: `submit_form`, `accept_cookies`, `fill_email`, `primary_cta`, `navigation_link` — finds elements by intent rather than brittle selectors
- **Honest missing-engine contract**: if Vibium isn't on PATH, exits with code 2 + structured JSON envelope (`vibiumUnavailable: true`) — CI tooling never has to grep error strings

**Limitations**:
- Requires `aqe init` to install Vibium on first use (1-3 min, downloads Chrome for Testing)
- Linux ARM64: auto-install falls back to x86_64 under Rosetta; use native `chromium` + symlink workaround
- Not a drop-in Playwright replacement — see `qe-browser` migration guide for 25-API mapping

**Install**:
```bash
aqe init           # installs Vibium + adds qe-browser to .claude/skills/
# or directly:
npm install -g vibium
```

**Usage**:
```bash
# Single assertion
node .claude/skills/qe-browser/scripts/assert.js --checks '[
  {"kind": "url_contains", "text": "/dashboard"},
  {"kind": "selector_visible", "selector": "[data-testid=user-menu]"},
  {"kind": "no_console_errors"}
]'

# Batch with pre-validation (preferred for debugging)
node .claude/skills/qe-browser/scripts/batch.js --steps '[...]'

# Check exit codes: 0=pass, 1=fail, 2=Vibium missing
```

**Fleet note**: 11 AQE skills delegate to qe-browser internally — `a11y-ally`, `visual-testing-advanced`, `security-visual-testing`, `compatibility-testing`, `localization-testing`, and 6 others. You're already using it when those skills run.

---

### 5. host-webserver-debug

**Best for**: Accessing web servers running on the Docker host from inside the container.

**Strengths**:
- HTTPS bridge bypasses browser security restrictions
- Auto-detects Docker host gateway IP
- Solves CORS issues between container and host
- Self-signed certificate generation
- Supervisord-managed service

**Limitations**:
- Only useful for Docker host access scenarios
- Development certificates only (not for production)

```bash
# Start HTTPS bridge
node /opt/https-bridge/https-proxy.js

# Access host server via bridge
curl -sk https://localhost:3001
DISPLAY=:1 chromium --ignore-certificate-errors https://localhost:3001
```

**MCP tools**: `bridge_start`, `bridge_status`, `bridge_stop`, `screenshot`, `navigate`, `debug_cors`, `health_check`

---

## Combination Patterns

### Pattern 1: Scrape + Visual Verify

Use agent-browser for fast scraping, Playwright for visual verification.

```bash
# Fast scrape with agent-browser
agent-browser open https://example.com/products
agent-browser snapshot -i
agent-browser get text @e1  # product name
agent-browser get text @e2  # price

# Visual verify with Playwright
await navigate({ url: "https://example.com/products" })
await screenshot({ filename: "products.png", fullPage: true })
```

### Pattern 2: CDP Debug + agent-browser Automate

Use CDP to inspect live state, agent-browser to automate.

```bash
# Inspect via CDP
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs list
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs eval <target> "performance.timing.toJSON()"

# Connect agent-browser to same CDP session
agent-browser connect 9222
agent-browser snapshot -i
agent-browser click @e5
```

### Pattern 3: Host Debug + Visual Test

Use host-webserver-debug for bridge, Playwright for testing.

```bash
# Bridge to host server
node /opt/https-bridge/https-proxy.js &

# Test via Playwright on Display :1
await navigate({ url: "https://localhost:3001" })
await screenshot({ filename: "host-app.png" })
await click({ selector: "#login-btn" })
await wait_for_selector({ selector: ".dashboard" })
```

### Pattern 4: CDP Inspect + qe-browser Assert (Debug Loop)

Use Chrome CDP to explore live state, then qe-browser to lock in typed assertions once you know what to check.

```bash
# 1. Start Chromium with CDP (inspect live state)
chromium --remote-debugging-port=9222 --no-sandbox --headless &

# 2. Use CDP to explore — find selectors, check network, read DOM
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs list
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs eval <target> "document.querySelector('[data-testid]')?.textContent"
/home/devuser/.claude/skills/chrome-cdp/scripts/cdp.mjs shot <target>  # screenshot what you see

# 3. Once you know what to assert, run qe-browser batch with pre-validated checks
node .claude/skills/qe-browser/scripts/batch.js --steps '[
  {"action": "go", "url": "https://app.example.com"},
  {"action": "wait_url", "pattern": "/dashboard"},
  {"action": "assert", "checks": [
    {"kind": "selector_visible", "selector": "[data-testid=user-menu]"},
    {"kind": "no_console_errors"},
    {"kind": "no_failed_requests"},
    {"kind": "visual_match", "baseline": ".aqe/visual-baselines/dashboard.png"}
  ]}
]'

# 4. On assertion failure: exit code 1 = test failed; exit code 2 = engine missing
# vibiumUnavailable:true in envelope → run `aqe init` to install Vibium
```

**When to use this pattern**: Actively debugging a regression where you know the page works visually (CDP confirms) but need reproducible typed proof. CDP for exploration, qe-browser for confirmation.

---

### Pattern 5: Parallel Multi-Agent Browser Work

Spawn multiple agents with isolated sessions for parallel scraping.

```bash
# Agent 1: scrape site A
agent-browser --session scraper1 open https://site-a.com
agent-browser --session scraper1 snapshot -i

# Agent 2: scrape site B (parallel)
agent-browser --session scraper2 open https://site-b.com
agent-browser --session scraper2 snapshot -i

# Agent 3: visual regression on Display :1 (parallel)
# Uses Playwright MCP tools
```

---

## Decision Tree

```
START: What browser task?
│
├─ "Read page content, no interaction"
│  └─ Use WebFetch or curl (no browser needed)
│
├─ "Fill forms, click buttons, scrape data"
│  ├─ Need visual rendering? → Playwright (Display :1)
│  └─ Headless OK? → agent-browser (fastest)
│
├─ "Take screenshots, visual testing"
│  ├─ Compare screenshots? → Playwright (full API)
│  └─ Quick screenshot? → agent-browser screenshot or CDP shot
│
├─ "Debug a live running page"
│  ├─ Page is on host machine? → host-webserver-debug + Playwright
│  ├─ Page in container Chromium? → Chrome CDP
│  ├─ Need to see it visually? → VNC Display :1 + Chrome CDP
│  └─ Need typed pass/fail assertions + visual diff while debugging?
│     → qe-browser (Vibium: 16 assertion kinds, batch pre-validation, baseline diffs)
│       NOTE: part of AQE fleet — run `aqe init` once to install Vibium engine
│       Use alongside Chrome CDP (inspect) + qe-browser (assert) for full debug loop
│
├─ "Execute JavaScript in page"
│  ├─ One-off eval? → Chrome CDP eval or agent-browser eval
│  └─ Complex JS with DOM manipulation? → Playwright evaluate
│
├─ "Network inspection, HAR, tracing"
│  └─ Playwright (only tool with full network API)
│
├─ "Interact with logged-in session"
│  └─ Chrome CDP (connects to existing tabs with cookies)
│
├─ "Multi-page parallel scraping"
│  └─ agent-browser with --session (isolated contexts)
│
└─ "Complex: multiple needs above"
   └─ Combine tools (see Combination Patterns above)
```

## Tool Availability Check

```bash
# Verify all tools are available
agent-browser --version          # Should show 0.21.2+
chromium --version               # Should show 146+
playwright --version             # Should show 1.57+
node --version                   # Should show 22+ (for CDP)
curl -s http://localhost:9222/json/version  # CDP if Chromium running
```

## Tips

1. **Start with agent-browser** unless you know you need something else -- smallest context, fastest
2. **Use Display :1 for debugging** -- seeing the browser helps diagnose layout issues
3. **CDP is for live sessions** -- if you need to inspect what the user is looking at, use CDP
4. **Playwright for testing** -- its wait strategies and screenshot comparison are unmatched
5. **Sessions are isolated** -- agent-browser sessions and Playwright contexts do not share cookies
6. **VNC password** is `agentbox` on port 5901
7. **Combine freely** -- these tools can coexist. Run CDP on port 9222 while agent-browser uses its own Chromium instance
8. **qe-browser for debugging assertions** -- once CDP shows you the page state, use qe-browser batch to codify reproducible typed checks; exit code 2 means Vibium missing (`aqe init` fixes it)
8. **For swarm agents**: spawn each with their own `--session` to avoid collision
