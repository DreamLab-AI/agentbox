#!/usr/bin/env node
// render.mjs - freezes an HTML page at exact times in the browser sidecar and writes frames, then encodes.
// Contract: the page exposes window.renderAt(t) (and/or CSS/WAAPI animations), optional window.__ready,
// window.W/H/FPS/DUR, window.probe(t).
//
//   node render.mjs <page.html>                          full render -> <out>/frames + <out>/picture.mp4
//   node render.mjs <page.html> --draft                  half size, 1 subframe, 30 fps (animatic)
//   node render.mjs <page.html> --stills 0,1.2,2.4       PNG stills -> <out>/stills
//   node render.mjs <page.html> --verify                 determinism: shuffled frames must hash equal
//   node render.mjs <page.html> --probe                  window.probe(t) per frame -> probe.json + probe.png
//   node render.mjs <page.html> --from 2 --to 3          re-render only those seconds, re-encode
//   node render.mjs <page.html> --alpha                  transparent PNGs + ProRes 4444 picture_alpha.mov
// Options: --out DIR (default: <page dir>/../out) --w --h --fps --dur --sub N (motion blur subframes,
//          180 deg shutter) --scale 2 (supersample, scaled down on encode) --no-encode
//          --root DIR (directory served to the browser; default: the page's own directory)
//
// No browser is installed in this container. The page is drawn by the browsercontainer sidecar's
// Chrome, driven over raw CDP with Node's built-in WebSocket (Node 22+, no npm dependencies):
//   BROWSER_CDP_HOST (default browsercontainer)   BROWSER_CDP_PORT (default 9223, the in-network proxy)
// The sidecar cannot read this container's files, so the page's directory is served to it over HTTP
// for the life of the run: bound to this container's address on the shared network only, under a
// random path token, read-only, and closed on exit. The render runs in its own incognito browser
// context and its own window, both removed on exit, so it never touches another agent's tabs.
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, createReadStream, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, relative, sep, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && /\.html?$/.test(a));
if (!file) { console.error('usage: node render.mjs <page.html> [options]'); process.exit(2); }
const has = (k) => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
if (!existsSync(file)) { console.error(`no such page: ${file}`); process.exit(2); }
const pagePath = realpathSync(resolve(file));
const ROOT = realpathSync(resolve(arg('root', dirname(pagePath))));
if (!(pagePath + sep).startsWith(ROOT + sep)) { console.error(`--root ${ROOT} does not contain ${pagePath}`); process.exit(2); }
const OUT = resolve(arg('out', join(dirname(pagePath), '..', 'out')));
const draft = has('draft'), alpha = has('alpha');
const SCALE = +arg('scale', 1);
const SUB = Math.max(1, +arg('sub', 1));
const CDP_HOST = process.env.BROWSER_CDP_HOST || 'browsercontainer';
const CDP_PORT = +(process.env.BROWSER_CDP_PORT || 9223);
const CMD_TIMEOUT_MS = 60000;

// One render at a time from this container: two would fight over the sidecar's GPU and double every
// frame time. The lock is local, so it cannot see another container or an agent driving the same
// Chrome through the browser-gpu MCP; the private context and window keep those apart, not this.
const LOCK = join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'motion-designer-render.lock');
function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
      // two runs clearing the same stale lock can each delete the other's: settle, then confirm it is ours
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      if (+readFileSync(LOCK, 'utf8') === process.pid) return;
      console.error('another render took the lock at the same moment. Run again when it finishes.'); process.exit(1);
    }
    catch {
      let pid = 0; try { pid = +readFileSync(LOCK, 'utf8'); } catch {}
      let alive = false; try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
      if (alive) { console.error(`another render is running (pid ${pid}). Wait for it, or remove ${LOCK} if that process is gone.`); process.exit(1); }
      try { rmSync(LOCK); } catch {}
    }
  }
  console.error(`cannot take the render lock ${LOCK}`); process.exit(1);
}
takeLock();
process.on('exit', () => { try { if (+readFileSync(LOCK, 'utf8') === process.pid) rmSync(LOCK); } catch {} });

function die(msg) { console.error(msg); process.exitCode = 1; throw new Error(msg); }

