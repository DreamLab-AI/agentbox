#!/usr/bin/env node
'use strict';

/**
 * EXP-B8 — the bounded routing label-log experiment (docs/experiments/EXP-B8-label-log.md).
 *
 * Owner decision 2026-10-02 R5b: switch ADR-2110's label log on as a bounded test, and switch
 * it off once the pre-registered stopping rule fires, with a report on the forum. Nobody has
 * to remember: supercronic ticks this script from skills/podcast-knowledge-ingest/crontab
 * (the one supervised crontab read from the checkout, so it survives a restart without a
 * rebuild). Each tick:
 *
 *   1. while [skills.routing].label_log = true in the CHECKOUT manifest and no stop is
 *      recorded: keeps the router hook (with AGENTBOX_SKILL_ROUTE_LABEL_LOG=1) and the
 *      Stop recorder registered in ~/.claude/settings.json from the checkout, then counts
 *      analysable rows in routing_labels;
 *   2. when 510 rows exist or the UTC date is 2026-10-20: records the stop, de-registers
 *      both hooks, runs the ONE pre-specified test, writes the report, opens a pull request
 *      that sets label_log = false and records the verdict in ADR-2110's Disposition
 *      (never merged, never forced), and posts one plain-English summary to the forum as
 *      JunkieJarvis in the dream digest's channel — at most once, ever.
 *
 * Everything that decides is pure and exported for tests/config/exp-b8-label-log.test.js;
 * the tick takes its side effects as injected dependencies.
 *
 *   node scripts/experiments/exp-b8-label-log.cjs            one tick
 *   node scripts/experiments/exp-b8-label-log.cjs --status   state and current count; changes nothing
 *   node scripts/experiments/exp-b8-label-log.cjs --dry-run  as a tick, but never registers,
 *                                                            posts, commits or records a stop
 *   node scripts/experiments/exp-b8-label-log.cjs --check-post  resolve the forum signer and the
 *                                                            zone write plan WITHOUT sending; records
 *                                                            the plan type (never key material) in
 *                                                            state.json as post_check
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ───────────────────────────── protocol (pre-registered) ─────────────────────────────

const PROTOCOL = Object.freeze({
  id: 'EXP-B8',
  doc: 'docs/experiments/EXP-B8-label-log.md',
  targetN: 510,
  hardStop: '2026-10-20',
  alpha: 0.05,
  power: 0.8,
  mde: 0.05,
  psi: 14 / 86,
});

/** What each verdict does to ADR-2110's status fields. The log is off after every verdict. */
const ACTIONS = Object.freeze({
  KEEP: { decision_status: 'accepted', activation_status: 'inactive',
    next: 'ADR-2110 stays accepted; open question 1 (embedding retention) goes to the owner before the log is switched on again.' },
  WITHDRAW: { decision_status: 'rejected', activation_status: 'inactive',
    next: 'ADR-2110 is withdrawn (rejected): the judge did not beat its copy ceiling on live turns, so the routing premise of the façade programme is falsified at this effect size.' },
  INCONCLUSIVE: { decision_status: 'rejected', activation_status: 'inactive',
    next: 'ADR-2110 is withdrawn (rejected) as not shown: the sample was not reached by the hard date, and the cycle rule puts the burden of proof on the record.' },
});

/** Two-sided standard-normal quantiles for the registered alpha and power. */
const Z = { 0.05: 1.959964, 0.8: 0.841621 };

/** Connor (1987) paired-proportions sample size, as shown in the protocol. */
function requiredSampleSize({ alpha, power, mde, psi }) {
  const za = Z[alpha], zb = Z[power];
  return Math.ceil(((za * Math.sqrt(psi) + zb * Math.sqrt(psi - mde * mde)) ** 2) / (mde * mde));
}

/** A skill name without its `plugin:` qualifier. */
function bare(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split(':');
  return parts[parts.length - 1];
}

/** A row the test can use: routable-or-none label, a judge pick, and a shadow BM25 pick. */
function isAnalysable(r) {
  return !!r && typeof r.label === 'string' && r.label !== 'other'
    && typeof r.router_pick === 'string' && typeof r.bm25_pick === 'string'
    && typeof r.bm25_score === 'number' && Number.isFinite(r.bm25_score);
}

function countAnalysable(rows) {
  return rows.filter(isAnalysable).length;
}

function utcDate(d) { return d.toISOString().slice(0, 10); }

