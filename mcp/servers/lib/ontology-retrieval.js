'use strict';
// ontology-retrieval.js — the shared retrieval brain for the pervasive ontology
// augmentation binding (PRD-020 / ADR-112). NOT an HTTP service: a library
// imported in-process by every channel (ontology_ask MCP tool, consultant seam,
// PUSH hook). "One brain" = this module + the shared backing stores
// (RuVector seed index + VisionClaw read surfaces), not one process.
//
// Pipeline (PULL): entity-link -> HNSW seed (RuVector) -> maturity/domain gate
//   -> (mode=expand) bounded k-hop SPARQL via authed vcFetch -> terse Turtle
//   -> clampToBudget -> provenance tag. Fail-open everywhere.
//
// Dependency-injected (seedFn/expandFn/cache/clock) so it is unit-testable
// without a live RuVector/VisionClaw and wireable to the real ones in prod.

const budget = require('./ontology-budget');
const { createTelemetrySink } = require('./ontology-telemetry');
const { createHash } = require('node:crypto');

const VC_PREFIXES = [
  'PREFIX vc: <https://narrativegoldmine.com/ns/v1#>',
  'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>',
].join('\n');

const MATURITY_RANK = Object.freeze({
  draft: 0, developing: 1, emerging: 2, growing: 3, established: 4, mature: 5,
});

// ── Cache key: the complete effective-constraint enumeration (ADR-2023) ───────
/**
 * EVERY effective constraint of a request — anything that can change which bytes
 * are legitimately returned — MUST be named here.
 *
 * An omitted field is a CORRECTNESS BUG, not a perf tweak. The key is the only
 * thing standing between a cached answer and a request that asked for something
 * else. The 2026-09-04 estate review reproduced exactly that failure: `domain`
 * and `max_tokens` were absent from the key, so an AI-domain seed serialised to
 * 830 tokens was returned, `cache_hit: true`, to a subsequent robotics request
 * capped at 50 tokens. Both constraints were silently discarded.
 *
 * Adding a new knob to `ask()` without adding it to this list re-opens that
 * hole. The list is enumerated explicitly (rather than hashing whatever object
 * happens to be passed) so that the omission is visible in review instead of
 * being implied by a spread.
 */
const CACHE_KEY_FIELDS = Object.freeze([
  'query',         // the question itself
  'model_tier',    // tier ceiling + default mode/depth
  'mode',          // menu | expand
  'depth',         // k-hop depth actually used
  'provenance',    // asserted | inferred — the REQUESTED scope
  'full',          // page-body drill-down
  'domain',        // sourceDomain filter (absent pre-2026-09-05 → the defect)
  'max_tokens',    // per-request budget override (absent pre-2026-09-05 → the defect)
  'budget',        // the RESOLVED ceiling (tier ∧ override) — the constraint that binds
  'min_maturity',  // maturity threshold the seed gate applied
  'backend',       // loom | visionclaw | injected — different stores, different answers
  'generation',    // served bundle/generation identity behind that backend
]);

/** Null/undefined/'' collapse to one sentinel so absence never aliases a value. */
function cacheKeyFieldValue(v) {
  if (v === undefined || v === null || v === '') return '∅';
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  return String(v);
}

/**
 * Stable, allocation-light cache key: FNV-1a over `field=value` pairs for every
 * entry of CACHE_KEY_FIELDS, in declaration order. Field names are part of the
 * hashed string so a value cannot migrate between fields undetected.
 * @param {object} req the RESOLVED request (post tier/budget/backend resolution)
 */
function cacheKey(req) {
  const s = CACHE_KEY_FIELDS
    .map((f) => f + '=' + cacheKeyFieldValue(req[f]))
    .join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'ont:' + h.toString(16);
}

// ── Degradation vocabulary (ADR-2023) ────────────────────────────────────────
/**
 * Which STAGE of the pipeline failed. A caller must be able to tell a complete
 * result from a partial one, and which part is missing — `degraded: false` on a
 * failed expansion (the pre-2026-09-05 behaviour) made a menu-only answer
 * indistinguishable from a fully expanded one.
 */
const DEGRADED_STAGES = Object.freeze({
  SEED: 'seed',
  EXPANSION: 'expansion',
  SPARQL: 'sparql',
  BACKEND_UNAVAILABLE: 'backend-unavailable',
});

/**
 * Named degraded outcomes. `BACKEND_CONFIGURED_UNAVAILABLE` is deliberately
 * distinct from `BACKEND_NOT_CONFIGURED`: a Loom that is configured and
 * unreachable is an operational fault to page on, whereas an unset
 * LOOM_FACADE_URL is the ordinary VisionClaw selection path and not a fault at
 * all. Collapsing the two hides a dead façade behind a normal fallback.
 */
