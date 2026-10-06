#!/usr/bin/env node
'use strict';
/**
 * WHAT THIS IS
 *   The scheduled, cost-controlled review of diagrams-as-code corpora. Four subcommands run
 *   against every repo listed in [diagram_review].repos that has a docs/diagrams corpus:
 *
 *     triage         GLM reads each topic whose sources changed and says whether it is now wrong;
 *                    writes docs/review/<date>-triage.md, the list of topics to re-author.
 *     review-glm     the critical and premortem lenses with GLM as reviewer; skipped when the
 *                    pack is byte-identical to the last GLM review.
 *     audit-gemini   the external Gemini review, only past a four-part gate (interval, changed
 *                    topics or a high-severity GLM finding, and the monthly budget).
 *     status         what the ledger says, including month-to-date Gemini spend.
 *
 *     node review-cadence.cjs <subcommand> [--manifest <agentbox.toml>] [--repo <dir>]...
 *          [--dry-run] [--now <ISO time>]
 *
 *   Zero dependencies, Node >= 18.
 *
 * WHY IT IS THIS WAY
 *   Gemini with high thinking on a whole corpus is the expensive step, so it is the rare one.
 *   GLM is cheap and runs often, and its job is to decide when the expensive step is worth it.
 *   Every run, including every refusal, appends one line to docs/diagrams/review-ledger.jsonl,
 *   so spend, intervals and "what did we already review" are all read from one append-only
 *   file and never from memory. Decisions are pure functions (decideGemini, triageCandidates,
 *   monthToDateUsd) so the policy is tested without a network. A failed model call never
 *   blocks the cadence: triage treats an unanswered topic as "yes, re-author" (unsure means
 *   yes), and a failed Gemini call is recorded at its estimated cost, because a timed-out
 *   generateContent may already have been billed.
 *   Nothing here edits a topic or commits anything. Findings are unverified hypotheses for
 *   build-with-quality. The keys are read from the environment and never printed or stored.
 *
 * WHAT IT MEANS FOR THE CLIENT
 *   The diagrams stay honest without anyone remembering to ask. A cheap model watches every
 *   code change that touches a documented topic, a weekly outside review catches what the
 *   authors cannot see, and the expensive outside audit runs only when there is a reason and
 *   money left under a cap the operator set.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ER = require('./external-review.cjs');

// ── Pricing (USD per million tokens). Gemini 3.8 Flash list price as of 2026-10-06, taken from
//    the operator's brief; check ai.google.dev/pricing before trusting the budget to the cent.
//    Output includes thinking tokens. GLM is billed under the Z.AI plan, not per token, so it
//    costs 0 here and never counts against the Gemini cap.
const GEMINI_USD_PER_M = { input: 0.75, cached: 0.075, output: 3.75 };
const GLM_USD_PER_M = { input: 0, output: 0 };
// A lens reply plus its thinking. Used only for the pre-flight estimate; the ledger records
// the usage the API reports.
const GEMINI_ASSUMED_OUTPUT_TOKENS_PER_LENS = 30000;
const GEMINI_LENSES = 2;

const LEDGER_REL = path.join('docs', 'diagrams', 'review-ledger.jsonl');
const CORPUS_REL = path.join('docs', 'diagrams');
const REVIEW_REL = path.join('docs', 'review');
const GLM_DEFAULT_MODEL = 'glm-5.3';
// GLM has a smaller window than Gemini; a corpus past this is reviewed one area at a time.
const GLM_PACK_TOKEN_BUDGET = 150000;
const GLM_MAX_OUTPUT_TOKENS = 32000;
const GLM_TRIAGE_MAX_OUTPUT_TOKENS = 1500;
const MAX_DIFF_BYTES = 40000;
const MAX_TOPIC_BYTES = 60000;
const MAX_TRIAGE_TOPICS = 60;
const DEFAULTS = {
  enabled: false, repos: [], glm_triage_cron: '17 5 * * 1-6', glm_review_cron: '47 5 * * 0',
  gemini_min_interval_days: 7, gemini_min_changed_topics: 3, gemini_monthly_usd: 10, weekly_window: true,
};
const DAY_MS = 86400000;

// ── Manifest ────────────────────────────────────────────────────────────────────────────────

/** Strip a trailing `# comment` that is not inside a string. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  if (/^[+-]?\d*\.\d+$/.test(t)) return Number(t);
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

function parseArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = [];
  let cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === '\\' && q === '"') cur += inner[++i] ?? ''; else if (c === q) q = null; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { if (cur.trim()) items.push(parseScalar(cur)); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) items.push(parseScalar(cur));
  return items;
}

/** Read one `[section]` table out of a TOML document: strings, booleans, numbers and (possibly
 *  multi-line) arrays of them. That is all [diagram_review] and [consultants.zai] use; the rest
 *  of the manifest is read by `agentbox-manifest`. */
