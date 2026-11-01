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
 * `trajectories` / `trajectory_steps` sidecar tables. It does not write them
 * itself: it POSTs the rows to the Management API (POST /v1/agent-events/trajectory,
 * ADR-2164), which persists them. This hook holds no database client, no
 * connection string and no gate variable, so a task running it needs only its
 * scoped TASK_ACTION_TOKEN.
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
 *   - ENABLEMENT IS REGISTRATION: the entrypoint registers this hook only when
 *     [memory_learning].enabled and record_trajectories are both true and
 *     de-registers it otherwise, so a gate-off manifest never runs it (PRD-018
 *     metric 1). There is no env gate here and none is passed to a task.
 *   - FAIL-OPEN: any error → exit 0, never blocks Claude (mirror nostr-live-mirror.cjs).
 *   - FAIL-CLOSED on privacy redaction (I10): if the command cannot be redacted,
 *     the step is SKIPPED, never persisted unredacted.
 *   - OUTCOME HONESTY (I04/I05): outcome is a real graded signal or NOTHING is
 *     written; duration is measured wall-clock; a zero duration is a bug → skip.
 *   - THE WATERMARK FOLLOWS DURABILITY (ADR-2015): it advances only on a 2xx
 *     from the API; any other answer leaves the lines to be retried.
 *   - No raw-SQL writes to memory_entries, and no SQL at all here: the API owns
 *     the trajectory tables (management-api/lib/trajectory-store.js).
 *   - URNs minted via management-api/lib/uris.js; activity kind content-addressed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const util = require('./lib/trajectory-util.cjs');

// ── logging (stderr only; never touches stdout — hook stdout is protocol) ──────
function log(msg) {
  try { process.stderr.write(`[trajectory-recorder] ${msg}\n`); } catch { /* ignore */ }
}

// ── Management API credential ────────────────────────────────────────────────
// The operator key in an operator session; inside a Management API task the key
// is withheld and TASK_ACTION_TOKEN (scoped to TASK_ID) is the credential.
function apiCredential() {
  return String(process.env.MANAGEMENT_API_KEY || process.env.TASK_ACTION_TOKEN || '').trim();
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

// ── failure-taxonomy.js (REC-5: MAST tag on a graded failure). Same candidate
// resolution as uris.js. Fail-open: if the shared library cannot be loaded, a
// failure step is still tagged with the inline `unmapped` sentinel rather than a
// free-text error — never dropped, never left untagged (PRD-019 REC-5 AC4).
const UNMAPPED = 'unmapped';
function loadTaxonomy() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'management-api', 'lib', 'failure-taxonomy.js'),
    '/opt/agentbox/management-api/lib/failure-taxonomy.js',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
// Classify a graded failure to a MAST mode id, or `unmapped`. Never throws.
function failureModeFor(taxonomy, step) {
  try {
    if (taxonomy && typeof taxonomy.classify === 'function') {
      return taxonomy.classify({
        signal: step.outcome && step.outcome.signal,
        stderr: step.failureHint || undefined,
        action: step.action,
      });
    }
  } catch { /* fall through to the sentinel */ }
  return UNMAPPED;
}

// AB-03-S1-01 (Jev option, off unless AGENTBOX_JEV_FAILURE_TAXONOMY=1): failures the taxonomy left
// `unmapped` may be refined by a LOCAL judge. This is a PRE-PASS, run before the database
// connection opens and under one overall deadline (<= 4 s), so the judge cannot stall the Stop
// hook or the watermark. Exact mappings win and are never re-asked; every miss (flag off, no
// local endpoint, error, timeout, malformed, low confidence) keeps the base tag and persists
// nothing about the miss. See lib/failure-jev.cjs. Never throws.
async function jevFailureTags(taxonomy, steps) {
  if (!process.env.AGENTBOX_JEV_FAILURE_TAXONOMY || !taxonomy) return new Map();
  try {
    const items = steps.filter((st) => !st.outcome.success)
      .map((st) => ({ id: st.toolUseId, ctx: { stderr: st.failureHint, action: st.action }, base: failureModeFor(taxonomy, st) }))
      .filter((it) => it.base === UNMAPPED);
    return items.length ? await require('./lib/failure-jev.cjs').refineMany(taxonomy, items) : new Map();
  } catch { return new Map(); }
}