const DEGRADED_OUTCOMES = Object.freeze({
  BACKEND_CONFIGURED_UNAVAILABLE: 'backend_configured_but_unavailable',
  BACKEND_NOT_CONFIGURED: 'backend_not_configured',
  SEED_REJECTED: 'seed_rejected',
  EXPANSION_UNAVAILABLE: 'expansion_unavailable',
});

/** Backend identities that can sit behind the one-brain retrieval contract. */
const BACKENDS = Object.freeze({
  LOOM: 'loom',
  VISIONCLAW: 'visionclaw',
  INJECTED: 'injected',
  NONE: 'none',
});

/** Why a backend was selected — surfaced so a fallback is never silent. */
const BACKEND_REASONS = Object.freeze({
  LOOM_URL_SET: 'loom_facade_url_set',
  LOOM_URL_UNSET: 'loom_facade_url_unset_visionclaw_selected',
  VC_FETCH_INJECTED: 'vc_fetch_injected_overrides_loom',
  INJECTED_TRANSPORT: 'injected_transport',
  NOT_CONFIGURED: 'no_backend_configured',
});

/** Normalise a backend descriptor; an injected transport counts as configured. */
function normaliseBackend(b) {
  if (!b) {
    return {
      name: BACKENDS.INJECTED, url: null, configured: true,
      generation: null, reason: BACKEND_REASONS.INJECTED_TRANSPORT,
    };
  }
  return {
    name: b.name || BACKENDS.INJECTED,
    url: b.url || null,
    configured: b.configured !== false,
    generation: b.generation == null ? null : String(b.generation),
    reason: b.reason || BACKEND_REASONS.INJECTED_TRANSPORT,
  };
}

/**
 * Does a cached entry still satisfy the CURRENT request's constraints?
 *
 * Documented policy: on any violation we MISS the cache and re-retrieve. We do
 * NOT truncate a stored body down to the smaller budget, because the stored
 * Turtle has already been clamped once; a second deterministic cut would slice
 * a seed mid-triple and silently change what the grounding asserts. A miss
 * costs one retrieval; a bad truncation costs correctness.
 */
function cacheEntrySatisfies(entry, cur) {
  const violations = [];
  if (!entry || !entry.result) return { ok: false, violations: ['no_entry'] };
  const st = entry.constraints || {};
  const res = entry.result;
  for (const f of ['domain', 'provenance', 'backend', 'generation', 'min_maturity', 'model_tier', 'mode', 'depth', 'full']) {
    if (Object.prototype.hasOwnProperty.call(st, f)
      && cacheKeyFieldValue(st[f]) !== cacheKeyFieldValue(cur[f])) {
      violations.push(f);
    }
  }
  if (typeof cur.budget === 'number' && typeof res.tokens_used === 'number'
    && res.tokens_used > cur.budget) {
    violations.push('budget');
  }
  return { ok: violations.length === 0, violations };
}

/** Accept both the current {result,constraints} entry and any legacy bare result. */
function normaliseCacheEntry(cached) {
  if (cached && typeof cached === 'object' && cached.result) return cached;
  return { result: cached, constraints: null };
}

/** Minimal in-process TTL LRU. Used by default; injectable for tests. */
function createTtlCache({ ttlMs = 120000, max = 256, clock = () => Date.now() } = {}) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (clock() - e.t > ttlMs) { m.delete(k); return undefined; }
      m.delete(k); m.set(k, e); // LRU bump
      return e.v;
    },
    set(k, v) {
      m.set(k, { v, t: clock() });
      if (m.size > max) m.delete(m.keys().next().value);
    },
    get size() { return m.size; },
  };
}

/** Escape a string literal for Turtle. */
function ttlStr(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

/** Local-name from any IRI/URN (handles #, /, and urn:…:slug) for terse labels. */
function localName(iri) {
  if (!iri) return 'unknown';
  const i = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':'));
  return i >= 0 ? iri.slice(i + 1) : iri;
}

/**
 * Serialise seed classes (menu) + optional expand triples to terse, prefix-once
 * Turtle. 2-9x cheaper than SPARQL-Results JSON (ADR-115).
 */
