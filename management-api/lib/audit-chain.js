'use strict';

/**
 * audit-chain — tamper-evident hash chaining for the events JSONL log.
 *
 * hash = SHA256(prev_hash ‖ canonical_json(record − {prev_hash, hash}))
 *
 * Canonicalisation is a deep key-sort at every object depth (array order
 * preserved) so a key-order reserialise never reads as tampering. The chain
 * makes three tamper modes detectable when the log is verified:
 *   - edit      → the record's own hash no longer matches its content
 *   - splice    → a record's prev_hash does not match its predecessor
 *   - reorder   → equivalent to a splice at the first moved record
 * Deletion at the tail is the one mode a bare chain cannot see; the tail
 * hash returned by verification is the anchor to publish elsewhere for that
 * (ADR-039 leaves off-box anchoring to the nostr mesh as a follow-up).
 *
 * Records written before ADR-039 carry no chain fields. Verification
 * tolerates them only as a contiguous prefix (`legacy_prefix`); once a
 * chained record has been seen, a later unchained record is a break.
 *
 * Declared boundaries. A torn (half-written) line cannot be parsed, so the
 * record in it cannot be hash-checked and the chain cannot be followed through
 * it. The owner may declare such a line in `boundaries.json` beside the journal:
 * `{"version": 1, "boundaries": [{file, line (1-based), sha256 (of the line's
 * exact bytes, newline excluded), reason, recorded_at, recorded_by, note?}]}`.
 * The verifier accepts an unparseable line ONLY on an exact file + line + hash
 * match, reports "verified with N declared boundaries", resumes at the next
 * record on its own stored prev_hash, and says plainly that continuity across
 * the boundary cannot be proved. An entry that matches nothing is an error.
 * Boundaries declare an accident; they are not a repair and not a signature.
 *
 * Pure node:crypto — no dependencies. Back-ported from DreamLab-AI/docBox
 * `server/src/audit/chain.ts` (its PRD-006), adapted to the agentbox events
 * record shape and daily-rotated files.
 *
 * @see ADR-039 §D3
 * @see ADR-005 §events slot
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GENESIS_HASH = '0'.repeat(64);
const CHAIN_FIELDS = ['prev_hash', 'hash'];

/** Deep key-sort: objects get sorted keys at every depth, arrays keep order. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

/** Canonical JSON of a value (deterministic across key insertion order). */
function canonical(value) {
  return JSON.stringify(sortDeep(value));
}

/** Strip the chain fields so a record hashes over its content only. */
function contentOf(record) {
  const out = {};
  for (const key of Object.keys(record)) {
    if (!CHAIN_FIELDS.includes(key)) out[key] = record[key];
  }
  return out;
}

/**
 * Hash a record into the chain.
 * @param {string} prevHash - 64-hex hash of the predecessor (or GENESIS_HASH)
 * @param {object} record   - record WITHOUT (or ignoring) prev_hash/hash
 * @returns {string} 64-hex SHA-256
 */
function hashRecord(prevHash, record) {
  return crypto.createHash('sha256')
    .update(prevHash + canonical(contentOf(record)))
    .digest('hex');
}

const HEX64 = /^[0-9a-f]{64}$/;
const BOUNDARIES_VERSION = 1;
const BOUNDARIES_FILE = 'boundaries.json';

/**
 * Validate and read a boundaries document (see "Declared boundaries" in the
 * file header). Pure: takes the parsed JSON.
 * @returns {{ok: true, entries: object[]} | {ok: false, error: string}}
 */
function parseBoundaries(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'not a JSON object' };
  if (doc.version !== BOUNDARIES_VERSION) return { ok: false, error: `unsupported version ${JSON.stringify(doc.version)} (this verifier reads version ${BOUNDARIES_VERSION})` };
  if (!Array.isArray(doc.boundaries)) return { ok: false, error: 'boundaries must be an array' };
  const seen = new Set();
  for (const [i, e] of doc.boundaries.entries()) {
    const at = `boundaries[${i}]`;
    if (!e || typeof e !== 'object') return { ok: false, error: `${at} is not an object` };
    if (typeof e.file !== 'string' || !/^[^/\\]+$/.test(e.file) || e.file === '.' || e.file === '..') return { ok: false, error: `${at}.file must be a bare file name` };
    if (!Number.isInteger(e.line) || e.line < 1) return { ok: false, error: `${at}.line must be an integer >= 1 (1-based file line)` };
    if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) return { ok: false, error: `${at}.sha256 must be 64 lowercase hex characters` };
    for (const k of ['reason', 'recorded_at', 'recorded_by']) {
      if (typeof e[k] !== 'string' || e[k].trim() === '') return { ok: false, error: `${at}.${k} must be a non-empty string` };
    }
    const key = `${e.file}#${e.line}`;
    if (seen.has(key)) return { ok: false, error: `duplicate entry for ${e.file} line ${e.line}` };
    seen.add(key);
  }
  return { ok: true, entries: doc.boundaries };
}

