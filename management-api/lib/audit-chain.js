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

/**
 * Verify a sequence of JSONL lines as one chain segment.
 *
 * @param {string[]} lines - raw JSONL lines (blank lines ignored)
 * @param {object} [opts]
 * @param {string}  [opts.expectedPrev] - hash the first chained record must
 *   link to (threads the chain across rotated files). Default: accept either
 *   GENESIS_HASH or whatever the first record claims IF this is the first
 *   segment (expectedPrev === undefined means "start of chain": genesis only).
 * @param {boolean} [opts.allowLegacyPrefix=true] - tolerate leading records
 *   with no chain fields (pre-ADR-039 log content).
 * @returns {{ ok: boolean, checked: number, legacy_prefix: number,
 *             broken_at: number|null, reason: string|null,
 *             tail_hash: string, tail_seq: number|null }}
 */
function verifyLines(lines, opts = {}) {
  const allowLegacyPrefix = opts.allowLegacyPrefix !== false;
  let prevHash = opts.expectedPrev !== undefined ? opts.expectedPrev : GENESIS_HASH;
  let chainStarted = opts.expectedPrev !== undefined && opts.expectedPrev !== GENESIS_HASH;
  let checked = 0;
  let legacyPrefix = 0;
  let tailSeq = null;

  const fail = (index, reason) => ({
    ok: false, checked, legacy_prefix: legacyPrefix,
    broken_at: index, reason, tail_hash: prevHash, tail_seq: tailSeq,
  });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (_) {
      return fail(i, 'unparseable line');
    }

    if (record.hash === undefined && record.prev_hash === undefined) {
      if (chainStarted) return fail(i, 'unchained record after chain start');
      if (!allowLegacyPrefix) return fail(i, 'unchained record');
      legacyPrefix += 1;
      continue;
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
  };
}

/**
 * Verify a set of JSONL files as one continuous chain, in the given order
 * (callers pass daily files sorted by name — YYYY-MM-DD sorts correctly).
 *
 * @param {string[]} filePaths
 * @returns {{ ok, files, checked, legacy_prefix, broken_at: {file, line}|null,
 *             reason, tail_hash, tail_seq }}
 */
function verifyFiles(filePaths) {
  let expectedPrev; // undefined = start of chain (genesis)
  let checked = 0;
  let legacyPrefix = 0;

  for (const filePath of filePaths) {
    let lines;
    try {
      lines = fs.readFileSync(filePath, 'utf8').split('\n');
    } catch (err) {
      return {
        ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
        broken_at: { file: path.basename(filePath), line: null },
        reason: `unreadable file: ${err.message}`,
        tail_hash: expectedPrev || GENESIS_HASH, tail_seq: null,
      };
    }
    const result = verifyLines(lines, { expectedPrev });
    checked += result.checked;
    legacyPrefix += result.legacy_prefix;
    if (!result.ok) {
      return {
        ok: false, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
        broken_at: { file: path.basename(filePath), line: result.broken_at },
        reason: result.reason, tail_hash: result.tail_hash, tail_seq: result.tail_seq,
      };
    }
    // Thread the chain into the next file only once it has actually started;
    // a file of pure legacy records leaves expectedPrev untouched.
    if (result.checked > 0) expectedPrev = result.tail_hash;
  }

  return {
    ok: true, files: filePaths.length, checked, legacy_prefix: legacyPrefix,
    broken_at: null, reason: null,
    tail_hash: expectedPrev || GENESIS_HASH,
    tail_seq: null,
  };
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

module.exports = { GENESIS_HASH, canonical, hashRecord, verifyLines, verifyFiles, readTail };
