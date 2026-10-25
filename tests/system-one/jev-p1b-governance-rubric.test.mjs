// ES-05-S1-01 — shared evidence-quality rubric, host consumer. Mocked transport only.
//   node --test tests/system-one/jev-p1b-governance-rubric.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { require, ROOT, mockFetch, ok, noul, score, failureTransports, loadAtRev, loadCurrent } from './helpers-jev-p1b.mjs'

const gr = require('../../management-api/lib/governance-evidence-rubric.js')
const acs = require('../../management-api/lib/agent-control-surface.js')

const EP = { AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:1/v1/systemone', AGENTBOX_SYSTEM_ONE_MODEL: 'm' }
const ON = { ...EP, AGENTBOX_JEV_GOVERNANCE_RUBRIC: '1' }
const sink = () => {}
// The digest of the shipped question set. Forum and VisionClaw pin the same value; any edit to the JSON bumps it.
const PINNED_RUBRIC_SHA256 = '3a338a77939ffec84e03413186619b6e58ad59f8d098543a9e127987fc9a6910'

const unsigned = () => acs.buildActionRequest({
  panelId: 'urn:agentbox:proposal:1', priority: 'medium', category: 'ontology-elevation', subjectKind: 'concept', subjectId: 'urn:x:1',
  title: 'Elevate "Lidar" to shared ontology', reasoning: 'seen in three repos',
  fields: { term: 'Lidar', domain: 'robotics', definition: 'Light detection and ranging', score: 0.8 }, createdAt: 1700000000,
})
const good = () => mockFetch(() => ok({
  rationale_explains_action: noul(0.8), evidence_supports_claim: noul(0.7), scope_matches_title: noul(0.95), review_completeness: score(2.1, 4),
}))

test('the shipped question set is the pinned, versioned artefact other surfaces consume', () => {
  const l = gr.loadRubric()
  assert.equal(l.version, 'governance-evidence-quality/1')
  assert.equal(l.rubric.authority, 'none')
  assert.deepEqual(Object.keys(l.rubric.questions), ['rationale_explains_action', 'evidence_supports_claim', 'scope_matches_title', 'review_completeness'])
  assert.ok(Array.isArray(l.rubric.questions.review_completeness.criteria))
  assert.equal(l.sha256, PINNED_RUBRIC_SHA256)
  assert.equal(gr.canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}')
})

test('request digest: stable, and any change to content, kind or tags changes it', () => {
  const a = unsigned(); const b = unsigned()
  assert.equal(gr.requestDigest(a), gr.requestDigest(b))
  assert.match(gr.requestDigest(a), /^[0-9a-f]{64}$/)
  assert.notEqual(gr.requestDigest({ ...a, content: a.content + ' ' }), gr.requestDigest(a))
  assert.notEqual(gr.requestDigest({ ...a, tags: [...a.tags, ['x', 'y']] }), gr.requestDigest(a))
  assert.notEqual(gr.requestDigest({ ...a, kind: 1 }), gr.requestDigest(a))
})

test('flag off: null and no request', async () => {
  const f = good()
  for (const flag of [undefined, '', '0']) assert.equal(await gr.assess(unsigned(), { env: { ...ON, AGENTBOX_JEV_GOVERNANCE_RUBRIC: flag }, fetchImpl: f, sink }), null)
  assert.equal(f.calls.length, 0)
})

test('no endpoint ⇒ null, no request', async () => {
  const f = good()
  assert.equal(await gr.assess(unsigned(), { env: { AGENTBOX_JEV_GOVERNANCE_RUBRIC: '1' }, fetchImpl: f, sink }), null)
  assert.equal(f.calls.length, 0)
})

for (const [name, f] of Object.entries(failureTransports())) {
  test(`transport failure (${name}): null`, async () => {
    assert.equal(await gr.assess(unsigned(), { env: ON, fetchImpl: f, sink }), null)
  })
}

test('a missing signal is malformed ⇒ null', async () => {
  const f = mockFetch(() => ok({ rationale_explains_action: noul(0.8) }))
  assert.equal(await gr.assess(unsigned(), { env: ON, fetchImpl: f, sink }), null)
})

test('wire shape: the shipped question set verbatim; state read from the card as built; no Authorization on the proxy', async () => {
  const f = good()
  await gr.assess(unsigned(), { env: ON, fetchImpl: f, sink })
  const { body, init } = f.calls[0]
  assert.equal(init.headers.Authorization, undefined)
  assert.deepStrictEqual(body.questions, gr.loadRubric().rubric.questions)
  assert.equal(body.questions.review_completeness.type, 'score')
  assert.equal(body.state.title, 'Elevate "Lidar" to shared ontology')
  assert.deepEqual(body.state.subject, { kind: 'concept', id: 'urn:x:1' })
  assert.equal(body.state.rationale, 'seen in three repos')
  assert.ok(body.state.evidence.includes('Light detection'))
})

test('accept path: signals bound to the digest and rubric hash, authority "none"', async () => {
  const u = unsigned()
  const s = await gr.assess(u, { env: ON, fetchImpl: good(), sink })
  assert.equal(s.request_digest, gr.requestDigest(u))
  assert.equal(s.rubric, 'governance-evidence-quality/1')
  assert.equal(s.rubric_sha256, PINNED_RUBRIC_SHA256)
  assert.equal(s.authority, 'none')
  assert.deepEqual(s.signals, { rationale_explains_action: 0.8, evidence_supports_claim: 0.7, scope_matches_title: 0.95, review_completeness: 0.7 })
  assert.ok(!/approv|sign/i.test(Object.keys(s.signals).join()))
})

// ── the host consumer: elevation-publisher ────────────────────────────────────────
function publisherWith(mod, env, fetchImpl) {
  const published = []
  const publishPanelEvent = async (_b, _s, event) => { published.push(JSON.stringify(event)); return { id: 'evt-1' } }
  const pub = mod.buildElevationPublisher({}, { env, bridge: {}, signer: {}, publishPanelEvent, logger: { debug() {}, warn() {} } })
  return { pub, published }
}
const PROPOSAL = { proposal_urn: 'urn:agentbox:proposal:1', target_urn: 'urn:x:1', candidate: { term: 'Lidar', domain: 'robotics', definition: 'Light detection and ranging', score: 0.8, reasons: ['seen in three repos'] } }

test('publisher, flag off: the result and the published bytes equal the HEAD publisher', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-gov-'))
  const env = { AGENTBOX_STATE: stateDir }
  const headMod = loadAtRev('management-api/lib/elevation-publisher.js')
  const curMod = loadCurrent('management-api/lib/elevation-publisher.js')
  const a = publisherWith(headMod, env); const b = publisherWith(curMod, env)
  const ra = await a.pub.publish(PROPOSAL); const rb = await b.pub.publish(PROPOSAL)
  assert.deepStrictEqual(rb, ra)
  assert.ok(!('evidence_signal' in rb))
  assert.equal(b.published.length, 1)
  assert.ok(JSON.parse(b.published[0]).created_at !== undefined)
  assert.equal(fs.existsSync(path.join(stateDir, 'governance-evidence-signals.jsonl')), false)
})