/**
 * Read a boundaries file. A missing file means "no boundaries"; an unreadable
 * or invalid one is an error (never silently ignored: an ignored file would
 * quietly turn a declared boundary back into a failure, or worse, hide a typo).
 * @param {string} filePath
 * @returns {{ok: true, entries: object[]} | {ok: false, error: string}}
 */
function loadBoundaries(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, entries: [] };
    return { ok: false, error: `unreadable: ${err.message}` };
  }
  let doc;
  try { doc = JSON.parse(text); } catch (err) { return { ok: false, error: `not valid JSON: ${err.message}` }; }
  return parseBoundaries(doc);
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Verify a sequence of JSONL lines as one chain segment.
 *
 * @param {Array<string|Buffer>} lines - raw JSONL lines (blank lines ignored).
 *   Pass Buffers when a declared boundary must be matched: its SHA-256 is taken
 *   over the exact bytes of the line, with no trimming or UTF-8 round trip.
 * @param {object} [opts]
 * @param {string}  [opts.expectedPrev] - hash the first chained record must
 *   link to (threads the chain across rotated files). Default: accept either
 *   GENESIS_HASH or whatever the first record claims IF this is the first
 *   segment (expectedPrev === undefined means "start of chain": genesis only).
 * @param {boolean} [opts.allowLegacyPrefix=true] - tolerate leading records
 *   with no chain fields (pre-ADR-039 log content).
 * @param {string}  [opts.fileName] - name used in boundary matching and reports.
 * @param {object[]} [opts.boundaries] - declared boundaries (validated entries).
 *   An unparseable line is accepted ONLY if an entry has this file name, this
 *   1-based line number and the SHA-256 of the line's exact bytes.
 * @param {{file: string, line: number}} [opts.pending] - a boundary declared at
 *   the end of the previous file, still waiting for its next record.
 * @returns {{ ok: boolean, checked: number, legacy_prefix: number,
 *             broken_at: number|null, reason: string|null,
 *             tail_hash: string, tail_seq: number|null,
 *             boundaries_applied: object[], continuity: object[],
 *             pending: object|null, detail?: string }}
 */
function verifyLines(lines, opts = {}) {
  const allowLegacyPrefix = opts.allowLegacyPrefix !== false;
  const fileName = opts.fileName || null;
  const declared = Array.isArray(opts.boundaries) ? opts.boundaries : [];
  let prevHash = opts.expectedPrev !== undefined ? opts.expectedPrev : GENESIS_HASH;
  let chainStarted = opts.expectedPrev !== undefined && opts.expectedPrev !== GENESIS_HASH;
  let checked = 0;
  let legacyPrefix = 0;
  let tailSeq = null;
  let pending = opts.pending || null; // a boundary awaiting the next chained record
  const applied = [];
  const continuity = [];

  const fail = (index, reason, detail) => ({
    ok: false, checked, legacy_prefix: legacyPrefix,
    broken_at: index, reason, tail_hash: prevHash, tail_seq: tailSeq,
    boundaries_applied: applied, continuity, pending,
    ...(detail ? { detail } : {}),
  });

  for (let i = 0; i < lines.length; i++) {
    const raw = Buffer.isBuffer(lines[i]) ? lines[i] : Buffer.from(lines[i], 'utf8');
    const line = raw.toString('utf8').trim();
    if (!line) continue;

    let record;
    try {
      record = JSON.parse(line);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('not a record');
    } catch (_) {
      const lineNo = i + 1;
      const atPosition = declared.filter((b) => b.file === fileName && b.line === lineNo);
      const digest = atPosition.length ? sha256Hex(raw) : null;
      const match = atPosition.find((b) => b.sha256 === digest);
      if (!match) {
        return fail(i, 'unparseable line', atPosition.length
          ? `a boundary is declared for this line but its sha256 does not match the line's bytes (${digest})`
          : null);
      }
      applied.push({ file: fileName, line: lineNo, sha256: match.sha256, reason: match.reason, recorded_at: match.recorded_at, recorded_by: match.recorded_by, ...(match.note ? { note: match.note } : {}) });
      // A later boundary before any record resumes keeps the earliest pending one.
      if (!pending) pending = { file: fileName, line: lineNo, last_verified_hash: prevHash };
      continue;
    }

    if (record.hash === undefined && record.prev_hash === undefined) {
      if (chainStarted) return fail(i, 'unchained record after chain start');
      if (!allowLegacyPrefix) return fail(i, 'unchained record');
      legacyPrefix += 1;
      continue;
    }

    if (pending) {
      // Re-anchor on the record's OWN stored prev_hash. Its content hash is
      // still checked below, so the record cannot be altered; what cannot be
      // proved is what sat between it and the last record verified before the
      // boundary.
      if (typeof record.prev_hash !== 'string' || !HEX64.test(record.prev_hash)) {
        return fail(i, 'record after a declared boundary has no valid stored prev_hash');
      }
      const link = record.prev_hash === pending.last_verified_hash ? 'direct' : 'gap';
      continuity.push({
        boundary: { file: pending.file, line: pending.line },
        resumed_at: { file: fileName, line: i + 1, seq: typeof record.seq === 'number' ? record.seq : null },
        link,
        statement: link === 'direct'
          ? 'The next record links directly to the last record verified before the boundary, so no chained record sits between them. The unparseable line itself cannot be verified, and continuity across this boundary cannot be proved from the journal alone.'
          : 'The next record\'s stored prev_hash differs from the last record verified before the boundary: at least one record between them is unreadable. Continuity across this boundary cannot be proved; checking resumes from the next record\'s own stored prev_hash.',
      });
      prevHash = record.prev_hash;
      pending = null;
    }

    if (record.prev_hash !== prevHash) {
      return fail(i, `prev_hash mismatch (expected ${prevHash})`);
    }
    const expected = hashRecord(prevHash, record);
    if (record.hash !== expected) {
      return fail(i, 'hash mismatch (record content altered)');
    }

    chainStarted = true;
    prevHash = record.hash;
    tailSeq = typeof record.seq === 'number' ? record.seq : tailSeq;
    checked += 1;
  }

  return {
    ok: true, checked, legacy_prefix: legacyPrefix,
    broken_at: null, reason: null, tail_hash: prevHash, tail_seq: tailSeq,
    boundaries_applied: applied, continuity, pending,
  };
}

