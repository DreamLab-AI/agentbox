// AB-15-S1-01 — advisory consult_advice. Mocked transport only.
//   node --test tests/system-one/jev-p1b-consult-advice.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { require, mockFetch, ok, choice, score, failureTransports, loadAtRev, loadCurrent } from './helpers-jev-p1b.mjs'

const advice = require('../../mcp/consultants/shared/consult-advice.js')
const jev = require('../../config/hooks/lib/jev-option.cjs')

const PROXY = { AGENTBOX_JEV_CONSULT_ADVICE: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm' }
const INPUT = { question: 'Is the retry logic in client.rs correct?', context_excerpt: 'fn retry() {}', remainingUsd: 2, specialists: ['codex', 'perplexity'], deepReasoning: true }
const confident = () => mockFetch(ok({
  route: choice('specialist', { none: 0.05, specialist: 0.9, deep_reasoning: 0.05 }, 0.85),
  insufficiency: score(2.4, 4),
}))
const quiet = [] ; const sink = (l) => quiet.push(l)

// ── fallback equivalence ──────────────────────────────────────────────────────────
// The pre-change behaviour is "no advice". Against the HEAD consultant-base, the tool list and
// the consult handler are what they were; here they are compared structurally.
function stubs(extra = {}) {
  return {
    '@modelcontextprotocol/sdk/server/index.js': { Server: class { setRequestHandler(s, h) { (this.h ||= []).push(h) } connect() {} } },
    '@modelcontextprotocol/sdk/server/stdio.js': { StdioServerTransport: class {} },
    '@modelcontextprotocol/sdk/types.js': { ListToolsRequestSchema: 'list', CallToolRequestSchema: 'call' },
    './memory-logger': { MemoryLogger: class { log() {} } },
    '../../../management-api/lib/uris.js': { mint: () => 'urn:test' },
    ...extra,
  }
}
function consultant(mod) {
  const stubbed = stubs()
  const m = mod(stubbed)
  return new m.BaseConsultant({ name: 'x', callConsult: async () => ({ response: 'r' }), healthCheck: async () => ({ ok: true }), estimateCost: async () => ({}), logger: { error() {} } })
}
// Pinned to the parent of the commit that added consult_advice (d7b2889c3). 'main' moved past it, so a
// moving ref stops being the "pre-change" baseline this test compares against.
const PRE_CHANGE = 'd7b2889c3^'
const head = (s) => loadAtRev('mcp/consultants/shared/consultant-base.js', PRE_CHANGE, { ...s, './memory-logger': s['./memory-logger'] })

test('flag off: tool list equals the pre-change list and consult_advice is not exposed', () => {
  delete process.env.AGENTBOX_JEV_CONSULT_ADVICE
  const before = consultant((s) => head(s))
  const after = consultant((s) => loadCurrent('mcp/consultants/shared/consultant-base.js', s))
  assert.deepStrictEqual(after._toolList(), before._toolList())
  assert.ok(!after._toolList().some((t) => t.name === 'consult_advice'))
})

test('flag on: only one tool is added, the three existing tool definitions are unchanged', () => {
  process.env.AGENTBOX_JEV_CONSULT_ADVICE = '1'
  try {
    const before = consultant((s) => head(s))
    const after = consultant((s) => loadCurrent('mcp/consultants/shared/consultant-base.js', s))
    const list = after._toolList()
    assert.deepStrictEqual(list.slice(0, 3), before._toolList())
    assert.equal(list.length, 4)
    assert.equal(list[3].name, 'consult_advice')
  } finally { delete process.env.AGENTBOX_JEV_CONSULT_ADVICE }
})

test('consult itself is byte-identical code to HEAD', async () => {
  const cur = loadCurrent('mcp/consultants/shared/consultant-base.js', stubs()).BaseConsultant.prototype
  const old = head(stubs()).BaseConsultant.prototype
  assert.equal(cur._handleConsult.toString(), old._handleConsult.toString())
  assert.equal(cur._withTimeout.toString(), old._withTimeout.toString())
})

test('flag off: no request is built', async () => {
  const f = confident()
  const r = await advice.assess(INPUT, { env: { ...PROXY, AGENTBOX_JEV_CONSULT_ADVICE: '' }, fetchImpl: f, sink })
  assert.deepEqual(r, { ok: false, reason: 'flag-off' })
  assert.equal(f.calls.length, 0)
})

test('no endpoint (no proxy, no key): fall back without a request', async () => {
  const f = confident()
  const r = await advice.assess(INPUT, { env: { AGENTBOX_JEV_CONSULT_ADVICE: '1' }, fetchImpl: f, sink })
  assert.deepEqual(r, { ok: false, reason: 'no-endpoint' })
  assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): advice is absent, never thrown`, async () => {
    const r = await advice.assess(INPUT, { env: PROXY, fetchImpl: f, sink })
    assert.equal(r.ok, false)
    assert.match(r.reason, /^(timeout|network|http-\d+|malformed)$/)
  })
}

test('a route outside the offered set is malformed', async () => {
  const f = mockFetch(ok({ route: choice('web_search', { web_search: 1 }, 0.9), insufficiency: score(1, 4) }))
  assert.deepEqual(await advice.assess(INPUT, { env: PROXY, fetchImpl: f, sink }), { ok: false, reason: 'malformed' })
})

test('low confidence: below the configured threshold the advice is withheld', async () => {
  const r = await advice.assess(INPUT, { env: { ...PROXY, AGENTBOX_JEV_CONSULT_MIN_CONFIDENCE: '0.95' }, fetchImpl: confident(), sink })
  assert.deepEqual(r, { ok: false, reason: 'low-confidence' })
})

test('the handler turns every fallback into advice:null and keeps the envelope shape', async () => {
  // The real module is wrapped so the handler can never reach the live environment's endpoint or key.
  const wrapped = { ...advice, advisoryEnabled: () => true, assess: (input) => advice.assess(input, { env: { AGENTBOX_JEV_CONSULT_ADVICE: '1' }, fetchImpl: confident(), sink }) }
  const c = consultant((s) => loadCurrent('mcp/consultants/shared/consultant-base.js', { ...s, './consult-advice': wrapped }))
  const out = await c._handleAdvice({ question: 'q' })
  assert.equal(out.advice, null)
  assert.equal(out.fallback_reason, 'no-endpoint')
  assert.equal(out.question_set_version, advice.QUESTION_SET_VERSION)
  const on = { ...advice, advisoryEnabled: () => true, assess: (input) => advice.assess(input, { env: PROXY, fetchImpl: confident(), sink }) }
  const c2 = consultant((s) => loadCurrent('mcp/consultants/shared/consultant-base.js', { ...s, './consult-advice': on }))
  const out2 = await c2._handleAdvice({ question: 'q', specialists: ['codex'] })
  assert.equal(out2.advice.route, 'specialist')
  assert.equal(out2.fallback_reason, null)
})

// ── wire shape ────────────────────────────────────────────────────────────────────
test('wire shape: Choice criteria is a MAP, Score criteria an ORDERED list, no Authorization on the proxy', async () => {
  const f = confident()
  await advice.assess(INPUT, { env: PROXY, fetchImpl: f, sink })
  assert.equal(f.calls.length, 1)
  const { url, init, body } = f.calls[0]
  assert.equal(url, 'http://127.0.0.1:1/v1/systemone')
  assert.equal(init.headers.Authorization, undefined)
  assert.equal(body.model, 'm')
  assert.deepEqual(Object.keys(body.questions), ['route', 'insufficiency'])
  assert.equal(body.questions.route.type, 'choice')
  assert.ok(!Array.isArray(body.questions.route.criteria))
  assert.deepEqual(Object.keys(body.questions.route.criteria), ['none', 'specialist', 'deep_reasoning'])
  assert.equal(body.questions.insufficiency.type, 'score')
  assert.ok(Array.isArray(body.questions.insufficiency.criteria) && body.questions.insufficiency.criteria.length === 4)
  assert.ok(body.questions.route.instructions.includes('`question`'))
  assert.equal(body.state.remaining_budget_usd, 2)
})

test('code owns the budget: with none left, paid routes are not even offered', async () => {
  const f = mockFetch(ok({ route: choice('none', { none: 1 }, 0.9), insufficiency: score(0, 4) }))
  const r = await advice.assess({ ...INPUT, remainingUsd: 0 }, { env: PROXY, fetchImpl: f, sink })
  assert.deepEqual(Object.keys(f.calls[0].body.questions.route.criteria), ['none'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.advice.offered, ['none'])
})

// ── accept path ───────────────────────────────────────────────────────────────────
test('accept path: a confident answer yields an advisory annotation and nothing else', async () => {
  const r = await advice.assess(INPUT, { env: PROXY, fetchImpl: confident(), sink })
  assert.equal(r.ok, true)
  assert.equal(r.advice.route, 'specialist')
  assert.equal(r.advice.advisory_only, true)
  assert.equal(r.advice.question_set_version, 'ab15-consult-advice/1')
  assert.ok(r.advice.insufficiency > 0.7 && r.advice.insufficiency < 0.9)
})

test('fallback log carries the reason and none of the request', async () => {
  quiet.length = 0
  await advice.assess({ ...INPUT, question: 'SECRET-QUESTION' }, { env: PROXY, fetchImpl: mockFetch({ status: 503, body: {} }), sink })
  assert.equal(quiet.length, 1)
  assert.match(quiet[0], /AB-15-S1-01 fallback \(http-503\)/)
  assert.ok(!quiet[0].includes('SECRET'))
})

test('local-only toggle refuses a non-local endpoint', async () => {
  const f = confident()
  const r = await advice.assess(INPUT, { env: { ...PROXY, AGENTBOX_JEV_CONSULT_LOCAL_ONLY: '1' }, fetchImpl: f, sink })
  assert.deepEqual(r, { ok: false, reason: 'local-only' })
  assert.equal(f.calls.length, 0)
  const local = await advice.assess(INPUT, { env: { ...PROXY, AGENTBOX_JEV_CONSULT_LOCAL_ONLY: '1', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }, fetchImpl: confident(), sink })
  assert.equal(local.ok, true)
})
