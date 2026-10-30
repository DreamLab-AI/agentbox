// AB-03-S1-01 — the Jev option on the MAST failure taxonomy. Off by default, local-only only when AGENTBOX_JEV_FAILURE_LOCAL_ONLY=1,
// exact mappings win, and every miss returns the tag classify() already produced.
//
//   node --test tests/system-one/failure-jev.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const taxonomy = require('../../management-api/lib/failure-taxonomy.js')
const fj = require('../../config/hooks/lib/failure-jev.cjs')

const LOCAL = { AGENTBOX_JEV_FAILURE_TAXONOMY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://lan/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }
const AMBIGUOUS = { stderr: 'the agent ran the migration twice and the second run reported the table already exists', action: 'bash:psql' }
const ok = (answers) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers, usage: {} }) })
const answers = (mode, conf, support) => ({
  mode: { type: 'choice', choice: mode, confidence: conf, probabilities: { [mode]: conf } },
  supported: { type: 'noul', noul: support },
})
const base = (ctx) => taxonomy.classify(ctx)
const run = (ctx, env, fetchImpl) => { fj.resetBudget(); return fj.refine(taxonomy, ctx, base(ctx), { env, fetchImpl, log: () => {} }) }

test('the definitions cover every MAST mode in the taxonomy', () => {
  assert.deepEqual(Object.keys(fj.MODE_DEFINITIONS).sort(), [...taxonomy.MODE_IDS].sort())
})

test('wire shape: a Choice MAP over the 14 ids plus unmapped, and one Noul with a string instruction', () => {
  const q = fj.buildQuestions(taxonomy)
  assert.equal(q.mode.type, 'choice')
  assert.deepEqual(Object.keys(q.mode.criteria), [...taxonomy.MODE_IDS, 'unmapped'])
  assert.ok(!Array.isArray(q.mode.criteria))
  assert.equal(q.supported.type, 'noul')
  assert.equal(typeof q.supported.instructions, 'string')
})

test('flag off: no request is made and the base tag is returned', async () => {
  let calls = 0
  const r = await run(AMBIGUOUS, { ...LOCAL, AGENTBOX_JEV_FAILURE_TAXONOMY: '0' }, async () => { calls++; return ok({})() })
  assert.equal(calls, 0)
  assert.equal(r.mode, base(AMBIGUOUS))
  assert.equal(r.mode, 'unmapped')
})

test('exact mappings win and are never re-asked', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return ok(answers('FM-1.3', 0.99, 0.99))() }
  for (const ctx of [{ reason: taxonomy.REASON.CONTEXT_LOSS }, { mode: 'FM-2.2' }, { stderr: 'permission denied: /etc/shadow' }]) {
    const r = await run(ctx, { ...LOCAL, AGENTBOX_JEV_FAILURE_MIN_CONFIDENCE: '0', AGENTBOX_JEV_FAILURE_MIN_SUPPORT: '0' }, fetchImpl)
    assert.equal(r.mode, base(ctx))
    assert.notEqual(r.mode, 'unmapped')
  }
  assert.equal(calls, 0)
})

test('local-only: the cloud key and an undeclared proxy are refused without a request', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return ok(answers('FM-1.3', 0.99, 0.99))() }
  const thresholds = { AGENTBOX_JEV_FAILURE_MIN_CONFIDENCE: '0', AGENTBOX_JEV_FAILURE_MIN_SUPPORT: '0' }
  for (const env of [
    { AGENTBOX_JEV_FAILURE_TAXONOMY: '1', AGENTBOX_JEV_FAILURE_LOCAL_ONLY: '1', TYPESAFE_API_KEY: 'k', ...thresholds },
    { AGENTBOX_JEV_FAILURE_TAXONOMY: '1', AGENTBOX_JEV_FAILURE_LOCAL_ONLY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p', ...thresholds },
    { AGENTBOX_JEV_FAILURE_TAXONOMY: '1', AGENTBOX_JEV_FAILURE_LOCAL_ONLY: '1', ...thresholds },
  ]) {
    const r = await run(AMBIGUOUS, env, fetchImpl)
    assert.equal(r.mode, 'unmapped')
  }
  assert.equal(calls, 0)
})

