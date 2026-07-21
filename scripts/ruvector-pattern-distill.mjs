#!/usr/bin/env node
// @ts-nocheck
/**
 * ruvector-pattern-distill.mjs — the scheduled pattern-distillation feeder
 * (W-C / ADR-040 D6, DDD-018 §3/§4.2).
 *
 * Distils the judged trajectory corpus (`trajectory_steps`) into content-addressed
 * records in the `patterns` table (NOT `memory_entries`), each carrying a real
 * Xinference embedding and `metadata.provenance = 'judge:trajectory'` (I18).
 * These are the execution-tier, promotable patterns a future `feed_retrieval`
 * promoted-set consumer will filter on (`metadata->>'provenance' = 'judge:trajectory'`).
 *
 * Binding decisions realised here (WF2 implementation map §4.1):
 *   • TARGET is `patterns`, not `memory_entries` (WF2 map V8 / R-C4). The governed
 *     `memStore` hardcodes `INSERT INTO memory_entries` and CANNOT target
 *     `patterns`; no first-party writer to `patterns` exists. D6's acceptance is
 *     measured against `patterns` (`count(*) FROM patterns WHERE
 *     metadata->>'provenance' IS NULL = 0`), so a `memory_entries` shortcut would
 *     FAIL acceptance. This script owns a NEW embed-then-insert path targeting
 *     `patterns`, self-contained here.
 *   • I03-faithful even though the target is not `memory_entries`: EMBED BEFORE
 *     INSERT; if the embedding fails, SKIP the row (never write a NULL-embedding,
 *     HNSW-invisible pattern). This preserves exactly the property `memStore`
 *     guarantees for `memory_entries`. Raw SQL INSERT/UPDATE to `memory_entries`
 *     is FORBIDDEN and never happens here; the cursor row is the only
 *     `memory_entries` write and it goes through the GOVERNED `memStore`.
 *   • Idempotent by content-address: `id = distilled-sha256-12-<hash(action)>`,
 *     upserted `ON CONFLICT (id) DO UPDATE`. A second tick over an unchanged
 *     corpus rewrites the same rows in place (non-destructive) — and the cursor
 *     gate skips the whole recompute anyway.
 *   • Provenance firewall (I18/I15): this feeder writes ONLY
 *     `provenance='judge:trajectory'`. W-E legacy-mining candidates (out of scope)
 *     carry `proxy:legacy-mining` in the same table, separated by the metadata
 *     tier — this script never emits them.
 *   • REUSE, don't reimplement: the Wilson lower bound is `wilsonLower` from
 *     aggregate-effectiveness.js (READ-only require — never edited), the same
 *     recency-weighted grouping AGG_SQL uses (WF1 G4). Deterministic, no LLM
 *     ($0 per D6).
 *   • Incremental cursor: distinct key '__pattern_distill_cursor__' in
 *     'memory-learning-aggregates', tagged 'distill:cursor'. NEVER the aggregation
 *     or SONA cursor key (R-C8). Bind on `max(created_at)` of trajectory_steps.
 *     Because the upsert is idempotent, the cursor gates the whole (idempotent)
 *     recompute — the honest "incremental" for a recency-weighted Wilson bound
 *     computed over each pattern's FULL history.
 *   • Transactional batch (I21): the upserts run in one transaction; any failure
 *     rolls the batch back and advances NO cursor. Never mutates `trajectory_steps`.
 *   • Self-gating (default off): RUVECTOR_PATTERN_DISTILLATION off → --once/--loop
 *     exit fast (no-op). `--dry-run` (and the bare default) are ungated read-only
 *     inspection. Default state stays byte-identical (PRD-020 metric 1); the queen
 *     wires the toml→env injection (R-C6).
 *
 * Modes:
 *   node ruvector-pattern-distill.mjs                 # dry-run (default): compute + print, write NOTHING
 *   node ruvector-pattern-distill.mjs --dry-run       # same as bare default (ungated, read-only)
 *   node ruvector-pattern-distill.mjs --apply|--once  # one gated tick, upsert patterns
 *   node ruvector-pattern-distill.mjs --loop          # gated ticks every interval_mins
 *
 * Config (resolved from the injected .mcp.json env, mirrors the sweep):
 *   RUVECTOR_PATTERN_DISTILLATION             bool  master gate (default off)
 *   RUVECTOR_PATTERN_DISTILL_INTERVAL_MINS    int   loop cadence (default 60)
 *   RUVECTOR_PATTERN_DISTILL_MIN_SAMPLES      int   cluster sample floor (default = aggregate floor, 20)
 *   RUVECTOR_RECENCY_HALF_LIFE_DAYS           int   recency half-life days (default 14) [shared]
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SCHEDULING ARTEFACTS (WF2 map §4.2 — this file is the sole durable landing).
 *
 * (a) LIVE container NOW: a detached self-loop, gated-off by default:
 *
 *       setsid node /home/devuser/workspace/project/agentbox/scripts/ruvector-pattern-distill.mjs --loop \
 *         >>/var/log/ruvector-pattern-distill.log 2>&1 &
 *
 *     Manual single tick:      node scripts/ruvector-pattern-distill.mjs --apply
 *     Read-only yield inspect: node scripts/ruvector-pattern-distill.mjs --dry-run
 *
 * (b) FUTURE image build (QUEEN-APPLIED — flake.nix carries other sessions' staged
 *     work). Add this exact block to the main-container [program:*] set (near
 *     ruvector-aggregate-sweep). Cadence is slower — patterns move slower than
 *     aggregates:
 *
 *       [program:ruvector-pattern-distill]
 *       command=node /opt/agentbox/scripts/ruvector-pattern-distill.mjs --loop
 *       user=devuser
 *       autostart=true            ; safe: self-gates on RUVECTOR_PATTERN_DISTILLATION, exits fast when off
 *       autorestart=true
 *       startsecs=0
 *       stdout_logfile=/var/log/ruvector-pattern-distill.log
 *       stderr_logfile=/var/log/ruvector-pattern-distill.error.log
 * ───────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(HERE, '..');
const LIB_DIR = join(REPO_DIR, 'mcp', 'servers', 'lib');

const CURSOR_KEY = '__pattern_distill_cursor__';
const CURSOR_NS = 'memory-learning-aggregates';
const CURSOR_TAG = 'distill:cursor';
const WRITE_SOURCE_TYPE = 'agentbox';
const PATTERN_SOURCE_DB = 'trajectory-distillation';
const PROVENANCE = 'judge:trajectory';        // I18 execution-tier — promotable
const EMBEDDING_DIM = 384;

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [pattern-distill] ${msg}\n`);
}
function emitEvent(event, fields) {
  process.stderr.write(`[${new Date().toISOString()}] EVENT [pattern-distill] ${event} ${JSON.stringify(fields)}\n`);
}
function round(x, d = 4) { const m = 10 ** d; return Math.round((Number(x) || 0) * m) / m; }

// ── env bootstrap (identical discovery to ruvector-aggregate-sweep.mjs) ──────────
function bootstrapEnv() {
  const candidates = [
    join(process.env.WORKSPACE || join(process.env.HOME || '/home/devuser', 'workspace'), '.mcp.json'),
    join(REPO_DIR, '.mcp.json'),
    join(REPO_DIR, '..', '.mcp.json'),
    join(process.env.HOME || '/home/devuser', 'workspace', '.mcp.json'),
  ];
  for (const f of candidates) {
    try {
      if (!existsSync(f)) continue;
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      const env = parsed && parsed.mcpServers && parsed.mcpServers['claude-flow'] && parsed.mcpServers['claude-flow'].env;
      if (env && typeof env === 'object') {
        for (const [k, v] of Object.entries(env)) {
          if (process.env[k] === undefined || process.env[k] === '') process.env[k] = String(v);
        }
        log('INFO', `env resolved from ${f} (${Object.keys(env).length} key(s))`);
        return f;
      }
    } catch (e) {
      log('WARN', `could not parse ${f}: ${e.message}`);
    }
  }
  log('INFO', 'no .mcp.json env found — using process env / library defaults');
  return null;
}
bootstrapEnv();

// The cursor write keys on typed metadata (the 'distill:cursor' tag). Force the
// typed metadata gate on for THIS process's governed cursor writes (scoped here).
if (process.env.RUVECTOR_TYPED_METADATA !== '1' && process.env.RUVECTOR_TYPED_METADATA !== 'true') {
  process.env.RUVECTOR_TYPED_METADATA = '1';
}

// ── CJS libs (required AFTER env bootstrap) ─────────────────────────────────────
const { wilsonLower } = require(join(LIB_DIR, 'aggregate-effectiveness.js'));  // READ-only reuse
const { createMemoryTools } = require(join(LIB_DIR, 'memory-tools.js'));
const { boolGate, intGate, params: gateParams } = require(join(LIB_DIR, 'ruvector-gates.js'));

// ── pg pool (mirrors aggregate-effectiveness.js makePool) ───────────────────────
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
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

// ── xinference embedding transport (mirrors aggregate-effectiveness.js) ─────────
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
let xinferenceOk = false;

function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve_, reject) => {
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
            if (emb.length === EMBEDDING_DIM) { resolve_(emb); return; }
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

function cursorTools(pool) {
  return createMemoryTools({
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
}

// ── PURE distillation helpers (exported for unit tests — no DB, no network) ──────

function sha12(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12); }

// Content-addressed idempotency key over the action-pattern. Stable → ON CONFLICT.
function distillId(action) { return `distilled-sha256-12-${sha12(action)}`; }

// Cluster qualifies when its RAW observation count clears the sample floor (I06 —
// the floor uses the raw count, not the recency-weighted effective n).
function qualifies(n, minSamples) { return (Number(n) || 0) >= (Number(minSamples) || 0); }

// Derived category = the tool name (first token before whitespace or '['). Falls
// back to 'trajectory-pattern' when the action has no leading token.
function deriveType(action) {
  const s = String(action || '').trim();
  const m = s.match(/^([^\s[\]]+)/);
  const tool = m ? m[1] : '';
  return tool || 'trajectory-pattern';
}

// labels = [toolName, ...structured bracket tokens]. The trajectory recorder emits
// actions like `grep [args:4 flags:2 pipe]`; the bracket carries high-signal
// arg/flag/pipe descriptors. Deduped, front-loaded for the embedder.
function extractLabels(action) {
  const s = String(action || '').trim();
  const labels = [];
  const tool = deriveType(s);
  if (tool && tool !== 'trajectory-pattern') labels.push(tool);
  const br = s.match(/\[([^\]]*)\]/);
  if (br && br[1]) {
    for (const tok of br[1].split(/\s+/)) {
      const t = tok.trim();
      if (t) labels.push(t);
    }
  }
  return Array.from(new Set(labels));
}

// paths = file/path tokens extracted from the sampled `result` strings. Captures
// absolute paths, relative `a/b` paths, `filename.ext`, and `*.ext` globs. Deduped,
// capped, per-token length-bounded (never a NULL/huge blob into the embed text).
function extractPaths(results, cap = 12) {
  const set = new Set();
  const re = /(?:\/[A-Za-z0-9_.\-]+)+|(?:[A-Za-z0-9_.\-]+\/[A-Za-z0-9_./\-]+)|\*\.[A-Za-z0-9]+|\b[A-Za-z0-9_\-]+\.[A-Za-z]{1,5}\b/g;
  for (const r of (Array.isArray(results) ? results : [])) {
    if (r === null || r === undefined) continue;
    const toks = String(r).match(re) || [];
    for (const tok of toks) {
      if (tok.length >= 2 && tok.length <= 80) set.add(tok);
      if (set.size >= cap) break;
    }
    if (set.size >= cap) break;
  }
  return Array.from(set).slice(0, cap);
}

// The ADR-076 4-field body {summary, detail, labels, paths}.
function buildBody({ action, wilson, n, meanQuality, lastSeen, labels, paths }) {
  return {
    summary: `${action} — Wilson-bound success ${round(wilson, 4)} over ${n} samples`,
    detail: `samples=${n} mean_quality=${round(meanQuality, 3)} last_seen=${lastSeen || 'n/a'}`,
    labels: Array.isArray(labels) ? labels : [],
    paths: Array.isArray(paths) ? paths : [],
  };
}

// Serialise labels-and-paths-first (high-signal tokens front-loaded — map §4.1 step 2).
function serialiseBody(body) {
  const parts = [];
  if (body.labels && body.labels.length) parts.push(`labels: ${body.labels.join(' ')}`);
  if (body.paths && body.paths.length) parts.push(`paths: ${body.paths.join(' ')}`);
  if (body.summary) parts.push(body.summary);
  if (body.detail) parts.push(body.detail);
  return parts.join(' | ');
}

// metadata with the I18 provenance stamp. `provenance='judge:trajectory'` is
// load-bearing: only these rows are promotable (I18/I15 firewall).
function buildMetadata({ action, n, meanQuality, wilson, urn, body, halfLife }) {
  const md = {
    provenance: PROVENANCE,
    support_count: Number(n) || 0,
    mean_quality: round(meanQuality, 4),
    wilson: round(wilson, 4),
    cluster_key: action,
    recency_half_life_days: Number(halfLife) || null,
    labels: body.labels,
    paths: body.paths,
    body,
    distilled_at: new Date().toISOString(),
  };
  if (urn) md.urn = urn;
  return md;
}

// Best-effort canonical URN for provenance (I01). Never load-bearing.
function patternUrn(id) {
  try {
    const { mint } = require(join(REPO_DIR, 'management-api', 'lib', 'uris.js'));
    const pubkey = process.env.AGENTBOX_PUBKEY;
    return mint({ kind: 'memory', pubkey: /^[0-9a-fA-F]{64}$/.test(pubkey || '') ? pubkey : undefined, localId: id });
  } catch { return null; }
}

// ── DB queries ────────────────────────────────────────────────────────────────
const DISTILL_SQL = `
  SELECT action AS pattern,
         count(*)::bigint AS n,
         sum( power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - created_at)), 0)/86400.0/$1) ) AS w_total,
         sum( CASE WHEN quality >= 0.5
                   THEN power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - created_at)), 0)/86400.0/$1)
                   ELSE 0 END ) AS w_succ,
         avg(quality)::float AS mean_quality,
         to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen,
         (array_remove(array_agg(result ORDER BY created_at DESC), NULL))[1:8] AS sample_results
    FROM trajectory_steps
   WHERE action IS NOT NULL AND action <> '' AND quality IS NOT NULL
   GROUP BY action`;

const HWM_SQL = `
  SELECT count(*)::bigint AS total_steps,
         extract(epoch FROM max(created_at))::float8 AS hwm_epoch,
         to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hwm_ts
    FROM trajectory_steps
   WHERE action IS NOT NULL AND action <> '' AND quality IS NOT NULL`;

const UPSERT_SQL = `
  INSERT INTO patterns (id, project_id, type, pattern, confidence, metadata, source_db, embedding)
  VALUES ($1, NULL, $2, $3, $4, $5::jsonb, '${PATTERN_SOURCE_DB}', $6::ruvector(384))
  ON CONFLICT (id) DO UPDATE
    SET pattern = EXCLUDED.pattern,
        confidence = EXCLUDED.confidence,
        metadata = EXCLUDED.metadata,
        embedding = COALESCE(EXCLUDED.embedding, patterns.embedding),
        updated_at = NOW()`;

async function readCursor(memRetrieve) {
  const out = await memRetrieve(CURSOR_KEY, CURSOR_NS);
  if (!out || !out.success || !out.found || !out.value) return null;
  const v = out.value;
  const epoch = typeof v.cursor_epoch === 'number' ? v.cursor_epoch : Number(v.cursor_epoch);
  return { cursorEpoch: Number.isFinite(epoch) ? epoch : null, cursorAfter: v.cursor_after || null };
}

async function writeCursor(memStore, { hwmEpoch, hwmTs, stepsProcessed, patternsWritten, urn }) {
  const value = {
    cursor_after: hwmTs,
    cursor_epoch: hwmEpoch,
    run_urn: urn,
    steps_processed: stepsProcessed,
    patterns_written: patternsWritten,
    ended_at: new Date().toISOString(),
    summary: `Pattern-distillation cursor at ${hwmTs} (${stepsProcessed} steps seen, ${patternsWritten} patterns upserted).`,
  };
  return memStore(CURSOR_KEY, value, CURSOR_NS, {
    importance: 0,
    tags: [CURSOR_TAG],
    memory_type: 'semantic',
  });
}

function runUrn(seed) {
  const hash = sha12(String(seed));
  const local = `sha256-12-${hash}`;
  try {
    const { mint } = require(join(REPO_DIR, 'management-api', 'lib', 'uris.js'));
    const pubkey = process.env.AGENTBOX_PUBKEY;
    return mint({ kind: 'activity', pubkey: /^[0-9a-fA-F]{64}$/.test(pubkey || '') ? pubkey : undefined, localId: local });
  } catch { return `urn:agentbox:activity:local:${local}`; }
}

// Compute qualifying clusters from the grouped rows (pure over the SQL output).
function computeClusters(pgRows, minSamples, halfLife) {
  const out = [];
  for (const r of pgRows) {
    const n = parseInt(r.n, 10) || 0;
    if (!qualifies(n, minSamples)) continue;
    const wTotal = parseFloat(r.w_total) || 0;
    const wSucc = parseFloat(r.w_succ) || 0;
    const wilson = wilsonLower(wSucc, wTotal);
    const meanQuality = parseFloat(r.mean_quality) || 0;
    const lastSeen = r.last_seen || null;
    const labels = extractLabels(r.pattern);
    const paths = extractPaths(r.sample_results);
    const body = buildBody({ action: r.pattern, wilson, n, meanQuality, lastSeen, labels, paths });
    const id = distillId(r.pattern);
    out.push({
      id,
      action: r.pattern,
      type: deriveType(r.pattern),
      n, wilson, meanQuality, lastSeen,
      body,
      serialised: serialiseBody(body),
      metadata: buildMetadata({ action: r.pattern, n, meanQuality, wilson, urn: patternUrn(id), body, halfLife }),
    });
  }
  out.sort((a, b) => b.wilson - a.wilson || b.n - a.n);
  return out;
}

// Embed each cluster's serialised body; skip (never insert NULL-embedding) on
// embed failure. Returns { ready:[{...cluster, embVec}], embedFailed:n }.
async function embedClusters(clusters) {
  const ready = [];
  let embedFailed = 0;
  for (const c of clusters) {
    try {
      const emb = await getEmbedding(c.serialised.substring(0, 2000));
      ready.push({ ...c, embVec: vecToSql(emb) });
    } catch (e) {
      embedFailed++;
      log('WARN', `embedding failed for pattern "${c.action}" — skipped (no NULL-embedding insert): ${e.message}`);
    }
  }
  return { ready, embedFailed };
}

// ── one tick ──────────────────────────────────────────────────────────────────
// dryRun=true → compute + embed (to report the true embeddable yield) but write
// NOTHING. NEVER throws (quick-check fail-open, I21).
async function tick({ dryRun = false } = {}) {
  const urn = runUrn(`${Date.now()}:${process.pid}`);
  let pool;
  try {
    pool = makePool();
    const { memStore, memRetrieve } = cursorTools(pool);
    const halfLife = gateParams.recencyHalfLifeDays();
    const minSamples = Math.max(0, intGate('RUVECTOR_PATTERN_DISTILL_MIN_SAMPLES', gateParams.aggregateMinSamples()));

    const prev = await readCursor(memRetrieve);
    const hwmRes = await pool.query(HWM_SQL);
    const hwm = hwmRes.rows[0] || {};
    const totalSteps = parseInt(hwm.total_steps, 10) || 0;
    const hwmEpoch = hwm.hwm_epoch === null || hwm.hwm_epoch === undefined ? null : Number(hwm.hwm_epoch);
    const hwmTs = hwm.hwm_ts || null;

    emitEvent('DistillRunStarted', {
      run_urn: urn, cursor_before: prev ? prev.cursorAfter : null, dry_run: dryRun,
      min_samples: minSamples, half_life_days: halfLife,
    });

    if (totalSteps === 0 || hwmEpoch === null) {
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'empty-corpus' });
      return { status: 'skipped', reason: 'empty-corpus', runUrn: urn };
    }

    // Cursor gate (I21): no new steps → skip the whole idempotent recompute.
    if (!dryRun && prev && prev.cursorEpoch !== null && hwmEpoch <= prev.cursorEpoch) {
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'no-new-steps', cursor_epoch: prev.cursorEpoch, hwm_epoch: hwmEpoch });
      return { status: 'skipped', reason: 'no-new-steps', runUrn: urn, hwmTs };
    }

    const grouped = await pool.query(DISTILL_SQL, [halfLife]);
    const clusters = computeClusters(grouped.rows, minSamples, halfLife);

    if (!clusters.length) {
      const msg = `${grouped.rows.length} action-cluster(s); 0 clear the sample floor (n>=${minSamples}).`;
      if (dryRun) process.stdout.write(`\n[dry-run] ${msg} NOTHING to distil.\n`);
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'no-clusters-clear-floor', clusters_total: grouped.rows.length });
      return { status: dryRun ? 'dry-run' : 'skipped', reason: 'no-clusters-clear-floor', qualifying: 0, total: grouped.rows.length, runUrn: urn };
    }

    // Embed first (skip on fail) — never a NULL-embedding pattern (I03 intent).
    const xinfUp = await xinfEnsure();
    if (!xinfUp) {
      if (dryRun) {
        process.stdout.write(
          `\n[dry-run] ${grouped.rows.length} cluster(s); ${clusters.length} clear the floor (n>=${minSamples}). ` +
          `xinference unreachable — cannot embed, so 0 would actually upsert this tick.\n`,
        );
        printClusters(clusters, minSamples, halfLife);
        return { status: 'dry-run', qualifying: clusters.length, embeddable: 0, total: grouped.rows.length, runUrn: urn };
      }
      // Apply path: no embeddings possible → skip the whole tick, advance nothing.
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'xinference-unreachable' });
      return { status: 'skipped', reason: 'xinference-unreachable', runUrn: urn };
    }

    const { ready, embedFailed } = await embedClusters(clusters);

    if (dryRun) {
      process.stdout.write(
        `\n[dry-run] pattern distillation — half-life ${halfLife}d, sample floor ${minSamples}\n` +
        `[dry-run] cursor is at ${prev ? prev.cursorAfter : '(none)'}; would advance to ${hwmTs}\n` +
        `[dry-run] ${grouped.rows.length} cluster(s); ${clusters.length} clear the floor; ` +
        `${ready.length} embed cleanly → WOULD upsert ${ready.length} pattern(s) ` +
        `(provenance='${PROVENANCE}')${embedFailed ? `; ${embedFailed} skipped (embed fail)` : ''}. NOTHING written.\n`,
      );
      printClusters(clusters, minSamples, halfLife);
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'dry-run', qualifying: clusters.length, embeddable: ready.length });
      return { status: 'dry-run', qualifying: clusters.length, embeddable: ready.length, embedFailed, total: grouped.rows.length, hwmTs, runUrn: urn };
    }

    // Transactional upsert (I21): all-or-nothing; failure advances no cursor.
    let upserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of ready) {
        await client.query(UPSERT_SQL, [
          c.id, c.type, c.serialised, c.wilson, JSON.stringify(c.metadata), c.embVec,
        ]);
        upserted++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'upsert-failed', error: e.message });
      log('WARN', `batch upsert failed (rolled back, cursor unchanged): ${e.message}`);
      return { status: 'error', error: e.message, runUrn: urn };
    }
    client.release();

    // Advance the cursor only after a successful commit (governed write, I03).
    const cur = await writeCursor(memStore, {
      hwmEpoch, hwmTs, stepsProcessed: totalSteps, patternsWritten: upserted, urn,
    });
    if (!cur || !cur.success) {
      log('WARN', `cursor write failed: ${cur && cur.error} — next tick will recompute (idempotent upsert)`);
    }
    emitEvent('DistillRunCompleted', {
      run_urn: urn, cursor_after: hwmTs, patterns_upserted: upserted,
      clusters_total: grouped.rows.length, qualifying: clusters.length,
      embed_failed: embedFailed, provenance: PROVENANCE,
    });
    return { status: 'applied', upserted, qualifying: clusters.length, embedFailed, total: grouped.rows.length, hwmTs, runUrn: urn };
  } catch (err) {
    emitEvent('DistillRunSkipped', { run_urn: urn, reason: 'error', error: err.message });
    log('WARN', `tick failed (fail-open, cursor unchanged): ${err.stack || err.message}`);
    return { status: 'error', error: err.message, runUrn: urn };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

function printClusters(clusters, minSamples, halfLife) {
  const w = process.stdout;
  w.write(`\nDistillation candidates — Wilson recency half-life ${halfLife}d, sample floor ${minSamples}\n`);
  const P = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n); };
  w.write(`  ${P('id', 26)} ${P('type', 10)} ${P('n', 5)} ${P('wilson', 8)} ${P('labels', 22)} paths\n`);
  w.write(`  ${'-'.repeat(26)} ${'-'.repeat(10)} ${'-'.repeat(5)} ${'-'.repeat(8)} ${'-'.repeat(22)} -----\n`);
  for (const c of clusters) {
    w.write(`  ${P(c.id, 26)} ${P(c.type, 10)} ${P(c.n, 5)} ${P(round(c.wilson, 4), 8)} ${P((c.body.labels || []).join(','), 22)} ${(c.body.paths || []).slice(0, 3).join(',')}\n`);
  }
  w.write('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mainApply() {
  if (!boolGate('RUVECTOR_PATTERN_DISTILLATION')) {
    log('INFO', 'RUVECTOR_PATTERN_DISTILLATION is off — exiting (no-op). ' +
      'Enable [memory_learning].pattern_distillation and reboot, or use --dry-run to inspect.');
    return 0;
  }
  const r = await tick({ dryRun: false });
  process.stdout.write(`pattern-distill --apply: ${r.status}${r.status === 'applied' ? ` (${r.upserted} pattern(s), cursor@${r.hwmTs})` : r.reason ? ` (${r.reason})` : ''}.\n`);
  return 0;
}

async function mainDryRun() {
  const r = await tick({ dryRun: true });
  return r.status === 'error' ? 1 : 0;
}

async function mainLoop() {
  let running = true;
  const stop = (sig) => { log('INFO', `${sig} received — exiting loop after current tick.`); running = false; };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log('INFO', 'pattern-distillation loop starting.');
  while (running) {
    if (!boolGate('RUVECTOR_PATTERN_DISTILLATION')) {
      log('INFO', 'RUVECTOR_PATTERN_DISTILLATION is off — exiting loop (no-op).');
      return 0;
    }
    const r = await tick({ dryRun: false });
    log('INFO', `tick: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.status === 'applied' ? ` — ${r.upserted} pattern(s)` : ''}.`);
    if (!running) break;
    const mins = Math.max(1, intGate('RUVECTOR_PATTERN_DISTILL_INTERVAL_MINS', 60));
    const until = Date.now() + mins * 60_000;
    while (running && Date.now() < until) await sleep(Math.min(1000, until - Date.now()));
  }
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  if (has('-h') || has('--help')) {
    process.stdout.write(
      'Usage: ruvector-pattern-distill.mjs [--dry-run|--apply|--once|--loop]\n' +
      '  (default)   dry-run: compute + print candidates, write NOTHING (ungated)\n' +
      '  --dry-run   same as default (ungated, read-only)\n' +
      '  --apply     one gated tick, upsert patterns (gate: RUVECTOR_PATTERN_DISTILLATION)\n' +
      '  --once      alias for --apply\n' +
      '  --loop      gated ticks every RUVECTOR_PATTERN_DISTILL_INTERVAL_MINS (default 60)\n',
    );
    return 0;
  }
  if (has('--loop')) return mainLoop();
  if (has('--apply') || has('--once')) return mainApply();
  // bare default and --dry-run both run the read-only dry-run.
  return mainDryRun();
}

const isDirect = (() => {
  try { return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (isDirect) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((e) => { log('ERROR', e.stack || e.message); process.exit(1); });
}

export {
  CURSOR_KEY, CURSOR_NS, CURSOR_TAG, PROVENANCE, PATTERN_SOURCE_DB,
  sha12, distillId, qualifies, deriveType, extractLabels, extractPaths,
  buildBody, serialiseBody, buildMetadata, computeClusters,
};
