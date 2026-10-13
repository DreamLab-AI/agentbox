'use strict';
// ontomark step 2 (ontomark/iri): EXP-10 row AB-02 (and the slug half of AB-01)
//
// Run: node --test management-api/tests/ontomark-iri-migration.test.js
//
// Red until the consumer takes class IRIs from ontomark AND the local slug
// and IRI-minting logic is gone. The checks name the defining construct (the
// non-alphanumeric-to-hyphen slug rule, the urn:ngm:class: namespace text),
// not the identifier it is called today, so renaming a helper or spelling a
// concatenation as `.concat()` / `.join()` does not turn it green. Helpers are
// in ./ontomark-migration-lib.js (shared by the five agentbox migration tests).
//
// Ordering note (DEPRECATION §9.1): the ontomark CLI is only baked into the
// image by the cli-publish step (AB-P1..P5). A consumer counts as "on
// ontomark" only with that Nix pin, so the pin test below stays red until
// agentbox's flake lands; it must land before, or with, the first CLI caller.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require('./ontomark-migration-lib');

const report = (hits) => hits.map((h) => `${h.file}:${h.line} ${h.what}`).join('\n  ');

test('AB-02: no module mints a urn:ngm:class: IRI or holds its namespace text (a startsWith/includes test is not minting)', () => {
  const found = [];
  for (const rel of L.ontologyScope()) {
    for (const h of L.iriMintSites(L.parseJs(rel))) found.push({ file: rel, ...h });
  }
  // ontology-local.js:325,327 only RECOGNISE the namespace (startsWith) and are not reported by the detector.
  assert.deepEqual(found, [],
    `AB-02: IRI minting survives (ontology-propose.js:64,173-177 IRI_NAMESPACE; submit-proposals.mjs:100; elevation-stage.js:136) or moved:\n  ${report(found)}`);
});

test('AB-01/AB-02: no module slugs a title locally (non-alphanumerics collapsed to a hyphen), under any name', () => {
  // bc20-provenance-bridge.js:137 slugs for `urn:visionclaw:concept:` (VisionClaw's own scheme, RETAIN per DEPRECATION §7.3).
  const RETAINED_UNRELATED = new Set(['management-api/lib/bc20-provenance-bridge.js']);
  const found = [];
  for (const rel of L.ontologyScope()) {
    if (RETAINED_UNRELATED.has(rel)) continue;
    for (const h of L.slugRuleSites(L.parseJs(rel))) found.push({ file: rel, ...h });
  }
  assert.deepEqual(found, [],
    `AB-01/AB-02: the local slug rule survives (ontology-apply.js:176 slugify; submit-proposals.mjs slugFromPage) or moved:\n  ${report(found)}`);
});

test('AB-01/AB-02: nothing imports a slug helper from ontology-apply any more (importers repointed)', () => {
  const importers = [];
  for (const rel of L.jsSources()) {
    const names = L.importedNames(rel, /(^|\/)ontology-apply(\.js)?$/).filter((n) => /slug/i.test(n));
    if (names.length) importers.push(`${rel} imports ${names.join(', ')}`);
  }
  assert.deepEqual(importers, [],
    `AB-01: ontology-propose.js:56 and elevation-stage.js:40 still import a slug helper from ontology-apply:\n  ${importers.join('\n  ')}`);
});

test('AB-02: a proposal IRI is not minted locally from a term when the CLI cannot answer', async (t) => {
  L.stubTools(t); // both stub binaries answer `null` to every verb
  const file = path.join(L.ROOT, 'management-api', 'lib', 'ontology-propose.js');
  const propose = require(file);
  if (typeof propose.proposalIri !== 'function') return; // export removed
  let iri;
  try { iri = await Promise.resolve(propose.proposalIri({ preferred_term: 'Photon Sieve' }, {})); } catch { iri = undefined; }
  assert.ok(!(typeof iri === 'string' && /photon-sieve/.test(iri)),
    `AB-02: proposalIri still derives ${iri} from the term itself (ontology-propose.js:173-177); the IRI must be reported by the ontomark CLI`);
});

test('AB-02: the IRI consumers invoke the ontomark CLI (slug / find / retrieve) from live code', () => {
  const verbs = new Set(['slug', 'find', 'retrieve']);
  for (const rel of ['management-api/lib/ontology-propose.js', 'skills/podcast-knowledge-ingest/submit-proposals.mjs']) {
    assert.ok(L.invokesOntomark(rel, verbs),
      `AB-02: ${rel} must take the class IRI from an ontomark call (a reachable call site with a literal verb, not a constant or a comment)`);
  }
});

test('pin: the CLI these callers invoke is pinned in flake.nix and flake.lock (AB-P1/P2 land before the first CLI caller)', () => {
  const problems = L.ontomarkPinProblems();
  assert.deepEqual(problems, [], `AB-P1/AB-P2: ${problems.join('; ')}`);
});

test('wiring: the migration test is in the command CI runs (management-api `test:node`, finding 9)', () => {
  assert.ok(L.wiredIntoTestNode('ontomark-iri-migration.test.js'),
    'management-api/package.json `test:node` must list tests/ontomark-iri-migration.test.js (Jest roots exclude tests/; node --test does not discover it by itself)');
});
