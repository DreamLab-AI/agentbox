'use strict';

/**
 * JOURNAL-LOCK: several PROCESSES appending to one events journal must keep a
 * single hash chain. Each LocalJsonlEventsAdapter caches the chain head, so
 * without a cross-process lock two writers both extend the same head and fork
 * `prev_hash`. These tests use real child processes (no mocks).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auditChain = require('../../management-api/lib/audit-chain');
const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');

const ADAPTER = path.resolve(__dirname, '../../management-api/adapters/events/local-jsonl');
const WRITER = `
  const { LocalJsonlEventsAdapter } = require(${JSON.stringify(ADAPTER)});
  const [dir, id, n] = process.argv.slice(1);
  const a = new LocalJsonlEventsAdapter({ eventsDir: dir });
  (async () => {
    for (let i = 0; i < Number(n); i++) {
      await a.dispatch({ kind: 'k', payload: { id, i, pad: 'x'.repeat(2000) } });
    }
  })().catch((e) => { console.error(e); process.exit(1); });
`;

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-lock-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const today = () => path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);

function run(id, n) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', WRITER, dir, String(id), String(n)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${id} exit ${code}: ${err}`))));
  });
}

describe('events journal :: cross-process lock', () => {
  test('N concurrent writer processes keep one linear chain with no lost line', async () => {
    const N = 6; const PER = 40;
    await Promise.all(Array.from({ length: N }, (_, i) => run(i, PER)));
    const lines = fs.readFileSync(today(), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(N * PER);
    const records = lines.map((l) => JSON.parse(l));
    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i));
    const r = auditChain.verifyFiles([today()]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(N * PER);
  }, 60000);

  test('a lock left by a dead process does not block the writer', async () => {
    const lock = path.join(dir, '.journal.lock');
    // pid 2^22+ is above any default pid_max, so it cannot be alive
    fs.writeFileSync(lock, JSON.stringify({ pid: 4194999, ts: Date.now() }));
    const a = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await a.dispatch({ kind: 'k1' });
    await a.dispatch({ kind: 'k2' });
    expect(auditChain.verifyFiles([today()]).ok).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  test('a second adapter instance in one process extends, not forks, the chain', async () => {
    const a = new LocalJsonlEventsAdapter({ eventsDir: dir });
    const b = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await a.dispatch({ kind: 'a1' });
    await b.dispatch({ kind: 'b1' });
    await a.dispatch({ kind: 'a2' });
    const r = auditChain.verifyFiles([today()]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(3);
  });

  test('a failed lock-body write leaves no lockfile and no chain advance', async () => {
    const a = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await a.dispatch({ kind: 'k1' });
    const real = fs.writeSync;
    const spy = jest.spyOn(fs, 'writeSync').mockImplementation(() => { const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await a.dispatch({ kind: 'lost' });
    spy.mockRestore();
    stderr.mockRestore();
    expect(real).toBe(fs.writeSync);
    expect(fs.existsSync(path.join(dir, '.journal.lock'))).toBe(false);
    await a.dispatch({ kind: 'k2' });
    const r = auditChain.verifyFiles([today()]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(2);
  });
});
