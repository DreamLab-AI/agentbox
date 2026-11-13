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

function createReadRecorder({ pool, log = () => {} }) {
  let ensured = null;      // the one CREATE TABLE promise, retried after a failure
  let tail = Promise.resolve();

  function ensure() {
    if (!ensured) {
      ensured = pool.query(DDL).catch((e) => { ensured = null; throw e; });
    }
    return ensured;
  }

  // Serialise the recorder's own writes so idle() can wait for all of them.
  function enqueue(work) {
    tail = tail.then(work).catch((e) => { log('WARN', `memory read counter failed (ignored): ${e.message}`); });
    return tail;
  }

  /**
   * Count one read of each distinct (namespace, key) in `rows`.
   * @param {{namespace?: string, key?: string}[]} rows
   * @param {'retrieve'|'search_hit'} action
   * @returns {Promise<void>} never rejects
   */
  function record(rows, action) {
    if (!readCountsEnabled() || !pool || !ACTIONS.has(action) || !Array.isArray(rows)) return Promise.resolve();
    const seen = new Set();
    const namespaces = [];
    const keys = [];
    for (const r of rows) {
      if (!r || typeof r.namespace !== 'string' || typeof r.key !== 'string' || !r.namespace || !r.key) continue;
      const id = `${r.namespace}\u0000${r.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      namespaces.push(r.namespace);
      keys.push(r.key);
    }
    if (!keys.length) return Promise.resolve();
    return enqueue(async () => {
      await ensure();
      await pool.query(UPSERT, [namespaces, keys, action]);
    });
  }

  /** Remove every counter for a deleted entry. Never rejects. */
  function forget(namespace, key) {
    if (!readCountsEnabled() || !pool) return Promise.resolve();
    return enqueue(async () => {
      await ensure();
      await pool.query(`DELETE FROM ${READS_TABLE} WHERE namespace = $1 AND key = $2`, [namespace, key]);
    });
  }

  /** Remove counters whose entry no longer exists (after a TTL sweep). Never rejects. */
  function forgetOrphans() {
    if (!readCountsEnabled() || !pool) return Promise.resolve();
    return enqueue(async () => {
      await ensure();
      await pool.query(
        `DELETE FROM ${READS_TABLE} r
          WHERE NOT EXISTS (SELECT 1 FROM memory_entries m WHERE m.namespace = r.namespace AND m.key = r.key)`,
      );
    });
  }

  /** Resolves when every recorder write issued so far has settled. */
  function idle() { return tail; }

  return { record, forget, forgetOrphans, idle };
}

module.exports = { createReadRecorder, readCountsEnabled, READS_TABLE, ACTIONS };
