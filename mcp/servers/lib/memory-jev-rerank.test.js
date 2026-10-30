'use strict';
// AB-20-S1-01 — the Jev option on model-facing memory search.
//   node --test mcp/servers/lib/memory-jev-rerank.test.js
// Mocked transport only. Fallback cases assert the result is the SAME object (and so the same
// shaped output) as without the option; the accept path asserts the rerank survives shaping.
const test = require('node:test');
const assert = require('node:assert/strict');
const rr = require('./memory-jev-rerank');
const { shapeSearchResponse } = require('./memory-tools');

const LOCAL = { AGENTBOX_JEV_MEMORY_RERANK: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://lan/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1' };
const rows = () => [
  { key: 'a', value: 'The deploy script lives in scripts/launch.sh', namespace: 'project-state', source_type: 'semantic', score: 0.82 },
  { key: 'b', value: 'Retries use exponential backoff on HTTP 429', namespace: 'project-state', source_type: 'semantic', score: 0.78 },
  { key: 'c', value: 'Lunch is at noon', namespace: 'personal-context', source_type: 'semantic', score: 0.7 },
];
const res = () => ({ success: true, action: 'search', query: 'q', namespace: '*', results: rows(), count: 3, method: 'hnsw-xinference' });
const score = (n) => ({ type: 'score', score: n, confidence: 0.9, legend: { 0: 'a', 1: 'b', 2: 'c' } });
const reply = (answers) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers, usage: {} }) });
const logs = [];
const opts = (env, fetchImpl) => ({ env, fetchImpl, log: (l) => logs.push(l) });
const QUERY = 'how does the client handle rate limiting';

test('flag off: the pool is the limit, nothing is requested and the very same object is returned', async () => {
  let calls = 0;
  const input = res();
  const out = await rr.rerank(QUERY, input, opts({ ...LOCAL, AGENTBOX_JEV_MEMORY_RERANK: '0' }, async () => { calls++; return reply({})(); }));
  assert.equal(out, input);
  assert.equal(calls, 0);
  assert.equal(rr.poolFor(5, { AGENTBOX_JEV_MEMORY_RERANK: '0' }), 5);
  assert.equal(rr.poolFor(5, {}), 5);
  assert.equal(rr.poolFor(5, LOCAL), 5);                                   // default: the query is unchanged
  assert.equal(rr.poolFor(5, { ...LOCAL, AGENTBOX_JEV_MEMORY_POOL: '12' }), 12); // explicit opt-in overfetch
  assert.equal(rr.poolFor(5, { ...LOCAL, AGENTBOX_JEV_MEMORY_POOL: '99' }), 20); // capped
  assert.equal(rr.poolFor(50, { ...LOCAL, AGENTBOX_JEV_MEMORY_POOL: '10' }), 50);
});

test('not local-only (flag unset): the proxy is used for a cloud backend, with no Authorization header', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, headers: init.headers }); return reply({})(); };
  const env = { AGENTBOX_JEV_MEMORY_RERANK: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:8094/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '0' };
  await rr.rerank(QUERY, res(), opts(env, fetchImpl));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://127.0.0.1:8094/v1/systemone');
  assert.equal(seen[0].headers.Authorization, undefined);
});

const bad = {
  'cloud key only (local-only consumer)': [{ AGENTBOX_JEV_MEMORY_RERANK: '1', AGENTBOX_JEV_MEMORY_LOCAL_ONLY: '1', TYPESAFE_API_KEY: 'k' }, reply({})],
  'proxy not declared local': [{ AGENTBOX_JEV_MEMORY_RERANK: '1', AGENTBOX_JEV_MEMORY_LOCAL_ONLY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p' }, reply({})],
  'no endpoint': [{ AGENTBOX_JEV_MEMORY_RERANK: '1' }, reply({})],
  'transport error': [LOCAL, async () => { throw new Error('down'); }],
  timeout: [LOCAL, async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; }],
  'http 500': [LOCAL, async () => ({ ok: false, status: 500, json: async () => ({}) })],
  'http 429': [LOCAL, async () => ({ ok: false, status: 429, json: async () => ({}) })],
  'unparseable body': [LOCAL, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })],
  'answers missing': [LOCAL, reply({})],
  'one score missing': [LOCAL, reply({ rel_0: score(0), rel_1: score(2) })],
  'score out of shape': [LOCAL, reply({ rel_0: score(0), rel_1: { type: 'score' }, rel_2: score(1) })],
  'low relevance everywhere': [LOCAL, reply({ rel_0: score(0.2), rel_1: score(0.4), rel_2: score(0.1) })],
};
for (const [name, [env, fetchImpl]] of Object.entries(bad)) {
  test(`fallback equivalence — ${name}: same object, same shaped output`, async () => {
    const input = res();
    const out = await rr.rerank(QUERY, input, opts(env, fetchImpl));
    assert.equal(out, input);
    assert.deepEqual(shapeSearchResponse(out, { full: true }), shapeSearchResponse(res(), { full: true }));
  });
}

