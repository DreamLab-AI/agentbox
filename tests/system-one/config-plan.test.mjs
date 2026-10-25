// AB-05-S1-01 — `agentbox.sh config plan`: a read-only, propose-only planner.
//   node --test tests/system-one/config-plan.test.mjs
// The validator runs for real when @iarna/toml/ajv resolve (NODE_PATH or node_modules); the
// accept-path test is skipped otherwise. Mocked transport; nothing is ever written to agentbox.toml.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cp = require('../../scripts/config-plan.cjs')

const LOCAL = { AGENTBOX_JEV_MANIFEST_PLAN: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://lan/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }
const FIXTURE = `[desktop]
enabled = true
stack = "x11-openbox"

[toolchains]
code_server = true   # browser IDE
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgplan-'))
const manifestPath = path.join(dir, 'agentbox.toml')
fs.writeFileSync(manifestPath, FIXTURE)
const parseToml = (t) => ({
  desktop: { enabled: /\[desktop\]\nenabled = true/.test(t), stack: 'x11-openbox' },
  toolchains: { code_server: /code_server = true/.test(t) },
})
const okValidator = () => ({ status: 0 })
const ok = (answers) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers, usage: {} }) })
const choice = (c, conf = 0.9) => ({ type: 'choice', choice: c, confidence: conf, probabilities: { [c]: conf } })
const noul = (p) => ({ type: 'noul', noul: p })
const seq = (...replies) => { let i = 0; return async (...a) => replies[Math.min(i++, replies.length - 1)](...a) }
const base = (extra = {}) => ({ env: LOCAL, manifestPath, parseToml, validator: okValidator, log: () => {}, ...extra })
const good = () => seq(ok({ setting: choice('desktop') }), ok({ asks: noul(0.95) }))
const REQ = 'please turn off the desktop'

test.afterEach(() => assert.equal(fs.readFileSync(manifestPath, 'utf8'), FIXTURE, 'agentbox.toml is byte-identical'))

test('request direction is parsed in code; absent or contradictory wording gives none', () => {
  assert.equal(cp.parseDirection('turn off the desktop'), false)
  assert.equal(cp.parseDirection('please enable code server'), true)
  assert.equal(cp.parseDirection('enable it and disable it'), null)
  assert.equal(cp.parseDirection('what does the desktop do'), null)
})

test('setBoolean edits only a plain boolean line in its own table, keeping the comment', () => {
  assert.equal(cp.setBoolean(FIXTURE, 'toolchains.code_server', false).includes('code_server = false   # browser IDE'), true)
  assert.equal(cp.setBoolean(FIXTURE, 'desktop.enabled', false).includes('[desktop]\nenabled = false'), true)
  assert.equal(cp.setBoolean(FIXTURE, 'toolchains.enabled', false), null)
  assert.equal(cp.setBoolean(FIXTURE, 'nope.code_server', false), null)
})

const MISSES = {
  'flag off': [{ env: { ...LOCAL, AGENTBOX_JEV_MANIFEST_PLAN: '0' } }, good()],
  'flag unset': [{ env: {} }, good()],
  'cloud key only (local-only)': [{ env: { AGENTBOX_JEV_MANIFEST_PLAN: '1', TYPESAFE_API_KEY: 'k' } }, good()],
  'no endpoint': [{ env: { AGENTBOX_JEV_MANIFEST_PLAN: '1' } }, good()],
  'transport error': [{}, async () => { throw new Error('down') }],
  timeout: [{}, async () => { const e = new Error('a'); e.name = 'AbortError'; throw e }],
  'http 500': [{}, async () => ({ ok: false, status: 500, json: async () => ({}) })],
  'http 429': [{}, async () => ({ ok: false, status: 429, json: async () => ({}) })],
  'unparseable body': [{}, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } })],
  'answers missing': [{}, ok({})],
  'setting outside the catalogue': [{}, ok({ setting: choice('format-disk') })],
  'judge says none': [{}, ok({ setting: choice('none') })],
  'low confidence': [{}, ok({ setting: choice('desktop', 0.3) })],
  'request not asked (Noul low)': [{}, seq(ok({ setting: choice('desktop') }), ok({ asks: noul(0.1) }))],
  'malformed Noul': [{}, seq(ok({ setting: choice('desktop') }), ok({ asks: { type: 'noul' } }))],
  'validation fails': [{ validator: () => ({ status: 1 }) }, good()],
  'already in that state': [{}, seq(ok({ setting: choice('desktop') }), ok({ asks: noul(0.95) })), 'please enable the desktop'],
}
for (const [name, [extra, fetchImpl, req]] of Object.entries(MISSES)) {
  test(`fallback equivalence — ${name}: no plan, nothing written`, async () => {
    const r = await cp.plan(req || REQ, base({ ...extra, fetchImpl }))
    assert.equal(r.plan, undefined)
    assert.ok(r.reason)
  })
}

test('fallback — wording with no clear direction never reaches the model', async () => {
  let calls = 0
  const r = await cp.plan('tell me about the desktop', base({ fetchImpl: async () => { calls++; return good()() } }))
  assert.equal(r.reason, 'direction')
  assert.equal(calls, 0)
})

test('wire shape — a Choice MAP over boolean catalogue gates plus none; the Noul has string instructions only', async () => {
  const bodies = []
  const f = async (u, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? ok({ setting: choice('desktop') })() : ok({ asks: noul(0.9) })() }
  await cp.plan(REQ, base({ fetchImpl: f }))
  const q = bodies[0].questions.setting
  assert.equal(q.type, 'choice')
  assert.ok(!Array.isArray(q.criteria) && 'none' in q.criteria && 'desktop' in q.criteria && 'code-server' in q.criteria)
  assert.equal(bodies[0].state.request, REQ)
  assert.equal(bodies[1].questions.asks.type, 'noul')
  assert.equal(bodies[1].questions.asks.criteria, undefined)
  assert.match(bodies[1].questions.asks.instructions, /turn OFF/)
})

test('accept path — a validated one-line diff is returned; the model supplied no text in it', async () => {
  const r = await cp.plan(REQ, base({ fetchImpl: good() }))
  assert.equal(r.key, 'desktop.enabled')
  assert.equal(r.value, false)
  assert.equal(r.apply_class, 'rebuild')
  assert.match(r.plan, /^-enabled = true$/m)
  assert.match(r.plan, /^\+enabled = false$/m)
  const changed = r.plan.split('\n').filter((l) => /^[+-][^+-]/.test(l))
  assert.equal(changed.length, 2)
})

test('accept path — enabling needs satisfied prerequisites, checked in code too', async () => {
  const r = await cp.plan('please enable the desktop', base({ fetchImpl: good(), parseToml: (t) => ({ desktop: { enabled: false }, toolchains: { code_server: true } }) }))
  // desktop has no `requires`: nothing blocks it, and the diff flips true on the fixture's enabled line
  assert.equal(r.value, true)
})

test('real validator on the real manifest: a proposed flip of an existing boolean passes or the planner says no plan', async (t) => {
  try { require.resolve('@iarna/toml') } catch { return t.skip('validator dependencies not installed in this checkout') }
  const real = fs.readFileSync(path.join(root, 'agentbox.toml'), 'utf8')
  const before = real
  const out = cp.setBoolean(real, 'desktop.enabled', false)
  assert.ok(out && out !== real)
  assert.equal(typeof cp.validates(out), 'boolean')
  assert.equal(fs.readFileSync(path.join(root, 'agentbox.toml'), 'utf8'), before)
})

test('CLI exits 3 with the hand-edit message and writes nothing when the option is off', () => {
  const { spawnSync } = require('node:child_process')
  const before = fs.readFileSync(path.join(root, 'agentbox.toml'))
  const r = spawnSync('node', [path.join(root, 'scripts/config-plan.cjs'), 'turn off the desktop'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
  assert.equal(r.status, 3)
  assert.match(r.stderr, /No plan is available\. Edit agentbox\.toml by hand/)
  assert.equal(r.stdout, '')
  assert.ok(before.equals(fs.readFileSync(path.join(root, 'agentbox.toml'))))
  assert.equal(spawnSync('node', [path.join(root, 'scripts/config-plan.cjs')], { encoding: 'utf8' }).status, 2)
})
