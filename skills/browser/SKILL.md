---
name: browser
description: >
  AI-optimized web browser automation using agent-browser (Vercel Labs).
  Features element refs (@e1, @e2) for 93% context reduction, CDP connection
  to visible Chrome, and efficient DOM snapshots. RECOMMENDED for agentic work.
version: 1.0.0
author: agentbox
priority: 1
dependencies:
  - agent-browser
  - chromium
  - playwright
---

# Browser Skill (agent-browser)

Fast, AI-optimized browser automation using [agent-browser](https://github.com/vercel-labs/agent-browser) from Vercel Labs.

## Why agent-browser

| Feature | agent-browser | Playwright | Chrome DevTools |
|---------|---------------|------------|-----------------|
| Context Reduction | 93% (element refs) | ~0% | ~0% |
| Token Efficiency | Optimized snapshots | Verbose DOM | Verbose |
| Session Persistence | Cookies/storage saved | Manual | Manual |
| CLI Integration | Native | Requires wrapper | Requires wrapper |
| Install Size | ~15MB | ~200MB | ~50MB |

## Quick Start

```bash
# Verify installation
agent-browser --version

# Basic workflow
agent-browser open "https://example.com"
agent-browser snapshot -i        # Interactive elements with @refs
agent-browser click @e1          # Click using element ref
agent-browser screenshot /tmp/page.png
agent-browser close
```

## Commands Reference

### Navigation
```bash
agent-browser open <url>         # Navigate to URL
agent-browser back               # Go back
agent-browser forward            # Go forward
agent-browser reload             # Reload page
agent-browser close              # Close browser
```

### Snapshots (AI-Optimized)
```bash
agent-browser snapshot           # Full DOM tree
agent-browser snapshot -i        # Interactive elements only (RECOMMENDED)
agent-browser snapshot --json    # JSON output for processing
```

### Interaction
```bash
agent-browser click @e1          # Click element by ref
agent-browser fill @e2 "text"    # Fill input field
agent-browser type @e3 "chars"   # Type character by character
agent-browser press Enter        # Press keyboard key
agent-browser hover @e4          # Hover over element
agent-browser select @e5 "opt"   # Select dropdown option
agent-browser check @e6          # Check checkbox
agent-browser uncheck @e7        # Uncheck checkbox
agent-browser scroll down        # Scroll page
```

### Data Extraction
```bash
agent-browser get text @e1       # Get element text
agent-browser get value @e2      # Get input value
agent-browser get-title          # Get page title
agent-browser get-url            # Get current URL
agent-browser screenshot <path>  # Capture screenshot
agent-browser pdf <path>         # Generate PDF
```

### JavaScript Execution
```bash
agent-browser eval "document.title"
agent-browser eval "Array.from(document.querySelectorAll('a')).map(a => a.href)"
```

### State Management
```bash
agent-browser cookies            # List cookies
agent-browser storage            # List localStorage
```

## Visible Browser Mode (VNC)

For agentic work that requires visual feedback, run Chrome with remote debugging:

```bash
# Start visible browser on VNC desktop
export DISPLAY=:1
chromium --no-sandbox --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.config/chromium-automation &

# Connect agent-browser via CDP
CHROME_CDP_URL=http://localhost:9222 agent-browser open "https://example.com"
```

VNC connection: `vnc://localhost:5901`

## Programmatic Usage (Node.js)

```javascript
const { chromium } = require('playwright');

(async () => {
  // Connect to visible browser via CDP
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];

  // Navigate and interact
  await page.goto('https://example.com');
  await page.click('text="Login"');
  await page.fill('#email', 'user@example.com');

  // For iframe content (like Oracle Cloud Console)
  const frames = page.frames();
  for (const frame of frames) {
    const text = await frame.textContent('body');
    if (text.includes('Target Content')) {
      await frame.click('text="Button"');
      break;
    }
  }

  await browser.close();
})();
```

## Oracle Cloud Example

This pattern was used successfully to complete Oracle Cloud API key setup:

```bash
# 1. Start visible browser
export DISPLAY=:1
chromium --no-sandbox --remote-debugging-port=9222 &

# 2. Navigate to Oracle Console
agent-browser open "https://cloud.oracle.com"

# 3. Get interactive snapshot to find elements
agent-browser snapshot -i

# 4. Click and interact using refs
agent-browser click @e5

# 5. For complex UIs with iframes, use Playwright CDP:
node -e '
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const page = browser.contexts()[0].pages()[0];

  // Search all frames for content
  for (const frame of page.frames()) {
    try {
      if (await frame.textContent("body").includes("Add API key")) {
        await frame.click("text=\"Add API key\"");
        break;
      }
    } catch (e) {}
  }
  await browser.close();
})();
'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X11 display for visible browser |
| `CHROME_CDP_URL` | - | Chrome DevTools Protocol URL |
| `BROWSER_HEADLESS` | `false` | Run headless mode |

## Troubleshooting

### Browser not visible on VNC
```bash
# Check X server
xdpyinfo -display :1

# Start browser with correct display
DISPLAY=:1 chromium --no-sandbox &
```

### Element refs not found
```bash
# Refresh snapshot
agent-browser snapshot -i

# Try CSS selector as fallback
agent-browser click "button.submit"
```

### Iframe content not accessible
Use Playwright CDP connection to iterate through frames (see Oracle Cloud example above).

## Service Management

```bash
# Start/stop visible browser
supervisorctl start chromium-visible
supervisorctl stop chromium-visible

# Check status
supervisorctl status chromium-visible
```