// ---------- sidecar connection ----------
// Chrome's DevTools HTTP endpoint refuses a Host header that is a name, so dial the address.
let cdpAddr;
try { cdpAddr = (await lookup(CDP_HOST, { family: 4 })).address; }
catch { console.error(`cannot resolve the browser sidecar "${CDP_HOST}". Start it from the host: ./agentbox.sh browsercontainer up`); process.exit(1); }
let version;
try { version = await (await fetch(`http://${cdpAddr}:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(8000) })).json(); }
catch (e) { console.error(`no CDP answer from ${CDP_HOST}:${CDP_PORT} (${e.message}). Start the sidecar from the host: ./agentbox.sh browsercontainer up`); process.exit(1); }
const wsPath = new URL(version.webSocketDebuggerUrl).pathname;

// the address this container has on the network it shares with the sidecar
const localAddr = await new Promise((res, rej) => {
  const s = connect(CDP_PORT, cdpAddr, () => { const a = s.localAddress; s.destroy(); res(a); });
  s.on('error', rej);
});

// ---------- read-only file server for the page ----------
const TOKEN = randomBytes(16).toString('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
const server = createServer((req, res) => {
  const deny = (code) => { res.writeHead(code); res.end(); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return deny(400); }
  if (!p.startsWith(`/${TOKEN}/`)) return deny(404);
  let target;
  try { target = realpathSync(join(ROOT, p.slice(TOKEN.length + 2))); } catch { return deny(404); }
  if (!(target + sep).startsWith(ROOT + sep)) return deny(404);       // symlink or ../ out of the root
  let st; try { st = statSync(target); } catch { return deny(404); }
  if (!st.isFile()) return deny(404);
  res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(target).pipe(res);
});
await new Promise((res, rej) => { server.once('error', rej); server.listen(0, localAddr, res); });
const pageUrl = `http://${localAddr}:${server.address().port}/${TOKEN}/${relative(ROOT, pagePath).split(sep).map(encodeURIComponent).join('/')}`;

// ---------- minimal CDP client ----------
const ws = new WebSocket(`ws://${cdpAddr}:${CDP_PORT}${wsPath}`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket refused')); });
let nextId = 1;
const pending = new Map();
const listeners = new Set();
ws.onmessage = (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
  if (m.id && pending.has(m.id)) {
    const { res, rej, timer, method } = pending.get(m.id); pending.delete(m.id); clearTimeout(timer);
    m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
  } else if (m.method) for (const l of listeners) l(m);
};
ws.onclose = () => { for (const { rej, timer } of pending.values()) { clearTimeout(timer); rej(new Error('CDP connection closed')); } pending.clear(); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method}: no answer in ${CMD_TIMEOUT_MS / 1000} s`)); }, CMD_TIMEOUT_MS);
  pending.set(id, { res, rej, timer, method });
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});

let contextId = null;
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  try { if (contextId && ws.readyState === 1) await send('Target.disposeBrowserContext', { browserContextId: contextId }); } catch {}
  try { ws.close(); } catch {}
  await new Promise((r) => { server.close(() => r()); server.closeAllConnections(); });
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, async () => { await cleanup(); process.exit(code); });

// A page: its own target in the run's private context. `newWindow` keeps it foreground in a window
// of its own: a background tab gets no animation frames, and seek() below waits on two of them.
async function openTarget(W, H, { scale = 1, transparent = false } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: contextId, newWindow: true, width: Math.min(W, 1920), height: Math.min(H, 1080) });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (transparent) await cmd('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const evaluate = async (fn, a) => {
    const r = await cmd('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(a === undefined ? null : a)})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const screenshot = async (path, opts = {}) => {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, ...opts });
    if (path) writeFileSync(path, Buffer.from(data, 'base64'));
    return data;
  };
  const close = () => send('Target.closeTarget', { targetId }).catch(() => {});
  return { sessionId, cmd, evaluate, screenshot, close };
}

async function openPage(W, H) {
  const page = await openTarget(W, H, { scale: SCALE, transparent: alpha });
  let inflight = 0, lastActivity = Date.now(), loaded = false, failedDoc = null;
  const onEvent = (m) => {
    if (m.sessionId !== page.sessionId) return;
    if (m.method === 'Network.requestWillBeSent') { if (!m.params.redirectResponse) inflight++; lastActivity = Date.now(); }   // a redirect reuses its request
    else if (m.method === 'Network.loadingFinished') { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); }
    else if (m.method === 'Network.loadingFailed') {
      inflight = Math.max(0, inflight - 1); lastActivity = Date.now();
      if (m.params.type === 'Document') failedDoc = m.params.errorText;
    }
    else if (m.method === 'Page.loadEventFired') loaded = true;
    else if (m.method === 'Runtime.exceptionThrown') { console.error('PAGE ERROR:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); process.exitCode = 1; }
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('console:', m.params.args.map((x) => x.value ?? x.description ?? '').join(' '));
  };
  listeners.add(onEvent);
  const nav = await page.cmd('Page.navigate', { url: `${pageUrl}?render=1&w=${W}&h=${H}` });
  if (nav.errorText) die(`the sidecar could not load the page from this container (${nav.errorText}). It must reach ${localAddr} on the shared docker network.`);
  // network idle: loaded, and nothing in flight for 500 ms
  const t0 = Date.now();
  while (!(loaded && inflight === 0 && Date.now() - lastActivity > 500)) {
    if (failedDoc) die(`page load failed: ${failedDoc}`);
    if (Date.now() - t0 > 30000) { if (!loaded) die('page did not finish loading in 30 s'); break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(async () => { await document.fonts.ready; });
  const ready = await page.evaluate(async () => {
    const t0 = Date.now();
    while (!(window.__ready === undefined || window.__ready === true)) { if (Date.now() - t0 > 45000) return false; await new Promise((r) => setTimeout(r, 50)); }
    return true;
  });
  if (!ready) die('window.__ready did not become true in 45 s');
  return page;
}

const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed'); };
const pad = (i, n = 5) => String(i).padStart(n, '0');

async function main() {
  contextId = (await send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;

  // first load at a probe size to read the page's own W/H/FPS/DUR
  const probePage = await openPage(+arg('w', 1080), +arg('h', 1920));
  const meta = await probePage.evaluate(() => ({ W: window.W, H: window.H, FPS: window.FPS, DUR: window.DUR }));
  await probePage.close();

  const W = +arg('w', meta.W || 1080), H = +arg('h', meta.H || 1920);
  const FPS = +arg('fps', draft ? 30 : (meta.FPS || 30));
  const DUR = +arg('dur', meta.DUR || 5);
  const OW = draft ? Math.round(W / 4) * 2 : W, OH = draft ? Math.round(H / 4) * 2 : H;   // output size
  const page = await openPage(W, H);

  const N = Math.round(DUR * FPS);                       // frames 0..N-1
  // seek, then wait two animation frames so compositor layers settle (otherwise the previous frame's
  // layer promotion can change anti-aliasing by a few pixels and break --verify). A window that is
  // not being drawn never delivers them: that is reported, never papered over with a timer, because
  // a frame captured before the compositor caught up is a wrong frame that looks right.
  const seek = async (t) => {
    const ok = await page.evaluate(async (t) => {
      if (typeof window.renderAt === 'function') await window.renderAt(t);
      document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; });
      return Promise.race([
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
        new Promise((r) => setTimeout(() => r(false), 10000)),
      ]);
    }, t);
    if (!ok) die(`no animation frame within 10 s at t=${t}: the sidecar is not drawing the render window (minimised, or the display is down). Check it over VNC.`);
  };
  const snap = async (t, path) => { await seek(t); return page.screenshot(path); };

  // ---------- stills ----------
  if (has('stills')) {
    const dir = join(OUT, 'stills'); mkdirSync(dir, { recursive: true });
    for (const s of arg('stills', '0').split(',').map(Number)) {
      const f = Math.round(s * FPS);
      const p = join(dir, `t${s.toFixed(2)}_f${pad(f, 4)}.png`);
      await snap(f / FPS, p); console.log(p);
    }
    return;
  }

  // ---------- determinism ----------
  // Renders 8 frames in order, then again shuffled. Bit-exact = OK. A handful of anti-aliasing pixels
  // (glyph cache noise, < 0.005% of the frame, diff <= 32/255) = OK with a note. Anything more = a state
  // leak (timer, carried value, unseeded random, property not reset) = FAILED with the pixel count.
  if (has('verify')) {
    const times = Array.from({ length: 8 }, (_, k) => Math.floor((k + 0.5) * N / 8) / FPS);
    const grab = async (t) => snap(t, null);
    const a = []; for (const t of times) a.push(await grab(t));
    const order = [...times.keys()].reverse().sort((x, y) => ((x * 7) % 5) - ((y * 7) % 5));
    let cmp = null;
    const diff = async (x, y) => {
      cmp = cmp || await openTarget(64, 64);
      return cmp.evaluate(async ([x, y]) => {
        const load = (b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b; });
        const [ia, ib] = await Promise.all([load(x), load(y)]);
        const c = new OffscreenCanvas(ia.width, ia.height), g = c.getContext('2d');
        g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, ia.width, ia.height).data;
        g.clearRect(0, 0, ia.width, ia.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, ia.width, ia.height).data;
        let n = 0, max = 0;
        for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3])); if (d) { n++; if (d > max) max = d; } }
        return { n, max, total: ia.width * ia.height };
      }, [x, y]);
    };
    let bad = 0, noise = 0;
    for (const k of order) {
      const b = await grab(times[k]);
      if (b === a[k]) continue;
      const d = await diff(a[k], b);
      if (d.n / d.total < 5e-5 && d.max <= 32) { noise += d.n; continue; }
      bad++; console.error(`mismatch at t=${times[k].toFixed(3)} (frame ${Math.round(times[k] * FPS)}): ${d.n} px differ, max ${d.max}/255`);
    }
    console.log(bad ? `verify FAILED (${bad}/${times.length})` : noise ? `verify OK (${noise} px anti-aliasing noise)` : 'verify OK');
    if (bad) process.exitCode = 1;
    return;
  }

  // ---------- probe (speed graph) ----------
  if (has('probe')) {
    const dir = join(OUT, 'qc'); mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let i = 0; i < N; i++) rows.push({ f: i, ...(await page.evaluate((t) => window.probe ? window.probe(t) : {}, i / FPS)) });
    writeFileSync(join(dir, 'probe.json'), JSON.stringify(rows));
    const keys = Object.keys(rows[0]).filter((k) => k !== 'f');
    if (!keys.length) die('the page defines no window.probe(t), or it returned no values');
    const colors = ['#d9534f', '#2a7ae2', '#2e9e5b', '#c98a00', '#8a4fd1'];
    const PW = 1600, PH = 300 * keys.length;
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const svg = keys.map((k, j) => {
      const v = rows.map((r) => (r[k] === null || r[k] === undefined || !isFinite(+r[k])) ? null : +r[k]);   // null = off screen
      const ok = v.filter((y) => y !== null), lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
      const X = (i) => (60 + i * (PW - 80) / Math.max(1, N - 1)).toFixed(1), Y = (y) => (j * 300 + 260 - (y - lo) / span * 220).toFixed(1);
      const pts = v.map((y, i) => y === null ? '' : `${X(i)},${Y(y)}`).filter(Boolean).join(' ');
      const dots = v.map((y, i) => y === null ? '' : `<circle cx="${X(i)}" cy="${Y(y)}" r="2"/>`).join('');
      return `<text x="10" y="${j * 300 + 24}" font-size="20" fill="#222">${esc(k)}  [${lo.toFixed(3)} .. ${hi.toFixed(3)}]</text>
        <polyline fill="none" stroke="${colors[j % 5]}" stroke-width="2" points="${pts}"/><g fill="${colors[j % 5]}">${dots}</g>`;
    }).join('');
    const chart = await openTarget(PW, PH);
    const { frameTree } = await chart.cmd('Page.getFrameTree');
    await chart.cmd('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<body style="margin:0;background:#fff;font-family:sans-serif"><svg width="${PW}" height="${PH}">${svg}</svg></body>` });
    await chart.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
    await chart.screenshot(join(dir, 'probe.png'));
    console.log(join(dir, 'probe.json')); console.log(join(dir, 'probe.png'));
    return;
  }

  // ---------- frames ----------
  const frames = join(OUT, draft ? 'frames_draft' : 'frames');
  const from = has('from') ? Math.round(+arg('from') * FPS) : 0;
  const to = has('to') ? Math.min(N, Math.round(+arg('to') * FPS)) : N;
  if (!has('from') && existsSync(frames)) rmSync(frames, { recursive: true });
  mkdirSync(frames, { recursive: true });
  const subDir = join(OUT, '_sub');
  const t0 = Date.now();
  const blur = SUB > 1 && !draft;
  if (blur) { rmSync(subDir, { recursive: true, force: true }); mkdirSync(subDir, { recursive: true }); }
  for (let i = from; i < to; i++) {
    if (!blur) await snap(i / FPS, join(frames, `${pad(i)}.png`));
    else for (let k = 0; k < SUB; k++) await snap((i + k * 0.5 / SUB) / FPS, join(subDir, `${pad((i - from) * SUB + k, 7)}.png`));
    if ((i - from) % 30 === 29) process.stdout.write(`\r${i + 1}/${to} frames`);
  }
  await cleanup();                                        // the browser is done; the rest is local
  if (blur && to > from) {
    // average each frame's subframes (180 deg shutter) in one pass over the whole range
    ff(['-framerate', '1', '-i', join(subDir, '%07d.png'), '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})'`,
      '-fps_mode', 'passthrough', '-start_number', String(from), join(frames, '%05d.png')]);
  }
  rmSync(subDir, { recursive: true, force: true });
  console.log(`\n${to - from} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${frames}`);

  // ---------- encode ----------
  if (!has('no-encode')) {
    const scaleF = `scale=${OW}:${OH}:flags=lanczos`;
    if (alpha) {
      const mov = join(OUT, 'picture_alpha.mov');
      ff(['-framerate', String(FPS), '-i', join(frames, '%05d.png'), '-vf', scaleF, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', mov]);
      console.log(mov);
    } else {
      const mp4 = join(OUT, draft ? 'animatic.mp4' : 'picture.mp4');
      ff(['-framerate', String(FPS), '-i', join(frames, '%05d.png'), '-vf', scaleF, '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4]);
      console.log(mp4);
    }
  }
}

try { await main(); }
catch (e) { if (!process.exitCode) process.exitCode = 1; console.error(`render failed: ${e.message}`); }
finally { await cleanup(); }
process.exit(process.exitCode || 0);
