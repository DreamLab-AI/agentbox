'use strict';

/**
 * headroom-evidence.js — the opt-in Jev option for AB-26-S1-01
 * ("select relevant log/file evidence before context compression").
 *
 * WHERE. headroom.js `compress(content, slot)` (AB-26.2) applies lossy, content-aware
 * compressors (smart_crusher, log_compressor, diff_compressor) one payload at a time and
 * parks the originals in the CCR store. Nothing before it decides WHICH of several
 * authorised excerpts matter to the task, so a large irrelevant log is compressed with the
 * same care as the one line that decides the next step.
 *
 * WHAT IT ADDS. `selectEvidence(task, excerpts)` asks, in one request over ≤ 12 excerpts:
 *   e<i>_use       Score  0..3 how useful excerpt i is to the task
 *   e<i>_required  Noul   is excerpt i REQUIRED to support the next decision?
 * and returns the excerpts RE-ORDERED (required first, then by usefulness; ties keep input
 * order) with the annotation attached. `compressSelected` then runs the existing
 * `compress()` over them in that order.
 *
 * AUTHORITY. It reorders and annotates; it never drops, truncates or rewrites an excerpt.
 * Every excerpt keeps its source id and its original bytes (the `original` field here, and
 * the CCR entry `compress()` already makes), so a low-ranked excerpt is still retrievable
 * and "never drop required task instructions or protected facts solely on inference" holds
 * by construction — there is no drop path to guard. Excerpts beyond the 12-excerpt window
 * are not judged and keep their relative order after the judged ones.
 *
 * LOCAL ONLY. Excerpts are file and log content (memory, pods and beads slots carry private
 * material), so this consumer refuses any endpoint that is not declared local
 * (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1`); there is no cloud override.
 *
 * OVERLAP. factrail compaction (ADR-2121/2093; lib/factrail.nix:3-6, agentbox.toml `[features.jev_compaction]` :742-785)
 * already uses a Jev judge to decide what a COMPACTION keeps, in the Claude Code session. It
 * does not see headroom's slots (memory/pods/beads/orchestrator payloads), which is the part
 * this adds.
 *
 * CALLER. `POST /v1/memory/search` (routes/memory.js `_rankMemoryResults`) ranks the result entries
 * for the query just before `headroom.compress` crushes them, the one place in management-api where
 * several excerpts meet the compressor. `headroom.compressSelected` is the same step for other callers.
 *
 * FLAG. `AGENTBOX_JEV_HEADROOM_EVIDENCE=1`, off by default. Off ⇒ `selectEvidence` returns
 * its input array untouched and `compressSelected` is exactly `compress()` per excerpt.
 */

const fs = require('fs');
const path = require('path');

const ITEM = 'AB-26-S1-01';
const FLAG = 'AGENTBOX_JEV_HEADROOM_EVIDENCE';
const QUESTION_SET_VERSION = 'ab26-headroom-evidence/1';
const TIMEOUT_MS = 4000;
const WINDOW = 12;
const EXCERPT_CHARS = 1200;
const USE_LEVELS = Object.freeze([
  'Irrelevant to the task.',
  'Background only: would not change the next decision.',
  'Useful: informs the next decision.',
  'Decisive: the next decision cannot be made correctly without it.',
]);

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

function clamp(s, n) { const t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) : t; }

/** Pure request builder; exported for the wire-shape test. */
function buildRequest(task, excerpts) {
  const win = excerpts.slice(0, WINDOW);
  const state = {
    task: clamp(task, 2000),
    excerpts: win.map((e, i) => ({ index: i, source_id: String(e.id), text: clamp(e.text, EXCERPT_CHARS) })),
  };
  const questions = {};
  win.forEach((e, i) => {
    questions[`e${i}_use`] = {
      type: 'score',
      instructions: `How useful is the excerpt at index ${i} of \`excerpts\` for deciding the next step of \`task\`?`,
      criteria: [...USE_LEVELS],
    };
    questions[`e${i}_required`] = {
      type: 'noul',
      instructions:
        `Is the excerpt at index ${i} of \`excerpts\` REQUIRED to support the next decision of \`task\` ` +
        '(it states a requirement, an error cause, a constraint or a fact the decision depends on)?',
    };
  });
  return { state, questions, window: win };
}

