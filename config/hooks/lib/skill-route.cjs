'use strict';

/**
 * skill-route.cjs — the one place that knows how to ask the judge which skill
 * should handle a turn (ADR-2091; egress accepted by ADR-2090).
 *
 * Two consumers share it and must not drift apart:
 *   • config/hooks/skill-route.cjs       — the UserPromptSubmit hook (every turn)
 *   • skills/skill-router/scripts/route.mjs — the /route slash command (on demand)
 *
 * What it does: builds the candidate map from every baked skill's frontmatter
 * `description`, composes the ADR-2089 `status` field in at the point of use,
 * and puts ONE Choice question to System One (model Jev) with the user's turn as
 * state. It returns an OUTCOME, never throws: `routed`, `skipped` (with a reason)
 * or `failed` (with a reason). Fail-open is the contract — the always-loaded
 * descriptions and the routing table are the normal path whenever this returns
 * anything but `routed`, not an error branch (ADR-2090).
 *
 * What it deliberately does not do:
 *   • persist the prompt anywhere — the log line carries lengths and picks only;
 *   • retry inside the hook — a slow judge must cost the turn nothing; the CLI
 *     path may ask for retries because a human is waiting on purpose;
 *   • treat confidence as a safety net — a wrong pick was measured at 0.94
 *     (ADR-2089), so the number is reported, never used to gate.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_API = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MIN_CHARS = 24;
const DEFAULT_SKILLS_DIR = '/opt/agentbox/skills';
/** Jev's shared state+questions budget is ~32k tokens; the fleet takes ~16k. */
const PROMPT_HEAD_CHARS = 9000;
const PROMPT_TAIL_CHARS = 3000;
/** $/MTok input, output free forever — ADR-2089 measured cost model. */
const JEV_USD_PER_MTOK_IN = 0.042;

/** The option that lets the judge say "no skill applies" on conversational turns. */
const NONE = 'none';
const NONE_RUBRIC =
  'No skill applies: a conversational reply, a follow-up on work already in progress in this ' +
  'session, a yes/no or clarification, a trivial edit, or a request any general-purpose ' +
  'coding assistant handles without specialised guidance.';

const INSTRUCTIONS =
  'Which skill should handle `user_request`? Choose the single best fit, honouring each ' +
  "option's stated when-NOT-to-use boundaries. Choose `none` only when no listed skill would " +
  'change how a capable assistant approaches the request.';

/** Availability notes rendered at the point of use, never baked into prose (ADR-2089). */
const STATUS_NOTE = {
  gated: 'GATED OFF by default in this environment — do not choose unless its manifest gate is enabled.',
};
/** Statuses that are never routable at runtime; they stay in the measurement rig only. */
const EXCLUDED_STATUS = new Set(['deprecated', 'superseded', 'not-installed', 'router-only']);

/** Frontmatter `description`: folded block, quoted scalar or bare scalar. */
function description(md) {
  const folded = md.match(/^description:\s*(?:>-|>|\|)\s*\n((?:[ \t]+.*\n)+)/m);
  if (folded) return folded[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  const scalar = md.match(/^description:\s*"([\s\S]*?)"\s*$/m) || md.match(/^description:\s*(.+)$/m);
  return scalar ? scalar[1].trim() : null;
}

function frontmatterField(md, key) {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

/**
 * Candidate map {skillName: rubric} from a skills tree. `skill-router` itself is
 * excluded by its `router-only` status; deprecated/superseded/not-installed skills
 * are excluded rather than annotated because a runtime router has nothing to gain
 * from a distractor it must never pick (the measurement rig keeps them, so the
 * eval numbers it reports are a floor for this map, not a ceiling).
 */
function loadCandidates(skillsDir) {
  const out = {};
  let entries = [];
  try { entries = fs.readdirSync(skillsDir, { withFileTypes: true }); } catch { return out; }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const p = path.join(skillsDir, d.name, 'SKILL.md');
    let md;
    try { md = fs.readFileSync(p, 'utf8'); } catch { continue; }
    let desc = description(md);
    if (!desc) continue;
    const status = frontmatterField(md, 'status') || 'live';
    if (EXCLUDED_STATUS.has(status)) continue;
    // Legacy stub marker from before the status contract; still honoured.
    if (/^deprecated:\s*true/m.test(md)) continue;
    if (STATUS_NOTE[status]) desc = `${STATUS_NOTE[status]} ${desc}`;
    out[d.name] = desc;
  }
  return out;
}

/** Minimal `[section]` reader for the CLI's unbooted-shell fallback (mirrors _ab_toml_val). */
function readTomlSection(file, section) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  let inSection = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inSection = line === `[${section}]`; continue; }
    if (!inSection || !line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, '').trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function asBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function asInt(v, dflt) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * Resolve configuration. Environment wins (the entrypoint inlines the manifest
 * into the hook command and publishes it to runtime-env.sh); the manifest is
 * read only when `fallbackToml` is set and the env says nothing — that is the
 * /route CLI in a shell that has not been through boot.
 */
