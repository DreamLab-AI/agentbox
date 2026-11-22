import test from 'node:test';
import assert from 'node:assert/strict';
import { findHits, resolveIri, resolveRepo, slugFromPage, fpKey, proposedPage, sha256Hex } from '../submit-proposals.mjs';

test('slugFromPage lower-cases and dashes a page title', () => {
  assert.equal(slugFromPage('Agentic Workflow.md'), 'agentic-workflow');
});

test('findHits reads the bare array ontomark prints, and the older results object', () => {
  const hit = { id: 'Agentic Workflow', type: 'Class' };
  assert.deepEqual(findHits([hit]), [hit]);
  assert.deepEqual(findHits({ results: [hit] }), [hit]);
  assert.deepEqual(findHits({}), []);
  assert.deepEqual(findHits(null), []);
});

test('an exact slug match resolves to a class IRI', () => {
  const r = resolveIri('Agentic Workflow.md', () => [{ id: 'Agentic Workflow', type: 'Class' }]);
  assert.deepEqual(r, { ok: true, iri: 'urn:ngm:class:agentic-workflow', page: 'Agentic Workflow' });
});

test('a fuzzy hit is not an exact class: the lookup ran and found nothing', () => {
  const r = resolveIri('Agentic Workflow.md', () => [{ id: 'Agentic Workflows', type: 'Class' }]);
  assert.deepEqual(r, { ok: false, reason: 'no-match' });
});

test('a lookup that cannot run is an error, never "no exact class"', () => {
  const r = resolveIri('Agentic Workflow.md', () => {
    throw new Error("error: unrecognized subcommand 'find'");
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.match(r.detail, /unrecognized subcommand/);
});

test('the repository comes from VAULT_REPO, else the parent of a knowledge or working vault', () => {
  assert.equal(resolveRepo({ VAULT_REPO: '/r' }), '/r');
  assert.equal(resolveRepo({ VAULT_ROOT: '/r/knowledge' }), '/r');
  assert.equal(resolveRepo({ VAULT_ROOT: '/r/working' }), '/r');
  assert.equal(resolveRepo({ VAULT_ROOT: '/r/elsewhere' }), null);
  assert.equal(resolveRepo({}), null);
});

test('sha256Hex matches the published vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the stored page is proposed while the live page still has the drafted hash', () => {
  const live = '---\ntype: Class\n---\n# Topic\n\nBody.\n';
  const payload = { target_page_sha256: sha256Hex(live), proposed_page: `${live}\n## Recent Developments\nNew.\n` };
  assert.deepEqual(proposedPage(live, payload), { ok: true, page: payload.proposed_page });
});

test('a page that changed after drafting is stale, never spliced by guess', () => {
  const payload = { target_page_sha256: sha256Hex('old'), proposed_page: 'old + new' };
  assert.deepEqual(proposedPage('edited since', payload), { ok: false, reason: 'page-changed' });
});

test('a dossier without a hash or a stored page is an old dossier', () => {
  const edit = { mode: 'insert_after', anchor: 'Body.', content: 'X' };
  assert.deepEqual(proposedPage('Body.\n', { edit }), { ok: false, reason: 'old-dossier' });
  assert.deepEqual(proposedPage('Body.\n', { edit, target_page_sha256: sha256Hex('Body.\n') }), { ok: false, reason: 'old-dossier' });
  assert.deepEqual(proposedPage('Body.\n', undefined), { ok: false, reason: 'old-dossier' });
});

test('the idempotency key changes when the dossier is redrafted against a new page', () => {
  const fps = ['b', 'a'];
  const v1 = { assertion_fingerprints: fps, ontology_propose_payload: { target_page_sha256: 'h1' } };
  const v2 = { assertion_fingerprints: ['a', 'b'], ontology_propose_payload: { target_page_sha256: 'h2' } };
  const v1again = { assertion_fingerprints: ['a', 'b'], ontology_propose_payload: { target_page_sha256: 'h1' } };
  assert.equal(fpKey(v1), fpKey(v1again));
  assert.notEqual(fpKey(v1), fpKey(v2));
});
