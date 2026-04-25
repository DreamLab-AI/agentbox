'use strict';

/**
 * Surface-level encoder smoke tests — every surface produces a non-empty
 * JSON-LD document with the expected @context and @type. These are
 * pure-function tests; they don't require the full pinned catalogue.
 */

const surfaces = {
  S1:  require('../../../management-api/middleware/linked-data/surfaces/s01-pods'),
  S2:  require('../../../management-api/middleware/linked-data/surfaces/s02-nostr'),
  S3:  require('../../../management-api/middleware/linked-data/surfaces/s03-credentials'),
  S4:  require('../../../management-api/middleware/linked-data/surfaces/s04-did'),
  S5:  require('../../../management-api/middleware/linked-data/surfaces/s05-provenance'),
  S6:  require('../../../management-api/middleware/linked-data/surfaces/s06-wot'),
  S7:  require('../../../management-api/middleware/linked-data/surfaces/s07-skill'),
  S8:  require('../../../management-api/middleware/linked-data/surfaces/s08-payments'),
  S9:  require('../../../management-api/middleware/linked-data/surfaces/s09-dcat'),
  S10: require('../../../management-api/middleware/linked-data/surfaces/s10-arch-docs'),
  S11: require('../../../management-api/middleware/linked-data/surfaces/s11-http-meta'),
};

const AGBX_DID = 'did:nostr:npub1agentbox0000000000000000000000000000000000';

describe('Surface encoders', () => {
  test('S1 pods — produces a Compacted node', async () => {
    const r = await surfaces.S1.encode(
      { id: 'urn:agentbox:pod:1', type: 'as:Note', name: 'hi' },
      { agentDid: AGBX_DID, operation: 'write' },
    );
    expect(r.document['@id']).toBe('urn:agentbox:pod:1');
    expect(r.document.wasAttributedTo).toBe(AGBX_DID);
    expect(Array.isArray(r.document['@context'])).toBe(true);
  });

  test('S2 nostr — encode then decode matches verb', async () => {
    const r = await surfaces.S2.encode(
      { verb: 'handoff-claim', content: 'pass it on', recipient: 'did:nostr:npub1other' },
      { agentDid: AGBX_DID },
    );
    expect(r.document['@type']).toBe('HandoffClaim');
    const decoded = surfaces.S2.decode(r.document);
    expect(decoded.verb).toBe('handoff-claim');
  });

  test('S3 credentials — VC structure', async () => {
    const r = await surfaces.S3.encode(
      { credentialSubject: { id: 'did:nostr:npub1subject', name: 'Subject' }, issuer: AGBX_DID },
      { agentDid: AGBX_DID },
    );
    expect(r.document.type).toContain('VerifiableCredential');
    expect(r.document.issuer).toBe(AGBX_DID);
    expect(r.document.validFrom).toBeTruthy();
  });

  test('S4 DID — Document with services', async () => {
    const r = await surfaces.S4.encode(
      { did: AGBX_DID, pubkeyHex: '02'.repeat(33) },
      {
        manifest: {
          integrations: { solid_pod_rs: { base_url: 'http://127.0.0.1:8484' } },
          sovereign_mesh: { relay: { port: 7777, bind: '127.0.0.1' } },
          linked_data: { did: { service_endpoints: ['pod', 'relay'] } },
        },
        agentDid: AGBX_DID,
      },
    );
    expect(r.document.id).toBe(AGBX_DID);
    expect(r.document.service.find((s) => s.type === 'SolidPod')).toBeTruthy();
    expect(r.document.service.find((s) => s.type === 'NostrRelay')).toBeTruthy();
  });

  test('S5 provenance — Activity', async () => {
    const r = await surfaces.S5.encode(
      { action: 'memory.write', input: 'urn:x:1', output: 'urn:x:2', label: 'test' },
      { agentDid: AGBX_DID },
    );
    expect(r.document['@type']).toBe('prov:Activity');
    expect(r.document['prov:wasAssociatedWith']).toEqual({ '@id': AGBX_DID });
  });

  test('S6 WoT TD — Thing Description', async () => {
    const r = await surfaces.S6.encode(
      {
        serverId: 'playwright',
        title: 'Playwright MCP',
        actions: { 'browser.navigate': { description: 'open url' } },
        properties: { 'currentUrl': { type: 'string', readOnly: true } },
      },
      { agentDid: AGBX_DID, manifest: {} },
    );
    expect(r.document['@type']).toContain('Thing');
    expect(r.document.actions['browser.navigate']).toBeTruthy();
    expect(r.document.properties.currentUrl.readOnly).toBe(true);
  });

  test('S7 skill — HowTo metadata', async () => {
    const r = await surfaces.S7.encode({
      id: 'agentbox:skill:console-buddy', name: 'Console buddy',
      description: 'Talks to the dev console',
      progressiveDisclosure: true, invocationTrigger: 'console',
    });
    expect(r.document['@type']).toContain('schema:HowTo');
  });

  test('S8 payments — mandate encoded', async () => {
    const r = await surfaces.S8.encode(
      {
        kind: 'mandate', principal: 'did:nostr:npub1human',
        assignee: AGBX_DID, target: 'urn:product:1',
        action: 'odrl:use',
      },
      { agentDid: AGBX_DID, operation: 'issue-mandate' },
    );
    expect(r.document.type).toContain('PaymentMandate');
    expect(r.document.credentialSubject['odrl:assigner']).toBe('did:nostr:npub1human');
  });

  test('S9 DCAT — catalogue with one dataset', async () => {
    const r = await surfaces.S9.encode(
      {
        namespaces: [{ name: 'project-state', count: 42, accessPolicy: 'public' }],
      },
      { agentDid: AGBX_DID },
    );
    expect(r.document['@type']).toBe('dcat:Catalog');
    expect(r.document['dcat:dataset'][0]['dcterms:title']).toBe('project-state');
  });

  test('S10 architecture docs — frame', async () => {
    const r = await surfaces.S10.encode({
      docClass: 'adr', id: 'urn:agentbox:adr:012', title: 'JSON-LD adoption',
      date: '2026-04-25', references: ['urn:agentbox:prd:006'], status: 'Accepted',
    });
    expect(r.document['@type']).toBe('ADR');
    expect(r.document['dcterms:references'][0]['@id']).toBe('urn:agentbox:prd:006');
  });

  test('S11 HTTP meta — schema.org SoftwareApplication', async () => {
    const r = await surfaces.S11.encode(
      { kind: 'meta', imageRef: 'agentbox:runtime', version: '1.2.3', bootstrapCompleted: true },
      { agentDid: AGBX_DID, operation: 'serve-meta' },
    );
    expect(r.document['@type']).toContain('schema:SoftwareApplication');
    expect(r.document['schema:softwareVersion']).toBe('1.2.3');
  });
});
