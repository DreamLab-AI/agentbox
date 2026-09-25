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
 * `description` (narrowed, for the hook, to the Claude Code registration manifest
 * skills/registered-skills.txt — the /route CLI still sees the whole tree and marks
 * picks the Skill tool cannot load), composes the ADR-2089 `status` field in at the point of use,
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
/**
 * Where the Claude Code registration manifest lives: the checkout this library sits in
 * (config/hooks/lib → <root>/skills), then the baked copy. The two coincide in the image
 * because the baked layout mirrors the repo (/opt/agentbox/config/hooks/lib → /opt/agentbox/skills).
 */
const REGISTERED_MANIFEST_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'skills', 'registered-skills.txt'),
  '/opt/agentbox/skills/registered-skills.txt',
];
/**
 * Ceiling on the injected line. It is paid for in the primary model's input on every
 * routed turn, so SKILL.md paths are appended only while they fit.
 */
const MAX_CONTEXT_CHARS = 300;
/** Jev's shared state+questions budget is ~32k tokens; the fleet takes ~16k. */
const PROMPT_HEAD_CHARS = 9000;
const PROMPT_TAIL_CHARS = 3000;
/** $/MTok input, output free forever — ADR-2089 measured cost model. */
const JEV_USD_PER_MTOK_IN = 0.042;
/**
 * The unit price is configuration, because this library cannot know it. A self-hosted
 * endpoint bills nothing; a metered one bills its own rate; the default above is Jev's.
 * Applying one endpoint's price to another's tokens is a correct calculation of a
 * meaningless quantity — and a dangerous one, because a cheaper endpoint also consumes
 * far fewer input tokens, so a stale price reads as a large saving rather than an
 * unrelated number. Each log line therefore records the price it was costed at, so a log
 * spanning a migration can still be totalled honestly instead of silently mixing two
 * currencies of meaning.
 *
 * Note what this deliberately is NOT: the library never asks who answers. It takes a
 * price, not an identity, and infers neither from the endpoint URL — a URL tells you the
 * host you dialled, not who is billing you or where the bytes came to rest.
 */
const USD_PER_MTOK_IN_ENV = 'AGENTBOX_SKILL_ROUTE_USD_PER_MTOK_IN';

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

/**
 * The local first stage (ADR-2095 addendum 2026-09-23). A port of the BM25 ranker in
 * `crates/system-one/system-one-eval/src/copy.rs` — stoplist, tokeniser, constants,
 * exclusion-clause stripping and summation order — because the cutoff it is gated on was
 * measured with that instrument, and a cutoff only transfers to the ranker it was read
 * from. `tests/system-one/cascade-parity.test.mjs` holds the two to the same picks and
 * margins on the routing corpus.
 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const STOPLIST = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'with', 'without', 'is', 'are',
  'be', 'this', 'that', 'it', 'its', 'as', 'at', 'by', 'from', 'into', 'over', 'under', 'when',
  'use', 'used', 'using', 'not', 'never', 'only', 'your', 'you', 'we', 'our', 'their', 'they',
  'them', 'there', 'here', 'what', 'which', 'who', 'how', 'why', 'do', 'does', 'did', 'can',
  'could', 'should', 'would', 'may', 'might', 'will', 'shall', 'must', 'if', 'then', 'than',
  'else', 'also', 'more', 'most', 'less', 'least', 'very',
]);
/** A rubric's "what this is NOT for" clause names its neighbours; indexed, it attracts them. */
const EXCLUSION_MARKERS = [
  'not for', 'never for', 'skip for', 'skip when', 'do not use', 'do not choose',
  'choose this only when', 'rather than this', ', not this', 'instead of this', 'use the ',
];
/**
 * Default relative-margin cutoff: the in-sample parity point of BM25 in front of the local
 * openjev judge (52.3% escalated in-sample; 86.0% top-1 at 50% escalated leave-one-out). In
 * front of cloud Jev, parity needs 0.6786 and saves only ~19% of calls.
 */
const DEFAULT_CASCADE_CUTOFF = 0.3718;

/** ASCII alphanumeric runs of the lowercased text, minus the stoplist and short tokens. */
function tokenise(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOPLIST.has(t));
}

/** Everything before the first exclusion marker, or the whole rubric. */
function stripExclusion(rubric) {
  const lower = rubric.toLowerCase();
  let cut = -1;
  for (const m of EXCLUSION_MARKERS) {
    const i = lower.indexOf(m);
    if (i !== -1 && (cut === -1 || i < cut)) cut = i;
  }
  return cut === -1 ? rubric : rubric.slice(0, cut).trimEnd();
}

