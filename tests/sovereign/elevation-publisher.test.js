'use strict';

/**
 * Closes the WS6 elevation → Nostr federation loop (the value-bearing moat:
 * personal→shared ontology elevation, federated over Nostr, governed by humans).
 *
 * Proves lib/elevation-publisher:
 *   - FEDERATED: when the nostr_bridge gate is on, relays are configured, and a
 *     signing stack is present, each governed proposal is published as a SIGNED
 *     ACSP ActionRequest (kind 31402) keyed by its canonical proposal URN, with
 *     broker_cases governance tags (category/subject/title/priority).
 *   - STANDALONE: when the gate is off / no relays / no signing stack, the
 *     publisher is inert — publish() is a logged no-op, never throws, and never
 *     touches a bridge. The beam+propose path is therefore unaffected.
 *   - RESILIENT: a bridge/publish failure degrades to a logged no-op, not a
 *     thrown error into the request path.
 *
 * Every URN that crosses the wire is the proposal's own lib/uris.js-minted
 * canonical URN — no ad-hoc identifiers are invented by the publisher.
 */

const { buildElevationPublisher } = require('../../management-api/lib/elevation-publisher');
const { kinds } = require('../../mcp/servers/nostr-bridge');
const uris = require('../../management-api/lib/uris');

const PUBKEY = 'b'.repeat(64);

// A representative kg-proposal-extractor descriptor (only the fields the
// publisher reads), with a real canonical proposal URN.
function makeProposal() {
  const proposal_urn = uris.mint({
    kind: 'thing',
    pubkey: PUBKEY,
    localId: 'proposal-deadbeef0001',
  });
  return {
    proposal_urn,
    proposal_foreign_urn: 'urn:visionclaw:kg:' + PUBKEY + ':sha256-12-deadbeef0001',
    target_urn: 'urn:visionclaw:concept:renewables:photovoltaic-cell',
    propose_request: { path: '/api/ontology-agent/propose', method: 'POST', body: { action: 'create' } },
    candidate: {
      term: 'Photovoltaic Cell',
      domain: 'renewables',
      definition: 'A semiconductor device that converts light into electricity.',
      score: 0.9,
      reasons: ['named', 'defined', 'substantive'],
    },
  };
}

const tag = (ev, name) => (ev.tags.find((t) => t[0] === name) || [])[1];
const dtag = (ev) => tag(ev, 'd');

const FEDERATED_ENV = {
  NOSTR_RELAYS: 'wss://relay.example',
  AGENTBOX_STACK: 'sovereign',
};

