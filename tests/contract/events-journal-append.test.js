'use strict';

/**
 * The events journal writer: one complete record is one write call on an
 * O_APPEND descriptor, a torn tail never swallows the next record, and a short
 * write neither advances the chain nor leaves a fragment behind.
 *
 * Background (2026-10-12 incident): line 35 of that day's file is a torn
 * fragment with a complete record fused onto it, and line 64 is a truncated
 * tail. The fusing is the writer's doing: after a crash mid-write the restarted
 * process appended straight onto the unterminated fragment.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auditChain = require('../../management-api/lib/audit-chain');
const journalAppend = require('../../management-api/lib/journal-append');
const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-append-')); });
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const today = () => path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);

describe('journal-append :: appendLine', () => {
  test('appends one complete line', () => {
    const f = path.join(dir, 'a.jsonl');
    journalAppend.appendLine(f, '{"a":1}\n');
    journalAppend.appendLine(f, '{"a":2}\n');
    expect(fs.readFileSync(f, 'utf8')).toBe('{"a":1}\n{"a":2}\n');
  });

  test('a file ending in an unterminated fragment gets a newline in the SAME write', () => {
    const f = path.join(dir, 'a.jsonl');
    fs.writeFileSync(f, '{"a":1}\n{"ts":"2026-10-12T01:08:2');
    const spy = jest.spyOn(fs, 'writeSync');
    journalAppend.appendLine(f, '{"a":3}\n');
    expect(spy).toHaveBeenCalledTimes(1);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    expect(lines).toEqual(['{"a":1}', '{"ts":"2026-10-12T01:08:2', '{"a":3}', '']);
    expect(() => JSON.parse(lines[2])).not.toThrow();
  });

  test('a short write throws and removes the fragment it left', () => {
    const f = path.join(dir, 'a.jsonl');
    fs.writeFileSync(f, '{"a":1}\n');
    const real = fs.writeSync;
    jest.spyOn(fs, 'writeSync').mockImplementation((fd, buf, off, len, pos) => real(fd, buf, off, 5, pos));
    expect(() => journalAppend.appendLine(f, '{"a":2,"long":"record"}\n')).toThrow(/short write/);
    expect(fs.readFileSync(f, 'utf8')).toBe('{"a":1}\n');
  });

  test('rejects a line that is not newline-terminated or contains an inner newline', () => {
    const f = path.join(dir, 'a.jsonl');
    expect(() => journalAppend.appendLine(f, '{"a":1}')).toThrow(/newline/);
    expect(() => journalAppend.appendLine(f, '{"a":\n1}\n')).toThrow(/newline/);
  });

  test('concurrent processes appending large lines never interleave', async () => {
    const f = path.join(dir, 'c.jsonl');
    const worker = `
      const ja = require(${JSON.stringify(path.resolve(__dirname, '../../management-api/lib/journal-append'))});
      const id = process.argv[1]; const f = process.argv[2];
      for (let i = 0; i < 60; i++) ja.appendLine(f, JSON.stringify({ id, i, pad: id.repeat(9000) }) + '\\n');
    `;
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', worker, id, f], { stdio: 'inherit' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${id} exited ${code}`))));
    })));
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(ids.length * 60);
    const seen = new Map();
    for (const line of lines) {
      const rec = JSON.parse(line); // throws on any interleaved/torn line
      expect(rec.pad).toBe(rec.id.repeat(9000));
      seen.set(rec.id, (seen.get(rec.id) || 0) + 1);
    }
    for (const id of ids) expect(seen.get(id)).toBe(60);
  });
});

describe('local-jsonl adapter :: writer behaviour', () => {
  test('after a crash left a torn tail, the next record lands on its own line and parses', async () => {
    const a1 = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await a1.dispatch({ kind: 'k1' });
    await a1.dispatch({ kind: 'k2' });
    fs.appendFileSync(today(), '{"ts":"2026-10-12T01:08:24Z","session_id":null,"kind":"torn","paylo'); // crash mid-write
    const a2 = new LocalJsonlEventsAdapter({ eventsDir: dir }); // restart: resumes from the last good record
    await a2.dispatch({ kind: 'k3' });
    await a2.dispatch({ kind: 'k4' });
    const lines = fs.readFileSync(today(), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(5);
    expect(() => JSON.parse(lines[2])).toThrow(); // the torn fragment stays a line of its own
    expect(JSON.parse(lines[3]).kind).toBe('k3');
    expect(JSON.parse(lines[4]).kind).toBe('k4');
    // and the verifier needs exactly one declared boundary, for the fragment alone
    const fail = auditChain.verifyFiles([today()]);
    expect(fail.ok).toBe(false);
    expect(fail.broken_at.line).toBe(2);
  });

  test('a failed append does not advance the chain and leaves no fragment', async () => {
    const adapter = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await adapter.dispatch({ kind: 'k1' });
    const real = fs.writeSync;
    const spy = jest.spyOn(fs, 'writeSync').mockImplementation((fd, buf, off, len, pos) => real(fd, buf, off, 7, pos));
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await adapter.dispatch({ kind: 'lost' });
    spy.mockRestore();
    stderr.mockRestore();
    await adapter.dispatch({ kind: 'k2' });
    const r = auditChain.verifyFiles([today()]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(2);
    expect(fs.readFileSync(today(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).kind)).toEqual(['k1', 'k2']);
  });

  test('concurrent in-process dispatches keep one intact chain', async () => {
    const adapter = new LocalJsonlEventsAdapter({ eventsDir: dir });
    await Promise.all(Array.from({ length: 80 }, (_, i) => adapter.dispatch({ kind: 'k', payload: { i, pad: 'x'.repeat(6000) } })));
    const r = auditChain.verifyFiles([today()]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(80);
  });
});

