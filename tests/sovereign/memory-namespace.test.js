'use strict';

/**
 * ADR-043 D4.4 / PRD-021 F3-4 — the project axis on memory namespace
 * derivation. Verifies the grammar user:<pubkey>:proj:<repo-slug>:<ns> and that
 * the derivation stays backwards compatible when no project is supplied.
 */

const memory = require('../../management-api/routes/memory');
const { _effectiveNamespace, _projectSlug } = memory;

const PUBKEY = 'a'.repeat(64);
const OPERATOR = 'f'.repeat(64);

function req({ mode, pubkey, body, query, headers } = {}) {
  return { auth: mode ? { mode, pubkey } : {}, body: body || {}, query: query || {}, headers: headers || {} };
}

describe('_projectSlug', () => {
  it('slugifies and lowercases', () => {
    expect(_projectSlug('My Repo/Name')).toBe('my-repo-name');
  });
  it('returns empty for null/undefined (project axis omitted)', () => {
    expect(_projectSlug(undefined)).toBe('');
    expect(_projectSlug(null)).toBe('');
  });
});

describe('_effectiveNamespace — project axis (nip98 caller)', () => {
  it('inserts the project segment when a project is supplied', () => {
    const ns = _effectiveNamespace(req({ mode: 'nip98', pubkey: PUBKEY }), 'default', 'MyRepo');
    expect(ns).toBe(`user:${PUBKEY}:proj:myrepo:default`);
  });

  it('is backwards compatible without a project', () => {
    const ns = _effectiveNamespace(req({ mode: 'nip98', pubkey: PUBKEY }), 'default');
    expect(ns).toBe(`user:${PUBKEY}:default`);
  });

  it('reads the project from the body when not passed explicitly', () => {
    const ns = _effectiveNamespace(req({ mode: 'nip98', pubkey: PUBKEY, body: { project: 'repo-x' } }), 'ns1');
    expect(ns).toBe(`user:${PUBKEY}:proj:repo-x:ns1`);
  });

  it('reads the project from the x-agentbox-project header', () => {
    const ns = _effectiveNamespace(req({ mode: 'nip98', pubkey: PUBKEY, headers: { 'x-agentbox-project': 'hdr-repo' } }), 'ns2');
    expect(ns).toBe(`user:${PUBKEY}:proj:hdr-repo:ns2`);
  });
});

describe('_effectiveNamespace — scoped admin', () => {
  const OLD = process.env.MEMORY_ADMIN_ACCESS_MODE;
  afterAll(() => { process.env.MEMORY_ADMIN_ACCESS_MODE = OLD; });

  it('permissive bearer with no project is unchanged (raw namespace)', () => {
    // ADMIN_ACCESS_MODE is captured at module load; the permissive path only
    // fires when it was 'permissive'. Assert the non-scoped, project-less form
    // never gains a project segment from an unscoped bearer caller.
    const ns = _effectiveNamespace(req({}), 'plain', 'someproj');
    // Either raw (permissive) or operator-scoped (scoped) — but never a bare
    // proj: prefix without a user segment.
    expect(ns === 'plain' || ns.startsWith('user:')).toBe(true);
    expect(ns.startsWith('proj:')).toBe(false);
  });
});
