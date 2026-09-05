// ontology-retrieval-cache.test.mjs — ADR-2023 acceptance fixtures for the Loom
// façade client: cache-key completeness, stage-specific degradation, and the
// named configured-but-unavailable backend outcome.
//
// Hermetic: no live Loom, no live VisionClaw, no provider. Every transport is an
// injected fake through the existing seedFn/expandFn/cache/clock dependency
// shape, so these run anywhere.
//
// Run: node --test tests/integration/ontology-retrieval-cache.test.mjs
//
// Required fixtures (ADR-2023 closeout acceptance):
//   backend-selection · cache-hit preserving constraints · low budget after a
//   high-budget hit · domain change with identical other fields · expansion
//   failure → degraded:true with the stage named · two-generation activation ·
//   configured-but-unavailable Loom.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ret = require('../../mcp/servers/lib/ontology-retrieval.js');
const {
  createOntologyRetrieval,
  createTtlCache,
  cacheKey,
  cacheEntrySatisfies,
  selectBackend,
  CACHE_KEY_FIELDS,
  DEGRADED_STAGES,
  DEGRADED_OUTCOMES,
  BACKENDS,
  BACKEND_REASONS,
} = ret;

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A no-op telemetry sink: these tests assert the RESULT contract, not the JSONL. */
const silentTelemetry = { record() {}, snapshot() { return null; } };

/** Verbose enough that a single seed comfortably exceeds a 50-token budget. */
function seedsFor(domain, n = 6) {
  return Array.from({ length: n }, (_, i) => ({
    iri: `urn:ngm:class:${domain}-${i}`,
    label: `${domain} class ${i} with a deliberately verbose label to inflate the serialised size`,
    domain,
    maturity: 'mature',
    summary: 'z'.repeat(300),
    relations: ['enables', 'requires'],
  }));
}

/**
 * The transport the 2026-09-04 estate review probed: a seed backend that IGNORES
 * the requested domain and always answers with AI classes. It is the honest
 * worst case — the client, not the backend, has to honour the constraint.
 */
function ignoringSeedFn(counter) {
  return async () => { counter.n += 1; return seedsFor('artificial-intelligence'); };
}

function brain(extra = {}) {
  return createOntologyRetrieval({ telemetry: silentTelemetry, ...extra });
}

// ── 1. backend selection ─────────────────────────────────────────────────────

test('backend-selection: LOOM_FACADE_URL set → the Loom answers and says so', () => {
  const b = selectBackend({}, { LOOM_FACADE_URL: 'http://loom:8080', LOOM_GENERATION: 'bundle-7' });
  assert.equal(b.name, BACKENDS.LOOM);
  assert.equal(b.url, 'http://loom:8080');
  assert.equal(b.configured, true);
  assert.equal(b.generation, 'bundle-7');
  assert.equal(b.reason, BACKEND_REASONS.LOOM_URL_SET);
});

test('backend-selection: LOOM_FACADE_URL unset → VisionClaw by design, not a fault', () => {
  const b = selectBackend({}, { VISIONCLAW_API_URL: 'http://vc:4000' });
  assert.equal(b.name, BACKENDS.VISIONCLAW);
  assert.equal(b.configured, true);
  assert.equal(b.reason, BACKEND_REASONS.LOOM_URL_UNSET);
});

test('backend-selection: an injected vcFetch overrides a set Loom URL, visibly', () => {
  const b = selectBackend({ vcFetch: async () => ({}) }, { LOOM_FACADE_URL: 'http://loom:8080' });
  assert.equal(b.name, BACKENDS.VISIONCLAW);
  assert.equal(b.reason, BACKEND_REASONS.VC_FETCH_INJECTED);
});

test('backend-selection: the selected backend is carried on every result', async () => {
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation: 'bundle-7' },
  });
  const out = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet' });
  assert.equal(out.backend, BACKENDS.LOOM);
  assert.equal(out.backend_configured, true);
  assert.equal(out.generation, 'bundle-7');
  assert.deepEqual(r.getBackend().url, 'http://loom:8080');
});

// ── 2. cache key completeness ────────────────────────────────────────────────