/**
 * Rank excerpts. Never throws. Resolves `{ items, annotations }`; `items` is the SAME array
 * object when the flag is off or Jev is unavailable, otherwise a new array of the same
 * excerpt objects in ranked order.
 *
 * @param {string} task
 * @param {{id:string,text:string}[]} excerpts
 * @param {object} [opts] { env, fetchImpl, sink }
 */
async function selectEvidence(task, excerpts, opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  const same = { items: excerpts, annotations: null };
  if (!jev || !jev.enabled(env, FLAG) || !Array.isArray(excerpts) || excerpts.length < 2) return same;
  const fail = (reason) => { jev.logFallback(ITEM, reason, opts.sink); return same; };
  if (typeof task !== 'string' || !task.trim()) return fail('malformed');

  const ep = jev.resolveEndpoint(env, { localOnly: true });
  if (!ep.ok) return fail(ep.reason);

  const req = buildRequest(task, excerpts);
  const res = await jev.ask(ep, req.state, req.questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
  if (!res.ok) return fail(res.reason);

  const minConf = Number.parseFloat(env.AGENTBOX_JEV_HEADROOM_MIN_CONFIDENCE || '0');
  const rows = [];
  for (let i = 0; i < req.window.length; i++) {
    const useAns = res.answers[`e${i}_use`];
    const use = jev.readScore(useAns, USE_LEVELS.length);
    const required = jev.readNoul(res.answers[`e${i}_required`]);
    const conf = useAns && typeof useAns.confidence === 'number' ? useAns.confidence : null;
    if (use === null || required === null || conf === null) return fail('malformed');
    if (conf < (Number.isFinite(minConf) ? minConf : 0)) return fail('low-confidence');
    rows.push({ i, use, required });
  }
  // Required first, then by usefulness; the sort is stable on the input index.
  const ranked = rows.slice().sort((a, b) => {
    const ar = a.required >= 0.5 ? 1 : 0;
    const br = b.required >= 0.5 ? 1 : 0;
    return br - ar || b.use - a.use || a.i - b.i;
  });
  const items = [...ranked.map((r) => excerpts[r.i]), ...excerpts.slice(req.window.length)];
  const annotations = {};
  for (const r of rows) {
    annotations[String(excerpts[r.i].id)] = {
      usefulness: Math.round(r.use * 1000) / 1000,
      required_p: Math.round(r.required * 1000) / 1000,
      question_set_version: QUESTION_SET_VERSION,
    };
  }
  return { items, annotations };
}

/**
 * Rank, then run the existing headroom `compress()` over each excerpt in ranked order.
 * Every result carries the source id and the untouched original text.
 *
 * @param {string} task
 * @param {{id:string,text:string}[]} excerpts
 * @param {string} slot headroom adapter slot
 * @param {object} [opts] { env, fetchImpl, sink, compress }  (`compress` defaults to headroom.compress)
 */
async function compressSelected(task, excerpts, slot, opts = {}) {
  const compress = opts.compress || require('./headroom').compress;
  const { items, annotations } = await selectEvidence(task, excerpts, opts);
  return items.map((e) => {
    const r = compress(e.text, slot, opts.compressOpts);
    const out = { id: e.id, original: e.text, ...r };
    if (annotations && annotations[String(e.id)]) out.jev = annotations[String(e.id)];
    return out;
  });
}

module.exports = { ITEM, FLAG, QUESTION_SET_VERSION, WINDOW, USE_LEVELS, buildRequest, selectEvidence, compressSelected };
