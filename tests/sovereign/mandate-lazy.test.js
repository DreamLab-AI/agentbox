'use strict';

/**
 * ADR-043 D4.5 / PRD-021 F3-5 — the lazy mint-if-absent mandate helper — as
 * AMENDED by AB-11. A session's mandate is minted on first pod write, scoped to
 * the container being written, and a second write to the same container reuses
 * it rather than minting a duplicate. Unlike the original ADR text, signing is
 * FAIL-CLOSED: with no pod-owner signer nothing is minted (the old "unsigned but
 * minted" fail-open case is deliberately gone), and a revoked mandate is a
 * tombstone that ensureMandate will not re-mint over.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const { ensureMandate } = require('../../management-api/routes/mandate');
const registry = require('../../management-api/lib/mandate-registry');
const { SignerUnavailable } = require('../../management-api/lib/mandate-signer');
const { makeDeps, logger, OWNER } = require('./helpers/mandate-fakes');

const AGENT = 'c'.repeat(64);
const FOO = `/pods/${OWNER}/proj/foo/`;
const BAR = `/pods/${OWNER}/proj/bar/`;

describe('ensureMandate — lazy mint-if-absent', () => {
  let tmp; let prev;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-reg-'));
    prev = { s: process.env.AGENTBOX_STATE_DIR, o: process.env.AGENTBOX_X_ONLY_PUBKEY_HEX };
    process.env.AGENTBOX_STATE_DIR = tmp;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OWNER;
  });
  afterEach(() => {
    for (const [k, v] of [['AGENTBOX_STATE_DIR', prev.s], ['AGENTBOX_X_ONLY_PUBKEY_HEX', prev.o]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('mints a mandate scoped to the container on first call, and it is enforced at the pod', async () => {
    const deps = makeDeps();
    const m = await ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger, deps });
    expect(m.reused).toBe(false);
    expect(m.urn).toMatch(/^urn:agentbox:mandate:[0-9a-f]{64}:/);
    expect(m.record.agent).toBe(`did:nostr:${AGENT}`);
    expect(m.record.container).toBe(FOO);
    expect(m.record.pod).toBe(OWNER);
    expect(m.signed).toBe(true);
    expect(m.acl_turtle).toContain(`acl:agent <did:nostr:${AGENT}>`);
    expect(deps.pod.files.get(`/pods/${OWNER}/proj/foo.acl`)).toContain(`did:nostr:${AGENT}`);
  });

  it('reuses the existing mandate for the same agent+container without touching the pod', async () => {
    const deps = makeDeps();
    await ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger, deps });
    deps.pod.calls.length = 0;
    const second = await ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger, deps });
    expect(second.reused).toBe(true);
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('mints a distinct mandate for a different container', async () => {
    const deps = makeDeps();
    const a = await ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger, deps });
    const b = await ensureMandate({ agent: AGENT, container: BAR, manifest: {}, logger, deps });
    expect(b.reused).toBe(false);
    expect(b.urn).not.toBe(a.urn);
  });

  it('FAIL-CLOSED (amends ADR-043 D4.5): with no pod-owner signer nothing is minted, not even an unsigned record', async () => {
    const deps = makeDeps({ signer: null });
    await expect(ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger, deps })).rejects.toBeInstanceOf(SignerUnavailable);
    expect(registry.load()).toEqual({});
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('with no signer configured at all, the production resolver refuses (no sovereign identity file) rather than minting unsigned', async () => {
    delete process.env.AGENTBOX_STACK;
    const prevRoot = process.env.AGENTBOX_IDENTITY_ROOT;
    process.env.AGENTBOX_IDENTITY_ROOT = path.join(tmp, 'no-identities');
    try {
      await expect(ensureMandate({ agent: AGENT, container: FOO, manifest: {}, logger }))
        .rejects.toBeInstanceOf(SignerUnavailable);
    } finally {
      if (prevRoot === undefined) delete process.env.AGENTBOX_IDENTITY_ROOT; else process.env.AGENTBOX_IDENTITY_ROOT = prevRoot;
    }
    expect(registry.load()).toEqual({});
  });
});
