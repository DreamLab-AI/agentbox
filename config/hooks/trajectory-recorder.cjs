#!/usr/bin/env node
'use strict';

/**
 * trajectory-recorder.cjs — the agentbox learning-loop hook.
 *
 * PRD-018 / ADR-036 D1 / DDD-016 (Trajectory aggregate, invariants I03-I11).
 *
 * Closes the severed "does it learn?" loop honestly. Where the refuted ruflo
 * path had a caseless post-bash dispatch, a hardcoded feedback(true), and
 * duration=0, THIS hook records real, graded, locally-timed
 * (state, action, outcome, duration) tuples into the purpose-built, empty
 * `trajectories` / `trajectory_steps` sidecar tables.
 *
 * Invoked by Claude Code as:  trajectory-recorder.cjs <event>   (hook JSON on stdin)
 *   PreToolUse   → stash {ts, patternDigest} keyed by tool_use id (duration start + state)
 *   PostToolUse  → (Bash) derive graded outcome + measured duration → persist one step
 *   SubagentStop → close the trajectory (ended_at + outcome rollup into metadata)
 *
 * HARD RULES honoured:
 *   - DEFAULT-OFF: silent exit 0 unless BOTH RUVECTOR_MEMORY_LEARNING_ENABLED
 *     and RUVECTOR_RECORD_TRAJECTORIES are on ('1'|'true'). Byte-identical to
 *     today's behaviour otherwise (PRD-018 metric 1).
 *   - FAIL-OPEN: any error → exit 0, never blocks Claude (mirror nostr-live-mirror.cjs).
 *   - FAIL-CLOSED on privacy redaction (I10): if the command cannot be redacted,
 *     the step is SKIPPED, never persisted unredacted.
 *   - OUTCOME HONESTY (I04/I05): outcome is a real graded signal or NOTHING is
 *     written; duration is measured wall-clock; a zero duration is a bug → skip.
 *   - No raw-SQL writes to memory_entries. Trajectory tables are NOT memory_entries;
 *     parameterised INSERT there is the design.
 *   - URNs minted via management-api/lib/uris.js; activity kind content-addressed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const util = require('./lib/trajectory-util.cjs');

// ── logging (stderr only; never touches stdout — hook stdout is protocol) ──────
function log(msg) {
  try { process.stderr.write(`[trajectory-recorder] ${msg}\n`); } catch { /* ignore */ }
}

// ── gate ──────────────────────────────────────────────────────────────────────
function gateOn(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

// ── pg module resolution (mirrors ruvector-mcp.cjs PG_SEARCH_PATHS) ────────────
const PG_SEARCH_PATHS = [
  '/home/devuser/workspace/.claude-pg/node_modules/pg',
  '/opt/agentbox/management-api/node_modules/pg',
  path.resolve(__dirname, '..', '..', 'management-api', 'node_modules', 'pg'),
  'pg',
];
function loadPg() {
  for (const p of PG_SEARCH_PATHS) {
    try { return require(p); } catch { /* next */ }
  }
  return null;
}

// ── uris.js (fail-open: fall back to a deterministic non-URN id if unavailable) ─
function loadUris() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'management-api', 'lib', 'uris.js'),
    '/opt/agentbox/management-api/lib/uris.js',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}

// ── owner identity (public pubkey only — I09; the nsec never enters this hook) ──
function ownerPubkey() {
  const pk = String(process.env.AGENTBOX_PUBKEY || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(pk) ? pk : '';
}

// ── stdin ──────────────────────────────────────────────────────────────────────
function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf += c; });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', () => resolve(buf));
      if (process.stdin.isTTY) resolve('');
    } catch { resolve(buf); }
  });
}

