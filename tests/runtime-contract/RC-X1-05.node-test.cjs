'use strict';
// RC-X1-05 — read-only Docker proxy for devuser under [security].role_isolation
// (custody X-1 step 1, W0, owner question Q1 default).
//
// With the flag on, devuser loses the raw host socket and gets
// config/docker-read-proxy.cjs: GET/HEAD on /_ping, /version, /info,
// /containers/json, /containers/<id>/json and /containers/<id>/logs; 403 for
// everything else, including the read-shaped exfiltration routes (archive, export).
//
//   1. isAllowed() against every fixture
//   2. end to end through a fake upstream: allowed requests arrive unchanged,
//      denied requests get 403 and never reach the upstream
//   3. Upgrade requests are refused even on allowed paths
//   4. the program exits 0 without listening when the flag is off
//   5. the real `docker` CLI via DOCKER_HOST: ps, inspect and logs work; exec fails
//
// Run: node --test tests/runtime-contract/RC-X1-05.node-test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PROXY = path.join(ROOT, 'config', 'docker-read-proxy.cjs');
const FIXTURES = require('./fixtures/docker-read-proxy-allowlist.json').cases;

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rc-x1-05-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// ── fake Docker daemon on a unix socket ──────────────────────────────────────
function startFakeDaemon(sock) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, upgrade: req.headers.upgrade });
    const p = req.url.split('?')[0].replace(/^\/v1\.\d+/, '');
    const hdr = { 'API-Version': '1.47', 'Docker-Experimental': 'false', 'OSType': 'linux', 'Content-Type': 'application/json' };
    if (p === '/_ping') { res.writeHead(200, { ...hdr, 'Content-Type': 'text/plain' }); return res.end(req.method === 'HEAD' ? undefined : 'OK'); }
    if (p === '/version') { res.writeHead(200, hdr); return res.end(JSON.stringify({ Version: '29.0.0-fake', ApiVersion: '1.47', MinAPIVersion: '1.24', Os: 'linux', Arch: 'amd64' })); }
    if (p === '/info') { res.writeHead(200, hdr); return res.end(JSON.stringify({ ID: 'fake', Containers: 1 })); }
    if (p === '/containers/json') {
      res.writeHead(200, hdr);
      return res.end(JSON.stringify([{ Id: 'c0ffee000000', Names: ['/fakebox'], Image: 'fake:latest', Command: 'sleep', Created: 0, State: 'running', Status: 'Up', Ports: [], Labels: {}, Mounts: [] }]));
    }
    let m = /^\/containers\/([^/]+)\/json$/.exec(p);
    if (m) {
      res.writeHead(200, hdr);
      return res.end(JSON.stringify({ Id: 'c0ffee000000', Name: '/' + m[1], State: { Status: 'running', Running: true }, Config: { Tty: true, Image: 'fake:latest' }, HostConfig: {}, Mounts: [], NetworkSettings: {} }));
    }
    m = /^\/containers\/([^/]+)\/logs$/.exec(p);
    if (m) { res.writeHead(200, { ...hdr, 'Content-Type': 'application/vnd.docker.raw-stream' }); return res.end('fake-log-line\n'); }
    res.writeHead(200, hdr); res.end('{}'); // anything else would "succeed" — so a leak is visible
  });
  return new Promise((resolve) => server.listen(sock, () => resolve({ server, seen })));
}

