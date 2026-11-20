// ADR-2207 D2/D5: browsercontainer/server.js, the SSE bridge to chrome-devtools-mcp.
//
// Properties under test:
//   D2  the MCP child runs with cwd and TMPDIR = the exchange directory when it exists
//       and is writable (a relative filePath lands in the exchange, and any path under
//       it passes the connector's os.tmpdir() root check at the path agentbox sees);
//       otherwise it keeps the defaults and the bridge warns once; mcp/ is created
//       lazily and nothing in the volume is deleted.
// Run: node --test tests/browsercontainer/server.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const server = require(path.join(REPO, 'browsercontainer/server.js'));

function tmpdir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-server-'));
  t.after(() => { try { fs.chmodSync(d, 0o700); } catch {} fs.rmSync(d, { recursive: true, force: true }); });
  return d;
}

test('D2: child runs in the exchange (cwd and TMPDIR) when it is a writable directory', (t) => {
  const ex = tmpdir(t);
  fs.writeFileSync(path.join(ex, 'keep.txt'), 'x');
  const logs = [];
  const resolveExchange = server.createExchangeResolver((m) => logs.push(m));
  const cfg = server.childSpawnConfig({ cdpPort: 9222, exchangeDir: resolveExchange(ex),
    env: { PATH: '/usr/bin', TMPDIR: '/tmp', HOME: '/home/devuser' } });
  assert.equal(cfg.command, 'chrome-devtools-mcp');
  assert.equal(cfg.options.cwd, ex);
  assert.equal(cfg.options.env.TMPDIR, ex);
  assert.equal(cfg.options.env.HOME, '/home/devuser', 'the rest of the environment is kept');
  assert.ok(fs.statSync(path.join(ex, 'mcp')).isDirectory(), 'mcp/ created lazily');
  assert.ok(fs.existsSync(path.join(ex, 'keep.txt')), 'nothing in the volume is deleted');
  assert.deepEqual(logs, []);
});

test('D2: missing, read-only or non-directory exchange keeps the defaults and warns once', (t) => {
  const base = tmpdir(t);
  const ro = path.join(base, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
  const file = path.join(base, 'file'); fs.writeFileSync(file, 'x');
  for (const dir of [path.join(base, 'missing'), ro, file]) {
    if (dir === ro && process.getuid && process.getuid() === 0) continue; // root ignores modes
    const logs = [];
    const resolveExchange = server.createExchangeResolver((m) => logs.push(m));
    assert.equal(resolveExchange(dir), null, `${path.basename(dir)} is not usable`);
    assert.equal(resolveExchange(dir), null);
    assert.equal(logs.length, 1, `exactly one warning for ${path.basename(dir)}: ${logs}`);
    const cfg = server.childSpawnConfig({ cdpPort: 9222, exchangeDir: null, env: { TMPDIR: '/tmp', PATH: '/usr/bin' } });
    assert.equal(cfg.options.cwd, undefined, 'default cwd');
    assert.equal(cfg.options.env.TMPDIR, '/tmp', 'TMPDIR untouched');
  }
  assert.ok(!fs.existsSync(path.join(base, 'missing')), 'a missing exchange is not created');
});

test('D2: default exchange dir is /home/devuser/exchange, overridable by BROWSER_EXCHANGE_DIR', () => {
  assert.equal(server.exchangeDirFromEnv({}), '/home/devuser/exchange');
  assert.equal(server.exchangeDirFromEnv({ BROWSER_EXCHANGE_DIR: '/x/y' }), '/x/y');
});

test('child keeps its existing connector flags and the persistent Chrome', () => {
  const { args, options } = server.childSpawnConfig({ cdpPort: 9333, exchangeDir: null, env: {} });
  for (const flag of ['--browser-url=http://127.0.0.1:9333', '--headless=false', '--category-experimental-webmcp',
    '--experimental-vision', '--experimental-memory']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(options.env.DISPLAY, ':2');
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
});

// ---------------------------------------------------------------------------
// D5: telemetry opt-out, health status codes, display and record endpoints,
// Origin refusal on the state-changing endpoints.
// ---------------------------------------------------------------------------
const http = require('node:http');

test('D5: nothing leaves the estate: usage statistics and update checks off', () => {
  const { args, options } = server.childSpawnConfig({ cdpPort: 9222, exchangeDir: null, env: {} });
  assert.ok(args.includes('--no-usage-statistics'));
  assert.equal(options.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, '1');
  assert.equal(options.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS, '1');
});

function fakeCdp(overrides = {}) {
  const calls = [];
  return {
    calls,
    version: async () => ({ Browser: 'Chrome/151.0.7922.47' }),
    window: async () => ({ windowId: 1, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'maximized' } }),
    fullscreen: async (on) => { calls.push(on); return { windowId: 1, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: on ? 'fullscreen' : 'maximized' } }; },
    ...overrides,
  };
}

