// AB-22-S1-01 / AB-22-S1-04 — the Jev option on the live skill router.
//
//   node --test tests/system-one/skill-route-jev.test.mjs
//
// Both refinements are off by default and ride in the router's one request. The suite holds
// the contract of guides/jev-option-contract.md §7: fallback equivalence against the
// pre-change output, wire shape, and the accept path. The transport is mocked; nothing
// here dials a network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lib = require('../../config/hooks/lib/skill-route.cjs')

const CANDIDATES = {
  'pdf-forms': 'Fill, flatten and validate PDF forms. Not for editing prose in a document (docx).',
  docx: 'Create and edit Word documents, tracked changes and templates. Not for PDF forms.',
  'solar-planner': 'Plan ground-mounted solar farm layouts, tilt and yield.',
  'git-hygiene': 'Clean up branches, rebase and resolve merge conflicts.',
}
const PROMPT = 'please fill in this pdf form and validate the fields, then edit the word document template and fix the branch before I send it off'

const baseEnv = {
  AGENTBOX_SKILL_ROUTER: 'jev', TYPESAFE_API_KEY: 'k-test', AGENTBOX_SKILL_ROUTE_LOG: '0',
  AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: '0', AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: '0',
}
const cfgOf = (extra = {}) => lib.config({ ...baseEnv, ...extra })
const strip = (r) => { const { ms, ...rest } = r; return rest }

/** Install a mock fetch for one call; returns the captured bodies. */
async function withFetch(impl, fn) {
  const seen = []
  const prev = globalThis.fetch
  globalThis.fetch = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return impl(seen.at(-1)) }
  try { return { out: await fn(), seen } } finally { globalThis.fetch = prev }
}
const ok = (answers) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'jev-1', answers, usage: { input_tokens: 100, output_tokens: 1 } }) })
const choiceAnswer = (choice, others = {}) => ({ type: 'choice', choice, confidence: 0.8, probabilities: { [choice]: 0.8, ...others } })

/** Reply by question name: the skill Choice (always by name), any Noul/facet answers and, when asked, the blind Choice. */
function reply(fits = {}, pick = 'pdf-forms', facets = {}, blind = pick, blindConf = 0.8) {
  return ({ body }) => {
    const answers = { skill: choiceAnswer(pick) }
    for (const k of Object.keys(body.questions)) {
      if (k.startsWith('fit_')) answers[k] = fits[k] === undefined ? { type: 'noul', noul: 0.9 } : fits[k]
    }
    if (body.questions.skill_blind) {
      const id = blind === 'none' ? 'none' : Object.keys(body.questions.skill_blind.criteria).find((k) => body.questions.skill_blind.criteria[k] === CANDIDATES[blind])
      answers.skill_blind = { ...choiceAnswer(id), confidence: blindConf }
    }
    if (body.questions.operation) answers.operation = facets.operation || { type: 'choice', choice: 'modify', confidence: 0.7, probabilities: { modify: 0.7 } }
    if (body.questions.multi_intent) answers.multi_intent = facets.multi_intent || { type: 'noul', noul: 0.1 }
    return ok(answers)
  }
}

const route = (cfg, opts = {}) => lib.route(PROMPT, cfg, { candidates: CANDIDATES, ...opts })

test('flag off: the request and the outcome are exactly the pre-change ones', async () => {
  const plain = await withFetch(reply(), () => route(cfgOf()))
  const off = await withFetch(reply(), () => route(cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '0', AGENTBOX_JEV_SKILL_INTENT: 'false' })))
  assert.deepEqual(off.seen[0].body, plain.seen[0].body)
  assert.deepEqual(Object.keys(plain.seen[0].body.questions), ['skill'])
  assert.deepEqual(strip(off.out), strip(plain.out))
  assert.equal(off.out.jev, undefined)
  assert.equal(lib.formatContext(off.out), lib.formatContext(plain.out))
})

test('flag on, default thresholds (accept nothing): the real `skill` question is byte-identical and a disagreeing blind pick changes nothing', async () => {
  const off = await withFetch(reply(), () => route(cfgOf()))
  const on = await withFetch(reply({ fit_0: { type: 'noul', noul: 0.01 } }, 'pdf-forms', {}, 'git-hygiene', 0.99), () =>
    route(cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_INTENT: '1' })))
  assert.deepEqual(on.seen[0].body.questions.skill, off.seen[0].body.questions.skill)
  assert.deepEqual(on.seen[0].body.state, off.seen[0].body.state)
  assert.equal(on.out.choice, off.out.choice)
  assert.equal(on.out.none, off.out.none)
  assert.equal(on.out.verified, undefined)
  assert.equal(on.out.jev.blindPick, 'git-hygiene')      // reported, not adopted
  assert.equal(on.out.jev.blindAdopted, undefined)
  assert.equal(lib.formatContext(on.out), lib.formatContext(off.out))
})