function readSection(text, name) {
  const out = {};
  let inSection = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    const head = line.match(/^\[([^\[\]]+)\]$/);
    if (head) { inSection = head[1].trim() === name; continue; }
    if (!inSection) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('[')) {
      while (!value.includes(']') && i + 1 < lines.length) value += ' ' + stripComment(lines[++i]).trim();
      out[kv[1]] = parseArray(value);
    } else out[kv[1]] = parseScalar(value);
  }
  return out;
}

function loadConfig(manifestPath) {
  let text = '';
  try { text = fs.readFileSync(manifestPath, 'utf8'); } catch { /* fail-open: defaults, disabled */ }
  const cfg = { ...DEFAULTS, ...readSection(text, 'diagram_review') };
  cfg.repos = (Array.isArray(cfg.repos) ? cfg.repos : []).filter((r) => typeof r === 'string' && r);
  for (const k of ['gemini_min_interval_days', 'gemini_min_changed_topics', 'gemini_monthly_usd']) {
    if (typeof cfg[k] !== 'number' || !(cfg[k] >= 0)) cfg[k] = DEFAULTS[k];
  }
  cfg.glm_model = process.env.DIAGRAM_REVIEW_GLM_MODEL || readSection(text, 'consultants.zai').model || GLM_DEFAULT_MODEL;
  return cfg;
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────

function ledgerPath(repo) { return path.join(repo, LEDGER_REL); }

function readLedger(repo) {
  let text = '';
  try { text = fs.readFileSync(ledgerPath(repo), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return out;
}

/** Append one run to the ledger. Append-only: the file is never rewritten. */
function appendLedger(repo, entry) {
  const full = {
    ts: new Date().toISOString(), kind: null, reviewer: null, commit: null, pack_sha256: null,
    tokens: null, est_usd: 0, findings: null, high_severity: 0, changed_topics: null, skipped: null,
    ...entry,
  };
  fs.mkdirSync(path.dirname(ledgerPath(repo)), { recursive: true });
  fs.appendFileSync(ledgerPath(repo), `${JSON.stringify(full)}\n`);
  return full;
}

const isRun = (e, kind, reviewer) => e.kind === kind && e.reviewer === reviewer && !e.skipped && !e.error;
const lastOf = (ledger, kind, reviewer) => [...ledger].reverse().find((e) => isRun(e, kind, reviewer)) ?? null;

/** Gemini spend recorded in the UTC month of `now`, across the given ledgers. Failed calls count
 *  at their estimate, because a timed-out generation may have been billed. */
function monthToDateUsd(ledgers, now) {
  const month = new Date(now).toISOString().slice(0, 7);
  let total = 0;
  for (const ledger of ledgers) {
    for (const e of ledger) {
      if (e.reviewer === 'gemini' && typeof e.est_usd === 'number' && String(e.ts).slice(0, 7) === month) total += e.est_usd;
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

// ── Git and topics ──────────────────────────────────────────────────────────────────────────

function git(repo, args, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer });
}

function headCommit(repo) {
  try { return git(repo, ['rev-parse', 'HEAD']).trim(); } catch { return null; }
}

function commitExists(repo, sha) {
  if (!sha) return false;
  try { git(repo, ['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; }
}

function changedFiles(repo, since) {
  return new Set(git(repo, ['diff', '--name-only', since, 'HEAD']).split('\n').map((s) => s.trim()).filter(Boolean));
}

/** Frontmatter `sources:` as repo-relative paths. Reads the inline `[a, b]` and the block `- a`
 *  forms. A `../` source belongs to another repository and is not attributed here. */
function parseSources(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const fm = m[1].split('\n');
  const at = fm.findIndex((l) => /^sources\s*:/.test(l));
  if (at < 0) return [];
  const rest = fm[at].replace(/^sources\s*:/, '').trim();
  let items;
  if (rest.startsWith('[')) items = parseArray(stripComment(rest));
  else {
    items = [];
    for (let i = at + 1; i < fm.length && /^\s+-\s+/.test(fm[i]); i++) items.push(parseScalar(stripComment(fm[i].replace(/^\s+-\s+/, ''))));
  }
  return items.filter((s) => typeof s === 'string' && s && !s.startsWith('../'));
}

/** Every topic with its sources: [{ rel, sources }]. */
function loadTopics(repo) {
  const corpus = path.join(repo, CORPUS_REL);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(corpus, 'diagrams.config.json'), 'utf8')); } catch { /* optional */ }
  return ER.listTopics(corpus, { skipDirs: cfg.skipDirs }).map((rel) => ({
    rel, sources: parseSources(fs.readFileSync(path.join(corpus, rel), 'utf8')),
  }));
}

/** Topics with at least one source in `changed`, a Set of repo-relative paths: the union over
 *  the window, computed per file. */
function triageCandidates(topics, changed) {
  return topics
    .map((t) => ({ ...t, changedSources: t.sources.filter((s) => changed.has(s)) }))
    .filter((t) => t.changedSources.length > 0);
}

/** `sealmap stale --since <commit>` when the binary exists. Returns a Set of topic paths it
 *  named, or null when it is absent, fails or names nothing we recognise, so the caller falls
 *  back to the per-file git computation. */
function sealmapStale(repo, since, topics) {
  let out;
  try {
    out = execFileSync('sealmap', ['stale', '--since', since], {
      cwd: path.join(repo, CORPUS_REL), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000,
    });
  } catch { return null; }
  const known = new Map(topics.map((t) => [t.rel, t.rel]));
  const id = (x) => (typeof x === 'string' ? x : x && (x.topic ?? x.path ?? x.file ?? x.id));
  let names = [];
  try {
    const j = JSON.parse(out);
    names = (Array.isArray(j) ? j : j.stale ?? j.topics ?? []).map(id);
  } catch { names = out.split('\n').map((l) => l.trim().split(/\s+/)[0]); }
  const hit = new Set();
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const clean = n.replace(/^\.?\//, '').replace(/^docs\/diagrams\//, '');
    if (known.has(clean)) hit.add(clean);
  }
  return hit.size > 0 ? hit : null;
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/** The pack exactly as external-review.cjs builds it, so the hash is comparable across both. */
function corpusPack(repo) {
  const corpus = path.join(repo, CORPUS_REL);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(corpus, 'diagrams.config.json'), 'utf8')); } catch { /* optional */ }
  const files = ER.listTopics(corpus, { skipDirs: cfg.skipDirs });
  const pack = ER.buildPack(corpus, files);
  return { files, pack, sha: sha256(pack) };
}

// ── Decisions ───────────────────────────────────────────────────────────────────────────────

/** A finding is high severity when the reviewer said so, or, with no severity field, when it
 *  was reported with high confidence and the authors had not marked it themselves. */
function isHighSeverity(f) {
  if (f.severity) return /^\W*high\b/i.test(f.severity);
  return /^\W*high\b/i.test(f.confidence ?? '') && /^\W*no\b/i.test(f.marked_by_authors ?? '');
}

/**
 * The Gemini gate. Every condition must hold; the first that fails is the logged reason.
 *   - at least `gemini_min_interval_days` since the last audit
 *   - at least `gemini_min_changed_topics` topics changed since the last audit, OR the last GLM
 *     review recorded a high-severity finding
 *   - month-to-date spend plus this run's estimate within `gemini_monthly_usd`
 * @returns {{run: boolean, reason: string}}
 */
function decideGemini({ cfg, lastAudit, changedTopics, glmHighSeverity, mtdUsd, estUsd, now }) {
  if (lastAudit) {
    const days = (new Date(now) - new Date(lastAudit.ts)) / DAY_MS;
    if (days < cfg.gemini_min_interval_days) {
      return { run: false, reason: `interval: ${days.toFixed(1)} d since the last audit, need ${cfg.gemini_min_interval_days}` };
    }
  }
  if (changedTopics < cfg.gemini_min_changed_topics && !(glmHighSeverity > 0)) {
    return { run: false, reason: `no cause: ${changedTopics} topics changed (need ${cfg.gemini_min_changed_topics}) and no high-severity GLM finding` };
  }
  if (mtdUsd + estUsd > cfg.gemini_monthly_usd) {
    return { run: false, reason: `budget: $${mtdUsd.toFixed(2)} spent this month + $${estUsd.toFixed(2)} estimated exceeds $${cfg.gemini_monthly_usd}` };
  }
  const cause = glmHighSeverity > 0 ? `${glmHighSeverity} high-severity GLM finding(s)` : `${changedTopics} changed topics`;
  return { run: true, reason: `gate open: ${cause}, $${(mtdUsd + estUsd).toFixed(2)} of $${cfg.gemini_monthly_usd} after this run` };
}

/** Pre-flight Gemini cost from a countTokens figure: the pack once at the input rate, once more
 *  per further lens at the cached rate, plus the assumed reply for each lens. */
function estimateGeminiUsd(packTokens, lenses = GEMINI_LENSES) {
  const m = 1e6;
  return (packTokens * GEMINI_USD_PER_M.input + (lenses - 1) * packTokens * GEMINI_USD_PER_M.cached
    + lenses * GEMINI_ASSUMED_OUTPUT_TOKENS_PER_LENS * GEMINI_USD_PER_M.output) / m;
}

/** What Gemini actually billed, from external-review's per-lens usage. */
function actualGeminiUsd(lenses) {
  let usd = 0;
  for (const l of lenses ?? []) {
    const cached = l.cached_tokens ?? 0;
    usd += (((l.prompt_tokens ?? 0) - cached) * GEMINI_USD_PER_M.input + cached * GEMINI_USD_PER_M.cached
      + ((l.thinking_tokens ?? 0) + (l.output_tokens ?? 0)) * GEMINI_USD_PER_M.output) / 1e6;
  }
  return Math.round(usd * 1e6) / 1e6;
}

/** True when the latest GLM review pack equals `sha` (nothing to re-review). */
function packUnchanged(ledger, sha) {
  const last = lastOf(ledger, 'review', 'glm');
  return Boolean(last && last.pack_sha256 === sha);
}

// ── GLM transport ───────────────────────────────────────────────────────────────────────────

/** Z.AI settings by the shared clean-env conventions (mcp/consultants/shared/zai-env.js): the key
 *  is ZAI_ANTHROPIC_API_KEY, then ZAI_API_KEY, and nothing else in the caller's environment is
 *  used. Falls back to the same rule inline when the shared module is not beside this skill. */
function zaiSettings(env = process.env) {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'mcp', 'consultants', 'shared', 'zai-env.js'),
    '/opt/agentbox/mcp/consultants/shared/zai-env.js',
  ];
  for (const c of candidates) {
    try {
      const { zaiChildEnv } = require(c);
      const e = zaiChildEnv(env);
      return { url: e.ZAI_URL, key: e.ZAI_API_KEY };
    } catch { /* try the next */ }
  }
  return { url: env.ZAI_URL || 'https://api.z.ai/api/paas/v4', key: env.ZAI_ANTHROPIC_API_KEY || env.ZAI_API_KEY || '' };
}

