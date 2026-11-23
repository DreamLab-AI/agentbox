'use strict';

/**
 * AB-11 — lib/mandate-acl: the whole container sidecar rendered from the
 * registry, and the signed pod client that PUTs/DELETEs it and reads it back.
 */

const { createMandate } = require('../../management-api/lib/mandate');
const {
  renderContainerAcl, sidecarPath, PodAclClient, PodAclError, syncContainerSidecar,
} = require('../../management-api/lib/mandate-acl');

const OWNER = 'a'.repeat(64);
const AGENT1 = 'b'.repeat(64);
const AGENT2 = 'c'.repeat(64);
const CONTAINER = `/pods/${OWNER}/proj/demo/`;

const mk = (agent, extra = {}) => createMandate({ issuer: OWNER, agent, container: CONTAINER, ...extra }).record;

describe('sidecarPath', () => {
  it('is <container-without-slash>.acl (solid-pod-rs default Sidecar layout), never <container>/.acl', () => {
    expect(sidecarPath(CONTAINER)).toBe(`/pods/${OWNER}/proj/demo.acl`);
    expect(sidecarPath(`/pods/${OWNER}/proj/demo`)).toBe(`/pods/${OWNER}/proj/demo.acl`);
    expect(sidecarPath(CONTAINER)).not.toMatch(/\/\.acl$/);
  });
});

describe('renderContainerAcl', () => {
  it('always carries the owner block with Read, Write, Append and Control on the container and its descendants', () => {
    const ttl = renderContainerAcl(OWNER, CONTAINER, []);
    expect(ttl).toContain('@prefix acl: <http://www.w3.org/ns/auth/acl#> .');
    expect(ttl).toContain('<#owner> a acl:Authorization');
    expect(ttl).toContain(`acl:agent <did:nostr:${OWNER}>`);
    expect(ttl).toContain(`acl:accessTo <${CONTAINER}>`);
    expect(ttl).toContain(`acl:default <${CONTAINER}>`);
    expect(ttl).toMatch(/acl:mode acl:Read, acl:Write, acl:Append, acl:Control \./);
  });

  it('adds one <#mandate-<hash>> block per mandate with FULL /pods/<hex>/… targets and no root-relative shortcut', () => {
    const m1 = mk(AGENT1, { modes: ['Write', 'Append'] });
    const m2 = mk(AGENT2);
    const ttl = renderContainerAcl(OWNER, CONTAINER, [m1, m2]);
    const blocks = ttl.match(/<#mandate-[0-9a-f]{64}> a acl:Authorization/g);
    expect(blocks).toHaveLength(2);
    expect(ttl).toContain(`acl:agent <did:nostr:${AGENT1}>`);
    expect(ttl).toContain(`acl:agent <did:nostr:${AGENT2}>`);
    // Every IRI target is a full /pods/<owner>/… path.
    const targets = [...ttl.matchAll(/acl:(?:accessTo|default) <([^>]*)>/g)].map((x) => x[1]);
    expect(targets.length).toBe(6);
    for (const t of targets) expect(t).toBe(CONTAINER);
    expect(ttl).not.toMatch(/<\.\/>|<\/>/);
    // The raw URN never appears as a fragment (it contains ':' and is long).
    expect(ttl).not.toContain(m1.urn);
  });

  it('never renders Control for a delegate, even from an old record that carried it', () => {
    const old = { ...mk(AGENT1), modes: ['Read', 'Write', 'Control'] };
    const ttl = renderContainerAcl(OWNER, CONTAINER, [old]);
    const delegate = ttl.slice(ttl.indexOf('<#mandate-'));
    expect(delegate).toContain('acl:mode acl:Read, acl:Write .');
    expect(delegate).not.toContain('Control');
    // Control-only old record renders no delegate block at all (no empty grant).
    const controlOnly = { ...mk(AGENT2), modes: ['Control'] };
    expect(renderContainerAcl(OWNER, CONTAINER, [controlOnly])).not.toContain('<#mandate-');
  });

  it('is deterministic and order-independent', () => {
    const m1 = mk(AGENT1); const m2 = mk(AGENT2);
    expect(renderContainerAcl(OWNER, CONTAINER, [m1, m2])).toBe(renderContainerAcl(OWNER, CONTAINER, [m2, m1]));
  });

  it('refuses a mandate for another container, another pod, or an unsafe container', () => {
    const other = createMandate({ issuer: OWNER, agent: AGENT1, container: `/pods/${OWNER}/proj/other/` }).record;
    expect(() => renderContainerAcl(OWNER, CONTAINER, [other])).toThrow(/container/);
    expect(() => renderContainerAcl(AGENT1, CONTAINER, [])).toThrow();
    expect(() => renderContainerAcl(OWNER, `/pods/${OWNER}/`, [])).toThrow();
    expect(() => renderContainerAcl(OWNER, `/pods/${OWNER}/x>y/`, [])).toThrow();
    expect(() => renderContainerAcl('nope', CONTAINER, [])).toThrow();
  });
});

// ── the signed pod client + sidecar sync, against an in-memory pod ──────────────

function fakePod({ failNext = [] } = {}) {
  const files = new Map();
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    calls.push({ method, url, auth: (init.headers || {}).Authorization, body: init.body });
    const fail = failNext.find((f) => f.method === method && !f.used);
    if (fail) { fail.used = true; return new Response(fail.body || 'boom', { status: fail.status }); }
    if (method === 'PUT') { files.set(path, String(init.body)); return new Response('', { status: files.has(path) ? 201 : 200 }); }
    if (method === 'DELETE') { const had = files.delete(path); return new Response(null, { status: had ? 204 : 404 }); }
    if (method === 'GET') return files.has(path) ? new Response(files.get(path), { status: 200 }) : new Response('nf', { status: 404 });
    return new Response('', { status: 405 });
  };
  return { files, calls, fetchFn };
}

