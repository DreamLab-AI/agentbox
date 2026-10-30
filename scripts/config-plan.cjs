#!/usr/bin/env node
'use strict';

/**
 * config-plan — `./agentbox.sh config plan "<plain-language request>"` (AB-05-S1-01).
 *
 * A READ-ONLY, PROPOSE-ONLY planner. It turns a request such as "turn off the desktop" into a
 * proposed one-line diff of agentbox.toml and PRINTS it. It never edits agentbox.toml (or any
 * file outside a private temp dir): the operator applies the change by hand. Before this
 * existed nothing turned a request into a plan, so every failure path prints "no plan" and
 * exits 3 with nothing written, which is exactly the pre-existing behaviour.
 *
 * Opt-in: `AGENTBOX_JEV_MANIFEST_PLAN=1` and a System One endpoint (local-only when `AGENTBOX_JEV_MANIFEST_LOCAL_ONLY=1`; see jev-option.cjs:
 * the cloud and an undeclared proxy are refused, because a request can name private config).
 *
 * What the model decides, and what it cannot:
 *   • Choice: which catalogue entry (from system-manifest.js CATALOGUE, boolean gates only)
 *     the request concerns, or `none`. Noul: does the request ask for that entry's state to
 *     change, and (one per `requires`) is each prerequisite satisfied.
 *   • The model never writes a key, a value or any text that reaches the diff. The key comes
 *     from the catalogue, the new value is parsed from the request IN CODE (enable/disable
 *     wording, ambiguous or conflicting wording gives no plan), and prerequisites are also
 *     checked in code against the live manifest.
 *   • The proposed manifest must pass scripts/agentbox-config-validate.js on a temporary copy.
 *
 * Exit codes: 0 a plan was printed; 3 no plan is available (flag off, no local endpoint,
 * transport error, timeout, malformed reply, low confidence, unsupported request, failed
 * validation, key not found as a plain boolean line); 2 usage.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { CATALOGUE, resolveGate } = require(path.join(ROOT, 'management-api', 'lib', 'system-manifest.js'));
const jev = require(path.join(ROOT, 'config', 'hooks', 'lib', 'jev-option.cjs'));

const FLAG = 'AGENTBOX_JEV_MANIFEST_PLAN';
const QUESTION_SET = 'manifest-plan-jev/1';
const NONE = 'none';
const NONE_RUBRIC = 'The request is not about any listed setting, asks for something these settings cannot do, or is too vague to tell. Choose this when in doubt.';
const NO_PLAN = 'No plan is available. Edit agentbox.toml by hand, then run ./agentbox.sh config validate.';

const ENABLE = /\b(enable|turn on|switch on|activate|start using|allow|add)\b/i;
const DISABLE = /\b(disable|turn off|switch off|deactivate|stop using|remove|drop)\b/i;

function num(v, dflt) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}

/** The value the request asks for, parsed from its wording alone; null when absent or contradictory. */
function parseDirection(request) {
  const on = ENABLE.test(request);
  const off = DISABLE.test(request);
  if (on === off) return null;
  return on;
}

/** Catalogue entries a plan may touch: a single boolean gate, present in the manifest. Maps id → entry + target key. */
function candidates(manifest) {
  const out = {};
  for (const e of CATALOGUE) {
    if (typeof e.gate !== 'string') continue;
    const cur = resolveGate(manifest, e.gate);
    if (typeof cur !== 'boolean') continue;
    let node = manifest;
    for (const k of e.gate.split('.')) node = node && node[k];
    const key = node !== null && typeof node === 'object' ? `${e.gate}.enabled` : e.gate;
    out[e.id] = { entry: e, key, current: cur };
  }
  return out;
}

/**
 * Replace `key = true|false` in the text, keeping any trailing comment. Returns the new text, or
 * null unless the key is a plain boolean line inside exactly its own table (never guessed).
 */
function setBoolean(text, dotted, value) {
  const parts = dotted.split('.');
  const leaf = parts.pop();
  const table = parts.join('.');
  const lines = text.split('\n');
  let inTable = table === '';
  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/);
    if (h && !lines[i].trim().startsWith('[[')) { inTable = h[1].replace(/\s+/g, '') === table; continue; }
    if (lines[i].trim().startsWith('[[')) { inTable = false; continue; }
    if (inTable && new RegExp(`^\\s*${leaf}\\s*=\\s*(true|false)\\b`).test(lines[i])) {
      if (hit !== -1) return null;
      hit = i;
    }
  }
  if (hit === -1) return null;
  lines[hit] = lines[hit].replace(/=\s*(true|false)\b/, `= ${value}`);
  return lines.join('\n');
}

/** A unified diff for a one-line change (setBoolean never changes the line count), with 2 lines of context; no external `diff`. */
function unifiedDiff(a, b, label) {
  const x = a.split('\n');
  const y = b.split('\n');
  const i = x.findIndex((l, n) => l !== y[n]);
  if (i === -1) return '';
  const from = Math.max(0, i - 2);
  const to = Math.min(x.length, i + 3);
  const body = [];
  for (let n = from; n < to; n++) {
    if (n === i) body.push(`-${x[n]}`, `+${y[n]}`);
    else body.push(` ${x[n]}`);
  }
  return `--- a/${label}\n+++ b/${label}\n@@ -${from + 1},${to - from} +${from + 1},${to - from} @@\n${body.join('\n')}\n`;
}