/** One Anthropic Messages call to Z.AI. The key goes in a header only; an error shows the
 *  server's reason and never the request. Returns { text, input_tokens, output_tokens }. */
async function glm({ model, system, user, maxTokens, thinkingBudget, timeoutMs, env = process.env, post = ER.postJson }) {
  const { url, key } = zaiSettings(env);
  if (!key) throw new Error('set ZAI_ANTHROPIC_API_KEY (or ZAI_API_KEY) in the environment');
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] };
  if (system) body.system = system;
  if (thinkingBudget > 0) body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  const res = await post(`${url.replace(/\/+$/, '')}/v1/messages`, {
    authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01',
  }, body, timeoutMs ?? ER.timeoutFromEnv(env));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`glm ${res.status}: ${JSON.stringify(res.json.error ?? res.json).slice(0, 300)}`);
  }
  const text = (res.json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new Error(`glm: empty reply (stop_reason ${res.json.stop_reason ?? 'none'})`);
  return { text, input_tokens: res.json.usage?.input_tokens ?? 0, output_tokens: res.json.usage?.output_tokens ?? 0 };
}

const TRIAGE_SYSTEM = 'You check whether a documentation topic still tells the truth about the code it cites. '
  + 'Answer on the first line with exactly "VERDICT: YES" (the topic is now wrong or incomplete and must be re-authored) '
  + 'or "VERDICT: NO" (the topic is still accurate). If you are not sure, answer YES. '
  + 'On the second line give "REASON:" and one sentence naming the claim the change affects.';