function client(pod, over = {}) {
  return new PodAclClient({
    connectBase: 'http://127.0.0.1:8484',
    signedBase: 'https://pods.example',
    nip98: async (method, url, body) => `Nostr ${Buffer.from(JSON.stringify({ method, url, body: body || null })).toString('base64')}`,
    fetchFn: pod.fetchFn,
    spaceReplays: false,
    ...over,
  });
}

const decode = (h) => JSON.parse(Buffer.from(h.slice(6), 'base64').toString());

describe('PodAclClient', () => {
  it('connects to the local origin but signs the PUBLIC origin the pod matches NIP-98 against', async () => {
    const pod = fakePod();
    await client(pod).put(sidecarPath(CONTAINER), 'x');
    const [call] = pod.calls;
    expect(call.url).toBe(`http://127.0.0.1:8484${sidecarPath(CONTAINER)}`);
    const signed = decode(call.auth);
    expect(signed.url).toBe(`https://pods.example${sidecarPath(CONTAINER)}`);
    expect(signed.method).toBe('PUT');
    expect(signed.body).toBe('x');
  });

  it('with no public origin it signs the very URL it connects to', async () => {
    const pod = fakePod();
    await client(pod, { signedBase: undefined }).get('/pods/x.acl');
    expect(decode(pod.calls[0].auth).url).toBe('http://127.0.0.1:8484/pods/x.acl');
  });

  it('never sends a request when signing fails', async () => {
    const pod = fakePod();
    const c = client(pod, { nip98: async () => { throw new Error('port refused'); } });
    await expect(c.put('/pods/x.acl', 'x')).rejects.toThrow(/port refused/);
    expect(pod.calls).toHaveLength(0);
  });
});

