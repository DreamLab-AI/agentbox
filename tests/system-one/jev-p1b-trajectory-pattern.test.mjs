// AB-21-S1-01 — semantic annotation of eligible trajectory patterns. Mocked transport only.
//   node --test tests/system-one/jev-p1b-trajectory-pattern.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { require, mockFetch, ok, choice, noul, failureTransports } from './helpers-jev-p1b.mjs'

const tp = require('../../mcp/servers/lib/trajectory-pattern-jev.js')
const agg = require('../../mcp/servers/lib/aggregate-effectiveness.js')

const ENV = { AGENTBOX_JEV_TRAJECTORY_CLASSIFY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm' }
const sink = () => {}
const pg = [
  { pattern: 'git commit', n: '12', n_trajectories: '6', n_distinct_commands: '9', n_ambiguous: '1', w_total: '10', w_succ: '9', mean_quality: '0.93', last_seen: new Date('2026-10-20T00:00:00Z') },
  { pattern: 'make', n: '8', n_trajectories: '4', n_distinct_commands: '5', n_ambiguous: '0', w_total: '7', w_succ: '3', mean_quality: '0.6', last_seen: new Date('2026-10-21T00:00:00Z') },
]
const rows = () => agg.computeRows(pg)
const good = (cls = 'vcs_change', p = 0.95) => mockFetch(() => ok({
  action_class: choice(cls, Object.fromEntries(tp.CLASS_KEYS.map((k) => [k, k === cls ? 0.9 : 0.1 / 10])), 0.88),
  coherent: noul(p),
}))

test('flag off: the same array comes back and nothing is requested', async () => {
  const f = good(); const input = rows()
  for (const flag of [undefined, '', '0']) {
    const out = await tp.annotateRows(input, { env: { ...ENV, AGENTBOX_JEV_TRAJECTORY_CLASSIFY: flag }, fetchImpl: f, sink })
    assert.equal(out, input)
  }
  assert.equal(f.calls.length, 0)
})

test('no endpoint: unchanged rows, no request', async () => {
  const f = good(); const input = rows()
  assert.equal(await tp.annotateRows(input, { env: { AGENTBOX_JEV_TRAJECTORY_CLASSIFY: '1' }, fetchImpl: f, sink }), input)
  assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): every row deep-equals the pre-change row`, async () => {
    const input = rows(); const before = structuredClone(input)
    const out = await tp.annotateRows(input, { env: ENV, fetchImpl: f, sink })
    assert.deepStrictEqual(out, before)
    assert.deepStrictEqual(out.map(tp.semanticFields), [{}, {}])
  })
}

test('a class outside the taxonomy is malformed ⇒ unchanged', async () => {
  const f = mockFetch(() => ok({ action_class: choice('deploy_prod', { deploy_prod: 1 }, 0.9), coherent: noul(0.9) }))
  const input = rows(); const before = structuredClone(input)
  assert.deepStrictEqual(await tp.annotateRows(input, { env: ENV, fetchImpl: f, sink }), before)
})

test('low confidence ⇒ unchanged', async () => {
  const input = rows(); const before = structuredClone(input)
  const out = await tp.annotateRows(input, { env: { ...ENV, AGENTBOX_JEV_TRAJECTORY_MIN_CONFIDENCE: '0.99' }, fetchImpl: good(), sink })
  assert.deepStrictEqual(out, before)
})

test('wire shape: Choice map over the fixed taxonomy (with other), Noul, label + four numbers only', async () => {
  const f = good()
  await tp.annotateRows(rows(), { env: ENV, fetchImpl: f, sink })
  assert.equal(f.calls.length, 2)
  const { body, init } = f.calls[0]
  assert.equal(init.headers.Authorization, undefined)
  assert.deepEqual(Object.keys(body.questions), ['action_class', 'coherent'])
  assert.equal(body.questions.action_class.type, 'choice')
  assert.deepEqual(Object.keys(body.questions.action_class.criteria), tp.CLASS_KEYS)
  assert.ok(tp.CLASS_KEYS.includes('other'))
  assert.equal(body.questions.coherent.type, 'noul')
  assert.deepEqual(Object.keys(body.state), ['action_pattern', 'observations', 'distinct_trajectories', 'ambiguous_successes', 'mean_quality'])
  assert.ok(body.questions.action_class.instructions.includes('`action_pattern`'))
})

test('accept path: annotation attached; original statistics, order and gates are untouched', async () => {
  const input = rows(); const before = structuredClone(input)
  const out = await tp.annotateRows(input, { env: ENV, fetchImpl: good('vcs_change', 0.4), sink })
  assert.deepStrictEqual(input, before, 'inputs are never mutated')
  assert.equal(out.length, 2)
  assert.equal(out[0].semantic.action_class, 'vcs_change')
  assert.equal(out[0].semantic.coherent_p, 0.4)
  assert.equal(out[0].semantic.question_set_version, 'ab21-trajectory-pattern/1')
  const strip = ({ semantic, ...r }) => r
  assert.deepStrictEqual(out.map(strip), before)
  // downstream gates run on the same numbers, with the same verdicts
  const v = (rs) => rs.map((r) => agg.promotionVerdict(r, { minSamples: 5, minTrajectories: 3 }))
  assert.deepStrictEqual(v(out), v(before))
  assert.deepStrictEqual(agg.summariseGates(out, { minSamples: 5, minTrajectories: 3, feedRetrieval: false, feedRouting: false }).eligible_patterns,
    agg.summariseGates(before, { minSamples: 5, minTrajectories: 3, feedRetrieval: false, feedRouting: false }).eligible_patterns)
  assert.deepStrictEqual(tp.semanticFields(out[0]), { semantic: out[0].semantic })
})

test('the per-sweep cap bounds the number of requests', async () => {
  const f = good()
  const out = await tp.annotateRows(rows(), { env: { ...ENV, AGENTBOX_JEV_TRAJECTORY_MAX_PATTERNS: '1' }, fetchImpl: f, sink })
  assert.equal(f.calls.length, 1)
  assert.ok(out[0].semantic && !out[1].semantic)
})