/** Read a triage reply. Anything but an unambiguous NO is a YES. */
function parseVerdict(text) {
  const m = text.match(/VERDICT:\s*(YES|NO)\b/i);
  return !(m && m[1].toUpperCase() === 'NO');
}

function clip(s, max) {
  return Buffer.byteLength(s) <= max ? s : `${Buffer.from(s).subarray(0, max).toString('utf8')}\n[... truncated at ${max} bytes]`;
}

function triagePrompt(repo, topic, since) {
  const text = clip(fs.readFileSync(path.join(repo, CORPUS_REL, topic.rel), 'utf8'), MAX_TOPIC_BYTES);
  let diff = '';
  try { diff = git(repo, ['diff', '--unified=2', since, 'HEAD', '--', ...topic.changedSources]); } catch { diff = '(diff unavailable)'; }
  return `Topic file ${topic.rel}:\n\n${text}\n\n=== Changes to the sources it cites since ${since.slice(0, 12)} ===\n`
    + `Changed files: ${topic.changedSources.join(', ')}\n\n${clip(diff, MAX_DIFF_BYTES)}\n\nIs this topic now wrong?`;
}

// ── Output files ────────────────────────────────────────────────────────────────────────────

function uniquePath(dir, stem, ext) {
  fs.mkdirSync(dir, { recursive: true });
  let n = 1, p = path.join(dir, `${stem}${ext}`);
  while (fs.existsSync(p)) p = path.join(dir, `${stem}-${++n}${ext}`);
  return p;
}

