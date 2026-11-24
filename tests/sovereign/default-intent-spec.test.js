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

  it('prefers p over an a coordinate', () => {
    expect(resolveActorRef(evt([['a', '31400:abc:panelX'], ['p', AGENT]]), {})).toBe(AGENT);
  });

  it('falls back to the dtag of an a (NIP-33) coordinate', () => {
    expect(resolveActorRef(evt([['a', '31400:abc:panelX']]), {})).toBe('panelX');
  });

  it('falls back to the recipient npub when no addressing tag is present', () => {
    expect(resolveActorRef(evt([]), { recipient_npub: 'npub-owner' })).toBe('npub-owner');
  });
});

// Producer fixtures: every 38000-band intent shape the spec accepts, pinned so a
// precedence change cannot silently re-route one (AB-INTENT-ACTOR-FROM-CARD-DTAG).
//   1. nostr-rust-forum create_agent_intent_signer (kanban.rs), from PR "add actor tag"
//   2. the same producer before that change (no actor tag)
//   3. panel-addressed intent, `a` = 31400 panel coordinate (the documented
//      voice-origin shape, PRD-014 B3; no producer in this repo emits it)
// agentbox's own voice-intent route emits kind 31402 with a `p` tag, not 38000,
// so it never reaches this spec.
const AGENT = 'ab'.repeat(32);
const AUTHOR = 'cd'.repeat(32);
const CARD_DTAG = 'card-7f3a';
const CARD_COORD = `30302:${AUTHOR}:${CARD_DTAG}`;
const FORUM_TAGS = [
  ['p', AGENT],
  ['a', CARD_COORD],
  ['board', 'board-1'],
  ['card_d', CARD_DTAG],
];

describe('producer fixtures (38000 intent shapes)', () => {
  it('forum kanban intent with actor tag resolves to the agent key', () => {
    const e = evt([['p', AGENT], ['actor', AGENT], ...FORUM_TAGS.slice(1)]);
    expect(resolveActorRef(e, {})).toBe(AGENT);
  });

  it('forum kanban intent without actor tag resolves to p, never the card d-tag', () => {
    const ref = resolveActorRef(evt(FORUM_TAGS), { recipient_npub: 'npub-owner' });
    expect(ref).toBe(AGENT);
    expect(ref).not.toBe(CARD_DTAG);
  });

  it('a kanban card coordinate is never an actor, even with no p or actor', () => {
    const e = evt([['a', CARD_COORD], ['card_d', CARD_DTAG]]);
    expect(resolveActorRef(e, { recipient_npub: 'npub-owner' })).toBe('npub-owner');
    expect(resolveActorRef(e, {})).toBe('');
  });

  it('a panel coordinate (31400) still names the actor by d-tag', () => {
    const e = evt([['a', `31400:${AUTHOR}:panelX`]]);
    expect(resolveActorRef(e, {})).toBe('panelX');
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