// ── REC-3 (CTC emitter WIRE): forward a step's captured token_count + chain
// handoff_id into a REAL agent-events emit call, so the CTC fields reach the
// agent-events envelope the publisher emits and CANARY-AB-CTC can fire. Best-effort
// over the same in-process management-API the project-tracking hook already POSTs
// to (127.0.0.1:${MANAGEMENT_API_PORT|9090}/v1/agent-events/emit). Fail-open: any
// error is swallowed — the DB persistence already happened; the emit is additive.
const CTC_EMIT_TIMEOUT_MS = 3000;
const CTC_EMIT_CAP = 200; // never flood the wire from one Stop firing
function emitCtcStep(body) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const port = Number(process.env.MANAGEMENT_API_PORT || '9090');
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      // Operator key when present; inside a Management API task the key is
      // withheld and TASK_ACTION_TOKEN (scoped to TASK_ID, emit/batch only) is
      // the credential instead.
      const apiKey = String(process.env.MANAGEMENT_API_KEY || process.env.TASK_ACTION_TOKEN || '').trim();
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/v1/agent-events/emit',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: CTC_EMIT_TIMEOUT_MS,
      }, (res) => { res.on('data', () => {}); res.on('end', done); res.on('error', done); });
      req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } done(); });
      req.on('error', (e) => { log(`ctc emit unreachable (non-fatal): ${e && e.message}`); done(); });
      req.write(payload);
      req.end();
    } catch (e) { log(`ctc emit failed (non-fatal): ${e && e.message}`); done(); }
  });
}
// ADR-2015 accounting closeout (2026-09-05) — THE CAP IS A QUEUE, NOT A CLIFF.
//
// The cap existed so one Stop firing could not flood the wire, but everything
// beyond it was silently dropped: a long session's later steps simply never
// reached the CTC consumer, and nothing recorded that they were missing. That
// makes "complete delivery" unprovable, which is exactly what the accounting
// review asked us to fix before presenting a per-DAG figure.
//
// Now the overflow is CARRIED FORWARD in the session stash and drained first on
// the next invocation, and the rollup records the queue depth so an incomplete
// delivery is visible rather than inferred. The queue itself is bounded
// (CTC_QUEUE_MAX) — an unbounded backlog would be its own failure — and when it
// overflows we say so explicitly instead of pretending the count is complete.
const CTC_QUEUE_MAX = 2000;

/**
 * Emit up to the per-invocation cap, returning what could not be sent.
 * @param {object[]} bodies
 * @returns {Promise<{attempted:number, deferred:object[]}>}
 */
