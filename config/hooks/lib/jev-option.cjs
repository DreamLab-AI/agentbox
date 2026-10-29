'use strict';

/**
 * jev-option.cjs — the shared plumbing of the opt-in "Jev option" (typed System One
 * decisions beside existing behaviour). One small, dependency-free module so every
 * consumer resolves its endpoint, builds its questions, asks, and falls back the same
 * way. It is deliberately NOT a router: it knows nothing about skills, failures or
 * approvals, and it never writes, signs or approves anything.
 *
 * The contract every caller inherits:
 *   • off by default — `enabled(env, flag)` is true only for an explicit `1`/`true`;
 *   • with the flag off nothing is built and nothing leaves the process;
 *   • `ask()` resolves an outcome and NEVER throws or rejects; any failure is
 *     `{ ok: false, reason }` and the caller keeps its pre-change output;
 *   • the reason vocabulary is closed (flag-off, no-endpoint, local-only, timeout,
 *     network, http-<code>, malformed, low-confidence) and the log line carries it
 *     alone — never request content.
 *
 * Endpoint resolution (first match wins, see guides/jev-option-contract.md §2):
 *   1. the consumer's explicit config (`explicit.url`/`model`/`keyEnv`/`local`);
 *   2. the ADR-2139 loopback proxy: `AGENTBOX_SYSTEM_ONE_PROXY=1` with
 *      `AGENTBOX_SYSTEM_ONE_ENDPOINT`+`_MODEL`, or the names the entrypoint actually
 *      projects (`AGENTBOX_SKILL_ROUTE_API`/`_MODEL`). The proxy holds the vendor key,
 *      so NO Authorization header is sent;
 *   3. `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, bearer
 *      `TYPESAFE_API_KEY` — only if that key is set;
 *   4. otherwise unavailable.
 * A `localOnly` consumer (email, any tainted path, private memory) refuses steps 2 and 3
 * unless the endpoint is declared local (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1` or an
 * explicit `local: true`); locality is declared, never inferred from the URL (ADR-2094 §5).
 */

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
/** Interactive and hook paths: a hard deadline, no retry (the turn must not wait on a 429). */
const DEFAULT_TIMEOUT_MS = 4000;

/** True only for an explicit opt-in; unset, empty, `0`, `false` and anything else are off. */
function enabled(env, flag) {
  const v = String((env || {})[flag] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : '';
}

/**
 * Resolve where a Jev request goes. Returns `{ ok: true, url, model, headers, via, local }`
 * or `{ ok: false, reason }` (`no-endpoint` | `local-only`).
 *
 * `explicit` is `{ url, model, keyEnv, local }` from the consumer's own config; `localOnly`
 * makes the consumer refuse any endpoint not declared local.
 */
function resolveEndpoint(env = process.env, { explicit = {}, localOnly = false } = {}) {
  const json = { 'Content-Type': 'application/json' };
  const declaredLocal = env.AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL === '1';

  const url = nonEmpty(explicit.url);
  if (url) {
    const local = explicit.local === true;
    if (localOnly && !local) return { ok: false, reason: 'local-only' };
    const key = explicit.keyEnv ? nonEmpty(env[explicit.keyEnv]) : '';
    return {
      ok: true, url, model: nonEmpty(explicit.model) || DEFAULT_MODEL, via: 'explicit', local,
      headers: key ? { ...json, Authorization: `Bearer ${key}` } : json,
    };
  }

  // A dedicated, manifest-validated LAN route keeps private consumers off the cloud
  // without changing the public vendor selection or sending vendor credentials.
  const privateUrl = nonEmpty(env.AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT);
  if (localOnly && privateUrl) {
    return { ok: true, url: privateUrl,
      model: nonEmpty(env.AGENTBOX_SYSTEM_ONE_LOCAL_MODEL) || DEFAULT_MODEL,
      via: 'local', local: true, headers: json };
  }

  if (env.AGENTBOX_SYSTEM_ONE_PROXY === '1') {
    const purl = nonEmpty(env.AGENTBOX_SYSTEM_ONE_ENDPOINT) || nonEmpty(env.AGENTBOX_SKILL_ROUTE_API);
    if (purl) {
      if (localOnly && !declaredLocal) return { ok: false, reason: 'local-only' };
      return {
        ok: true, url: purl, via: 'proxy', local: declaredLocal, headers: json,
        model: nonEmpty(env.AGENTBOX_SYSTEM_ONE_MODEL) || nonEmpty(env.AGENTBOX_SKILL_ROUTE_MODEL) || DEFAULT_MODEL,
      };
    }
  }

  const key = nonEmpty(env.TYPESAFE_API_KEY);
  if (key) {
    if (localOnly) return { ok: false, reason: 'local-only' };
    return {
      ok: true, url: DEFAULT_URL, model: DEFAULT_MODEL, via: 'typesafe', local: false,
      headers: { ...json, Authorization: `Bearer ${key}` },
    };
  }
  return { ok: false, reason: 'no-endpoint' };
}

// ── question builders (wire format: api-and-design.md; openapi.json) ───────────────

/** Choice: `criteria` is a MAP of option name → when it applies and when it does not. */
function choiceQuestion(instructions, criteria) {
  return { type: 'choice', instructions, criteria };
}

/** Score: `criteria` is an ORDERED list of level descriptions, lowest first. */
function scoreQuestion(instructions, criteria) {
  return { type: 'score', instructions, criteria };
}

/** Noul: the probability of yes. Question ids are not shown to the model, so the instructions carry the whole meaning. */
function noulQuestion(instructions) {
  return { type: 'noul', instructions };
}

// ── readers: null on any shape the caller did not offer ────────────────────────────

/** `{ choice, confidence }` where the choice is one of `allowed`, else null. */
function readChoice(answer, allowed) {
  if (!answer || typeof answer !== 'object') return null;
  const choice = answer.choice;
  if (typeof choice !== 'string' || !allowed.includes(choice)) return null;
  let confidence = typeof answer.confidence === 'number' && Number.isFinite(answer.confidence) ? answer.confidence : null;
  if (confidence === null && answer.probabilities && typeof answer.probabilities === 'object') {
    const p = answer.probabilities[choice];
    if (typeof p === 'number' && Number.isFinite(p)) confidence = p;
  }
  return { choice, confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)) };
}

