'use strict';

/**
 * Declared boundaries for the hash-chained events journal.
 *
 * A torn (half-written) line breaks the parse, so the verifier cannot read the
 * record, cannot check its hash, and cannot tell which record the next line
 * should link to. A `boundaries.json` kept beside the journal lets the owner
 * declare a specific torn line (file, 1-based line, SHA-256 of its exact
 * bytes). Everything here uses synthetic journals in a temporary directory.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auditChain = require('../../management-api/lib/audit-chain');

const { GENESIS_HASH, hashRecord, verifyFiles, verifyLines, loadBoundaries } = auditChain;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Build `count` chained records starting after `prevHash`/`startSeq`. */
function chain(count, prevHash = GENESIS_HASH, startSeq = 0) {
  const records = [];
  let prev = prevHash;
  for (let i = 0; i < count; i++) {
    const record = { ts: `2026-10-12T01:00:${String(i).padStart(2, '0')}Z`, kind: 'k', payload: { i }, seq: startSeq + i };
    record.prev_hash = prev;
    record.hash = hashRecord(prev, record);
    prev = record.hash;
    records.push(record);
  }
  return records;
}

const TORN = Buffer.from('{"ts":"2026-10-12T01:08:24Z","kind":"k","payl');

function entry(file, line, bytes, over = {}) {
  return {
    file, line, sha256: sha(bytes),
    reason: 'interrupted write; no tampering suspected but none can be excluded by the journal itself',
    recorded_at: '2026-11-16', recorded_by: 'owner (test)', ...over,
  };
}

function doc(entries, version = 1) {
  return { version, boundaries: entries };
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-boundaries-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Write a daily file from an array of strings/Buffers, joined by \n. */
function write(name, parts, { trailingNewline = true } = {}) {
  const bufs = parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8')));
  const body = Buffer.concat(bufs.flatMap((b, i) => (i < bufs.length - 1 || trailingNewline ? [b, Buffer.from('\n')] : [b])));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}
const J = (r) => JSON.stringify(r);

describe('boundaries :: the torn line without a matching entry still fails as before', () => {
  test('no boundaries file: unparseable line fails with the historical reason and index', () => {
    const [a, b, c] = chain(3);
    const f = write('2026-10-12.jsonl', [J(a), TORN, J(b), J(c)]);
    const r = verifyFiles([f]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unparseable line');
    expect(r.broken_at).toEqual({ file: '2026-10-12.jsonl', line: 1 }); // 0-based index, unchanged
    expect(r.checked).toBe(1);
    expect(r.summary).toMatch(/^FAILED/);
  });

  test('an entry whose bytes hash differs by one byte does not match', () => {
    const [a, b] = chain(2);
    const f = write('2026-10-12.jsonl', [J(a), TORN, J(b)]);
    const other = Buffer.concat([TORN, Buffer.from('x')]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, other)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unparseable line');
    expect(r.detail).toMatch(/declared for this line but its sha256 does not match/);
  });

  test('an off-by-one line number does not match (line is 1-based)', () => {
    const [a, b] = chain(2);
    const f = write('2026-10-12.jsonl', [J(a), TORN, J(b)]);
    for (const wrong of [1, 3]) {
      const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', wrong, TORN)]), complete: true });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('unparseable line');
    }
    const right = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, TORN)]), complete: true });
    expect(right.ok).toBe(true);
  });

  test('a boundary for another file does not excuse this one', () => {
    const [a, b] = chain(2);
    const f = write('2026-10-12.jsonl', [J(a), TORN, J(b)]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-13.jsonl', 2, TORN)]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unparseable line');
  });
});

