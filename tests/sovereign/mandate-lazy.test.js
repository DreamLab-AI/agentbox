'use strict';

/**
 * ADR-043 D4.5 / PRD-021 F3-5 — the lazy mint-if-absent mandate helper. A
 * session's mandate is minted on first pod write, scoped to the container being
 * written, and a second write to the same container reuses it rather than
 * minting a duplicate. Signing is fail-open (unsigned when no operator signer).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const { ensureMandate } = require('../../management-api/routes/mandate');

const OPERATOR = 'f'.repeat(64);
const AGENT = 'a'.repeat(64);
const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('ensureMandate — lazy mint-if-absent', () => {
  let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-reg-'));
    process.env.AGENTBOX_STATE_DIR = tmp;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR;
    delete process.env.AGENTBOX_STACK;
    delete process.env.AGENTBOX_PROFILE; // no signer stack → unsigned, but minted
  });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

  it('mints a mandate scoped to the container on first call', async () => {
    const m = await ensureMandate({ issuer: OPERATOR, agent: AGENT, container: '/proj/foo/', manifest: {}, logger });
    expect(m.reused).toBe(false);
    expect(m.urn).toMatch(/^urn:agentbox:mandate:[0-9a-f]{64}:/);
    expect(m.record.agent).toBe(`did:nostr:${AGENT}`);
    expect(m.record.container).toBe('/proj/foo/');
    expect(m.acl_turtle).toContain(`acl:agent <did:nostr:${AGENT}>`);
  });

  it('reuses the existing mandate for the same agent+container', async () => {
    const first = await ensureMandate({ issuer: OPERATOR, agent: AGENT, container: '/proj/foo/', manifest: {}, logger });
    expect(first.reused).toBe(true);
  });

  it('mints a distinct mandate for a different container', async () => {
    const a = await ensureMandate({ issuer: OPERATOR, agent: AGENT, container: '/proj/foo/', manifest: {}, logger });
    const b = await ensureMandate({ issuer: OPERATOR, agent: AGENT, container: '/proj/bar/', manifest: {}, logger });
    expect(b.reused).toBe(false);
    expect(b.urn).not.toBe(a.urn);
  });
});