const utcDate = (now) => new Date(now).toISOString().slice(0, 10);
const rel = (repo, p) => path.relative(repo, p).split(path.sep).join('/');

// ── Subcommands ─────────────────────────────────────────────────────────────────────────────

const REVIEW_EXTRA = '\n\nAdd one more line to every finding, after Confidence: "- Severity: high, medium or low", '
  + 'where high means it would cause a security, custody, data-loss or correctness incident in production.';

async function triage(repo, ctx) {
  const { now, cfg, dryRun } = ctx;
  const head = headCommit(repo);
  if (!head) return { skipped: 'not a git repository' };
  const ledger = readLedger(repo);
  const last = [...ledger].reverse().find((e) => e.kind === 'triage' && e.commit && !e.error);
  if (!last || !commitExists(repo, last.commit)) {
    if (!dryRun) appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'triage', reviewer: 'glm', commit: head, skipped: last ? `baseline: recorded commit ${last.commit.slice(0, 12)} is not in this repository` : 'baseline: first triage run records the commit and spends nothing' });
    return { skipped: 'baseline recorded' };
  }
  const topics = loadTopics(repo);
  let candidates;
  const stale = sealmapStale(repo, last.commit, topics);
  if (stale) candidates = triageCandidates(topics, changedFiles(repo, last.commit)).filter((t) => stale.has(t.rel));
  else candidates = triageCandidates(topics, changedFiles(repo, last.commit));
  if (candidates.length === 0) {
    if (!dryRun) appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'triage', reviewer: 'glm', commit: head, changed_topics: 0, skipped: 'no topic sources changed' });
    return { skipped: 'no topic sources changed' };
  }
  if (dryRun) return { candidates: candidates.map((t) => t.rel) };

  const results = [];
  let inTok = 0, outTok = 0;
  for (const [i, t] of candidates.entries()) {
    if (i >= MAX_TRIAGE_TOPICS) { results.push({ topic: t.rel, yes: true, reason: 'not checked: per-run cap reached, so it is listed' }); continue; }
    try {
      const r = await glm({ model: cfg.glm_model, system: TRIAGE_SYSTEM, user: triagePrompt(repo, t, last.commit), maxTokens: GLM_TRIAGE_MAX_OUTPUT_TOKENS, env: ctx.env, post: ctx.post });
      inTok += r.input_tokens; outTok += r.output_tokens;
      results.push({ topic: t.rel, yes: parseVerdict(r.text), reason: (r.text.match(/REASON:\s*(.+)/i) || [])[1]?.trim() ?? '' });
    } catch (err) {
      results.push({ topic: t.rel, yes: true, reason: `GLM call failed (${err.message.slice(0, 120)}); unsure means yes` });
    }
  }
  const flagged = results.filter((r) => r.yes);
  const out = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-triage`, '.md');
  const md = [
    `# Triage ${utcDate(now)}: ${flagged.length} of ${results.length} topics to re-author`, '',
    `Window: ${last.commit.slice(0, 12)}..${head.slice(0, 12)}. Reviewer: GLM (${cfg.glm_model}) via ${stale ? 'sealmap stale' : 'per-file git changes'}. `
    + 'Topics are never edited here; re-author each with diagrams-as-code and re-stamp.', '',
    '## Re-author', '', ...(flagged.length ? flagged.map((r) => `- \`${r.topic}\`: ${r.reason || 'no reason given'}`) : ['(none)']), '',
    '## Still accurate', '', ...(results.filter((r) => !r.yes).map((r) => `- \`${r.topic}\`: ${r.reason}`)), '',
  ].join('\n');
  fs.writeFileSync(out, md);
  appendLedger(repo, {
    ts: new Date(now).toISOString(), kind: 'triage', reviewer: 'glm', commit: head, tokens: { input: inTok, output: outTok },
    est_usd: (inTok * GLM_USD_PER_M.input + outTok * GLM_USD_PER_M.output) / 1e6, findings: rel(repo, out),
    changed_topics: results.length, flagged: flagged.length,
  });
  return { findings: rel(repo, out), flagged: flagged.length, checked: results.length };
}

