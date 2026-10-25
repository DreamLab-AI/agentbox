// AB-24-S1-01 / AB-24-S1-02 — Jev option on the ontology retrieval brain. Mocked transport only.
//   node --test tests/system-one/jev-p1b-ontology-retrieval.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { require, mockFetch, ok, choice, noul, score, failureTransports, loadAtRev } from './helpers-jev-p1b.mjs'

const cur = require('../../mcp/servers/lib/ontology-retrieval.js')
const head = loadAtRev('mcp/servers/lib/ontology-retrieval.js')
const oj = require('../../mcp/servers/lib/ontology-jev.js')

const EP = { AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm' }
const BOTH = { ...EP, AGENTBOX_JEV_ONTOLOGY_RELEVANCE: '1', AGENTBOX_JEV_ONTOLOGY_RERANK: '1' }
const sink = () => {}
const SEEDS = [
  { iri: 'https://x/A', label: 'Alpha', domain: 'ai', maturity: 'mature', summary: 'about alpha' },
  { iri: 'https://x/B', label: 'Beta', domain: 'ai', maturity: 'mature', summary: 'about beta' },
  { iri: 'https://x/C', label: 'Gamma', domain: 'ai', maturity: 'mature', summary: 'about gamma' },
]
const TRIPLES = [{ s: '<https://x/A>', p: '<http://www.w3.org/2000/01/rdf-schema#subClassOf>', o: '<https://x/B>' }]
const telemetry = { record() {}, snapshot: () => null }
function brain(mod, jev, extra = {}) {
  return mod.createOntologyRetrieval({
    seedFn: async () => SEEDS.map((s) => ({ ...s })), expandFn: async () => TRIPLES.slice(),
    clock: () => 0, telemetry, jev, ...extra,
  })
}
const REQ = { query: 'what is alpha', model_tier: 'sonnet', mode: 'expand' }

// A response that ranks C > A > B with high confidence, and a given route.
const answers = (route = 'grounded', routeConf = 0.9) => ok({
  route: choice(route, { grounded: 0.05, mixed: 0.03, passthrough: 0.01, clarify: 0.01, [route]: routeConf }, routeConf),
  supports: noul(0.9),
  c0: score(1.2, 4), c1: score(0.4, 4), c2: score(2.8, 4),
})
const good = (route, conf) => mockFetch(() => answers(route, conf))

test('flags off: no evaluator exists and ask() equals the HEAD result exactly (incl. cache key)', async () => {
  const f = good()
  const jev = oj.fromEnv({ env: { ...EP }, fetchImpl: f, sink })
  assert.equal(jev, null)
  const a = await brain(cur, jev).ask(REQ)
  const b = await brain(head, undefined).ask(REQ)
  assert.deepStrictEqual(a, b)
  assert.ok(!('jev' in a))
  assert.equal(f.calls.length, 0)
  assert.equal(cur.cacheKey({ query: 'q', model_tier: 't' }), head.cacheKey({ query: 'q', model_tier: 't' }))
  assert.equal(cur.CACHE_KEY_FIELDS.join(), head.CACHE_KEY_FIELDS.join())
})

test('flag on but no endpoint: result equals HEAD, no request', async () => {
  const f = good()
  const jev = oj.fromEnv({ env: { AGENTBOX_JEV_ONTOLOGY_RERANK: '1' }, fetchImpl: f, sink })
  assert.deepStrictEqual(await brain(cur, jev).ask(REQ), await brain(head, undefined).ask(REQ))
  assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): result equals HEAD and is not cached under the Jev key`, async () => {
    const jev = oj.fromEnv({ env: BOTH, fetchImpl: f, sink })
    const sets = []
    const spy = { get: () => undefined, set: (k) => sets.push(k) }
    const b = brain(cur, jev, { cache: spy })
    assert.deepStrictEqual(await b.ask(REQ), await brain(head, undefined).ask(REQ))
    assert.deepEqual(sets, [], 'a failed evaluation must not pin a result in the cache')
  })
}

test('out-of-set route / missing score ⇒ HEAD result', async () => {
  const bad = mockFetch(() => ok({ route: choice('web', { web: 1 }, 0.9), supports: noul(0.9), c0: score(1, 4), c1: score(1, 4), c2: score(1, 4) }))
  const miss = mockFetch(() => ok({ route: choice('grounded', { grounded: 1 }, 0.9), supports: noul(0.9), c0: score(1, 4) }))
  for (const f of [bad, miss]) {
    const jev = oj.fromEnv({ env: BOTH, fetchImpl: f, sink })
    assert.deepStrictEqual(await brain(cur, jev).ask(REQ), await brain(head, undefined).ask(REQ))
  }
})

test('private candidate (public:false) ⇒ nothing is sent, HEAD result', async () => {
  const f = good()
  const jev = oj.fromEnv({ env: BOTH, fetchImpl: f, sink })
  const priv = cur.createOntologyRetrieval({ seedFn: async () => [{ ...SEEDS[0], public: false }, SEEDS[1]], expandFn: async () => [], clock: () => 0, telemetry, jev })
  const base = head.createOntologyRetrieval({ seedFn: async () => [{ ...SEEDS[0], public: false }, SEEDS[1]], expandFn: async () => [], clock: () => 0, telemetry })
  assert.deepStrictEqual(await priv.ask(REQ), await base.ask(REQ))
  assert.equal(f.calls.length, 0)
})

test('explicit scaffold=false always wins: no request even with both flags on', async () => {
  const f = good()
  const jev = oj.fromEnv({ env: BOTH, fetchImpl: f, sink })
  const a = await brain(cur, jev).ask({ ...REQ, scaffold: false })
  assert.deepStrictEqual(a, await brain(head, undefined).ask(REQ))
  assert.equal(f.calls.length, 0)
})

test('wire shape: one request; route Choice MAP incl. passthrough; supports Noul; one Score per candidate with an ordered list', async () => {
  const f = good()
  const jev = oj.fromEnv({ env: BOTH, fetchImpl: f, sink })
  await brain(cur, jev).ask(REQ)
  assert.equal(f.calls.length, 1)
  const { body, init } = f.calls[0]
  assert.equal(init.headers.Authorization, undefined)
  assert.deepEqual(Object.keys(body.questions), ['route', 'supports', 'c0', 'c1', 'c2'])
  assert.ok(!Array.isArray(body.questions.route.criteria))
  assert.deepEqual(Object.keys(body.questions.route.criteria), oj.ROUTES)
  assert.equal(body.questions.supports.type, 'noul')
  assert.ok(Array.isArray(body.questions.c0.criteria) && body.questions.c0.criteria.length === 4)
  assert.ok(body.questions.c1.instructions.includes('index 1 of `candidates`'))
  assert.equal(body.state.candidates.length, 3)
  assert.deepEqual(Object.keys(body.state.candidates[0]), ['label', 'domain', 'summary'])
})

test('shadow by default: annotated with a proposed order, NOT applied', async () => {
  const jev = oj.fromEnv({ env: BOTH, fetchImpl: good(), sink })
  const a = await brain(cur, jev).ask(REQ)
  const b = await brain(head, undefined).ask(REQ)
  assert.deepEqual(a.jev.rerank.proposed_order, [2, 0, 1])
  assert.equal(a.jev.rerank.applied, false)
  assert.equal(a.jev.relevance.route, 'grounded')
  const { jev: _j, ...rest } = a
  assert.deepStrictEqual(rest, b)
})

test('accept path (explicit threshold): the SAME candidates are reordered; budget clamp, maturity gate and identity still run', async () => {
  const env = { ...BOTH, AGENTBOX_JEV_ONTOLOGY_RERANK_APPLY_MIN_CONFIDENCE: '0.5' }
  const jev = oj.fromEnv({ env, fetchImpl: good(), sink })
  const a = await brain(cur, jev).ask(REQ)
  const b = await brain(head, undefined).ask(REQ)
  assert.equal(a.jev.rerank.applied, true)
  assert.deepEqual(a.seed_iris, ['https://x/C', 'https://x/A', 'https://x/B'])
  assert.deepEqual([...a.seed_iris].sort(), [...b.seed_iris].sort())
  assert.equal(a.budget, b.budget)
  assert.ok(a.tokens_used <= a.budget)
  // a candidate the maturity gate rejects can never be introduced by a rerank
  const gated = cur.createOntologyRetrieval({ seedFn: async () => [...SEEDS, { iri: 'https://x/D', label: 'Draft', maturity: 'draft' }], expandFn: async () => [], clock: () => 0, telemetry, jev: oj.fromEnv({ env, fetchImpl: good(), sink }) })
  assert.ok(!(await gated.ask(REQ)).seed_iris.includes('https://x/D'))
})

test('low confidence below the apply threshold ⇒ proposal recorded, order unchanged', async () => {
  const env = { ...BOTH, AGENTBOX_JEV_ONTOLOGY_RERANK_APPLY_MIN_CONFIDENCE: '0.99' }
  const jev = oj.fromEnv({ env, fetchImpl: mockFetch(() => ok({ route: choice('grounded', { grounded: 1 }, 0.9), supports: noul(0.9), c0: score(1.2, 4, 0.4), c1: score(0.4, 4, 0.4), c2: score(2.8, 4, 0.4) })), sink })
  const a = await brain(cur, jev).ask(REQ)
  assert.equal(a.jev.rerank.applied, false)
  assert.deepEqual(a.seed_iris, SEEDS.map((s) => s.iri))
})

test('passthrough is suggestion-only until a threshold is configured; then it skips injection', async () => {
  const shadow = await brain(cur, oj.fromEnv({ env: BOTH, fetchImpl: good('passthrough', 0.95), sink })).ask(REQ)
  assert.equal(shadow.jev.skipped, false)
  assert.ok(shadow.turtle.length > 0)
  const env = { ...BOTH, AGENTBOX_JEV_ONTOLOGY_PASSTHROUGH_MIN_CONFIDENCE: '0.9' }
  const skipped = await brain(cur, oj.fromEnv({ env, fetchImpl: good('passthrough', 0.95), sink })).ask(REQ)
  assert.equal(skipped.turtle, '')
  assert.equal(skipped.jev.skipped, true)
  const low = await brain(cur, oj.fromEnv({ env, fetchImpl: good('passthrough', 0.6), sink })).ask(REQ)
  assert.ok(low.turtle.length > 0)
})

test('cache: a Jev-shaped body is never served to a flag-off caller, and Jev callers do hit the cache', async () => {
  const shared = cur.createTtlCache({ clock: () => 0 })
  const f = good()
  const withJev = brain(cur, oj.fromEnv({ env: BOTH, fetchImpl: f, sink }), { cache: shared })
  const without = brain(cur, null, { cache: shared })
  const first = await withJev.ask(REQ)
  assert.ok(first.jev)
  const plain = await without.ask(REQ)
  assert.ok(!('jev' in plain) && plain.cache_hit === false)
  const again = await withJev.ask(REQ)
  assert.equal(again.cache_hit, true)
  assert.equal(f.calls.length, 1)
})
