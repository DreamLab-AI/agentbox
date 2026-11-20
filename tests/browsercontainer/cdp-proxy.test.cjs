// ADR-2207 D3: browsercontainer/cdp-proxy.js, DevTools reachable by name.
//
// Chrome's DevTools HTTP endpoint refuses a Host that is not an IP or localhost
// (its DNS-rebinding defence), so http://browsercontainer:9223/json/version failed
// through the old socat byte pipe. The proxy rewrites Host upstream and rewrites the
// ws URLs back to the caller's host, but must keep the defence: only IP literals,
// localhost and CDP_PROXY_ALLOWED_HOSTS (default browsercontainer) are accepted;
// anything else, a missing Host included, gets 403 before Chrome is contacted.
//
// Properties under test (fake upstream = HTTP + upgrade server standing in for Chrome):
//   - Host rewritten to the upstream address; Content-Length recomputed
//   - webSocketDebuggerUrl / devtoolsFrontendUrl rewritten to the caller's host,
//     name and IP forms, port included
//   - WebSocket upgrade: Host rewritten, bytes round-trip both ways
//   - upstream down -> 502, and the proxy keeps serving
//   - disallowed / missing / malformed Host -> 403, upstream never contacted,
//     plain requests and upgrades alike (DNS rebinding: evil.example -> 127.0.0.1)
//   - allow-list comes from CDP_PROXY_ALLOWED_HOSTS
//   - URLs with query strings are never logged
// Run: node --test tests/browsercontainer/cdp-proxy.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const proxyMod = require(path.join(REPO, 'browsercontainer/cdp-proxy.js'));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function fakeChrome(t) {
  const seen = { requests: [], upgrades: [] };
  const srv = http.createServer((req, res) => {
    seen.requests.push({ method: req.method, url: req.url, host: req.headers.host });
    const host = req.headers.host;
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ Browser: 'Chrome/151.0.7922.47', webSocketDebuggerUrl: `ws://${host}/devtools/browser/abc` }));
    } else if (req.url === '/json/list' || req.url === '/json' || req.url.startsWith('/json/new')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      const page = {
        id: 'P1', type: 'page', url: 'about:blank',
        webSocketDebuggerUrl: `ws://${host}/devtools/page/P1`,
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${host}/devtools/page/P1`,
      };
      res.end(JSON.stringify(req.url.startsWith('/json/new') ? page : [page]));
    } else {
      const text = `raw ${host}`;
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
    }
  });
  const upgraded = new Set();
  srv.on('upgrade', (req, socket, head) => {
    upgraded.add(socket);
    socket.on('end', () => socket.destroy());
    socket.on('error', () => socket.destroy());
    seen.upgrades.push({ url: req.url, host: req.headers.host });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (d) => socket.write(Buffer.concat([Buffer.from('echo:'), d])));
  });
  const port = await listen(srv);
  t.after(() => { for (const s of upgraded) s.destroy(); srv.closeAllConnections?.(); srv.close(); });
  return { port, seen };
}

async function startProxy(t, opts) {
  const logs = [];
  const p = proxyMod.createProxy({ log: (m) => logs.push(m), ...opts });
  const port = await listen(p);
  t.after(() => { p.closeAllConnections?.(); p.close(); });
  return { port, logs };
}

// Raw HTTP so the Host header is exactly what we say (or absent).
function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(text));
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); resolve(buf); }, 1500);
  });
}
const get = (port, p, host) => rawRequest(port, `GET ${p} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
const status = (raw) => Number((raw.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1]);
const body = (raw) => raw.slice(raw.indexOf('\r\n\r\n') + 4);
const header = (raw, name) => (raw.match(new RegExp(`^${name}: (.*)$`, 'mi')) || [])[1]?.trim();

test('Host rewritten upstream; ws URL rewritten to the caller host (name form)', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  const raw = await get(port, '/json/version', 'browsercontainer:9223');
  assert.equal(status(raw), 200, raw);
  assert.equal(up.seen.requests.at(-1).host, `127.0.0.1:${up.port}`);
  const b = body(raw);
  assert.equal(JSON.parse(b).webSocketDebuggerUrl, 'ws://browsercontainer:9223/devtools/browser/abc');
  assert.equal(Number(header(raw, 'Content-Length')), Buffer.byteLength(b), 'Content-Length recomputed');
});

test('ws and frontend URLs rewritten in /json/list, /json and /json/new (IP and localhost forms)', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  const list = JSON.parse(body(await get(port, '/json/list', '172.18.0.5:9223')))[0];
  assert.equal(list.webSocketDebuggerUrl, 'ws://172.18.0.5:9223/devtools/page/P1');
  assert.equal(list.devtoolsFrontendUrl, '/devtools/inspector.html?ws=172.18.0.5:9223/devtools/page/P1');
  const j = JSON.parse(body(await get(port, '/json', 'localhost:9222')))[0];
  assert.equal(j.webSocketDebuggerUrl, 'ws://localhost:9222/devtools/page/P1');
  const created = await rawRequest(port, 'PUT /json/new?about:blank HTTP/1.1\r\nHost: [::1]:9222\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  assert.equal(status(created), 200, created);
  assert.equal(JSON.parse(body(created)).webSocketDebuggerUrl, 'ws://[::1]:9222/devtools/page/P1');
  assert.equal(up.seen.requests.at(-1).method, 'PUT', 'method forwarded verbatim');
});

test('non-JSON paths pass through untouched', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  const raw = await get(port, '/json/protocol', 'browsercontainer:9223');
  assert.equal(body(raw), `raw 127.0.0.1:${up.port}`);
});

