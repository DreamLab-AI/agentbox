---
name: playwright
description: >
  Browser automation, web scraping, visual testing, and WebGPU validation with the official
  @playwright/mcp server (61 tools) on Display :1. Use for navigating pages, clicking elements,
  filling forms, taking screenshots, executing JavaScript, network mocking, storage management,
  video recording, tracing, coordinate-based vision interactions, test assertions, and PDF
  generation. Visual access via VNC on port 5901. WebGPU-capable Chromium 147+.
---

# Playwright Skill

Browser automation via the official `@playwright/mcp` server (Microsoft, v0.0.70) with 61 tools.
Renders on i3/Xvnc Display :1 (1920x1080, VNC port 5901). Chromium 147 with WebGPU support.

## When Not To Use

- For lightweight browser automation with AI-optimised snapshots -- use the `browser` skill (smaller context, faster)
- For summarising web page content without interaction -- use `web-summary` or `gemini-url-context`
- For debugging host web servers from inside Docker -- use `host-webserver-debug`
- For API testing without a real browser -- use `curl` or `httpx`
- For QE-grade typed assertions and visual-diff baselines -- use `qe-browser`

## Installation

```bash
claude mcp add playwright -- playwright-mcp --no-sandbox --caps vision,pdf,devtools,testing,network,storage
```

The `playwright-mcp` binary is available at `/nix/store/.../bin/playwright-mcp` (Nix-managed).
Chromium 147 is at the Nix store path and auto-detected.

### Quick Verification

```bash
DISPLAY=:1 chromium --no-sandbox --enable-features=Vulkan,WebGPU --enable-unsafe-webgpu https://example.com &
```

## Architecture

```
Claude Code (MCP Client)
  |  MCP Protocol (stdio)
  v
@playwright/mcp server (official, 61 tools)
  |  Playwright 1.60 API
  v
Chromium 147 (WebGPU, Vulkan)
  |  X11
  v
i3 WM on Xvnc :1 (1920x1080, port 5901)
```

## Tool Categories (61 tools)

| Category | Tools | Description |
|----------|-------|-------------|
| **Core** | `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_file_upload`, `browser_handle_dialog`, `browser_snapshot`, `browser_take_screenshot`, `browser_evaluate`, `browser_run_code`, `browser_wait_for`, `browser_close`, `browser_resize`, `browser_navigate_back`, `browser_console_messages`, `browser_network_requests` | Page navigation, interaction, screenshots, JS eval, accessibility snapshots |
| **Tabs** | `browser_tabs` | List, create, close, select tabs |
| **Vision** | `browser_mouse_move_xy`, `browser_mouse_click_xy`, `browser_mouse_drag_xy`, `browser_mouse_down`, `browser_mouse_up`, `browser_mouse_wheel` | Coordinate-based interactions (opt-in `--caps vision`) |
| **DevTools** | `browser_resume`, `browser_start_tracing`, `browser_stop_tracing`, `browser_start_video`, `browser_stop_video`, `browser_video_chapter` | Debug stepping, tracing, video recording (opt-in `--caps devtools`) |
| **Testing** | `browser_verify_element_visible`, `browser_verify_text_visible`, `browser_verify_list_visible`, `browser_verify_value`, `browser_generate_locator` | Assertion tools for test automation (opt-in `--caps testing`) |
| **Network** | `browser_route`, `browser_route_list`, `browser_unroute`, `browser_network_state_set` | Mock network requests, offline simulation (opt-in `--caps network`) |
| **Storage** | `browser_cookie_*` (5), `browser_localstorage_*` (5), `browser_sessionstorage_*` (5), `browser_storage_state`, `browser_set_storage_state` | Full cookie/localStorage/sessionStorage CRUD (opt-in `--caps storage`) |
| **PDF** | `browser_pdf_save` | Save page as PDF (opt-in `--caps pdf`) |
| **Config** | `browser_get_config` | Read resolved config (opt-in `--caps config`) |

## Key Tools

### `browser_snapshot` (preferred over screenshots for LLM interaction)
Returns an accessibility tree of the page -- structured, deterministic, no vision model needed.

### `browser_run_code`
Execute arbitrary Playwright code:
```javascript
browser_run_code({ code: "async (page) => { await page.goto('https://example.com'); return await page.title(); }" })
```

### `browser_take_screenshot`
Capture viewport or full-page screenshot as PNG/JPEG. Returned as image content.

## WebGPU Support

Chromium 147 ships with WebGPU. Launch flags for GPU acceleration:
```bash
DISPLAY=:1 chromium --no-sandbox --enable-features=Vulkan,WebGPU --enable-unsafe-webgpu
```

The `@playwright/mcp` server auto-launches Chromium; add launch args via config:
```json
{
  "browser": {
    "launchOptions": {
      "args": ["--no-sandbox", "--enable-features=Vulkan,WebGPU", "--enable-unsafe-webgpu"]
    }
  }
}
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X display for browser |
| `PLAYWRIGHT_MCP_HEADLESS` | unset (headed) | Set to run headless |
| `PLAYWRIGHT_MCP_VIEWPORT_SIZE` | `1920x1080` | Browser viewport |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | `/tmp/playwright-screenshots` | Screenshot/trace output |
| `PLAYWRIGHT_MCP_NO_SANDBOX` | set | Required in container |
| `PLAYWRIGHT_MCP_CAPS` | `vision,pdf,devtools,testing,network,storage` | Enabled capability sets |

## Visual Access

```bash
vncviewer localhost:5901   # password: agentbox
```

## Migration from Custom Server

The previous custom `mcp-server/server.js` (10 tools) is superseded by the official server (61 tools).

| Old tool | New equivalent |
|----------|---------------|
| `navigate` | `browser_navigate` |
| `screenshot` | `browser_take_screenshot` |
| `click` | `browser_click` |
| `type` | `browser_type` |
| `evaluate` | `browser_evaluate` |
| `wait_for_selector` | `browser_wait_for` |
| `get_content` | `browser_snapshot` (better: structured accessibility tree) |
| `get_url` | `browser_snapshot` includes URL |
| `close_browser` | `browser_close` |
| `health_check` | `browser_get_config` |

New capabilities not in the old server: video recording, tracing, network mocking, storage CRUD, coordinate-based vision, test assertions, tab management, PDF generation, form filling, drag-and-drop, code execution.
