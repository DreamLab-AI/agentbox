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
