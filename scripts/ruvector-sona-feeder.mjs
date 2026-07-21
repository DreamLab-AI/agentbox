#!/usr/bin/env node
// @ts-nocheck
/**
 * ruvector-sona-feeder.mjs — the scheduled SONA learn feeder (W-C / ADR-040 D4).
 *
 * This is implementer-B's half of D4 (SONA learn+apply+health). It reads the
 * judged trajectory corpus (`trajectories` + `trajectory_steps`) and streams it,
 * one trajectory at a time, into the ruvector SONA engine via the confirmed live
 * function `ruvector_sona_learn(table_name text, trajectory_json jsonb)`
 * (WF2 map V4). It is a THIN feeder — it does NOT reimplement any learning maths;
 * the engine owns that. This script only adds: the schedule, the incremental
 * cursor, the master gate, restart self-healing, and the trajectory_json builder.
 *
 * Binding decisions realised here (WF2 implementation map §3.1):
 *   • SCOPE is one fixed global string 'agentbox_memory' (map §3.1). It is the
 *     `table_name` argument to ruvector_sona_learn / _apply / _stats. It is the
 *     SAME string implementer-A wires into sona_apply/sona_health (map §3.2/§3.3)
 *     — the A↔B contract. The scope is 384-dim ONLY; a future 1024-dim migration
 *     (W-D) mints a FRESH scope string, never reusing 'agentbox_memory' across
 *     dimensions (I22). The dimension tag (embedding_dim:384) is recorded in the
 *     CURSOR VALUE, per I22 "dimension-tagged" — the tag lives in metadata, the
 *     scope string stays stable until a real dimension migration.
 *       NOTE (queen decision): the WF2 task brief paraphrased this as
 *       table_name 'agentbox_memory_384'. The BINDING map §3.2/§3.3 hardcode the
 *       literal 'agentbox_memory' for the apply/health calls implementer-A owns;
 *       a divergent feeder scope would silently decouple the learn side from the
 *       apply/health side (a defect). This feeder therefore uses SONA_SCOPE below
 *       and dimension-tags in the cursor. Flip SONA_SCOPE only in lock-step with
 *       implementer-A's memory-tools.js/ruvector-mcp.cjs strings.
 *   • REUSE the governed embedding transport: step/task text is embedded via
 *     Xinference (bge-small-en-v1.5, 384-dim — the ACTIVE column model), the same
 *     transport aggregate-effectiveness.js / ruvector-aggregate-sweep.mjs use.
 *   • The cursor is stored as ordinary governed memory metadata through the
 *     `createMemoryTools({backend:'external-pg'}).memStore` path — NEVER a raw
 *     NULL-embedding INSERT (DDD-016 I03). Distinct key '__sona_learn_cursor__'
 *     in namespace 'memory-learning-aggregates', tagged 'sona:cursor' so aggregate
 *     consumers (which filter action:* / effectiveness- keys) never surface it.
 *     It is NOT the aggregation cursor and NOT the distillation cursor (R-C8).
 *   • Incremental + tie-safe: the cursor is a COMPOUND (ended_at, id) key. The
 *     primary axis is `trajectories.ended_at` (monotonic timestamp — WF1 G3 forbids
 *     the text `id` as a monotonic key); `id` only breaks exact-timestamp ties so a
 *     batch boundary can never split a tie group and drop a trajectory. ruvector
 *     SONA learn is ADDITIVE (non-idempotent) — feeding a trajectory twice
 *     double-counts — so exactness of the cursor matters (unlike the idempotent
 *     aggregate upsert). Timestamp comparison (not epoch-float) keeps it exact.
 *   • Restart self-healing (R-C3, MANDATORY, reconciled with V5): SONA engine
 *     state is in-process (DashMap, V6) and wiped on every ruvector-postgres
 *     restart. Each tick, before feeding, we read ruvector_sona_stats. If the
 *     cursor is advanced (prior feeds happened) but the engine looks empty
 *     (trajectories_buffered + patterns_stored == 0) we RESET the cursor and
 *     re-feed from the start (SonaEngineReseeded).
 *       IMPORTANT reconciliation with WF2 V5/R-C2: the exposed SONA surface
 *       hardcodes embedding_dim=256 and does NOT accumulate buffered/stored
 *       counters for 384-dim learns (verified live: a real 384-dim learn returns
 *       status:'learned' yet leaves buffered/stored at 0). So `buffered+stored==0`
 *       is ALSO the steady state of a healthy-but-just-fed 384-dim scope — keying
 *       reseed on it ALONE would hot-loop (reset + re-feed all 405 every tick).
 *       We therefore guard reseed with a once-per-process latch (`reseeded`): a
 *       fresh process (i.e. a possible sidecar restart — V6 couples them) reseeds
 *       ONCE and then advances incrementally; it never hot-loops within a process.
 *       This preserves the convergence intent while staying correct under V5.
 *   • quick-check gated + fail-open (I21/I14): Xinference down → skip the whole
 *     tick (advance nothing, retry next tick). A single malformed trajectory
 *     (embed/learn throws) is logged and skipped per-datum; the cursor still
 *     advances past it (map §3.1 "logs + continues"). Never propagate.
 *   • Self-gating (default off): RUVECTOR_SONA_LEARN_ENABLED off → the process
 *     exits fast without touching the engine. Launching this script is a no-op
 *     until an operator sets [memory_learning].sona_learn_enabled = true and the
 *     container reboots (.mcp.json re-injected — the queen wires that env, R-C6).
 *     Default state stays byte-identical (PRD-020 metric 1).
 *
 * Modes:
 *   node ruvector-sona-feeder.mjs --once      # one gated tick, then exit
 *   node ruvector-sona-feeder.mjs --loop      # gated ticks every interval_mins
 *   node ruvector-sona-feeder.mjs --dry-run   # count the yield + shape-proof a
 *                                             # small sample; NEVER calls learn or
 *                                             # stats (read-only, ungated)
 *
 * Config (resolved from the injected .mcp.json env, mirrors the sweep):
 *   RUVECTOR_SONA_LEARN_ENABLED             bool  master gate (default off)
 *   RUVECTOR_SONA_LEARN_INTERVAL_MINS       int   loop cadence (default 30)
 *   RUVECTOR_SONA_LEARN_BATCH               int   trajectories per tick (default 50)
 *   RUVECTOR_SONA_LEARN_DRYRUN_SAMPLE       int   dry-run shape-proof sample (default 2)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SCHEDULING ARTEFACTS (WF2 map §3.1 — this file is the sole durable landing).
 *
 * (a) LIVE container NOW: a detached self-loop, gated-off by default (relaunch
 *     after a container restart — acceptable for Phase C; a modest cadence keeps
 *     the ephemeral engine warm):
 *
 *       setsid node /home/devuser/workspace/project/agentbox/scripts/ruvector-sona-feeder.mjs --loop \
 *         >>/var/log/ruvector-sona-feeder.log 2>&1 &
 *
 *     Manual single tick:      node scripts/ruvector-sona-feeder.mjs --once
 *     Read-only yield inspect: node scripts/ruvector-sona-feeder.mjs --dry-run
 *
 * (b) FUTURE image build (QUEEN-APPLIED — flake.nix carries other sessions' staged
 *     work; a parallel implementer must NOT edit it). Add this exact block to the
 *     main-container [program:*] set (near ruvector-aggregate-sweep):
 *
 *       [program:ruvector-sona-feeder]
 *       command=node /opt/agentbox/scripts/ruvector-sona-feeder.mjs --loop
 *       user=devuser
 *       autostart=true            ; safe: self-gates on RUVECTOR_SONA_LEARN_ENABLED, exits fast when off
 *       autorestart=true
 *       startsecs=0
 *       stdout_logfile=/var/log/ruvector-sona-feeder.log
 *       stderr_logfile=/var/log/ruvector-sona-feeder.error.log
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

// ── SONA scope + cursor constants (WF2 map §3.1) ────────────────────────────────
const SONA_SCOPE = 'agentbox_memory';          // ruvector_sona_learn table_name arg (A↔B contract)
const SONA_EMBEDDING_DIM = 384;                // dimension tag recorded in the cursor (I22)
const CURSOR_KEY = '__sona_learn_cursor__';
const CURSOR_NS = 'memory-learning-aggregates';
const CURSOR_TAG = 'sona:cursor';
const WRITE_SOURCE_TYPE = 'agentbox';
const EMBEDDING_DIM = 384;

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [sona-feeder] ${msg}\n`);
}
function emitEvent(event, fields) {
  process.stderr.write(`[${new Date().toISOString()}] EVENT [sona-feeder] ${event} ${JSON.stringify(fields)}\n`);
}

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

// The cursor write keys on typed metadata (the 'sona:cursor' tag). Force the typed
// metadata gate on for THIS process's governed cursor writes, exactly as the sweep
// and aggregate-effectiveness.js do (scoped to this process only).
if (process.env.RUVECTOR_TYPED_METADATA !== '1' && process.env.RUVECTOR_TYPED_METADATA !== 'true') {
  process.env.RUVECTOR_TYPED_METADATA = '1';
}

// ── CJS libs (required AFTER env bootstrap) ─────────────────────────────────────
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

function runUrn(seed) {
  const hash = crypto.createHash('sha256').update(String(seed), 'utf8').digest('hex').slice(0, 12);
  const local = `sha256-12-${hash}`;
  try {
    const { mint } = require(join(REPO_DIR, 'management-api', 'lib', 'uris.js'));
    const pubkey = process.env.AGENTBOX_PUBKEY;
    return mint({ kind: 'activity', pubkey: /^[0-9a-fA-F]{64}$/.test(pubkey || '') ? pubkey : undefined, localId: local });
  } catch { return `urn:agentbox:activity:local:${local}`; }
}

// ── PURE trajectory_json builders (exported for unit tests — no DB, no network) ──

// Rewards are trajectory_steps.quality, already 0..1; NULL → 0.0. Clamp defensively.
function clampReward(q) {
  if (q === null || q === undefined) return 0.0;
  const n = Number(q);
  if (!Number.isFinite(n)) return 0.0;
  return Math.min(1, Math.max(0, n));
}

// final_reward rollup (map §3.1): success true → 1.0, false → 0.0, else mean(quality)
// over the judged steps (default 0.5 when there is nothing to average).
function computeFinalReward(success, qualities) {
  if (success === true) return 1.0;
  if (success === false) return 0.0;
  const vals = (Array.isArray(qualities) ? qualities : [])
    .map((q) => Number(q)).filter((n) => Number.isFinite(n));
  if (!vals.length) return 0.5;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.min(1, Math.max(0, mean));
}

// Assemble the CONFIRMED live trajectory_json shape (WF2 map V4):
//   { initial:[…]?, steps:[{ embedding:[…], reward:f }], final_reward:f }
// attention_weights is OMITTED (no agentbox concept map; the function defaults it
// empty — map §3.1 / V4). `initial` is omitted when no initial embedding exists.
function assembleTrajectoryJson({ initialEmb, stepEntries, finalReward }) {
  const steps = (Array.isArray(stepEntries) ? stepEntries : []).map((s) => ({
    embedding: s.embedding,
    reward: clampReward(s.reward),
  }));
  const out = { steps, final_reward: Math.min(1, Math.max(0, Number(finalReward) || 0)) };
  if (Array.isArray(initialEmb) && initialEmb.length) out.initial = initialEmb;
  return out;
}

// ── PURE cursor helpers (exported for unit tests) ───────────────────────────────

// Compound (ended_at, id) strict-after ordering. `a` advances beyond `b` iff its
// timestamp is later, or the timestamps tie and its id sorts later. Primary axis is
// the monotonic timestamp; id is only the tie-break (WF1 G3: id is not monotonic).
function cursorAdvances(a, b) {
  if (!b || b.cursorAfter == null) return true;               // no prior cursor
  if (a.endedTs > b.cursorAfter) return true;
  if (a.endedTs < b.cursorAfter) return false;
  return String(a.trajId) > String(b.cursorId || '');
}

// Self-heal decision (R-C3, reconciled with V5). Reseed iff the cursor is advanced
// (prior feeds happened) AND the engine looks empty AND we have not already
// reseeded in THIS process lifetime (the latch that prevents the V5 hot-loop —
// see the header). `stats` is the ruvector_sona_stats jsonb (or null on failure).
function shouldReseed({ cursor, stats, alreadyReseeded }) {
  if (alreadyReseeded) return false;
  if (!cursor || cursor.cursorAfter == null) return false;    // never fed yet
  if (!stats || typeof stats !== 'object') return false;      // no signal → do not thrash
  const buffered = Number(stats.trajectories_buffered) || 0;
  const stored = Number(stats.patterns_stored) || 0;
  return (buffered + stored) === 0;
}

// ── DB access ───────────────────────────────────────────────────────────────────
const FEED_SQL = `
  SELECT t.id AS traj_id, t.task, t.success,
         to_char(t.ended_at, 'YYYY-MM-DD HH24:MI:SS.US') AS ended_ts,
         extract(epoch FROM t.ended_at)::float8            AS ended_epoch
    FROM trajectories t
   WHERE t.ended_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM trajectory_steps s
                  WHERE s.trajectory_id = t.id
                    AND s.action IS NOT NULL AND s.action <> ''
                    AND s.quality IS NOT NULL)
     AND ($1::text IS NULL OR (
            t.ended_at > $1::timestamp
            OR (t.ended_at = $1::timestamp AND t.id > $2::text)
         ))
   ORDER BY t.ended_at ASC, t.id ASC
   LIMIT $3`;

const STEPS_SQL = `
  SELECT action, result, quality, step_order
    FROM trajectory_steps
   WHERE trajectory_id = $1
     AND action IS NOT NULL AND action <> ''
     AND quality IS NOT NULL
   ORDER BY step_order ASC NULLS LAST, created_at ASC`;

const YIELD_SQL = `
  SELECT count(*)::int AS traj_ct,
         coalesce(sum(sc), 0)::int AS step_ct
    FROM (
      SELECT t.id,
             (SELECT count(*) FROM trajectory_steps s
               WHERE s.trajectory_id = t.id
                 AND s.action IS NOT NULL AND s.action <> ''
                 AND s.quality IS NOT NULL) AS sc
        FROM trajectories t
       WHERE t.ended_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM trajectory_steps s
                      WHERE s.trajectory_id = t.id
                        AND s.action IS NOT NULL AND s.action <> ''
                        AND s.quality IS NOT NULL)
         AND ($1::text IS NULL OR (
                t.ended_at > $1::timestamp
                OR (t.ended_at = $1::timestamp AND t.id > $2::text)
             ))
    ) q`;

async function readCursor(memRetrieve) {
  const out = await memRetrieve(CURSOR_KEY, CURSOR_NS);
  if (!out || !out.success || !out.found || !out.value) return null;
  const v = out.value;
  return {
    cursorAfter: v.cursor_after || null,       // load-bearing timestamp string
    cursorId: v.cursor_id || '',
    cursorEpoch: typeof v.cursor_epoch === 'number' ? v.cursor_epoch : null,
  };
}

async function writeCursor(memStore, { endedTs, trajId, endedEpoch, trajectoriesFed, urn }) {
  const value = {
    cursor_after: endedTs,                     // 'YYYY-MM-DD HH24:MI:SS.US' (load-bearing)
    cursor_id: trajId,                         // tie-break within an equal timestamp
    cursor_epoch: endedEpoch,                  // informational mirror
    scope: SONA_SCOPE,                         // I22 dimension-tag: scope string …
    embedding_dim: SONA_EMBEDDING_DIM,         // … + explicit 384-dim tag
    trajectories_fed: trajectoriesFed,
    run_urn: urn,
    ended_at: new Date().toISOString(),
    summary: `SONA learn cursor at ${endedTs} (id ${trajId}); ${trajectoriesFed} trajectories fed into scope ${SONA_SCOPE} (dim ${SONA_EMBEDDING_DIM}).`,
  };
  return memStore(CURSOR_KEY, value, CURSOR_NS, {
    importance: 0,
    tags: [CURSOR_TAG],
    memory_type: 'semantic',
  });
}

// Build the trajectory_json for one trajectory by embedding its task + step actions.
// Embeds `action` alone for stability (map §3.1 bind). Returns { json, stepCount }.
async function buildForTrajectory({ task, success, steps }) {
  const stepEntries = [];
  const qualities = [];
  for (const s of steps) {
    const emb = await getEmbedding(String(s.action).substring(0, 2000));
    stepEntries.push({ embedding: emb, reward: clampReward(s.quality) });
    if (s.quality !== null && s.quality !== undefined) qualities.push(Number(s.quality));
  }
  // initial = embedding of the task; fallback to the first step's action.
  let initialEmb = null;
  const initialText = (task && String(task).trim()) ? String(task) : (steps[0] && steps[0].action) || '';
  if (initialText) initialEmb = await getEmbedding(String(initialText).substring(0, 2000));
  const finalReward = computeFinalReward(
    success === true ? true : success === false ? false : null,
    qualities,
  );
  return { json: assembleTrajectoryJson({ initialEmb, stepEntries, finalReward }), stepCount: stepEntries.length };
}

async function sonaStats(pool) {
  try {
    const r = await pool.query('SELECT ruvector_sona_stats($1) AS s', [SONA_SCOPE]);
    return r.rows[0] && r.rows[0].s ? r.rows[0].s : null;
  } catch (e) { log('WARN', `sona_stats failed: ${e.message}`); return null; }
}

// ── one tick ────────────────────────────────────────────────────────────────────
// Returns a small status object; NEVER throws (quick-check fail-open, I21).
// `reseededRef` is a { value: bool } latch shared across ticks of one process.
async function tick({ reseededRef } = {}) {
  const urn = runUrn(`${Date.now()}:${process.pid}`);
  let pool;
  try {
    pool = makePool();
    const { memStore, memRetrieve, memDelete } = cursorTools(pool);

    // Whole-tick fail-open on infra: no embeddings, no feed. Retry next tick.
    if (!(await xinfEnsure())) {
      emitEvent('SonaRunSkipped', { run_urn: urn, reason: 'xinference-unreachable' });
      return { status: 'skipped', reason: 'xinference-unreachable', runUrn: urn };
    }

    let cursor = await readCursor(memRetrieve);
    const stats = await sonaStats(pool);
    emitEvent('SonaRunStarted', {
      run_urn: urn, scope: SONA_SCOPE, embedding_dim: SONA_EMBEDDING_DIM,
      cursor_before: cursor ? cursor.cursorAfter : null,
      engine_buffered: stats ? (Number(stats.trajectories_buffered) || 0) : null,
      engine_stored: stats ? (Number(stats.patterns_stored) || 0) : null,
    });

    // Restart self-heal (R-C3, guarded per V5 — see header).
    if (shouldReseed({ cursor, stats, alreadyReseeded: reseededRef && reseededRef.value })) {
      await memDelete(CURSOR_KEY, CURSOR_NS).catch(() => {});
      cursor = null;
      if (reseededRef) reseededRef.value = true;
      emitEvent('SonaEngineReseeded', {
        run_urn: urn, scope: SONA_SCOPE, reason: 'engine-empty-cursor-advanced',
      });
    }

    const batch = Math.max(1, intGate('RUVECTOR_SONA_LEARN_BATCH', 50));
    const res = await pool.query(FEED_SQL, [
      cursor ? cursor.cursorAfter : null,
      cursor ? cursor.cursorId : '',
      batch,
    ]);
    if (!res.rows.length) {
      emitEvent('SonaRunSkipped', { run_urn: urn, reason: 'no-new-trajectories' });
      return { status: 'skipped', reason: 'no-new-trajectories', runUrn: urn, fed: 0 };
    }

    let fed = 0, failed = 0, lastCursor = null;
    for (const t of res.rows) {
      const stepsRes = await pool.query(STEPS_SQL, [t.traj_id]);
      const steps = stepsRes.rows;
      if (!steps.length) { // shouldn't happen given the EXISTS filter, but stay safe
        lastCursor = { endedTs: t.ended_ts, trajId: t.traj_id, endedEpoch: Number(t.ended_epoch) };
        continue;
      }
      try {
        const { json, stepCount } = await buildForTrajectory({
          task: t.task, success: t.success, steps,
        });
        const learn = await pool.query('SELECT ruvector_sona_learn($1, $2::jsonb) AS r', [
          SONA_SCOPE, JSON.stringify(json),
        ]);
        const r = learn.rows[0] && learn.rows[0].r;
        if (r && r.status === 'learned') {
          fed++;
        } else {
          failed++;
          log('WARN', `learn returned non-learned for ${t.traj_id}: ${JSON.stringify(r)}`);
        }
        emitEvent('SonaTrajectoryLearned', {
          run_urn: urn, trajectory_id: t.traj_id, steps: stepCount,
          final_reward: json.final_reward, status: r && r.status,
        });
      } catch (e) {
        // Per-datum fail-safe (map §3.1): log + continue; cursor still advances
        // past this trajectory (treated as malformed).
        failed++;
        log('WARN', `learn threw for trajectory ${t.traj_id} (skipped): ${e.message}`);
      }
      // Advance the compound cursor to the last ATTEMPTED trajectory.
      lastCursor = { endedTs: t.ended_ts, trajId: t.traj_id, endedEpoch: Number(t.ended_epoch) };
    }

    if (lastCursor) {
      const cur = await writeCursor(memStore, {
        endedTs: lastCursor.endedTs, trajId: lastCursor.trajId,
        endedEpoch: lastCursor.endedEpoch, trajectoriesFed: fed, urn,
      });
      if (!cur || !cur.success) {
        log('WARN', `cursor write failed: ${cur && cur.error} — next tick may re-feed (SONA learn is additive)`);
      }
    }

    // Log the post-feed engine counters so operators can see the V5/R-C2 reality
    // (buffered/stored stay 0 at 384-dim — apply MUST stay OFF until they move).
    const after = await sonaStats(pool);
    emitEvent('SonaRunCompleted', {
      run_urn: urn, scope: SONA_SCOPE, fed, failed,
      batch_size: res.rows.length,
      cursor_after: lastCursor ? lastCursor.endedTs : (cursor ? cursor.cursorAfter : null),
      engine_buffered: after ? (Number(after.trajectories_buffered) || 0) : null,
      engine_stored: after ? (Number(after.patterns_stored) || 0) : null,
      engine_dropped: after ? (Number(after.trajectories_dropped) || 0) : null,
      embedding_dim_reported: after ? after.embedding_dim : null,
    });
    return { status: 'applied', fed, failed, batch: res.rows.length, runUrn: urn,
      cursorAfter: lastCursor ? lastCursor.endedTs : null, stats: after };
  } catch (err) {
    emitEvent('SonaRunSkipped', { run_urn: urn, reason: 'error', error: err.message });
    log('WARN', `tick failed (fail-open, cursor unchanged): ${err.stack || err.message}`);
    return { status: 'error', error: err.message, runUrn: urn };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

// ── dry-run (read-only: counts the yield, shape-proofs a small sample) ───────────
// NEVER calls ruvector_sona_learn or ruvector_sona_stats — the latter lazily
// creates a 256-dim engine (map §3.3 caveat), so dry-run stays out of it entirely.
async function dryRun() {
  let pool;
  try {
    pool = makePool();
    const { memRetrieve } = cursorTools(pool);
    const cursor = await readCursor(memRetrieve);

    const y = await pool.query(YIELD_SQL, [cursor ? cursor.cursorAfter : null, cursor ? cursor.cursorId : '']);
    const trajCt = y.rows[0] ? Number(y.rows[0].traj_ct) : 0;
    const stepCt = y.rows[0] ? Number(y.rows[0].step_ct) : 0;

    process.stdout.write(
      `\n[dry-run] SONA feeder — scope '${SONA_SCOPE}' (embedding_dim ${SONA_EMBEDDING_DIM})\n` +
      `[dry-run] cursor is at ${cursor ? `${cursor.cursorAfter} (id ${cursor.cursorId})` : '(none)'}\n` +
      `[dry-run] WOULD feed ${trajCt} trajector${trajCt === 1 ? 'y' : 'ies'} (${stepCt} judged steps total). ` +
      `NOTHING written; ruvector_sona_learn/_stats NOT called.\n`,
    );

    // Bounded shape-proof: build (and embed) trajectory_json for the first N.
    const sample = Math.max(0, intGate('RUVECTOR_SONA_LEARN_DRYRUN_SAMPLE', 2));
    if (sample > 0 && trajCt > 0 && await xinfEnsure()) {
      const rows = await pool.query(FEED_SQL, [cursor ? cursor.cursorAfter : null, cursor ? cursor.cursorId : '', sample]);
      for (const t of rows.rows) {
        const stepsRes = await pool.query(STEPS_SQL, [t.traj_id]);
        const { json, stepCount } = await buildForTrajectory({ task: t.task, success: t.success, steps: stepsRes.rows });
        const shape = {
          has_initial: Array.isArray(json.initial),
          initial_dim: Array.isArray(json.initial) ? json.initial.length : 0,
          steps: stepCount,
          step_embedding_dim: json.steps[0] ? json.steps[0].embedding.length : 0,
          rewards: json.steps.map((s) => s.reward),
          final_reward: json.final_reward,
        };
        process.stdout.write(`[dry-run] shape-proof ${t.traj_id}: ${JSON.stringify(shape)}\n`);
      }
    } else if (sample > 0 && trajCt > 0) {
      process.stdout.write('[dry-run] (xinference unreachable — skipped shape-proof embeddings)\n');
    }
    return { status: 'dry-run', wouldFeed: trajCt, steps: stepCt };
  } catch (err) {
    log('WARN', `dry-run failed: ${err.stack || err.message}`);
    return { status: 'error', error: err.message };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mainOnce() {
  if (!boolGate('RUVECTOR_SONA_LEARN_ENABLED')) {
    log('INFO', 'RUVECTOR_SONA_LEARN_ENABLED is off — exiting (no-op). ' +
      'Enable [memory_learning].sona_learn_enabled and reboot, or use --dry-run to inspect.');
    return 0;
  }
  const reseededRef = { value: false };
  const r = await tick({ reseededRef });
  process.stdout.write(`sona-feeder --once: ${r.status}${r.status === 'applied' ? ` (${r.fed} fed, ${r.failed} failed)` : r.reason ? ` (${r.reason})` : ''}.\n`);
  return 0;
}

async function mainDryRun() {
  const r = await dryRun();
  return r.status === 'error' ? 1 : 0;
}

async function mainLoop() {
  let running = true;
  const stop = (sig) => { log('INFO', `${sig} received — exiting loop after current tick.`); running = false; };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  const reseededRef = { value: false }; // once-per-process reseed latch (V5 guard)
  log('INFO', 'SONA learn feeder loop starting.');
  while (running) {
    if (!boolGate('RUVECTOR_SONA_LEARN_ENABLED')) {
      log('INFO', 'RUVECTOR_SONA_LEARN_ENABLED is off — exiting loop (no-op).');
      return 0;
    }
    const r = await tick({ reseededRef });
    log('INFO', `tick: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.status === 'applied' ? ` — ${r.fed} fed, ${r.failed} failed` : ''}.`);
    if (!running) break;
    const mins = Math.max(1, intGate('RUVECTOR_SONA_LEARN_INTERVAL_MINS', 30));
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
      'Usage: ruvector-sona-feeder.mjs [--once|--loop|--dry-run]\n' +
      '  --once      one gated tick, then exit (gate: RUVECTOR_SONA_LEARN_ENABLED)\n' +
      '  --loop      gated ticks every RUVECTOR_SONA_LEARN_INTERVAL_MINS (default 30)\n' +
      '  --dry-run   count the yield + shape-proof a sample, write NOTHING, no learn/stats (ungated)\n',
    );
    return 0;
  }
  if (has('--dry-run')) return mainDryRun();
  if (has('--loop')) return mainLoop();
  return mainOnce();
}

// Entry guard: only run when invoked directly, so tests may import the pure helpers
// without triggering a tick/loop.
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
  SONA_SCOPE, SONA_EMBEDDING_DIM, CURSOR_KEY, CURSOR_NS, CURSOR_TAG,
  clampReward, computeFinalReward, assembleTrajectoryJson,
  cursorAdvances, shouldReseed,
};