/** Stop at the registered sample, or on/after the hard date (UTC), whichever is first. */
function stoppingRule({ n, now, targetN = PROTOCOL.targetN, hardStop = PROTOCOL.hardStop }) {
  if (n >= targetN) return { stop: true, reason: 'sample' };
  if (utcDate(now) >= hardStop) return { stop: true, reason: 'date' };
  return { stop: false, reason: null };
}

/** P[X <= k], X ~ Bin(m, 1/2), summed in log space so large m stays finite. */
function binomCdfHalf(k, m) {
  let logC = 0, total = 0;
  const logHalfM = m * Math.log(0.5);
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log(m - i + 1) - Math.log(i);
    total += Math.exp(logC + logHalfM);
  }
  return total;
}

/** Exact two-sided McNemar on discordant counts b and c. */
function mcnemarExact(b, c) {
  const m = b + c;
  if (m === 0) return 1;
  return Math.min(1, 2 * binomCdfHalf(Math.min(b, c), m));
}

/** The ceiling's pick: BM25's top option, or `none` below t. A zero score is always a decline. */
function ceilingPick(r, t) {
  return r.bm25_score > 0 && r.bm25_score >= t ? bare(r.bm25_pick) : 'none';
}

/**
 * ADR-2095 copy ceiling: BM25 with a decline threshold chosen over EVERY observed score
 * breakpoint (rule 1), oracle-tuned on the rows themselves. Ties go to the lowest threshold.
 */
function copyCeiling(rows) {
  const scores = [...new Set(rows.map((r) => r.bm25_score).filter((s) => s > 0))].sort((a, b) => a - b);
  const candidates = [...scores, Infinity];
  let best = null;
  for (const t of candidates) {
    const correct = rows.map((r) => ceilingPick(r, t) === bare(r.label));
    const k = correct.filter(Boolean).length;
    if (!best || k > best.k) best = { threshold: t, correct, k };
  }
  if (!best) return { threshold: Infinity, correct: [], accuracy: 0 };
  return { threshold: best.threshold, correct: best.correct, accuracy: rows.length ? best.k / rows.length : 0 };
}

function verdictOf({ p, b, c, n, targetN = PROTOCOL.targetN, alpha = PROTOCOL.alpha }) {
  if (n > 0 && p < alpha) return b > c ? 'KEEP' : 'WITHDRAW';
  return n >= targetN ? 'WITHDRAW' : 'INCONCLUSIVE';
}

/** The one pre-specified analysis. */
function analyse(allRows, { targetN = PROTOCOL.targetN, alpha = PROTOCOL.alpha } = {}) {
  const rows = allRows.filter(isAnalysable);
  const n = rows.length;
  const judge = rows.map((r) => bare(r.router_pick) === bare(r.label));
  const ceil = copyCeiling(rows);
  let b = 0, c = 0;
  rows.forEach((_, i) => {
    if (judge[i] && !ceil.correct[i]) b++;
    else if (!judge[i] && ceil.correct[i]) c++;
  });
  const p = mcnemarExact(b, c);
  const judgeRight = judge.filter(Boolean).length;
  const noneLabels = rows.filter((r) => r.label === 'none').length;
  return {
    n, b, c, p,
    judgeRight, judgeAccuracy: n ? judgeRight / n : 0,
    ceilingRight: ceil.correct.filter(Boolean).length, ceilingAccuracy: ceil.accuracy,
    threshold: ceil.threshold,
    psiObserved: n ? (b + c) / n : 0,
    noneLabels, skillLabels: n - noneLabels,
    excluded: allRows.length - n,
    underpowered: n < targetN,
    verdict: verdictOf({ p, b, c, n, targetN, alpha }),
  };
}

// ───────────────────────────── report shapes ─────────────────────────────

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const fmtP = (p) => (p < 0.0001 ? p.toExponential(2) : p.toFixed(4));
const fmtT = (t) => (Number.isFinite(t) ? String(Number(t.toFixed(4))) : '∞ (always decline)');

const PLAIN_VERDICT = {
  KEEP: 'the AI judge did measurably better than the keyword baseline, so the routing-label work is kept',
  WITHDRAW: 'the AI judge did not do measurably better than the keyword baseline, so the routing-label proposal is withdrawn',
  INCONCLUSIVE: 'there was not enough data by the deadline to tell the two apart, so the routing-label proposal is withdrawn as not shown',
};

function chanceWords(p) {
  if (p < 0.001) return 'less than 1 time in 1,000';
  if (p < 0.01) return 'less than 1 time in 100';
  return `about ${Math.max(1, Math.round(p * 100))} times in 100`;
}

