#!/usr/bin/env node
/**
 * Sidecar diagnostic.
 *
 *   node cdp-diagnose.js                  sidecar checks only
 *   node cdp-diagnose.js <url> [waitMs]   sidecar checks, then the page diagnosis of <url>
 *                                         (TARGET_URL env is the same as <url>)
 *
 * Sidecar checks (ADR-2207 D7), run in a fresh background tab on a loopback URL
 * (a secure context) that is closed afterwards, so no open tab is navigated:
 *   - display: the browser window's bounds equal the configured display
 *     (BROWSER_DISPLAY_SIZE) at 0,0, maximised or fullscreen;
 *   - WebGPU: navigator.gpu has an adapter that is not a fallback adapter, and a
 *     compute shader doubles 1024 floats and the read-back matches exactly;
 *   - window.nostr presence, as information only (the sidecar must come up
 *     without Podkey).
 * Exit status is non-zero only on a display or WebGPU failure. The page diagnosis
 * (navigates the first tab to <url>) reports state, console, errors, latency and a
 * screenshot, and never changes the exit status.
 */
'use strict';
const http = require('http');
const path = require('path');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);

/** Positional args: [url] [waitMs]; no url and no TARGET_URL -> sidecar checks only. */
function parseArgs(argv = process.argv.slice(2), env = process.env) {
  return {
    targetUrl: argv[0] || env.TARGET_URL || null,
    waitMs: parseInt(argv[1] || '15000', 10),
  };
}

/** A loopback page that is a secure context in this container: the bridge's /health. */
function probeUrl(env = process.env) {
  return `http://127.0.0.1:${env.SIDECAR_PORT || '8931'}/health`;
}

/**
 * True in the probe tab only once the probe URL itself has loaded. A new target
 * starts on about:blank, which already reports readyState 'complete'; probing
 * there would lose the execution context when the real page commits.
 */
function readyExpression(url) {
  return `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`;
}

// Evaluated in the probe tab. Returns a plain object; never throws.
const WEBGPU_PROBE = `(async () => {
  const out = { gpu: !!navigator.gpu, secure: window.isSecureContext, nostr: typeof window.nostr !== 'undefined' };
  try {
    if (!navigator.gpu) return out;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { out.adapter = null; return out; }
    const info = adapter.info || {};
    out.adapter = { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '',
      isFallbackAdapter: !!(info.isFallbackAdapter !== undefined ? info.isFallbackAdapter : adapter.isFallbackAdapter) };
    const device = await adapter.requestDevice();
    const N = 1024;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = i * 0.5 + 1;
    const data = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const readback = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(data, 0, input);
    const module = device.createShaderModule({ code:
      '@group(0) @binding(0) var<storage, read_write> d: array<f32>;' +
      '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {' +
      '  if (id.x < 1024u) { d[id.x] = d[id.x] * 2.0; } }' });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: data } }] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    enc.copyBufferToBuffer(data, 0, readback, 0, N * 4);
    device.queue.submit([enc.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    let mismatches = 0;
    for (let i = 0; i < N; i++) if (result[i] !== input[i] * 2) mismatches++;
    out.compute = { n: N, mismatches, ok: mismatches === 0 };
    device.destroy();
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
})()`;

/**
 * Pure verdict over the collected facts. Fails only on display or WebGPU;
 * window.nostr goes to info.
 */
