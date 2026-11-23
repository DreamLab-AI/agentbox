'use strict';

/**
 * WS4 (PRD-014 Seam C / C3): scoped agent delegation mandates.
 *
 * A mandate lets a user grant a specific agent write/append authority over
 * one KG container so the agent writes under its OWN did:nostr — never the
 * user's nsec. Covers minting (canonical URN), ACL rendering (acl:agent),
 * signing/revocation envelope, and validity checks.
 */

const {
  MANDATE_EVENT_KIND,
  ALLOWED_MODES,
  MandateError,
  createMandate,
  buildMandateEvent,
  mandateEventCreatedAt,
  podOf,
  signMandate,
  isMandateActive,
  recordFromSignedMandate,
} = require('../../management-api/lib/mandate');
const uris = require('../../management-api/lib/uris');

const ISSUER = 'a'.repeat(64);
const AGENT = 'b'.repeat(64);
const KG = `/pods/${ISSUER}/kg/`;

describe('createMandate', () => {
  it('mints a canonical urn:agentbox:mandate scoped to the issuer', () => {
    const { urn, record } = createMandate({
      issuer: ISSUER,
      agent: AGENT,
      container: `${KG}concepts`,
    });
    expect(uris.isCanonical(urn)).toBe(true);
    const parsed = uris.parse(urn);
    expect(parsed.kind).toBe('mandate');
    expect(parsed.pubkey).toBe(ISSUER);
    expect(record.urn).toBe(urn);
    expect(record.issuer).toBe(`did:nostr:${ISSUER}`);
    expect(record.agent).toBe(`did:nostr:${AGENT}`);
  });

  it('normalises container to a trailing-slash path and defaults modes', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: `${KG}concepts` });
    expect(record.container).toBe(`${KG}concepts/`);
    expect(record.pod).toBe(ISSUER);
    expect(record.modes).toEqual(['Read', 'Write', 'Append']);
  });

  it('accepts did:nostr identities and acl:-prefixed modes', () => {
    const { record } = createMandate({
      issuer: `did:nostr:${ISSUER}`,
      agent: `did:nostr:${AGENT}`,
      container: KG,
      modes: ['acl:Write', 'Append'],
    });
    expect(record.modes).toEqual(['Write', 'Append']);
  });

  it('is deterministic: same inputs → same content-addressed urn', () => {
    const args = { issuer: ISSUER, agent: AGENT, container: KG, issuedAt: 1000 };
    expect(createMandate(args).urn).toBe(createMandate(args).urn);
  });

  it('rejects malformed identities, relative containers, and bad modes', () => {
    expect(() => createMandate({ issuer: 'nope', agent: AGENT, container: KG })).toThrow(
      MandateError
    );
    expect(() => createMandate({ issuer: ISSUER, agent: AGENT, container: 'kg' })).toThrow(
      MandateError
    );
    expect(() =>
      createMandate({ issuer: ISSUER, agent: AGENT, container: KG, modes: ['Bogus'] })
    ).toThrow(MandateError);
  });

  it('rejects an expiry that is not after issuance', () => {
    expect(() =>
      createMandate({
        issuer: ISSUER,
        agent: AGENT,
        container: KG,
        issuedAt: 2000,
        expiresAt: 2000,
      })
    ).toThrow(MandateError);
  });

  it('never delegates Control: it is not an allowed mode and a request for it is refused', () => {
    expect(ALLOWED_MODES).toEqual(['Read', 'Write', 'Append']);
    for (const modes of [['Control'], ['Read', 'acl:Control'], ['control']]) {
      expect(() => createMandate({ issuer: ISSUER, agent: AGENT, container: KG, modes })).toThrow(/Control/);
    }
  });

  it('pins the mandate to a container inside the issuer\'s own pod, never the pod root', () => {
    const bad = [
      '/kg/',                                   // not under /pods/<hex>/
      `/pods/${AGENT}/kg/`,                     // somebody else's pod
      `/pods/${ISSUER}/`,                       // the pod root itself
      `/pods/${ISSUER}`,
      `/pods/${ISSUER}/kg/../../x/`,            // dot segments
      `/pods/${ISSUER}/./kg/`,
      `/pods/${ISSUER}/kg/%2e%2e/`,             // encoded dots
      `/pods/${ISSUER}/kg%2Fx/`,                // encoded slash
      `/pods/${ISSUER}/kg\\x/`,                // backslash
      `/pods/${ISSUER}/kg//x/`,                 // empty segment
      `/pods/${ISSUER}/kg/x.acl`,               // a sidecar, not a container
      `/pods/${ISSUER}/kg/x.meta/`,
      `/pods/${ISSUER}/kg/>x/`,                 // Turtle IRI injection
      `/pods/${ISSUER}/kg/ x/`,
      `/pods/${ISSUER}/kg/x#frag`,
      `/pods/${ISSUER}/kg/x?q=1`,
    ];
    for (const container of bad) {
      expect(() => createMandate({ issuer: ISSUER, agent: AGENT, container })).toThrow(MandateError);
    }
  });

  it('records the owner pod, derives it from the issuer for old records, and refuses a pod that is not the issuer', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    expect(podOf(record)).toBe(ISSUER);
    const { pod, ...old } = record;
    expect(podOf(old)).toBe(ISSUER);
    expect(() => createMandate({ issuer: ISSUER, agent: AGENT, container: KG, pod: AGENT })).toThrow(MandateError);
  });
});

