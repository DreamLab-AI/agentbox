'use strict';
// Tests for the ontology augmentation retrieval brain + budget governor.
// Run: node --test agentbox/mcp/servers/lib/ontology-retrieval.test.js
const test = require('node:test');
const assert = require('node:assert');
const budget = require('./ontology-budget');
const { createOntologyRetrieval, createTtlCache, breadcrumb, serialiseTurtle, defaultSeedFn, defaultExpandFn } = require('./ontology-retrieval');

const SEEDS = [
  { iri: 'https://narrativegoldmine.com/ns/v1#smart-contract', label: 'Smart Contract', domain: 'blockchain', maturity: 'mature', summary: 'A self-executing agreement.', relations: ['enables', 'requires', 'subClassOf'] },
  { iri: 'https://narrativegoldmine.com/ns/v1#draft-thing', label: 'Draft Thing', domain: 'blockchain', maturity: 'draft', summary: 'low maturity' },
  { iri: 'https://narrativegoldmine.com/ns/v1#page-x', label: 'Page X', maturity: undefined, summary: 'a knowledge page (no maturity)' },
];

function bigSeeds(n) {
  return Array.from({ length: n }, (_, i) => ({
    iri: `https://narrativegoldmine.com/ns/v1#class-${i}`,
    label: `Class number ${i} with a deliberately verbose label to inflate tokens`,
    domain: 'spatial-computing', maturity: 'established',
    summary: 'x'.repeat(400),
  }));
}

test('budget: clampToBudget never exceeds tier ceiling', () => {
  const huge = 'y'.repeat(100000);
  for (const tier of ['booster', 'haiku', 'sonnet', 'opus']) {
    const r = budget.clampToBudget(huge, tier);
    assert.ok(r.tokens <= budget.tierConfig(tier).maxTokens, `${tier} respects ceiling`);
    assert.strictEqual(r.truncated, true);
  }
});

test('budget: max_tokens override can only LOWER, never raise the ceiling', () => {
  assert.strictEqual(budget.resolveBudget('opus', 999999), 6000); // capped at tier max
  assert.strictEqual(budget.resolveBudget('opus', 1000), 1000);   // lowered
  assert.strictEqual(budget.resolveBudget('sonnet'), 2000);       // default
});

test('budget: full:true forbidden below sonnet', () => {
  assert.strictEqual(budget.isFullAllowed('booster'), false);
  assert.strictEqual(budget.isFullAllowed('haiku'), false);
  assert.strictEqual(budget.isFullAllowed('sonnet'), true);
  assert.strictEqual(budget.isFullAllowed('opus'), true);
});

test('retrieval: full:true downgraded (not rejected) below sonnet', async () => {
  const ret = createOntologyRetrieval({ seedFn: async () => SEEDS });
  const r = await ret.ask({ query: 'smart contract', model_tier: 'haiku', full: true });
  assert.strictEqual(r.full_denied, true);
  assert.ok(r.turtle.length > 0, 'still returns menu grounding');
});

test('retrieval: tokens_used within tier budget even with many seeds', async () => {
  const ret = createOntologyRetrieval({ seedFn: async () => bigSeeds(50) });
  const r = await ret.ask({ query: 'anything', model_tier: 'sonnet' });
  assert.ok(r.tokens_used <= 2000, `tokens ${r.tokens_used} <= 2000`);
});

test('retrieval: maturity gate drops draft, keeps mature + unknown(page)', async () => {
  const ret = createOntologyRetrieval({ seedFn: async () => SEEDS });
  const r = await ret.ask({ query: 'x', model_tier: 'opus' });
  assert.ok(r.seed_iris.some((i) => i.endsWith('smart-contract')), 'keeps mature');
  assert.ok(r.seed_iris.some((i) => i.endsWith('page-x')), 'keeps unknown-maturity page');
  assert.ok(!r.seed_iris.some((i) => i.endsWith('draft-thing')), 'drops draft');
});

test('retrieval: fail-open on throwing seedFn → degraded empty, no throw', async () => {
  const ret = createOntologyRetrieval({ seedFn: async () => { throw { error: 'ontology_unavailable' }; } });
  const r = await ret.ask({ query: 'x' });
  assert.strictEqual(r.degraded, true);
  assert.strictEqual(r.turtle, '');
  assert.strictEqual(r.tokens_used, 0);
});