function serialiseTurtle(seeds, expandTriples, { includePrefixes = true } = {}) {
  const lines = [];
  if (includePrefixes) lines.push(VC_PREFIXES, '');
  for (const c of seeds) {
    // Render the full IRI in angle brackets — valid Turtle for any scheme
    // (vc:#…, urn:ngm:…, urn:visionclaw:…) without prefix-mismatch.
    const parts = [`<${c.iri}> a owl:Class`];
    if (c.label) parts.push(`  rdfs:label ${ttlStr(c.label)}`);
    if (c.domain) parts.push(`  vc:sourceDomain ${ttlStr(c.domain)}`);
    if (c.maturity) parts.push(`  vc:maturity ${ttlStr(c.maturity)}`);
    if (Array.isArray(c.relations) && c.relations.length) {
      parts.push(`  vc:relations ${ttlStr(c.relations.slice(0, 5).join(', '))}`);
    }
    lines.push(parts.join(' ;\n') + ' .');
    if (c.summary) lines.push(`# ${String(c.summary).replace(/\n/g, ' ')}`);
  }
  if (Array.isArray(expandTriples)) {
    for (const t of expandTriples) {
      // t: { s, p, o } already in compact/IRI form
      lines.push(`${t.s} ${t.p} ${t.o} .`);
    }
  }
  return lines.join('\n');
}

/**
 * Build a one-line PUSH breadcrumb from the top seed. Pointer, not payload.
 * "[ONTOLOGY] seed: vc:smart-contract (mature, blockchain) -> expand via ontology_ask"
 */
function breadcrumb(seeds) {
  if (!seeds || !seeds.length) return null;
  const c = seeds[0];
  const ln = localName(c.iri);
  const tags = [c.maturity, c.domain].filter(Boolean).join(', ');
  const line = `[ONTOLOGY] seed: vc:${ln}${tags ? ` (${tags})` : ''} → expand via ontology_ask`;
  return budget.clampBreadcrumb(line).line;
}

/**
 * Create a retrieval brain.
 * @param {object} deps
 *   seedFn   async ({query, limit, domain}) => [{iri,label,domain,maturity,summary,relations,score}]
 *   expandFn async ({seedIris, depth, provenance}) => [{s,p,o}]   (k-hop, server-clamped)
 *   cache    optional TTL cache (get/set)
 *   clock    optional () => ms
 *   minMaturity  default 'established' (gate)
 *   telemetry    optional sink { record(event), snapshot?() }. Defaults to the
 *                real file+memory liveness sink (ADR-119) — NOT a no-op — so
 *                fail_open records land in JSONL and fail_open_count is observable.
 */