describe('NIP-98 replay spacing', () => {
  it('never signs the same method+URL twice in one second (the pod would reject the second as a replay)', async () => {
    const stamps = [];
    const pod = fakePod();
    const c = client(pod, { spaceReplays: true, nip98: async () => { stamps.push(Math.floor(Date.now() / 1000)); return 'Nostr x'; } });
    await c.get('/pods/x.acl');
    await c.get('/pods/x.acl');
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
  });
  it('different URLs or methods are not delayed, and spaceReplays:false disables it', async () => {
    const pod = fakePod();
    const t0 = Date.now();
    const c = client(pod, { spaceReplays: true });
    await c.get('/a'); await c.put('/a', 'x'); await c.get('/b');
    await client(pod, { spaceReplays: false }).get('/a');
    await client(pod, { spaceReplays: false }).get('/a');
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('syncContainerSidecar', () => {
  it('PUTs the whole sidecar, reads it back and confirms the agents', async () => {
    const pod = fakePod();
    const m = mk(AGENT1);
    const res = await syncContainerSidecar({ client: client(pod), owner: OWNER, container: CONTAINER, active: [m] });
    expect(res.action).toBe('put');
    expect(pod.files.get(sidecarPath(CONTAINER))).toBe(renderContainerAcl(OWNER, CONTAINER, [m]));
    expect(pod.calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
  });

  it('removing the last mandate DELETEs the sidecar and confirms it is gone', async () => {
    const pod = fakePod();
    const m = mk(AGENT1);
    await syncContainerSidecar({ client: client(pod), owner: OWNER, container: CONTAINER, active: [m] });
    pod.calls.length = 0;
    const res = await syncContainerSidecar({ client: client(pod), owner: OWNER, container: CONTAINER, active: [], absentAgents: [AGENT1] });
    expect(res.action).toBe('delete');
    expect(pod.files.has(sidecarPath(CONTAINER))).toBe(false);
    expect(pod.calls.map((c) => c.method)).toEqual(['DELETE', 'GET']);
  });

  it('a DELETE of an already-absent sidecar is idempotent', async () => {
    const pod = fakePod();
    const res = await syncContainerSidecar({ client: client(pod), owner: OWNER, container: CONTAINER, active: [] });
    expect(res.action).toBe('delete');
  });

  it('fails when the read-back still shows a removed agent (stale cache or a pod that ignored the write)', async () => {
    const m1 = mk(AGENT1); const m2 = mk(AGENT2);
    const pod = fakePod();
    pod.files.set(sidecarPath(CONTAINER), renderContainerAcl(OWNER, CONTAINER, [m1, m2]));
    const stale = { ...pod, fetchFn: async (url, init = {}) => ((init.method || 'GET') === 'PUT' ? new Response('', { status: 200 }) : pod.fetchFn(url, init)) };
    await expect(
      syncContainerSidecar({ client: client(stale), owner: OWNER, container: CONTAINER, active: [m2], absentAgents: [AGENT1] }),
    ).rejects.toMatchObject({ name: 'PodAclError', phase: 'verify' });
  });

  it('fails when the delete did not take effect', async () => {
    const pod = fakePod();
    pod.files.set(sidecarPath(CONTAINER), 'still here');
    const noop = { ...pod, fetchFn: async (url, init = {}) => ((init.method || '') === 'DELETE' ? new Response(null, { status: 204 }) : pod.fetchFn(url, init)) };
    await expect(
      syncContainerSidecar({ client: client(noop), owner: OWNER, container: CONTAINER, active: [] }),
    ).rejects.toMatchObject({ phase: 'verify' });
  });

  it('surfaces a pod 5xx with its phase and status, and a 401/403 as a distinct code', async () => {
    const m = mk(AGENT1);
    const e5 = await syncContainerSidecar({ client: client(fakePod({ failNext: [{ method: 'PUT', status: 503 }] })), owner: OWNER, container: CONTAINER, active: [m] }).catch((e) => e);
    expect(e5).toBeInstanceOf(PodAclError);
    expect(e5).toMatchObject({ phase: 'write', status: 503 });
    const e4 = await syncContainerSidecar({ client: client(fakePod({ failNext: [{ method: 'PUT', status: 403 }] })), owner: OWNER, container: CONTAINER, active: [m] }).catch((e) => e);
    expect(e4).toMatchObject({ status: 403, code: 'pod_denied' });
  });

  it('treats a network error as a write-phase failure', async () => {
    const c = client(fakePod(), { fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(syncContainerSidecar({ client: c, owner: OWNER, container: CONTAINER, active: [mk(AGENT1)] })).rejects.toMatchObject({ phase: 'write' });
  });
});
