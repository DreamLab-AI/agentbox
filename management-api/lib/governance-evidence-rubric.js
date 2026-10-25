'use strict';

/**
 * governance-evidence-rubric.js — the opt-in Jev option for ES-05-S1-01
 * ("shared evidence-quality rubric across approval surfaces").
 *
 * agentbox is the HOST action-request surface: management-api builds the ACSP ActionRequest
 * (kind 31402, agent-control-surface.js `buildActionRequest`) that elevation-publisher.js and
 * the ontology monitor publish for a human to approve. The forum and VisionClaw display the
 * same kind of card. This module owns the one versioned QUESTION SET and the host consumer;
 * the set itself is a language-neutral JSON file (rubrics/governance-evidence-quality.v1.json)
 * so the other two surfaces load the same bytes and ask the same questions.
 *
 * WHAT IT PRODUCES. Four advisory signals for one request:
 *   rationale_explains_action  Noul   evidence_supports_claim  Noul
 *   scope_matches_title        Noul   review_completeness      Score
 * each bound to the REQUEST DIGEST (sha256 over canonical {content, kind, tags} of the unsigned
 * event) and to the question-set digest, so a signal can never be attached to a request other
 * than the one it was computed for, nor compared across rubric versions.
 *
 * WHAT IT NEVER DOES. It runs AFTER the card is built and cannot alter it: the unsigned event
 * is deep-frozen before it is shown to this module, the signal is written to a separate
 * sidecar (`$AGENTBOX_STATE/governance-evidence-signals.jsonl`) and returned beside — never
 * inside — the publish result. Approver signatures (31403), dispatch and mutation-owner
 * receipts are untouched; `authority` in the signal is the literal string "none".
 *
 * FLAG. `AGENTBOX_JEV_GOVERNANCE_RUBRIC=1`, off by default. Off ⇒ `assess` resolves `null`
 * without building a request.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ITEM = 'ES-05-S1-01';
const FLAG = 'AGENTBOX_JEV_GOVERNANCE_RUBRIC';
const RUBRIC_PATH = path.join(__dirname, 'rubrics', 'governance-evidence-quality.v1.json');
const TIMEOUT_MS = 4000;
const MAX_FIELD_CHARS = 1500;

const APP_ROOT = process.env.AGENTBOX_APP_ROOT || '/opt/agentbox';
let _jev;
function loadJev() {
  if (_jev !== undefined) return _jev;
  const rel = 'config/hooks/lib/jev-option.cjs';
  for (const base of [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../..'), APP_ROOT]) {
    const p = path.join(base, rel);
    if (fs.existsSync(p)) { _jev = require(p); return _jev; }
  }
  _jev = null;
  return _jev;
}

/** Canonical JSON: sorted object keys, no whitespace, arrays in order. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

let _rubric;
/** The rubric and its digest. Read once; throws only if the shipped file is unreadable (caller catches). */
function loadRubric() {
  if (_rubric) return _rubric;
  const rubric = JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'));
  _rubric = { rubric, sha256: sha256(canonicalJson(rubric)), version: `${rubric.id}/${rubric.version}` };
  return _rubric;
}

/** The digest of the exact unsigned request an approver is shown. */
function requestDigest(unsigned) {
  return sha256(canonicalJson({ content: unsigned.content, kind: unsigned.kind, tags: unsigned.tags }));
}

function clamp(v, n) {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? null : JSON.stringify(v);
  return s !== null && s.length > n ? s.slice(0, n) : s;
}

/** The state the rubric's instructions refer to, read from the card exactly as built. */
function buildState(unsigned) {
  let body = {};
  try { body = JSON.parse(unsigned.content) || {}; } catch { body = {}; }
  const tag = (name) => ((unsigned.tags || []).find((t) => t[0] === name) || [])[1] || null;
  return {
    title: tag('title'),
    subject: { kind: tag('subject-kind'), id: tag('subject-id') },
    rationale: clamp(body.reasoning, MAX_FIELD_CHARS),
    evidence: clamp(body.fields, MAX_FIELD_CHARS * 2),
    context_url: typeof body.context_url === 'string' ? body.context_url : null,
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

/**
 * Compute the signals for one unsigned ActionRequest. Never throws; resolves `null` on flag-off
 * or any fallback so the caller's result is identical to the pre-change result.
 *
 * @param {object} unsigned the event from buildActionRequest (a deep copy is taken)
 * @param {object} [opts] { env, fetchImpl, sink }
 * @returns {Promise<null|object>} `{ request_digest, rubric, rubric_sha256, authority:'none', signals, model }`
 */
async function assess(unsigned, opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  if (!jev || !jev.enabled(env, FLAG)) return null;
  const fail = (reason) => { jev.logFallback(ITEM, reason, opts.sink); return null; };
  if (!unsigned || typeof unsigned.content !== 'string' || !Array.isArray(unsigned.tags)) return fail('malformed');

  let loaded;
  try { loaded = loadRubric(); } catch { return fail('malformed'); }
  const snapshot = deepFreeze(JSON.parse(JSON.stringify({ content: unsigned.content, kind: unsigned.kind, tags: unsigned.tags })));
  const ep = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_GOVERNANCE_RUBRIC_LOCAL_ONLY') });
  if (!ep.ok) return fail(ep.reason);

  const questions = JSON.parse(JSON.stringify(loaded.rubric.questions));
  const res = await jev.ask(ep, buildState(snapshot), questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
  if (!res.ok) return fail(res.reason);

  const signals = {};
  for (const [id, q] of Object.entries(loaded.rubric.questions)) {
    const v = q.type === 'noul' ? jev.readNoul(res.answers[id]) : jev.readScore(res.answers[id], q.criteria.length);
    if (v === null) return fail('malformed');
    signals[id] = Math.round(v * 1000) / 1000;
  }
  return {
    request_digest: requestDigest(snapshot),
    rubric: loaded.version,
    rubric_sha256: loaded.sha256,
    authority: 'none',
    signals,
    model: res.model,
  };
}

/** Append one signal record to the sidecar; best-effort, never throws, never touches the card. */
function recordSignal(signal, eventId, env = process.env) {
  try {
    const dir = env.AGENTBOX_STATE || env.AGENTBOX_STATE_DIR || '/home/devuser/.agentbox';
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'governance-evidence-signals.jsonl'), JSON.stringify({ ...signal, event_id: eventId || null }) + '\n');
    return true;
  } catch { return false; }
}

module.exports = { ITEM, FLAG, RUBRIC_PATH, canonicalJson, loadRubric, requestDigest, buildState, assess, recordSignal };