function composeReport(a, meta) {
  const act = ACTIONS[a.verdict];
  return [
    `# EXP-B8 report — ${meta.date}`,
    '',
    `Generated ${meta.generatedAt} by \`scripts/experiments/exp-b8-label-log.cjs\` when the stopping rule fired (${meta.reason === 'sample' ? `sample of ${PROTOCOL.targetN} reached` : `hard date ${PROTOCOL.hardStop} reached`}). Protocol: \`${PROTOCOL.doc}\`, pre-registered 2026-10-02.`,
    '',
    '## Verdict',
    '',
    `**${a.verdict}**${a.underpowered ? ` (underpowered: n = ${a.n} of ${PROTOCOL.targetN})` : ''}. ${act.next}`,
    '',
    '## Numbers',
    '',
    '| Quantity | Value |',
    '|---|---|',
    `| Analysable turns | n = ${a.n} (excluded: ${a.excluded}; labels: ${a.noneLabels} none, ${a.skillLabels} skill) |`,
    `| Judge agreement with the teacher | ${a.judgeRight}/${a.n} = ${pct(a.judgeAccuracy)} |`,
    `| Copy ceiling (BM25, decline below ${fmtT(a.threshold)}) | ${a.ceilingRight}/${a.n} = ${pct(a.ceilingAccuracy)} |`,
    `| Discordant pairs | b = ${a.b} (judge only right), c = ${a.c} (ceiling only right) |`,
    `| Exact two-sided McNemar | p = ${fmtP(a.p)} (alpha ${PROTOCOL.alpha}) |`,
    `| Observed discordant share | ψ = ${a.psiObserved.toFixed(3)} (planned ${PROTOCOL.psi.toFixed(3)}; above plan means power below ${PROTOCOL.power}) |`,
    '',
    '## What happens next',
    '',
    `- \`[skills.routing].label_log = false\` and ADR-2110 → decision_status \`${act.decision_status}\`, activation_status \`${act.activation_status}\`, in the pull request ${meta.prUrl || '(being opened by the next tick)'}. It is not merged automatically.`,
    '- Both hooks were de-registered from `~/.claude/settings.json` at the stop. Sessions started before the stop keep their hook snapshot until they end; rows recorded after the stop are not in this analysis.',
    '- The `routing_labels` table is kept, pending ADR-2110 open question 1 (retention).',
    '',
    '## Protocol',
    '',
    `MDE ${PROTOCOL.mde * 100} points, power ${PROTOCOL.power}, alpha ${PROTOCOL.alpha} two-sided, n = ${PROTOCOL.targetN} (Connor 1987, ψ = 14/86 from ADR-2095), hard stop ${PROTOCOL.hardStop}. One test, no interim looks. Known bias: the judge's pick is shown to the main model, which inflates judge agreement, so a KEEP is an upper bound and a WITHDRAW is robust.`,
    '',
  ].join('\n');
}

function composeForumPost(a, meta) {
  const lines = [
    'Routing experiment EXP-B8 has finished, and the routing label log is now switched off.',
    '',
    'The question: when someone asks the agent for something, does the skill router\'s AI judge suggest the right skill more often than a simple keyword match over the same skill descriptions?',
    '',
    `What we measured: ${a.n} real requests. For each one we compared both suggestions with the skill the main model actually went on to use. The AI judge matched it ${a.judgeRight} times (${pct(a.judgeAccuracy)}); the best possible keyword rule matched it ${a.ceilingRight} times (${pct(a.ceilingAccuracy)}). They disagreed on ${a.b + a.c} requests: the judge alone was right on ${a.b}, the keyword rule alone on ${a.c}. A gap like that would turn up by luck alone ${chanceWords(a.p)}.`,
    '',
    `The verdict: ${PLAIN_VERDICT[a.verdict]}.${a.underpowered ? ` (We planned for ${PROTOCOL.targetN} requests and reached ${a.n}.)` : ''}`,
    '',
    'No request text was stored at any point.',
    meta.prUrl ? `The change that records this is waiting for review: ${meta.prUrl}` : 'A pull request recording this is being opened for review.',
  ];
  return lines.join('\n');
}

// ───────────────────────────── manifest and ADR edits ─────────────────────────────