function request(sock, method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock, method, path: url, headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function startProxy(env) {
  const child = spawn(process.execPath, [PROXY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, log: () => out };
}

async function waitFor(file, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fs.existsSync(file)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

test('proxy module exists and exports isAllowed', () => {
  assert.ok(fs.existsSync(PROXY), `${PROXY} must exist`);
  const mod = require(PROXY);
  assert.equal(typeof mod.isAllowed, 'function');
  assert.equal(typeof mod.createProxy, 'function');
});

test('isAllowed matches every fixture', () => {
  const { isAllowed } = require(PROXY);
  for (const c of FIXTURES) {
    assert.equal(isAllowed(c.method, c.path), c.allow, `${c.method} ${c.path} (${c.why})`);
  }
});

test('end to end: allowed requests forwarded unchanged, denied ones never reach the upstream', async (t) => {
  const up = path.join(tmp, 'up.sock');
  const listen = path.join(tmp, 'ro.sock');
  const { server, seen } = await startFakeDaemon(up);
  t.after(() => server.close());
  const p = startProxy({ PATH: process.env.PATH, AGENTBOX_ROLE_ISOLATION: '1', DOCKER_READ_PROXY_UPSTREAM: up, DOCKER_READ_PROXY_LISTEN: listen });
  t.after(() => p.child.kill('SIGKILL'));
  assert.ok(await waitFor(listen), `proxy must listen on ${listen}\n${p.log()}`);
  assert.equal((fs.statSync(listen).mode & 0o777), 0o666, 'listen socket is 0666 (set by umask at bind, no chmod)');

  for (const c of FIXTURES) {
    if (/^[a-z]+:/.test(c.path)) continue; // absolute-form cannot be sent over a unix socket client faithfully
    const before = seen.length;
    const r = await request(listen, c.method, c.path);
    if (c.allow) {
      assert.notEqual(r.status, 403, `${c.method} ${c.path} must pass (${c.why})`);
      assert.equal(seen.length, before + 1, `${c.method} ${c.path} must reach the upstream`);
      assert.equal(seen[seen.length - 1].url, c.path, 'path and query forwarded verbatim');
      assert.equal(seen[seen.length - 1].method, c.method);
    } else {
      assert.equal(r.status, 403, `${c.method} ${c.path} must be 403 (${c.why})`);
      assert.equal(seen.length, before, `${c.method} ${c.path} must NOT reach the upstream`);
      if (c.method !== 'HEAD') assert.match(r.body, /read-only/);
    }
  }
});

test('Upgrade requests are refused even on an allowed path', async (t) => {
  const up = path.join(tmp, 'up2.sock');
  const listen = path.join(tmp, 'ro2.sock');
  const { server, seen } = await startFakeDaemon(up);
  t.after(() => server.close());
  const p = startProxy({ PATH: process.env.PATH, AGENTBOX_ROLE_ISOLATION: '1', DOCKER_READ_PROXY_UPSTREAM: up, DOCKER_READ_PROXY_LISTEN: listen });
  t.after(() => p.child.kill('SIGKILL'));
  assert.ok(await waitFor(listen));
  const status = await new Promise((resolve) => {
    const req = http.request({ socketPath: listen, method: 'GET', path: '/containers/x/logs?follow=1', headers: { Connection: 'Upgrade', Upgrade: 'tcp' } });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('upgrade', () => resolve(101));
    req.on('error', () => resolve('closed'));
    req.end();
  });
  assert.notEqual(status, 101, 'no protocol upgrade through the proxy');
  assert.equal(seen.length, 0, 'the upgrade request never reached the upstream');
});

test('flag off: exits 0 and never listens', async () => {
  const listen = path.join(tmp, 'off.sock');
  const p = startProxy({ PATH: process.env.PATH, AGENTBOX_ROLE_ISOLATION: '0', DOCKER_READ_PROXY_UPSTREAM: path.join(tmp, 'nope.sock'), DOCKER_READ_PROXY_LISTEN: listen });
  const code = await new Promise((r) => p.child.on('exit', r));
  assert.equal(code, 0);
  assert.equal(fs.existsSync(listen), false);
});

test('the docker CLI works for ps/inspect/logs and fails for exec', async (t) => {
  const docker = (process.env.PATH || '').split(':').map((d) => path.join(d, 'docker')).find((f) => fs.existsSync(f));
  if (!docker) { t.skip('no docker CLI on PATH'); return; }
  const up = path.join(tmp, 'up3.sock');
  const listen = path.join(tmp, 'ro3.sock');
  const { server, seen } = await startFakeDaemon(up);
  t.after(() => server.close());
  const p = startProxy({ PATH: process.env.PATH, AGENTBOX_ROLE_ISOLATION: '1', DOCKER_READ_PROXY_UPSTREAM: up, DOCKER_READ_PROXY_LISTEN: listen });
  t.after(() => p.child.kill('SIGKILL'));
  assert.ok(await waitFor(listen));
  const cfg = fs.mkdtempSync(path.join(tmp, 'dockercfg-'));
  const env = { PATH: process.env.PATH, HOME: cfg, DOCKER_CONFIG: cfg, DOCKER_HOST: `unix://${listen}` };
  const run = (args) => new Promise((resolve) => execFile(docker, args, { env, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr })));

  const ps = await run(['ps']);
  assert.equal(ps.code, 0, `docker ps: ${ps.stderr}`);
  assert.match(ps.stdout, /fakebox/);
  const insp = await run(['inspect', '--type', 'container', 'fakebox']);
  assert.equal(insp.code, 0, `docker inspect: ${insp.stderr}`);
  assert.match(insp.stdout, /c0ffee000000/);
  const logs = await run(['logs', 'fakebox']);
  assert.equal(logs.code, 0, `docker logs: ${logs.stderr}`);
  assert.match(logs.stdout, /fake-log-line/);

  const before = seen.filter((s) => s.method !== 'GET' && s.method !== 'HEAD').length;
  const ex = await run(['exec', 'fakebox', 'true']);
  assert.notEqual(ex.code, 0, 'docker exec must fail through the proxy');
  assert.match(ex.stderr, /read-only/);
  const run2 = await run(['run', '--rm', 'fake:latest', 'true']);
  assert.notEqual(run2.code, 0, 'docker run must fail through the proxy');
  assert.equal(seen.filter((s) => s.method !== 'GET' && s.method !== 'HEAD').length, before, 'no mutating request reached the daemon');
});
