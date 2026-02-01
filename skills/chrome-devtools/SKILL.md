---
name: Chrome DevTools
description: Debug web pages directly in Chrome using DevTools capabilities via MCP
---

# Chrome DevTools Skill

This skill provides direct access to Chrome DevTools debugging capabilities through the official Chrome DevTools MCP server, enabling AI-assisted debugging, performance analysis, and web development workflows.

## Capabilities

- **Performance Tracing**: Record and analyze performance traces
- **Network Analysis**: Inspect network requests, identify CORS issues
- **Console Inspection**: Access console logs and errors
- **DOM/CSS Inspection**: Examine and modify page structure and styles
- **User Behavior Simulation**: Simulate user interactions
- **Real-time Code Verification**: Test code changes in live browser context
- **Screenshot Capture**: Take screenshots of web pages
- **Coverage Analysis**: Analyze CSS/JS code coverage

## When to Use This Skill

Use this skill when you need to:
- Debug JavaScript errors in the browser console
- Analyze performance bottlenecks in web applications
- Inspect network requests and responses
- Diagnose CORS and security issues
- Verify DOM structure and CSS rendering
- Simulate user interactions for testing
- Capture visual regression screenshots
- Analyze resource loading and caching

## Architecture

```
┌─────────────────────────────────────┐
│   agentic-workstation container     │
│  (Claude Code + Chrome DevTools)    │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ chrome-devtools-mcp (NPX)    │  │
│  │         ↓                    │  │
│  │    Chrome/Chromium           │  │
│  │    (headless mode)           │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
           │
           ├─→ VisionFlow UI (localhost:3001)
           ├─→ External URLs
           └─→ Local HTML files
```

## Tool Functions

### `performance_start_trace`
Start recording a performance trace.

Parameters:
- `url` (optional): URL to navigate to before tracing
- `duration_ms` (optional): How long to record (default: 5000ms)

Example:
```
Use Chrome DevTools to record a performance trace of http://localhost:3001
```

### `network_get_requests`
Get all network requests for the current page.

Returns:
- Request URLs, methods, status codes
- Response headers
- Timing information
- CORS errors

Example:
```
Use Chrome DevTools to analyze network requests on VisionFlow
```

### `console_get_messages`
Retrieve console messages (logs, errors, warnings).

Parameters:
- `level` (optional): Filter by level (log, warn, error, info)
- `limit` (optional): Maximum messages to return

Example:
```
Show console errors from VisionFlow application
```

### `dom_query_selector`
Query DOM elements using CSS selectors.

Parameters:
- `selector` (required): CSS selector string
- `all` (optional): Return all matching elements (default: false)

Example:
```
Use Chrome DevTools to find all buttons with class "submit-btn"
```

### `dom_get_computed_style`
Get computed CSS styles for an element.

Parameters:
- `selector` (required): CSS selector for element

Example:
```
Get computed styles for the header navigation
```

### `runtime_evaluate`
Execute JavaScript in the page context.

Parameters:
- `expression` (required): JavaScript code to execute
- `return_by_value` (optional): Return result value (default: true)

Example:
```
Use Chrome DevTools to execute: document.title
```

### `page_screenshot`
Capture screenshot of the current page.

Parameters:
- `format` (optional): png | jpeg (default: png)
- `quality` (optional): JPEG quality 0-100 (default: 80)
- `full_page` (optional): Capture full scrollable page (default: false)

Example:
```
Take a full-page screenshot of VisionFlow
```

### `coverage_start`
Start CSS/JS coverage analysis.

Parameters:
- `reset_on_navigation` (optional): Reset coverage on navigation

Example:
```
Start coverage analysis for VisionFlow
```

### `coverage_stop`
Stop coverage analysis and get results.

Returns:
- Used vs total bytes for CSS/JS
- Unused code ranges
- Coverage percentage

Example:
```
Stop coverage analysis and show unused CSS
```

## Usage Examples

### Example 1: Debug VisionFlow Performance

```
Use Chrome DevTools to:
1. Navigate to http://localhost:3001
2. Start a performance trace for 10 seconds
3. Show the performance summary
4. Identify any slow operations
```

### Example 2: Diagnose Network Issues

```
Use Chrome DevTools to:
1. Load VisionFlow application
2. Get all network requests
3. Check for failed requests or CORS errors
4. Show request timing breakdown
```

### Example 3: Inspect Console Errors

```
Use Chrome DevTools to:
1. Navigate to VisionFlow
2. Get all console errors
3. Show error messages and stack traces
```

### Example 4: Verify DOM Structure

```
Use Chrome DevTools to:
1. Query for all <canvas> elements
2. Get their computed styles
3. Verify WebXR initialization
```

### Example 5: Analyze Code Coverage

```
Use Chrome DevTools to:
1. Start coverage analysis
2. Navigate through VisionFlow UI
3. Stop coverage
4. Report unused CSS/JS code
```

## Integration with VisionFlow Development