/** [skills.routing].label_log from manifest text (anchored section parse, as the entrypoint). */
function manifestLabelLog(toml) {
  let inSec = false;
  for (const line of String(toml).split('\n')) {
    if (/^\s*\[/.test(line)) { inSec = /^\s*\[skills\.routing\]\s*$/.test(line); continue; }
    if (!inSec) continue;
    const m = line.match(/^\s*label_log\s*=\s*([A-Za-z]+)/);
    if (m) return m[1].toLowerCase() === 'true';
  }
  return false;
}

/** The manifest with only [skills.routing].label_log set to false; every other byte kept. */
function flipManifestOff(toml) {
  let inSec = false;
  return String(toml).split('\n').map((line) => {
    if (/^\s*\[/.test(line)) { inSec = /^\s*\[skills\.routing\]\s*$/.test(line); return line; }
    if (inSec && /^\s*label_log\s*=/.test(line)) return line.replace(/(label_log\s*=\s*)true\b/, '$1false');
    return line;
  }).join('\n');
}

function setFrontmatter(text, key, value) {
  const re = new RegExp(`^${key}: .*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}: ${value}`) : text;
}

function applyAdrVerdict(adrText, a, meta) {
  const act = ACTIONS[a.verdict];
  let out = setFrontmatter(adrText, 'decision_status', act.decision_status);
  out = setFrontmatter(out, 'activation_status', act.activation_status);
  const block = [
    '',
    `## Disposition — ${meta.date} (EXP-B8 verdict)`,
    '',
    `- **Verdict:** ${a.verdict}${a.underpowered ? ` (underpowered: n = ${a.n} of ${PROTOCOL.targetN})` : ''}. Judge ${a.judgeRight}/${a.n} (${pct(a.judgeAccuracy)}) against the BM25 copy ceiling ${a.ceilingRight}/${a.n} (${pct(a.ceilingAccuracy)}); discordant b = ${a.b}, c = ${a.c}; exact McNemar p = ${fmtP(a.p)}.`,
    `- **Stop:** ${meta.reason === 'sample' ? `the sample of ${PROTOCOL.targetN} was reached` : `the hard date ${PROTOCOL.hardStop} was reached`}; written by \`scripts/experiments/exp-b8-label-log.cjs\` under the pre-registered protocol \`${PROTOCOL.doc}\` (owner decision 2026-10-02 R5b). Report: \`docs/experiments/EXP-B8-report.md\`.`,
    `- **Action:** \`label_log = false\`; decision_status \`${act.decision_status}\`, activation_status \`${act.activation_status}\`. ${act.next}`,
    '',
  ].join('\n');
  return out.replace(/\s*$/, '\n') + block;
}

// ───────────────────────────── hook registration ─────────────────────────────

const ROUTER_FILE = 'skill-route.cjs';
const RECORDER_FILE = 'routing-label-recorder.cjs';
const LABEL_ENV = ' AGENTBOX_SKILL_ROUTE_LABEL_LOG=1';

function routerOff(cmd, bakedHooks) {
  return cmd.split(LABEL_ENV).join('').replace(/node \S*\/skill-route\.cjs/, `node ${bakedHooks}/${ROUTER_FILE}`);
}
function routerOn(cmd, { checkoutHooks, bakedHooks }) {
  return routerOff(cmd, bakedHooks).replace(`node ${bakedHooks}/${ROUTER_FILE}`, `${LABEL_ENV.trim()} node ${checkoutHooks}/${ROUTER_FILE}`);
}

/**
 * Pure: settings with the experiment's hooks on or off. On: the router command gains the
 * label-log env and runs the checkout's hook (which carries the shadow BM25 arm), and the
 * recorder is registered on Stop from the checkout. Off: exactly the entrypoint's off state.
 * Never adds a router hook that is not already registered.
 */
function applyRegistration(settings, { on, checkoutHooks, bakedHooks, embedUrl, minChars }) {
  const before = JSON.stringify(settings);
  const s = JSON.parse(before);
  s.hooks = s.hooks || {};
  let routerFound = false;
  for (const group of s.hooks.UserPromptSubmit || []) {
    for (const h of group.hooks || []) {
      if (!String(h.command || '').includes(ROUTER_FILE)) continue;
      routerFound = true;
      h.command = on ? routerOn(h.command, { checkoutHooks, bakedHooks }) : routerOff(h.command, bakedHooks);
    }
  }
  const isRecorder = (g) => (g.hooks || []).some((h) => String(h.command || '').includes(RECORDER_FILE));
  if (Array.isArray(s.hooks.Stop)) s.hooks.Stop = s.hooks.Stop.filter((g) => !isRecorder(g));
  if (on) {
    s.hooks.Stop = s.hooks.Stop || [];
    s.hooks.Stop.push({ hooks: [{ type: 'command', timeout: 15,
      command: `AGENTBOX_ROUTING_LABELS=1 AGENTBOX_ROUTING_LABELS_EMBED_URL=${JSON.stringify(embedUrl)} AGENTBOX_SKILL_ROUTE_MIN_CHARS=${minChars} node ${checkoutHooks}/${RECORDER_FILE} || true` }] });
  }
  if (Object.keys(s.hooks).length === 0 && !JSON.parse(before).hooks) delete s.hooks;
  return { settings: s, changed: JSON.stringify(s) !== before, routerFound };
}

// ───────────────────────────── state and posting ─────────────────────────────

function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { return {}; }
}
function saveState(dir, st) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'state.json'), tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, f);
}

