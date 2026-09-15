'use strict';

/**
 * Unit tests for `sendGiftWrappedDm` — the ONE NIP-59 gift-wrap send site in
 * this repo (management-api/lib/junkiejarvis-agent.js), lifted out of
 * JunkieJarvisAgent._sendDm so the nightly forum-suggestions tenant can reuse
 * the identical envelope instead of hand-rolling a second one (ADR-2088).
 *
 * nostr-tools is mocked at the module level — the same convention as
 * tests/sovereign/nostr-bridge.test.js — because its ESM crypto cannot be
 * loaded by jest's CJS transform. What is under test here is the ENVELOPE
 * WIRING (rumor shape, wrap call arguments, publish-raw, fail-open), never the
 * cryptography itself, which belongs to nostr-tools.
 */

const mockWrapCalls = [];
const mockUnwrapCalls = [];

jest.mock('nostr-tools', () => ({
  nip59: {
    wrapEvent: (rumor, senderSk, recipientPubkey) => {
      mockWrapCalls.push({ rumor, senderSk, recipientPubkey });
      return {
        id: 'w'.repeat(64),
        sig: 's'.repeat(128),
        kind: 1059,
        pubkey: 'ephemeral'.padEnd(64, '0'), // NIP-59: a throwaway key, not the sender
        tags: [['p', recipientPubkey]],
        content: 'sealed',
        created_at: 1_760_000_000,
      };
    },
    unwrapEvent: (wrap, sk) => {
      mockUnwrapCalls.push({ wrap, sk });
      if (wrap && wrap.content === 'undecryptable') throw new Error('bad mac');
      return { kind: 14, pubkey: 'a'.repeat(64), content: 'the reply', tags: [['p', 'jj']], created_at: 1 };
    },
  },
  finalizeEvent: (ev) => ({ ...ev, id: 'f'.repeat(64), sig: 'g'.repeat(128) }),
  getPublicKey: () => 'p'.repeat(64),
}), { virtual: true }); // virtual: nostr-tools resolves from management-api/, not from tests/

const { sendGiftWrappedDm, unwrapDmRumor, signerFromHex, kinds } = require('../../management-api/lib/junkiejarvis-agent');

const RECIPIENT = 'b'.repeat(64);

beforeEach(() => { mockWrapCalls.length = 0; mockUnwrapCalls.length = 0; });

describe('sendGiftWrappedDm', () => {
  const signer = () => signerFromHex('1'.repeat(64));

  test('is exported as a free function so the nightly tenant reuses it', () => {
    expect(typeof sendGiftWrappedDm).toBe('function');
  });

  test('wraps a kind-14 rumor p-tagged to the recipient and publishes it raw', async () => {
    const published = [];
    const bridge = { publish: async (ev, s) => { published.push({ ev, s }); return s.sign(ev); } };

    const wrapped = await sendGiftWrappedDm({
      bridge, signer: signer(), recipientPubkey: RECIPIENT, text: 'need more detail',
    });

    // The inner rumor is a NIP-17 DM addressed to the recipient.
    expect(mockWrapCalls).toHaveLength(1);
    expect(mockWrapCalls[0].rumor.kind).toBe(kinds.DM_RUMOR);
    expect(mockWrapCalls[0].rumor.content).toBe('need more detail');
    expect(mockWrapCalls[0].rumor.tags).toEqual([['p', RECIPIENT]]);
    expect(mockWrapCalls[0].recipientPubkey).toBe(RECIPIENT);

    // The wrap is already signed by an ephemeral key, so it is published RAW
    // (identity signer bypassed) — re-signing would destroy the gift wrap.
    expect(published).toHaveLength(1);
    expect(published[0].ev.kind).toBe(1059);
    const passthrough = published[0].s;
    expect(passthrough.sign(published[0].ev)).toBe(published[0].ev);

    // The caller gets the wrap back, so the DM event id can be recorded.
    expect(wrapped.id).toBe('w'.repeat(64));
  });

  test('returns the wrap so the caller can record the DM event id', async () => {
    const bridge = { publish: async (ev) => ev };
    const wrapped = await sendGiftWrappedDm({
      bridge, signer: signer(), recipientPubkey: RECIPIENT, text: 'x',
    });
    expect(typeof wrapped.id).toBe('string');
    expect(wrapped.id).toHaveLength(64);
  });

  test('fails open: a publish error returns null rather than throwing', async () => {
    const bridge = { publish: async () => { throw new Error('relay down'); } };
    await expect(
      sendGiftWrappedDm({ bridge, signer: signer(), recipientPubkey: RECIPIENT, text: 'hello' })
    ).resolves.toBeNull();
  });

  test('refuses to send without a signer, bridge, recipient or text', async () => {
    const bridge = { publish: async (ev) => ev };
    await expect(sendGiftWrappedDm({ bridge, signer: null, recipientPubkey: RECIPIENT, text: 'x' })).resolves.toBeNull();
    await expect(sendGiftWrappedDm({ bridge: null, signer: signer(), recipientPubkey: RECIPIENT, text: 'x' })).resolves.toBeNull();
    await expect(sendGiftWrappedDm({ bridge, signer: signer(), recipientPubkey: '', text: 'x' })).resolves.toBeNull();
    await expect(sendGiftWrappedDm({ bridge, signer: signer(), recipientPubkey: RECIPIENT, text: '  ' })).resolves.toBeNull();
    await expect(sendGiftWrappedDm()).resolves.toBeNull();
    expect(mockWrapCalls).toHaveLength(0);
  });

  test('never touches the key material beyond handing skBytes to nip59', async () => {
    const bridge = { publish: async (ev) => ev };
    const s = signer();
    await sendGiftWrappedDm({ bridge, signer: s, recipientPubkey: RECIPIENT, text: 'x' });
    expect(mockWrapCalls[0].senderSk).toBe(s.skBytes);
  });
});

describe('unwrapDmRumor', () => {
  const sk = signerFromHex('1'.repeat(64)).skBytes;

  test('returns the inner kind-14 rumor', () => {
    const rumor = unwrapDmRumor({ kind: 1059, content: 'sealed' }, sk);
    expect(rumor.kind).toBe(kinds.DM_RUMOR);
    expect(rumor.content).toBe('the reply');
    expect(mockUnwrapCalls[0].sk).toBe(sk);
  });

  test('fails open to null on an undecryptable wrap', () => {
    expect(unwrapDmRumor({ kind: 1059, content: 'undecryptable' }, sk)).toBeNull();
  });

  test('fails open to null on malformed input', () => {
    expect(unwrapDmRumor(null, sk)).toBeNull();
    expect(unwrapDmRumor({ kind: 1059 }, null)).toBeNull();
    expect(unwrapDmRumor()).toBeNull();
    expect(mockUnwrapCalls).toHaveLength(0);
  });
});