/** Probability of yes in [0, 1], else null. */
function readNoul(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const p = answer.noul;
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
}

/**
 * A score answer normalised to [0, 1] as `score / (levels − 1)`, the level count read from
 * `legend` or `probabilities`; the expected level from `probabilities` when `score` is
 * absent. Null for any other shape (including fewer than two levels).
 */
function readScore(answer, levelsHint) {
  if (!answer || typeof answer !== 'object') return null;
  const probs = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null;
  const legend = answer.legend && typeof answer.legend === 'object' ? answer.legend : null;
  const levels = Object.keys(legend || probs || {}).length || levelsHint || 0;
  if (levels < 2) return null;
  let raw = typeof answer.score === 'number' && Number.isFinite(answer.score) ? answer.score : null;
  if (raw === null && probs) {
    let sum = 0, mass = 0;
    for (const [k, v] of Object.entries(probs)) {
      const i = Number(k);
      if (!Number.isInteger(i) || typeof v !== 'number' || !Number.isFinite(v)) return null;
      sum += i * v; mass += v;
    }
    if (mass <= 0) return null;
    raw = sum / mass;
  }
  if (raw === null) return null;
  return Math.min(1, Math.max(0, raw / (levels - 1)));
}

// ── the call ───────────────────────────────────────────────────────────────────────

/**
 * POST one request. `endpoint` is a resolved `{ url, model, headers }`; `fetchImpl` is
 * injectable so tests mock the transport. Resolves `{ ok: true, answers, model, usage, ms }`
 * or `{ ok: false, reason, ms }`; never rejects. 429/529 are retried only when the caller
 * asks (`retries`); hook and interactive paths pass 0.
 */
async function ask(endpoint, state, questions, { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0 } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!endpoint || !endpoint.url) return { ok: false, reason: 'no-endpoint', ms: 0 };
  if (!doFetch) return { ok: false, reason: 'no-fetch', ms: 0 };
  const body = JSON.stringify({ state, model: endpoint.model || DEFAULT_MODEL, questions });
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        const error = new Error('deadline'); error.name = 'AbortError'; reject(error);
      }, timeoutMs);
    });
    const t0 = Date.now();
    try {
      const res = await Promise.race([doFetch(endpoint.url, {
        method: 'POST', headers: endpoint.headers || {}, body, signal: ctl.signal, redirect: 'error',
      }), deadline]);
      const status = res && typeof res.status === 'number' ? res.status : 0;
      if (status === 429 || status === 529) {
        if (attempt < retries) {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
          continue;
        }
        return { ok: false, reason: `http-${status}`, ms: Date.now() - t0 };
      }
      if (!res || !res.ok) return { ok: false, reason: `http-${status}`, ms: Date.now() - t0 };
      let j;
      try { j = await Promise.race([res.json(), deadline]); }
      catch (e) {
        return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'malformed', ms: Date.now() - t0 };
      }
      const answers = j && j.answers;
      const ms = Date.now() - t0;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, reason: 'malformed', ms };
      return { ok: true, answers, model: typeof j.model === 'string' ? j.model : endpoint.model, usage: j.usage || {}, ms };
    } catch (e) {
      if (attempt < retries) continue;
      return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network', ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * One line to stderr per fallback: the item, the reason, nothing of the request. Best-effort;
 * `sink` is injectable for tests. Returns the line.
 */
function logFallback(item, reason, sink) {
  const line = `[jev-option] ${item} fallback (${reason})`;
  try { (sink || ((l) => process.stderr.write(`${l}\n`)))(line); } catch { /* logging never affects the caller */ }
  return line;
}

module.exports = {
  DEFAULT_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS,
  enabled, resolveEndpoint, choiceQuestion, scoreQuestion, noulQuestion,
  readChoice, readNoul, readScore, ask, logFallback,
};