/**
 * At-most-once forum post. `publish(content, markSent)` calls `markSent()` immediately before
 * the event leaves for the relay; that persists the attempt, so neither a failed send nor a
 * crash mid-send can lead to a second post on a later tick. A refusal BEFORE any send (no
 * signing key, no zone key yet: never posted in plaintext) is not an attempt and is retried.
 */
async function postOnce(state, publish, save, content) {
  if (state.post && state.post.attempted_at) return { posted: false, reason: 'already-attempted' };
  const markSent = () => {
    if (state.post && state.post.attempted_at) return;
    state.post = { attempted_at: new Date().toISOString() };
    save(state);
  };
  try {
    const id = await publish(content, markSent);
    markSent();
    state.post.event_id = id;
    save(state);
    return { posted: true, eventId: id };
  } catch (e) {
    const error = String((e && e.message) || e);
    if (!(state.post && state.post.attempted_at)) {
      state.post_refused = { at: new Date().toISOString(), error };
      save(state);
      return { posted: false, reason: 'not-sent', error };
    }
    state.post.error = error;
    save(state);
    return { posted: false, reason: 'publish-failed', error };
  }
}

// ───────────────────────────── the tick ─────────────────────────────

async function finish(d, st, save) {
  const dir = d.stateDir;
  const meta = () => ({ date: st.stop.at.slice(0, 10), reason: st.stop.reason, generatedAt: st.stop.at, prUrl: st.pr_url || null });
  if (!st.analysis) {
    const rows = await d.fetchRows(st.started_at, st.stop.at);
    st.analysis = analyse(rows);
    save(st);
  }
  const a = st.analysis;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ protocol: PROTOCOL, stop: st.stop, analysis: a }, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), composeReport(a, meta()));
  if (!st.pr_url) {
    try {
      st.pr_url = await d.openPr({ analysis: a, meta: meta(), reportMd: composeReport(a, meta()) });
      delete st.pr_error;
    } catch (e) {
      st.pr_error = String((e && e.message) || e);
      d.log(`pull request not opened yet (retried next tick): ${st.pr_error}`);
    }
    save(st);
  }
  await postOnce(st, d.publish, save, composeForumPost(a, meta()));
  const posted = !!(st.post && st.post.attempted_at);
  return { phase: st.pr_url && posted ? 'done' : 'stopped', n: a.n, verdict: a.verdict, pr: st.pr_url || null, post: st.post };
}

async function tick(d) {
  const dir = d.stateDir;
  const dry = !!d.dryRun;
  const st = loadState(dir);
  const save = dry ? () => {} : (s) => saveState(dir, s);
  const now = d.now();
  const register = (on) => {
    if (dry) return null;
    const r = applyRegistration(d.readSettings(), { on, ...(d.registration || {}) });
    if (r.changed) d.writeSettings(r.settings);
    return r;
  };

  if (st.stop) { register(false); return finish(d, st, save); }
  if (!d.manifestOn()) { register(false); return { phase: 'off' }; }

  const r = register(true);
  if (r && !r.routerFound) d.log('no skill-route hook registered: judge picks will be absent, so no row is analysable');
  if (!st.started_at && !dry) { st.started_at = now.toISOString(); save(st); }
  const n = await d.countRows(st.started_at || now.toISOString());
  const rule = stoppingRule({ n, now });
  st.last_count = { n, at: now.toISOString() };
  if (!rule.stop) { save(st); return { phase: 'running', n }; }

  if (dry) {
    const rows = await d.fetchRows(st.started_at || '1970-01-01T00:00:00Z', now.toISOString());
    const a = analyse(rows);
    return { phase: 'dry-run', n, analysis: a, report: composeReport(a, { date: utcDate(now), reason: rule.reason, generatedAt: now.toISOString(), prUrl: null }), post: composeForumPost(a, { prUrl: null }) };
  }
  st.stop = { at: now.toISOString(), reason: rule.reason, n };
  save(st);
  register(false);
  d.log(`stopping rule fired (${rule.reason}, n = ${n}); hooks de-registered`);
  return finish(d, st, save);
}

// ───────────────────────────── real dependencies ─────────────────────────────