describe('elevation-publisher — federated path', () => {
  function setup(overrides = {}) {
    const published = [];
    // Fake already-connected bridge + signer injected directly.
    const bridge = { publish() {} };
    const signer = { sign() {} };
    const publishPanelEvent = jest.fn(async (b, s, unsigned) => {
      expect(b).toBe(bridge);
      expect(s).toBe(signer);
      const signed = { ...unsigned, id: 'evt-' + published.length, sig: 'sig', pubkey: PUBKEY };
      published.push({ unsigned, signed });
      return signed;
    });
    const pub = buildElevationPublisher(
      { sovereign_mesh: { nostr_bridge: true } },
      { env: FEDERATED_ENV, bridge, signer, publishPanelEvent, ...overrides }
    );
    return { pub, published, publishPanelEvent };
  }

  test('is enabled when gate on + relays + signing stack', () => {
    const { pub } = setup();
    expect(pub.enabled).toBe(true);
    expect(pub.reason).toBeNull();
  });

  test('publishes a signed ACSP ActionRequest (kind 31402) keyed by the proposal URN', async () => {
    const { pub, published } = setup();
    const proposal = makeProposal();

    const res = await pub.publish(proposal);

    expect(res.published).toBe(true);
    expect(res.event_id).toBe('evt-0');
    expect(res.kind).toBe(kinds.ACTION_REQUEST); // 31402
    expect(published).toHaveLength(1);

    const ev = published[0].unsigned;
    expect(ev.kind).toBe(31402);
    // NIP-33 d-tag is the canonical proposal URN (no ad-hoc identifier).
    expect(dtag(ev)).toBe(proposal.proposal_urn);
    expect(uris.isCanonical(dtag(ev))).toBe(true);

    // Governance / broker_cases projection tags.
    expect(tag(ev, 'priority')).toBe('medium');
    expect(tag(ev, 'category')).toBe('ontology-elevation');
    expect(tag(ev, 'subject-kind')).toBe('concept');
    expect(tag(ev, 'subject-id')).toBe(proposal.target_urn);
    expect(tag(ev, 'title')).toContain('Photovoltaic Cell');

    // Governed descriptor + provenance travel in content fields.
    const content = JSON.parse(ev.content);
    expect(content.fields.proposal_urn).toBe(proposal.proposal_urn);
    expect(content.fields.target_urn).toBe(proposal.target_urn);
    expect(content.fields.propose_request).toEqual(proposal.propose_request);
    expect(content.fields.term).toBe('Photovoltaic Cell');
  });

  test('lazily constructs a bridge + signer from the module when not injected', async () => {
    const fakeBridge = { connect: jest.fn(), publish: jest.fn() };
    const fakeSigner = { sign: jest.fn() };
    const bridgeModule = {
      NostrBridge: jest.fn(function () { return fakeBridge; }),
      loadSigner: jest.fn(() => fakeSigner),
    };
    const publishPanelEvent = jest.fn(async (b, s, unsigned) => {
      expect(b).toBe(fakeBridge);
      expect(s).toBe(fakeSigner);
      return { ...unsigned, id: 'lazy-0' };
    });
    const pub = buildElevationPublisher(
      { sovereign_mesh: { nostr_bridge: true } },
      { env: FEDERATED_ENV, bridgeModule, publishPanelEvent }
    );

    const res = await pub.publish(makeProposal());
    expect(res.published).toBe(true);
    expect(bridgeModule.NostrBridge).toHaveBeenCalledTimes(1);
    expect(fakeBridge.connect).toHaveBeenCalledTimes(1);
    expect(bridgeModule.loadSigner).toHaveBeenCalledWith('sovereign', {});

    // Cached: a second publish reuses the same bridge + signer.
    await pub.publish(makeProposal());
    expect(bridgeModule.NostrBridge).toHaveBeenCalledTimes(1);
    expect(bridgeModule.loadSigner).toHaveBeenCalledTimes(1);
  });

  test('a publish failure degrades to a logged no-op, never throws', async () => {
    const { pub } = setup({
      publishPanelEvent: jest.fn(async () => { throw new Error('relay down'); }),
    });
    const res = await pub.publish(makeProposal());
    expect(res.published).toBe(false);
    expect(res.reason).toBe('relay down');
  });
});

describe('elevation-publisher — standalone (federation off)', () => {
  const cases = [
    ['gate off', { sovereign_mesh: { nostr_bridge: false } }, FEDERATED_ENV, 'nostr-bridge-gate-off'],
    ['no relays', { sovereign_mesh: { nostr_bridge: true } }, { AGENTBOX_STACK: 'sovereign' }, 'no-relays'],
    ['no signing stack', { sovereign_mesh: { nostr_bridge: true } }, { NOSTR_RELAYS: 'wss://relay.example' }, 'no-signing-stack'],
  ];

  test.each(cases)('inert no-op: %s', async (_label, manifest, env, expectedReason) => {
    const publishPanelEvent = jest.fn();
    const pub = buildElevationPublisher(manifest, { env, publishPanelEvent });

    expect(pub.enabled).toBe(false);
    expect(pub.reason).toBe(expectedReason);

    const res = await pub.publish(makeProposal());
    expect(res.published).toBe(false);
    expect(res.reason).toBe(expectedReason);
    // Never touched a bridge — the beam+propose path is unaffected.
    expect(publishPanelEvent).not.toHaveBeenCalled();
  });
});