test('fallback equivalence — degraded, single-row and failed results are never sent', async () => {
  let calls = 0;
  const f = async () => { calls++; return reply({})(); };
  for (const input of [{ ...res(), degraded: true }, { ...res(), results: rows().slice(0, 1) }, { success: false, error: 'x' }, null]) {
    assert.equal(await rr.rerank(QUERY, input, opts(LOCAL, f)), input);
  }
  assert.equal(calls, 0);
});

test('wire shape: a Score per candidate (ordered list of levels), one Noul, snippets bounded, state carries the query', async () => {
  let body;
  await rr.rerank(QUERY, res(), opts(LOCAL, async (u, init) => { body = JSON.parse(init.body); return reply({})(); }));
  assert.deepEqual(Object.keys(body.questions), ['rel_0', 'rel_1', 'rel_2', 'answered']);
  for (const k of ['rel_0', 'rel_1', 'rel_2']) {
    assert.equal(body.questions[k].type, 'score');
    assert.ok(Array.isArray(body.questions[k].criteria));
    assert.equal(body.questions[k].criteria.length, 3);
  }
  assert.equal(body.questions.answered.type, 'noul');
  assert.equal(body.state.query, QUERY);
  assert.deepEqual(Object.keys(body.state.memories), ['m0', 'm1', 'm2']);
  const long = res(); long.results[0].value = 'x'.repeat(5000);
  assert.ok(rr.buildRequest('q', long.results).state.memories.m0.length <= rr.SNIPPET_CHARS + 1);
  assert.equal(JSON.stringify(body).includes('namespace'), false);
});

test('accept path: confident scores reorder, score stays cosine, shaping keeps the order, the cosine floor still applies', async () => {
  const input = res();
  const out = await rr.rerank(QUERY, input, opts(LOCAL, reply({
    rel_0: score(0), rel_1: score(2), rel_2: score(1), answered: { type: 'noul', noul: 0.9 },
  })));
  assert.deepEqual(out.results.map((r) => r.key), ['b', 'c', 'a']);
  assert.deepEqual(out.results.map((r) => r.score), [0.78, 0.7, 0.82]);   // cosine untouched
  assert.equal(out._reranked.set, rr.QUESTION_SET);
  assert.equal(out._reranked.reordered, 3);
  assert.equal(out._reranked.no_answer_p, 0.1);
  assert.equal(input.results[0].key, 'a');                                  // the input is not mutated
  const shaped = shapeSearchResponse(out, { full: true, limit: 2 });
  assert.deepEqual(shaped.results.map((r) => r.key), ['b', 'c']);
  const floored = shapeSearchResponse(out, { full: true, minScore: 0.75 });
  assert.deepEqual(floored.results.map((r) => r.key), ['b', 'a']);          // c (cosine 0.70) is under the floor
  assert.deepEqual(shapeSearchResponse(res(), { full: true }).results.map((r) => r.key), ['a', 'b', 'c']);
});

test('a no-answer verdict annotates only; no row is dropped', async () => {
  const out = await rr.rerank(QUERY, res(), opts(LOCAL, reply({
    rel_0: score(2), rel_1: score(1), rel_2: score(0), answered: { type: 'noul', noul: 0.02 },
  })));
  assert.equal(out.results.length, 3);
  assert.equal(out._reranked.no_answer_p, 0.98);
});

test('ties keep the cosine order (stable), and rows beyond the pool keep their place', async () => {
  const input = res();
  const out = await rr.rerank(QUERY, input, opts(LOCAL, reply({ rel_0: score(1), rel_1: score(1), rel_2: score(2) })));
  assert.deepEqual(out.results.map((r) => r.key), ['c', 'a', 'b']);
});

test('the option is wired into the model-facing search path only', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'ruvector-mcp.cjs'), 'utf8');
  assert.match(src, /memoryJevRerank\.poolFor\(limit\)/);
  assert.match(src, /memoryJevRerank\.rerank\(query, raw\)/);
});