/** Split a Buffer on 0x0A into line Buffers (a final unterminated line is kept). */
function splitLines(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { out.push(buf.subarray(start, i)); start = i + 1; }
  }
  out.push(buf.subarray(start));
  return out;
}

/**
 * Verify a set of JSONL files as one continuous chain, in the given order
 * (callers pass daily files sorted by name — YYYY-MM-DD sorts correctly).
 *
 * Declared boundaries are read from `boundaries.json` beside the first file
 * (or `opts.boundariesPath`, or passed whole as `opts.boundaries`).
 *
 * @param {string[]} filePaths
 * @param {object} [opts]
 * @param {string} [opts.boundariesPath] - boundaries file (default: beside the journal)
 * @param {object} [opts.boundaries] - an already-parsed boundaries document (tests)
 * @param {boolean} [opts.complete=false] - true when filePaths is the WHOLE journal.
 *   Then an entry for a file that is not in the set is an error; otherwise (a
 *   `?days=N` window) such entries are listed as `out_of_scope` and ignored.
 * @returns {{ ok, status, summary, files, checked, legacy_prefix,
 *             broken_at: {file, line}|null, reason, tail_hash, tail_seq,
 *             boundaries: {declared, applied, unused, out_of_scope},
 *             continuity }}
 */
function verifyFiles(filePaths, opts = {}) {
  let expectedPrev; // undefined = start of chain (genesis)
  let checked = 0;
  let legacyPrefix = 0;
  let pending = null;
  let tailSeq = null;
  const applied = [];
  const continuity = [];

  let entries = [];
  const bPath = opts.boundariesPath
    || (filePaths.length ? path.join(path.dirname(filePaths[0]), BOUNDARIES_FILE) : null);
  let bLoad = { ok: true, entries: [] };
  if (opts.boundaries !== undefined) bLoad = parseBoundaries(opts.boundaries);
  else if (bPath) bLoad = loadBoundaries(bPath);
  if (bLoad.ok) entries = bLoad.entries;

  const names = new Set(filePaths.map((f) => path.basename(f)));
  const inScope = entries.filter((e) => names.has(e.file));
  const outOfScope = entries.filter((e) => !names.has(e.file));
  const boundaryReport = (unused = []) => ({ declared: entries.length, applied, unused, out_of_scope: outOfScope.map(describe) });

  const finish = (fields) => {
    const ok = fields.ok;
    const status = !ok ? 'failed' : (applied.length ? 'verified_with_boundaries' : 'verified');
    const summary = !ok
      ? `FAILED: ${fields.reason}`
      : (applied.length ? `verified with ${applied.length} declared boundaries` : 'verified');
    return { ok, status, summary, ...fields, continuity };
  };

  if (!bLoad.ok) {
    return finish({
      ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
      broken_at: null, reason: `boundaries file invalid (${bPath || 'in-memory'}): ${bLoad.error}`,
      tail_hash: GENESIS_HASH, tail_seq: null, boundaries: boundaryReport(),
    });
  }

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    let lines;
    try {
      lines = splitLines(fs.readFileSync(filePath));
    } catch (err) {
      return finish({
        ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
        broken_at: { file: fileName, line: null },
        reason: `unreadable file: ${err.message}`,
        tail_hash: expectedPrev || GENESIS_HASH, tail_seq: null, boundaries: boundaryReport(),
      });
    }
    const result = verifyLines(lines, {
      expectedPrev,
      fileName,
      boundaries: inScope.filter((e) => e.file === fileName),
      pending,
    });
    checked += result.checked;
    legacyPrefix += result.legacy_prefix;
    applied.push(...result.boundaries_applied);
    continuity.push(...result.continuity);
    if (!result.ok) {
      return finish({
        ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
        broken_at: { file: fileName, line: result.broken_at },
        reason: result.reason, ...(result.detail ? { detail: result.detail } : {}),
        tail_hash: result.tail_hash, tail_seq: result.tail_seq, boundaries: boundaryReport(),
      });
    }
    pending = result.pending;
    if (result.tail_seq !== null) tailSeq = result.tail_seq;
    // Thread the chain into the next file only once it has actually started;
    // a file of pure legacy records leaves expectedPrev untouched. A pending
    // boundary re-anchors on the next record, so only its last verified hash
    // is carried (the next file's first record supplies its own prev_hash).
    if (result.checked > 0) expectedPrev = result.tail_hash;
    else if (pending && expectedPrev === undefined) expectedPrev = result.tail_hash;
  }

  if (pending) {
    continuity.push({
      boundary: { file: pending.file, line: pending.line },
      resumed_at: null,
      link: 'none',
      statement: 'The boundary is the last readable thing in the journal: no record follows it, so there is nothing to compare. Continuity across this boundary cannot be proved.',
    });
  }

  const used = new Set(applied.map((a) => `${a.file}#${a.line}`));
  const unusedIn = inScope.filter((e) => !used.has(`${e.file}#${e.line}`));
  const unused = opts.complete ? unusedIn.concat(outOfScope) : unusedIn;
  if (unused.length) {
    const first = unused[0];
    return finish({
      ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
      broken_at: { file: first.file, line: null },
      reason: `declared boundary matches nothing: ${first.file} line ${first.line} (sha256 ${first.sha256})${unused.length > 1 ? ` and ${unused.length - 1} more` : ''}`,
      tail_hash: expectedPrev || GENESIS_HASH, tail_seq: null,
      boundaries: boundaryReport(unused.map(describe)),
    });
  }

  return finish({
    ok: true, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
    broken_at: null, reason: null,
    tail_hash: expectedPrev || GENESIS_HASH,
    tail_seq: tailSeq,
    boundaries: boundaryReport(),
  });
}

