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
 *   Stop / SubagentStop → scan the session transcript (payload.transcript_path),
 *     grade every Bash tool call by its recorded `is_error`, persist one step each
 *     + a per-session trajectory rollup. A per-session line watermark (in the stash
 *     file) makes repeated Stop firings incremental; deterministic step ids make the
 *     inserts idempotent.
 *
 * Why transcript-driven and not per-PostToolUse: on this Claude Code build a
 * successful Bash tool_response carries NO exit code / error flag, and PostToolUse
 * does NOT fire at all for non-zero-exit commands — so per-tool grading is blind to
 * every failure. The transcript is the only source that records both outcomes
 * (tool_result.is_error), which is what a learning corpus needs.
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

// Resolve the session transcript path from the hook payload.
function transcriptPath(payload) {
  const p = payload && (payload.transcript_path || payload.transcriptPath);
  return typeof p === 'string' && p ? p : null;
}

// ISO-8601 → epoch ms (null if unparseable). Used for measured step duration.
function isoMs(s) {
  const t = Date.parse(String(s || ''));
  return Number.isFinite(t) ? t : null;
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

/**
 * Scan the session transcript once and return the graded, redacted Bash steps
 * whose tool_result record appears at/after `fromLine` (the per-session watermark),
 * plus the new line count. A tool_use may precede the watermark while its result
 * follows, so the tool_use map is built over the WHOLE transcript.
 */
function scanTranscript(lines, fromLine) {
  const uses = new Map(); // tool_use_id → { command, ts }
  for (const line of lines) {
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === 'tool_use' && b.name === 'Bash' && b.id) {
        const cmd = b.input && b.input.command;
        uses.set(String(b.id), { command: typeof cmd === 'string' ? cmd : '', ts: rec.timestamp });
      }
    }
  }

  const steps = [];
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    const tur = (rec.toolUseResult && typeof rec.toolUseResult === 'object') ? rec.toolUseResult : {};
    for (const b of content) {
      if (!b || b.type !== 'tool_result' || !b.tool_use_id) continue;
      const use = uses.get(String(b.tool_use_id));
      if (!use) continue; // not a Bash tool call we tracked

      // I04: grade from the real transcript signal or write NOTHING.
      const outcome = util.gradeResult(b.is_error, tur.stderr, tur.interrupted);
      if (!outcome) continue;
      const action = util.commandPattern(use.command);
      if (!action) continue;
      // I10: fail-closed on redaction.
      const redacted = util.redact(use.command);
      if (redacted == null) { log('redaction failed — skipping step (fail-closed, I10)'); continue; }

      let durationMs = null;
      const t0 = isoMs(use.ts), t1 = isoMs(rec.timestamp);
      if (t0 != null && t1 != null && t1 >= t0) durationMs = t1 - t0;

      steps.push({ toolUseId: String(b.tool_use_id), action, outcome, redacted, durationMs });
    }
  }
  return { steps, lineCount: lines.length };
}

/**
 * Stop / SubagentStop: parse the session transcript, grade each new Bash call by
 * its recorded is_error, and persist steps + a per-session trajectory rollup.
 * Idempotent: step ids are content-addressed from the tool_use id; the per-session
 * line watermark keeps repeated Stop firings incremental.
 */
async function handleClose(payload) {
  const session = sessionId(payload);
  const tpath = transcriptPath(payload);
  if (!tpath) { log('no transcript_path — skipping'); return 0; }

  let raw;
  try { raw = fs.readFileSync(tpath, 'utf8'); }
  catch (e) { log(`transcript read failed (fail-open): ${e && e.message}`); return 0; }
  const lines = raw.split('\n');

  const stash = readStash(session);
  const from = Number(stash.processedLines || 0);
  const { steps, lineCount } = scanTranscript(lines, from);

  // Advance the watermark regardless (idempotent inserts cover any race).
  stash.processedLines = lineCount;
  if (!steps.length) { writeStash(session, stash); return 0; }

  const Pg = loadPg();
  if (!Pg) { log('pg unavailable — skipping (fail-open)'); writeStash(session, stash); return 0; }

  const ident = trajectoryIdentity(session);
  const client = makeClient(Pg);
  try {
    await client.connect();
    const hasDur = await hasDurationColumn(client);

    // 1. one trajectory row per session (idempotent).
    const trajMeta = {
      type: 'trajectory',
      session,
      owner_did: ident.ownerDid || undefined,
      trajectory_urn: ident.urn || undefined,
    };
    await client.query(
      `INSERT INTO trajectories (id, task, agent, status, started_at, metadata)
         VALUES ($1, $2, $3, 'recording', CURRENT_TIMESTAMP, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [ident.id, `claude-code-session:${session.slice(0, 12)}`,
        String(process.env.AGENTBOX_AGENT || 'claude-code'), JSON.stringify(trajMeta)]
    );

    // 2. one step row per graded Bash call (idempotent by content-addressed id).
    let order = Number(stash.stepOrder || 0);
    for (const s of steps) {
      const stepId = `${ident.id}:step-${util.sha12(s.toolUseId)}`;
      const resultObj = {
        outcome: s.outcome.success ? 'success' : 'failure',
        signal: s.outcome.signal,
        command: s.redacted,
      };
      if (!hasDur && s.durationMs != null) resultObj.duration_ms = s.durationMs;
      if (hasDur) {
        await client.query(
          `INSERT INTO trajectory_steps
             (id, trajectory_id, action, result, quality, step_order, duration_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [stepId, ident.id, s.action, JSON.stringify(resultObj), s.outcome.quality, order, s.durationMs]
        );
      } else {
        await client.query(
          `INSERT INTO trajectory_steps
             (id, trajectory_id, action, result, quality, step_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [stepId, ident.id, s.action, JSON.stringify(resultObj), s.outcome.quality, order]
        );
      }
      order++;
      stash.qualitySum = Number(stash.qualitySum || 0) + s.outcome.quality;
      stash.qualityCount = Number(stash.qualityCount || 0) + 1;
    }
    stash.stepOrder = order;

    // 3. roll the trajectory up to its current cumulative outcome (idempotent update).
    const count = Number(stash.qualityCount || 0);
    const meanQuality = count > 0 ? Number(stash.qualitySum || 0) / count : 0;
    const success = meanQuality >= 0.5;
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
    writeStash(session, stash);
  } catch (e) {
    log(`persist failed (non-fatal, fail-open): ${e && e.message}`);
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
    case 'Stop':
    case 'SubagentStop': return handleClose(payload);
    default:             return 0;
  }
}

// Hard kill-switch: never outlive a small budget (fail-open on expiry).
const guard = setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, 8000);
if (typeof guard.unref === 'function') guard.unref();

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((err) => { log(`fatal (swallowed): ${err && err.message}`); process.exit(0); });
