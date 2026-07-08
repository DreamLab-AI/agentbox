#!/usr/bin/env node
'use strict';
/**
 * aggregate-effectiveness.js — the missing half of the learning loop
 * (ADR-036 D1, DDD-016 §4.3 EffectivenessAggregate).
 *
 * The trajectory recorder (config/hooks/trajectory-recorder.cjs) writes real,
 * graded `(state, action, outcome, duration)` tuples into `trajectory_steps`.
 * This module distils that corpus into per-action-pattern effectiveness records
 * and stores them as ordinary, retrievable MemoryEntries so hybrid retrieval
 * (RUVECTOR_FEED_RETRIEVAL) and routing hints (RUVECTOR_FEED_ROUTING) can
 * consume them.
 *
 * Computation, per distinct `trajectory_steps.action` pattern:
 *   • successes = steps with quality >= 0.5, weighted by recency half-life decay
 *       weight_i = 0.5 ^ ( age_days_i / RUVECTOR_RECENCY_HALF_LIFE_DAYS )
 *   • n        = raw observation count (the I06 sample floor uses the RAW count)
 *   • wilson   = Wilson score-interval LOWER bound (z = 1.96) of the
 *                recency-weighted success proportion over the recency-weighted
 *                effective sample size — not the raw rate (I06). A single
 *                degenerate label cannot move the needle.
 *   • patterns with n < RUVECTOR_AGGREGATE_MIN_SAMPLES are SKIPPED.
 *
 * Each surviving aggregate is upserted THROUGH THE GOVERNED memStore path
 * (createMemoryTools external-pg backend) — never a raw SQL INSERT into
 * memory_entries (DDD-016 I03: raw INSERTs produce NULL-embedding rows invisible
 * to HNSW). It lands in namespace `memory-learning-aggregates`, content-addressed
 * key `effectiveness-sha256-12-<hash(pattern)>`, with typed metadata
 *   { importance: wilson, tags: ['action:<pattern>'], memory_type: 'semantic' }
 * and a value summarising { pattern, wilson, n, mean_quality, last_seen }.
 *
 * Invocation (dry-run by default; --yes applies):
 *   node aggregate-effectiveness.js            # dry-run: prints per-pattern table
 *   node aggregate-effectiveness.js --yes      # writes eligible aggregates
 * The engine subcommand `ruvector aggregate-effectiveness` gates the apply path
 * on `[memory_learning].enabled = true` (fail-closed) and resolves the DB /
 * embedding env from `.mcp.json` before invoking this file.
 */

const crypto = require('crypto');
const http = require('http');
const { params: gateParams, gates } = require('./ruvector-gates');
const { createMemoryTools } = require('./memory-tools');

const AGG_NAMESPACE = 'memory-learning-aggregates';
const WRITE_SOURCE_TYPE = 'agentbox';
const Z = 1.96;
const EMBEDDING_DIM = 384;

const PG_SEARCH_PATHS = [
  '/home/devuser/workspace/.claude-pg/node_modules/pg',
  '/opt/agentbox/management-api/node_modules/pg',
  'pg',
];