const HOME = process.env.HOME || '/home/devuser';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const CHECKOUT = process.env.AGENTBOX_DIR || path.resolve(__dirname, '..', '..');
const STATE_DIR = process.env.EXP_B8_STATE_DIR || path.join(WORKSPACE, '.agentbox', 'exp-b8');
const SETTINGS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'settings.json');
const BRANCH = 'exp-b8/label-log-verdict';
const RELAY_URL = process.env.FORUM_RELAY_URL || 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
// The dream digest's channel and section (services/dream-engine/src/digest.rs DEFAULT_CHANNEL/SECTION).
const CHANNEL = process.env.DREAM_DIGEST_CHANNEL || 'f2f2bd670b66d01b03cc701e16e1c47920406e337aae49c47f5e3af122960e47';
const SECTION = process.env.DREAM_DIGEST_SECTION || 'zone4-chat-with-agents';

function logLine(msg) {
  const line = `${new Date().toISOString()} [exp-b8] ${msg}`;
  console.log(line);
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.appendFileSync(path.join(STATE_DIR, 'tick.log'), `${line}\n`); } catch { /* best effort */ }
}

/** git/gh: PATH first (supercronic's PATH has neither), then the paths recorded at --activate. */
function tool(name) {
  for (const dir of String(process.env.PATH || '').split(':')) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  try {
    const p = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'tools.json'), 'utf8'))[name];
    fs.accessSync(p, fs.constants.X_OK);
    return p;
  } catch { /* fall through */ }
  throw new Error(`${name} not found on PATH or in ${STATE_DIR}/tools.json (run --activate from a shell)`);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function loadPg() {
  for (const p of ['/home/devuser/workspace/.claude-pg/node_modules/pg', path.join(CHECKOUT, 'management-api/node_modules/pg'), 'pg']) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error('pg module unavailable');
}

async function fetchRows(since, until) {
  const Pg = loadPg();
  const kv = {};
  for (const pair of String(process.env.RUVECTOR_PG_CONNINFO || 'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector').split(/\s+/)) {
    const i = pair.indexOf('='); if (i > 0) kv[pair.slice(0, i)] = pair.slice(i + 1);
  }
  const client = new Pg.Client({ host: kv.host, port: Number(kv.port || 5432), database: kv.dbname, user: kv.user, password: kv.password,
    connectionTimeoutMillis: 5000, query_timeout: 15000 });
  await client.connect();
  try {
    const exists = await client.query("SELECT to_regclass('public.routing_labels') AS t");
    if (!exists.rows[0].t) return [];
    const cols = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'routing_labels' AND column_name = 'bm25_pick'");
    if (!cols.rowCount) return [];
    const r = await client.query(
      `SELECT label, router_pick, bm25_pick, bm25_score FROM routing_labels
        WHERE turn_ts >= $1 AND ($2::timestamptz IS NULL OR turn_ts <= $2)`, [since, until || null]);
    return r.rows.map((x) => ({ ...x, bm25_score: x.bm25_score === null ? null : Number(x.bm25_score) }));
  } finally { await client.end().catch(() => {}); }
}

function collect(bridge, filter, { quietMs = 2000, maxMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const events = new Map();
    let timer = null, subId = null;
    const done = () => { clearTimeout(hard); clearTimeout(timer); try { if (subId) bridge.unsubscribe(subId); } catch { /* closing */ } resolve([...events.values()]); };
    const bump = () => { clearTimeout(timer); timer = setTimeout(done, quietMs); };
    const hard = setTimeout(done, maxMs);
    subId = bridge.subscribe(filter, (ev) => { events.set(ev.id, ev); bump(); });
    bump();
  });
}

/** What a write plan says, minus any key material: safe to print and to persist. */
function planSummary(plan) {
  if (!plan || typeof plan.type !== 'string') return { type: 'unknown' };
  return plan.type === 'refuse' ? { type: 'refuse', reason: String(plan.reason || '') } : { type: plan.type };
}

/** Resolve the signer and the zone write plan for the digest section. Sends nothing. */
function resolvePost() {
  const zoneKeys = require(path.join(CHECKOUT, 'management-api/lib/zone-keys.js'));
  const { signerFromHex } = require(path.join(CHECKOUT, 'management-api/lib/junkiejarvis-agent.js'));
  const signer = signerFromHex(zoneKeys.readSetting('JUNKIEJARVIS_PRIVKEY_HEX') || '');
  if (!signer) return { zoneKeys, signer: null, plan: null, zone: null, gate: null };
  const zones = zoneKeys.loadZones();
  const zone = zoneKeys.sectionToZone(SECTION, zones);
  const gate = zoneKeys.gateEnabled();
  const plan = zoneKeys.writePlan(zone, { gate, zones, store: new zoneKeys.ZoneKeyStore({ owner: signer.pubkey }) });
  return { zoneKeys, signer, plan, zone, gate };
}