function describe(e) {
  return { file: e.file, line: e.line, sha256: e.sha256, reason: e.reason, recorded_at: e.recorded_at, recorded_by: e.recorded_by };
}

/**
 * Read the chain tail of the newest JSONL file in a directory, so a writer
 * can resume the chain across restarts and daily rotation.
 *
 * @param {string} dir - events directory containing YYYY-MM-DD.jsonl files
 * @returns {{ prevHash: string, seq: number }} next-record chain state
 */
function readTail(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch (_) {
    return { prevHash: GENESIS_HASH, seq: 0 };
  }
  for (let i = files.length - 1; i >= 0; i--) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, files[i]), 'utf8');
    } catch (_) {
      continue;
    }
    const lines = content.split('\n');
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j].trim();
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (typeof record.hash === 'string') {
          return {
            prevHash: record.hash,
            seq: (typeof record.seq === 'number' ? record.seq : -1) + 1,
          };
        }
        // Legacy tail (pre-chain record): chain starts fresh after it.
        return { prevHash: GENESIS_HASH, seq: 0 };
      } catch (_) {
        // Skip a torn/corrupt tail line and keep walking back.
      }
    }
  }
  return { prevHash: GENESIS_HASH, seq: 0 };
}

module.exports = {
  GENESIS_HASH, BOUNDARIES_FILE, BOUNDARIES_VERSION,
  canonical, hashRecord, verifyLines, verifyFiles, readTail, loadBoundaries, parseBoundaries,
};