async function emitCtcStepsBestEffort(bodies) {
  if (String(process.env.AGENTBOX_CTC_EMIT || '').trim() === '0') {
    return { attempted: 0, deferred: [] }; // explicit off switch — nothing queued either
  }
  if (!Array.isArray(bodies) || bodies.length === 0) return { attempted: 0, deferred: [] };
  const bounded = bodies.slice(0, CTC_EMIT_CAP);
  const deferred = bodies.slice(CTC_EMIT_CAP);
  for (const b of bounded) {
    try { await emitCtcStep(b); } catch { /* fail-open */ }
  }
  return { attempted: bounded.length, deferred };
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

// ── trajectory persistence: ONE write path, the Management API (ADR-2164) ──────
const TRAJECTORY_POST_TIMEOUT_MS = 5000;
/**
 * POST the computed trajectory rows to the API. Resolves true ONLY for a 2xx —
 * unlike the best-effort CTC emit, the watermark depends on this answer, so a
 * 401, a 500, a timeout and "no credential" are all `false`. Never rejects.
 * @param {object} body {trajectory, steps, rollup} — see management-api/lib/trajectory-store.js
 * @returns {Promise<boolean>}
 */
function postTrajectory(body) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const cred = apiCredential();
      if (!cred) { log('no MANAGEMENT_API_KEY or TASK_ACTION_TOKEN — cannot persist'); return done(false); }
      const port = Number(process.env.MANAGEMENT_API_PORT || '9090');
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/v1/agent-events/trajectory',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          authorization: `Bearer ${cred}`,
        },
        timeout: TRAJECTORY_POST_TIMEOUT_MS,
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) log(`trajectory post answered ${res.statusCode}`);
          done(ok);
        });
        res.on('error', () => done(false));
      });
      req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } done(false); });
      req.on('error', (e) => { log(`trajectory post unreachable: ${e && e.message}`); done(false); });
      req.write(payload);
      req.end();
    } catch (e) { log(`trajectory post failed: ${e && e.message}`); done(false); }
  });
}

// ── event handlers ─────────────────────────────────────────────────────────────

/**
 * Scan the session transcript once and return the graded, redacted Bash steps
 * whose tool_result record appears at/after `fromLine` (the per-session watermark),
 * plus the new line count. A tool_use may precede the watermark while its result
 * follows, so the tool_use map is built over the WHOLE transcript.
 */
