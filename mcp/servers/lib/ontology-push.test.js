'use strict';
// Tests for the synchronous PUSH breadcrumb generator.
// Run: node --test agentbox/mcp/servers/lib/ontology-push.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const budget = require('./ontology-budget');
const { getOntologyBreadcrumb } = require('./ontology-push');

function writeCache(classes) {
  const p = path.join(os.tmpdir(), `onto-cache-${process.pid}-${classes.length}.json`);
  fs.writeFileSync(p, JSON.stringify({ classes }));
  return p;
}

const CACHE = [
  { iri: 'https://narrativegoldmine.com/ns/v1#smart-contract', label: 'Smart Contract', domain: 'blockchain', maturity: 'mature', terms: ['solidity', 'evm', 'defi', 'token'] },
  { iri: 'https://narrativegoldmine.com/ns/v1#gaussian-splatting', label: 'Gaussian Splatting', domain: 'spatial-computing', maturity: 'emerging', terms: ['radiance', 'nerf', 'point cloud', 'rendering'] },
];

test('push: returns a clamped [ONTOLOGY] breadcrumb on a relevant prompt', () => {
  const p = writeCache(CACHE);
  const bc = getOntologyBreadcrumb('how do I audit a smart contract on the evm', { cachePath: p, minRelevance: 0.01 });
  assert.ok(bc, 'breadcrumb produced');
  assert.ok(bc.startsWith('[ONTOLOGY] seed: vc:smart-contract'), bc);
  assert.ok(!bc.includes('\n'), 'single line');
  assert.ok(budget.estimateTokens(bc) <= 80, `<=80 tok (${budget.estimateTokens(bc)})`);
});

test('push: null on off-topic prompt (relevance null-gate → 0 tokens)', () => {
  const p = writeCache(CACHE);
  const bc = getOntologyBreadcrumb('what time is the meeting tomorrow', { cachePath: p, minRelevance: 0.3 });
  assert.strictEqual(bc, null);
});

test('push: null when no cache file exists (pre-WS-2 no-op)', () => {
  const bc = getOntologyBreadcrumb('smart contract', { cachePath: '/nonexistent/onto-cache.json' });
  assert.strictEqual(bc, null);
});

test('push: null on empty prompt, never throws', () => {
  const p = writeCache(CACHE);
  assert.strictEqual(getOntologyBreadcrumb('', { cachePath: p }), null);
  assert.strictEqual(getOntologyBreadcrumb(null, { cachePath: p }), null);
});

test('push: matches the spatial class for a spatial prompt', () => {
  const p = writeCache(CACHE);
  const bc = getOntologyBreadcrumb('rendering a radiance field with point cloud splatting', { cachePath: p, minRelevance: 0.01 });
  assert.ok(bc && bc.includes('gaussian-splatting'), bc);
});
