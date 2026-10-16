'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { start } = require('./fake-blender');

const JOB = path.join(__dirname, '..', 'blender-job.js');
const INTRO = path.join(__dirname, '..', 'blender-introspect.js');

function tmp() { return fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bjt-')); }
function run(script, args, env, ms = 40000) {
  return new Promise((resolve) => {
    const p = spawn('node', [script, ...args], { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}
const envFor = (share, port) => ({ BLENDER_LOCAL_SHARE: share, BLENDER_REMOTE_SHARE: '/remote/share', BLENDER_HOST: '127.0.0.1', BLENDER_PORT: String(port) });
function script() { const d = tmp(); const f = path.join(d, 's.py'); fs.writeFileSync(f, 'print(1)\n'); return f; }

test('S3 submit: sidecar accepts then closes -> exit 2, no job dir, retry with same name works', async () => {
  const share = tmp(); const s = script();
  const bad = await start('close');
  const r = await run(JOB, ['submit', s, '--name', 'retry1'], envFor(share, bad.port));
  await bad.close();
  assert.strictEqual(r.code, 2, r.err);
  assert.ok(!fs.existsSync(path.join(share, 'jobs', 'retry1')), 'job dir must not survive an unreachable sidecar');
  const good = await start('ok');
  const r2 = await run(JOB, ['submit', s, '--name', 'retry1'], envFor(share, good.port));
  await good.close();
  assert.strictEqual(r2.code, 0, r2.err);
  assert.ok(fs.existsSync(path.join(share, 'jobs', 'retry1', 'job.json')));
});

test('S3 introspect: accept-then-close -> 2, partial -> 3', async () => {
  const a = await start('close');
  const r = await run(INTRO, ['version'], { BLENDER_HOST: '127.0.0.1', BLENDER_PORT: String(a.port) });
  await a.close();
  assert.strictEqual(r.code, 2, r.err);
  const b = await start('partial');
  const r2 = await run(INTRO, ['version'], { BLENDER_HOST: '127.0.0.1', BLENDER_PORT: String(b.port) });
  await b.close();
  assert.strictEqual(r2.code, 3, r2.err);
});

test('S3 job tool: partial reply is exit 3, empty close is exit 2 (probe via a running-looking job)', async () => {
  const share = tmp();
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  plant(share, 'p1', `${victim.pid} ${startTime(victim.pid)}`);
  const f = await start('partial');
  const r = await run(JOB, ['status', 'p1'], envFor(share, f.port));
  await f.close();
  assert.strictEqual(r.code, 3, r.err);
  const g = await start('close');
  const r2 = await run(JOB, ['status', 'p1'], envFor(share, g.port));
  await g.close();
  assert.strictEqual(r2.code, 2, r2.err);
  victim.kill('SIGKILL');
});

test('S5 stage refuses symlinks in the source tree', async () => {
  const share = tmp(); const src = tmp();
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  fs.symlinkSync('/etc/passwd', path.join(src, 'evil'));
  const r = await run(JOB, ['stage', src, 'tree'], envFor(share, 1));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /symlink/i);
  assert.ok(!fs.existsSync(path.join(share, 'tree', 'evil')));
});

test('S5 stage refuses a planted destination symlink and does not write through it', async () => {
  const share = tmp(); const src = tmp(); const outside = tmp();
  fs.writeFileSync(path.join(src, 'f.txt'), 'payload');
  fs.symlinkSync(outside, path.join(share, 'x'));
  const r = await run(JOB, ['stage', path.join(src, 'f.txt'), 'x/f.txt'], envFor(share, 1));
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
  fs.writeFileSync(path.join(outside, 'target'), 'keep');
  fs.symlinkSync(path.join(outside, 'target'), path.join(share, 'leaf.txt'));
  const r2 = await run(JOB, ['stage', path.join(src, 'f.txt'), 'leaf.txt'], envFor(share, 1));
  assert.strictEqual(r2.code, 1);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'target'), 'utf8'), 'keep');
});

test('S5 stage: a link loop in the source terminates with an error', async () => {
  const share = tmp(); const src = tmp();
  fs.mkdirSync(path.join(src, 'd'));
  fs.symlinkSync(src, path.join(src, 'd', 'loop'));
  const r = await run(JOB, ['stage', src, 'loopy'], envFor(share, 1), 20000);
  assert.strictEqual(r.code, 1);
});

test('S5 stage: a plain tree still copies, and rerun skips unchanged', async () => {
  const share = tmp(); const src = tmp();
  fs.mkdirSync(path.join(src, 'sub')); fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');
  const r = await run(JOB, ['stage', src, 'ok'], envFor(share, 1));
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(fs.readFileSync(path.join(share, 'ok', 'sub', 'b.txt'), 'utf8'), 'b');
  const r2 = await run(JOB, ['stage', src, 'ok'], envFor(share, 1));
  assert.match(r2.out, /staged 0 file/);
});

test('NIT stage "." needs an explicit destination; a..b is a legal name', async () => {
  const share = tmp(); const src = tmp();
  fs.writeFileSync(path.join(src, 'a..b'), 'x');
  const r = await run(JOB, ['stage', '.'], envFor(share, 1));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /explicit|destination/i);
  const r2 = await run(JOB, ['stage', path.join(src, 'a..b')], envFor(share, 1));
  assert.strictEqual(r2.code, 0, r2.err);
});