function scanTranscript(lines, fromLine) {
  const uses = new Map(); // tool_use_id → { command, ts, tokenCount, usageId, turnToolUses }
  // ADR-2015 accounting closeout: how many tracked Bash calls each assistant
  // turn issued. The turn's token burden is attached to every one of them, so
  // this count is what tells a consumer the number is SHARED rather than
  // separately measured — the difference between 150 and a double-counted 300.
  const turnToolUses = new Map(); // usageId → count
  // REC-3 (CTC): count subagent Task spawns across the WHOLE session — each Task
  // tool_use is a handoff to another agent, so the count IS the chain's handoff
  // burden the CTC dashboard reconstructs. Built over all lines (like `uses`).
  let handoffCount = 0;
  for (const line of lines) {
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    // REC-3: the token burden of the assistant turn that ISSUED the tool call.
    const tokenCount = util.tokenCountOf(rec.message && rec.message.usage);
    const usageId = util.usageIdentityOf(rec);
    for (const b of content) {
      if (b && b.type === 'tool_use' && b.name === 'Bash' && b.id) {
        const cmd = b.input && b.input.command;
        uses.set(String(b.id), { command: typeof cmd === 'string' ? cmd : '', ts: rec.timestamp, tokenCount, usageId });
        if (usageId) turnToolUses.set(usageId, (turnToolUses.get(usageId) || 0) + 1);
      }
      // A Task tool_use hands off to a subagent — count it as one handoff.
      if (b && b.type === 'tool_use' && b.name === 'Task') handoffCount++;
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

      // REC-5: for a graded FAILURE, keep a redacted, capped stderr hint so the
      // MAST classifier can run its high-precision heuristics. This hint is used
      // in-memory only for tagging — it is NEVER persisted to the step result
      // (I10: the durable result carries the redacted command, not stderr).
      let failureHint;
      if (!outcome.success && typeof tur.stderr === 'string' && tur.stderr.trim()) {
        const red = util.redact(tur.stderr);
        if (red != null) failureHint = red.slice(0, 400);
      }

      steps.push({
        toolUseId: String(b.tool_use_id), action, outcome, redacted, durationMs, failureHint,
        tokenCount: use.tokenCount,
        usageId: use.usageId || null,
        turnToolUses: use.usageId ? (turnToolUses.get(use.usageId) || 1) : null,
      });
    }
  }
  return { steps, lineCount: lines.length, handoffCount };
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
  const { steps, lineCount, handoffCount } = scanTranscript(lines, from);

  // ADR-2015 closeout (2026-09-05) — THE WATERMARK FOLLOWS DURABILITY.
  //
  // The watermark used to be advanced before persistence, so a missing `pg`
  // module wrote the advanced value and returned successfully: those transcript
  // lines were skipped forever on the next invocation, silently losing the
  // steps. A connection/query exception, by contrast, already left the stash
  // alone and permitted a retry — the two failures behaved differently for no
  // principled reason.
  //
  // Now the watermark advances in exactly two places: when there was nothing to
  // persist (safe — no work was lost), and after a successful persist. Every
  // other exit leaves it where it was, so the lines are re-scanned. Re-scanning
  // is safe because step ids are content-addressed from the tool_use id and the
  // inserts are ON CONFLICT DO NOTHING, and because the quality counters are
  // only committed to the stash on the same successful path.
  const pendingLineCount = lineCount;
  if (!steps.length) { stash.processedLines = pendingLineCount; writeStash(session, stash); return 0; }

  const ident = trajectoryIdentity(session);
  // REC-3 (CTC): the chain-correlation id every step and the rollup carry so a
  // multi-agent DAG can be reconstructed (handoff counts + token burden per step).
  const chainId = util.handoffIdFrom(process.env, ident.urn || ident.id);
  const taxonomy = loadTaxonomy();
  const jevTags = await jevFailureTags(taxonomy, steps);
  // REC-3 (CTC emitter WIRE): the emit bodies to forward onto the agent-events
  // envelope after persistence — one per step carrying a token_count / handoff_id.
  // Drain anything the previous invocation could not deliver BEFORE this run's
  // own steps, so the queue stays FIFO and old cost is not starved by new.
  const carried = Array.isArray(stash.ctcPending) ? stash.ctcPending.slice(0, CTC_QUEUE_MAX) : [];
  const carriedIn = carried.length;
  const ctcEmits = carried.slice();

  // The rows, fully formed. The API only runs the parameterised SQL (ADR-2164),
  // so every id, step_order and cumulative figure is decided here from the stash.
  const trajMeta = {
    type: 'trajectory',
    session,
    owner_did: ident.ownerDid || undefined,
    trajectory_urn: ident.urn || undefined,
    handoff_id: chainId || undefined,
  };
  let order = Number(stash.stepOrder || 0);
  let qualitySum = Number(stash.qualitySum || 0);
  let qualityCount = Number(stash.qualityCount || 0);
  const rows = [];
  for (const s of steps) {
    const resultObj = {
      outcome: s.outcome.success ? 'success' : 'failure',
      signal: s.outcome.signal,
      command: s.redacted,
    };
    // REC-5 (AC2): a graded FAILURE carries a MAST failure_mode tag (or the
    // `unmapped` sentinel); a graded SUCCESS writes no mode.
    if (!s.outcome.success) {
      const tag = jevTags.get(s.toolUseId) || { mode: failureModeFor(taxonomy, s) };
      resultObj.failure_mode = tag.mode; s.failure_mode = tag.mode;
      // Present only when the Jev option's judge actually answered for this step.
      if (tag.jev) resultObj.failure_jev = tag.jev;
    }
    // REC-3 (AC1): the token burden of the turn that issued this step, parsed
    // from the transcript usage block. Additive — absent when the turn carried
    // no usage (byte-compatible with the pre-REC-3 result shape).
    if (s.tokenCount != null) resultObj.token_count = s.tokenCount;
    rows.push({
      id: `${ident.id}:step-${util.sha12(s.toolUseId)}`,
      action: s.action,
      result: resultObj,
      quality: s.outcome.quality,
      step_order: order,
      // The API puts this in the duration_ms column, or in result.duration_ms
      // when the table has no such column.
      duration_ms: s.durationMs,
    });
    order++;
    qualitySum += s.outcome.quality;
    qualityCount++;
    // REC-3 (CTC emitter WIRE): build the emit body forwarding this step's
    // captured token_count + the chain handoff_id onto the agent-events envelope.
    const ctcBody = util.ctcEmitBodyFromStep(s, { handoffId: chainId, sessionId: session, taskId: process.env.TASK_ID });
    // Collect up to the QUEUE bound (not the per-invocation emit cap) — the
    // surplus is deferred to the next Stop rather than discarded here.
    if (ctcBody && ctcEmits.length < CTC_QUEUE_MAX) ctcEmits.push(ctcBody);
  }

  // The trajectory rolls up to its current cumulative outcome. REC-3 (AC2/AC4):
  // the rollup carries handoff_id (chain correlation) and handoff_count
  // (subagent Task spawns this session) so the CTC dashboard can reconstruct a
  // completed DAG — handoff counts + per-step token burden.
  const meanQuality = qualityCount > 0 ? qualitySum / qualityCount : 0;
  const success = meanQuality >= 0.5;
  const persisted = await postTrajectory({
    trajectory: {
      id: ident.id,
      task: `claude-code-session:${session.slice(0, 12)}`,
      agent: String(process.env.AGENTBOX_AGENT || 'claude-code'),
      metadata: trajMeta,
    },
    steps: rows,
    rollup: {
      success,
      step_count: qualityCount,
      mean_quality: meanQuality,
      outcome: success ? 'success' : 'mixed',
      handoff_id: chainId,
      handoff_count: Number(handoffCount || 0),
      ctc_emit_queued: ctcEmits.length,
      ctc_emit_carried_in: carriedIn,
    },
  });

  let toEmit = ctcEmits;
  if (persisted) {
    // Durable persistence succeeded — only NOW may the watermark and the
    // cumulative counters advance.
    stash.stepOrder = order;
    stash.qualitySum = qualitySum;
    stash.qualityCount = qualityCount;
    stash.processedLines = pendingLineCount;
    writeStash(session, stash);
  } else {
    log(`trajectory not persisted — NOT advancing the watermark (left at ${from}); these lines are retried on the next Stop (ADR-2015)`);
    // This run's steps will be rebuilt on the retry, so only the already
    // queued backlog is drained now; emitting the new bodies as well would
    // double-count their token burden when the retry succeeds.
    toEmit = carried;
  }
  // REC-3 (CTC emitter WIRE): after persistence, forward each step's captured
  // token_count + chain handoff_id into a REAL agent-events emit call so they
  // reach the agent-events envelope the publisher emits (CANARY-AB-CTC wire).
  // Best-effort, fail-open — the durable trajectory record is already written.
  const { attempted, deferred } = await emitCtcStepsBestEffort(toEmit);
  // Persist the undelivered tail so the NEXT Stop drains it. This is the only
  // stash write outside the persistence path, and it only ever touches the
  // queue field — it never advances the watermark.
  try {
    const cur = readStash(session);
    if (deferred.length > CTC_QUEUE_MAX) {
      log(`ctc emit queue overflow: ${deferred.length} bodies exceed the ${CTC_QUEUE_MAX} bound — ` +
          `${deferred.length - CTC_QUEUE_MAX} dropped, downstream CTC totals for this session are INCOMPLETE`);
    }
    cur.ctcPending = deferred.slice(0, CTC_QUEUE_MAX);
    cur.ctcPendingOverflow = Math.max(0, deferred.length - CTC_QUEUE_MAX)
      + Number(cur.ctcPendingOverflow || 0);
    writeStash(session, cur);
    if (deferred.length) {
      log(`ctc emit: attempted ${attempted}, deferred ${cur.ctcPending.length} to the next Stop (cap ${CTC_EMIT_CAP}/invocation)`);
    }
  } catch (e) { log(`ctc queue persist failed (non-fatal): ${e && e.message}`); }
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  const event = process.argv[2] || '';

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