/** Pack shards for GLM: the whole corpus when it fits, otherwise one pack per top-level area. */
function glmShards(repo) {
  const { files, pack, sha } = corpusPack(repo);
  if (pack.length / 3.3 <= GLM_PACK_TOKEN_BUDGET) return { sha, shards: [{ name: 'all', pack }] };
  const areas = [...new Set(files.map((f) => f.split('/')[0]))];
  const corpus = path.join(repo, CORPUS_REL);
  return { sha, shards: areas.map((a) => ({ name: a, pack: ER.buildPack(corpus, files.filter((f) => f.split('/')[0] === a)) })) };
}

async function reviewGlm(repo, ctx) {
  const { now, cfg, dryRun } = ctx;
  const ledger = readLedger(repo);
  const head = headCommit(repo);
  const { sha, shards } = glmShards(repo);
  if (packUnchanged(ledger, sha)) {
    if (!dryRun) appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'review', reviewer: 'glm', commit: head, pack_sha256: sha, skipped: 'pack unchanged since the last GLM review' });
    return { skipped: 'pack unchanged' };
  }
  if (dryRun) return { shards: shards.map((s) => s.name), pack_sha256: sha };

  const lenses = ['critical', 'premortem'].map((name) => ({ name, text: ER.loadLens(name, 15) + REVIEW_EXTRA }));
  const findings = [];
  const docs = [];
  let inTok = 0, outTok = 0;
  try {
    for (const shard of shards) {
      for (const lens of lenses) {
        const r = await glm({
          model: cfg.glm_model, user: `${shard.pack}\n\n${lens.text}`, maxTokens: GLM_MAX_OUTPUT_TOKENS,
          thinkingBudget: 8000, env: ctx.env, post: ctx.post,
        });
        inTok += r.input_tokens; outTok += r.output_tokens;
        const label = shards.length > 1 ? `${lens.name} / ${shard.name}` : lens.name;
        docs.push(`## ${label}\n\n${r.text.trim()}\n`);
        for (const f of ER.parseFindings(r.text, lens.name)) findings.push({ ...f, id: shards.length > 1 ? `${shard.name}:${f.id}` : f.id, high: isHighSeverity(f) });
      }
    }
  } catch (err) {
    appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'review', reviewer: 'glm', commit: head, pack_sha256: sha, tokens: { input: inTok, output: outTok }, error: err.message.slice(0, 300), skipped: `error: ${err.message.slice(0, 160)}` });
    throw err;
  }
  const base = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-glm`, '.md');
  const high = findings.filter((f) => f.high).length;
  fs.writeFileSync(base, [`# GLM review ${utcDate(now)} (${cfg.glm_model}): ${findings.length} findings, ${high} high severity`, '',
    `Revision ${head ? head.slice(0, 12) : 'unknown'}, pack ${sha.slice(0, 12)}. Unverified hypotheses: reproduce each with a failing test or check (build-with-quality) before acting.`, '', ...docs].join('\n'));
  fs.writeFileSync(base.replace(/\.md$/, '.json'), `${JSON.stringify(findings, null, 2)}\n`);
  appendLedger(repo, {
    ts: new Date(now).toISOString(), kind: 'review', reviewer: 'glm', commit: head, pack_sha256: sha, tokens: { input: inTok, output: outTok },
    est_usd: (inTok * GLM_USD_PER_M.input + outTok * GLM_USD_PER_M.output) / 1e6, findings: rel(repo, base), high_severity: high,
  });
  return { findings: rel(repo, base), count: findings.length, high };
}