/** Run the repository validator on a private temp copy; true only on a clean exit. */
function validates(text, validator) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-plan-'));
  try {
    const f = path.join(dir, 'agentbox.toml');
    fs.writeFileSync(f, text);
    const r = (validator || ((p) => spawnSync('node', [path.join(ROOT, 'scripts', 'agentbox-config-validate.js'), p], { encoding: 'utf8', timeout: 60000 })))(f);
    return r.status === 0;
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Plan one request. Resolves `{ plan: string }` or `{ reason }`; never throws or writes.
 * `opts`: `env`, `fetchImpl`, `manifestPath`, `parseToml`, `validator`, `log`.
 */
async function plan(request, opts = {}) {
  const env = opts.env || process.env;
  const miss = (reason) => { jev.logFallback('ab-05', reason, opts.log); return { reason }; };
  try {
    if (!jev.enabled(env, FLAG)) return { reason: 'flag-off' };
    const text = typeof request === 'string' ? request.trim().slice(0, 500) : '';
    if (!text) return { reason: 'empty' };
    const want = parseDirection(text);
    if (want === null) return miss('direction');
    const endpoint = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_MANIFEST_LOCAL_ONLY') });
    if (!endpoint.ok) return miss(endpoint.reason);

    const file = opts.manifestPath || path.join(ROOT, 'agentbox.toml');
    const original = fs.readFileSync(file, 'utf8');
    const manifest = (opts.parseToml || require('@iarna/toml').parse)(original);
    const cands = candidates(manifest);
    const ids = Object.keys(cands);
    if (!ids.length) return miss('no-candidates');

    const criteria = {};
    for (const id of ids) criteria[id] = `${cands[id].entry.name}: ${cands[id].entry.summary}`;
    criteria[NONE] = NONE_RUBRIC;
    const t = { fetchImpl: opts.fetchImpl, timeoutMs: Math.floor(Number(env.AGENTBOX_JEV_MANIFEST_TIMEOUT_MS) || 10000), retries: 0 };
    const first = await jev.ask(endpoint, { request: text }, {
      setting: jev.choiceQuestion('Which one agentbox setting does `request` ask to change? Choose `none` unless exactly one is plain.', criteria),
    }, t);
    if (!first.ok) return miss(first.reason);
    const pick = jev.readChoice(first.answers.setting, [...ids, NONE]);
    if (!pick) return miss('malformed');
    if (pick.choice === NONE) return miss('unsupported');
    const minConf = num(env.AGENTBOX_JEV_MANIFEST_MIN_CONFIDENCE, 0.7);
    const minSupport = num(env.AGENTBOX_JEV_MANIFEST_MIN_SUPPORT, 0.7);
    if (pick.confidence === null || pick.confidence < minConf) return miss('low-confidence');

    const c = cands[pick.choice];
    const requires = Array.isArray(c.entry.requires) ? c.entry.requires : [];
    const questions = {
      asks: jev.noulQuestion(`Does \`request\` ask to turn ${want ? 'ON' : 'OFF'} this setting: ${c.entry.name} (${c.entry.summary})? Answer no if it asks for something else or the opposite.`),
    };
    requires.forEach((r, i) => { questions[`req_${i}`] = jev.noulQuestion(`Is it plain from \`request\` or \`satisfied\` that the prerequisite \`${r}\` is already satisfied for ${c.entry.name}?`); });
    const second = await jev.ask(endpoint, { request: text, satisfied: requires.filter((r) => resolveGate(manifest, r) === true) }, questions, t);
    if (!second.ok) return miss(second.reason);
    const asks = jev.readNoul(second.answers.asks);
    const reqs = requires.map((_, i) => jev.readNoul(second.answers[`req_${i}`]));
    if (asks === null || reqs.some((v) => v === null)) return miss('malformed');
    if (asks < minSupport) return miss('not-requested');
    // Prerequisites are authoritative in code; the Noul can only add a refusal when enabling.
    if (want && (requires.some((r) => resolveGate(manifest, r) !== true) || reqs.some((v) => v < minSupport))) return miss('prerequisite');
    if (c.current === want) return miss('already-set');

    const next = setBoolean(original, c.key, want);
    if (next === null) return miss('key-not-found');
    if (!validates(next, opts.validator)) return miss('validation');
    return {
      plan: unifiedDiff(original, next, 'agentbox.toml'),
      key: c.key, value: want, apply_class: c.entry.apply_class, set: QUESTION_SET,
    };
  } catch { return miss('error'); }
}

const APPLY_HINT = {
  live: 'takes effect immediately',
  boot: 'takes effect on the next container restart',
  rebuild: 'needs ./agentbox.sh rebuild',
};

async function main(argv) {
  const request = argv.join(' ').trim();
  if (!request) { process.stderr.write('usage: agentbox.sh config plan "<plain-language request>"\n'); return 2; }
  const r = await plan(request);
  if (!r.plan) { process.stderr.write(`${NO_PLAN}\n`); return 3; }
  process.stdout.write(`# Proposed change (NOT applied): ${r.key} = ${r.value}; ${APPLY_HINT[r.apply_class] || r.apply_class}.\n`);
  process.stdout.write('# Validated on a temporary copy. Apply by hand, then run ./agentbox.sh config validate.\n');
  process.stdout.write(r.plan);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c));

module.exports = { FLAG, QUESTION_SET, NO_PLAN, parseDirection, candidates, setBoolean, validates, plan, main };