test('cache key: EVERY enumerated constraint changes the key (an omission is a bug)', () => {
  const base = {
    query: 'q', model_tier: 'sonnet', mode: 'expand', depth: 1, provenance: 'asserted',
    full: false, domain: 'artificial-intelligence', max_tokens: 1000, budget: 1000,
    min_maturity: 'established', backend: 'loom', generation: 'gen-1',
  };
  // Guard against a field being added to ask() but forgotten in the fixture.
  assert.deepEqual(Object.keys(base).sort(), [...CACHE_KEY_FIELDS].sort());

  const k0 = cacheKey(base);
  const mutated = {
    query: 'other', model_tier: 'opus', mode: 'menu', depth: 2, provenance: 'inferred',
    full: true, domain: 'robotics', max_tokens: 50, budget: 50,
    min_maturity: 'mature', backend: 'visionclaw', generation: 'gen-2',
  };
  for (const f of CACHE_KEY_FIELDS) {
    assert.notEqual(cacheKey({ ...base, [f]: mutated[f] }), k0, `changing '${f}' must change the key`);
  }
});

test('cache key: absent, null and empty collapse to one sentinel (no aliasing)', () => {
  const a = cacheKey({ query: 'q', domain: null });
  const b = cacheKey({ query: 'q', domain: undefined });
  const c = cacheKey({ query: 'q', domain: '' });
  assert.equal(a, b);
  assert.equal(b, c);
  assert.notEqual(a, cacheKey({ query: 'q', domain: 'robotics' }));
});

// ── 3. cache hit preserves the constraints it was stored with ────────────────

test('cache-hit: identical request is served from cache with its constraints intact', async () => {
  const counter = { n: 0 };
  const r = brain({
    seedFn: async () => { counter.n += 1; return seedsFor('robotics'); },
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation: 'gen-1' },
  });
  const req = { query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics', max_tokens: 900 };
  const first = await r.ask({ ...req });
  const second = await r.ask({ ...req });

  assert.equal(counter.n, 1, 'second call served from cache');
  assert.equal(second.cache_hit, true);
  assert.equal(second.domain, 'robotics');
  assert.equal(second.budget, 900);
  assert.equal(second.backend, BACKENDS.LOOM);
  assert.equal(second.generation, 'gen-1');
  assert.equal(second.turtle, first.turtle);
  assert.ok(second.tokens_used <= 900, 'served body still inside the stored budget');
});

test('cache-hit: a stored PARTIAL result stays partial when replayed', async () => {
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    expandFn: async () => { throw Object.assign(new Error('sparql 500'), { error: 'loom_http_500', stage: 'sparql' }); },
  });
  const req = { query: 'arm kinematics', model_tier: 'sonnet', mode: 'expand', domain: 'robotics' };
  const first = await r.ask({ ...req });
  const second = await r.ask({ ...req });

  assert.equal(first.degraded, true);
  assert.equal(second.cache_hit, true);
  assert.equal(second.degraded, true, 'degradation survives the cache');
  assert.deepEqual(second.degraded_stages, first.degraded_stages);
  assert.equal(second.error, DEGRADED_OUTCOMES.EXPANSION_UNAVAILABLE);
});

test('cache-hit: a stale-constraint entry is MISSED, never truncated into shape', () => {
  const entry = {
    result: { tokens_used: 830, domain: 'artificial-intelligence' },
    constraints: { domain: 'artificial-intelligence', budget: 1000, backend: 'loom', generation: 'gen-1' },
  };
  const overBudget = cacheEntrySatisfies(entry, { domain: 'artificial-intelligence', budget: 50, backend: 'loom', generation: 'gen-1' });
  assert.equal(overBudget.ok, false);
  assert.ok(overBudget.violations.includes('budget'));

  const wrongDomain = cacheEntrySatisfies(entry, { domain: 'robotics', budget: 1000, backend: 'loom', generation: 'gen-1' });
  assert.equal(wrongDomain.ok, false);
  assert.ok(wrongDomain.violations.includes('domain'));

  const ok = cacheEntrySatisfies(entry, { domain: 'artificial-intelligence', budget: 1000, backend: 'loom', generation: 'gen-1' });
  assert.equal(ok.ok, true);
});

// ── 4. the reproduced defect: low budget after a high-budget hit ─────────────

