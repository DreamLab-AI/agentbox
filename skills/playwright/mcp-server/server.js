#!/usr/bin/env node
/**
 * Agentbox Playwright MCP — @playwright/mcp wrapper with WebGPU support
 *
 * Replaces the hand-rolled server.js with Microsoft's @playwright/mcp
 * createConnection API (v0.0.75+). Claude Code now receives:
 *
 *   browser_snapshot        — ARIA accessibility tree (93% smaller than screenshots)
 *   browser_screenshot      — visual capture when needed
 *   browser_network_requests — XHR/fetch interception for deep feedback
 *   browser_console_messages — JS console capture
 *   browser_navigate / click / type / select_option / hover
 *   browser_tab_*           — multi-tab management
 *   browser_wait_for        — smart wait on text/selector/load state
 *
 * Chrome launch flags:
 *   CHROMIUM_WEBGPU=true  → --enable-unsafe-webgpu --use-angle=vulkan (+4 flags)
 *   CHROMIUM_WEBGPU=false → --disable-gpu (safe software path)
 *
 * Display:
 *   DISPLAY (default :1)          → X11 path (xorg-nvidia or i3-x11 stack)
 *   WAYLAND_DISPLAY set           → Chrome Ozone/Wayland path (future hyprland stack)
 */
'use strict';

const { createConnection } = require('@playwright/mcp');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(); } catch {}
  try { return execFileSync('which', ['chromium-browser'], { encoding: 'utf8' }).trim(); } catch {}
  try { return execFileSync('which', ['google-chrome-stable'], { encoding: 'utf8' }).trim(); } catch {}
  return '/usr/bin/chromium';
}

const DISPLAY         = process.env.DISPLAY        || ':1';
const CHROMIUM_PATH   = resolveChromium();
const WEBGPU          = process.env.CHROMIUM_WEBGPU === 'true';
const WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY || '';
const XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || '/run/user/1000';
const OUTPUT_DIR      = process.env.PLAYWRIGHT_OUTPUT_DIR || '/tmp/playwright-mcp';
const TIMEOUT_ACTION  = parseInt(process.env.PLAYWRIGHT_TIMEOUT     || '30000');
const TIMEOUT_NAV     = parseInt(process.env.PLAYWRIGHT_NAV_TIMEOUT || '30000');
const VIEWPORT_W      = parseInt(process.env.VIEWPORT_WIDTH  || '1920');
const VIEWPORT_H      = parseInt(process.env.VIEWPORT_HEIGHT || '1080');

// ---------------------------------------------------------------------------
// Chrome launch arg sets
// ---------------------------------------------------------------------------

const baseArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-breakpad',         // kill crash reporter background thread
];

// WebGPU via ANGLE-Vulkan on Xorg + NVIDIA. The xorg-nvidia stack provides
// native GLX/EGL — Chrome gets a real GPU context directly. Falls back to
// SwiftShader software WebGPU when no GPU hardware is present.
const webgpuArgs = WEBGPU ? [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',         // avoid extra CPU→GPU copy on present
  '--disable-gpu-sandbox',      // user-namespace GPU sandbox blocked in container
] : ['--disable-gpu'];

// Native Wayland path (future: when hyprland-wayland stack is enabled).
// When WAYLAND_DISPLAY is unset the X11 path is used via DISPLAY=:1.
const displayArgs = WAYLAND_DISPLAY
  ? ['--ozone-platform=wayland', '--enable-features=UseOzonePlatform']
  : [];

// ---------------------------------------------------------------------------
// Runtime environment passed to Chrome subprocess
// ---------------------------------------------------------------------------

const launchEnv = {
  ...process.env,
  DISPLAY,
  ...(WAYLAND_DISPLAY ? { WAYLAND_DISPLAY, XDG_RUNTIME_DIR } : {}),
  ...(process.env.VK_ICD_FILENAMES ? { VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES } : {}),
  ...(process.env.__EGL_VENDOR_LIBRARY_FILENAMES ? { __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES } : {}),
  ...(process.env.FONTCONFIG_FILE ? { FONTCONFIG_FILE: process.env.FONTCONFIG_FILE } : {}),
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const server = await createConnection(
    {
      browser: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: CHROMIUM_PATH,
          headless: false,
          env: launchEnv,
          args: [...baseArgs, ...webgpuArgs, ...displayArgs],
        },
        contextOptions: {
          viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
          userAgent: [
            'Mozilla/5.0 (X11; Linux x86_64)',
            'AppleWebKit/537.36 (KHTML, like Gecko)',
            'Chrome/120.0.0.0 Safari/537.36',
          ].join(' '),
        },
      },

      // Capability set for autonomous Claude Code agents:
      //   core           — navigate, click, type, fill, hover, keyboard
      //   core-navigation — back/forward/reload, waitForNavigation
      //   core-tabs      — new tab, close tab, switch tab
      //   core-input     — file upload, drag-drop, select
      //   network        — intercept XHR/fetch, headers, status codes
      //   vision         — coordinate-based screenshot + pixel inspection
      //   storage        — cookies, localStorage, sessionStorage
      capabilities: [
        'core', 'core-navigation', 'core-tabs', 'core-input',
        'network', 'vision', 'storage',
      ],

      outputDir: OUTPUT_DIR,
      imageResponses: 'allow',
      timeouts: {
        action:     TIMEOUT_ACTION,
        navigation: TIMEOUT_NAV,
      },
      snapshot: { mode: 'full' },
    },
  );

  // Wire the MCP server to stdio transport.
  // Protocol.connect() is duck-typed; StdioServerTransport from any recent
  // @modelcontextprotocol/sdk version satisfies the start/send/on* interface.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const webgpuDesc = WEBGPU ? 'ANGLE-Vulkan (hardware)' : 'disabled (software)';
  const displayDesc = WAYLAND_DISPLAY
    ? `Wayland(${WAYLAND_DISPLAY}) + XWayland DISPLAY=${DISPLAY}`
    : `X11 DISPLAY=${DISPLAY}`;
  process.stderr.write(`[playwright-mcp] @playwright/mcp server started\n`);
  process.stderr.write(`[playwright-mcp] WebGPU: ${webgpuDesc}\n`);
  process.stderr.write(`[playwright-mcp] Display: ${displayDesc}\n`);
  process.stderr.write(`[playwright-mcp] VNC: port 5901 (Xvnc)\n`);

  process.on('SIGTERM', () => { server.close(); process.exit(0); });
  process.on('SIGINT',  () => { server.close(); process.exit(0); });
}

main().catch(err => {
  process.stderr.write(`[playwright-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