function config(env = process.env, opts = {}) {
  let router = env.AGENTBOX_SKILL_ROUTER;
  let model = env.AGENTBOX_SKILL_ROUTE_MODEL;
  let timeoutMs = env.AGENTBOX_SKILL_ROUTE_TIMEOUT_MS;
  let minChars = env.AGENTBOX_SKILL_ROUTE_MIN_CHARS;
  if (!router && opts.fallbackToml) {
    const t = readTomlSection(opts.fallbackToml, 'skills.routing');
    router = t.router; model = model || t.model;
    timeoutMs = timeoutMs || t.timeout_ms; minChars = minChars || t.min_prompt_chars;
  }
  return {
    router: (router || 'table').toLowerCase(),
    api: env.AGENTBOX_SKILL_ROUTE_API || DEFAULT_API,
    model: model || DEFAULT_MODEL,
    timeoutMs: asInt(timeoutMs, DEFAULT_TIMEOUT_MS),
    minChars: asInt(minChars, DEFAULT_MIN_CHARS),
    skillsDir: env.AGENTBOX_SKILL_ROUTE_SKILLS_DIR || env.SKILLS_TREE || DEFAULT_SKILLS_DIR,
    key: env.TYPESAFE_API_KEY || '',
    logPath: env.AGENTBOX_SKILL_ROUTE_LOG === '0' ? '' :
      (env.AGENTBOX_SKILL_ROUTE_LOG || path.join(os.homedir(), '.claude', 'skill-route.jsonl')),
  };
}

/** Keep the judge inside its token budget on a pasted-document turn. */
function clampPrompt(prompt) {
  if (prompt.length <= PROMPT_HEAD_CHARS + PROMPT_TAIL_CHARS) return { text: prompt, truncated: false };
  return {
    text: `${prompt.slice(0, PROMPT_HEAD_CHARS)}\n[… ${prompt.length - PROMPT_HEAD_CHARS - PROMPT_TAIL_CHARS} chars elided …]\n${prompt.slice(-PROMPT_TAIL_CHARS)}`,
    truncated: true,
  };
}

function skip(reason, extra = {}) { return { outcome: 'skipped', reason, ...extra }; }
function fail(reason, extra = {}) { return { outcome: 'failed', reason, ...extra }; }

/**
 * Route one prompt. Resolves to an outcome object; never rejects.
 * `retries` is 0 for the hook (a turn must not wait on 429/529) and small for the CLI.
 */
async function route(prompt, cfg, { retries = 0, candidates } = {}) {
  const text = String(prompt || '').trim();
  if (cfg.router !== 'jev') return skip('router-off', { router: cfg.router });
  if (!cfg.key) return skip('no-key');
  if (text.startsWith('/')) return skip('slash-command');
  if (text.length < cfg.minChars) return skip('short-prompt', { chars: text.length });
  const criteria = candidates || loadCandidates(cfg.skillsDir);
  const n = Object.keys(criteria).length;
  if (!n) return skip('no-candidates', { skillsDir: cfg.skillsDir });
  if (typeof fetch !== 'function') return fail('no-fetch');

  const { text: state, truncated } = clampPrompt(text);
  const body = {
    state: { user_request: state },
    model: cfg.model,
    questions: { skill: { type: 'choice', instructions: INSTRUCTIONS, criteria: { ...criteria, [NONE]: NONE_RUBRIC } } },
  };
  const base = { candidates: n, chars: text.length, truncated };

  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(cfg.api, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const reason = e && e.name === 'AbortError' ? 'timeout' : 'network';
      if (attempt < retries) continue;
      return fail(reason, { ...base, ms: Date.now() - t0 });
    }
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (res.status === 429 || res.status === 529) {
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 750 * (attempt + 1))); continue; }
      return fail(`http-${res.status}`, { ...base, ms });
    }
    if (!res.ok) return fail(`http-${res.status}`, { ...base, ms });
    let j;
    try { j = await res.json(); } catch { return fail('bad-json', { ...base, ms }); }
    const a = j && j.answers && j.answers.skill;
    if (!a || typeof a.choice !== 'string') return fail('bad-shape', { ...base, ms });
    const probs = a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : {};
    const ranked = Object.entries(probs).sort((x, y) => y[1] - x[1]);
    const inTok = (j.usage && j.usage.input_tokens) || 0;
    return {
      outcome: 'routed', ...base, ms,
      model: j.model || cfg.model,
      choice: a.choice,
      none: a.choice === NONE,
      confidence: typeof a.confidence === 'number' ? a.confidence : null,
      ranked,
      usage: { input_tokens: inTok, output_tokens: (j.usage && j.usage.output_tokens) || 0 },
      usd: inTok * JEV_USD_PER_MTOK_IN / 1e6,
    };
  }
}

/**
 * The text the hook injects. Empty string means "inject nothing".
 *
 * Deliberately terse (~35 tokens): it is paid for in the primary model's input
 * on every routed turn, and its job is to surface the options, not to argue for
 * one. The top three carry their probabilities so a flat distribution reads as
 * what it is; "advisory" is the whole of the instruction (ADR-2090: the number
 * is not a gate). `none` picks inject nothing at all.
 */
function formatContext(r) {
  if (!r || r.outcome !== 'routed' || r.none) return '';
  const top = r.ranked.filter(([k]) => k !== NONE).slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
  return `[route] ${top} — advisory; load a skill only if it fits this turn.`;
}

/** One JSON line per call: outcome accounting without the prompt. */
function appendLog(cfg, record) {
  if (!cfg.logPath) return;
  const { candidates, chars, truncated, ms, outcome, reason, choice, confidence, usage, usd, model, consumer } = record;
  const line = JSON.stringify({ ts: new Date().toISOString(), consumer, outcome, reason, model, choice, confidence,
    candidates, chars, truncated, ms, input_tokens: usage && usage.input_tokens, usd });
  try {
    fs.mkdirSync(path.dirname(cfg.logPath), { recursive: true });
    fs.appendFileSync(cfg.logPath, line + '\n');
  } catch { /* logging is best-effort; never affects the turn */ }
}

module.exports = {
  NONE, INSTRUCTIONS, JEV_USD_PER_MTOK_IN, DEFAULT_API, DEFAULT_MODEL,
  description, loadCandidates, readTomlSection, config, clampPrompt, route, formatContext, appendLog,
};