test('publisher, flag on but Jev down: result equals HEAD, nothing recorded', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-gov-'))
  const env = { AGENTBOX_STATE: stateDir, ...ON }
  const rubricStub = { ...gr, assess: (u) => gr.assess(u, { env: ON, fetchImpl: mockFetch({ status: 503, body: {} }), sink }) }
  const curMod = loadCurrent('management-api/lib/elevation-publisher.js', { './governance-evidence-rubric': rubricStub })
  const headMod = loadAtRev('management-api/lib/elevation-publisher.js')
  const ra = await publisherWith(headMod, { AGENTBOX_STATE: stateDir }).pub.publish(PROPOSAL)
  const rb = await publisherWith(curMod, env).pub.publish(PROPOSAL)
  assert.deepStrictEqual(rb, ra)
  assert.equal(fs.existsSync(path.join(stateDir, 'governance-evidence-signals.jsonl')), false)
})

test('publisher, accept path: the event the approver is shown is byte-identical; the signal is beside it, in a sidecar', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-gov-'))
  const env = { AGENTBOX_STATE: stateDir, ...ON }
  const rubricStub = { ...gr, assess: (u) => gr.assess(u, { env: ON, fetchImpl: good(), sink }) }
  const curMod = loadCurrent('management-api/lib/elevation-publisher.js', { './governance-evidence-rubric': rubricStub })
  const headMod = loadAtRev('management-api/lib/elevation-publisher.js')
  const base = publisherWith(headMod, { AGENTBOX_STATE: stateDir })
  const withJev = publisherWith(curMod, env)
  const r0 = await base.pub.publish(PROPOSAL)
  const r1 = await withJev.pub.publish(PROPOSAL)
  const strip = (e) => { const o = JSON.parse(e); delete o.created_at; return JSON.stringify(o) }
  assert.equal(strip(withJev.published[0]), strip(base.published[0]), 'the published event does not change')
  const { evidence_signal, ...rest } = r1
  assert.deepStrictEqual(rest, r0)
  assert.equal(evidence_signal.authority, 'none')
  const line = JSON.parse(fs.readFileSync(path.join(stateDir, 'governance-evidence-signals.jsonl'), 'utf8').trim())
  assert.equal(line.request_digest, evidence_signal.request_digest)
  assert.equal(line.event_id, 'evt-1')
  assert.ok(!withJev.published[0].includes(evidence_signal.request_digest), 'the signal is not embedded in the signed event')
})

test('assess never mutates the unsigned event it is given', async () => {
  const u = unsigned(); const before = JSON.stringify(u)
  await gr.assess(u, { env: ON, fetchImpl: good(), sink })
  assert.equal(JSON.stringify(u), before)
  assert.equal(Object.isFrozen(u), false)
})