### Development Workflow

1. **Code Changes**: Edit VisionFlow source code
2. **Rebuild**: Use Docker Manager to restart VisionFlow
3. **Debug**: Use Chrome DevTools to verify changes
4. **Iterate**: Fix issues and repeat

### Common Debug Scenarios

**Scenario 1: WebXR Not Initializing**
```
Use Chrome DevTools to:
- Check console for WebXR errors
- Verify canvas element exists
- Test WebXR API availability: navigator.xr
```

**Scenario 2: Slow Page Load**
```
Use Chrome DevTools to:
- Record performance trace
- Identify render-blocking resources
- Check bundle size in network tab
```

**Scenario 3: API Request Failures**
```
Use Chrome DevTools to:
- Get network requests
- Filter for failed requests (status >= 400)
- Show request/response headers
```

## Configuration

### MCP Client Config

The skill uses `chrome-devtools-mcp@latest` via NPX. Configuration is automatically set up in the container.

Location: `/home/devuser/.config/claude/mcp-config.json`

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"],
      "env": {
        "CHROME_PATH": "/usr/bin/chromium",
        "DISPLAY": ":1"
      }
    }
  }
}
```

### Environment Variables

- `CHROME_PATH`: Path to Chromium binary (default: `/usr/bin/chromium`)
- `DISPLAY`: X11 display for headless mode (default: `:1` via VNC)
- `CHROME_FLAGS`: Additional Chrome flags (e.g., `--disable-gpu`)

## Technical Details

### Chrome Launch Options

The skill launches Chrome in headless mode with:
- Remote debugging enabled (port 9222)
- Security features disabled for local development
- User data directory: `/tmp/chrome-devtools-mcp`

### Browser Context

Each debugging session creates an isolated browser context with:
- Separate cookies and storage
- Independent cache
- Isolated JavaScript execution

### Cleanup

Browser instances are automatically cleaned up when:
- MCP server disconnects
- Session timeout (30 minutes)
- Explicit close request

## Troubleshooting

### Chrome Won't Launch

```bash
# Check Chromium installation
which chromium
chromium --version

# Test manual launch
chromium --headless --remote-debugging-port=9222

# Check DISPLAY variable
echo $DISPLAY
xdpyinfo -display :1
```

### DevTools Connection Failed

```bash
# Check if Chrome is running
ps aux | grep chromium

# Check remote debugging port
netstat -tlnp | grep 9222

# Restart MCP server
pkill -f chrome-devtools-mcp
```

### X11 Display Issues

```bash
# Verify VNC is running
sudo supervisorctl status xvnc

# Test X11 connection
DISPLAY=:1 xterm

# Check permissions
xhost +local:
```

### Performance Trace Timeout

If traces timeout:
- Reduce trace duration
- Disable unnecessary Chrome extensions
- Check CPU/memory availability

## Performance Considerations

- **Headless Mode**: Faster, lower resource usage
- **Trace Duration**: Limit to 5-10 seconds for responsiveness
- **Concurrent Sessions**: Limit to 2-3 simultaneous browser contexts
- **Memory**: Each Chrome instance uses ~100-200MB RAM

## Security Notes

- Chrome launched with `--disable-web-security` for local development
- Remote debugging port only accessible within container
- No external network access required
- Browser data cleared between sessions

## Integration with Other Skills

Works well with:
- **Docker Manager** - Restart VisionFlow before debugging
- **Playwright** - Cross-browser testing comparison
- **Web Summary** - Document debugging findings
- **Git** - Commit fixes discovered via debugging

## Advanced Usage

### Custom Chrome Flags

```javascript
// In MCP config
{
  "chrome-devtools": {
    "command": "npx",
    "args": ["chrome-devtools-mcp@latest"],
    "env": {
      "CHROME_FLAGS": "--disable-gpu,--no-sandbox,--disable-dev-shm-usage"
    }
  }
}
```

### Multiple Browser Profiles

```javascript
// Use different user data directories
{
  "env": {
    "CHROME_USER_DATA_DIR": "/tmp/chrome-profile-1"
  }
}
```

### Remote Debugging

```javascript
// Connect to existing Chrome instance
{
  "env": {
    "CHROME_REMOTE_DEBUGGING_PORT": "9222"
  }
}
```

## Resources

- **GitHub Repository**: https://github.com/ChromeDevTools/chrome-devtools-mcp
- **Chrome DevTools Protocol**: https://chromedevtools.github.io/devtools-protocol/
- **MCP Specification**: https://modelcontextprotocol.io/
- **Issue Tracker**: https://github.com/ChromeDevTools/chrome-devtools-mcp/issues

## Future Enhancements

- [ ] Mobile device emulation
- [ ] Lighthouse performance audits
- [ ] Accessibility testing (aXe integration)
- [ ] Visual regression testing
- [ ] HAR file export for network analysis
- [ ] Code snippet execution from files
- [ ] Custom DevTools extensions
