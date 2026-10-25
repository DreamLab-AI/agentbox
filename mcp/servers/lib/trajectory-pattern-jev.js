'use strict';
/**
 * trajectory-pattern-jev.js — the opt-in Jev option for AB-21-S1-01
 * ("semantically classify trajectory steps before aggregation").
 *
 * WHERE. The learning loop groups `trajectory_steps` by `action`, the low-cardinality,
 * already-redacted command pattern derived by `commandPattern`
 * (config/hooks/lib/trajectory-util.cjs:31) and recorded by trajectory-recorder.cjs. The
 * aggregate sweep (aggregate-effectiveness.js `run()`) computes Wilson bounds per pattern
 * and stores the survivors. Two different commands can share a verb (`make`, `npm run`),
 * and one intent can hide behind many verbs, so a tool-name grouping can mix unlike actions.
 *
 * WHAT IT ADDS. For each pattern that is already ELIGIBLE for promotion, one request with
 * two typed questions over the label and its recorded statistics:
 *
 *   action_class Choice  — a fixed taxonomy (below), with `other`
 *   coherent     Noul     — does this one label name a single kind of action, so that the
 *                           statistics describe the same thing? (low ⇒ contaminated group)
 *
 * and ATTACHES the answers to the row as `semantic` metadata. It never regroups, re-keys,
 * re-grades or drops anything: the original pattern, outcomes, recency weights, sample
 * floors, Wilson bounds, independence deflation, the producer/consumer gates (ADR-2017)
 * and the recall gate all run on exactly the data they ran on before.
 *
 * FLAG. `AGENTBOX_JEV_TRAJECTORY_CLASSIFY=1`, off by default. Off ⇒ `annotateRows` returns
 * its input array untouched and nothing leaves the process. This is a batch sweep, so the
 * per-call deadline is 15 s with no retry, and at most
 * `AGENTBOX_JEV_TRAJECTORY_MAX_PATTERNS` (default 40) patterns are asked per sweep.
 *
 * DATA CLASS. The label is the redacted `action` value (I10: no raw args, no secrets) and
 * four numbers. A tainted (email) session's steps are not recorded at all by the recorder,
 * so nothing tainted reaches here; set `AGENTBOX_JEV_TRAJECTORY_LOCAL_ONLY=1` to require a
 * declared local endpoint regardless.
 */

const fs = require('fs');
const path = require('path');

const FLAG = 'AGENTBOX_JEV_TRAJECTORY_CLASSIFY';
const ITEM = 'AB-21-S1-01';
const QUESTION_SET_VERSION = 'ab21-trajectory-pattern/1';
const TIMEOUT_MS = 15000;
const DEFAULT_MAX_PATTERNS = 40;

/** The fixed taxonomy. Every entry says when it applies AND when it does not. */
const TAXONOMY = Object.freeze({
  inspect_read: 'Reads or lists state without changing it (cat, ls, git status, git log, grep, head, tail). Not for commands that also write.',
  search: 'Looks for something across files or the web (rg, find, grep -r, gh search). Not for reading one known file.',
  edit_write: 'Creates or changes files or configuration (sed -i, tee, mv, cp, touch, patch). Not for committing.',
  build_compile: 'Compiles or bundles code (cargo build, make, npm run build, tsc, nix build). Not for running tests.',
  test_verify: 'Runs tests, linters or validators (cargo test, pytest, npm test, eslint, clippy, a validate script). Not for building artefacts.',
  vcs_change: 'Changes version-control state (git commit, git add, git checkout -b, git merge, git push). Not for read-only git commands.',
  package_manage: 'Installs or updates dependencies (npm install, pip install, apt, cargo add).',
  service_control: 'Starts, stops or inspects processes and containers (docker, supervisorctl, systemctl, tmux).',
  network_fetch: 'Moves data over the network (curl, wget, gh api, ssh).',
  data_store: 'Reads or writes a database or memory store (psql, sqlite3, claude-flow memory).',
  other: 'None of the above, or the label is too generic to tell (a bare interpreter, a script name).',
});
const CLASS_KEYS = Object.freeze(Object.keys(TAXONOMY));