test('low-budget: a 50-token cap after an 830-token hit for the SAME domain re-retrieves and clamps', async () => {
  const counter = { n: 0 };
  const r = brain({
    seedFn: ignoringSeedFn(counter),
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation: 'gen-1' },
  });
  const big = await r.ask({ query: 'what is an agent', model_tier: 'sonnet', domain: 'artificial-intelligence', max_tokens: 1000 });
  assert.ok(big.tokens_used > 300, `high-budget answer is substantial (${big.tokens_used} tok)`);
  assert.equal(big.cache_hit, false);

  const small = await r.ask({ query: 'what is an agent', model_tier: 'sonnet', domain: 'artificial-intelligence', max_tokens: 50 });
  assert.equal(small.cache_hit, false, 'the tighter budget is a different request, not a cache hit');
  assert.equal(counter.n, 2, 'the backend was consulted again');
  assert.ok(small.tokens_used <= 50, `clamped to the 50-token cap (got ${small.tokens_used})`);
  assert.equal(small.budget, 50);
  assert.equal(small.truncated, true);
});

// ── 5. domain change with identical other fields ────────────────────────────

test('domain-change: a robotics request never inherits the cached AI answer', async () => {
  const counter = { n: 0 };
  const r = brain({
    seedFn: ignoringSeedFn(counter), // backend ignores the domain — the client must not
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation: 'gen-1' },
  });
  const ai = await r.ask({ query: 'what is an agent', model_tier: 'sonnet', domain: 'artificial-intelligence', max_tokens: 1000 });
  assert.ok(ai.seed_iris.length > 0);
  assert.ok(ai.seed_iris.every((i) => i.includes('artificial-intelligence')));

  const robotics = await r.ask({ query: 'what is an agent', model_tier: 'sonnet', domain: 'robotics', max_tokens: 50 });
  assert.equal(robotics.cache_hit, false, 'domain is part of the key');
  assert.equal(counter.n, 2);
  assert.equal(robotics.domain, 'robotics');
  assert.deepEqual(robotics.seed_iris, [], 'AI seeds are gated out of a robotics request');
  assert.ok(robotics.tokens_used <= 50);
  assert.notEqual(robotics.turtle, ai.turtle);
});

// ── 6. expansion failure → stage-specific degradation ───────────────────────

test('expansion-failure: degraded:true and the failing stage is named', async () => {
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    expandFn: async () => { throw Object.assign(new Error('read-only guard'), { error: 'sparql_readonly', stage: 'sparql' }); },
  });
  const out = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', mode: 'expand', domain: 'robotics' });

  assert.equal(out.degraded, true, 'a menu-only answer is a PARTIAL answer');
  assert.ok(out.seed_iris.length > 0, 'the menu still survives (fail-open)');
  assert.deepEqual(out.degraded_stages, [DEGRADED_STAGES.EXPANSION, DEGRADED_STAGES.SPARQL]);
  assert.equal(out.error, DEGRADED_OUTCOMES.EXPANSION_UNAVAILABLE);
});

test('expansion-failure: a transport fault also names backend-unavailable', async () => {
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    expandFn: async () => { throw { error: 'ontology_unavailable', message: 'ECONNREFUSED' }; },
  });
  const out = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', mode: 'expand', domain: 'robotics' });
  assert.deepEqual(out.degraded_stages, [DEGRADED_STAGES.EXPANSION, DEGRADED_STAGES.BACKEND_UNAVAILABLE]);
});

test('complete result: no failure ⇒ degraded:false and an empty stage list', async () => {
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    expandFn: async () => [{ s: '<urn:ngm:class:robotics-0>', p: '<p>', o: '<urn:ngm:class:robotics-1>' }],
  });
  const out = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', mode: 'expand', domain: 'robotics' });
  assert.equal(out.degraded, false);
  assert.deepEqual(out.degraded_stages, []);
  assert.equal(out.error, undefined);
});

// ── 7. two-generation activation ────────────────────────────────────────────

