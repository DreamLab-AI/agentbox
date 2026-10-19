import test from 'node:test';
import assert from 'node:assert/strict';
import { findHits, resolveIri, resolveRepo, slugFromPage } from '../submit-proposals.mjs';

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