test('S5 tail does not read job.log through a symlink', async () => {
  const share = tmp(); const secretDir = tmp();
  const secret = path.join(secretDir, 'secret'); fs.writeFileSync(secret, 'TOP-SECRET-VALUE\n');
  fs.mkdirSync(path.join(share, 'jobs', 'j1'), { recursive: true });
  fs.symlinkSync(secret, path.join(share, 'jobs', 'j1', 'job.log'));
  const r = await run(JOB, ['tail', 'j1'], envFor(share, 1));
  assert.notStrictEqual(r.code, 0);
  assert.ok(!r.out.includes('TOP-SECRET'));
});

test('NIT tail returns the last N lines and tolerates a bad line count', async () => {
  const share = tmp();
  fs.mkdirSync(path.join(share, 'jobs', 'j2'), { recursive: true });
  fs.writeFileSync(path.join(share, 'jobs', 'j2', 'job.log'), Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n') + '\n');
  const r = await run(JOB, ['tail', 'j2', '3'], envFor(share, 1));
  assert.strictEqual(r.out.trim().split('\n').length, 3);
  assert.match(r.out, /line99/);
  const r2 = await run(JOB, ['tail', 'j2', 'abc'], envFor(share, 1));
  assert.ok(r2.out.trim().split('\n').length <= 41);
});

// --- S6 PID reuse ---------------------------------------------------------------------------
function startTime(pid) {
  const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  return s.slice(s.lastIndexOf(')') + 2).split(' ')[19];
}
function plant(share, id, pidLine) {
  const d = path.join(share, 'jobs', id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'job.json'), '{}'); fs.writeFileSync(path.join(d, 'pid'), pidLine);
}

test('S6 status: stale record whose pid now belongs to another process is "lost", not "running"', async () => {
  const share = tmp(); const f = await start('ok');
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  plant(share, 'stale', `${victim.pid} 1`); // wrong start time
  const r = await run(JOB, ['status', 'stale'], envFor(share, f.port));
  assert.match(r.out, /"lost"/);
  assert.strictEqual(r.code, 1);
  plant(share, 'live', `${victim.pid} ${startTime(victim.pid)}`);
  const r2 = await run(JOB, ['status', 'live'], envFor(share, f.port));
  assert.match(r2.out, /"running"/);
  victim.kill('SIGKILL'); await f.close();
});

test('S6 cancel refuses a stale record and leaves the unrelated process alive; kills a verified one', async () => {
  const share = tmp(); const f = await start('ok');
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  plant(share, 'stale', `${victim.pid} 1`);
  const r = await run(JOB, ['cancel', 'stale'], envFor(share, f.port));
  assert.strictEqual(r.code, 1);
  assert.doesNotThrow(() => process.kill(victim.pid, 0), 'victim must survive');
  plant(share, 'live', `${victim.pid} ${startTime(victim.pid)}`);
  const r2 = await run(JOB, ['cancel', 'live'], envFor(share, f.port));
  assert.strictEqual(r2.code, 0, r2.err);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(victim.exitCode !== null || victim.signalCode !== null, 'verified process should have been terminated');
  assert.ok(fs.existsSync(path.join(share, 'jobs', 'live', 'cancelled')));
  await f.close();
});

