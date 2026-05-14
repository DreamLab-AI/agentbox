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
Renders on Xorg + NVIDIA Display :1 (1920x1080, VNC port 5901 via x11vnc). Chromium 147 with
hardware WebGPU via native GLX/EGL.

## When To Use / Not To Use

**Use this skill when:**
- You need full browser interaction (click, type, navigate, fill forms)
- WebGPU/WebGL rendering validation (Three.js, R3F, Babylon.js)
- Network interception, cookie/storage manipulation
- Visual regression testing with screenshots
- Multi-tab workflows, PDF generation, video recording
- Debugging web apps running on the host or inside Docker

**Consider alternatives:**
- **`browser`** — lightweight AI-optimised snapshots, smaller context, faster (no vision/network/storage)
- **`qe-browser`** — QE-grade typed assertions, visual-diff baselines, injection scanning
- **`chrome-cdp`** — raw CDP protocol access for performance profiling and low-level debugging
- **`web-summary` / `gemini-url-context`** — summarising page content without interaction
- **`curl` / `httpx`** — API testing without a real browser
- **`host-webserver-debug`** — legacy; use `playwright` directly instead (same chromium, more tools)

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
Chromium 147 (WebGPU, Vulkan, native GLX/EGL)
  |  X11 (native GPU context)
  v
i3 WM on Xorg :1 (NVIDIA driver, 1920x1080)
  |
  v
x11vnc → VNC port 5901
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

## WebGPU + GPU (Xorg + NVIDIA)

The `xorg-nvidia` desktop stack runs a real Xorg server with the NVIDIA proprietary
driver, providing native GLX/EGL. Chrome gets a hardware GPU context directly —
no interposition layer needed. x11vnc scrapes the Xorg framebuffer and exports
over VNC port 5901.

```
Chrome (inside container)
  │ Native GLX/EGL + Vulkan
  ▼
Xorg :1 (NVIDIA driver, AllowEmptyInitialConfiguration)
  │ DRM render node (/dev/dri/renderD128+)
  ▼
NVIDIA GPU (driver 525+)
  │ Rendered frames
  ▼
x11vnc → VNC port 5901
```

### Requirements

- `desktop.stack = "xorg-nvidia"` in `agentbox.toml`
- `desktop.webgpu = true` in `agentbox.toml`
- NVIDIA GPU mapped into container (`/dev/dri/card*`, `/dev/dri/renderD*`, `/dev/nvidia*`)
- `NVIDIA_DRIVER_CAPABILITIES=all` in docker-compose
- Host NVIDIA driver >= 525 (Vulkan 1.3 required for WebGPU)

### Manual verification

```bash
# Check GPU access
nvidia-smi
vulkaninfo --summary

# Check GLX (should show NVIDIA, not llvmpipe)
DISPLAY=:1 glxinfo | grep "OpenGL renderer"

# Launch Chrome with WebGPU manually
DISPLAY=:1 chromium --no-sandbox --enable-features=Vulkan,WebGPU --enable-unsafe-webgpu https://webgpusamples.org
```

### Fallback stacks

| Stack | GPU | VNC | Notes |
|-------|-----|-----|-------|
| `xorg-nvidia` | Hardware (native GLX/EGL) | x11vnc | Recommended for WebGPU |
| `i3-x11` | Software only (SwiftShader) | Xvnc built-in | No hardware GPU on Xvnc |
| `hyprland-wayland` | Requires DRM seat access | wayvnc | Reverted — libseat issue in containers |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DISPLAY` | `:1` | X display for browser |
| `CHROMIUM_PATH` | auto-resolved | Path to chromium binary |
| `CHROMIUM_WEBGPU` | `false` | Enable WebGPU launch flags |
| `VK_ICD_FILENAMES` | `/etc/vulkan/icd.d/nvidia_icd.json` | Vulkan ICD path for NVIDIA |
| `__EGL_VENDOR_LIBRARY_FILENAMES` | `/usr/share/glvnd/egl_vendor.d/10_nvidia.json` | EGL vendor for NVIDIA |
| `FONTCONFIG_FILE` | `/etc/fonts/fonts.conf` | Fontconfig path (baked into image) |
| `PLAYWRIGHT_MCP_HEADLESS` | unset (headed) | Set to run headless |
| `VIEWPORT_WIDTH` | `1920` | Browser viewport width |
| `VIEWPORT_HEIGHT` | `1080` | Browser viewport height |
| `PLAYWRIGHT_OUTPUT_DIR` | `/tmp/playwright-mcp` | Screenshot/trace output |

## Visual Access

```bash
vncviewer localhost:5901   # no password (xorg-nvidia stack)
```