const FAILURES = {
  'transport error': () => { throw new Error('ECONNRESET') },
  timeout: () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e },
  'http 500': () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }),
  'http 429': () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }),
  'http 529': () => ({ ok: false, status: 529, headers: { get: () => null }, json: async () => ({}) }),
  'unparseable body': () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('x') } }),
  'missing answers': () => ok(undefined),
}
for (const [name, impl] of Object.entries(FAILURES)) {
  test(`fallback equivalence — ${name}: the option on yields the same outcome as the option off`, async () => {
    const off = await withFetch(impl, () => route(cfgOf()))
    for (const env of [{ AGENTBOX_JEV_SKILL_VERIFY: '1' }, { AGENTBOX_JEV_SKILL_INTENT: '1' }, { AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_INTENT: '1' }]) {
      const on = await withFetch(impl, () => route(cfgOf(env)))
      assert.deepEqual(strip(on.out), strip(off.out))
      assert.equal(on.out.outcome, 'failed')
    }
  })
}

test('fallback equivalence — key unset: skipped for the same reason with or without the option', async () => {
  const env = { ...baseEnv, TYPESAFE_API_KEY: '' }
  const off = await lib.route(PROMPT, lib.config(env), { candidates: CANDIDATES })
  const on = await lib.route(PROMPT, lib.config({ ...env, AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_INTENT: '1' }), { candidates: CANDIDATES })
  assert.deepEqual(on, off)
  assert.equal(on.reason, 'no-key')
})

test('fallback equivalence — malformed fit answers leave the pick untouched and annotate the reason', async () => {
  const off = await withFetch(reply(), () => route(cfgOf()))
  const on = await withFetch(reply({ fit_0: { type: 'noul' }, fit_1: 'nope', fit_2: { type: 'noul', noul: 7 } }), () =>
    route(cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_VETO_BELOW: '0.99' })))
  assert.equal(on.out.choice, off.out.choice)
  assert.equal(on.out.none, false)
  assert.equal(on.out.jev.reason, 'malformed')
  assert.equal(lib.formatContext(on.out), lib.formatContext(off.out))
})

test('wire shape — verify: a Choice map plus one Noul per BM25 shortlist candidate, descriptions carried in the instructions', async () => {
  const { seen } = await withFetch(reply(), () => route(cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_K: '2' })))
  const q = seen[0].body.questions
  assert.equal(q.skill.type, 'choice')
  assert.ok(!Array.isArray(q.skill.criteria) && typeof q.skill.criteria === 'object')
  assert.ok('none' in q.skill.criteria)
  assert.deepEqual(Object.keys(q).filter((k) => k.startsWith('fit_')), ['fit_0', 'fit_1'])
  for (const k of ['fit_0', 'fit_1']) {
    assert.equal(q[k].type, 'noul')
    assert.equal(typeof q[k].instructions, 'string')
    assert.equal(q[k].criteria, undefined)
  }
  assert.match(q.fit_0.instructions, /Fill, flatten and validate PDF forms/)
  assert.match(q.fit_0.instructions, /user_request/)
  assert.equal(seen[0].body.state.user_request, PROMPT)
  assert.equal(lib.JEV_SKILL_QUESTION_SET, 'skill-route-jev/1')
})

test('wire shape — intent: a separate blind Choice over opaque ids, the real question untouched, facet Choice and multi-intent Noul', async () => {
  const { seen, out } = await withFetch(reply(), () => route(cfgOf({ AGENTBOX_JEV_SKILL_INTENT: '1' })))
  const q = seen[0].body.questions
  assert.deepEqual(Object.keys(q.skill.criteria).filter((k) => k !== 'none'), Object.keys(CANDIDATES))
  const keys = Object.keys(q.skill_blind.criteria)
  assert.deepEqual(keys.filter((k) => k !== 'none'), ['cap_01', 'cap_02', 'cap_03', 'cap_04'])
  assert.ok(keys.includes('none'))
  for (const name of Object.keys(CANDIDATES)) assert.ok(!keys.includes(name))
  assert.equal(q.skill_blind.type, 'choice')
  assert.ok(!Array.isArray(q.skill_blind.criteria))
  assert.equal(q.operation.type, 'choice')
  assert.deepEqual(Object.keys(q.operation.criteria), Object.keys(lib.JEV_FACETS))
  assert.equal(q.multi_intent.type, 'noul')
  assert.equal(out.choice, 'pdf-forms')
  assert.equal(out.jev.blindPick, 'pdf-forms')
  assert.equal(out.jev.operation, 'modify')
  assert.equal(out.jev.multiIntent, 0.1)
})

