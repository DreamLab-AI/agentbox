'use strict';

/**
 * ADR-039 §D3 — hash-chained events log.
 *
 * Covers the pure chain lib (lib/audit-chain.js) and the local-jsonl events
 * adapter's chain production: tamper detection (edit / splice / reorder),
 * legacy-prefix tolerance, restart resume from the on-disk tail, and
 * cross-file threading.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const auditChain = require('../../management-api/lib/audit-chain');
const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');

const { GENESIS_HASH, canonical, hashRecord, verifyLines, verifyFiles } = auditChain;

describe('audit-chain :: canonicalisation', () => {
  test('is invariant under key order at every depth', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(canonical(a)).toBe(canonical(b));
  });

  test('preserves array order (reorder is a content change)', () => {
    expect(canonical({ a: [1, 2] })).not.toBe(canonical({ a: [2, 1] }));
  });

  test('hashRecord ignores the chain fields themselves', () => {
    const record = { kind: 'x', payload: { n: 1 } };
    const withChain = { ...record, prev_hash: GENESIS_HASH, hash: 'deadbeef' };
    expect(hashRecord(GENESIS_HASH, record)).toBe(hashRecord(GENESIS_HASH, withChain));
  });
});

function makeChainedLines(count) {
  const lines = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 0; seq < count; seq++) {
    const record = { ts: `2026-07-19T00:00:0${seq}Z`, kind: `k${seq}`, payload: { seq }, seq };
    record.prev_hash = prevHash;
    record.hash = hashRecord(prevHash, record);
    prevHash = record.hash;
    lines.push(JSON.stringify(record));
  }
  return lines;
}

describe('audit-chain :: verifyLines', () => {
  test('accepts a valid chain and reports the tail', () => {
    const lines = makeChainedLines(4);
    const result = verifyLines(lines);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.tail_hash).toBe(JSON.parse(lines[3]).hash);
    expect(result.tail_seq).toBe(3);
  });

  test('detects an edited record (hash mismatch)', () => {
    const lines = makeChainedLines(4);
    const tampered = JSON.parse(lines[2]);
    tampered.payload.seq = 999;
    lines[2] = JSON.stringify(tampered);
    const result = verifyLines(lines);
    expect(result.ok).toBe(false);
    expect(result.broken_at).toBe(2);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  test('detects a spliced-out record (prev_hash mismatch)', () => {
    const lines = makeChainedLines(4);
    lines.splice(1, 1); // remove record 1
    const result = verifyLines(lines);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/prev_hash mismatch/);
  });

  test('detects reordering', () => {
    const lines = makeChainedLines(4);
    [lines[1], lines[2]] = [lines[2], lines[1]];
    const result = verifyLines(lines);
    expect(result.ok).toBe(false);
    expect(result.broken_at).toBe(1);
  });

  test('tolerates a legacy (pre-chain) prefix, but not legacy after chain start', () => {
    const legacy = JSON.stringify({ ts: '2026-01-01T00:00:00Z', kind: 'old', payload: {} });
    const chained = makeChainedLines(2);

    const okResult = verifyLines([legacy, ...chained]);
    expect(okResult.ok).toBe(true);
    expect(okResult.legacy_prefix).toBe(1);
    expect(okResult.checked).toBe(2);

    const badResult = verifyLines([...chained, legacy]);
    expect(badResult.ok).toBe(false);
    expect(badResult.reason).toMatch(/unchained record after chain start/);
  });
});

describe('events :: local-jsonl chain production', () => {
  test('dispatch chains records from genesis (injected appendFn)', async () => {
    const written = [];
    const adapter = new LocalJsonlEventsAdapter({ appendFn: (_f, line) => written.push(line) });
    await adapter.dispatch({ kind: 'a', payload: { i: 1 } });
    await adapter.dispatch({ kind: 'b', payload: { i: 2 } });
    await adapter.dispatch({ kind: 'c' });

    const records = written.map((l) => JSON.parse(l));
    expect(records[0].prev_hash).toBe(GENESIS_HASH);
    expect(records[0].seq).toBe(0);
    expect(records[1].prev_hash).toBe(records[0].hash);
    expect(records[2].prev_hash).toBe(records[1].hash);
    expect(records[2].seq).toBe(2);

    const result = verifyLines(written.map((l) => l.trim()));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
  });

  test('resumes the chain from the on-disk tail across adapter restarts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-chain-'));
    try {
      const first = new LocalJsonlEventsAdapter({ eventsDir: dir });
      await first.dispatch({ kind: 'boot', payload: { n: 1 } });
      await first.dispatch({ kind: 'work', payload: { n: 2 } });

      // Restart: a fresh adapter instance over the same directory.
      const second = new LocalJsonlEventsAdapter({ eventsDir: dir });
      await second.dispatch({ kind: 'after-restart', payload: { n: 3 } });

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
        .map((f) => path.join(dir, f));
      const result = verifyFiles(files);
      expect(result.ok).toBe(true);
      expect(result.checked).toBe(3);
      expect(result.legacy_prefix).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('starts a fresh chain after a legacy (pre-ADR-039) tail', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-legacy-'));
    try {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(
        path.join(dir, `${today}.jsonl`),
        JSON.stringify({ ts: '2026-01-01T00:00:00Z', kind: 'legacy', payload: {} }) + '\n',
        'utf8'
      );
      const adapter = new LocalJsonlEventsAdapter({ eventsDir: dir });
      await adapter.dispatch({ kind: 'first-chained' });

      const result = verifyFiles([path.join(dir, `${today}.jsonl`)]);
      expect(result.ok).toBe(true);
      expect(result.legacy_prefix).toBe(1);
      expect(result.checked).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
