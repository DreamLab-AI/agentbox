'use strict';

/**
 * sidechain-health — the sidestr producer's tip-age probe (ADR-2103, interim
 * receipt amendment 2026-10-02).
 *
 * Before this probe the producer's only health signal was supervisor process
 * state, and the producer has twice sat RUNNING while making no blocks: wedged
 * retrying an invalid transaction (23 Sep) and stopped for four days from
 * 25 Sep (config/sidechain/README.md). A RUNNING process is not a live chain.
 *
 * The probe reads the producer's status route (`GET /`, the same object as
 * `/status.json`: height, hash, time, mempool, interval, checkpoints) and calls
 * the chain unhealthy when:
 *
 *   - the status route is unreachable, times out or answers non-2xx
 *     (a `kill -STOP`ped producer stops answering, so this fires within the
 *     request timeout), or
 *   - the mempool is empty and the tip is older than 2 x the idle interval
 *     (600 s, so 1,200 s), or
 *   - the mempool has held transactions for longer than 2 x the transaction
 *     interval (10 s, so 20 s) with no new block. The clock for this case
 *     starts at the later of the tip time and the moment this process first
 *     saw a non-empty mempool, so a transaction that arrived a second ago
 *     against a 500-second-old tip is not a false alarm, while the invalid-tx
 *     retry loop (mempool never drains) turns red after 20 s.
 *
 * The probe never claims anchoring: `anchored` is true only when the producer
 * reports a checkpoint (`checkpoints.last`), which it does not while
 * checkpoints into the parent are off (owner decision 2026-10-02, SC5).
 *
 * Read-only and fail-closed: any error is "unhealthy", never "unknown-but-ok".
 */

const DEFAULT_URL = `http://127.0.0.1:${process.env.SIDESTR_PORT || 3450}/`;
/** Idle block interval, seconds (run-producer.sh --interval). */
const DEFAULT_IDLE_INTERVAL_S = 600;
/** Block interval with transactions waiting, seconds (run-producer.sh --tx-interval). */
const DEFAULT_TX_INTERVAL_S = 10;
/** Unhealthy past this many intervals. */
const STALE_FACTOR = 2;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_CACHE_MS = 5000;

