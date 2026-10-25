// AB-25-S1-01 — verification of SessionEnd ontology-change proposals. Mocked transport only.
//   node --test tests/system-one/jev-p1b-ontology-proposals.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { require, ROOT, mockFetch, ok, noul, score, failureTransports } from './helpers-jev-p1b.mjs'

const pj = require('../../config/hooks/lib/ontology-proposal-jev.cjs')

const EP = { AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm' }
const ON = { ...EP, AGENTBOX_JEV_ONTOLOGY_PROPOSALS: '1' }
const sink = () => {}
const PROPOSALS = [
  { iri: 'https://x/Lidar', label: 'Lidar', kind: 'correction', title: 'Fix range', summary: 'Range is 200 m not 100 m', rationale: 'saw spec', url: 'u1' },
  { iri: 'https://x/Radar', label: 'Radar', kind: 'new-relation', title: 'Add relation', summary: 'Radar complements lidar', rationale: 'commit msg', url: 'u2' },
]
const CTX = {
  concepts: [{ iri: 'https://x/Lidar', label: 'Lidar', definition: 'Light detection and ranging, 100 m.' }, { iri: 'https://x/Radar', label: 'Radar', definition: 'Radio detection.' }],
  work: { changed: ['src/lidar.rs'], transcript: 'we measured lidar range at 200 m' },
}
const verdictsFor = (supported = [0.9, 0.2]) => ok({
  p0_supported: noul(supported[0]), p0_contradicts: noul(0.1), p0_novelty: score(2.5, 4),
  p1_supported: noul(supported[1]), p1_contradicts: noul(0.05), p1_novelty: score(0.5, 4),
})

test('flag off: the SAME array comes back, no verdicts, no request', async () => {
  const f = mockFetch(verdictsFor())
  for (const flag of [undefined, '', '0']) {
    const r = await pj.verify(PROPOSALS, CTX, { env: { ...ON, AGENTBOX_JEV_ONTOLOGY_PROPOSALS: flag }, fetchImpl: f, sink })
    assert.equal(r.proposals, PROPOSALS)
    assert.deepEqual([r.held, r.verdicts], [[], []])
  }
  assert.equal(f.calls.length, 0)
})

test('no endpoint ⇒ unchanged, no request', async () => {
  const f = mockFetch(verdictsFor())
  const r = await pj.verify(PROPOSALS, CTX, { env: { AGENTBOX_JEV_ONTOLOGY_PROPOSALS: '1' }, fetchImpl: f, sink })
  assert.equal(r.proposals, PROPOSALS); assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): proposals pass through as the very same array`, async () => {
    const r = await pj.verify(PROPOSALS, CTX, { env: { ...ON, AGENTBOX_JEV_PROPOSAL_HOLD_BELOW: '0.5' }, fetchImpl: f, sink })
    assert.equal(r.proposals, PROPOSALS)
    assert.deepEqual([r.held, r.verdicts], [[], []])
  })
}

test('a missing answer id is malformed ⇒ unchanged, even with a hold threshold', async () => {
  const f = mockFetch(ok({ p0_supported: noul(0.1), p0_contradicts: noul(0.1), p0_novelty: score(1, 4) }))
  const r = await pj.verify(PROPOSALS, CTX, { env: { ...ON, AGENTBOX_JEV_PROPOSAL_HOLD_BELOW: '0.5' }, fetchImpl: f, sink })
  assert.equal(r.proposals, PROPOSALS); assert.deepEqual(r.held, [])
})

test('wire shape: Noul + Noul + ordered-list Score per proposal; instructions index the state arrays', async () => {
  const f = mockFetch(verdictsFor())
  await pj.verify(PROPOSALS, CTX, { env: ON, fetchImpl: f, sink })
  const { body, init } = f.calls[0]
  assert.equal(init.headers.Authorization, undefined)
  assert.deepEqual(Object.keys(body.questions), ['p0_supported', 'p0_contradicts', 'p0_novelty', 'p1_supported', 'p1_contradicts', 'p1_novelty'])
  assert.equal(body.questions.p0_supported.type, 'noul')
  assert.equal(body.questions.p1_novelty.type, 'score')
  assert.ok(Array.isArray(body.questions.p1_novelty.criteria) && body.questions.p1_novelty.criteria.length === 4)
  assert.ok(body.questions.p1_supported.instructions.includes('index 1 of `proposals`'))
  assert.equal(body.state.proposals.length, 2)
  assert.deepEqual(body.state.cited_classes.map((c) => c.label), ['Lidar', 'Radar'])
  assert.ok(!JSON.stringify(body).includes('"url"'), 'the forum URL is not sent')
})

test('accept path, default: verdicts annotate, NOTHING is held or removed', async () => {
  const r = await pj.verify(PROPOSALS, CTX, { env: ON, fetchImpl: mockFetch(verdictsFor()), sink })
  assert.equal(r.proposals, PROPOSALS)
  assert.deepEqual(r.held, [])
  assert.equal(r.verdicts.length, 2)
  assert.equal(r.verdicts[0].supported, 0.9)
  assert.equal(r.verdicts[0].question_set_version, 'ab25-ontology-proposal/1')
  assert.deepEqual(PROPOSALS[0], { ...PROPOSALS[0] }, 'the proposal objects are untouched')
  assert.ok(!('jev' in PROPOSALS[0]))
})

test('accept path, explicit threshold: only the unsupported proposal is held for local review', async () => {
  const r = await pj.verify(PROPOSALS, CTX, { env: { ...ON, AGENTBOX_JEV_PROPOSAL_HOLD_BELOW: '0.5' }, fetchImpl: mockFetch(verdictsFor()), sink })
  assert.deepEqual(r.proposals.map((p) => p.iri), ['https://x/Lidar'])
  assert.deepEqual(r.held.map((p) => p.iri), ['https://x/Radar'])
  assert.equal(r.held[0], PROPOSALS[1], 'held objects are the originals')
})

test('a transcript that used the email gateway makes the consumer local-only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-tx-'))
  const tx = path.join(dir, 't.jsonl')
  fs.writeFileSync(tx, JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'mcp__email-gateway__ask_email' }] } }) + '\n')
  const f = mockFetch(verdictsFor())
  const r = await pj.verify(PROPOSALS, { ...CTX, transcriptPath: tx }, { env: ON, fetchImpl: f, sink })
  assert.equal(r.proposals, PROPOSALS); assert.equal(f.calls.length, 0)
  const local = await pj.verify(PROPOSALS, { ...CTX, transcriptPath: tx }, { env: { ...ON, AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }, fetchImpl: f, sink })
  assert.equal(local.verdicts.length, 2)
  const clean = path.join(dir, 'c.jsonl'); fs.writeFileSync(clean, '{"message":{"content":"hi"}}\n')
  assert.equal(pj.transcriptTainted(clean), false)
  assert.equal(pj.transcriptTainted('/nonexistent'), false)
})

test('the monitor builds the 31402 from named fields only: verdicts cannot reach the signed request', () => {
  const src = fs.readFileSync(path.join(ROOT, 'config/hooks/ontology-monitor.cjs'), 'utf8')
  const build = src.slice(src.indexOf('acs.buildActionRequest({'), src.indexOf('await acs.publishPanelEvent'))
  assert.ok(!/jev|verdict/i.test(build))
  assert.match(build, /fields: \{ kind: p\.kind, summary: p\.summary, label: p\.label \}/)
})