function createOntologyRetrieval(deps = {}) {
  const seedFn = deps.seedFn || (async () => []);
  const expandFn = deps.expandFn || (async () => []);
  const cache = deps.cache || createTtlCache({ clock: deps.clock });
  const clock = deps.clock || (() => Date.now());
  const minMaturity = deps.minMaturity || 'established';
  const minRank = MATURITY_RANK[minMaturity] ?? 4;
  const telemetry = deps.telemetry || createTelemetrySink({ clock });
  // Which store is actually answering, and whether it is configured. Carried on
  // every result so a caller can never mistake one backend's answer for
  // another's, and so a configured-but-unreachable façade is a NAMED outcome.
  const backend = normaliseBackend(deps.backend);

  async function ask(rawReq = {}) {
    const t0 = clock();
    const req = {
      query: String(rawReq.query || ''),
      model_tier: rawReq.model_tier || budget.DEFAULT_TIER,
      max_tokens: typeof rawReq.max_tokens === 'number' ? rawReq.max_tokens : null,
      mode: rawReq.mode,
      provenance: rawReq.provenance || 'asserted',
      full: rawReq.full === true,
      depth: rawReq.depth,
      domain: rawReq.domain || null,
      min_maturity: minMaturity,
      backend: backend.name,
      // A request may pin a generation/bundle explicitly; otherwise the one the
      // backend descriptor declares. Two generations of the same graph are two
      // different answers to the same question — never one cache entry.
      generation: rawReq.generation != null ? String(rawReq.generation) : backend.generation,
    };
    const cfg = budget.tierConfig(req.model_tier);
    if (req.mode == null) req.mode = cfg.mode;
    if (req.depth == null) req.depth = cfg.depth;

    // HARD: full:true forbidden below sonnet (ADR-116). Downgrade, never reject the call.
    let fullDenied = false;
    if (req.full && !budget.isFullAllowed(req.model_tier)) {
      req.full = false; fullDenied = true;
    }

    // The RESOLVED ceiling — tier max ∧ per-request override. This, not the raw
    // override, is the constraint a cached body has to satisfy.
    req.budget = budget.resolveBudget(req.model_tier, req.max_tokens);

    const empty = (extra) => ({
      turtle: '', breadcrumb: null, seed_iris: [], tokens_used: 0,
      truncated: false, provenance: req.provenance, cache_hit: false,
      degraded: false, degraded_stages: [], full_denied: fullDenied,
      domain: req.domain, budget: req.budget, backend: backend.name,
      backend_configured: backend.configured, generation: req.generation,
      latency_ms: clock() - t0,
      ...extra,
    });

    if (!req.query.trim()) return empty();

    // Verify before cache lookup: a healthy old cache must not mask drift,
    // an unavailable identity endpoint, or a caller's generation mismatch.
    if (deps.verifyGeneration) {
      try {
        const served = await deps.verifyGeneration(req.generation);
        req.served_identity = served.identity;
        req.generation = served.cacheGeneration;
      } catch (err) {
        telemetry.record({ event: 'fail_open', stage: 'generation', cause: 'auth_or_validation' });
        return empty({ degraded: true, degraded_stages: ['generation'],
          error: 'loom_identity_rejected', error_cause: 'auth_or_validation' });
      }
    }


    // Constraints the answer must satisfy, in the same vocabulary the key uses.
    const constraints = {};
    for (const f of CACHE_KEY_FIELDS) constraints[f] = req[f];

    const key = cacheKey(req);
    const cached = cache.get(key);
    if (cached) {
      const entry = normaliseCacheEntry(cached);
      // Defence in depth: the key already covers every constraint, so a
      // violation here means a hash collision or a legacy entry. Either way a
      // stale-constraint body must never be served — MISS and re-retrieve
      // (see cacheEntrySatisfies for why we do not truncate instead).
      const check = cacheEntrySatisfies(entry, constraints);
      if (check.ok) {
        telemetry.record({ event: 'cache_hit', key });
        return {
          // A cache hit preserves the degradation state it was STORED with: a
          // partial answer stays partial no matter how many times it is served.
          ...entry.result,
          degraded: entry.result.degraded === true,
          degraded_stages: Array.isArray(entry.result.degraded_stages) ? entry.result.degraded_stages.slice() : [],
          cache_hit: true,
          latency_ms: clock() - t0,
        };
      }
      telemetry.record({ event: 'cache_constraint_miss', key, violations: check.violations.join(',') });
    }

    // Stages that failed on THIS call. Empty ⇒ the result is complete.
    const degradedStages = [];
    let degradedError = null;

    // ---- seed (fail-open) ----
    let seeds = [];
    try {
      seeds = (await seedFn({ query: req.query, limit: 8, domain: req.domain, served_identity: req.served_identity })) || [];
    } catch (err) {
      const cause = classifyCause(err);
      const stages = [DEGRADED_STAGES.SEED];
      let outcome = DEGRADED_OUTCOMES.SEED_REJECTED;
      if (cause === 'availability' || cause === 'timeout') {
        stages.push(DEGRADED_STAGES.BACKEND_UNAVAILABLE);
        // CONFIGURED-but-unreachable is not the same thing as not configured.
        outcome = backend.configured
          ? DEGRADED_OUTCOMES.BACKEND_CONFIGURED_UNAVAILABLE
          : DEGRADED_OUTCOMES.BACKEND_NOT_CONFIGURED;
      }
      telemetry.record({ event: 'fail_open', stage: 'seed', cause });
      // Not cached: a transport fault must not pin an empty answer for the TTL.
      return empty({ degraded: true, degraded_stages: stages, error: outcome, error_cause: cause });
    }

    // ---- maturity + domain gate ----
    seeds = seeds.filter((c) => {
      const r = MATURITY_RANK[c.maturity];
      // Unknown maturity (e.g. knowledge pages / stubs) is NOT gated out — only
      // explicitly-low-maturity classes are dropped.
      const matureEnough = r === undefined ? true : r >= minRank;
      const domainOk = !req.domain || c.domain === req.domain;
      return matureEnough && domainOk;
    });

    if (!seeds.length) {
      const out = empty();
      cache.set(key, { result: out, constraints });
      return out;
    }

    // ---- expand (fail-open, but NEVER silently) ----
    let expandTriples = [];
    if (req.mode === 'expand' && req.depth > 0) {
      try {
        expandTriples = (await expandFn({
          seedIris: seeds.map((s) => s.iri),
          depth: Math.min(req.depth, cfg.depth),
          provenance: req.provenance,
          served_identity: req.served_identity,
        })) || [];
      } catch (err) {
        if (err && err.error === 'loom_identity_mismatch') {
          return empty({ degraded: true, degraded_stages: ['generation'], error: 'loom_identity_rejected' });
        }
        const cause = classifyCause(err);
        telemetry.record({ event: 'fail_open', stage: 'expand', cause });
        // Degrade to menu rather than failing the whole call — but SAY SO, and
        // say which stage. `degraded: false` here was the reproduced defect.
        degradedStages.push(DEGRADED_STAGES.EXPANSION);
        if (err && err.stage === 'sparql') degradedStages.push(DEGRADED_STAGES.SPARQL);
        if (cause === 'availability' || cause === 'timeout') {
          degradedStages.push(DEGRADED_STAGES.BACKEND_UNAVAILABLE);
        }
        degradedError = DEGRADED_OUTCOMES.EXPANSION_UNAVAILABLE;
        expandTriples = [];
      }
    }

    // ---- serialise + clamp ----
    const turtle = serialiseTurtle(seeds, expandTriples);
    const clamped = budget.clampToBudget(turtle, req.model_tier, req.max_tokens);
    const out = {
      turtle: clamped.text,
      breadcrumb: breadcrumb(seeds),
      seed_iris: seeds.map((s) => s.iri),
      tokens_used: clamped.tokens,
      truncated: clamped.truncated,
      provenance: req.provenance,
      cache_hit: false,
      degraded: degradedStages.length > 0,
      degraded_stages: degradedStages,
      full_denied: fullDenied,
      domain: req.domain,
      budget: req.budget,
      backend: backend.name,
      backend_configured: backend.configured,
      generation: req.generation,
      latency_ms: clock() - t0,
    };
    if (degradedError) out.error = degradedError;
    cache.set(key, { result: out, constraints });
    telemetry.record({
      event: 'ask', tier: req.model_tier, mode: req.mode,
      seeds: seeds.length, tokens: clamped.tokens, truncated: clamped.truncated,
    });
    return out;
  }

  /** Observable liveness/counter surface (ADR-119). null if the sink lacks one. */
  function getTelemetrySnapshot() {
    return typeof telemetry.snapshot === 'function' ? telemetry.snapshot() : null;
  }

  /** The backend descriptor this brain resolves through (name/url/configured). */
  function getBackend() { return { ...backend }; }

  return { ask, _cache: cache, getTelemetrySnapshot, getBackend };
}