function verdict({ display, window: win, webgpu }) {
  const failures = [];
  const info = [];
  if (!display) {
    failures.push('display: BROWSER_DISPLAY_SIZE is invalid');
  } else if (!win || !win.bounds) {
    failures.push('display: browser window bounds unavailable');
  } else {
    const b = win.bounds;
    if (b.width !== display.width || b.height !== display.height || b.left !== 0 || b.top !== 0) {
      failures.push(`display: window ${b.width}x${b.height} at ${b.left},${b.top} (${b.windowState}), ` +
        `expected ${display.size} at 0,0`);
    }
  }
  if (!webgpu || webgpu.gpu === undefined) {
    failures.push(`webgpu: probe did not run${webgpu && webgpu.error ? ` (${webgpu.error})` : ''}`);
  } else if (!webgpu.gpu) {
    failures.push('webgpu: navigator.gpu missing');
  } else if (!webgpu.adapter) {
    failures.push(`webgpu: no adapter${webgpu.error ? ` (${webgpu.error})` : ''}`);
  } else if (webgpu.adapter.isFallbackAdapter) {
    failures.push(`webgpu: fallback adapter ${webgpu.adapter.vendor}/${webgpu.adapter.architecture}`);
  } else if (!webgpu.compute || !webgpu.compute.ok) {
    failures.push(`webgpu: compute round trip failed${webgpu.compute ? ` (${webgpu.compute.mismatches} mismatches)` : ''}` +
      `${webgpu.error ? ` (${webgpu.error})` : ''}`);
  }
  if (webgpu && webgpu.gpu !== undefined) {
    info.push(`window.nostr ${webgpu.nostr ? 'present (Podkey)' : 'absent (Podkey not loaded or not injected here)'}`);
  }
  return { ok: failures.length === 0, failures, info };
}

async function sidecarChecks() {
  const cdp = require('./cdp.js');
  let display = null;
  try { display = require('./display.js').parseDisplaySize(); } catch (e) { console.log(`display: ${e.message}`); }
  let win = null;
  let webgpu = null;
  try {
    await cdp.withBrowser(CDP_PORT, async (send) => {
      const { targetId } = await send('Target.createTarget', { url: probeUrl(), background: true });
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const w = await send('Browser.getWindowForTarget', { targetId });
        win = { windowId: w.windowId, bounds: w.bounds };
        const url = probeUrl();
        let ready = false;
        for (let i = 0; i < 50 && !ready; i++) {
          try {
            const r = await send('Runtime.evaluate', { expression: readyExpression(url), returnByValue: true }, sessionId);
            ready = !!(r.result && r.result.value === true);
          } catch {
            // The execution context was swapped by the navigation: not ready yet.
          }
          if (!ready) await new Promise((res) => setTimeout(res, 200));
        }
        if (!ready) {
          webgpu = { error: 'probe page did not load' };
        } else {
          try {
            const r = await send('Runtime.evaluate', { expression: WEBGPU_PROBE, awaitPromise: true, returnByValue: true }, sessionId);
            webgpu = r.result ? r.result.value : { error: 'no result' };
          } catch (e) {
            webgpu = { error: e.message };
          }
        }
      } finally {
        await send('Target.closeTarget', { targetId }).catch(() => {});
      }
    }, 30000);
  } catch (e) {
    if (!webgpu) webgpu = { error: e.message };
  }
  return { display, window: win, webgpu };
}
// end sidecarChecks

function printChecks(facts, v) {
  console.log('=== SIDECAR CHECKS ===');
  console.log(`display  : configured ${facts.display ? facts.display.size : 'invalid'}; window ` +
    (facts.window ? JSON.stringify(facts.window.bounds) : 'unavailable'));
  console.log(`webgpu   : ${JSON.stringify(facts.webgpu)}`);
  for (const i of v.info) console.log(`info     : ${i}`);
  for (const f of v.failures) console.log(`FAIL     : ${f}`);
  console.log(v.ok ? 'PASS: display and WebGPU' : 'FAIL: see above');
}

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const tabs = JSON.parse(d);
          const tab = tabs.find(t => t.type === 'page') || tabs[0];
          resolve(tab.webSocketDebuggerUrl);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** The original page diagnosis of TARGET_URL. Never affects the exit status. */