test('WebSocket upgrade: Host rewritten, bytes round-trip', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  const got = await new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET /devtools/page/P1 HTTP/1.1\r\nHost: browsercontainer:9223\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = Buffer.alloc(0);
    let sent = false;
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!sent && buf.includes('\r\n\r\n')) { sent = true; sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); }
      if (buf.includes('echo:')) { sock.destroy(); resolve(buf); }
    });
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); resolve(buf); }, 2000);
  });
  assert.match(got.toString('latin1'), /^HTTP\/1\.1 101 /);
  assert.ok(got.includes(Buffer.concat([Buffer.from('echo:'), Buffer.from([0x81, 0x02, 0x68, 0x69])])), 'payload round-trip');
  assert.equal(up.seen.upgrades.length, 1);
  assert.equal(up.seen.upgrades[0].host, `127.0.0.1:${up.port}`);
});

test('upstream down -> 502 without crashing; the proxy keeps serving', async (t) => {
  const dead = net.createServer();
  const deadPort = await listen(dead);
  await new Promise((r) => dead.close(r));
  const { port } = await startProxy(t, { upstreamPort: deadPort });
  assert.equal(status(await get(port, '/json/version', 'browsercontainer:9223')), 502);
  const up = await rawRequest(port, 'GET /devtools/page/P1 HTTP/1.1\r\nHost: localhost:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  assert.equal(status(up), 502);
  assert.equal(status(await get(port, '/json/version', 'localhost:9222')), 502, 'still answering');
});

test('SECURITY: disallowed, missing or malformed Host -> 403; upstream never contacted', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  for (const host of ['evil.example', 'evil.example:9223', 'browsercontainer.', 'browsercontainer.evil.example',
    'xbrowsercontainer', 'browsercontainer:9223:1', 'a b', '[::1', '1.2.3.4.5', '']) {
    const raw = await get(port, '/json/version', host);
    assert.equal(status(raw), 403, `Host '${host}' refused: ${raw.slice(0, 60)}`);
  }
  const noHost = await rawRequest(port, 'GET /json/version HTTP/1.0\r\n\r\n');
  assert.equal(status(noHost), 403, 'missing Host refused');
  const upg = await rawRequest(port, 'GET /devtools/page/P1 HTTP/1.1\r\nHost: evil.example\r\nUpgrade: websocket\r\n' +
    'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  assert.equal(status(upg), 403, 'upgrade with a rebinding Host refused');
  const upgNoHost = await rawRequest(port, 'GET /devtools/page/P1 HTTP/1.0\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  assert.equal(status(upgNoHost), 403, 'upgrade without Host refused');
  assert.equal(up.seen.requests.length, 0, 'upstream never saw a plain request');
  assert.equal(up.seen.upgrades.length, 0, 'upstream never saw an upgrade');
});

test('SECURITY: allowed forms are IP literals, localhost and the allow-list, case-insensitive, any port', async (t) => {
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port });
  for (const host of ['browsercontainer', 'BrowserContainer:9223', 'localhost', 'LOCALHOST:9222', '127.0.0.1:9222',
    '172.18.0.5', '[::1]:9222', '[fe80::1]']) {
    assert.equal(status(await get(port, '/json/version', host)), 200, `Host '${host}' accepted`);
  }
});