function loadPg() {
  for (const p of PG_SEARCH_PATHS) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error(`pg module not found in any search path: ${PG_SEARCH_PATHS.join(', ')}`);
}

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [aggregate-effectiveness] ${msg}\n`);
}

function round(x, d = 4) { const m = 10 ** d; return Math.round((Number(x) || 0) * m) / m; }

// ── Wilson score interval lower bound (z default 1.96 → 95%) ──────────────────
// Works with fractional (recency-weighted) successes / effective n.
function wilsonLower(succ, n, z = Z) {
  if (!(n > 0)) return 0;
  const p = Math.min(1, Math.max(0, succ / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const lo = (centre - margin) / denom;
  return Math.max(0, Math.min(1, lo));
}

function sha12(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12); }

// Content-addressed over the action-pattern (DDD-016 §4.3 identity convention:
// urn:agentbox:memory:<scope>:effectiveness-<sha256-12>). Stable → ON CONFLICT.
function aggregateKey(pattern) { return `effectiveness-sha256-12-${sha12(pattern)}`; }

// Best-effort canonical URN for provenance (I01). Never load-bearing.
function aggregateUrn(key) {
  try {
    const { mint } = require('../../../management-api/lib/uris.js');
    const pubkey = process.env.AGENTBOX_PUBKEY;
    return mint({ kind: 'memory', pubkey: /^[0-9a-fA-F]{64}$/.test(pubkey || '') ? pubkey : undefined, localId: key });
  } catch { return null; }
}

// ── xinference embedding transport (mirrors ruvector-mcp.cjs) ──────────────────
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
let xinferenceOk = false;

function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.data && j.data[0] && j.data[0].embedding) {
            const emb = j.data[0].embedding;
            if (emb.length === EMBEDDING_DIM) { resolve(emb); return; }
            reject(new Error(`dimension mismatch: got ${emb.length}, expected ${EMBEDDING_DIM}`));
          } else { reject(new Error(`unexpected response: ${data.substring(0, 200)}`)); }
        } catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function xinfEnsure() {
  if (xinferenceOk) return true;
  try { await getEmbedding('reconnect probe'); xinferenceOk = true; } catch { /* stays false */ }
  return xinferenceOk;
}

function vecToSql(arr) { return '[' + arr.join(',') + ']'; }
function entryId(namespace, key) { return `${WRITE_SOURCE_TYPE}:${namespace}:${key}`; }
function parseVal(v) { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; }

// ── aggregation query ─────────────────────────────────────────────────────────
// Read-only over trajectory_steps (never memory_entries — I03). One pass:
// per action pattern, raw count + recency-weighted total/success + mean quality.
const AGG_SQL = `
  SELECT action AS pattern,
         count(*)::bigint AS n,
         sum( power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - created_at)), 0)/86400.0/$1) ) AS w_total,
         sum( CASE WHEN quality >= 0.5
                   THEN power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - created_at)), 0)/86400.0/$1)
                   ELSE 0 END ) AS w_succ,
         avg(quality)::float AS mean_quality,
         max(created_at) AS last_seen
    FROM trajectory_steps
   WHERE action IS NOT NULL AND action <> ''
   GROUP BY action`;

// ── gate-state inspection (REC-7: "gates that stay OFF until the floor clears,
// with the gate state inspectable") ──────────────────────────────────────────
// A PURE summary of where the learning loop stands: how many action patterns
// have cleared the Wilson sample floor, and whether the two consumer gates
// (feed_retrieval / feed_routing) are on. It NEVER flips a gate — it reports.
// The load-bearing field is `premature_consumer_enabled`: a consumer gate ON
// while the floor has NOT cleared is exactly the degenerate-label pathology the
// floor exists to prevent (ADR-037 D3), and the validator flags the same as W066.
function summariseGates(rows, opts = {}) {
  const minSamples = Number.isFinite(opts.minSamples) ? opts.minSamples : gateParams.aggregateMinSamples();
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((r) => (Number(r.n) || 0) >= minSamples);
  const floorCleared = eligible.length > 0;
  const feedRetrieval = opts.feedRetrieval === undefined ? gates.feedRetrieval() : !!opts.feedRetrieval;
  const feedRouting = opts.feedRouting === undefined ? gates.feedRouting() : !!opts.feedRouting;
  return {
    aggregate_min_samples: minSamples,
    patterns_total: list.length,
    patterns_cleared_floor: eligible.length,
    floor_cleared: floorCleared,
    gates: { feed_retrieval: feedRetrieval, feed_routing: feedRouting },
    premature_consumer_enabled: (feedRetrieval || feedRouting) && !floorCleared,
    eligible_patterns: eligible.map((r) => ({ pattern: r.pattern, n: Number(r.n) || 0, wilson: round(r.wilson, 4) })),
  };
}

function computeRows(pgRows) {
  const rows = [];
  for (const r of pgRows) {
    const n = parseInt(r.n, 10) || 0;
    const wTotal = parseFloat(r.w_total) || 0;
    const wSucc = parseFloat(r.w_succ) || 0;
    rows.push({
      pattern: r.pattern,
      n,
      wTotal,
      wSucc,
      wilson: wilsonLower(wSucc, wTotal, Z),
      mean_quality: parseFloat(r.mean_quality) || 0,
      last_seen: r.last_seen instanceof Date ? r.last_seen.toISOString() : (r.last_seen || null),
    });
  }
  rows.sort((a, b) => b.wilson - a.wilson || b.n - a.n);
  return rows;
}

function printTable(rows, minSamples, halfLife) {
  const w = process.stdout;
  w.write(`\nEffectiveness aggregation — Wilson z=${Z}, recency half-life ${halfLife}d, sample floor ${minSamples}\n`);
  w.write(`${rows.length} distinct action pattern(s) in trajectory_steps\n\n`);
  if (!rows.length) { w.write('  (no trajectory_steps — nothing to aggregate)\n'); return; }
  const P = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n); };
  w.write(`  ${P('pattern', 46)} ${P('n', 6)} ${P('mean_q', 8)} ${P('wilson', 8)} ${'eligible'}\n`);
  w.write(`  ${'-'.repeat(46)} ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(8)} --------\n`);
  for (const r of rows) {
    const eligible = r.n >= minSamples ? 'yes' : 'skip';
    w.write(`  ${P(r.pattern, 46)} ${P(r.n, 6)} ${P(round(r.mean_quality, 3), 8)} ${P(round(r.wilson, 4), 8)} ${eligible}\n`);
  }
  w.write('\n');
}

// ── pg pool (shared by run + status) ────────────────────────────────────────────
function makePool() {
  const Pg = loadPg();
  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const parsed = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return new Pg.Pool({
    host: parsed.host || 'ruvector-postgres',
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.dbname || parsed.database || 'ruvector',
    user: parsed.user || parsed.username || 'ruvector',
    password: parsed.password || 'ruvector',
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

// ── status: non-interactive gate-state inspection (REC-7) ─────────────────────
// Reads the live corpus and reports where each gate stands relative to the
// floor, WITHOUT ever flipping one. Machine-readable JSON for the live-session
// receipt (`node aggregate-effectiveness.js --status`).
async function status() {
  const halfLife = gateParams.recencyHalfLifeDays();
  const minSamples = gateParams.aggregateMinSamples();
  const pool = makePool();
  let rows;
  try {
    const res = await pool.query(AGG_SQL, [halfLife]);
    rows = computeRows(res.rows);
  } finally {
    await pool.end().catch(() => {});
  }
  return summariseGates(rows, { minSamples });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function run({ apply = false } = {}) {
  // The aggregate's tags + importance are load-bearing (feed_retrieval re-rank
  // keys on metadata.tags; feed_routing surfaces importance). Force the typed
  // metadata gate on for our own governed writes regardless of the operator gate
  // — scoped to this process, set here rather than on require so importing the
  // module never mutates a shared server's env.
  if (process.env.RUVECTOR_TYPED_METADATA !== '1' && process.env.RUVECTOR_TYPED_METADATA !== 'true') {
    process.env.RUVECTOR_TYPED_METADATA = '1';
  }

  const halfLife = gateParams.recencyHalfLifeDays();
  const minSamples = gateParams.aggregateMinSamples();

  const pool = makePool();

  let rows;
  try {
    const res = await pool.query(AGG_SQL, [halfLife]);
    rows = computeRows(res.rows);
  } catch (err) {
    await pool.end().catch(() => {});
    throw new Error(`aggregation query failed: ${err.message}`);
  }

  printTable(rows, minSamples, halfLife);

  const eligible = rows.filter((r) => r.n >= minSamples);
  const skipped = rows.length - eligible.length;
  let stored = 0;
  let embedFailed = 0;

  if (apply && eligible.length) {
    if (!(await xinfEnsure())) {
      log('WARN', `xinference unreachable (${XINFERENCE_URL}) — aggregates will store without embeddings (embedded:false)`);
    }
    const { memStore } = createMemoryTools({
      backend: 'external-pg',
      deps: {
        pool,
        getPgOk: () => true,
        getEmbedding,
        xinfEnsure,
        vecToSql,
        entryId,
        parseVal,
        notifyMemoryFlash: () => {},
        notifyMemoryFlashBatch: () => {},
        log,
        writeSourceType: WRITE_SOURCE_TYPE,
      },
    });

    for (const r of eligible) {
      const key = aggregateKey(r.pattern);
      const urn = aggregateUrn(key);
      const value = {
        pattern: r.pattern,
        wilson: round(r.wilson, 4),
        n: r.n,
        mean_quality: round(r.mean_quality, 4),
        last_seen: r.last_seen,
        summary: `Action pattern "${r.pattern}": Wilson lower-bound success ${round(r.wilson, 4)} over ${r.n} samples (mean quality ${round(r.mean_quality, 3)}), recency half-life ${halfLife}d.`,
      };
      if (urn) value.urn = urn;
      try {
        const out = await memStore(key, value, AGG_NAMESPACE, {
          importance: r.wilson,
          tags: [`action:${r.pattern}`],
          memory_type: 'semantic',
        });
        if (out && out.success) {
          stored++;
          if (out.embedded === false) embedFailed++;
        } else {
          log('WARN', `store failed for pattern "${r.pattern}": ${out && out.error}`);
        }
      } catch (err) {
        log('WARN', `store threw for pattern "${r.pattern}": ${err.message}`);
      }
    }
  }

  await pool.end().catch(() => {});
  return { total: rows.length, eligible: eligible.length, skipped, stored, embedFailed, minSamples, halfLife };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  // --status: inspect gate state vs the floor (no writes, no gate flip).
  if (argv.some((a) => a === '--status')) {
    status()
      .then((s) => { process.stdout.write(JSON.stringify(s, null, 2) + '\n'); process.exit(0); })
      .catch((e) => { log('ERROR', e.stack || e.message); process.exit(1); });
  } else {
  const apply = argv.some((a) => a === '--yes' || a === '--apply');
  run({ apply })
    .then((r) => {
      const tag = apply ? 'APPLIED' : '[dry-run]';
      process.stdout.write(
        `${tag} — ${r.total} pattern(s): ${r.eligible} eligible (n>=${r.minSamples}), ${r.skipped} below floor` +
        (apply ? `; stored ${r.stored}${r.embedFailed ? ` (${r.embedFailed} without embedding)` : ''}.` : ' (no writes — re-run with --yes to apply).') +
        '\n',
      );
      process.exit(0);
    })
    .catch((e) => { log('ERROR', e.stack || e.message); process.exit(1); });
  }
}

module.exports = { run, status, summariseGates, wilsonLower, aggregateKey, computeRows, AGG_NAMESPACE, AGG_SQL };
