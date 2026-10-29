// The shared Jev-option adapter: endpoint resolution order, local-only refusal, readers and
// the never-throws call. Mocked transport only.
//
//   node --test tests/system-one/jev-option.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const j = require('../../config/hooks/lib/jev-option.cjs')

test('flags are off unless explicitly opted in', () => {
  for (const v of [undefined, '', '0', 'false', 'off', 'maybe']) assert.equal(j.enabled({ F: v }, 'F'), false)
  for (const v of ['1', 'true', 'YES', 'on']) assert.equal(j.enabled({ F: v }, 'F'), true)
})

test('endpoint resolution: explicit, then proxy, then TypeSafe with a key, else unavailable', () => {
  const ex = j.resolveEndpoint({ MY_KEY: 'k', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p/v1/systemone' },
    { explicit: { url: 'http://x/v1/systemone', model: 'm', keyEnv: 'MY_KEY' } })
  assert.equal(ex.via, 'explicit'); assert.equal(ex.headers.Authorization, 'Bearer k')
  const proxy = j.resolveEndpoint({ AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p/v1/systemone', AGENTBOX_SKILL_ROUTE_MODEL: 'pm', TYPESAFE_API_KEY: 'k' })
  assert.equal(proxy.via, 'proxy'); assert.equal(proxy.model, 'pm'); assert.equal(proxy.headers.Authorization, undefined)
  const named = j.resolveEndpoint({ AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://e', AGENTBOX_SYSTEM_ONE_MODEL: 'em' })
  assert.equal(named.url, 'http://e'); assert.equal(named.model, 'em')
  const cloud = j.resolveEndpoint({ TYPESAFE_API_KEY: 'k' })
  assert.equal(cloud.url, j.DEFAULT_URL); assert.equal(cloud.model, 'jev-latest'); assert.equal(cloud.headers.Authorization, 'Bearer k')
  assert.deepEqual(j.resolveEndpoint({}), { ok: false, reason: 'no-endpoint' })
  assert.deepEqual(j.resolveEndpoint({ AGENTBOX_SYSTEM_ONE_PROXY: '1' }), { ok: false, reason: 'no-endpoint' })
})

test('a local-only consumer refuses the proxy and the cloud unless the endpoint is declared local', () => {
  const cloud = { TYPESAFE_API_KEY: 'k' }
  const proxy = { AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p' }
  assert.equal(j.resolveEndpoint(cloud, { localOnly: true }).reason, 'local-only')
  assert.equal(j.resolveEndpoint(proxy, { localOnly: true }).reason, 'local-only')
  assert.equal(j.resolveEndpoint({ ...proxy, AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' }, { localOnly: true }).ok, true)
  assert.equal(j.resolveEndpoint({}, { localOnly: true, explicit: { url: 'http://lan/v1/systemone', local: true } }).ok, true)
  assert.equal(j.resolveEndpoint({}, { localOnly: true, explicit: { url: 'http://lan/v1/systemone' } }).reason, 'local-only')
})

test('question builders follow the wire format', () => {
  assert.deepEqual(j.choiceQuestion('i', { a: 'x' }), { type: 'choice', instructions: 'i', criteria: { a: 'x' } })
  assert.deepEqual(j.scoreQuestion('i', ['lo', 'hi']), { type: 'score', instructions: 'i', criteria: ['lo', 'hi'] })
  assert.deepEqual(j.noulQuestion('i'), { type: 'noul', instructions: 'i' })
})

test('readers reject shapes the caller did not offer', () => {
  assert.deepEqual(j.readChoice({ choice: 'a', confidence: 0.6 }, ['a', 'b']), { choice: 'a', confidence: 0.6 })
  assert.equal(j.readChoice({ choice: 'z' }, ['a', 'b']), null)
  assert.equal(j.readChoice('a', ['a']), null)
  assert.equal(j.readNoul({ noul: 0.7 }), 0.7)
  for (const bad of [null, {}, { noul: 2 }, { noul: 'x' }]) assert.equal(j.readNoul(bad), null)
  assert.equal(j.readScore({ score: 1, legend: { 0: 'a', 1: 'b', 2: 'c' } }), 0.5)
  assert.equal(j.readScore({ score: 1 }), null)
  assert.equal(j.readScore({ score: 1 }, 3), 0.5)
  assert.equal(j.readScore({ probabilities: { 0: 0.5, 1: 0.5 } }), 0.5)
})

const reply = (status, body, ok = status < 400) => async () => ({ ok, status, json: async () => { if (body instanceof Error) throw body; return body } })
const EP = { url: 'http://x', model: 'm', headers: {} }

test('ask resolves every failure as a reason and never throws', async () => {
  const good = await j.ask(EP, { a: 1 }, {}, { fetchImpl: reply(200, { model: 'm', answers: { q: { noul: 0.5 } }, usage: {} }) })
  assert.equal(good.ok, true)
  const cases = [
    [reply(500, {}), 'http-500'], [reply(429, {}), 'http-429'], [reply(529, {}), 'http-529'],
    [reply(200, new SyntaxError('x')), 'malformed'], [reply(200, { answers: [] }), 'malformed'], [reply(200, {}), 'malformed'],
    [async () => { throw new Error('down') }, 'network'],
    [async () => { const e = new Error('a'); e.name = 'AbortError'; throw e }, 'timeout'],
  ]
  for (const [fetchImpl, reason] of cases) assert.deepEqual({ ...(await j.ask(EP, {}, {}, { fetchImpl })), ms: 0 }, { ok: false, reason, ms: 0 })
  assert.equal((await j.ask(null, {}, {}, {})).reason, 'no-endpoint')
})

test('ask enforces a hard deadline through the abort signal', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e) }))
  const r = await j.ask(EP, {}, {}, { fetchImpl: hang, timeoutMs: 20 })
  assert.equal(r.reason, 'timeout')
})

test('the request body carries state, model and questions only', async () => {
  let seen
  await j.ask(EP, { s: 1 }, { q: j.noulQuestion('x') }, { fetchImpl: async (u, init) => { seen = JSON.parse(init.body); return reply(200, { answers: { q: { noul: 1 } } })() } })
  assert.deepEqual(Object.keys(seen).sort(), ['model', 'questions', 'state'])
})

test('the fallback log line names the reason and nothing else', () => {
  const lines = []
  const line = j.logFallback('ab-xx', 'timeout', (l) => lines.push(l))
  assert.equal(line, '[jev-option] ab-xx fallback (timeout)')
  assert.deepEqual(lines, [line])
})

 test('private route is separate from the cloud vendor and never receives its key', () => {
  const env = { AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT: 'http://systemone:8097/v1/systemone',
    AGENTBOX_SYSTEM_ONE_LOCAL_MODEL: 'laya', AGENTBOX_SYSTEM_ONE_PROXY: '1',
    AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:8094/v1/systemone', TYPESAFE_API_KEY: 'secret' }
  const local = j.resolveEndpoint(env, { localOnly: true })
  assert.equal(local.via, 'local'); assert.equal(local.local, true)
  assert.equal(local.model, 'laya'); assert.equal(local.headers.Authorization, undefined)
  assert.equal(j.resolveEndpoint(env).via, 'proxy')
  delete env.AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT
  assert.equal(j.resolveEndpoint(env, { localOnly: true }).reason, 'local-only')
 })

test('the deadline covers stalled response bodies, even with a transport that ignores abort', async () => {
  const result = await Promise.race([
    j.ask(EP, {}, {}, { timeoutMs: 20, fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) }),
    new Promise(resolve => setTimeout(() => resolve({ reason: 'deadline-not-enforced' }), 150)),
  ]);
  assert.equal(result.reason, 'timeout');
});

test('typed decisions refuse HTTP redirects', async () => {
  let redirect;
  await j.ask(EP, {}, {}, { fetchImpl: async (_url, init) => {
    redirect = init.redirect;
    return { ok:true, status:200, json:async()=>({answers:{}}) };
  }});
  assert.equal(redirect, 'error');
});
