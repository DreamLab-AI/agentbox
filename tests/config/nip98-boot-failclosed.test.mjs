#!/usr/bin/env node
// nip98-boot-failclosed (W3-05): what the NIP-98 door does when its boot-class
// config (allowlist + routes, projected to a file by the entrypoint) is not
// there. Spawns the REAL config/nip98-proxy/proxy.mjs against a fake upstream
// and signs requests with a fresh random key (no allowlist entry can match it).
//
//   1. legacy mode (no NIP98_PROXY_REQUIRE_CONFIG): missing file = any valid
//      signer is forwarded. Characterised, documented, unchanged for standalone use.
//   2. REQUIRE_CONFIG + missing file: the door denies every NIP-98 identity
//      (401) and the upstream is never contacted.
//   3. REQUIRE_CONFIG + file with an allowlist: allowed key forwarded, others 403.
//   4. REQUIRE_CONFIG + explicit empty allowlist: the operator's deliberate
//      "any valid signer" still works.
//   5. REQUIRE_CONFIG + file appearing after start: the proxy exits 0 so the
//      supervisor restarts it with the real config (the Stage-B race).
//   6. REQUIRE_CONFIG + malformed file: exit 1 (unchanged crash-loop).
//   8. NIP98-STALE-CONFIG: REQUIRE_CONFIG + a file loaded at start that is then
//      rewritten with different content (the Stage B projection after a stale
//      file from an earlier boot): the proxy exits 0 for a supervised restart;
//      an identical rewrite or a half-written file does not restart it.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PROXY = join(ROOT, 'config/nip98-proxy/proxy.mjs');
// nostr-tools lives beside the baked bridge; a bare worktree has no node_modules.
const BRIDGE = [process.env.NOSTR_BRIDGE_PATH, join(ROOT, 'mcp/servers/nostr-bridge.js'), '/opt/agentbox/mcp/servers/nostr-bridge.js']
  .filter(Boolean).find((c) => { try { createRequire(c)('nostr-tools'); return true; } catch { return false; } });
if (!BRIDGE) { console.log('1..0 # SKIP nostr-tools unresolvable'); process.exit(0); }
const tools = createRequire(BRIDGE)('nostr-tools');

let pass = 0; let fail = 0;
const ok = (c, n, d = '') => { if (c) { pass++; console.log(`ok - ${n}`); } else { fail++; console.log(`not ok - ${n} ${d}`); } };

let upstreamHits = 0;
const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(200); res.end('ok'); });
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UP = `http://127.0.0.1:${upstream.address().port}`;
const tmp = mkdtempSync(join(tmpdir(), 'nip98-boot-'));
const kids = [];

function sign(port, sk) {
  const url = `http://127.0.0.1:${port}/mgmt/x`;
  const ev = tools.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', 'GET']], content: '' }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`;
}
function freePort() {
  return new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}
function start(env) {
  return freePort().then((port) => {
    const e = { ...process.env, NIP98_PROXY_PORT: String(port), NIP98_PROXY_HOST: '127.0.0.1',
      NIP98_PROXY_MGMT_UPSTREAM: UP, NIP98_PROXY_ALLOWED_PUBKEYS: '', NIP98_PROXY_ALLOW_BEARER: '',
      NIP98_PROXY_ROUTES: '', NOSTR_BRIDGE_PATH: BRIDGE, ...env };
    delete e.NIP98_PROXY_REQUIRE_CONFIG_POLL_MS;
    if (env.NIP98_PROXY_REQUIRE_CONFIG_POLL_MS) e.NIP98_PROXY_REQUIRE_CONFIG_POLL_MS = env.NIP98_PROXY_REQUIRE_CONFIG_POLL_MS;
    const proc = spawn(process.execPath, [PROXY], { env: e, stdio: ['ignore', 'ignore', 'ignore'] });
    const k = { proc, port, exit: new Promise((r) => proc.on('exit', (c) => r(c))) };
    kids.push(k);
    return new Promise((resolveStart) => {
      const t0 = Date.now();
      (function poll() {
        if (proc.exitCode !== null) return resolveStart({ ...k, dead: true });
        const p = net.connect(port, '127.0.0.1');
        p.on('connect', () => { p.destroy(); resolveStart(k); });
        p.on('error', () => { p.destroy(); if (Date.now() - t0 > 8000) resolveStart({ ...k, dead: true }); else setTimeout(poll, 80); });
      })();
    });
  });
}
function get(port, header) {
  return new Promise((r) => {
    const q = http.request({ host: '127.0.0.1', port, path: '/mgmt/x', headers: { authorization: header } },
      (res) => { res.resume(); res.on('end', () => r(res.statusCode)); });
    q.on('error', () => r(0)); q.end();
  });
}
const file = (name, body) => { const p = join(tmp, name); writeFileSync(p, body); return p; };
const missing = join(tmp, 'never-projected.json');
const rnd = () => tools.generateSecretKey();