/** Classic BM25 of one query against a document set; distinct query terms, summed in byte order. */
function bm25(query, docs) {
  if (!docs.length) return [];
  const n = docs.length;
  const lengths = docs.map((d) => d.length);
  const avgdl = lengths.reduce((a, b) => a + b, 0) / n;
  const df = new Map();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) || 0) + 1);
  const terms = [...new Set(query)].sort();
  return docs.map((doc, i) => {
    const tf = new Map();
    for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (f === undefined) continue;
      const d = df.get(t) || 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * lengths[i] / avgdl));
    }
    return score;
  });
}

/**
 * Rank the candidate map for one prompt. Returns the top option (ties to the lower
 * candidate index, as the rig's stable sort) and the relative margin `(s1 − s2) / |s1|`,
 * which is 0 when nothing scores — no separation, so the turn escalates.
 */
function localRank(prompt, criteria) {
  const names = Object.keys(criteria);
  if (names.length < 2) return null;
  const docs = names.map((k) => tokenise(`${k}: ${stripExclusion(criteria[k])}`));
  const scores = bm25(tokenise(prompt), docs);
  let b1 = 0, s1 = -Infinity, s2 = -Infinity;
  scores.forEach((s, i) => {
    if (s > s1) { s2 = s1; s1 = s; b1 = i; } else if (s > s2) { s2 = s; }
  });
  const margin = Math.abs(s1) > Number.EPSILON ? (s1 - s2) / Math.abs(s1) : 0;
  return { choice: names[b1], margin };
}

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

/**
 * The skill names registered for Claude Code (skills/registered-skills.txt: one name per
 * line, `#` comments and blanks ignored), or `null` when no manifest can be read. `null`
 * is the fail-open signal: the caller keeps the whole baked tree rather than routing over
 * nothing.
 */
function readRegisteredManifest(files) {
  for (const f of [].concat(files || [])) {
    if (!f) continue;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const names = text.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
    return new Set(names);
  }
  return null;
}

/**
 * Narrow a candidate map to the registered set. The hook offers only what the Skill tool
 * can load: measured on 143 live picks, 70% named a skill outside the registered set,
 * i.e. a recommendation the model could not act on through the Skill tool.
 *
 * Returns `{ criteria, scope, scopeReason? }`. Fails open to the whole map, labelled, when
 * the manifest is unreadable or shares no name with the tree (a manifest from a different
 * tree is a misconfiguration, and routing over nothing would silently switch the router off).
 */