describe('signMandate / recordFromSignedMandate', () => {
  const signer = {
    async sign(unsigned) {
      return { ...unsigned, id: 'id', pubkey: ISSUER, sig: 'sig' };
    },
  };

  it('wraps the record in a replaceable mandate event keyed by its urn', async () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    const event = await signMandate(record, signer);
    expect(event.kind).toBe(MANDATE_EVENT_KIND);
    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag[1]).toBe(record.urn);
    // round-trips back to the record
    expect(recordFromSignedMandate(event).urn).toBe(record.urn);
  });

  it('builds the grant envelope: d/p/t tags, status=active, no empty expiration tag', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    const ev = buildMandateEvent(record, { status: 'active', createdAt: 1_800_000_000 });
    expect(ev.kind).toBe(MANDATE_EVENT_KIND);
    expect(ev.created_at).toBe(1_800_000_000);
    expect(ev.tags).toEqual([
      ['d', record.urn], ['p', AGENT], ['t', 'agent-mandate'], ['status', 'active'],
    ]);
    expect(ev.tags.some((t) => t[0] === 'expiration')).toBe(false);
  });

  it('adds an expiration tag only while it is still in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    const live = createMandate({ issuer: ISSUER, agent: AGENT, container: KG, issuedAt: now - 10, expiresAt: now + 3600 }).record;
    expect(buildMandateEvent(live, { status: 'active', nowSec: now }).tags).toContainEqual(['expiration', String(now + 3600)]);
    // A revoke of an already-expired mandate must not carry a past expiry: relays reject it.
    const past = { ...live, expires_at: now - 1 };
    const rev = buildMandateEvent(past, { status: 'revoked', nowSec: now });
    expect(rev.tags.some((t) => t[0] === 'expiration')).toBe(false);
    expect(rev.tags).toContainEqual(['status', 'revoked']);
  });

  it('refuses an unknown status', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    expect(() => buildMandateEvent(record, { status: 'maybe' })).toThrow(MandateError);
  });

  it('a revoke supersedes the grant: created_at = max(now, grant.created_at + 1)', () => {
    expect(mandateEventCreatedAt(100, 50)).toBe(101);   // same-second or clock-behind: still strictly later
    expect(mandateEventCreatedAt(100, 100)).toBe(101);
    expect(mandateEventCreatedAt(100, 500)).toBe(500);
    expect(mandateEventCreatedAt(undefined, 500)).toBe(500);
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    const ev = buildMandateEvent(record, { status: 'revoked', afterCreatedAt: 9_999_999_999, nowSec: 1000 });
    expect(ev.created_at).toBe(10_000_000_000);
  });

  it('rejects an unsigned record or a missing signer', async () => {
    await expect(signMandate({}, signer)).rejects.toThrow(MandateError);
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    await expect(signMandate(record, null)).rejects.toThrow(MandateError);
  });

  it('recordFromSignedMandate rejects wrong kind and bad json', () => {
    expect(() => recordFromSignedMandate({ kind: 1, content: '{}' })).toThrow(MandateError);
    expect(() =>
      recordFromSignedMandate({ kind: MANDATE_EVENT_KIND, content: 'not-json' })
    ).toThrow(MandateError);
  });
});

describe('isMandateActive', () => {
  it('is active before expiry, inactive after, inactive when revoked', () => {
    const { record } = createMandate({
      issuer: ISSUER,
      agent: AGENT,
      container: KG,
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(isMandateActive(record, 1500)).toBe(true);
    expect(isMandateActive(record, 2000)).toBe(false);
    expect(isMandateActive({ ...record, revoked: true }, 1500)).toBe(false);
  });

  it('a null expiry never times out', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: KG });
    expect(record.expires_at).toBeNull();
    expect(isMandateActive(record, 9_999_999_999)).toBe(true);
  });
});
