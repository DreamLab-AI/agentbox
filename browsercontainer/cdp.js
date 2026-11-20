'use strict';
/**
 * ADR-2207: the few browser-level CDP calls the bridge (server.js) and the
 * diagnostic (cdp-diagnose.js) share: Chrome's version, the browser window's
 * bounds and state, and fullscreen on/off. Talks to Chrome's own endpoint on
 * 127.0.0.1:<port>, never through the 9223 proxy. `ws` is required lazily so
 * modules that only import helpers load without node_modules.
 */

const http = require('http');

/** GET http://127.0.0.1:<port><path> and parse JSON. */
function getJson(port, path, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`CDP ${path} HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`CDP ${path}: invalid JSON`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`CDP ${path} timeout`)));
    req.on('error', reject);
  });
}

/** Opens the browser-level DevTools socket, runs fn(send), always closes. */
async function withBrowser(port, fn, timeoutMs = 10000) {
  const { webSocketDebuggerUrl } = await getJson(port, '/json/version');
  const WebSocket = require('ws');
  const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let nextId = 1;
  const pending = new Map();
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  });
  try {
    return await fn(send);
  } finally {
    for (const p of pending.values()) clearTimeout(p.timer);
    ws.close();
  }
}

/** The first ordinary page target (not an extension page). */
async function pageTargetId(send) {
  const { targetInfos } = await send('Target.getTargets');
  const pages = targetInfos.filter((t) => t.type === 'page');
  const page = pages.find((t) => !String(t.url).startsWith('chrome-extension://')) || pages[0];
  if (!page) throw new Error('no page target');
  return page.targetId;
}

async function windowOf(send) {
  const targetId = await pageTargetId(send);
  const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId });
  return { windowId, bounds };
}

/** { windowId, bounds: { left, top, width, height, windowState } } of the browser window. */
function getWindow(port) {
  return withBrowser(port, windowOf);
}

/**
 * Fullscreen on: the page gets the whole screen (needs the window manager).
 * Off: back through `normal` to `maximized` (Chrome does not always go straight
 * from fullscreen to maximized). Returns the resulting window.
 */
function setFullscreen(port, on) {
  return withBrowser(port, async (send) => {
    const { windowId } = await windowOf(send);
    if (on) {
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    } else {
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    }
    const { bounds } = await send('Browser.getWindowBounds', { windowId });
    return { windowId, bounds };
  });
}

/** The bridge's CDP dependency, bound to one port. */
function cdpClient(port) {
  return {
    version: () => getJson(port, '/json/version'),
    window: () => getWindow(port),
    fullscreen: (on) => setFullscreen(port, on),
  };
}

module.exports = { getJson, withBrowser, pageTargetId, getWindow, setFullscreen, cdpClient };