const APP_ROOT = process.env.AGENTBOX_APP_ROOT || '/opt/agentbox';
let _jev;
function loadJev() {
  if (_jev !== undefined) return _jev;
  const rel = 'config/hooks/lib/jev-option.cjs';
  for (const base of [path.resolve(__dirname, '../../..'), path.resolve(__dirname, '../../../..'), APP_ROOT]) {
    const p = path.join(base, rel);
    if (fs.existsSync(p)) { _jev = require(p); return _jev; }
  }
  _jev = null;
  return _jev;
}

/** Build the request for one pattern row. Pure; exported for the wire-shape test. */
function buildRequest(row) {
  return {
    state: {
      action_pattern: String(row.pattern),
      observations: Number(row.n) || 0,
      distinct_trajectories: Number(row.n_trajectories) || 0,
      ambiguous_successes: Number(row.n_ambiguous) || 0,
      mean_quality: Math.round((Number(row.mean_quality) || 0) * 1000) / 1000,
    },
    questions: {
      action_class: {
        type: 'choice',
        instructions:
          'What kind of action does `action_pattern` name? It is a command verb with an optional sub-command ' +
          'and a shape marker, not a full command line. Choose `other` when the label is too generic to tell.',
        criteria: { ...TAXONOMY },
      },
      coherent: {
        type: 'noul',
        instructions:
          'Does `action_pattern` name ONE kind of action, so that `observations` and `mean_quality` describe ' +
          'comparable runs of the same thing? Answer no if the label would plausibly cover unlike actions ' +
          '(for example a bare interpreter or `make` running very different targets).',
      },
    },
  };
}

/** One row's annotation, or `{ ok:false, reason }`. Never throws. */
async function classifyRow(row, opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  if (!jev) return { ok: false, reason: 'no-adapter' };
  const ep = opts.endpoint || jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_TRAJECTORY_LOCAL_ONLY') });
  if (!ep.ok) return { ok: false, reason: ep.reason };
  const req = buildRequest(row);
  const res = await jev.ask(ep, req.state, req.questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
  if (!res.ok) return { ok: false, reason: res.reason };
  const cls = jev.readChoice(res.answers.action_class, CLASS_KEYS);
  const coherent = jev.readNoul(res.answers.coherent);
  if (!cls || cls.confidence === null || coherent === null) return { ok: false, reason: 'malformed' };
  const min = Number.parseFloat(env.AGENTBOX_JEV_TRAJECTORY_MIN_CONFIDENCE || '0');
  if (cls.confidence < (Number.isFinite(min) ? min : 0)) return { ok: false, reason: 'low-confidence' };
  return {
    ok: true,
    semantic: {
      action_class: cls.choice,
      class_confidence: Math.round(cls.confidence * 1000) / 1000,
      coherent_p: Math.round(coherent * 1000) / 1000,
      question_set_version: QUESTION_SET_VERSION,
    },
  };
}

/**
 * Annotate rows with `semantic` metadata. Flag off, or nothing to ask: returns the SAME array.
 * Otherwise returns a NEW array of NEW row objects (the inputs are never mutated); a row that
 * could not be classified is returned as the very same object it came in as. Never throws.
 */
async function annotateRows(rows, opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  if (!jev || !jev.enabled(env, FLAG) || !Array.isArray(rows) || !rows.length) return rows;
  const ep = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_TRAJECTORY_LOCAL_ONLY') });
  if (!ep.ok) { jev.logFallback(ITEM, ep.reason, opts.sink); return rows; }
  const cap = Math.max(0, Number.parseInt(env.AGENTBOX_JEV_TRAJECTORY_MAX_PATTERNS || '', 10) || DEFAULT_MAX_PATTERNS);
  const out = [];
  let asked = 0;
  const reasons = new Set();
  for (const row of rows) {
    if (asked >= cap) { out.push(row); continue; }
    asked++;
    const r = await classifyRow(row, { ...opts, env, endpoint: ep });
    if (r.ok) out.push({ ...row, semantic: r.semantic });
    else { reasons.add(r.reason); out.push(row); }
  }
  for (const reason of reasons) jev.logFallback(ITEM, reason, opts.sink);
  return out;
}

/** The extra keys to spread into a stored aggregate value: `{}` unless the row was annotated. */
function semanticFields(row) {
  return row && row.semantic ? { semantic: row.semantic } : {};
}

module.exports = {
  FLAG, ITEM, QUESTION_SET_VERSION, TAXONOMY, CLASS_KEYS,
  buildRequest, classifyRow, annotateRows, semanticFields,
};