test('intent: an id the request never offered, or a missing blind answer, leaves the real pick and annotates malformed', async () => {
  const bogus = await withFetch(() => ok({ skill: choiceAnswer('pdf-forms'), skill_blind: choiceAnswer('cap_99'), operation: { type: 'choice', choice: 'modify' }, multi_intent: { type: 'noul', noul: 0.1 } }), () =>
    route(cfgOf({ AGENTBOX_JEV_SKILL_INTENT: '1', AGENTBOX_JEV_SKILL_BLIND_ADOPT_AT: '0' })))
  assert.equal(bogus.out.outcome, 'routed')
  assert.equal(bogus.out.choice, 'pdf-forms')
  assert.equal(bogus.out.jev.reason, 'malformed')
  const missing = await withFetch(() => ok({ skill: choiceAnswer('docx') }), () => route(cfgOf({ AGENTBOX_JEV_SKILL_INTENT: '1', AGENTBOX_JEV_SKILL_BLIND_ADOPT_AT: '0' })))
  assert.equal(missing.out.choice, 'docx')
  assert.equal(missing.out.jev.reason, 'malformed')
})

test('accept path — the blind pick is adopted only when it differs and clears blindAdoptAt; its `none` is restored to none', async () => {
  const cfg = cfgOf({ AGENTBOX_JEV_SKILL_INTENT: '1', AGENTBOX_JEV_SKILL_BLIND_ADOPT_AT: '0.7' })
  const adopt = await withFetch(reply({}, 'pdf-forms', {}, 'docx', 0.9), () => route(cfg))
  assert.equal(adopt.out.choice, 'docx')
  assert.equal(adopt.out.jev.blindAdopted, true)
  const weak = await withFetch(reply({}, 'pdf-forms', {}, 'docx', 0.5), () => route(cfg))
  assert.equal(weak.out.choice, 'pdf-forms')
  const agree = await withFetch(reply({}, 'pdf-forms', {}, 'pdf-forms', 0.99), () => route(cfg))
  assert.equal(agree.out.jev.blindAdopted, undefined)
  const none = await withFetch(reply({}, 'pdf-forms', {}, 'none', 0.95), () => route(cfg))
  assert.equal(none.out.none, true)
  assert.equal(lib.formatContext(none.out), '')
})

test('accept path — an adopted pick is still verified: a low fit Noul vetoes it', async () => {
  const cfg = cfgOf({ AGENTBOX_JEV_SKILL_INTENT: '1', AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_BLIND_ADOPT_AT: '0.5', AGENTBOX_JEV_SKILL_VETO_BELOW: '0.5' })
  // shortlist order is pdf-forms (fit_0), docx (fit_1); the adopted docx fails its verification
  const { out } = await withFetch(reply({ fit_0: { type: 'noul', noul: 0.9 }, fit_1: { type: 'noul', noul: 0.1 } }, 'pdf-forms', {}, 'docx', 0.9), () => route(cfg))
  assert.equal(out.jev.vetoed, 'docx')
  assert.equal(out.none, true)
})

test('accept path — a low fit Noul vetoes the pick to none once vetoBelow is set; nothing is injected', async () => {
  const cfg = cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_VETO_BELOW: '0.5' })
  const { out } = await withFetch(reply({ fit_0: { type: 'noul', noul: 0.12 } }), () => route(cfg))
  assert.equal(out.none, true)
  assert.equal(out.choice, 'none')
  assert.equal(out.jev.vetoed, 'pdf-forms')
  assert.equal(lib.formatContext(out), '')
})

test('accept path — a confident fit keeps the pick and, with listAtLeast set, lists further verified fits', async () => {
  const cfg = cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_VETO_BELOW: '0.5', AGENTBOX_JEV_SKILL_LIST_AT_LEAST: '0.8' })
  const { out } = await withFetch(reply({ fit_0: { type: 'noul', noul: 0.95 }, fit_1: { type: 'noul', noul: 0.85 }, fit_2: { type: 'noul', noul: 0.2 } }), () => route(cfg))
  assert.equal(out.choice, 'pdf-forms')
  assert.equal(out.none, false)
  assert.equal(out.verified.length, 1)
  assert.match(lib.formatContext(out), /Also verified: /)
  assert.ok(lib.formatContext(out).length <= lib.MAX_CONTEXT_CHARS)
})

test('authority — a pick outside the shortlist is not vetoed, and an explicit skill request bypasses the option', async () => {
  const outside = await withFetch(reply({}, 'git-hygiene'), () =>
    route(cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_K: '1', AGENTBOX_JEV_SKILL_VETO_BELOW: '1' })))
  assert.equal(outside.out.choice, 'git-hygiene')
  assert.equal(outside.out.jev.reason, 'unverified')
  const explicit = await withFetch(reply(), () =>
    lib.route('use the docx skill to tidy this letter up for me please', cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_INTENT: '1' }), { candidates: CANDIDATES }))
  assert.deepEqual(Object.keys(explicit.seen[0].body.questions), ['skill'])
  assert.equal(lib.explicitSkillRequest('use the docx skill please', Object.keys(CANDIDATES)), true)
  assert.equal(lib.explicitSkillRequest('fill the pdf form', Object.keys(CANDIDATES)), false)
})

test('the request still carries no Authorization behind the loopback proxy', async () => {
  const cfg = cfgOf({ AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', TYPESAFE_API_KEY: '' })
  const { seen } = await withFetch(reply(), () => route(cfg))
  assert.equal(seen[0].init.headers.Authorization, undefined)
})