test('allow-list from CDP_PROXY_ALLOWED_HOSTS', async (t) => {
  assert.deepEqual(proxyMod.allowedHostsFromEnv({}), ['browsercontainer']);
  assert.deepEqual(proxyMod.allowedHostsFromEnv({ CDP_PROXY_ALLOWED_HOSTS: ' Foo , bar,,' }), ['foo', 'bar']);
  const up = await fakeChrome(t);
  const { port } = await startProxy(t, { upstreamPort: up.port,
    allowedHosts: proxyMod.allowedHostsFromEnv({ CDP_PROXY_ALLOWED_HOSTS: 'cdp.internal' }) });
  assert.equal(status(await get(port, '/json/version', 'cdp.internal:9223')), 200);
  assert.equal(status(await get(port, '/json/version', 'browsercontainer:9223')), 403, 'default replaced, not extended');
  assert.equal(status(await get(port, '/json/version', '10.0.0.7')), 200, 'IP literals still accepted');
});

test('no URL with a query string is ever logged', async (t) => {
  const up = await fakeChrome(t);
  const { port, logs } = await startProxy(t, { upstreamPort: up.port });
  await get(port, '/json/new?https://example.com/?token=SECRET123', 'evil.example');
  await get(port, '/json/new?https://example.com/?token=SECRET123', 'localhost');
  const dead = net.createServer(); const dp = await listen(dead); await new Promise((r) => dead.close(r));
  const p2 = await startProxy(t, { upstreamPort: dp });
  await get(p2.port, '/json/new?https://example.com/?token=SECRET123', 'localhost');
  for (const l of [...logs, ...p2.logs]) assert.doesNotMatch(l, /SECRET123|\?/, `log line leaks a query: ${l}`);
});

test('wiring: supervisord runs the node proxy (not socat), healthcheck probes by name, image ships it', () => {
  const fs = require('node:fs');
  const BC = path.join(REPO, 'browsercontainer');
  const sup = fs.readFileSync(path.join(BC, 'supervisord.conf'), 'utf8');
  const block = (sup.match(/\[program:cdp-proxy\]([^[]*)/) || [])[1] || '';
  assert.match(block, /^command=node \/opt\/browsercontainer\/cdp-proxy\.js$/m);
  assert.match(block, /^user=devuser$/m);
  assert.doesNotMatch(sup, /socat/, 'no socat program left');
  const hc = fs.readFileSync(path.join(BC, 'healthcheck.sh'), 'utf8');
  assert.match(hc, /curl[^\n]*-H 'Host: browsercontainer:9223'[^\n]*http:\/\/127\.0\.0\.1:9223\/json\/version/);
  assert.doesNotMatch(hc, /socat/);
  const df = fs.readFileSync(path.join(BC, 'Dockerfile'), 'utf8');
  assert.match(df, /COPY --chown=devuser:devuser cdp-proxy\.js \/opt\/browsercontainer\/cdp-proxy\.js/);
  assert.match(df, /^\s+socat \\$/m, 'socat package kept for the README port-relay note');
});