test('two-generation: the same query against two bundles yields two distinct entries', async () => {
  const shared = createTtlCache({ ttlMs: 60_000 });
  const calls = [];
  const mk = (generation) => brain({
    seedFn: async () => { calls.push(generation); return seedsFor('robotics'); },
    cache: shared,
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation },
  });
  const g1 = await mk('gen-1').ask({ query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics' });
  const g2 = await mk('gen-2').ask({ query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics' });

  assert.deepEqual(calls, ['gen-1', 'gen-2'], 'the second generation is retrieved, not replayed');
  assert.equal(g2.cache_hit, false);
  assert.equal(g1.generation, 'gen-1');
  assert.equal(g2.generation, 'gen-2');
  assert.equal(shared.size, 2, 'two cache entries for two generations');

  // …and a repeat within one generation still hits.
  const again = await mk('gen-1').ask({ query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics' });
  assert.equal(again.cache_hit, true);
  assert.equal(shared.size, 2);
});

test('two-generation: a per-request generation pin overrides the backend default', async () => {
  const shared = createTtlCache({ ttlMs: 60_000 });
  const r = brain({
    seedFn: async () => seedsFor('robotics'),
    cache: shared,
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true, generation: 'gen-1' },
  });
  const pinned = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', generation: 'gen-9' });
  assert.equal(pinned.generation, 'gen-9');
  const dflt = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet' });
  assert.equal(dflt.generation, 'gen-1');
  assert.equal(dflt.cache_hit, false);
  assert.equal(shared.size, 2);
});

// ── 8. configured-but-unavailable Loom ──────────────────────────────────────

test('configured-but-unavailable: a dead Loom is a NAMED outcome, not a quiet fallback', async () => {
  const r = brain({
    seedFn: async () => { throw { error: 'ontology_unavailable', message: 'connect ECONNREFUSED 192.168.2.132:8084' }; },
    backend: { name: BACKENDS.LOOM, url: 'http://192.168.2.132:8084', configured: true, generation: 'gen-1' },
  });
  const out = await r.ask({ query: 'what is an agent', model_tier: 'sonnet' });

  assert.equal(out.degraded, true);
  assert.equal(out.error, DEGRADED_OUTCOMES.BACKEND_CONFIGURED_UNAVAILABLE);
  assert.deepEqual(out.degraded_stages, [DEGRADED_STAGES.SEED, DEGRADED_STAGES.BACKEND_UNAVAILABLE]);
  assert.equal(out.backend, BACKENDS.LOOM);
  assert.equal(out.backend_configured, true);
  assert.equal(out.turtle, '');
});

test('configured-but-unavailable: a timeout is the same named outcome', async () => {
  const r = brain({
    seedFn: async () => { throw { error: 'ontology_timeout', message: 'no response in 10000ms' }; },
    backend: { name: BACKENDS.LOOM, url: 'http://192.168.2.132:8084', configured: true },
  });
  const out = await r.ask({ query: 'what is an agent' });
  assert.equal(out.error, DEGRADED_OUTCOMES.BACKEND_CONFIGURED_UNAVAILABLE);
  assert.equal(out.error_cause, 'timeout');
});

test('not-configured: no backend at all is a DIFFERENT named outcome', async () => {
  const r = brain({
    seedFn: async () => { throw { error: 'ontology_unavailable', message: 'no url' }; },
    backend: { name: BACKENDS.NONE, url: null, configured: false },
  });
  const out = await r.ask({ query: 'what is an agent' });
  assert.equal(out.error, DEGRADED_OUTCOMES.BACKEND_NOT_CONFIGURED);
  assert.equal(out.backend_configured, false);
  assert.notEqual(out.error, DEGRADED_OUTCOMES.BACKEND_CONFIGURED_UNAVAILABLE);
});

test('configured-but-unavailable: an auth rejection is NOT an availability fault', async () => {
  const r = brain({
    seedFn: async () => { throw { error: 'loom_http_401', message: 'unauthorized' }; },
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true },
  });
  const out = await r.ask({ query: 'what is an agent' });
  assert.equal(out.error, DEGRADED_OUTCOMES.SEED_REJECTED);
  assert.deepEqual(out.degraded_stages, [DEGRADED_STAGES.SEED]);
});

test('configured-but-unavailable: a transport fault is never cached', async () => {
  const shared = createTtlCache({ ttlMs: 60_000 });
  let fail = true;
  const r = brain({
    seedFn: async () => {
      if (fail) throw { error: 'ontology_unavailable', message: 'down' };
      return seedsFor('robotics');
    },
    cache: shared,
    backend: { name: BACKENDS.LOOM, url: 'http://loom:8080', configured: true },
  });
  const bad = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics' });
  assert.equal(bad.degraded, true);
  assert.equal(shared.size, 0, 'an outage must not pin an empty answer for the TTL');

  fail = false;
  const good = await r.ask({ query: 'arm kinematics', model_tier: 'sonnet', domain: 'robotics' });
  assert.equal(good.degraded, false);
  assert.ok(good.seed_iris.length > 0);
});
