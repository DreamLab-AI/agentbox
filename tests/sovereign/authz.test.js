'use strict';

/**
 * Security remediation (findings 2 & 3) — the shared authz policy in
 * management-api/lib/authz.js. This is the ONE predicate the relay consumer and
 * the HTTP front doors share, so it must be exact: the allowlist is the operator
 * key + relay allowed_pubkeys + the two env vars; only the operator is operator;
 * only allowlisted keys approve; session-agent binding matches the did stored in
 * the sessions registry regardless of the on-disk filename scheme.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const authz = require('../../management-api/lib/authz');

const OPERATOR = 'f'.repeat(64);
const APPROVER = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);
const SESSION_PK = 'a'.repeat(64);

describe('authz — shared authorization policy', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['AGENTBOX_X_ONLY_PUBKEY_HEX', 'AGENTBOX_PUBKEY', 'AGENTBOX_RELAY_ALLOWED_PUBKEYS', 'AGENTBOX_APPROVAL_ALLOWLIST', 'AGENTBOX_STATE_DIR']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('approvalAllowlist unions operator + relay config + env vars (hex-validated)', () => {
    process.env.AGENTBOX_APPROVAL_ALLOWLIST = `${APPROVER},not-hex,${'e'.repeat(64)}`;
    const set = authz.approvalAllowlist({ sovereign_mesh: { relay: { allowed_pubkeys: [STRANGER, 'ZZZ'] } } });
    expect(set.has(OPERATOR)).toBe(true);   // operator
    expect(set.has(APPROVER)).toBe(true);   // env allowlist
    expect(set.has('e'.repeat(64))).toBe(true); // env allowlist 2
    expect(set.has(STRANGER)).toBe(true);   // relay config
    expect(set.has('not-hex')).toBe(false); // malformed rejected
    expect(set.has('zzz')).toBe(false);
  });

  it('isOperator is true only for the operator key', () => {
    expect(authz.isOperator(OPERATOR)).toBe(true);
    expect(authz.isOperator(OPERATOR.toUpperCase())).toBe(true); // case-insensitive
    expect(authz.isOperator(APPROVER)).toBe(false);
    expect(authz.isOperator('not-hex')).toBe(false);
  });

  it('isApprover admits allowlisted keys and rejects strangers', () => {
    const manifest = { sovereign_mesh: { relay: { allowed_pubkeys: [APPROVER] } } };
    expect(authz.isApprover(OPERATOR, manifest)).toBe(true);
    expect(authz.isApprover(APPROVER, manifest)).toBe(true);
    expect(authz.isApprover(STRANGER, manifest)).toBe(false);
  });

  it('isBearer / authenticatedPubkey resolve the acting identity', () => {
    expect(authz.isBearer({ auth: { mode: 'bearer' } })).toBe(true);
    expect(authz.isBearer({ auth: { mode: 'nip98', pubkey: APPROVER } })).toBe(false);
    expect(authz.authenticatedPubkey({ auth: { mode: 'nip98', pubkey: APPROVER } })).toBe(APPROVER);
    expect(authz.authenticatedPubkey({ auth: { mode: 'bearer' } })).toBe(OPERATOR); // bearer == operator
    expect(authz.authenticatedPubkey({ auth: {} })).toBeNull();
  });

  describe('isSessionAgent — bound-did lookup', () => {
    let tmp;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-sess-'));
      process.env.AGENTBOX_STATE_DIR = tmp;
      const dir = path.join(tmp, 'sessions');
      fs.mkdirSync(dir, { recursive: true });
      // A record written under a HASHED filename (finding 5) still carries the
      // original session_id + bound did/pubkey inside — the lookup must find it.
      const fname = `${crypto.createHash('sha256').update('sess-42').digest('hex')}.json`;
      fs.writeFileSync(path.join(dir, fname), JSON.stringify({
        session_id: 'sess-42', did: `did:nostr:${SESSION_PK}`, pubkey: SESSION_PK,
      }));
    });
    afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

    it('matches the bound pubkey/did for the session', () => {
      expect(authz.isSessionAgent(SESSION_PK, 'sess-42')).toBe(true);
    });
    it('rejects a different key and an unknown session', () => {
      expect(authz.isSessionAgent(STRANGER, 'sess-42')).toBe(false);
      expect(authz.isSessionAgent(SESSION_PK, 'no-such-session')).toBe(false);
    });
  });

  describe('requireOperator / requireApprover preHandlers', () => {
    function capture() {
      const calls = { code: null, body: null };
      const reply = { code(c) { calls.code = c; return this; }, send(b) { calls.body = b; return this; } };
      return { calls, reply };
    }

    it('requireOperator: 403 for a non-operator nip98, pass for operator + bearer', async () => {
      const pre = authz.requireOperator({});
      let c = capture();
      await pre({ auth: { mode: 'nip98', pubkey: STRANGER } }, c.reply);
      expect(c.calls.code).toBe(403);

      c = capture();
      await pre({ auth: { mode: 'nip98', pubkey: OPERATOR } }, c.reply);
      expect(c.calls.code).toBeNull(); // passed

      c = capture();
      await pre({ auth: { mode: 'bearer' } }, c.reply);
      expect(c.calls.code).toBeNull(); // operator bearer passes
    });

    it('requireApprover: 403 for a bearer and for a non-allowlisted nip98', async () => {
      const manifest = { sovereign_mesh: { relay: { allowed_pubkeys: [APPROVER] } } };
      const pre = authz.requireApprover({ manifest });

      let c = capture();
      await pre({ auth: { mode: 'bearer' } }, c.reply);
      expect(c.calls.code).toBe(403); // a bearer can never approve

      c = capture();
      await pre({ auth: { mode: 'nip98', pubkey: STRANGER } }, c.reply);
      expect(c.calls.code).toBe(403);

      c = capture();
      await pre({ auth: { mode: 'nip98', pubkey: APPROVER } }, c.reply);
      expect(c.calls.code).toBeNull(); // allowlisted approver passes
    });
  });
});