/** The no-post check: would the forum post go out, and how? Records the plan type only. */
function checkPost() {
  const r = resolvePost();
  return {
    at: new Date().toISOString(), relay: RELAY_URL, channel: CHANNEL, section: SECTION,
    signer: r.signer ? 'present' : 'absent (JUNKIEJARVIS_PRIVKEY_HEX unavailable)',
    zone: r.zone, gate: r.gate, plan: r.plan ? planSummary(r.plan) : null,
  };
}

/** One kind-42 in the dream digest's channel, signed by JunkieJarvis; encrypted when the zone is. */
async function publish(content, markSent = () => {}) {
  const { NostrBridge } = require(path.join(CHECKOUT, 'mcp/servers/nostr-bridge.js'));
  const { zoneKeys, signer, plan } = resolvePost();
  if (!signer) throw new Error('JUNKIEJARVIS_PRIVKEY_HEX unavailable');
  if (plan.type === 'refuse') throw new Error(`${plan.reason}; not posted in plaintext`);
  const plain = { kind: 42, content, created_at: Math.floor(Date.now() / 1000),
    tags: [['e', CHANNEL, RELAY_URL, 'root'], ['section', SECTION], ['t', 'exp-b8']] };
  const bridge = new NostrBridge({ relays: [RELAY_URL] });
  if (typeof bridge.setAuthSigner === 'function') bridge.setAuthSigner(signer);
  await bridge.connect();
  try {
    const event = zoneKeys.applyWritePlan(plain, plan, signer.skBytes);
    markSent();
    const signed = await bridge.publish(event, signer);
    await new Promise((r) => setTimeout(r, 2500));
    const found = await collect(bridge, { ids: [signed.id] });
    if (!found.some((e) => e.id === signed.id)) throw new Error(`published ${signed.id.slice(0, 12)}… but not readable back (not republished: at-most-once)`);
    logLine(`forum post published+verified ${signed.id.slice(0, 12)}…`);
    return signed.id;
  } finally { try { await bridge.disconnect(); } catch { /* closing */ } }
}

/** Branch from origin/main in a private worktree; flip the gate, record the verdict, open a PR. */
async function openPr({ analysis, meta, reportMd }) {
  const git = tool('git'), gh = tool('gh');
  // git's credential helper is `!gh auth git-credential`, resolved by name: supercronic's
  // PATH has neither tool, so put the resolved directories first for every subprocess.
  process.env.PATH = [path.dirname(gh), path.dirname(git), process.env.PATH || ''].join(':');
  const existing = sh(gh, ['pr', 'list', '--head', BRANCH, '--state', 'all', '--json', 'url', '-q', '.[0].url'], { cwd: CHECKOUT });
  if (existing) return existing;
  const wt = path.join(STATE_DIR, 'worktree');
  sh(git, ['-C', CHECKOUT, 'fetch', '-q', 'origin', 'main']);
  try { sh(git, ['-C', CHECKOUT, 'worktree', 'remove', '--force', wt]); } catch { /* not there */ }
  const remote = sh(git, ['-C', CHECKOUT, 'ls-remote', '--heads', 'origin', BRANCH]);
  if (!remote) {
    sh(git, ['-C', CHECKOUT, 'worktree', 'add', '-q', '-B', BRANCH, wt, 'origin/main']);
    try {
      const toml = path.join(wt, 'agentbox.toml');
      fs.writeFileSync(toml, flipManifestOff(fs.readFileSync(toml, 'utf8')));
      const adr = path.join(wt, 'docs/adr/ADR-2110-routing-teacher-labels-from-main-model-use.md');
      fs.writeFileSync(adr, applyAdrVerdict(fs.readFileSync(adr, 'utf8'), analysis, meta));
      fs.writeFileSync(path.join(wt, 'docs/experiments/EXP-B8-report.md'), reportMd);
      sh(process.execPath, [path.join(wt, 'scripts/adr-index-gen.js'), path.join(wt, 'docs/adr')], { cwd: wt });
      sh(git, ['-C', wt, 'add', 'agentbox.toml', 'docs/adr', 'docs/experiments/EXP-B8-report.md']);
      sh(git, ['-C', wt, 'commit', '-q', '-m',
        `chore(routing): EXP-B8 stopped (${meta.reason}) — ${analysis.verdict}; label_log off\n\n` +
        `Pre-registered stop of the ADR-2110 label log (owner decision 2026-10-02 R5b).\n` +
        `n = ${analysis.n}, b = ${analysis.b}, c = ${analysis.c}, exact McNemar p = ${fmtP(analysis.p)}.\n\n` +
        'Co-Authored-By: jjohare <github@thedreamlab.uk>']);
      sh(git, ['-C', wt, 'push', '-q', '-u', 'origin', BRANCH]);
    } finally {
      try { sh(git, ['-C', CHECKOUT, 'worktree', 'remove', '--force', wt]); } catch { /* best effort */ }
    }
  }
  const body = `${reportMd}\n---\nOpened automatically by the EXP-B8 tick when its stopping rule fired. **Do not auto-merge**: the owner reviews the verdict.\n\n🤖 Generated by Claude Code\n`;
  return sh(gh, ['pr', 'create', '--base', 'main', '--head', BRANCH,
    '--title', `EXP-B8 verdict: ${analysis.verdict} — switch the routing label log off`, '--body', body], { cwd: CHECKOUT });
}

