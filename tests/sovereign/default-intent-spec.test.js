'use strict';

/**
 * WS9 (PRD-014 Seam B / B3): the default intentSpec turns a Schnorr-verified
 * inbound agent-intent event into a deterministic spawn spec dispatching to
 * the addressed actor, stamping the verified did:nostr as an unforgeable
 * source URN. It is fail-safe: no command configured → null → the consumer's
 * marker-only path is unchanged.
 */

const { buildDefaultIntentSpec, resolveActorRef } = require('../../mcp/nostr-bridge/default-intent-spec');

const SIGNER = 'f'.repeat(64);

function evt(tags = [], extra = {}) {
  return { kind: 38000, pubkey: SIGNER, content: 'turn on the lights', tags, ...extra };
}

describe('buildDefaultIntentSpec gating', () => {
  it('returns null when no command is configured (marker-only path preserved)', () => {
    expect(buildDefaultIntentSpec({ env: {} })).toBeNull();
    expect(buildDefaultIntentSpec({ env: { AGENTBOX_INTENT_ARGS: '--x' } })).toBeNull();
  });

  it('returns a spec builder when a command is configured', () => {
    const fn = buildDefaultIntentSpec({ env: { AGENTBOX_INTENT_COMMAND: 'claude-flow' } });
    expect(typeof fn).toBe('function');
  });
});

describe('resolveActorRef precedence', () => {
  it('prefers an explicit actor tag', () => {
    expect(resolveActorRef(evt([['actor', 'librarian'], ['a', '31400:abc:panelX']]), {})).toBe('librarian');
  });

  it('falls back to the dtag of an a (NIP-33) coordinate', () => {
    expect(resolveActorRef(evt([['a', '31400:abc:panelX']]), {})).toBe('panelX');
  });

  it('falls back to the recipient npub when no addressing tag is present', () => {
    expect(resolveActorRef(evt([]), { recipient_npub: 'npub-owner' })).toBe('npub-owner');
  });
});

describe('default intentSpec output', () => {
  const env = {
    AGENTBOX_INTENT_COMMAND: 'claude-flow',
    AGENTBOX_INTENT_ARGS: 'respond --json',
    AGENTBOX_INTENT_CWD: '/work',
  };

  it('builds a deterministic command/args dispatching to the addressed actor', () => {
    const fn = buildDefaultIntentSpec({ env });
    const spec = fn(evt([['actor', 'librarian']]), { recipient_npub: 'npub-owner', intent_kind: 38000 });
    expect(spec.command).toBe('claude-flow');
    expect(spec.args).toEqual(['respond', '--json', 'librarian']);
    expect(spec.cwd).toBe('/work');
  });

  it('stamps the Schnorr-verified did:nostr as the unforgeable source URN', () => {
    const fn = buildDefaultIntentSpec({ env });
    const spec = fn(evt([['actor', 'librarian']]), { recipient_npub: 'npub-owner' });
    expect(spec.env.AGENTBOX_INTENT_SOURCE_URN).toBe(`did:nostr:${SIGNER}`);
    expect(spec.env.AGENTBOX_INTENT_ACTOR).toBe('librarian');
    expect(spec.env.AGENTBOX_INTENT_CONTENT).toBe('turn on the lights');
  });

  it('is deterministic for identical inputs', () => {
    const fn = buildDefaultIntentSpec({ env });
    const a = fn(evt([['actor', 'librarian']]), { recipient_npub: 'o' });
    const b = fn(evt([['actor', 'librarian']]), { recipient_npub: 'o' });
    expect(a).toEqual(b);
  });
});