// ── Default transport + wiring (so any process gets one identical brain) ─────
const DEFAULT_API = 'http://visionclaw-server:4000';

/**
 * Resolve WHICH backend answers, and why. Three distinct situations that the
 * pre-2026-09-05 code collapsed into one boolean:
 *
 *  1. LOOM_FACADE_URL set, no injected vcFetch → the Loom answers. If it is
 *     then unreachable that is `backend_configured_but_unavailable` — an
 *     operational fault, NOT a fallback.
 *  2. LOOM_FACADE_URL unset → VisionClaw is selected by design. Ordinary path.
 *  3. An explicitly injected vcFetch overrides a set Loom URL (tests, pinning).
 *
 * @returns {{name:string,url:string|null,configured:boolean,generation:string|null,reason:string}}
 */
function selectBackend(opts = {}, env = process.env) {
  const loomUrl = String(opts.loomUrl || env.LOOM_FACADE_URL || '').trim();
  const vcUrl = String(opts.apiUrl || env.VISIONCLAW_API_URL || DEFAULT_API).trim();
  const generation = opts.generation != null
    ? String(opts.generation)
    : (env.LOOM_GENERATION || env.ONTOLOGY_GENERATION || null);
  if (loomUrl && !opts.vcFetch) {
    return {
      name: BACKENDS.LOOM, url: loomUrl, configured: true,
      generation, reason: BACKEND_REASONS.LOOM_URL_SET,
    };
  }
  if (!vcUrl) {
    return {
      name: BACKENDS.NONE, url: null, configured: false,
      generation, reason: BACKEND_REASONS.NOT_CONFIGURED,
    };
  }
  return {
    name: BACKENDS.VISIONCLAW, url: vcUrl, configured: true, generation,
    reason: loomUrl ? BACKEND_REASONS.VC_FETCH_INJECTED : BACKEND_REASONS.LOOM_URL_UNSET,
  };
}