function restrictToRegistered(criteria, cfg) {
  const registered = readRegisteredManifest(cfg && cfg.registeredManifests);
  if (!registered) return { criteria, scope: 'all', scopeReason: 'manifest-unreadable' };
  const kept = {};
  for (const [k, v] of Object.entries(criteria)) if (registered.has(k)) kept[k] = v;
  if (!Object.keys(kept).length) return { criteria, scope: 'all', scopeReason: 'manifest-disjoint' };
  return { criteria: kept, scope: 'registered' };
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
/** A non-negative rate; anything unparseable falls back rather than costing at NaN. */
function asRate(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
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
  let cascade = env.AGENTBOX_SKILL_ROUTE_CASCADE;
  let cutoff = env.AGENTBOX_SKILL_ROUTE_CASCADE_CUTOFF;
  if (!router && opts.fallbackToml) {
    const t = readTomlSection(opts.fallbackToml, 'skills.routing');
    router = t.router; model = model || t.model;
    timeoutMs = timeoutMs || t.timeout_ms; minChars = minChars || t.min_prompt_chars;
    cascade = cascade ?? t.cascade; cutoff = cutoff ?? t.cascade_cutoff;
  }
  return {
    router: (router || 'table').toLowerCase(),
    api: env.AGENTBOX_SKILL_ROUTE_API || DEFAULT_API,
    model: model || DEFAULT_MODEL,
    timeoutMs: asInt(timeoutMs, DEFAULT_TIMEOUT_MS),
    minChars: asInt(minChars, DEFAULT_MIN_CHARS),
    // ADR-2095 addendum: off unless the manifest gate is on. When on, a turn whose local
    // BM25 margin reaches the cutoff is answered here and never sent to the judge.
    cascade: asBool(cascade, false),
    cascadeCutoff: asRate(cutoff, DEFAULT_CASCADE_CUTOFF),
    // ADR-2110 (proposed): tag each hook log line with a hashed session id so the
    // routing label recorder can join the router's pick to the teacher's label.
    labelLog: asBool(env.AGENTBOX_SKILL_ROUTE_LABEL_LOG, false),
    skillsDir: env.AGENTBOX_SKILL_ROUTE_SKILLS_DIR || env.SKILLS_TREE || DEFAULT_SKILLS_DIR,
    // What the Skill tool can invoke: reconcile-skills.sh projects registered-skills.txt
    // here at boot. The hook ranks only the registered set, but /route and a fail-open
    // hook rank the whole baked tree, so a pick outside this set must be loaded by
    // reading its SKILL.md, and the injected line says where.
    registeredDir: env.AGENTBOX_SKILL_ROUTE_REGISTERED_DIR || env.CLAUDE_SKILLS_DIR ||
      path.join(os.homedir(), '.claude', 'skills'),
    // The registration manifest the hook narrows its candidates to. An explicit override
    // wins; '0' means "no manifest", which fails open to the whole tree.
    registeredManifests: env.AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST === '0' ? [] :
      env.AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST ? [env.AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST] :
      REGISTERED_MANIFEST_CANDIDATES,
    key: env.TYPESAFE_API_KEY || '',
    // Declared alongside the endpoint by whoever selects one; undeclared means the
    // metered default, so a misconfiguration over-states cost rather than hiding it.
    usdPerMTokIn: asRate(env[USD_PER_MTOK_IN_ENV], JEV_USD_PER_MTOK_IN),
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
async function route(prompt, cfg, { retries = 0, candidates, registeredOnly = false } = {}) {
  const text = String(prompt || '').trim();
  if (cfg.router !== 'jev') return skip('router-off', { router: cfg.router });
  // With the cascade off the judge is the only path, so no key means nothing to do. With it
  // on, a confident local pick needs no key at all; only an escalation does.
  if (!cfg.key && !cfg.cascade) return skip('no-key');
  if (text.startsWith('/')) return skip('slash-command');
  if (text.length < cfg.minChars) return skip('short-prompt', { chars: text.length });
  let criteria = candidates || loadCandidates(cfg.skillsDir);
  // The hook routes over what the Skill tool can load; /route and the eval see everything.
  let scoped = {};
  if (registeredOnly && Object.keys(criteria).length) {
    const r = restrictToRegistered(criteria, cfg);
    criteria = r.criteria;
    scoped = r.scopeReason ? { scope: r.scope, scopeReason: r.scopeReason } : { scope: r.scope };
  }
  const n = Object.keys(criteria).length;
  if (!n) return skip('no-candidates', { skillsDir: cfg.skillsDir });

  let esc = {};
  if (cfg.cascade) {
    const t0 = Date.now();
    const local = localRank(text, criteria);
    if (local && local.margin >= cfg.cascadeCutoff) {
      return {
        outcome: 'routed', candidates: n, chars: text.length, truncated: false, ms: Date.now() - t0,
        model: 'local-bm25', choice: local.choice, none: false, confidence: null, ranked: [],
        usage: { input_tokens: 0, output_tokens: 0 }, usdPerMTokIn: cfg.usdPerMTokIn, usd: 0,
        cascade: 'local', margin: local.margin, ...scoped,
      };
    }
    esc = { cascade: 'escalated', margin: local ? local.margin : 0 };
    if (!cfg.key) return skip('no-key', { ...esc, ...scoped });
  }
  if (typeof fetch !== 'function') return fail('no-fetch', { ...esc, ...scoped });

  const { text: state, truncated } = clampPrompt(text);
  const body = {
    state: { user_request: state },
    model: cfg.model,
    questions: { skill: { type: 'choice', instructions: INSTRUCTIONS, criteria: { ...criteria, [NONE]: NONE_RUBRIC } } },
  };
  const base = { candidates: n, chars: text.length, truncated, ...esc, ...scoped };

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
      usdPerMTokIn: cfg.usdPerMTokIn,
      usd: inTok * cfg.usdPerMTokIn / 1e6,
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
 *
 * With `cfg`, a shown pick that the Skill tool cannot invoke (absent from
 * `cfg.registeredDir`) is followed by the path of its SKILL.md: naming a skill
 * the model cannot load is a dead end. Without `cfg`, or when the registered
 * directory cannot be read, the line is unchanged — there is nothing to compare.
 */
function formatContext(r, cfg) {
  if (!r || r.outcome !== 'routed' || r.none) return '';
  // Zero-mass entries are dropped before the slice, not after: a sovereign backend
  // shortlists the candidate set and reports the options it set aside at exactly 0.0
  // (ADR-2094), so an unfiltered top-3 would inject two skill names the judge gave no
  // weight to into every routed turn. On the cloud path every option carries some mass,
  // so this is a no-op there.
  // The pick is always advertised; probabilities are shown only where they carry
  // meaning. A backend may legitimately omit `probabilities`, and a shortlisting one
  // reports the options it set aside at exactly 0.0 — in both cases a number would be
  // noise, but the pick itself is the whole point of having asked.
  const scored = r.ranked.filter(([k, v]) => k !== NONE && v > 0).slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
  const top = scored || r.choice;
  if (!top) return '';
  const line = `[route] ${top} — advisory; load a skill only if it fits this turn.`;
  const shown = scored ? r.ranked.filter(([k, v]) => k !== NONE && v > 0).slice(0, 3).map(([k]) => k) : [r.choice];
  const paths = unregisteredPaths(shown, cfg);
  if (!paths.length) return line.slice(0, MAX_CONTEXT_CHARS);
  // Paths are appended in rank order while the whole line stays within the ceiling.
  let out = `${line} Not in the Skill tool; Read its SKILL.md instead: `;
  let added = 0;
  for (const p of paths) {
    const next = `${out}${added ? ' · ' : ''}${p}`;
    if (next.length > MAX_CONTEXT_CHARS) break;
    out = next; added++;
  }
  return added ? out : line.slice(0, MAX_CONTEXT_CHARS);
}

/** `name → path` for each shown pick outside the Skill tool's set but present in the baked tree. */
function unregisteredPaths(names, cfg) {
  if (!cfg || !cfg.registeredDir || !cfg.skillsDir) return [];
  let registered;
  try { registered = new Set(fs.readdirSync(cfg.registeredDir)); } catch { return []; }
  return names.filter((k) => !registered.has(k))
    .map((k) => [k, path.join(cfg.skillsDir, k, 'SKILL.md')])
    .filter(([, p]) => fs.existsSync(p))
    .map(([k, p]) => `${k} → ${p}`);
}

/** One JSON line per call: outcome accounting without the prompt. */
function appendLog(cfg, record) {
  if (!cfg.logPath) return;
  const { candidates, chars, truncated, ms, outcome, reason, choice, confidence, usage, usd, usdPerMTokIn,
    model, consumer, cascade, margin, session, scope, scopeReason } = record;
  const line = JSON.stringify({ ts: new Date().toISOString(), consumer, outcome, reason, model, choice, confidence,
    candidates, chars, truncated, ms, input_tokens: usage && usage.input_tokens,
    // `usd` is only meaningful against the price it was costed at; carry both so a log
    // spanning a change of endpoint can still be totalled honestly (ADR-2094).
    usd_per_mtok_in: usdPerMTokIn, usd,
    // Present only with the cascade on, so a cascade-off log line is unchanged.
    ...(cascade ? { cascade, margin } : {}),
    // Present only with label logging on: a 12-hex digest, never the raw session id.
    ...(session ? { session } : {}),
    // Present only when the caller narrowed the candidates (the hook): which set was ranked.
    ...(scope ? { scope } : {}), ...(scopeReason ? { scope_reason: scopeReason } : {}) });
  try {
    fs.mkdirSync(path.dirname(cfg.logPath), { recursive: true });
    fs.appendFileSync(cfg.logPath, line + '\n');
  } catch { /* logging is best-effort; never affects the turn */ }
}

module.exports = {
  NONE, INSTRUCTIONS, JEV_USD_PER_MTOK_IN, USD_PER_MTOK_IN_ENV, DEFAULT_API, DEFAULT_MODEL,
  description, loadCandidates, readTomlSection, config, clampPrompt, route, formatContext, unregisteredPaths, appendLog,
  tokenise, stripExclusion, bm25, localRank, DEFAULT_CASCADE_CUTOFF,
  readRegisteredManifest, restrictToRegistered, REGISTERED_MANIFEST_CANDIDATES, MAX_CONTEXT_CHARS,
};