function positive(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Judge one status reading. Pure: no I/O, no clock of its own.
 *
 * @param {object|null} status  the producer's status object, or null when unreachable
 * @param {object} opts
 * @param {number} opts.nowS            current unix time, seconds
 * @param {number} [opts.idleIntervalS] idle interval (the status's own `interval` wins when present)
 * @param {number} [opts.txIntervalS]   interval with transactions waiting
 * @param {number|null} [opts.pendingSinceS] when a non-empty mempool was first seen, or null
 * @param {string} [opts.error]         why the status is null
 * @returns {object} the health record
 */
function judge(status, opts) {
  const nowS = opts.nowS;
  const txIntervalS = positive(opts.txIntervalS, DEFAULT_TX_INTERVAL_S);
  if (!status || typeof status !== 'object') {
    return {
      status: 'unhealthy',
      reason: `producer status unreachable: ${opts.error || 'no response'}`,
      checked_at: new Date(nowS * 1000).toISOString(),
      anchored: false,
    };
  }
  const idleIntervalS = positive(status.interval, positive(opts.idleIntervalS, DEFAULT_IDLE_INTERVAL_S));
  const height = Number.isInteger(status.height) ? status.height : null;
  const time = Number.isFinite(status.time) ? status.time : null;
  const mempool = Number.isFinite(status.mempool) ? status.mempool : 0;
  const last = status.checkpoints && status.checkpoints.last ? status.checkpoints.last : null;
  const base = {
    height,
    hash: typeof status.hash === 'string' ? status.hash : null,
    time,
    mempool,
    idle_interval_s: idleIntervalS,
    tx_interval_s: txIntervalS,
    checked_at: new Date(nowS * 1000).toISOString(),
    anchored: Boolean(last),
    checkpoint: last,
  };
  if (height === null || time === null) {
    return { ...base, status: 'unhealthy', reason: 'producer status carries no tip height/time' };
  }
  const age = nowS - time;
  const idleLimit = STALE_FACTOR * idleIntervalS;
  if (age > idleLimit) {
    // Stale past the idle limit is red whatever the mempool says: a first
    // reading of a long-wedged producer has no pending clock to go on.
    return { ...base, tip_age_s: age, threshold_s: idleLimit, status: 'unhealthy', reason: `tip ${height} is ${age}s old (limit ${idleLimit}s = ${STALE_FACTOR} x ${idleIntervalS}s)` };
  }
  if (mempool > 0) {
    const since = Math.max(time, Number.isFinite(opts.pendingSinceS) ? opts.pendingSinceS : nowS);
    const waited = nowS - since;
    const limit = STALE_FACTOR * txIntervalS;
    const record = { ...base, tip_age_s: age, threshold_s: limit, pending_s: waited };
    if (waited > limit) {
      return { ...record, status: 'unhealthy', reason: `${mempool} transaction(s) waiting ${waited}s with no block (limit ${limit}s = ${STALE_FACTOR} x ${txIntervalS}s)` };
    }
    return { ...record, status: 'healthy', reason: `tip ${height} is ${age}s old; ${mempool} transaction(s) waiting ${waited}s (limit ${limit}s)` };
  }
  return { ...base, tip_age_s: age, threshold_s: idleLimit, status: 'healthy', reason: `tip ${height} is ${age}s old (limit ${idleLimit}s)` };
}

/**
 * A stateful probe: remembers when it first saw a non-empty mempool and caches
 * a reading for `cacheMs` so a burst of /v1/system or /ready calls costs one
 * request to the producer.
 *
 * @param {object} [opts]
 * @param {string} [opts.url]           producer status URL (env SIDESTR_STATUS_URL)
 * @param {number} [opts.idleIntervalS]
 * @param {number} [opts.txIntervalS]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.cacheMs]
 * @param {Function} [opts.fetch]       injectable fetch (tests)
 * @param {Function} [opts.now]         injectable clock, ms (tests)
 */
function createTipProbe(opts = {}) {
  const url = opts.url || process.env.SIDESTR_STATUS_URL || DEFAULT_URL;
  const idleIntervalS = positive(opts.idleIntervalS ?? process.env.SIDESTR_INTERVAL, DEFAULT_IDLE_INTERVAL_S);
  const txIntervalS = positive(opts.txIntervalS ?? process.env.SIDESTR_TX_INTERVAL, DEFAULT_TX_INTERVAL_S);
  const timeoutMs = positive(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const cacheMs = opts.cacheMs === 0 ? 0 : positive(opts.cacheMs, DEFAULT_CACHE_MS);
  const doFetch = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  let pendingSinceS = null;
  let pendingTip = null;
  let cached = null;
  let cachedAt = 0;
  let inflight = null;

  async function read() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) return { status: null, error: `http_${res.status}` };
      return { status: await res.json() };
    } catch (err) {
      return { status: null, error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err.code || err.message) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe() {
    const t = now();
    if (cached && t - cachedAt < cacheMs) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      const { status, error } = await read();
      const nowS = Math.floor(now() / 1000);
      if (status && Number(status.mempool) > 0) {
        // A new tip resets the wait: the transactions now waiting are new ones.
        if (pendingSinceS === null || pendingTip !== status.hash) {
          pendingSinceS = nowS;
          pendingTip = status.hash;
        }
      } else if (status) {
        pendingSinceS = null;
        pendingTip = null;
      }
      const record = { url, ...judge(status, { nowS, idleIntervalS, txIntervalS, pendingSinceS, error }) };
      cached = record;
      cachedAt = now();
      return record;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return { probe, url };
}

/**
 * The produced chains the manifest switches on, each as the catalogue id that
 * reports it and where its producer listens. `[sidechain].enabled` dominates
 * every chain (the parent gate); `sidestr:dreamlab` is the base table on
 * SIDESTR_PORT (3450), and each enabled `[sidechain.<name>]` table is another
 * chain on its own `port` and `interval` (ADR-2103, the txbt4 seal).
 *
 * @param {object} manifest  parsed agentbox.toml
 * @returns {{id: string, chain: string, url: string, idleIntervalS: number}[]}
 */
function chainsFromManifest(manifest) {
  const sc = manifest && manifest.sidechain;
  if (!sc || sc.enabled !== true) return [];
  const out = [{ id: 'sidechain', chain: 'sidestr:dreamlab', url: DEFAULT_URL, idleIntervalS: positive(process.env.SIDESTR_INTERVAL, DEFAULT_IDLE_INTERVAL_S) }];
  for (const [name, t] of Object.entries(sc)) {
    if (!t || typeof t !== 'object' || Array.isArray(t) || t.enabled !== true) continue;
    const port = Number(t.port);
    if (!Number.isInteger(port) || port <= 0) continue;
    out.push({ id: `sidechain-${name}`, chain: `sidestr:${name}`, url: `http://127.0.0.1:${port}/`, idleIntervalS: positive(t.interval, DEFAULT_IDLE_INTERVAL_S) });
  }
  return out;
}

module.exports = {
  chainsFromManifest,
  createTipProbe,
  judge,
  DEFAULT_IDLE_INTERVAL_S,
  DEFAULT_TX_INTERVAL_S,
  STALE_FACTOR,
};