async function startBridge(t, deps = {}) {
  const srv = server.createBridgeServer({
    cdpPort: 9222,
    display: { width: 1920, height: 1080, size: '1920x1080' },
    versions: { 'chrome-devtools-mcp': '1.13.0', chrome_beta: 'Google Chrome 151.0.7922.47 beta' },
    cdp: fakeCdp(),
    record: async () => ({ code: 0, stdout: '{"recording":false,"pid":null,"path":null}' }),
    ...deps,
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  return srv.address().port;
}

function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text: d });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const cors = (h) => Object.keys(h).filter((k) => k.startsWith('access-control-'));

test('D5: /health is 200 with display and versions when Chrome answers, 503 when it does not', async (t) => {
  const up = await startBridge(t);
  const ok = await request(up, 'GET', '/health');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'ok');
  assert.equal(ok.json.chrome, true);
  assert.equal(ok.json.display, '1920x1080');
  assert.equal(ok.json.connectorVersion, '1.13.0');
  assert.equal(ok.json.chromeVersion, 'Chrome/151.0.7922.47');
  assert.equal(ok.json.versions.chrome_beta, 'Google Chrome 151.0.7922.47 beta');
  for (const k of ['transport', 'sessions', 'cdp', 'connector']) assert.ok(k in ok.json, `kept field ${k}`);
  const down = await startBridge(t, { cdp: fakeCdp({ version: async () => { throw new Error('ECONNREFUSED'); } }) });
  const bad = await request(down, 'GET', '/health');
  assert.equal(bad.status, 503);
  assert.equal(bad.json.status, 'degraded');
  assert.equal(bad.json.chrome, false);
  assert.equal(ok.headers['access-control-allow-origin'], '*', '/health CORS unchanged');
});

test('D5: GET /display reports the configured size and the window bounds/state', async (t) => {
  const port = await startBridge(t);
  const r = await request(port, 'GET', '/display');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { size: '1920x1080', width: 1920, height: 1080,
    window: { windowId: 1, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'maximized' } } });
  const down = await startBridge(t, { cdp: fakeCdp({ window: async () => { throw new Error('no page'); } }) });
  const e = await request(down, 'GET', '/display');
  assert.equal(e.status, 503);
  assert.ok(e.json.error);
});

test('D5: POST /display/fullscreen validates its body and toggles fullscreen', async (t) => {
  const cdp = fakeCdp();
  const port = await startBridge(t, { cdp });
  const on = await request(port, 'POST', '/display/fullscreen', { body: '{"on":true}', headers: { 'content-type': 'application/json' } });
  assert.equal(on.status, 200);
  assert.equal(on.json.window.bounds.windowState, 'fullscreen');
  const off = await request(port, 'POST', '/display/fullscreen', { body: '{"on":false}' });
  assert.equal(off.status, 200);
  assert.deepEqual(cdp.calls, [true, false]);
  for (const body of ['{"on":"yes"}', '{}', '[]', 'not json', '{"on":true,"x":1}', '']) {
    const r = await request(port, 'POST', '/display/fullscreen', { body });
    assert.equal(r.status, 400, `body ${JSON.stringify(body)} rejected`);
    assert.ok(r.json && r.json.error, 'error is JSON');
  }
  const big = await request(port, 'POST', '/display/fullscreen', { body: `{"on":true,"pad":"${'x'.repeat(5000)}"}` });
  assert.equal(big.status, 413);
  assert.equal((await request(port, 'GET', '/display/fullscreen')).status, 405);
  assert.deepEqual(cdp.calls, [true, false], 'invalid requests never reach Chrome');
});