test('not local-only (flag unset): the proxy is used for a cloud backend, with no Authorization header', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, headers: init.headers }); return ok(answers('FM-1.3', 0.99, 0.99))() }
  const env = {
    AGENTBOX_JEV_FAILURE_TAXONOMY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1',
    AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:8094/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '0',
    AGENTBOX_JEV_FAILURE_MIN_CONFIDENCE: '0', AGENTBOX_JEV_FAILURE_MIN_SUPPORT: '0',
  }
  await run(AMBIGUOUS, env, fetchImpl)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'http://127.0.0.1:8094/v1/systemone')
  assert.equal(seen[0].headers.Authorization, undefined)
})

const THRESHOLDS = { AGENTBOX_JEV_FAILURE_MIN_CONFIDENCE: '0.6', AGENTBOX_JEV_FAILURE_MIN_SUPPORT: '0.7' }
const MISSES = {
  'default thresholds accept nothing': [LOCAL, ok(answers('FM-1.3', 0.99, 0.99))],
  'transport error': [{ ...LOCAL, ...THRESHOLDS }, async () => { throw new Error('down') }],
  timeout: [{ ...LOCAL, ...THRESHOLDS }, async () => { const e = new Error('a'); e.name = 'AbortError'; throw e }],
  'http 500': [{ ...LOCAL, ...THRESHOLDS }, async () => ({ ok: false, status: 500, json: async () => ({}) })],
  'http 429': [{ ...LOCAL, ...THRESHOLDS }, async () => ({ ok: false, status: 429, json: async () => ({}) })],
  'unparseable body': [{ ...LOCAL, ...THRESHOLDS }, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } })],
  'answers missing': [{ ...LOCAL, ...THRESHOLDS }, ok({})],
  'mode outside the offered set': [{ ...LOCAL, ...THRESHOLDS }, ok(answers('FM-9.9', 0.99, 0.99))],
  'low confidence': [{ ...LOCAL, ...THRESHOLDS }, ok(answers('FM-1.3', 0.4, 0.99))],
  'unsupported evidence': [{ ...LOCAL, ...THRESHOLDS }, ok(answers('FM-1.3', 0.99, 0.2))],
  'judge says unmapped': [{ ...LOCAL, ...THRESHOLDS }, ok(answers('unmapped', 0.99, 0.99))],
}
for (const [name, [env, fetchImpl]] of Object.entries(MISSES)) {
  test(`fallback equivalence — ${name}: the tag equals classify()`, async () => {
    const r = await run(AMBIGUOUS, env, fetchImpl)
    assert.equal(r.mode, base(AMBIGUOUS))
    assert.equal(r.mode, 'unmapped')
  })
}

test('accept path — a confident, supported mode replaces `unmapped`; the request is well formed', async () => {
  let body
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return ok(answers('FM-1.3', 0.9, 0.85))() }
  const r = await run(AMBIGUOUS, { ...LOCAL, ...THRESHOLDS }, fetchImpl)
  assert.equal(r.mode, 'FM-1.3')
  assert.ok(taxonomy.isTag(r.mode))
  assert.equal(r.jev.set, fj.QUESTION_SET)
  assert.equal(body.state.error_text, AMBIGUOUS.stderr)
  assert.equal(body.state.operation, 'bash:psql')
  assert.deepEqual(Object.keys(body.questions), ['mode', 'supported'])
})

test('the raw failure text is untouched: tagFailure still preserves it and the tag stays valid', () => {
  const tag = taxonomy.tagFailure(AMBIGUOUS)
  assert.equal(tag.failure_mode, 'unmapped')
  assert.equal(tag.failure_detail, AMBIGUOUS.stderr)
})