test('retrieval: expand fail-open degrades to menu (still returns seeds)', async () => {
  const ret = createOntologyRetrieval({
    seedFn: async () => SEEDS,
    expandFn: async () => { throw new Error('timeout'); },
  });
  const r = await ret.ask({ query: 'x', model_tier: 'sonnet', mode: 'expand' });
  assert.ok(r.seed_iris.length > 0, 'menu survives expand failure');
  assert.strictEqual(r.degraded, false, 'expand failure is not a hard degrade');
});

test('retrieval: cache hit on identical request', async () => {
  let calls = 0;
  const ret = createOntologyRetrieval({ seedFn: async () => { calls++; return SEEDS; } });
  await ret.ask({ query: 'repeat', model_tier: 'sonnet' });
  const r2 = await ret.ask({ query: 'repeat', model_tier: 'sonnet' });
  assert.strictEqual(calls, 1, 'second call served from cache');
  assert.strictEqual(r2.cache_hit, true);
});

test('retrieval: empty query returns empty without calling seedFn', async () => {
  let called = false;
  const ret = createOntologyRetrieval({ seedFn: async () => { called = true; return SEEDS; } });
  const r = await ret.ask({ query: '   ' });
  assert.strictEqual(called, false);
  assert.strictEqual(r.turtle, '');
});

test('breadcrumb: <= 80 token PUSH line, single line', () => {
  const bc = breadcrumb(SEEDS);
  assert.ok(bc.startsWith('[ONTOLOGY]'));
  assert.ok(!bc.includes('\n'), 'single line');
  assert.ok(budget.estimateTokens(bc) <= 80, `breadcrumb ${budget.estimateTokens(bc)} tok <= 80`);
});

test('ttl cache: expires after ttl', () => {
  let now = 1000;
  const c = createTtlCache({ ttlMs: 100, clock: () => now });
  c.set('k', 'v');
  assert.strictEqual(c.get('k'), 'v');
  now = 1200;
  assert.strictEqual(c.get('k'), undefined, 'expired');
});

test('classifyCause: splits auth/validation from availability', () => {
  const { classifyCause } = require('./ontology-retrieval');
  assert.strictEqual(classifyCause({ error: 'visionclaw_http_401' }), 'auth_or_validation');
  assert.strictEqual(classifyCause({ error: 'sparql_readonly' }), 'auth_or_validation');
  assert.strictEqual(classifyCause(new Error('connect ECONNREFUSED')), 'availability');
  assert.strictEqual(classifyCause({ error: 'ontology_timeout' }), 'timeout');
});

test('serialise: renders urn: IRIs as full angle-bracket (no vc: prefix mismatch)', () => {
  const t = serialiseTurtle([{ iri: 'urn:ngm:class:datalog-kg', label: 'Datalog KG', maturity: 'mature' }], []);
  assert.ok(t.includes('<urn:ngm:class:datalog-kg> a owl:Class'), t);
  assert.ok(!t.includes('vc:urn:'), 'no double-prefix');
});

test('breadcrumb: clean local-name for urn: IRI', () => {
  const bc = breadcrumb([{ iri: 'urn:ngm:class:datalog-kg', maturity: 'mature', domain: 'ai' }]);
  assert.ok(bc.includes('vc:datalog-kg'), bc);
  assert.ok(!bc.includes('urn:ngm'), bc);
});

test('defaultSeedFn: unwraps the {success,data:{results}} VisionClaw envelope', async () => {
  const fakeFetch = async () => ({ success: true, data: { results: [
    { iri: 'urn:ngm:class:x', preferred_term: 'X', relevance_score: 0.9 },
  ] }, error: null });
  const seeds = await defaultSeedFn(fakeFetch)({ query: 'x' });
  assert.strictEqual(seeds.length, 1);
  assert.strictEqual(seeds[0].iri, 'urn:ngm:class:x');
});

test('defaultExpandFn: unwraps {success,data:{results:{bindings}}}', async () => {
  const fakeFetch = async () => ({ success: true, data: { results: { bindings: [
    { s: { type: 'uri', value: 'urn:ngm:class:a' }, p: { type: 'uri', value: 'p' }, o: { type: 'uri', value: 'urn:ngm:class:b' } },
  ] } }, error: null });
  const triples = await defaultExpandFn(fakeFetch)({ seedIris: ['urn:ngm:class:a'], depth: 1 });
  assert.strictEqual(triples.length, 1);
  assert.ok(triples[0].s.includes('urn:ngm:class:a'));
});