async function pageDiagnosis(targetUrl, waitMs) {
  const WebSocket = require('ws');
  const wsUrl = await getWsUrl();
  console.log(`\nCDP: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 30000);
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
          else resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const consoleMessages = [];
  const runtimeErrors = [];
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Network.enable');
    await send('Log.enable');

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Console.messageAdded')
        consoleMessages.push(msg.params.message);
      if (msg.method === 'Runtime.exceptionThrown')
        runtimeErrors.push(msg.params.exceptionDetails);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
        runtimeErrors.push(msg.params.entry);
    });

    console.log(`\nNavigating to ${targetUrl}...`);
    await send('Page.navigate', { url: targetUrl });

    console.log(`Waiting ${waitMs}ms for page to load...`);
    await new Promise(r => setTimeout(r, waitMs));

    console.log('\n=== PAGE STATE ===');
    const t0 = Date.now();
    const state = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        secure: window.isSecureContext,
        crossOriginIsolated: window.crossOriginIsolated,
        sab: typeof SharedArrayBuffer !== 'undefined',
        memory: performance.memory ? {
          used: Math.round(performance.memory.usedJSHeapSize/1048576)+'MB',
          total: Math.round(performance.memory.totalJSHeapSize/1048576)+'MB',
          limit: Math.round(performance.memory.jsHeapSizeLimit/1048576)+'MB',
        } : 'N/A',
        canvasCount: document.querySelectorAll('canvas').length,
        bodySnippet: (document.body?.innerText || '').substring(0, 300),
      }, null, 2)`,
      returnByValue: true,
    });
    const evalMs = Date.now() - t0;
    console.log(`Runtime.evaluate: ${evalMs}ms`);
    console.log(state.result.value);

    console.log('\n=== WEBSOCKET STATUS ===');
    const wsCheck = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        reactRoot: !!document.getElementById('root'),
        r3fLoaded: (() => {
          try {
            const root = document.getElementById('root');
            if (!root) return false;
            return !!Object.keys(root).find(k => k.startsWith('__reactFiber'));
          } catch { return false; }
        })(),
        wsResources: performance.getEntriesByType('resource')
          .filter(r => r.name.includes('ws://') || r.name.includes('wss://'))
          .map(f => f.name.substring(0,80)).slice(0, 5),
      }, null, 2)`,
      returnByValue: true,
    });
    console.log(wsCheck.result.value);

    console.log('\n=== CONSOLE ===');
    console.log(`Messages: ${consoleMessages.length}`);
    consoleMessages.slice(-15).forEach(m =>
      console.log(`[${m.level}] ${(m.text||'').substring(0, 200)}`));

    console.log('\n=== ERRORS ===');
    console.log(`Count: ${runtimeErrors.length}`);
    runtimeErrors.slice(-10).forEach(e =>
      console.log(JSON.stringify(e).substring(0, 300)));

    console.log('\n=== SCREENSHOT ===');
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const dir = process.env.BROWSER_EXCHANGE_DIR || '/tmp';
    const shot = path.join(require('fs').existsSync(dir) ? dir : '/tmp', 'diagnose.png');
    require('fs').writeFileSync(shot, Buffer.from(ss.data, 'base64'));
    console.log(`Saved: ${shot}`);

    console.log('\n=== PAGE VERDICT ===');
    if (evalMs < 5000) {
      console.log(`PASS: main thread responsive (${evalMs}ms)`);
    } else {
      console.log(`FAIL: main thread slow or frozen (${evalMs}ms)`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (err.message.includes('Timeout')) {
      console.log('\nFAIL: main thread FROZEN (Runtime.evaluate timed out)');
    }
  } finally {
    ws.close();
  }
}

async function main() {
  const { targetUrl, waitMs } = parseArgs();
  const facts = await sidecarChecks();
  const v = verdict(facts);
  printChecks(facts, v);
  if (targetUrl) {
    try { await pageDiagnosis(targetUrl, waitMs); } catch (e) { console.error('Page diagnosis error:', e.message); }
  }
  process.exit(v.ok ? 0 : 1);
}

module.exports = { WEBGPU_PROBE, parseArgs, probeUrl, readyExpression, verdict };

if (require.main === module) {
  main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
}
