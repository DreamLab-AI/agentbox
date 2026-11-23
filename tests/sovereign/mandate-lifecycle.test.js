'use strict';

/**
 * AB-11 — mandate enforcement and revocation, with the pod, signer and relay
 * faked. Covers the grant path (preflight, mint, PUT, sign+publish, active), the
 * revoke path (preflight, revoking, PUT/DELETE+read-back, sign+publish, tombstone),
 * every partial-failure state, the reconciler, and concurrency on one container.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../../management-api/lib/mandate-registry');
const { sidecarPath, renderContainerAcl } = require('../../management-api/lib/mandate-acl');
const { grantMandate, MandateRevokedError, GrantError } = require('../../management-api/lib/mandate-grant');
const { revokeMandate, reconcileMandates, RevokeError } = require('../../management-api/lib/mandate-revocation');
const { SignerUnavailable } = require('../../management-api/lib/mandate-signer');
const { MANDATE_EVENT_KIND } = require('../../management-api/lib/mandate');
const { OWNER, fakePod, fakeSigner, fakePublisher, makeDeps, logger } = require('./helpers/mandate-fakes');

const A1 = 'b'.repeat(64);
const A2 = 'c'.repeat(64);
const C1 = `/pods/${OWNER}/proj/demo/`;
const C2 = `/pods/${OWNER}/proj/other/`;

let tmp;
let prevState;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-life-'));
  prevState = process.env.AGENTBOX_STATE_DIR;
  process.env.AGENTBOX_STATE_DIR = tmp;
});
afterEach(() => {
  if (prevState === undefined) delete process.env.AGENTBOX_STATE_DIR; else process.env.AGENTBOX_STATE_DIR = prevState;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const grant = (deps, over = {}) => grantMandate({ issuer: OWNER, agent: A1, container: C1, manifest: {}, logger, deps, ...over });
const revoke = (deps, over = {}) => revokeMandate({ agent: A1, container: C1, manifest: {}, logger, deps, ...over });
const entryOf = (agent = A1, container = C1) => registry.load()[registry.keyFor(agent, container)];
const auditLines = () => {
  try { return fs.readFileSync(path.join(tmp, 'mandates', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
};

describe('grant', () => {
  it('mints, PUTs the whole sidecar at <container>.acl, signs, publishes, then marks active', async () => {
    const deps = makeDeps();
    const res = await grant(deps);
    expect(res.reused).toBe(false);
    expect(res.signed).toBe(true);
    expect(deps.pod.methods()).toEqual(['PUT', 'GET']);   // the write, then the read-back
    expect(deps.pod.files.get(sidecarPath(C1))).toBe(renderContainerAcl(OWNER, C1, [res.record]));
    expect(deps.pod.files.get(sidecarPath(C1))).toContain(`did:nostr:${A1}`);
    // every pod request was authenticated as the owner
    for (const c of deps.pod.calls) expect(c.auth).toMatch(/^Nostr /);
    // kind 30078 with the mandate tags, signed by the owner and published
    expect(deps.publisher.events).toHaveLength(1);
    const ev = deps.publisher.events[0];
    expect(ev.kind).toBe(MANDATE_EVENT_KIND);
    expect(ev.tags).toEqual(expect.arrayContaining([['d', res.urn], ['p', A1], ['t', 'agent-mandate'], ['status', 'active']]));
    const e = entryOf();
    expect(e).toMatchObject({ state: 'active', signed: true, signed_event_id: ev.id, grant_created_at: ev.created_at });
    expect(e.record.pod).toBe(OWNER);
    expect(auditLines().map((l) => l.action)).toEqual(['grant.begin', 'grant.active']);
    expect(deps.emitted.map((x) => x.metadata.kind)).toContain('mandate-grant');
  });

  it('is idempotent: a second ensure returns the active mandate and touches nothing', async () => {
    const deps = makeDeps();
    const first = await grant(deps);
    deps.pod.calls.length = 0;
    const again = await grant(deps);
    expect(again.reused).toBe(true);
    expect(again.urn).toBe(first.urn);
    expect(deps.pod.calls).toHaveLength(0);
    expect(deps.publisher.calls).toBe(1);
  });

  it('PREFLIGHT: no signer → SignerUnavailable and NOTHING changes (no registry entry, no pod call, no event)', async () => {
    const deps = makeDeps({ signer: null });
    await expect(grant(deps)).rejects.toBeInstanceOf(SignerUnavailable);
    expect(registry.load()).toEqual({});
    expect(deps.pod.calls).toHaveLength(0);
    expect(deps.publisher.calls).toBe(0);
  });

  it('PREFLIGHT: a signer that is not the issuer/pod owner is refused (signer_mismatch), nothing changes', async () => {
    const deps = makeDeps({ signer: fakeSigner({ pubkey: A2 }) });
    const err = await grant(deps).catch((e) => e);
    expect(err).toBeInstanceOf(SignerUnavailable);
    expect(err.reason).toBe('signer_mismatch');
    expect(registry.load()).toEqual({});
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('PREFLIGHT: the NIP-98 header actually produced must carry the owner pubkey', async () => {
    const deps = makeDeps();
    deps.signer.nip98 = async () => `Nostr ${Buffer.from(JSON.stringify({ pubkey: A2 })).toString('base64')}`;
    const err = await grant(deps).catch((e) => e);
    expect(err).toBeInstanceOf(SignerUnavailable);
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('a pod 5xx on the PUT fails the grant, rolls the sidecar back and leaves a failed (not active) entry', async () => {
    const deps = makeDeps();
    deps.pod.fail('PUT', 503);
    await expect(grant(deps)).rejects.toBeInstanceOf(GrantError);
    expect(entryOf().state).toBe('failed');
    expect(deps.publisher.calls).toBe(0);
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);
  });

  it('a signing failure AFTER the PUT rolls the sidecar back (fail closed: no unsigned grant stays enforced)', async () => {
    const deps = makeDeps();
    deps.signer.failSign = true;
    const err = await grant(deps).catch((e) => e);
    expect(err).toBeInstanceOf(GrantError);
    expect(err.code).toBe('sign_failed');
    expect(entryOf().state).toBe('failed');
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);
    expect(deps.publisher.calls).toBe(0);
  });

  it('a relay that is down fails the grant and rolls back; other agents already in the sidecar survive the rollback', async () => {
    const deps = makeDeps();
    const g1 = await grant(deps, { agent: A1 });
    deps.publisher.down = true;
    const err = await grant(deps, { agent: A2 }).catch((e) => e);
    expect(err).toBeInstanceOf(GrantError);
    expect(err.code).toBe('publish_failed');
    const body = deps.pod.files.get(sidecarPath(C1));
    expect(body).toContain(A1);
    expect(body).not.toContain(A2);
    expect(body).toBe(renderContainerAcl(OWNER, C1, [g1.record]));
    expect(entryOf(A2).state).toBe('failed');
  });

  it('a revoked mandate is a TOMBSTONE: ensure refuses to re-mint; only an explicit regrant replaces it', async () => {
    const deps = makeDeps();
    await grant(deps);
    await revoke(deps);
    expect(entryOf().state).toBe('revoked');
    await expect(grant(deps)).rejects.toBeInstanceOf(MandateRevokedError);
    const calls = deps.pod.calls.length;
    await expect(grant(deps)).rejects.toBeInstanceOf(MandateRevokedError);
    expect(deps.pod.calls.length).toBe(calls);                       // refused before any I/O beyond preflight-free path
    deps.tick(5);
    const re = await grant(deps, { regrant: true });
    expect(re.reused).toBe(false);
    expect(entryOf().state).toBe('active');
    expect(deps.pod.files.get(sidecarPath(C1))).toContain(A1);
  });

  it('a regrant in the same second as the revoke still supersedes it (created_at strictly later)', async () => {
    const deps = makeDeps();
    await grant(deps);
    await revoke(deps);
    const revokedAt = deps.publisher.events.at(-1).created_at;
    await grant(deps, { regrant: true });
    expect(deps.publisher.events.at(-1).created_at).toBeGreaterThan(revokedAt);
  });

  it('refuses a container outside the issuer pod and a Control request, before any I/O', async () => {
    const deps = makeDeps();
    await expect(grant(deps, { container: '/proj/demo/' })).rejects.toMatchObject({ name: 'MandateError' });
    await expect(grant(deps, { container: `/pods/${A2}/x/` })).rejects.toMatchObject({ name: 'MandateError' });
    await expect(grant(deps, { modes: ['Read', 'Control'] })).rejects.toMatchObject({ name: 'MandateError' });
    expect(deps.pod.calls).toHaveLength(0);
    expect(registry.load()).toEqual({});
  });

  it('concurrent grants on ONE container both land in the sidecar (no lost update)', async () => {
    const deps = makeDeps({ pod: fakePod({ latencyMs: 15 }) });
    const [g1, g2] = await Promise.all([grant(deps, { agent: A1 }), grant(deps, { agent: A2 })]);
    const body = deps.pod.files.get(sidecarPath(C1));
    expect(body).toContain(A1);
    expect(body).toContain(A2);
    expect(body).toBe(renderContainerAcl(OWNER, C1, [g1.record, g2.record]));
    expect(entryOf(A1).state).toBe('active');
    expect(entryOf(A2).state).toBe('active');
  });

  it('concurrent grants on DIFFERENT containers do not serialise on each other\'s sidecar', async () => {
    const deps = makeDeps({ pod: fakePod({ latencyMs: 5 }) });
    await Promise.all([grant(deps, { agent: A1, container: C1 }), grant(deps, { agent: A2, container: C2 })]);
    expect(deps.pod.files.get(sidecarPath(C1))).not.toContain(A2);
    expect(deps.pod.files.get(sidecarPath(C2))).not.toContain(A1);
  });

  it('a grant racing a revoke on the same container ends consistent: registry and sidecar agree', async () => {
    const deps = makeDeps({ pod: fakePod({ latencyMs: 10 }) });
    await grant(deps, { agent: A1 });
    await Promise.all([grant(deps, { agent: A2 }), revoke(deps, { agent: A1 })]);
    const body = deps.pod.files.get(sidecarPath(C1));
    expect(body).toContain(A2);
    expect(body).not.toContain(A1);
    expect(entryOf(A1).state).toBe('revoked');
    expect(entryOf(A2).state).toBe('active');
  });

  it('two grants for the same agent+container collapse to one mandate', async () => {
    const deps = makeDeps({ pod: fakePod({ latencyMs: 10 }) });
    const [a, b] = await Promise.all([grant(deps), grant(deps)]);
    expect(a.urn).toBe(b.urn);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(deps.publisher.calls).toBe(1);
  });
});

describe('revoke', () => {
  it('runs preflight, revoking, PUT/DELETE + read-back, signed publish, then the tombstone, in that order', async () => {
    const deps = makeDeps();
    const g = await grant(deps);
    const seen = [];
    deps.pod = Object.assign(deps.pod, {});
    const inner = deps.pod.fetchFn.bind(deps.pod);
    deps.pod.fetchFn = async (url, init) => { seen.push({ m: (init && init.method) || 'GET', state: entryOf().state }); return inner(url, init); };
    deps.tick(30);
    const res = await revoke(deps);
    // while the pod was being changed the registry already said "revoking"
    expect(seen.map((s) => s.state)).toEqual(['revoking', 'revoking']);
    expect(seen.map((s) => s.m)).toEqual(['DELETE', 'GET']);
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);          // last mandate gone: sidecar DELETEd
    expect(res).toMatchObject({ urn: g.urn, state: 'revoked', effective_at_pod: true, published: true });
    const ev = deps.publisher.events.at(-1);
    expect(ev.kind).toBe(MANDATE_EVENT_KIND);
    expect(ev.tags).toEqual([['d', g.urn], ['p', A1], ['t', 'agent-mandate'], ['status', 'revoked']]);
    expect(ev.created_at).toBe(deps.now());                                   // max(now, grant+1) with now well past the grant
    expect(entryOf()).toMatchObject({ state: 'revoked', revocation_event_id: ev.id });
    expect(entryOf().record.revoked).toBe(true);
    expect(auditLines().map((l) => l.action)).toEqual(['grant.begin', 'grant.active', 'revoke.begin', 'revoke.pod', 'revoke.revoked']);
    expect(deps.emitted.map((x) => x.metadata.kind)).toContain('mandate-revoke');
  });

  it('created_at is strictly later than the grant even when the clock has not moved (same second)', async () => {
    const deps = makeDeps();
    await grant(deps);
    const grantAt = deps.publisher.events[0].created_at;
    await revoke(deps);
    expect(deps.publisher.events.at(-1).created_at).toBe(grantAt + 1);
  });

  it('created_at is strictly later than the grant even when the clock went backwards', async () => {
    const deps = makeDeps();
    await grant(deps);
    const grantAt = deps.publisher.events[0].created_at;
    deps.now = () => grantAt - 500;
    await revoke(deps);
    expect(deps.publisher.events.at(-1).created_at).toBe(grantAt + 1);
  });

  it('the revoke event has no empty expiration tag, and none for a mandate that has already expired', async () => {
    const deps = makeDeps();
    const now = deps.now();
    await grant(deps, { expiresAt: now + 3600 });
    await revoke(deps);
    const ev = deps.publisher.events.at(-1);
    expect(ev.tags.find((t) => t[0] === 'expiration')).toEqual(['expiration', String(now + 3600)]);
    expect(ev.tags.every((t) => t[1] !== '')).toBe(true);
    // expired before it is revoked → no past expiration tag (relays reject it)
    const d2 = makeDeps();
    const n2 = d2.now();
    await grant(d2, { agent: A2, expiresAt: n2 + 10 });
    d2.tick(100);
    await revoke(d2, { agent: A2 });
    expect(d2.publisher.events.at(-1).tags.some((t) => t[0] === 'expiration')).toBe(false);
  });

  it('PREFLIGHT 503: no signer → SignerUnavailable, the mandate stays active, nothing is touched, nothing is signed', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.signer = null;
    const before = JSON.stringify(registry.load());
    deps.pod.calls.length = 0;
    const err = await revoke(deps).catch((e) => e);
    expect(err).toBeInstanceOf(SignerUnavailable);
    expect(JSON.stringify(registry.load())).toBe(before);
    expect(deps.pod.calls).toHaveLength(0);
    expect(deps.publisher.calls).toBe(1);                       // only the original grant event
  });

  it('PREFLIGHT 503: a signer that is not record.issuer cannot revoke (never an operator-stack signature)', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.signer = fakeSigner({ pubkey: A2 });
    deps.pod.calls.length = 0;
    const err = await revoke(deps).catch((e) => e);
    expect(err).toMatchObject({ name: 'SignerUnavailable', reason: 'signer_mismatch' });
    expect(entryOf().state).toBe('active');
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('a negative signer result is never cached: the next revoke after the signer returns succeeds', async () => {
    const deps = makeDeps();
    await grant(deps);
    const good = deps.signer;
    deps.signer = null;
    await expect(revoke(deps)).rejects.toBeInstanceOf(SignerUnavailable);
    deps.signer = good;
    await expect(revoke(deps)).resolves.toMatchObject({ state: 'revoked' });
  });

  it('pod 5xx at step 3: state stays "revoking", effective_at_pod:false (502), and nothing was published', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.pod.fail('DELETE', 500);
    const err = await revoke(deps).catch((e) => e);
    expect(err).toBeInstanceOf(RevokeError);
    expect(err).toMatchObject({ status: 502, effective_at_pod: false, code: 'pod_acl_failed' });
    expect(entryOf().state).toBe('revoking');
    expect(deps.publisher.calls).toBe(1);
    // voice-intent / ensureMandate deny from "revoking" on
    expect(registry.isEnforceable(entryOf(), deps.now())).toBe(false);
  });

  it('relay down at step 4: effective at the pod, state "revoked_unpublished", 200 published:false', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.publisher.down = true;
    const res = await revoke(deps);
    expect(res).toMatchObject({ state: 'revoked_unpublished', effective_at_pod: true, published: false });
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);
    expect(entryOf().state).toBe('revoked_unpublished');
    expect(registry.isEnforceable(entryOf(), deps.now())).toBe(false);
    expect(auditLines().at(-1).action).toBe('revoke.unpublished');
  });

  it('a signing failure at step 4 is also revoked_unpublished (the pod already enforces it)', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.signer.failSign = true;
    const res = await revoke(deps);
    expect(res).toMatchObject({ state: 'revoked_unpublished', effective_at_pod: true, published: false });
  });

  it('other agents on the container keep their access: the sidecar is re-rendered, not deleted', async () => {
    const deps = makeDeps();
    await grant(deps, { agent: A1 });
    const g2 = await grant(deps, { agent: A2 });
    await revoke(deps, { agent: A1 });
    expect(deps.pod.files.get(sidecarPath(C1))).toBe(renderContainerAcl(OWNER, C1, [g2.record]));
  });

  it('is addressable by urn, 404-equivalent (null) when unknown, and idempotent once revoked', async () => {
    const deps = makeDeps();
    const g = await grant(deps);
    expect(await revokeMandate({ urn: 'urn:agentbox:mandate:nope', manifest: {}, logger, deps })).toBeNull();
    const first = await revokeMandate({ urn: g.urn, manifest: {}, logger, deps });
    expect(first.state).toBe('revoked');
    const calls = deps.pod.calls.length;
    const second = await revokeMandate({ urn: g.urn, manifest: {}, logger, deps });
    expect(second).toMatchObject({ state: 'revoked', effective_at_pod: true, published: true });
    expect(deps.pod.calls.length).toBe(calls);
  });
});

describe('reconciler', () => {
  it('re-drives "revoking" (crash after marking, before the pod write) to revoked', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.pod.fail('DELETE', 500);
    await revoke(deps).catch(() => {});
    expect(entryOf().state).toBe('revoking');
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(true);                 // the pod still lets the agent in
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.revoked).toBe(1);
    expect(entryOf().state).toBe('revoked');
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);
  });

  it('re-drives "revoking" when the pod was already cleaned (crash between step 3 and 4)', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.pod.files.delete(sidecarPath(C1));                                 // step 3 had completed
    await registry.update((reg) => { reg[registry.keyFor(A1, C1)].state = 'revoking'; });
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.revoked).toBe(1);
    expect(entryOf().state).toBe('revoked');
    expect(deps.publisher.events.at(-1).tags).toContainEqual(['status', 'revoked']);
  });

  it('re-drives "revoked_unpublished" once the relay is back, and is idempotent afterwards', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.publisher.down = true;
    await revoke(deps);
    deps.publisher.down = false;
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.revoked).toBe(1);
    expect(entryOf().state).toBe('revoked');
    const published = deps.publisher.calls;
    const again = await reconcileMandates({ manifest: {}, logger, deps });
    expect(again.revoked).toBe(0);
    expect(deps.publisher.calls).toBe(published);
  });

  it('leaves the state alone (and tries again later) while the signer is unavailable', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.publisher.down = true;
    await revoke(deps);
    deps.signer = null;
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.revoked).toBe(0);
    expect(out.deferred).toBeGreaterThan(0);
    expect(entryOf().state).toBe('revoked_unpublished');
  });

  it('rolls a stale "granting" entry back: the sidecar is re-rendered without it and the entry becomes failed', async () => {
    const deps = makeDeps();
    const g1 = await grant(deps, { agent: A1 });
    // crash after the PUT of a second grant, before sign/publish/active:
    await grant(deps, { agent: A2 }).catch(() => {});
    await registry.update((reg) => {
      const k = registry.keyFor(A2, C1);
      reg[k] = reg[k] || { record: { ...g1.record, agent: `did:nostr:${A2}`, urn: `${g1.urn}x` }, state: 'granting' };
      reg[k].state = 'granting';
    });
    deps.pod.files.set(sidecarPath(C1), renderContainerAcl(OWNER, C1, [g1.record, { ...g1.record, agent: `did:nostr:${A2}`, urn: `${g1.urn}x` }]));
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.rolledBack).toBe(1);
    expect(entryOf(A2).state).toBe('failed');
    expect(deps.pod.files.get(sidecarPath(C1))).toBe(renderContainerAcl(OWNER, C1, [g1.record]));
  });

  it('expires an active mandate past its expiry: removed from the sidecar, state "expired", re-grantable', async () => {
    const deps = makeDeps();
    const t0 = deps.now();
    await grant(deps, { expiresAt: t0 + 60 });
    deps.tick(120);
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out.expired).toBe(1);
    expect(entryOf().state).toBe('expired');
    expect(deps.pod.files.has(sidecarPath(C1))).toBe(false);
    await expect(grant(deps)).resolves.toMatchObject({ reused: false });   // expiry is not a revocation: no tombstone
  });

  it('a no-op run touches nothing', async () => {
    const deps = makeDeps();
    await grant(deps);
    deps.pod.calls.length = 0;
    const out = await reconcileMandates({ manifest: {}, logger, deps });
    expect(out).toMatchObject({ revoked: 0, rolledBack: 0, expired: 0 });
    expect(deps.pod.calls).toHaveLength(0);
  });
});

describe('registry', () => {
  it('writes atomically (tmp + rename), mode 0600, leaving no temp file behind', async () => {
    const deps = makeDeps();
    await grant(deps);
    const dir = path.join(tmp, 'mandates');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(fs.statSync(path.join(dir, 'registry.json')).mode & 0o777).toBe(0o600);
  });

  it('a corrupt registry fails closed (throws) instead of reading as empty, and is left untouched', async () => {
    const deps = makeDeps();
    fs.mkdirSync(path.join(tmp, 'mandates'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'mandates', 'registry.json'), '{ not json');
    await expect(grant(deps)).rejects.toMatchObject({ name: 'RegistryError' });
    expect(fs.readFileSync(path.join(tmp, 'mandates', 'registry.json'), 'utf8')).toBe('{ not json');
    expect(deps.pod.calls).toHaveLength(0);
  });

  it('serialises in-process read-modify-write: 25 concurrent updates all land', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => registry.update((reg) => { reg[`k${i}`] = { state: 'failed', record: { urn: `u${i}` } }; })));
    expect(Object.keys(registry.load()).length).toBe(25);
  });

  it('migrates legacy entries: /proj paths move under /pods/<pod>/, the URN is kept, nothing is re-minted, an unenforced legacy "active" becomes failed, a legacy revoked stays a tombstone', () => {
    const urnA = `urn:agentbox:mandate:${OWNER}:sha256-12-aaaaaaaaaaaa`;
    const urnR = `urn:agentbox:mandate:${OWNER}:sha256-12-bbbbbbbbbbbb`;
    const legacy = {
      [`${A1}|/proj/foo/`]: { record: { issuer: `did:nostr:${OWNER}`, agent: `did:nostr:${A1}`, container: '/proj/foo/', modes: ['Read', 'Write', 'Append'], issued_at: 1, expires_at: null, revoked: false, urn: urnA }, signed: false },
      [`${A2}|/proj/foo/`]: { record: { issuer: `did:nostr:${OWNER}`, agent: `did:nostr:${A2}`, container: '/proj/foo/', modes: ['Read'], issued_at: 1, expires_at: null, revoked: true, urn: urnR }, signed: true },
    };
    fs.mkdirSync(path.join(tmp, 'mandates'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'mandates', 'registry.json'), JSON.stringify(legacy));
    const reg = registry.load();
    const kA = registry.keyFor(A1, `/pods/${OWNER}/proj/foo/`);
    const kR = registry.keyFor(A2, `/pods/${OWNER}/proj/foo/`);
    expect(Object.keys(reg).sort()).toEqual([kA, kR].sort());
    expect(reg[kA].record).toMatchObject({ urn: urnA, container: `/pods/${OWNER}/proj/foo/`, pod: OWNER });
    expect(reg[kA].state).toBe('failed');
    expect(reg[kR]).toMatchObject({ state: 'revoked' });
    expect(reg[kR].record.urn).toBe(urnR);
    expect(registry.isEnforceable(reg[kA], 10)).toBe(false);
    expect(registry.isEnforceable(reg[kR], 10)).toBe(false);
  });

  it('isEnforceable is true only for an unexpired "active" entry', () => {
    const rec = { urn: 'u', agent: `did:nostr:${A1}`, issuer: `did:nostr:${OWNER}`, expires_at: 100, revoked: false };
    expect(registry.isEnforceable({ record: rec, state: 'active' }, 50)).toBe(true);
    expect(registry.isEnforceable({ record: rec, state: 'active' }, 100)).toBe(false);
    for (const state of ['granting', 'revoking', 'revoked_unpublished', 'revoked', 'failed', 'expired']) {
      expect(registry.isEnforceable({ record: rec, state }, 50)).toBe(false);
    }
    expect(registry.isEnforceable(undefined, 50)).toBe(false);
  });
});