function realDeps(over = {}) {
  const tomlPath = path.join(CHECKOUT, 'agentbox.toml');
  const tomlVal = (key, dflt) => {
    const text = fs.readFileSync(tomlPath, 'utf8');
    let inSec = false;
    for (const line of text.split('\n')) {
      if (/^\s*\[/.test(line)) { inSec = /^\s*\[skills\.routing\]\s*$/.test(line); continue; }
      const m = inSec && line.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"#\\s]+)`));
      if (m) return m[1];
    }
    return dflt;
  };
  return {
    stateDir: STATE_DIR,
    now: () => (process.env.EXP_B8_NOW ? new Date(process.env.EXP_B8_NOW) : new Date()),
    manifestOn: () => manifestLabelLog(fs.readFileSync(tomlPath, 'utf8')),
    registration: {
      checkoutHooks: path.join(CHECKOUT, 'config/hooks'),
      bakedHooks: '/opt/agentbox/config/hooks',
      embedUrl: tomlVal('label_embeddings_url', 'http://192.168.2.132:9997/v1/embeddings'),
      minChars: Number(tomlVal('min_prompt_chars', '24')) || 24,
    },
    readSettings: () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } },
    writeSettings: (s) => {
      const tmp = `${SETTINGS}.exp-b8.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
      fs.renameSync(tmp, SETTINGS);
      logLine('settings.json hooks updated');
    },
    countRows: async (since) => countAnalysable(await fetchRows(since, null)),
    fetchRows,
    publish,
    openPr,
    log: logLine,
    ...over,
  };
}

async function main(argv) {
  if (argv.includes('--status')) {
    const st = loadState(STATE_DIR);
    let n = null;
    try { n = st.started_at ? countAnalysable(await fetchRows(st.started_at, st.stop ? st.stop.at : null)) : 0; } catch (e) { n = `unavailable (${e.message})`; }
    console.log(JSON.stringify({ protocol: { targetN: PROTOCOL.targetN, hardStop: PROTOCOL.hardStop }, analysable_now: n, state: st }, null, 2));
    return;
  }
  if (argv.includes('--check-post')) {
    const st = loadState(STATE_DIR);
    st.post_check = checkPost();
    saveState(STATE_DIR, st);
    console.log(JSON.stringify(st.post_check, null, 2));
    return;
  }
  if (argv.includes('--activate')) {
    const tools = {};
    for (const name of ['git', 'gh']) { try { tools[name] = tool(name); } catch { /* recorded only when found */ } }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'tools.json'), JSON.stringify(tools, null, 2));
    logLine(`activate: recorded tools ${JSON.stringify(tools)}`);
  }
  const r = await tick(realDeps({ dryRun: argv.includes('--dry-run') }));
  if (r.phase === 'dry-run') { console.log(r.report); console.log('--- forum post ---'); console.log(r.post); }
  logLine(`tick: ${JSON.stringify({ phase: r.phase, n: r.n, verdict: r.verdict, pr: r.pr })}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { logLine(`tick failed (fail-open, retried next tick): ${e && e.message}`); }).finally(() => { process.exitCode = 0; });
}

module.exports = {
  PROTOCOL, ACTIONS, requiredSampleSize, bare, isAnalysable, countAnalysable, stoppingRule,
  mcnemarExact, copyCeiling, analyse, verdictOf, composeReport, composeForumPost,
  manifestLabelLog, flipManifestOff, applyAdrVerdict, applyRegistration, postOnce, planSummary, tick,
};
