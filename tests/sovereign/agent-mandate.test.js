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
  mandateToAclTurtle,
  signMandate,
  isMandateActive,
  recordFromSignedMandate,
} = require('../../management-api/lib/mandate');
const uris = require('../../management-api/lib/uris');

const ISSUER = 'a'.repeat(64);
const AGENT = 'b'.repeat(64);

describe('createMandate', () => {
  it('mints a canonical urn:agentbox:mandate scoped to the issuer', () => {
    const { urn, record } = createMandate({
      issuer: ISSUER,
      agent: AGENT,
      container: '/kg/concepts',
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
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: '/kg/concepts' });
    expect(record.container).toBe('/kg/concepts/');
    expect(record.modes).toEqual(['Read', 'Write', 'Append']);
  });

  it('accepts did:nostr identities and acl:-prefixed modes', () => {
    const { record } = createMandate({
      issuer: `did:nostr:${ISSUER}`,
      agent: `did:nostr:${AGENT}`,
      container: '/kg/',
      modes: ['acl:Write', 'Append'],
    });
    expect(record.modes).toEqual(['Write', 'Append']);
  });

  it('is deterministic: same inputs → same content-addressed urn', () => {
    const args = { issuer: ISSUER, agent: AGENT, container: '/kg/', issuedAt: 1000 };
    expect(createMandate(args).urn).toBe(createMandate(args).urn);
  });

  it('rejects malformed identities, relative containers, and bad modes', () => {
    expect(() => createMandate({ issuer: 'nope', agent: AGENT, container: '/kg/' })).toThrow(
      MandateError
    );
    expect(() => createMandate({ issuer: ISSUER, agent: AGENT, container: 'kg' })).toThrow(
      MandateError
    );
    expect(() =>
      createMandate({ issuer: ISSUER, agent: AGENT, container: '/kg/', modes: ['Bogus'] })
    ).toThrow(MandateError);
  });

  it('rejects an expiry that is not after issuance', () => {
    expect(() =>
      createMandate({
        issuer: ISSUER,
        agent: AGENT,
        container: '/kg/',
        issuedAt: 2000,
        expiresAt: 2000,
      })
    ).toThrow(MandateError);
  });

  it('only allows Read/Write/Append/Control modes', () => {
    expect(ALLOWED_MODES).toEqual(['Read', 'Write', 'Append', 'Control']);
  });
});

describe('mandateToAclTurtle', () => {
  it('renders a WAC fragment granting the agent via acl:agent', () => {
    const { record } = createMandate({
      issuer: ISSUER,
      agent: AGENT,
      container: '/kg/concepts',
      modes: ['Write', 'Append'],
    });
    const acl = mandateToAclTurtle(record);
    expect(acl).toContain('@prefix acl: <http://www.w3.org/ns/auth/acl#> .');
    expect(acl).toContain(`acl:agent <did:nostr:${AGENT}> ;`);
    expect(acl).toContain('acl:accessTo </kg/concepts/> ;');
    expect(acl).toContain('acl:default </kg/concepts/> ;');
    expect(acl).toContain('acl:mode acl:Write, acl:Append .');
  });
});

describe('signMandate / recordFromSignedMandate', () => {
  const signer = {
    async sign(unsigned) {
      return { ...unsigned, id: 'id', pubkey: ISSUER, sig: 'sig' };
    },
  };

  it('wraps the record in a replaceable mandate event keyed by its urn', async () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: '/kg/' });
    const event = await signMandate(record, signer);
    expect(event.kind).toBe(MANDATE_EVENT_KIND);
    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag[1]).toBe(record.urn);
    // round-trips back to the record
    expect(recordFromSignedMandate(event).urn).toBe(record.urn);
  });

  it('rejects an unsigned record or a missing signer', async () => {
    await expect(signMandate({}, signer)).rejects.toThrow(MandateError);
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: '/kg/' });
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
      container: '/kg/',
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(isMandateActive(record, 1500)).toBe(true);
    expect(isMandateActive(record, 2000)).toBe(false);
    expect(isMandateActive({ ...record, revoked: true }, 1500)).toBe(false);
  });

  it('a null expiry never times out', () => {
    const { record } = createMandate({ issuer: ISSUER, agent: AGENT, container: '/kg/' });
    expect(record.expires_at).toBeNull();
    expect(isMandateActive(record, 9_999_999_999)).toBe(true);
  });
});
