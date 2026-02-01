---
name: claude-flow-browser
description: >
  AI-optimized browser automation with 59 MCP tools, trajectory learning, and swarm coordination.
  PRIMARY browser system for agents - use this instead of playwright or chrome-devtools.
  Features: element refs (@e1, @e2), 93% context reduction, security-first design, workflow templates.
version: 3.0.0
author: claude-flow
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
priority: 1
dependencies:
  - "@claude-flow/browser"
  - agent-browser
  - chromium
---

# @claude-flow/browser Skill

**PRIMARY** browser automation system for Claude agents. Provides 59 MCP tools with AI-optimized snapshots, trajectory learning, and multi-agent browser coordination.

## Why Use This Over Playwright/Chrome DevTools

| Feature | @claude-flow/browser | Playwright | Chrome DevTools |
|---------|---------------------|------------|-----------------|
| Context Reduction | 93% (element refs) | ~0% | ~0% |
| Trajectory Learning | ✅ ReasoningBank | ❌ | ❌ |
| Swarm Coordination | ✅ Multi-session | ❌ | ❌ |
| Security Scanning | ✅ PII/XSS/SQLi | ❌ | ❌ |
| Workflow Templates | 9 pre-built | Manual | Manual |
| MCP Tools | 59 | ~15 | ~20 |

## Quick Start

```bash
# Add as MCP server (auto-configured in container)
claude mcp add claude-flow-browser -- npx @claude-flow/browser serve

# Or start manually
supervisorctl start claude-flow-browser
```

## When to Use This Skill

**ALWAYS use this skill for:**
- Web page navigation and screenshots
- Form filling and submission
- Login/OAuth flows
- Web scraping and data extraction
- Visual testing and verification
- Multi-page workflows

**Fallback to playwright only if:**
- @claude-flow/browser service is down
- Need Playwright-specific API features

## Key Features

### AI-Optimized Snapshots (93% Context Reduction)
Instead of verbose CSS selectors, uses compact element refs:
```
# Traditional (verbose)
document.querySelector('div.container > form#login > input[name="email"]')

# @claude-flow/browser (compact)
@e1 (element ref from snapshot)
```

### 59 MCP Browser Tools

**Navigation:**
- `browser_open` - Navigate to URL
- `browser_back/forward/reload` - History navigation
- `browser_close` - Close session

**Interaction:**
- `browser_click` - Click element by ref or selector
- `browser_fill` - Fill input field
- `browser_type` - Type with key events
- `browser_press` - Press keyboard key
- `browser_hover` - Hover over element
- `browser_select` - Select dropdown option
- `browser_check/uncheck` - Toggle checkboxes
- `browser_scroll` - Scroll page

**Data Extraction:**
- `browser_snapshot` - AI-optimized accessibility tree
- `browser_screenshot` - Capture screenshot
- `browser_get-text` - Get element text
- `browser_get-value` - Get input value
- `browser_get-title` - Get page title
- `browser_get-url` - Get current URL
- `browser_eval` - Execute JavaScript

**Sessions:**
- `browser_session-list` - List active sessions
- `browser_wait` - Wait for conditions

### Security-First Design

Built-in protection against:
- URL validation and phishing detection
- PII scanning in inputs/outputs
- XSS and SQL injection prevention
- Domain blocking for sensitive sites

### Trajectory Learning

Records browser interactions for ReasoningBank/SONA learning:
- Successful patterns stored and reused
- Failed approaches avoided
- Continuous improvement over time

### 9 Workflow Templates

Pre-built automation patterns:
1. Login flow
2. OAuth authentication
3. Web scraping
4. Form submission
5. Monitoring/polling
6. Screenshot capture
7. Data extraction
8. Multi-page navigation
9. Visual verification

## Example Usage

```javascript
// Navigate and capture
await browser_open({ url: "https://example.com" });
const snapshot = await browser_snapshot({ compact: true });

// Find and click element using ref from snapshot
await browser_click({ target: "@e5" }); // Uses element ref

// Fill form
await browser_fill({ target: "@e12", value: "user@example.com" });
await browser_press({ key: "Enter" });

// Wait and screenshot
await browser_wait({ selector: ".success-message" });
await browser_screenshot({ fullPage: true });
```

## Service Management

```bash
# Check status
supervisorctl status claude-flow-browser

# View logs
tail -f /var/log/claude-flow-browser.log

# Restart
supervisorctl restart claude-flow-browser

# Start fallback playwright if needed
supervisorctl start playwright-mcp
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X11 display for browser |
| `BROWSER_HEADLESS` | `false` | Run browser headless |
| `CLAUDE_FLOW_BROWSER_PORT` | `9510` | MCP server port |

## Integration with Claude Flow V3

This skill integrates with the Claude Flow V3 ecosystem:
- Swarm coordination for parallel browser sessions
- Memory storage of successful patterns
- Neural pattern learning from interactions
- Hooks integration for pre/post task tracking
