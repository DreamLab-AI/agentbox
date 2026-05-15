#!/usr/bin/env node
'use strict';
const http = require('http');
const WebSocket = require('ws');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const TARGET_URL = process.argv[2] || process.env.TARGET_URL || 'http://192.168.2.132:3001';
const WAIT_MS = parseInt(process.argv[3] || '15000', 10);

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const tabs = JSON.parse(d);
        const tab = tabs.find(t => t.type === 'page') || tabs[0];
        resolve(tab.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function main() {
  const wsUrl = await getWsUrl();
  console.log(`CDP: ${wsUrl}`);
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

  const consoleMessages = [];
  const runtimeErrors = [];

  ws.on('open', async () => {
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

      console.log(`\nNavigating to ${TARGET_URL}...`);
      await send('Page.navigate', { url: TARGET_URL });

      console.log(`Waiting ${WAIT_MS}ms for page to load...`);
      await new Promise(r => setTimeout(r, WAIT_MS));

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
      const path = '/tmp/visionflow-diagnose.png';
      require('fs').writeFileSync(path, Buffer.from(ss.data, 'base64'));
      console.log(`Saved: ${path}`);

      console.log('\n=== VERDICT ===');
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
      process.exit(0);
    }
  });
  ws.on('error', e => { console.error('WS error:', e.message); process.exit(1); });
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