test('SECURITY D5: state-changing endpoints refuse any Origin and emit no CORS headers', async (t) => {
  const cdp = fakeCdp();
  const recCalls = [];
  const port = await startBridge(t, { cdp, record: async (args) => { recCalls.push(args); return { code: 0, stdout: '{}' }; } });
  for (const [p, body] of [['/display/fullscreen', '{"on":true}'], ['/record/start', '{"name":"x"}'], ['/record/stop', '']]) {
    for (const origin of ['http://evil.example', 'null', 'http://localhost:8931']) {
      const r = await request(port, 'POST', p, { body, headers: { origin, 'content-type': 'application/json' } });
      assert.equal(r.status, 403, `${p} with Origin ${origin}`);
      assert.deepEqual(cors(r.headers), [], `${p} emits no CORS headers`);
    }
    const pre = await request(port, 'OPTIONS', p, { headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } });
    assert.deepEqual(cors(pre.headers), [], `${p} preflight emits no CORS headers`);
    assert.notEqual(pre.status, 204, `${p} preflight not approved`);
    const noOrigin = await request(port, 'POST', p, { body });
    assert.deepEqual(cors(noOrigin.headers), [], `${p} emits no CORS headers without Origin either`);
  }
  assert.deepEqual(cdp.calls, [true], 'only the Origin-less request reached Chrome');
  assert.equal(recCalls.length, 2, 'only the Origin-less record requests reached record.sh');
  const sse = await request(port, 'OPTIONS', '/messages', { headers: { origin: 'http://x' } });
  assert.equal(sse.status, 204, '/messages preflight unchanged');
  assert.equal(sse.headers['access-control-allow-origin'], '*');
});

test('D5: record endpoints delegate to record.sh (stub ffmpeg) with status codes', async (t) => {
  const os2 = require('node:os');
  const work = fs.mkdtempSync(path.join(os2.tmpdir(), 'bc-rec-'));
  t.after(() => {
    try { const pid = Number(fs.readFileSync(path.join(work, 'state', 'record.pid'), 'utf8')); process.kill(pid, 'SIGKILL'); } catch {}
    fs.rmSync(work, { recursive: true, force: true });
  });
  const stub = path.join(work, 'ffmpeg');
  fs.writeFileSync(stub, '#!/usr/bin/env node\nconst a=process.argv.slice(2);process.on("SIGINT",()=>{require("fs").writeFileSync(a[a.length-1],"MKV");process.exit(0)});setTimeout(()=>{},60000);\n', { mode: 0o755 });
  fs.mkdirSync(path.join(work, 'ex'));
  const env = { ...process.env, FFMPEG_BIN: stub, BROWSER_EXCHANGE_DIR: path.join(work, 'ex'),
    RECORD_STATE_DIR: path.join(work, 'state'), RECORD_START_CHECK_SECONDS: '0.2' };
  delete env.BROWSER_DISPLAY_SIZE;
  const port = await startBridge(t, { record: server.createRecordRunner({ env }) });
  const s1 = await request(port, 'POST', '/record/start', { body: '{"name":"demo run"}' });
  assert.equal(s1.status, 200, s1.text);
  assert.equal(s1.json.recording, true);
  assert.match(s1.json.path, /\/recordings\/demo-run-\d{8}T\d{6}Z\.mkv$/);
  const s2 = await request(port, 'POST', '/record/start', { body: '{}' });
  assert.equal(s2.status, 409, 'one recording at a time');
  const st = await request(port, 'GET', '/record');
  assert.equal(st.status, 200);
  assert.equal(st.json.recording, true);
  const stop = await request(port, 'POST', '/record/stop', { body: '' });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(stop.json.finalised, true);
  assert.equal(fs.readFileSync(s1.json.path, 'utf8'), 'MKV');
  assert.equal((await request(port, 'POST', '/record/stop')).status, 409, 'nothing to stop');
  for (const body of ['{"name":5}', `{"name":"${'a'.repeat(200)}"}`, '{"name":"x","t":9}', 'nope']) {
    assert.equal((await request(port, 'POST', '/record/start', { body })).status, 400, body.slice(0, 30));
  }
});

test('image ships every local module and script the runtime loads', () => {
  const BC = path.join(REPO, 'browsercontainer');
  const df = fs.readFileSync(path.join(BC, 'Dockerfile'), 'utf8');
  const copied = new Set([...df.matchAll(/^COPY [^\n]*?(\S+) \/opt\/browsercontainer\/(\S+)$/gm)].map((m) => m[2]));
  const needed = new Set();
  for (const f of ['server.js', 'cdp-diagnose.js', 'cdp-proxy.js', 'cdp.js', 'podkey-ctl.js']) {
    if (!fs.existsSync(path.join(BC, f))) continue;
    needed.add(f);
    const src = fs.readFileSync(path.join(BC, f), 'utf8');
    for (const m of src.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) needed.add(m[1]);
    for (const m of src.matchAll(/path\.join\(__dirname, ['"]([^'"]+)['"]\)/g)) needed.add(m[1]);
  }
  for (const f of needed) {
    assert.ok(fs.existsSync(path.join(BC, f)), `${f} exists in the build context`);
    assert.ok(copied.has(f), `Dockerfile copies ${f} to /opt/browsercontainer/`);
  }
});
