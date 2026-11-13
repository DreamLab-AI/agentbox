'use strict';
/**
 * memory-reads.js — read counters for memory entries (ADR-2201 clause 9, gate
 * RUVECTOR_READ_COUNTS).
 *
 * `memory_entries.access_count` exists but nothing maintains it, and it must
 * stay that way: 94% of updates to that table are not HOT (measured
 * 2026-11-13: 56,609 HOT of 1,011,614), so bumping a counter on the row would
 * insert a fresh HNSW entry on almost every read and fire the access trigger.
 * Reads are therefore counted in a side table that no index on memory_entries
 * sees:
 *
 *   memory_reads (namespace, key, action, n, first_at, last_at)
 *
 * `action` is 'retrieve' (the whole value was fetched by key) or 'search_hit'
 * (the entry was returned in a shaped search result). The two are kept apart
 * because only the first shows that an entry was actually read.
 *
 * The recorder is fail-open in the strict sense: it never throws, and callers
 * do not await it, so a slow or broken counter can neither fail nor delay the
 * read it observes. Counters stay inside the container and are removed with
 * the entry they describe.
 */

const { boolGate } = require('./ruvector-gates');

const READS_TABLE = 'memory_reads';
const ACTIONS = new Set(['retrieve', 'search_hit']);

const DDL = `CREATE TABLE IF NOT EXISTS ${READS_TABLE} (
  namespace text NOT NULL,
  key       text NOT NULL,
  action    text NOT NULL,
  n         bigint NOT NULL DEFAULT 0,
  first_at  timestamptz NOT NULL DEFAULT now(),
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key, action)
)`;

const UPSERT = `INSERT INTO ${READS_TABLE} (namespace, key, action, n)
  SELECT want.namespace, want.key, $3, 1
    FROM unnest($1::text[], $2::text[]) AS want(namespace, key)
  ON CONFLICT (namespace, key, action) DO UPDATE SET n = ${READS_TABLE}.n + 1, last_at = now()`;

function readCountsEnabled() { return boolGate('RUVECTOR_READ_COUNTS'); }

// At most this many counter writes wait behind the one in flight. Beyond it
// reads are simply not counted: a hung or slow store must not grow a queue.
const MAX_PENDING = 64;
// After the table cannot be created (a role without CREATE, say) the recorder
// stays silent this long before it tries again.
const DDL_BACKOFF_MS = 5 * 60 * 1000;

function createReadRecorder({ pool, log = () => {}, now = () => Date.now() }) {
  let ensured = null;      // the one CREATE TABLE promise
  let disabledUntil = 0;   // backoff after a failed CREATE TABLE
  let tail = Promise.resolve();
  let pending = 0;
  let dropped = 0;

  // Nothing the recorder is given may break it: not the logger, not the clock.
  const safeLog = (lvl, msg) => { try { log(lvl, msg); } catch { /* a broken logger is not the reader's problem */ } };
  const clock = () => { try { const t = now(); return Number.isFinite(t) ? t : Date.now(); } catch { return Date.now(); } };
  const paused = () => clock() < disabledUntil;

  function ensure() {
    if (!ensured) {
      // Promise.resolve().then: a pool that throws synchronously is handled
      // exactly like one that returns a rejected promise.
      ensured = Promise.resolve().then(() => pool.query(DDL)).catch((e) => {
        ensured = null;
        disabledUntil = clock() + DDL_BACKOFF_MS;
        throw new Error(`cannot create ${READS_TABLE} (${e && e.message}); read counting paused for ${DDL_BACKOFF_MS / 60000} min`);
      });
    }
    return ensured;
  }

  // The recorder's writes run one at a time (so it holds at most one pool
  // connection and idle() can wait for all of them), behind a bounded queue.
  function enqueue(work) {
    if (paused()) return Promise.resolve();
    if (pending >= MAX_PENDING) { dropped++; return Promise.resolve(); }
    pending++;
    tail = tail
      .then(() => (paused() ? undefined : work()))
      .catch((e) => { safeLog('WARN', `memory read counter failed (ignored): ${e && e.message}`); })
      .finally(() => { pending--; });
    return tail;
  }

  /**
   * Count one read of each distinct (namespace, key) in `rows`.
   * @param {{namespace?: string, key?: string}[]} rows
   * @param {'retrieve'|'search_hit'} action
   * @returns {Promise<void>} never rejects, never throws
   */
  function record(rows, action) {
    try {
      if (!readCountsEnabled() || !pool || !ACTIONS.has(action) || !Array.isArray(rows)) return Promise.resolve();
      const seen = new Map();
      for (const r of rows) {
        if (!r || typeof r.namespace !== 'string' || typeof r.key !== 'string' || !r.namespace || !r.key) continue;
        seen.set(`${r.namespace}\u0000${r.key}`, { namespace: r.namespace, key: r.key });
      }
      if (!seen.size) return Promise.resolve();
      // Sorted, so two processes upserting overlapping rows lock them in the
      // same order and cannot deadlock.
      const ordered = [...seen.keys()].sort().map((id) => seen.get(id));
      const namespaces = ordered.map((r) => r.namespace);
      const keys = ordered.map((r) => r.key);
      return enqueue(async () => {
        await ensure();
        await pool.query(UPSERT, [namespaces, keys, action]);
      });
    } catch (e) {
      safeLog('WARN', `memory read counter failed (ignored): ${e && e.message}`);
      return Promise.resolve();
    }
  }

  function guarded(work) {
    try {
      if (!readCountsEnabled() || !pool) return Promise.resolve();
      return enqueue(work);
    } catch (e) {
      safeLog('WARN', `memory read counter failed (ignored): ${e && e.message}`);
      return Promise.resolve();
    }
  }

  /** Remove every counter for a deleted entry. Never rejects, never throws. */
  function forget(namespace, key) {
    return guarded(async () => {
      await ensure();
      await pool.query(`DELETE FROM ${READS_TABLE} WHERE namespace = $1 AND key = $2`, [namespace, key]);
    });
  }

  /** Remove counters whose entry no longer exists (after a TTL sweep). Never rejects, never throws. */
  function forgetOrphans() {
    return guarded(async () => {
      await ensure();
      await pool.query(
        `DELETE FROM ${READS_TABLE} r
          WHERE NOT EXISTS (SELECT 1 FROM memory_entries m WHERE m.namespace = r.namespace AND m.key = r.key)`,
      );
    });
  }

  /** Resolves when every recorder write issued so far has settled. */
  function idle() { return tail; }

  /** Queue depth and how many reads went uncounted. */
  function stats() { return { pending, dropped, max_pending: MAX_PENDING, paused: paused() }; }

  return { record, forget, forgetOrphans, idle, stats };
}

module.exports = { createReadRecorder, readCountsEnabled, READS_TABLE, ACTIONS };
