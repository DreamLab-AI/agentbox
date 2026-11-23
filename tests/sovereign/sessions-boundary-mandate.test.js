'use strict';

/**
 * AB-11 — the eager mandate at the session boundary: the container is inside the
 * pod owner's pod (`/pods/<owner>/proj/<slug>/`), the grant is enforced at the
 * pod, and a missing signer is a note on the session (which still starts), never
 * an unsigned mandate.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');

jest.mock('../../management-api/lib/agent-identity', () => ({
  loadOrMint: ({ profile }) => {
    const nodeCrypto = require('crypto');
    const pubkey = nodeCrypto.createHash('sha256').update(`profile:${profile}`).digest('hex');
    return { did: `did:nostr:${pubkey}`, pubkey, multikey: `fe70102${pubkey}`, minted: true, persisted: true };
  },
}));

const registry = require('../../management-api/lib/mandate-registry');
const { makeDeps, logger, OWNER } = require('./helpers/mandate-fakes');

describe('sessions-boundary eager mandate (AB-11)', () => {
  let tmpState; let tmpIdentity; let prev;
  beforeEach(() => {
    tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-state-'));
    tmpIdentity = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ids-'));
    prev = { s: process.env.AGENTBOX_STATE_DIR, i: process.env.AGENTBOX_AGENT_IDENTITY_DIR, o: process.env.AGENTBOX_X_ONLY_PUBKEY_HEX };
    process.env.AGENTBOX_STATE_DIR = tmpState;
    process.env.AGENTBOX_AGENT_IDENTITY_DIR = tmpIdentity;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OWNER;
  });
  afterEach(() => {
    for (const [k, v] of [['AGENTBOX_STATE_DIR', prev.s], ['AGENTBOX_AGENT_IDENTITY_DIR', prev.i], ['AGENTBOX_X_ONLY_PUBKEY_HEX', prev.o]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmpState, { recursive: true, force: true });
    fs.rmSync(tmpIdentity, { recursive: true, force: true });
  });

  async function appWith(deps) {
    const app = Fastify();
    app.decorate('adapters', { beads: null });
    app.register(require('../../management-api/routes/sessions-boundary'), { logger, manifest: {}, mandateDeps: deps });
    await app.ready();
    return app;
  }
  const create = (app, payload) => app.inject({
    method: 'POST', url: '/v1/sessions/boundary',
    payload: { phase: 'create', session_id: `s-${Math.random()}`, slug: 'eager', eager_mandate: true, ...payload },
  });

  it('grants over /pods/<owner>/proj/<slug>/ and PUTs the sidecar at the pod', async () => {
    const deps = makeDeps();
    const app = await appWith(deps);
    const res = await create(app, { project_path: '/home/dev/My Repo' });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.mandate_urn).toMatch(/^urn:agentbox:mandate:/);
    const reg = registry.load();
    const entry = Object.values(reg)[0];
    expect(entry.record.container).toBe(`/pods/${OWNER}/proj/my-repo/`);
    expect(entry.state).toBe('active');
    expect(deps.pod.files.get(`/pods/${OWNER}/proj/my-repo.acl`)).toContain(b.pubkey);
    await app.close();
  });

  it('no signer: the session still starts (201), no mandate_urn, a note says why, nothing was minted', async () => {
    const deps = makeDeps({ signer: null });
    const app = await appWith(deps);
    const res = await create(app, { project_path: '/home/dev/Repo' });
    expect(res.statusCode).toBe(201);
    expect(res.json().mandate_urn).toBeNull();
    expect(JSON.stringify(res.json().notes)).toMatch(/eager mandate mint failed/);
    expect(registry.load()).toEqual({});
    await app.close();
  });

  it('a mandate_container outside the owner pod is refused (a note), not granted', async () => {
    const deps = makeDeps();
    const app = await appWith(deps);
    for (const mandate_container of ['/proj/legacy/', `/pods/${'9'.repeat(64)}/proj/x/`]) {
      const res = await create(app, { mandate_container });
      expect(res.statusCode).toBe(201);
      expect(res.json().mandate_urn).toBeNull();
    }
    expect(deps.pod.calls).toHaveLength(0);
    await app.close();
  });

  it('a hostile slug can never become a dot segment or a sidecar name', async () => {
    const deps = makeDeps();
    const app = await appWith(deps);
    for (const [slug, want] of [['..', 'workspace'], ['.', 'workspace'], ['x.acl', 'x-acl'], ['y.meta', 'y-meta']]) {
      const res = await create(app, { repo_slug: slug });
      expect(res.statusCode).toBe(201);
      expect(Object.values(registry.load()).map((e) => e.record.container)).toContain(`/pods/${OWNER}/proj/${want}/`);
    }
    await app.close();
  });
});
