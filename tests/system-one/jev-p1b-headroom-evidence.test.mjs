// AB-26-S1-01 — evidence selection before headroom compression. Mocked transport only.
//   node --test tests/system-one/jev-p1b-headroom-evidence.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { require, mockFetch, ok, noul, score, failureTransports } from './helpers-jev-p1b.mjs'

const he = require('../../management-api/lib/headroom-evidence.js')
const headroom = require('../../management-api/lib/headroom.js')

const LOCAL = { AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }
const ON = { ...LOCAL, AGENTBOX_JEV_HEADROOM_EVIDENCE: '1' }
const sink = () => {}
const TASK = 'Why does the build fail on CI?'
const EXC = [
  { id: 'log:1', text: '2026-10-25T10:00:00 INFO started' },
  { id: 'log:2', text: '2026-10-25T10:00:01 ERROR linker cannot find -lssl' },
  { id: 'file:3', text: 'README: how to install' },
]
const ranked = () => mockFetch(() => ok({
  e0_use: score(0.2, 4), e0_required: noul(0.05),
  e1_use: score(2.9, 4), e1_required: noul(0.97),
  e2_use: score(1.1, 4), e2_required: noul(0.1),
}))
const aud = (extra = {}) => ({ env: ON, fetchImpl: ranked(), sink, ...extra })

test('flag off: the SAME array, no request', async () => {
  const f = ranked()
  for (const flag of [undefined, '', '0']) {
    const r = await he.selectEvidence(TASK, EXC, { env: { ...ON, AGENTBOX_JEV_HEADROOM_EVIDENCE: flag }, fetchImpl: f, sink })
    assert.equal(r.items, EXC); assert.equal(r.annotations, null)
  }
  assert.equal(f.calls.length, 0)
})

test('flag off: compressSelected equals plain compress() per excerpt, in input order', async () => {
  const plain = EXC.map((e) => ({ id: e.id, original: e.text, ...headroom.compress(e.text, 'memory') }))
  const viaJev = await headroom.compressSelected(TASK, EXC, 'memory', { env: {} })
  assert.deepStrictEqual(viaJev, plain)
})

test('local-only: a cloud endpoint (key or undeclared proxy) is refused, nothing is sent', async () => {
  for (const env of [
    { AGENTBOX_JEV_HEADROOM_EVIDENCE: '1', TYPESAFE_API_KEY: 'k' },
    { AGENTBOX_JEV_HEADROOM_EVIDENCE: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://p/v1/systemone' },
  ]) {
    const f = ranked()
    const r = await he.selectEvidence(TASK, EXC, { env, fetchImpl: f, sink })
    assert.equal(r.items, EXC); assert.equal(f.calls.length, 0)
  }
})

test('no endpoint ⇒ unchanged', async () => {
  const f = ranked()
  assert.equal((await he.selectEvidence(TASK, EXC, { env: { AGENTBOX_JEV_HEADROOM_EVIDENCE: '1' }, fetchImpl: f, sink })).items, EXC)
  assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): input array returned, compressSelected equals plain compress`, async () => {
    const r = await he.selectEvidence(TASK, EXC, aud({ fetchImpl: f }))
    assert.equal(r.items, EXC)
    const plain = EXC.map((e) => ({ id: e.id, original: e.text, ...headroom.compress(e.text, 'memory') }))
    assert.deepStrictEqual(await headroom.compressSelected(TASK, EXC, 'memory', aud({ fetchImpl: f })), plain)
  })
}

test('a missing excerpt answer is malformed ⇒ unchanged', async () => {
  const f = mockFetch(() => ok({ e0_use: score(1, 4), e0_required: noul(0.1) }))
  assert.equal((await he.selectEvidence(TASK, EXC, aud({ fetchImpl: f }))).items, EXC)
})

test('low confidence ⇒ unchanged', async () => {
  const r = await he.selectEvidence(TASK, EXC, aud({ env: { ...ON, AGENTBOX_JEV_HEADROOM_MIN_CONFIDENCE: '0.99' } }))
  assert.equal(r.items, EXC)
})

test('wire shape: Score ordered list + Noul per excerpt; instructions index the excerpts; source ids carried', async () => {
  const f = ranked()
  await he.selectEvidence(TASK, EXC, aud({ fetchImpl: f }))
  const { body, init } = f.calls[0]
  assert.equal(init.headers.Authorization, undefined)
  assert.deepEqual(Object.keys(body.questions), ['e0_use', 'e0_required', 'e1_use', 'e1_required', 'e2_use', 'e2_required'])
  assert.equal(body.questions.e1_use.type, 'score')
  assert.ok(Array.isArray(body.questions.e1_use.criteria) && body.questions.e1_use.criteria.length === 4)
  assert.equal(body.questions.e1_required.type, 'noul')
  assert.ok(body.questions.e2_use.instructions.includes('index 2 of `excerpts`'))
  assert.deepEqual(body.state.excerpts.map((e) => e.source_id), ['log:1', 'log:2', 'file:3'])
})

test('accept path: required/useful first; same objects, nothing dropped, originals intact', async () => {
  const r = await he.selectEvidence(TASK, EXC, aud())
  assert.deepEqual(r.items.map((e) => e.id), ['log:2', 'file:3', 'log:1'])
  assert.equal(r.items.length, EXC.length)
  for (const e of EXC) assert.ok(r.items.includes(e), 'same object identity')
  assert.equal(r.annotations['log:2'].required_p, 0.97)
  assert.deepEqual(EXC.map((e) => e.id), ['log:1', 'log:2', 'file:3'], 'the input is not mutated')
  const out = await headroom.compressSelected(TASK, EXC, 'memory', aud())
  assert.deepEqual(out.map((o) => o.id), ['log:2', 'file:3', 'log:1'])
  assert.deepEqual(out.map((o) => o.original), ['2026-10-25T10:00:01 ERROR linker cannot find -lssl', 'README: how to install', '2026-10-25T10:00:00 INFO started'])
  assert.ok(out.every((o) => o.compressed === false && o.content === o.original), 'compress() still decides compression')
  assert.equal(out[0].jev.usefulness > 0.9, true)
})

test('excerpts beyond the window keep their order after the judged ones', async () => {
  const many = Array.from({ length: he.WINDOW + 3 }, (_, i) => ({ id: `x${i}`, text: `t${i}` }))
  const f = mockFetch((b) => ok(Object.fromEntries(Object.keys(b.questions).map((k) => [k, k.endsWith('_use') ? score(1, 4) : noul(0.1)]))))
  const r = await he.selectEvidence(TASK, many, aud({ fetchImpl: f }))
  assert.equal(r.items.length, many.length)
  assert.deepEqual(r.items.slice(he.WINDOW).map((e) => e.id), ['x12', 'x13', 'x14'])
})