describe('boundaries :: a declared torn line is accepted and reported', () => {
  test('reports "verified with N declared boundaries", lists them and the continuity caveat', () => {
    const recs = chain(4);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1]), TORN, J(recs[2]), J(recs[3])]);
    const e = entry('2026-10-12.jsonl', 3, TORN);
    const r = verifyFiles([f], { boundaries: doc([e]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('verified_with_boundaries');
    expect(r.summary).toBe('verified with 1 declared boundaries');
    expect(r.checked).toBe(4);
    expect(r.boundaries.declared).toBe(1);
    expect(r.boundaries.applied).toEqual([expect.objectContaining({ file: '2026-10-12.jsonl', line: 3, sha256: e.sha256, reason: e.reason, recorded_by: e.recorded_by })]);
    expect(r.continuity).toHaveLength(1);
    expect(r.continuity[0].link).toBe('direct'); // torn line never advanced the chain
    expect(r.continuity[0].statement).toMatch(/continuity across this boundary cannot be proved/i);
    expect(r.tail_hash).toBe(recs[3].hash);
    expect(r.tail_seq).toBe(3);
  });

  test('a journal with no boundaries reports plain "verified"', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1])]);
    const r = verifyFiles([f]);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('verified');
    expect(r.summary).toBe('verified');
    expect(r.boundaries.declared).toBe(0);
    expect(r.continuity).toEqual([]);
  });

  test('re-anchors on the next record\'s own stored prev_hash when a record was lost (gap)', () => {
    // seq 1 lived only in the torn line; seq 2 links to it, not to seq 0.
    const recs = chain(3);
    const f = write('2026-10-12.jsonl', [J(recs[0]), TORN, J(recs[2])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, TORN)]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.continuity[0].link).toBe('gap');
    expect(r.continuity[0].statement).toMatch(/continuity across this boundary cannot be proved/i);
    expect(r.continuity[0].resumed_at).toEqual({ file: '2026-10-12.jsonl', line: 3, seq: 2 });
  });

  test('records after the boundary are still checked: an altered one fails', () => {
    const recs = chain(4);
    const altered = { ...recs[3], payload: { i: 'tampered' } };
    const f = write('2026-10-12.jsonl', [J(recs[0]), TORN, J(recs[2]), J(altered)]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hash mismatch/);
  });

  test('the first record after a boundary must itself be internally valid', () => {
    const recs = chain(3);
    const altered = { ...recs[2], payload: { i: 'tampered' } };
    const f = write('2026-10-12.jsonl', [J(recs[0]), TORN, J(altered)]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hash mismatch/);
  });

  test('a record after a boundary with no valid stored prev_hash fails', () => {
    const recs = chain(3);
    const bad = { ...recs[2], prev_hash: 'not-a-hash' };
    const f = write('2026-10-12.jsonl', [J(recs[0]), TORN, J(bad)]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no valid stored prev_hash/);
  });

  test('hashes the exact raw bytes, including bytes that are not valid UTF-8', () => {
    const raw = Buffer.concat([Buffer.from('{"ts":"2026-10-12T01:08:24Z","kind":"k","p":"'), Buffer.from([0xe2, 0x82])]); // cut multibyte
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), raw, J(recs[1])]);
    const good = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, raw)]), complete: true });
    expect(good.ok).toBe(true);
    // The hash of the UTF-8 *decoded* string differs, so it must not be what is compared.
    const decodedHash = sha(Buffer.from(raw.toString('utf8')));
    expect(decodedHash).not.toBe(sha(raw));
    const bad = verifyFiles([f], { boundaries: doc([{ ...entry('2026-10-12.jsonl', 2, raw), sha256: decodedHash }]), complete: true });
    expect(bad.ok).toBe(false);
  });

  test('a fragment with a complete record fused onto it (the 2026-10-12 shape) is one boundary', () => {
    const recs = chain(4);
    const fused = Buffer.concat([TORN, Buffer.from(J(recs[1]))]);
    const f = write('2026-10-12.jsonl', [J(recs[0]), fused, J(recs[2]), J(recs[3])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, fused)]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.continuity[0].link).toBe('gap'); // seq 2 links to seq 1, which is unreadable
  });
});

describe('boundaries :: a torn tail at the end of a file', () => {
  test('re-anchors on the first record of the next file; line without trailing newline', () => {
    const recs = chain(4);
    const f1 = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1]), TORN], { trailingNewline: false });
    const f2 = write('2026-10-13.jsonl', [J(recs[2]), J(recs[3])]);
    const r = verifyFiles([f1, f2], { boundaries: doc([entry('2026-10-12.jsonl', 3, TORN)]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(4);
    expect(r.continuity[0].boundary).toEqual({ file: '2026-10-12.jsonl', line: 3 });
    expect(r.continuity[0].resumed_at).toEqual({ file: '2026-10-13.jsonl', line: 1, seq: 2 });
    expect(r.continuity[0].link).toBe('direct');
  });

  test('a differing prev_hash in the next file after a tail boundary is reported as a gap, not hidden', () => {
    const recs = chain(3);
    const other = chain(1, 'f'.repeat(64), 2)[0];
    const f1 = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1]), TORN], { trailingNewline: false });
    const f2 = write('2026-10-13.jsonl', [J(other)]);
    // After a boundary a differing prev_hash is the declared gap: accepted, but
    // reported with the caveat that continuity cannot be proved.
    const r = verifyFiles([f1, f2], { boundaries: doc([entry('2026-10-12.jsonl', 3, TORN)]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.continuity[0].link).toBe('gap');
  });

  test('a boundary on the final line of the journal is reported with nothing after it', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1]), TORN], { trailingNewline: false });
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 3, TORN)]), complete: true });
    expect(r.ok).toBe(true);
    expect(r.continuity[0].resumed_at).toBeNull();
    expect(r.continuity[0].statement).toMatch(/no record follows/);
  });
});