/** Build a vcFetch bound to env/config. `authed:true` attaches power_user headers. */
function makeVcFetch(opts = {}) {
  const base = (opts.apiUrl || process.env.VISIONCLAW_API_URL || DEFAULT_API).replace(/\/$/, '');
  const token = opts.devToken != null ? opts.devToken : (process.env.VISIONCLAW_DEV_TOKEN || '');
  const pk = opts.pubkey != null ? opts.pubkey : (process.env.AGENTBOX_PUBKEY || '');
  const timeoutMs = opts.timeoutMs || parseInt(process.env.ONTOLOGY_TIMEOUT_MS || '10000', 10);
  const doFetch = opts.fetchImpl || globalThis.fetch;
  return async function vcFetch(path, { method = 'GET', body, authed = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    if (authed && token) headers['Authorization'] = `Bearer ${token}`;
    if (authed && pk) headers['X-Nostr-Pubkey'] = pk;
    try {
      const res = await doFetch(base + path, { method, headers, body, signal: controller.signal });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return { error: `visionclaw_http_${res.status}`, message: t || res.statusText };
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'ontology_timeout', message: `no response in ${timeoutMs}ms` };
      return { error: 'ontology_unavailable', message: err.message };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Seed via VisionClaw's anonymous, purpose-built agent discover surface. */
function defaultSeedFn(vcFetch) {
  return async function ({ query, limit, domain }) {
    const res = await vcFetch('/api/ontology-agent/discover', {
      method: 'POST', body: JSON.stringify({ query, limit: limit ?? 8, domain }),
    });
    if (res && res.error) throw res;
    // VisionClaw wraps responses in {success, data:{…}, error, timestamp}.
    const body = (res && res.data !== undefined) ? res.data : res;
    const rows = Array.isArray(body) ? body : (body && body.results) || [];
    return rows.map((r) => ({
      iri: r.iri,
      label: r.preferred_term || r.label,
      domain: r.domain || r.source_domain,
      maturity: r.maturity,
      summary: r.definition_summary || r.summary,
      relations: r.relationships || r.relations,
      score: r.relevance_score,
    })).filter((r) => r.iri);
  };
}

/** Expand via authed read-only SPARQL k-hop (client LIMIT until WS-0 server clamp). */
function defaultExpandFn(vcFetch) {
  return async function ({ seedIris, depth, provenance }) {
    if (!seedIris || !seedIris.length) return [];
    const graph = provenance === 'inferred'
      ? 'urn:ngm:graph:ontology:inferred' : 'urn:ngm:graph:ontology:assert';
    const values = seedIris.slice(0, 8).map((i) => `<${i}>`).join(' ');
    const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
    // Two queries, run in parallel and merged children-first. The asserted graph
    // only stores `child subClassOf parent`, so a seed's subclasses are INCOMING
    // edges; a purely-outgoing expand missed them (measured gap, eval 2026-06-14 —
    // subclass questions). A single UNION under one LIMIT lets dense domain hubs
    // starve the few child rows, so children get their own dedicated query and are
    // placed first so the budget clamp can never trim them out of the tail. Makes
    // expand hierarchy-complete for every consumer (MCP tool, seam, CLI) — ADR-112.
    // NB: full IRIs only, no PREFIX block — the read-only SPARQL guard (WS-0) rejects
    // any query whose first token is PREFIX, so both queries must start with SELECT.
    const outLimit = Math.min(80 * Math.max(1, depth), 300);
    const outSparql = `SELECT ?s ?p ?o WHERE { GRAPH <${graph}> { VALUES ?s { ${values} } ?s ?p ?o . } } LIMIT ${outLimit}`;
    // Children only for the TOP seed(s): a "subclasses of X" question targets the best
    // match, and spanning all 8 seeds lets dense domain hubs (ai-domain, computation-…)
    // fill the LIMIT before the target's children appear (measured 2026-06-14).
    const childValues = seedIris.slice(0, 2).map((i) => `<${i}>`).join(' ');
    const childSparql = `SELECT ?s ?o WHERE { GRAPH <${graph}> { VALUES ?o { ${childValues} } ?s <${SUBCLASS}> ?o . } } LIMIT 60`;
    const run = async (q) => {
      const res = await vcFetch('/api/ontology/sparql', { method: 'POST', authed: true, body: JSON.stringify({ query: q }) });
      // Tag the sub-stage so the caller's degraded_stages can name `sparql`
      // specifically, not just "expansion failed somewhere".
      if (res && res.error) throw Object.assign(new Error(res.message || res.error), { error: res.error, stage: 'sparql' });
      const body = (res && res.data !== undefined) ? res.data : res;
      return (body && body.results && body.results.bindings) || [];
    };
    // Sequential, not Promise.all: two concurrent SPARQL reads against Oxigraph
    // intermittently returned the child query empty under load (measured 2026-06-14).
    // Children first so they're fetched even if the larger outgoing query is slow.
    const childB = await run(childSparql);
    const outB = await run(outSparql);
    const uri = (x) => (x ? (x.type === 'uri' ? `<${x.value}>` : JSON.stringify(x.value)) : '?');
    const children = childB.map((b) => ({ s: `<${b.s.value}>`, p: `<${SUBCLASS}>`, o: `<${b.o.value}>` }));
    const outgoing = outB.map((b) => ({ s: uri(b.s), p: uri(b.p), o: uri(b.o) }));
    return [...children, ...outgoing]; // children first — survive the downstream clamp
  };
}

// ── Loom transport (ADR-051 D1: the one-brain resolves through the Loom) ──────
// When LOOM_FACADE_URL is set, seed + expand resolve through the Loom's read-truth
// graph (pyoxigraph over the reasoned generation) instead of VisionClaw. The Loom
// holds asserted + inferred in one store, so expand needs no named-graph clause.
// Falls back to VisionClaw transparently when LOOM_FACADE_URL is unset.

function makeLoomFetch(opts = {}) {
  const base = (opts.loomUrl || process.env.LOOM_FACADE_URL || '').replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs || parseInt(process.env.ONTOLOGY_TIMEOUT_MS || '10000', 10);
  const doFetch = opts.fetchImpl || globalThis.fetch;
  return async function loomFetch(path, { body, method = 'POST' } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(base + path, {
        method, headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return { error: `loom_http_${res.status}`, message: t || res.statusText };
      }
      const payload = await res.json();
      if (path === '/loom/search' || path === '/loom/sparql') {
        // Rust label search returns an array; legacy Python returns {hits}.
        const result = Array.isArray(payload)
          ? { [path === '/loom/search' ? 'hits' : 'rows']: payload } : payload;
        return { ...result, serving_identity: {
          generation: { id: res.headers.get('x-loom-generation') },
          content_digest: res.headers.get('x-loom-content-digest'),
          atomicity_verified: res.headers.get('x-loom-atomicity-verified') === 'true',
        } };
      }
      return payload;
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'ontology_timeout', message: `no response in ${timeoutMs}ms` };
      return { error: 'ontology_unavailable', message: err.message };
    } finally {
      clearTimeout(timer);
    }
  };
}

const _SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const _wrapTerm = (v) => (v == null ? '?' : (/^(https?:|urn:|did:)/.test(String(v)) ? `<${v}>` : JSON.stringify(v)));

/** Reject a different loaded bundle, including behind a mixed-generation proxy. */
function checkLoomIdentity(response, expected) {
  if (!expected) return; // direct transport helpers remain injectable
  const got = response && response.serving_identity;
  if (!got || got.content_digest !== expected.content_digest
      || got.generation?.id !== expected.generation?.id || got.atomicity_verified !== true) {
    throw { error: 'loom_identity_mismatch', message: 'retrieval response belongs to another bundle' };
  }
}

function loomGenerationVerifier(loomFetch) {
  return async (expectedGeneration) => {
    const report = await loomFetch('/loom/generation', { method: 'GET' });
    const identity = report?.identity;
    const embedding = report?.embedding;
    if (report?.error || !identity || !identity.generation?.id
        || !/^[0-9a-f]{64}$/.test(identity.content_digest || '')
        || identity.atomicity_verified !== true || report.drift?.checked !== true
        || report.drift?.ok !== true || report.disk?.matches_loaded !== true
        || report.id !== identity.generation.id
        || report.semantic_generation?.id !== report.id
        || embedding?.model_id !== 'bge-small-en-v1.5' || embedding.dimensions !== 384
        || embedding.metric !== 'cosine'
        || !Array.isArray(embedding.rejections) || embedding.rejections.length
        || (expectedGeneration && expectedGeneration !== report.id)) {
      throw new Error('Loom generation/model/corpus identity rejected');
    }
    const cacheGeneration = createHash('sha256').update(JSON.stringify([
      identity.generation.id, identity.content_digest, embedding.model_id, embedding.dimensions,
    ])).digest('hex');
    return { identity, cacheGeneration };
  };
}

/** Seed via the Loom's label/title search over the whole reasoned graph. */
function loomSeedFn(loomFetch) {
  return async function ({ query, limit, served_identity }) {
    const res = await loomFetch('/loom/search', { body: JSON.stringify({ q: query, limit: limit ?? 8 }) });
    if (res && res.error) throw res;
    checkLoomIdentity(res, served_identity);
    const hits = (res && res.hits) || [];
    return hits.map((h, i) => ({ iri: h.iri, label: h.label, score: 1 - i * 0.01 })).filter((h) => h.iri);
  };
}

/** Expand via the Loom's clamped SPARQL (children-first, hierarchy-complete — ADR-112). */
function loomExpandFn(loomFetch) {
  return async function ({ seedIris, depth, served_identity }) {
    if (!seedIris || !seedIris.length) return [];
    const values = seedIris.slice(0, 8).map((i) => `<${i}>`).join(' ');
    const outLimit = Math.min(80 * Math.max(1, depth || 1), 300);
    // Loom store merges assert+inferred into one graph — no GRAPH clause needed.
    const outSparql = `SELECT ?s ?p ?o WHERE { VALUES ?s { ${values} } ?s ?p ?o . } LIMIT ${outLimit}`;
    const childValues = seedIris.slice(0, 2).map((i) => `<${i}>`).join(' ');
    const childSparql = `SELECT ?s ?o WHERE { VALUES ?o { ${childValues} } ?s <${_SUBCLASS}> ?o . } LIMIT 60`;
    const run = async (q) => {
      const res = await loomFetch('/loom/sparql', { body: JSON.stringify({ query: q }) });
      // Sub-stage tag — see defaultExpandFn.
      if (res && res.error) throw Object.assign(new Error(res.message || res.error), { error: res.error, stage: 'sparql' });
      checkLoomIdentity(res, served_identity);
      return (res && res.rows) || [];
    };
    // Children first so the downstream budget clamp never trims them (ADR-112).
    const childR = await run(childSparql);
    const outR = await run(outSparql);
    const children = childR.map((r) => ({ s: `<${r.s}>`, p: `<${_SUBCLASS}>`, o: `<${r.o}>` }));
    const outgoing = outR.map((r) => ({ s: _wrapTerm(r.s), p: _wrapTerm(r.p), o: _wrapTerm(r.o) }));
    return [...children, ...outgoing];
  };
}

/**
 * The production brain, wired with default transport. Every process (bridge,
 * consultant seam, hook) calls this to obtain ONE identical brain — the
 * "shared library, not a service" realisation of ADR-112.
 *
 * ADR-051 D1: when LOOM_FACADE_URL is set the brain grounds through the Loom's
 * read-truth graph; otherwise it resolves through VisionClaw (unchanged).
 */
function createDefaultRetrieval(opts = {}) {
  const backend = selectBackend(opts, opts.env || process.env);
  if (backend.name === BACKENDS.LOOM) {
    const loomFetch = opts.loomFetch || makeLoomFetch({ ...opts, loomUrl: backend.url });
    const telemetry = opts.telemetry || createTelemetrySink({ clock: opts.clock, filePath: opts.telemetryPath });
    if (typeof telemetry.canary === 'function') telemetry.canary();
    return createOntologyRetrieval({
      verifyGeneration: loomGenerationVerifier(loomFetch),
      seedFn: loomSeedFn(loomFetch),
      expandFn: loomExpandFn(loomFetch),
      cache: opts.cache, clock: opts.clock, minMaturity: opts.minMaturity, telemetry, backend,
    });
  }
  const vcFetch = opts.vcFetch || makeVcFetch(opts);
  // Real default liveness sink (ADR-119) — never the old no-op. Run the startup
  // canary NOW so the writable-sink verdict is observable at boot; loud on
  // failure but fail-open (never blocks retrieval — ADR-112 / PRD-020).
  const telemetry = opts.telemetry || createTelemetrySink({
    clock: opts.clock,
    filePath: opts.telemetryPath,
  });
  if (typeof telemetry.canary === 'function') telemetry.canary();
  return createOntologyRetrieval({
    seedFn: defaultSeedFn(vcFetch),
    expandFn: defaultExpandFn(vcFetch),
    cache: opts.cache,
    clock: opts.clock,
    minMaturity: opts.minMaturity,
    telemetry,
    backend,
  });
}

/** Split availability errors from auth/validation errors (anti fail-silent-wrong). */
function classifyCause(err) {
  const m = String((err && (err.error || err.message)) || err || '');
  if (/_40[013]|unauthor|forbidden|invalid|validation|readonly/i.test(m)) return 'auth_or_validation';
  if (/timeout|abort/i.test(m)) return 'timeout';
  return 'availability';
}

module.exports = {
  createOntologyRetrieval,
  createDefaultRetrieval,
  createTelemetrySink,
  makeVcFetch,
  defaultSeedFn,
  defaultExpandFn,
  makeLoomFetch,
  loomSeedFn,
  loomGenerationVerifier,
  checkLoomIdentity,
  loomExpandFn,
  createTtlCache,
  serialiseTurtle,
  breadcrumb,
  cacheKey,
  cacheEntrySatisfies,
  normaliseCacheEntry,
  classifyCause,
  selectBackend,
  normaliseBackend,
  CACHE_KEY_FIELDS,
  DEGRADED_STAGES,
  DEGRADED_OUTCOMES,
  BACKENDS,
  BACKEND_REASONS,
  VC_PREFIXES,
  MATURITY_RANK,
};
