# Chrome DevTools Skill

Official Chrome DevTools MCP server integration for AI-assisted web debugging.

## Quick Start

### From Claude Code

```
Use Chrome DevTools to check console errors on http://localhost:3001
```

```
Use Chrome DevTools to record a performance trace of VisionFlow
```

```
Take a screenshot of the VisionFlow homepage
```

## Installation

The skill is automatically installed when building the agentic-workstation container.

### Manual Installation

```bash
# Inside agentic-workstation
npm install -g chrome-devtools-mcp

# Or use via NPX (recommended)
npx -y chrome-devtools-mcp@latest
```

## Prerequisites

✅ Already installed in agentic-workstation:
- Chromium browser (`/usr/bin/chromium`)
- Node.js and NPM
- X11 display via VNC (DISPLAY=:1)
- NPX for package execution

## Usage Examples

### Debug VisionFlow Application

```
Use Chrome DevTools to:
1. Navigate to http://localhost:3001
2. Get all console errors
3. Show network requests
4. Report any issues found
```

### Performance Analysis

```
Use Chrome DevTools to:
1. Start performance trace
2. Navigate to VisionFlow
3. Wait 10 seconds
4. Stop trace and analyze results
```

### DOM Inspection

```
Use Chrome DevTools to:
1. Query for all canvas elements
2. Get their computed styles
3. Verify WebXR initialization
```

### Network Debugging

```
Use Chrome DevTools to:
1. Load VisionFlow
2. Get all network requests
3. Filter for failed requests
4. Show CORS errors
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `performance_start_trace` | Record performance metrics |
| `network_get_requests` | Inspect network traffic |
| `console_get_messages` | View console logs/errors |
| `dom_query_selector` | Query DOM elements |
| `dom_get_computed_style` | Get CSS styles |
| `runtime_evaluate` | Execute JavaScript |
| `page_screenshot` | Capture page screenshots |
| `coverage_start/stop` | Analyze code coverage |

## Configuration

### MCP Server Config

Location: `/home/devuser/.config/claude/mcp-config.json`

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "env": {
        "CHROME_PATH": "/usr/bin/chromium",
        "DISPLAY": ":1"
      }
    }
  }
}
```

### Environment Variables

```bash
# Chrome binary location
export CHROME_PATH=/usr/bin/chromium

# X11 display (via VNC)
export DISPLAY=:1

# User data directory
export CHROME_USER_DATA_DIR=/tmp/chrome-devtools-mcp

# Chrome flags (optional)
export CHROME_FLAGS="--headless,--disable-gpu,--no-sandbox"
```

## Integration with VisionFlow

### Development Workflow

1. **Edit Code** - Make changes to VisionFlow source
2. **Rebuild** - `visionflow_ctl.sh restart --rebuild`
3. **Debug** - Use Chrome DevTools to verify changes
4. **Iterate** - Fix issues and repeat

### Common Tasks

**Check Console Errors**
```
Use Chrome DevTools to show console errors from VisionFlow
```

**Analyze Performance**
```
Use Chrome DevTools to record a 10-second performance trace of VisionFlow
```

**Inspect Network Requests**
```
Use Chrome DevTools to analyze network requests on VisionFlow and check for failures
```

**Take Screenshot**
```
Take a full-page screenshot of VisionFlow homepage
```

## Troubleshooting

### Chrome Won't Launch

```bash
# Check Chromium is installed
which chromium
chromium --version

# Test manual launch
chromium --headless --remote-debugging-port=9222 --disable-gpu

# Check X11 display
echo $DISPLAY
DISPLAY=:1 xdpyinfo
```

### Connection Failed

```bash
# Check if Chrome is running
ps aux | grep chromium

# Check remote debugging port
netstat -tlnp | grep 9222

# Kill orphaned processes
pkill -f chromium
pkill -f chrome-devtools-mcp
```

### Display Issues

```bash
# Verify VNC is running
sudo supervisorctl status xvnc

# Test X11 connection
DISPLAY=:1 xterm

# Grant X11 access
xhost +local:
```

### NPX Package Not Found

```bash
# Update npm
npm install -g npm@latest

# Clear NPX cache
rm -rf ~/.npm/_npx

# Test NPX
npx -y chrome-devtools-mcp@latest --version
```

## Performance Tips

1. **Use Headless Mode** - Faster, lower memory
2. **Limit Trace Duration** - 5-10 seconds max for responsiveness
3. **Close Unused Sessions** - Each Chrome instance uses ~150MB RAM
4. **Disable Unnecessary Features** - Use `--disable-gpu`, `--no-sandbox`

## Security Considerations

- Chrome launched with `--disable-web-security` for local dev
- Remote debugging port (9222) only accessible within container
- No external network access
- User data cleared between sessions

## Testing

### Test Chrome Launch

```bash
# Manual test
DISPLAY=:1 chromium --headless --disable-gpu --remote-debugging-port=9222 &

# Check if running
curl http://localhost:9222/json
```

### Test MCP Server

```bash
# Start server manually
CHROME_PATH=/usr/bin/chromium DISPLAY=:1 npx -y chrome-devtools-mcp@latest

# Should start without errors
```

### Test from Claude Code

```
Use Chrome DevTools to navigate to https://example.com and take a screenshot
```

## Resources

- **GitHub**: https://github.com/ChromeDevTools/chrome-devtools-mcp
- **Chrome DevTools Protocol**: https://chromedevtools.github.io/devtools-protocol/
- **Blog Post**: https://developer.chrome.com/blog/chrome-devtools-mcp
- **Issue Tracker**: https://github.com/ChromeDevTools/chrome-devtools-mcp/issues

## Integration with Other Skills

| Skill | Use Case |
|-------|----------|
| **Docker Manager** | Restart VisionFlow before debugging |
| **Playwright** | Compare Chrome vs Firefox behavior |
| **Web Summary** | Document debugging findings |
| **Git** | Commit fixes discovered via debugging |

## Advanced Usage

### Custom Chrome Flags

Edit `config/mcp-config.json`:

```json
{
  "env": {
    "CHROME_FLAGS": "--headless,--disable-gpu,--window-size=1920,1080"
  }
}
```

### Remote Debugging

Connect to existing Chrome instance:

```bash
# Launch Chrome with debugging
chromium --remote-debugging-port=9222 &

# Configure MCP to connect
export CHROME_REMOTE_DEBUGGING_PORT=9222
```

### Mobile Emulation

```javascript
// Execute in page context
Use Chrome DevTools to evaluate:
const emulation = {
  width: 375,
  height: 667,
  deviceScaleFactor: 2,
  mobile: true
};
```

## License

Chrome DevTools MCP server is provided by Google under Apache 2.0 license.