describe('boundaries :: entries that match nothing are errors', () => {
  test('an entry pointing at a line that parses is an error', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 2, Buffer.from(J(recs[1])))]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/declared boundary matches nothing: 2026-10-12\.jsonl line 2/);
    expect(r.boundaries.unused).toHaveLength(1);
  });

  test('an entry for a line past the end of the file is an error', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-12.jsonl', 99, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/matches nothing/);
  });

  test('an entry for a file that is not in a complete set is an error', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-09.jsonl', 2, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/matches nothing: 2026-10-09\.jsonl/);
  });

  test('a partial window (days=N) does not fail on entries for files outside it', () => {
    const recs = chain(2);
    const f = write('2026-10-12.jsonl', [J(recs[0]), J(recs[1])]);
    const r = verifyFiles([f], { boundaries: doc([entry('2026-10-09.jsonl', 2, TORN)]), complete: false });
    expect(r.ok).toBe(true);
    expect(r.boundaries.out_of_scope).toHaveLength(1);
  });

  test('when verification stops at an earlier break the unreached entries are not reported', () => {
    const recs = chain(3);
    const f1 = write('2026-10-12.jsonl', [J(recs[0]), '{broken']);
    const f2 = write('2026-10-13.jsonl', [J(recs[1])]);
    const r = verifyFiles([f1, f2], { boundaries: doc([entry('2026-10-13.jsonl', 1, TORN)]), complete: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unparseable line');
    expect(r.boundaries.unused).toEqual([]);
  });
});

describe('boundaries :: the boundaries file', () => {
  test('is read from beside the journal by default', () => {
    const recs = chain(3);
    const f = write('2026-10-12.jsonl', [J(recs[0]), TORN, J(recs[2])]);
    fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify(doc([entry('2026-10-12.jsonl', 2, TORN)])));
    const r = verifyFiles([f]);
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('verified with 1 declared boundaries');
  });

  test('boundaries.json is not itself a journal file', () => {
    // The route lists *.jsonl only; make that contract explicit.
    fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify(doc([])));
    expect(fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))).toEqual([]);
  });

  test.each([
    ['unknown version', doc([], 2), /version/],
    ['not an array', { version: 1, boundaries: {} }, /boundaries must be an array/],
    ['bad sha256', doc([{ ...entry('a.jsonl', 1, TORN), sha256: 'abc' }]), /sha256/],
    ['line 0', doc([{ ...entry('a.jsonl', 1, TORN), line: 0 }]), /line/],
    ['file with a path', doc([{ ...entry('a.jsonl', 1, TORN), file: '../a.jsonl' }]), /file/],
    ['missing reason', doc([{ ...entry('a.jsonl', 1, TORN), reason: '' }]), /reason/],
    ['missing recorded_by', doc([{ ...entry('a.jsonl', 1, TORN), recorded_by: undefined }]), /recorded_by/],
    ['duplicate file and line', doc([entry('a.jsonl', 1, TORN), entry('a.jsonl', 1, TORN)]), /duplicate/],
  ])('rejects %s', (_name, body, pattern) => {
    const p = path.join(dir, 'boundaries.json');
    fs.writeFileSync(p, JSON.stringify(body));
    const loaded = loadBoundaries(p);
    expect(loaded.ok).toBe(false);
    expect(loaded.error).toMatch(pattern);
    // and the verifier refuses to run with an invalid file rather than ignoring it
    const f = write('2026-10-12.jsonl', [J(chain(1)[0])]);
    const r = verifyFiles([f], { boundariesPath: p });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/boundaries file invalid/);
  });

  test('unparseable boundaries.json fails the verification', () => {
    const p = path.join(dir, 'boundaries.json');
    fs.writeFileSync(p, '{nope');
    const f = write('2026-10-12.jsonl', [J(chain(1)[0])]);
    const r = verifyFiles([f], { boundariesPath: p });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/boundaries file invalid/);
  });

  test('a missing boundaries file means no boundaries', () => {
    expect(loadBoundaries(path.join(dir, 'absent.json'))).toEqual({ ok: true, entries: [] });
  });
});

describe('boundaries :: verifyLines accepts raw Buffers', () => {
  test('hash is taken over the Buffer bytes, line numbers are 1-based', () => {
    const recs = chain(2);
    const lines = [Buffer.from(J(recs[0])), TORN, Buffer.from(J(recs[1]))];
    const r = verifyLines(lines, { fileName: 'x.jsonl', boundaries: [entry('x.jsonl', 2, TORN)] });
    expect(r.ok).toBe(true);
    expect(r.boundaries_applied).toHaveLength(1);
  });
});