// ── session-scoped stash file (os tmpdir) ──────────────────────────────────────
function sessionId(payload) {
  return String((payload && payload.session_id) || 'unknown');
}
function stashPath(session) {
  const safe = util.sha12(session);
  return path.join(os.tmpdir(), `agentbox-traj-${safe}.json`);
}
function readStash(session) {
  try {
    const raw = fs.readFileSync(stashPath(session), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch { /* fresh */ }
  return { session, pending: {}, stepOrder: 0, qualitySum: 0, qualityCount: 0 };
}
function writeStash(session, stash) {
  try {
    const p = stashPath(session);
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stash), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch (e) { log(`stash write failed (non-fatal): ${e && e.message}`); }
}

// stashKey pairs Pre with Post. Prefer a real tool_use id; else session+command hash.
function stashKey(payload) {
  const tid = payload && (payload.tool_use_id || payload.toolUseId ||
    (payload.tool_use && payload.tool_use.id));
  if (tid) return String(tid);
  const cmd = payload && payload.tool_input && payload.tool_input.command;
  return `cmd:${util.sha12(sessionId(payload) + ':' + String(cmd || ''))}`;
}

// ── trajectory identity (content-addressed activity URN; graceful non-URN fallback) ─
function trajectoryIdentity(session) {
  const uris = loadUris();
  const pubkey = ownerPubkey();
  if (uris && pubkey) {
    try {
      const urn = uris.mint({ kind: 'activity', pubkey, payload: { type: 'trajectory', session } });
      return { id: urn, urn, ownerDid: `did:nostr:${pubkey}` };
    } catch (e) { log(`urn mint failed, using fallback id: ${e && e.message}`); }
  }
  // Fallback: deterministic, session-derived, non-URN id. URN-scoped fields skipped.
  return { id: `agentbox:trajectory:${util.sha12(session)}`, urn: null, ownerDid: null };
}

// ── pg helpers ─────────────────────────────────────────────────────────────────
function makeClient(Pg) {
  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const parsed = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return new Pg.Client({
    host: parsed.host || 'ruvector-postgres',
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.dbname || parsed.database || 'ruvector',
    user: parsed.user || parsed.username || 'ruvector',
    password: parsed.password || 'ruvector',
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
}

let _durationColCache;
async function hasDurationColumn(client) {
  if (_durationColCache !== undefined) return _durationColCache;
  try {
    const res = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trajectory_steps' AND column_name = 'duration_ms' LIMIT 1`
    );
    _durationColCache = res.rowCount > 0;
  } catch { _durationColCache = false; }
  return _durationColCache;
}

// ── event handlers ─────────────────────────────────────────────────────────────

/** PreToolUse: stash the duration start + state digest, keyed by tool_use id. */
function handlePre(payload) {
  const session = sessionId(payload);
  const cmd = payload && payload.tool_input && payload.tool_input.command;
  const stash = readStash(session);
  const pattern = util.commandPattern(typeof cmd === 'string' ? cmd : '');
  stash.pending = stash.pending || {};
  stash.pending[stashKey(payload)] = {
    ts: Date.now(),
    patternDigest: pattern ? util.sha12(pattern) : null,
  };
  // Capture initial state context (task = session, cwd) once.
  if (!stash.task) stash.task = `claude-code-session:${session.slice(0, 12)}`;
  if (!stash.cwd && payload && payload.cwd) stash.cwd = String(payload.cwd).slice(0, 256);
  writeStash(session, stash);
  return 0;
}

/** PostToolUse (Bash): derive graded outcome + measured duration → persist one step. */
async function handlePost(payload) {
  // Only Bash carries an exit/error signal we can grade honestly.
  const toolName = payload && payload.tool_name;
  if (toolName && String(toolName) !== 'Bash') return 0;

  const session = sessionId(payload);
  const stash = readStash(session);
  const key = stashKey(payload);
  const pending = stash.pending && stash.pending[key];

  // I05: no stash → we cannot measure duration → skip.
  if (!pending || typeof pending.ts !== 'number') return 0;

  const durationMs = Date.now() - pending.ts;
  // I05: a zero (or negative) duration is a bug signal, never a stored value.
  if (!(durationMs > 0)) {
    delete stash.pending[key];
    writeStash(session, stash);
    return 0;
  }

  // I04: outcome must be a real graded signal or we write NOTHING.
  const outcome = util.deriveOutcome(payload && payload.tool_response);
  if (!outcome) {
    delete stash.pending[key];
    writeStash(session, stash);
    return 0;
  }

  const command = payload && payload.tool_input && payload.tool_input.command;
  const action = util.commandPattern(typeof command === 'string' ? command : '');
  if (!action) {
    delete stash.pending[key];
    writeStash(session, stash);
    return 0;
  }

  // I10: fail-closed on redaction — skip the write rather than persist unredacted.
  const redacted = util.redact(typeof command === 'string' ? command : '');
  if (redacted == null) {
    log('redaction failed — skipping step (fail-closed, I10)');
    delete stash.pending[key];
    writeStash(session, stash);
    return 0;
  }

  const Pg = loadPg();
  if (!Pg) { log('pg unavailable — skipping (fail-open)'); return 0; }

  const ident = trajectoryIdentity(session);
  const stepOrder = Number(stash.stepOrder || 0);
  const client = makeClient(Pg);

  try {
    await client.connect();
    const hasDur = await hasDurationColumn(client);

    // 1. one trajectory row per session (idempotent).
    const trajMeta = {
      type: 'trajectory',
      session,
      cwd: stash.cwd || null,
      owner_did: ident.ownerDid || undefined,
      trajectory_urn: ident.urn || undefined,
    };
    await client.query(
      `INSERT INTO trajectories (id, task, agent, status, started_at, metadata)
         VALUES ($1, $2, $3, 'recording', CURRENT_TIMESTAMP, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [ident.id, stash.task || `claude-code-session:${session.slice(0, 12)}`,
        String(process.env.AGENTBOX_AGENT || 'claude-code'), JSON.stringify(trajMeta)]
    );

    // 2. one step row per determined outcome.
    const stepId = `${ident.id}:step-${util.sha12(key + ':' + pending.ts)}`;
    const resultObj = {
      outcome: outcome.success ? 'success' : 'failure',
      signal: outcome.signal,
      exit_code: outcome.exit,
      command: redacted,
      prior_step: pending.patternDigest || null,
    };
    if (!hasDur) resultObj.duration_ms = durationMs; // pre-migration: carry in result JSON

    if (hasDur) {
      await client.query(
        `INSERT INTO trajectory_steps
           (id, trajectory_id, action, result, quality, step_order, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [stepId, ident.id, action, JSON.stringify(resultObj), outcome.quality, stepOrder, durationMs]
      );
    } else {
      await client.query(
        `INSERT INTO trajectory_steps
           (id, trajectory_id, action, result, quality, step_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [stepId, ident.id, action, JSON.stringify(resultObj), outcome.quality, stepOrder]
      );
    }

    // Advance the session bookkeeping (step order + rollup accumulators).
    stash.stepOrder = stepOrder + 1;
    stash.qualitySum = Number(stash.qualitySum || 0) + outcome.quality;
    stash.qualityCount = Number(stash.qualityCount || 0) + 1;
    delete stash.pending[key];
    writeStash(session, stash);
  } catch (e) {
    log(`persist failed (non-fatal, fail-open): ${e && e.message}`);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
  return 0;
}

/** SubagentStop: close the trajectory — ended_at + outcome rollup into metadata. */
async function handleStop(payload) {
  const session = sessionId(payload);
  const stash = readStash(session);
  // Nothing recorded → no trajectory row to close.
  if (!Number(stash.qualityCount || 0)) return 0;

  const Pg = loadPg();
  if (!Pg) return 0;

  const ident = trajectoryIdentity(session);
  const count = Number(stash.qualityCount);
  const meanQuality = count > 0 ? Number(stash.qualitySum || 0) / count : 0;
  const success = meanQuality >= 0.5;

  const client = makeClient(Pg);
  try {
    await client.connect();
    await client.query(
      `UPDATE trajectories
          SET ended_at = CURRENT_TIMESTAMP,
              status   = 'complete',
              success  = $2,
              metadata = COALESCE(metadata, '{}'::jsonb)
                         || jsonb_build_object(
                              'ended_at_iso', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                              'step_count',   $3::int,
                              'mean_quality', $4::double precision,
                              'outcome',      $5::text)
        WHERE id = $1`,
      [ident.id, success, count, meanQuality, success ? 'success' : 'mixed']
    );
  } catch (e) {
    log(`close failed (non-fatal, fail-open): ${e && e.message}`);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  const event = process.argv[2] || '';

  // DEFAULT-OFF gate: byte-identical to today unless BOTH gates are on.
  if (!gateOn('RUVECTOR_MEMORY_LEARNING_ENABLED') || !gateOn('RUVECTOR_RECORD_TRAJECTORIES')) {
    return 0;
  }

  const raw = await readStdin();
  let payload = {};
  if (raw && raw.trim()) {
    try { payload = JSON.parse(raw); } catch { payload = {}; }
  }

  switch (event) {
    case 'PreToolUse':   return handlePre(payload);
    case 'PostToolUse':  return handlePost(payload);
    case 'SubagentStop': return handleStop(payload);
    default:             return 0;
  }
}

// Hard kill-switch: never outlive a small budget (fail-open on expiry).
const guard = setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, 8000);
if (typeof guard.unref === 'function') guard.unref();

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((err) => { log(`fatal (swallowed): ${err && err.message}`); process.exit(0); });