try {
  // 1. legacy
  let k = await start({ NIP98_PROXY_CONFIG_FILE: missing });
  upstreamHits = 0;
  ok((await get(k.port, sign(k.port, rnd()))) === 200 && upstreamHits === 1,
    'legacy (no REQUIRE_CONFIG): missing file forwards any valid signer [characterised]');

  // 2. required + missing
  k = await start({ NIP98_PROXY_CONFIG_FILE: missing, NIP98_PROXY_REQUIRE_CONFIG: '1' });
  upstreamHits = 0;
  const st = k.dead ? -1 : await get(k.port, sign(k.port, rnd()));
  ok(!k.dead && st === 401 && upstreamHits === 0,
    'REQUIRE_CONFIG + missing file: random signer denied, upstream untouched', `status=${st} hits=${upstreamHits}`);

  // 3. required + allowlist
  const sk = rnd(); const pk = tools.getPublicKey(sk);
  k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1',
    NIP98_PROXY_CONFIG_FILE: file('allow.json', JSON.stringify({ routes: [], allowedPubkeys: [pk] })) });
  upstreamHits = 0;
  const a = await get(k.port, sign(k.port, sk)); const b = await get(k.port, sign(k.port, rnd()));
  ok(a === 200 && b === 401 && upstreamHits === 1, 'REQUIRE_CONFIG + allowlist: listed key 200, other key 401', `a=${a} b=${b}`);

  // 4. required + explicit empty allowlist
  k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1',
    NIP98_PROXY_CONFIG_FILE: file('empty.json', '{"routes":[],"allowedPubkeys":[]}') });
  ok((await get(k.port, sign(k.port, rnd()))) === 200, 'REQUIRE_CONFIG + explicit empty allowlist: any valid signer still allowed');

  // 5. file appears after start -> exit 0 (supervisor restarts it)
  const late = join(tmp, 'late.json');
  k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1', NIP98_PROXY_CONFIG_FILE: late, NIP98_PROXY_REQUIRE_CONFIG_POLL_MS: '200' });
  writeFileSync(late, JSON.stringify({ routes: [], allowedPubkeys: [pk] }));
  const code = await Promise.race([k.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
  ok(code === 0, 'REQUIRE_CONFIG: config file appearing makes the proxy exit 0 for a supervised restart', `exit=${code}`);

  // 6. required + malformed
  k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1', NIP98_PROXY_CONFIG_FILE: file('bad.json', '{nope') });
  ok((await Promise.race([k.exit, new Promise((r) => setTimeout(() => r('timeout'), 4000))])) === 1, 'REQUIRE_CONFIG + malformed file: exit 1');

  // 7. required + file present but unreadable (EACCES, e.g. a role uid): stays up
  //    and closed, does not exit-loop. Skipped when running as root.
  if (process.getuid && process.getuid() !== 0) {
    const locked = file('locked.json', '{"routes":[],"allowedPubkeys":[]}'); chmodSync(locked, 0o000);
    k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1', NIP98_PROXY_CONFIG_FILE: locked, NIP98_PROXY_REQUIRE_CONFIG_POLL_MS: '200' });
    await new Promise((r) => setTimeout(r, 1000));
    upstreamHits = 0;
    const s7 = k.dead || k.proc.exitCode !== null ? -1 : await get(k.port, sign(k.port, rnd()));
    ok(s7 === 401 && upstreamHits === 0, 'REQUIRE_CONFIG + unreadable file: stays up, closed (no exit-loop)', `status=${s7}`);
    chmodSync(locked, 0o600);
    ok((await Promise.race([k.exit, new Promise((r) => setTimeout(() => r('timeout'), 3000))])) === 0,
      'REQUIRE_CONFIG: file becoming readable triggers the supervised restart');
  } else console.log('ok - SKIP unreadable-file case (running as root)');

  // 8. stale file from an earlier boot is replaced by the Stage B projection
  const stale = join(tmp, 'stale.json');
  const oldPk = tools.getPublicKey(rnd());
  writeFileSync(stale, JSON.stringify({ routes: [], allowedPubkeys: [oldPk] }));
  k = await start({ NIP98_PROXY_REQUIRE_CONFIG: '1', NIP98_PROXY_CONFIG_FILE: stale, NIP98_PROXY_REQUIRE_CONFIG_POLL_MS: '200' });
  await new Promise((r) => setTimeout(r, 800));
  writeFileSync(stale, JSON.stringify({ routes: [], allowedPubkeys: [oldPk] })); // identical: no restart
  writeFileSync(stale, '{"routes":[],"allowed');                                 // half-written: no restart
  await new Promise((r) => setTimeout(r, 1200));
  ok(!k.dead && k.proc.exitCode === null, 'REQUIRE_CONFIG + loaded file: identical or half-written rewrite does not restart the proxy');
  writeFileSync(stale, JSON.stringify({ routes: [], allowedPubkeys: [pk] }));    // removed key / new allowlist
  const code8 = await Promise.race([k.exit, new Promise((r) => setTimeout(() => r('timeout'), 6000))]);
  ok(code8 === 0, 'REQUIRE_CONFIG + loaded file: changed content makes the proxy exit 0 for a supervised restart (NIP98-STALE-CONFIG)', `exit=${code8}`);
} finally {
  for (const k of kids) k.proc.kill('SIGKILL');
  upstream.close(); rmSync(tmp, { recursive: true, force: true });
}
console.log(`1..${pass + fail}\n# nip98-boot-failclosed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