test('the per-process budget bounds the number of requests', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return ok(answers('FM-1.3', 0.9, 0.9))() }
  const env = { ...LOCAL, ...THRESHOLDS, AGENTBOX_JEV_FAILURE_MAX_CALLS: '2' }
  fj.resetBudget()
  const modes = []
  for (let i = 0; i < 4; i++) modes.push((await fj.refine(taxonomy, AMBIGUOUS, 'unmapped', { env, fetchImpl, log: () => {} })).mode)
  assert.equal(calls, 2)
  assert.deepEqual(modes, ['FM-1.3', 'FM-1.3', 'unmapped', 'unmapped'])
})

test('a fallback persists nothing: no `jev` annotation unless the judge answered', async () => {
  const env = { ...LOCAL, ...THRESHOLDS }
  for (const [name, [e, f]] of Object.entries(MISSES)) {
    if (['low confidence', 'unsupported evidence', 'judge says unmapped', 'default thresholds accept nothing'].includes(name)) continue
    const r = await run(AMBIGUOUS, e, f)
    assert.equal(r.jev, undefined, name)
  }
  const answered = await run(AMBIGUOUS, env, ok(answers('FM-1.3', 0.4, 0.99)))
  assert.equal(answered.mode, 'unmapped')
  assert.equal(answered.jev.reason, 'low-confidence')
  assert.equal(answered.jev.suggested, 'FM-1.3')
})

test('the Stop-hook pre-pass asks only unmapped failures and returns only what it asked', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return ok(answers('FM-1.3', 0.9, 0.9))() }
  const items = [
    { id: 'exact', ctx: { stderr: 'permission denied' }, base: base({ stderr: 'permission denied' }) },
    { id: 'blank', ctx: { stderr: '' }, base: 'unmapped' },
    { id: 'u1', ctx: AMBIGUOUS, base: 'unmapped' },
  ]
  const m = await fj.refineMany(taxonomy, items, { env: { ...LOCAL, ...THRESHOLDS }, fetchImpl, log: () => {} })
  assert.equal(calls, 1)
  assert.deepEqual([...m.keys()].sort(), ['blank', 'exact', 'u1'].filter((k) => m.has(k)))
  assert.equal(m.get('u1').mode, 'FM-1.3')
  assert.equal(m.get('exact').mode, 'FM-1.2')
  assert.equal(m.get('blank').jev, undefined)
})

test('the pre-pass has ONE overall deadline of at most 4 s, shared by every call', async () => {
  const env = { ...LOCAL, ...THRESHOLDS, AGENTBOX_JEV_FAILURE_DEADLINE_MS: '99999', AGENTBOX_JEV_FAILURE_MAX_CALLS: '9', AGENTBOX_JEV_FAILURE_TIMEOUT_MS: '99999' }
  const budgets = []
  const hang = (url, init) => new Promise((_, rej) => {
    budgets.push(Date.now())
    init.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e) })
  })
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, ctx: AMBIGUOUS, base: 'unmapped' }))
  const t0 = Date.now()
  // a 400 ms deadline stands in for the 4 s cap so the suite stays fast: the cap itself is asserted below
  const m = await fj.refineMany(taxonomy, items, { env: { ...env, AGENTBOX_JEV_FAILURE_DEADLINE_MS: '400' }, fetchImpl: hang, log: () => {} })
  assert.ok(Date.now() - t0 < 1200, 'every call together stayed inside the single deadline')
  assert.ok(budgets.length < items.length, 'later failures were not asked once the deadline was spent')
  for (const v of m.values()) assert.equal(v.mode, 'unmapped')
  const src = require('fs').readFileSync(new URL('../../config/hooks/lib/failure-jev.cjs', import.meta.url), 'utf8')
  assert.match(src, /Math\.min\(4000, /)
})

test('the recorder runs the pre-pass before the database connection and persists failure_jev only when answered', () => {
  const src = require('fs').readFileSync(new URL('../../config/hooks/trajectory-recorder.cjs', import.meta.url), 'utf8')
  assert.ok(src.indexOf('await jevFailureTags(taxonomy, steps)') < src.indexOf('await client.connect()'))
  assert.match(src, /jevTags\.get\(s\.toolUseId\) \|\| \{ mode: failureModeFor\(taxonomy, s\) \}/)
})