/** Topics changed since `commit` (all topics when there is no earlier audit). */
function changedTopicCount(repo, commit) {
  const topics = loadTopics(repo);
  if (!commit || !commitExists(repo, commit)) return topics.length;
  return triageCandidates(topics, changedFiles(repo, commit)).length;
}

async function auditGemini(repo, ctx) {
  const { now, cfg, dryRun, mtd } = ctx;
  const ledger = readLedger(repo);
  const head = headCommit(repo);
  const { sha, pack } = corpusPack(repo);
  const lastAudit = lastOf(ledger, 'audit', 'gemini');
  const lastGlm = lastOf(ledger, 'review', 'glm');
  const changed = changedTopicCount(repo, lastAudit?.commit);
  let packTokens = Math.round(pack.length / 3.3);
  let estimated = false;
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;

  const skip = (reason, extra = {}) => {
    if (!dryRun) appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'audit', reviewer: 'gemini', commit: head, pack_sha256: sha, changed_topics: changed, skipped: reason, ...extra });
    return { skipped: reason };
  };
  // The cheap checks first, so a refused run never needs a key or a network call.
  const first = decideGemini({ cfg, lastAudit, changedTopics: changed, glmHighSeverity: lastGlm?.high_severity ?? 0, mtdUsd: mtd, estUsd: 0, now });
  if (!first.run) return skip(first.reason);
  if (!key && !dryRun) return skip('no GEMINI_API_KEY in the environment');
  if (key && !dryRun) {
    try {
      const { totalTokens } = await ER.gemini('countTokens', ctx.model, key, { contents: [{ role: 'user', parts: [{ text: pack }, { text: ER.loadLens('critical', 15) }] }] });
      packTokens = totalTokens;
    } catch (err) { return skip(`countTokens failed: ${err.message.slice(0, 160)}`); }
  } else estimated = true;
  const estUsd = estimateGeminiUsd(packTokens);
  const decision = decideGemini({ cfg, lastAudit, changedTopics: changed, glmHighSeverity: lastGlm?.high_severity ?? 0, mtdUsd: mtd, estUsd, now });
  if (!decision.run) return skip(decision.reason, { tokens: { input: packTokens }, est_usd: 0 });
  if (dryRun) return { would_run: true, reason: decision.reason, est_usd: estUsd, tokens_estimated: estimated };

  const outDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'diagram-audit-'));
  try {
    await ctx.runExternal(path.join(repo, CORPUS_REL), outDir);
  } catch (err) {
    // A failed generateContent may already have been billed: count the estimate.
    appendLedger(repo, { ts: new Date(now).toISOString(), kind: 'audit', reviewer: 'gemini', commit: head, pack_sha256: sha, tokens: { input: packTokens }, est_usd: estUsd, error: err.message.slice(0, 300), skipped: `error: ${err.message.slice(0, 160)}` });
    throw err;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const findings = JSON.parse(fs.readFileSync(path.join(outDir, 'findings.json'), 'utf8'));
  const base = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-gemini`, '.md');
  const docs = (manifest.lenses ?? []).map((l) => `## ${l.name}\n\n${fs.readFileSync(path.join(outDir, `${l.name}.md`), 'utf8').trim()}\n`);
  fs.writeFileSync(base, [`# Gemini audit ${utcDate(now)} (${manifest.model}): ${findings.length} findings`, '',
    `Revision ${head ? head.slice(0, 12) : 'unknown'}, pack ${sha.slice(0, 12)}. Unverified hypotheses: reproduce each with a failing test or check (build-with-quality) before acting.`, '', ...docs].join('\n'));
  fs.writeFileSync(base.replace(/\.md$/, '.json'), `${JSON.stringify(findings, null, 2)}\n`);
  const usd = actualGeminiUsd(manifest.lenses);
  const sum = (k) => (manifest.lenses ?? []).reduce((a, l) => a + (l[k] ?? 0), 0);
  appendLedger(repo, {
    ts: new Date(now).toISOString(), kind: 'audit', reviewer: 'gemini', commit: head, pack_sha256: sha,
    tokens: { input: sum('prompt_tokens'), cached: sum('cached_tokens'), output: sum('thinking_tokens') + sum('output_tokens') },
    est_usd: usd, findings: rel(repo, base), changed_topics: changed,
  });
  return { findings: rel(repo, base), count: findings.length, usd };
}

