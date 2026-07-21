#!/usr/bin/env node
// @ts-nocheck
/**
 * ruvector-aggregate-sweep.mjs — the scheduled aggregation sweep (W-A / ADR-040 D1).
 *
 * This is the *execution surface* ADR-036 D1 specified but never shipped: a
 * scheduled, incremental, non-destructive Wilson-lower-bound + recency-decay
 * sweep that closes the severed learning wire (`memory-learning-aggregates` = 0
 * rows on 2026-07-21). It is a THIN wrapper — it does NOT reimplement the maths.
 * The Wilson bound, the recency half-life decay, the `GROUP BY action` grouping
 * and the sample floor all live in `mcp/servers/lib/aggregate-effectiveness.js`
 * (ADR-036 D1 / DDD-016 §4.3); this sweep only adds the scheduler, the
 * incremental cursor and the master gate.
 *
 * Binding decisions realised here (WF1 implementation map §2):
 *   • REUSE, don't reimplement: aggregate rows are produced by
 *     `aggregate-effectiveness.js` `run({ apply: true })`, which writes through
 *     the governed `createMemoryTools({ backend: 'external-pg' }).memStore` path
 *     — Xinference embed (DDD-016 I03) + PROTECTED_NAMESPACES guard (I-GOV/R02).
 *     No raw SQL write ever leaves this process (I03).
 *   • Incremental cursor on `max(created_at)` (I21). `trajectory_steps.id` is
 *     `text` (non-monotonic), so the ADR/DDD "max(id) high-water mark" does not
 *     apply to this schema — the cursor binds on the `created_at` timestamp
 *     (verified live 2026-07-21; WF1 map G3 / R-G3). The cursor is stored as
 *     ordinary governed memory metadata (via `memStore`, never raw SQL — I03),
 *     one row keyed `__aggregation_sweep_cursor__` in `memory-learning-aggregates`
 *     tagged `sweep:cursor` so consumers (which filter on `action:*` tags /
 *     `effectiveness-` key prefix) never surface it as an aggregate.
 *   • Idempotent + non-destructive: `run()` upserts content-addressed aggregate
 *     rows (`ON CONFLICT DO UPDATE`); a second tick over an unchanged corpus
 *     writes NOTHING (the cursor gates the whole recompute — PRD-020 metric 2).
 *     The sweep never mutates `trajectory_steps`.
 *   • quick-check gated + fail-open (I21): a failed/recovering DB skips the tick,
 *     advances no cursor, and retries next tick. Safe to launch unconditionally.
 *   • Self-gating (default off): if `RUVECTOR_AGGREGATE_SWEEP` is not on the
 *     process exits fast without touching the store — launching this script is a
 *     no-op until an operator sets `[memory_learning].aggregate_sweep = true` and
 *     the container reboots (`.mcp.json` re-injected). Default state stays
 *     byte-identical (PRD-020 metric 1).
 *
 * Modes:
 *   node ruvector-aggregate-sweep.mjs --once      # one gated tick, then exit
 *   node ruvector-aggregate-sweep.mjs --loop      # gated ticks every interval_mins
 *   node ruvector-aggregate-sweep.mjs --dry-run   # compute + print, write NOTHING
 *                                                 # (ungated; read-only inspection)
 *
 * Config (resolved from the injected .mcp.json env, or the process env when the
 * caller supplies it — mirrors aggregate-effectiveness.js / ruvector-sidecar-
 * update.sh discovery). Read via the already-exported gate accessors so this
 * sweep lands independently of the gates-implementer (WF1 map §2.4 / R-W1):
 *   RUVECTOR_AGGREGATE_SWEEP               bool  master gate (default off)
 *   RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS int   loop cadence (default 30)
 *   RUVECTOR_AGGREGATE_MIN_SAMPLES         int   sample floor (default 20)  [lib]
 *   RUVECTOR_RECENCY_HALF_LIFE_DAYS        int   half-life days (default 14)[lib]
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SCHEDULING ARTEFACTS (WF1 map §4 — this file is the sole durable landing).
 *
 * (a) LIVE container NOW (WF1 map §4.1). supervisord.conf in the live container
 *     is a read-only nix-store symlink with no [include] and no cron (map G5), so
 *     the sweep is NOT a supervisord program at runtime. The live mechanism is a
 *     detached self-loop, gated-off by default (relaunch after a container
 *     restart — R-S2, acceptable for Phase 0):
 *
 *       setsid node /home/devuser/workspace/project/agentbox/scripts/ruvector-aggregate-sweep.mjs --loop \
 *         >>/var/log/ruvector-aggregate-sweep.log 2>&1 &
 *
 *     Manual single tick for verification:
 *       node scripts/ruvector-aggregate-sweep.mjs --once
 *     Read-only yield inspection (writes nothing, ungated):
 *       node scripts/ruvector-aggregate-sweep.mjs --dry-run
 *
 * (b) FUTURE image build (WF1 map §4.2). The durable supervisord program is a
 *     flake.nix edit — flake.nix carries other sessions' staged work, so it is
 *     QUEEN-APPLIED at integration, not a parallel-implementer edit (R-S1). Add
 *     this exact block to the main-container [program:*] set (~line 1620, near
 *     comfyui-builtin). No `environment=` plumbing is needed: the script resolves
 *     its gate/interval from .mcp.json itself.
 *
 *       [program:ruvector-aggregate-sweep]
 *       command=node /opt/agentbox/scripts/ruvector-aggregate-sweep.mjs --loop
 *       user=devuser
 *       autostart=true            ; safe: self-gates on RUVECTOR_AGGREGATE_SWEEP, exits fast when off
 *       autorestart=true
 *       startsecs=0
 *       stdout_logfile=/var/log/ruvector-aggregate-sweep.log
 *       stderr_logfile=/var/log/ruvector-aggregate-sweep.error.log
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

const CURSOR_KEY = '__aggregation_sweep_cursor__';
const CURSOR_TAG = 'sweep:cursor';
const WRITE_SOURCE_TYPE = 'agentbox';
const EMBEDDING_DIM = 384;

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [aggregate-sweep] ${msg}\n`);
}

// Structured domain-event line on stderr (DDD-018 §6). Never load-bearing —
// purely operator-visible provenance for the sweep's decisions.
function emitEvent(event, fields) {
  process.stderr.write(`[${new Date().toISOString()}] EVENT [aggregate-sweep] ${event} ${JSON.stringify(fields)}\n`);
}

// ── env bootstrap ─────────────────────────────────────────────────────────────
// Resolve the governed MCP env from the first .mcp.json that carries a
// claude-flow env block — the same discovery ruvector-sidecar-update.sh's
// mcp_env_pairs() uses. Existing process env WINS (an explicit `env … node …`
// launch by the sidecar wrapper is authoritative; a bare supervisord/setsid
// launch falls back to .mcp.json). Must run BEFORE the CJS libs are required,
// because memory-tools.js reads PROTECTED_NAMESPACES at module-init time.
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

// The aggregate + cursor writes both key on typed metadata (feed_retrieval keys
// on metadata.tags, feed_routing surfaces importance, and the cursor is filtered
// by its `sweep:cursor` tag). Force the typed-metadata gate on for THIS process's
// governed writes, exactly as aggregate-effectiveness.js run() does (WF1 §2.4).
if (process.env.RUVECTOR_TYPED_METADATA !== '1' && process.env.RUVECTOR_TYPED_METADATA !== 'true') {
  process.env.RUVECTOR_TYPED_METADATA = '1';
}

// ── CJS libs (required AFTER env bootstrap) ─────────────────────────────────────
const { run: aggregateRun, AGG_NAMESPACE } = require(join(LIB_DIR, 'aggregate-effectiveness.js'));
const { createMemoryTools } = require(join(LIB_DIR, 'memory-tools.js'));
const { boolGate, intGate } = require(join(LIB_DIR, 'ruvector-gates.js'));

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
// Needed only to keep the cursor write on the governed embedded path (I03); the
// aggregate rows are embedded by aggregate-effectiveness.js's own transport.
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

// Governed memory tools bound to a live pool — the SAME external-pg path the MCP
// server uses. Used only for the cursor row read/write (the aggregate rows go
// through aggregate-effectiveness.js's own bound memStore).
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

// Best-effort activity URN for the run receipt (I01). Never load-bearing.
function runUrn(seed) {
  const hash = crypto.createHash('sha256').update(String(seed), 'utf8').digest('hex').slice(0, 12);
  const local = `sha256-12-${hash}`;
  try {
    const { mint } = require(join(REPO_DIR, 'management-api', 'lib', 'uris.js'));
    const pubkey = process.env.AGENTBOX_PUBKEY;
    return mint({ kind: 'activity', pubkey: /^[0-9a-fA-F]{64}$/.test(pubkey || '') ? pubkey : undefined, localId: local });
  } catch { return `urn:agentbox:activity:local:${local}`; }
}

// ── high-water mark (I20 / R-G3: bind on created_at, never the text id) ─────────
// Both hwm_epoch (comparison) and hwm_ts (human-readable) come from the same
// session expression, so the cursor comparison is timezone-agnostic by
// construction — no JS Date/tz round-trip enters the gate decision.
async function readHighWater(pool) {
  const res = await pool.query(
    `SELECT count(*)::bigint                                   AS total_steps,
            extract(epoch FROM max(created_at))::float8        AS hwm_epoch,
            to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hwm_ts
       FROM trajectory_steps
      WHERE action IS NOT NULL AND action <> ''`,
  );
  const r = res.rows[0] || {};
  return {
    totalSteps: parseInt(r.total_steps, 10) || 0,
    hwmEpoch: r.hwm_epoch === null || r.hwm_epoch === undefined ? null : Number(r.hwm_epoch),
    hwmTs: r.hwm_ts || null,
  };
}

async function readCursor(memRetrieve) {
  const out = await memRetrieve(CURSOR_KEY, AGG_NAMESPACE);
  if (!out || !out.success || !out.found || !out.value) return null;
  const v = out.value;
  const epoch = typeof v.cursor_epoch === 'number' ? v.cursor_epoch : Number(v.cursor_epoch);
  return { cursorEpoch: Number.isFinite(epoch) ? epoch : null, cursorAfter: v.cursor_after || null };
}

async function writeCursor(memStore, { hwmEpoch, hwmTs, stepsProcessed, aggregatesWritten, urn }) {
  const value = {
    cursor_after: hwmTs,          // ISO max(created_at) — human-readable
    cursor_epoch: hwmEpoch,       // load-bearing comparison key (I21)
    run_urn: urn,
    steps_processed: stepsProcessed,
    aggregates_written: aggregatesWritten,
    ended_at: new Date().toISOString(),
    summary: `Aggregation sweep cursor at ${hwmTs} (${stepsProcessed} steps seen, ${aggregatesWritten} aggregates written).`,
  };
  return memStore(CURSOR_KEY, value, AGG_NAMESPACE, {
    importance: 0,                // not an effectiveness signal
    tags: [CURSOR_TAG],           // consumers filter action:* — cursor never surfaces
    memory_type: 'semantic',
  });
}

// ── one tick ────────────────────────────────────────────────────────────────
// Returns a small status object; NEVER throws (quick-check fail-open, I21).
async function tick({ dryRun = false } = {}) {
  const urn = runUrn(`${Date.now()}:${process.pid}`);
  let pool;
  try {
    pool = makePool();
    const { memStore, memRetrieve } = cursorTools(pool);

    const prev = await readCursor(memRetrieve);
    const hwm = await readHighWater(pool);
    emitEvent('AggregationRunStarted', {
      run_urn: urn, cursor_before: prev ? prev.cursorAfter : null, dry_run: dryRun,
    });

    if (hwm.totalSteps === 0 || hwm.hwmEpoch === null) {
      emitEvent('AggregationRunSkipped', { run_urn: urn, reason: 'empty-corpus' });
      return { status: 'skipped', reason: 'empty-corpus', runUrn: urn };
    }

    // Cursor gate (I21): no new steps since the last processed high-water mark →
    // skip the whole recompute, advance nothing (PRD-020 metric 2). The Wilson
    // bound is recency-weighted over each pattern's FULL history, so a delta-only
    // recompute would be wrong — the honest "incremental" is to gate the full
    // (idempotent) recompute on the cursor.
    if (!dryRun && prev && prev.cursorEpoch !== null && hwm.hwmEpoch <= prev.cursorEpoch) {
      emitEvent('AggregationRunSkipped', {
        run_urn: urn, reason: 'no-new-steps', cursor_epoch: prev.cursorEpoch, hwm_epoch: hwm.hwmEpoch,
      });
      return { status: 'skipped', reason: 'no-new-steps', runUrn: urn, hwmTs: hwm.hwmTs };
    }

    // Full recompute (idempotent upsert). aggregate-effectiveness.js run() owns
    // its own pool + governed memStore; --dry-run passes apply:false so it
    // computes + prints the per-pattern table and writes NOTHING.
    const res = await aggregateRun({ apply: !dryRun });

    if (dryRun) {
      const wouldAdvanceTo = prev && prev.cursorEpoch !== null && hwm.hwmEpoch <= prev.cursorEpoch
        ? '(unchanged — cursor already at/after hwm)'
        : hwm.hwmTs;
      process.stdout.write(
        `\n[dry-run] cursor is at ${prev ? prev.cursorAfter : '(none)'}; ` +
        `would advance to ${wouldAdvanceTo}\n` +
        `[dry-run] ${res.total} action-pattern(s); ${res.eligible} clear the sample floor (n>=${res.minSamples}); ` +
        `${res.skipped} below floor. NOTHING written (aggregates or cursor).\n`,
      );
      emitEvent('AggregationRunSkipped', { run_urn: urn, reason: 'dry-run', patterns: res.total, eligible: res.eligible });
      return { status: 'dry-run', ...res, hwmTs: hwm.hwmTs, runUrn: urn };
    }

    // Advance the cursor only after a successful apply (governed write, I03).
    const cur = await writeCursor(memStore, {
      hwmEpoch: hwm.hwmEpoch, hwmTs: hwm.hwmTs,
      stepsProcessed: hwm.totalSteps, aggregatesWritten: res.stored, urn,
    });
    if (!cur || !cur.success) {
      // Aggregates are already upserted (idempotent); a failed cursor write just
      // means next tick re-runs the same recompute. Non-fatal — do not throw.
      log('WARN', `cursor write failed: ${cur && cur.error} — next tick will recompute (idempotent)`);
    }
    emitEvent('AggregationRunCompleted', {
      run_urn: urn, cursor_after: hwm.hwmTs, steps_processed: hwm.totalSteps,
      aggregates_written: res.stored, patterns: res.total, eligible: res.eligible,
      embed_failed: res.embedFailed,
    });
    return { status: 'applied', ...res, hwmTs: hwm.hwmTs, runUrn: urn };
  } catch (err) {
    // quick-check fail-open (I21): a failed/recovering DB skips this tick,
    // advances no cursor, and retries next tick. Never propagate.
    emitEvent('AggregationRunSkipped', { run_urn: urn, reason: 'error', error: err.message });
    log('WARN', `tick failed (fail-open, cursor unchanged): ${err.stack || err.message}`);
    return { status: 'error', error: err.message, runUrn: urn };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mainOnce() {
  if (!boolGate('RUVECTOR_AGGREGATE_SWEEP')) {
    log('INFO', 'RUVECTOR_AGGREGATE_SWEEP is off — exiting (no-op). ' +
      'Enable [memory_learning].aggregate_sweep and reboot, or use --dry-run to inspect.');
    return 0;
  }
  const r = await tick({ dryRun: false });
  process.stdout.write(`sweep --once: ${r.status}${r.status === 'applied' ? ` (${r.stored} aggregates, cursor@${r.hwmTs})` : r.reason ? ` (${r.reason})` : ''}.\n`);
  return 0;
}

async function mainDryRun() {
  // Ungated: read-only inspection of the yield, safe regardless of gate state.
  const r = await tick({ dryRun: true });
  return r.status === 'error' ? 1 : 0;
}

async function mainLoop() {
  let running = true;
  const stop = (sig) => { log('INFO', `${sig} received — exiting loop after current tick.`); running = false; };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log('INFO', 'aggregate sweep loop starting.');
  while (running) {
    if (!boolGate('RUVECTOR_AGGREGATE_SWEEP')) {
      log('INFO', 'RUVECTOR_AGGREGATE_SWEEP is off — exiting loop (no-op).');
      return 0;
    }
    const r = await tick({ dryRun: false });
    log('INFO', `tick: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.status === 'applied' ? ` — ${r.stored} aggregates` : ''}.`);
    if (!running) break;
    const mins = Math.max(1, intGate('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', 30));
    // Sleep in short slices so a stop signal is honoured promptly.
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
      'Usage: ruvector-aggregate-sweep.mjs [--once|--loop|--dry-run]\n' +
      '  --once      one gated tick, then exit (gate: RUVECTOR_AGGREGATE_SWEEP)\n' +
      '  --loop      gated ticks every RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS (default 30)\n' +
      '  --dry-run   compute + print the yield, write NOTHING (ungated, read-only)\n',
    );
    return 0;
  }
  if (has('--dry-run')) return mainDryRun();
  if (has('--loop')) return mainLoop();
  // default and --once both run a single gated tick.
  return mainOnce();
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => { log('ERROR', e.stack || e.message); process.exit(1); });
