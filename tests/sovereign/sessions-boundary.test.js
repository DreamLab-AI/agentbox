'use strict';

/**
 * ADR-043 D4.1-D4.5 / PRD-021 WS3 — the /v1/sessions/boundary shim. Verifies
 * that a create binds a did:nostr + session URN + beads epic + project-scoped
 * memory namespace, that create is idempotent on the AoE session id, and that
 * turn/close map onto the beads lifecycle. A fake beads adapter isolates the
 * test from SQLite; a temp state + identity dir isolates the registry + keyfiles.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Fastify = require('../../management-api/node_modules/fastify');

// agent-identity's did derivation calls nostr-tools, which lives only in
// management-api/node_modules and is not resolvable under jest's repo-root
// rootDir. The did primitive is agent-identity's own tested concern; here we
// mock it deterministically (distinct profile ⇒ distinct pubkey) so the test
// exercises the ROUTE's binding/idempotency/namespace logic, not key derivation.
jest.mock('../../management-api/lib/agent-identity', () => ({
  loadOrMint: ({ profile }) => {
    const nodeCrypto = require('crypto');
    const pubkey = nodeCrypto.createHash('sha256').update(`profile:${profile}`).digest('hex');
    return { did: `did:nostr:${pubkey}`, pubkey, multikey: `fe70102${pubkey}`, minted: true, persisted: true };
  },
}));

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makeFakeBeads() {
  const store = new Map();
  let n = 0;
  return {
    _implName: 'local-sqlite',
    enabled: true,
    calls: { createEpic: 0, createChild: 0, claim: 0, close: 0 },
    async createEpic(opts) {
      this.calls.createEpic += 1;
      const id = `urn:agentbox:bead:${opts.actor}:epic-${++n}`;
      const row = { id, title: opts.title, type: 'epic', status: 'open', actor: opts.actor };
      store.set(id, row);
      return row;
    },
    async createChild(opts) {
      this.calls.createChild += 1;
      const id = `urn:agentbox:bead:${opts.actor}:child-${++n}`;
      const row = { id, title: opts.title, type: 'child', parent_id: opts.parent_id, status: 'open', actor: opts.actor };
      store.set(id, row);
      return row;
    },
    async claim(id, actor) { this.calls.claim += 1; const r = store.get(id); r.status = 'claimed'; r.actor = actor; return r; },
    async close(id, outcome) { this.calls.close += 1; const r = store.get(id); r.status = 'closed'; r.outcome = outcome; return r; },
  };
}

describe('/v1/sessions/boundary', () => {
  let app;
  let beads;
  let tmpState;
  let tmpIdentity;
  const OPERATOR = 'f'.repeat(64);

  beforeAll(async () => {
    tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'aoe-state-'));
    tmpIdentity = fs.mkdtempSync(path.join(os.tmpdir(), 'aoe-ids-'));
    process.env.AGENTBOX_STATE_DIR = tmpState;
    process.env.AGENTBOX_AGENT_IDENTITY_DIR = tmpIdentity;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR;
    delete process.env.AGENTBOX_AGENT_PRIVKEY_HEX; // ensure per-profile derivation

    beads = makeFakeBeads();
    app = Fastify();
    app.decorate('adapters', { beads });
    app.register(require('../../management-api/routes/sessions-boundary'), { logger, manifest: {} });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(tmpIdentity, { recursive: true, force: true }); } catch (_) {}
  });

  it('create binds did:nostr + session URN + epic + project namespace', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'create', session_id: 'sess-1', slug: 'openrouter', tool: 'claude', project_path: '/home/dev/MyRepo' },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.did).toMatch(/^did:nostr:[0-9a-f]{64}$/);
    expect(b.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(b.session_urn).toMatch(/^urn:agentbox:activity:[0-9a-f]{64}:/);
    expect(b.epic_urn).toMatch(/^urn:agentbox:bead:/);
    expect(b.memory_namespace).toBe(`user:${b.pubkey}:proj:myrepo`);
    expect(beads.calls.createEpic).toBe(1);
  });

  it('create is idempotent on the session id (no duplicate epic)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'create', session_id: 'sess-1', slug: 'openrouter', project_path: '/home/dev/MyRepo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reused).toBe(true);
    expect(beads.calls.createEpic).toBe(1); // unchanged
  });

  it('distinct slugs derive distinct dids', async () => {
    const a = (await app.inject({ method: 'POST', url: '/v1/sessions/boundary', payload: { phase: 'create', session_id: 'sess-a', slug: 'alpha' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/v1/sessions/boundary', payload: { phase: 'create', session_id: 'sess-b', slug: 'beta' } })).json();
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  // Finding 5 (security-remediation): the record filename is sha256(id), not a
  // character-sanitised form. The old _safeId collapsed every char outside
  // [A-Za-z0-9._-] to '_', so two DISTINCT ids that differ only in such a char
  // (here `coll/x` vs `coll_x`) mapped to ONE file — the second create silently
  // overwrote the first session's identity record. This asserts they now persist
  // as two independent records and neither clobbers the other.
  it('distinct ids that collided under _safeId keep independent records', async () => {
    const slash = (await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'create', session_id: 'coll/x', slug: 'collalpha' },
    })).json();
    const under = (await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'create', session_id: 'coll_x', slug: 'collbeta' },
    })).json();

    // Distinct slugs ⇒ distinct derived pubkeys (mock derives from profile).
    expect(slash.pubkey).not.toBe(under.pubkey);

    // Two distinct files on disk — the old scheme would have produced one.
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const dir = path.join(tmpState, 'sessions');
    expect(fs.existsSync(path.join(dir, `${sha('coll/x')}.json`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${sha('coll_x')}.json`))).toBe(true);

    // Re-create `coll/x`: it must resolve to ITS OWN record (collalpha), proving
    // `coll_x` (collbeta) did not overwrite it. Under the old collision this
    // would have returned collbeta's pubkey.
    const reuse = (await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'create', session_id: 'coll/x', slug: 'collalpha' },
    })).json();
    expect(reuse.reused).toBe(true);
    expect(reuse.pubkey).toBe(slash.pubkey);
    expect(reuse.pubkey).not.toBe(under.pubkey);
  });

  it('turn creates + claims a child under the session epic', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'turn', session_id: 'sess-1', turn_title: 'do a thing' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().child_urn).toMatch(/^urn:agentbox:bead:/);
    expect(beads.calls.createChild).toBe(1);
    expect(beads.calls.claim).toBe(1);
  });

  it('close closes the session epic', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/sessions/boundary',
      payload: { phase: 'close', session_id: 'sess-1', outcome: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(beads.calls.close).toBe(1);
  });
});