test('S6 legacy pid file without a start token is not trusted', async () => {
  const share = tmp(); const f = await start('ok');
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  plant(share, 'old', `${victim.pid}`);
  const r = await run(JOB, ['cancel', 'old'], envFor(share, f.port));
  assert.strictEqual(r.code, 1);
  assert.doesNotThrow(() => process.kill(victim.pid, 0));
  victim.kill('SIGKILL'); await f.close();
});

// --- S7 wait --------------------------------------------------------------------------------
test('S7 wait tolerates transient probe failures and returns the job exit code', async () => {
  const share = tmp(); const f = await start('flaky', { failFirst: 2 });
  const victim = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  plant(share, 'w1', `${victim.pid} ${startTime(victim.pid)}`);
  const d = path.join(share, 'jobs', 'w1');
  setTimeout(() => fs.writeFileSync(path.join(d, 'exit_code'), '7\n'), 1500);
  const r = await run(JOB, ['wait', 'w1', '--timeout', '30'], { ...envFor(share, f.port), BLENDER_WAIT_POLL_MS: '200' });
  assert.strictEqual(r.code, 7, r.err + r.out);
  victim.kill('SIGKILL'); await f.close();
});

test('S7 wait gives up after bounded consecutive probe failures', async () => {
  const share = tmp(); const f = await start('close');
  plant(share, 'w2', '12345 1');
  const r = await run(JOB, ['wait', 'w2', '--timeout', '60'], { ...envFor(share, f.port), BLENDER_WAIT_POLL_MS: '50' });
  assert.strictEqual(r.code, 2, r.err + r.out);
  await f.close();
});

test('S7 wait --timeout validation', async () => {
  const share = tmp();
  fs.mkdirSync(path.join(share, 'jobs', 'w3'), { recursive: true });
  const r = await run(JOB, ['wait', 'w3', '--timeout', 'abc'], envFor(share, 1));
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /timeout/i);
  const r2 = await run(JOB, ['wait', 'w3', '--timeout'], envFor(share, 1));
  assert.strictEqual(r2.code, 1);
});

test('S7 wait on a done job exits 0', async () => {
  const share = tmp();
  const d = path.join(share, 'jobs', 'w4'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'exit_code'), '0\n');
  const r = await run(JOB, ['wait', 'w4'], envFor(share, 1));
  assert.strictEqual(r.code, 0);
});

// --- launch script (stub bpy) ---------------------------------------------------------------
test('S6/S7 launch script records "pid starttime" and writes exit_code atomically', async () => {
  const { launchPython } = require('../blender-job.js');
  const stub = tmp(); fs.writeFileSync(path.join(stub, 'bpy.py'), 'class app:\n    binary_path = "/bin/sh"\n');
  const d = tmp();
  const code = launchPython('t', { dir: d, share: '/s', script: '-c', blend: null, cpu: false, args: ['exit 5'] });
  const p = spawnSync('python3', ['-c', code], { env: { ...process.env, PYTHONPATH: stub }, encoding: 'utf8' });
  assert.strictEqual(p.status, 0, p.stderr);
  const rec = fs.readFileSync(path.join(d, 'pid'), 'utf8').trim().split(/\s+/);
  assert.strictEqual(rec.length, 2); assert.match(rec[0], /^\d+$/); assert.match(rec[1], /^\d+$/);
  for (let i = 0; i < 50 && !fs.existsSync(path.join(d, 'exit_code')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(path.join(d, 'exit_code')));
  assert.ok(!fs.existsSync(path.join(d, 'exit_code.tmp')));
  assert.match(fs.readFileSync(path.join(d, 'exit_code'), 'utf8'), /^\d+\n?$/);
});
