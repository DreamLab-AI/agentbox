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

const VC_PREFIXES = [
  'PREFIX vc: <https://narrativegoldmine.com/ns/v1#>',
  'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  'PREFIX owl: <http://www.w3.org/2002/07/owl#>',
].join('\n');

const MATURITY_RANK = Object.freeze({
  draft: 0, developing: 1, emerging: 2, growing: 3, established: 4, mature: 5,
});

/** Stable, allocation-light cache key (FNV-1a over the request shape). */
function cacheKey(req) {
  const s = [req.query, req.model_tier, req.depth, req.mode, req.provenance, req.full].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'ont:' + h.toString(16);
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
 *   telemetry    optional { record(event) }
 */
function createOntologyRetrieval(deps = {}) {
  const seedFn = deps.seedFn || (async () => []);
  const expandFn = deps.expandFn || (async () => []);
  const cache = deps.cache || createTtlCache({ clock: deps.clock });
  const clock = deps.clock || (() => Date.now());
  const minRank = MATURITY_RANK[deps.minMaturity || 'established'] ?? 4;
  const telemetry = deps.telemetry || { record() {} };

  async function ask(rawReq = {}) {
    const t0 = clock();
    const req = {
      query: String(rawReq.query || ''),
      model_tier: rawReq.model_tier || budget.DEFAULT_TIER,
      max_tokens: rawReq.max_tokens,
      mode: rawReq.mode,
      provenance: rawReq.provenance || 'asserted',
      full: rawReq.full === true,
      depth: rawReq.depth,
    };
    const cfg = budget.tierConfig(req.model_tier);
    if (req.mode == null) req.mode = cfg.mode;
    if (req.depth == null) req.depth = cfg.depth;

    // HARD: full:true forbidden below sonnet (ADR-116). Downgrade, never reject the call.
    let fullDenied = false;
    if (req.full && !budget.isFullAllowed(req.model_tier)) {
      req.full = false; fullDenied = true;
    }

    const empty = (extra) => ({
      turtle: '', breadcrumb: null, seed_iris: [], tokens_used: 0,
      truncated: false, provenance: req.provenance, cache_hit: false,
      degraded: false, full_denied: fullDenied, latency_ms: clock() - t0,
      ...extra,
    });

    if (!req.query.trim()) return empty();

    const key = cacheKey(req);
    const cached = cache.get(key);
    if (cached) {
      telemetry.record({ event: 'cache_hit', key });
      return { ...cached, cache_hit: true, latency_ms: clock() - t0 };
    }

    // ---- seed (fail-open) ----
    let seeds = [];
    try {
      seeds = (await seedFn({ query: req.query, limit: 8, domain: rawReq.domain })) || [];
    } catch (err) {
      telemetry.record({ event: 'fail_open', stage: 'seed', cause: classifyCause(err) });
      return empty({ degraded: true, error: 'seed_unavailable' });
    }

    // ---- maturity + domain gate ----
    seeds = seeds.filter((c) => {
      const r = MATURITY_RANK[c.maturity];
      // Unknown maturity (e.g. knowledge pages / stubs) is NOT gated out — only
      // explicitly-low-maturity classes are dropped.
      const matureEnough = r === undefined ? true : r >= minRank;
      const domainOk = !rawReq.domain || c.domain === rawReq.domain;
      return matureEnough && domainOk;
    });

    if (!seeds.length) {
      const out = empty();
      cache.set(key, out);
      return out;
    }

    // ---- expand (fail-open) ----
    let expandTriples = [];
    if (req.mode === 'expand' && req.depth > 0) {
      try {
        expandTriples = (await expandFn({
          seedIris: seeds.map((s) => s.iri),
          depth: Math.min(req.depth, cfg.depth),
          provenance: req.provenance,
        })) || [];
      } catch (err) {
        telemetry.record({ event: 'fail_open', stage: 'expand', cause: classifyCause(err) });
        // Degrade to menu rather than failing the whole call.
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
      degraded: false,
      full_denied: fullDenied,
      latency_ms: clock() - t0,
    };
    cache.set(key, out);
    telemetry.record({
      event: 'ask', tier: req.model_tier, mode: req.mode,
      seeds: seeds.length, tokens: clamped.tokens, truncated: clamped.truncated,
    });
    return out;
  }

  return { ask, _cache: cache };
}

// ── Default transport + wiring (so any process gets one identical brain) ─────
const DEFAULT_API = 'http://visionclaw-server:4000';

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
    const sparql = `${VC_PREFIXES}
SELECT ?s ?p ?o WHERE {
  GRAPH <${graph}> { VALUES ?s { ${values} } ?s ?p ?o . }
} LIMIT ${Math.min(50 * Math.max(1, depth), 200)}`;
    const res = await vcFetch('/api/ontology/sparql', {
      method: 'POST', authed: true, body: JSON.stringify({ query: sparql }),
    });
    if (res && res.error) throw res;
    const body = (res && res.data !== undefined) ? res.data : res;
    const bindings = (body && body.results && body.results.bindings) || [];
    return bindings.map((b) => ({
      s: b.s ? `<${b.s.value}>` : '?s',
      p: b.p ? `<${b.p.value}>` : '?p',
      o: b.o ? (b.o.type === 'uri' ? `<${b.o.value}>` : JSON.stringify(b.o.value)) : '?o',
    }));
  };
}

/**
 * The production brain, wired with default transport. Every process (bridge,
 * consultant seam, hook) calls this to obtain ONE identical brain — the
 * "shared library, not a service" realisation of ADR-112.
 */
function createDefaultRetrieval(opts = {}) {
  const vcFetch = opts.vcFetch || makeVcFetch(opts);
  return createOntologyRetrieval({
    seedFn: defaultSeedFn(vcFetch),
    expandFn: defaultExpandFn(vcFetch),
    cache: opts.cache,
    clock: opts.clock,
    minMaturity: opts.minMaturity,
    telemetry: opts.telemetry,
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
  makeVcFetch,
  defaultSeedFn,
  defaultExpandFn,
  createTtlCache,
  serialiseTurtle,
  breadcrumb,
  cacheKey,
  classifyCause,
  VC_PREFIXES,
  MATURITY_RANK,
};