function runExternalChild(corpus, outDir) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), corpus, '--out', outDir], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) { throw new Error(String(err.stderr || err.message).trim().split('\n').pop() || 'external-review failed'); }
}

function statusOf(repos, now) {
  const ledgers = repos.map((r) => ({ repo: r, ledger: readLedger(r) }));
  const lines = [];
  for (const { repo, ledger } of ledgers) {
    lines.push(`${repo}: ${ledger.length} ledger lines`);
    for (const [kind, reviewer] of [['triage', 'glm'], ['review', 'glm'], ['audit', 'gemini']]) {
      const ran = lastOf(ledger, kind, reviewer);
      const last = [...ledger].reverse().find((e) => e.kind === kind && e.reviewer === reviewer);
      const skipNote = last && last.skipped && last !== ran ? `; latest skip: ${last.skipped}` : '';
      lines.push(`  ${kind}/${reviewer}: ${ran ? `last run ${ran.ts}${ran.findings ? ` -> ${ran.findings}` : ''}${ran.high_severity ? ` (${ran.high_severity} high severity)` : ''}` : 'never run'}${skipNote}`);
    }
  }
  const mtd = monthToDateUsd(ledgers.map((l) => l.ledger), now);
  lines.push(`Gemini spend ${new Date(now).toISOString().slice(0, 7)}: $${mtd.toFixed(2)}`);
  return { text: lines.join('\n'), mtd };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { cmd: argv[0], repos: [], dryRun: false, manifest: process.env.AGENTBOX_CONFIG || '/etc/agentbox.toml', now: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--manifest') opts.manifest = next();
    else if (a === '--repo') opts.repos.push(path.resolve(next()));
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--now') opts.now = next();
    else if (a === '--window') { /* accepted: the crontab passes it; the gate is the interval */ }
    else throw new Error(`unknown option ${a}`);
  }
  if (!['triage', 'review-glm', 'audit-gemini', 'status'].includes(opts.cmd)) {
    throw new Error('usage: review-cadence.cjs <triage|review-glm|audit-gemini|status> [--manifest f] [--repo dir]... [--dry-run] [--now ISO]');
  }
  if (opts.now && Number.isNaN(Date.parse(opts.now))) throw new Error('--now is an ISO time');
  return opts;
}

async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  const cfg = loadConfig(opts.manifest);
  const now = opts.now ? new Date(opts.now) : new Date();
  const repos = (opts.repos.length ? opts.repos : cfg.repos).filter((r) => {
    if (fs.existsSync(path.join(r, CORPUS_REL))) return true;
    console.log(`review-cadence: ${r} has no ${CORPUS_REL}; skipped`);
    return false;
  });
  if (opts.cmd === 'status') { console.log(statusOf(repos, now).text); return 0; }
  if (!cfg.enabled && opts.repos.length === 0) { console.log('review-cadence: [diagram_review].enabled is false; nothing to do'); return 0; }
  if (repos.length === 0) { console.log('review-cadence: no repos with a docs/diagrams corpus'); return 0; }

  const ctx = {
    now, cfg, dryRun: opts.dryRun, env: process.env, post: deps.post, runExternal: deps.runExternal ?? runExternalChild,
    model: process.env.DIAGRAM_REVIEW_MODEL || 'gemini-3.8-flash',
  };
  const fn = { triage, 'review-glm': reviewGlm, 'audit-gemini': auditGemini }[opts.cmd];
  let failed = 0;
  for (const repo of repos) {
    // Spend is capped across every repo, so each audit sees what the earlier ones just booked.
    ctx.mtd = monthToDateUsd(repos.map(readLedger), now);
    try { console.log(`${opts.cmd} ${repo}: ${JSON.stringify(await fn(repo, ctx))}`); }
    catch (err) { failed++; console.error(`${opts.cmd} ${repo}: ${err.message}`); }
  }
  return failed ? 1 : 0;
}

module.exports = {
  readSection, loadConfig, parseSources, loadTopics, triageCandidates, readLedger, appendLedger, monthToDateUsd, ledgerPath,
  decideGemini, estimateGeminiUsd, actualGeminiUsd, packUnchanged, isHighSeverity, parseVerdict, zaiSettings, glm, corpusPack,
  triage, reviewGlm, auditGemini, statusOf, main, parseArgs, DEFAULTS, GEMINI_USD_PER_M,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`review-cadence: ${err.message}`);
    process.exit(/needs a value|unknown option|usage:|is an ISO/.test(err.message) ? 2 : 1);
  });
}
