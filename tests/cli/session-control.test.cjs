const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

test('voice control forwards fleet reads and pins every send to tab0', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-control-'));
  const socket = path.join(dir, 'sessions.sock');
  const requests = [];
  const server = net.createServer(s => {
    s.once('data', raw => {
      requests.push(JSON.parse(raw));
      s.end('{"ok":true,"sessions":[]}\n');
    });
  });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const cli = path.resolve(__dirname, '../../scripts/session-control.cjs');
  const run = args => execFile(process.execPath, [cli, ...args], { env: { ...process.env, AGENTBOX_SESSIONS_SOCKET: socket } });
  await run(['list']);
  await run(['send', 'quoted "text" with a newline\nand shell $() text']);
  assert.deepEqual(requests, [
    { op: 'list' },
    { op: 'send', slug: 'tab0', text: 'quoted "text" with a newline\nand shell $() text' },
  ]);
  await assert.rejects(run(['create', 'foreign']));
  await assert.rejects(run(['send', 'prompt', 'foreign']));
  assert.equal(requests.length, 2, 'unsupported operations never reach the daemon');
});
