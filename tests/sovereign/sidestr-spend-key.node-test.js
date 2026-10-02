'use strict';

/**
 * ADR-2101 D3/D4 and ADR-2097 D3 (amended 2026-10-02): k_spend differs from
 * k_id and is bound to it by a k_id-signed kind-38420 event. Known-answer test.
 *
 * Runner: node:test (nostr-tools pulls ESM-only @noble packages jest cannot
 * require). Keys are fixed test scalars (0x11…, 0x22…); nothing is published.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPublicKey, verifyEvent } = require('../../management-api/node_modules/nostr-tools');
const sk = require('../../management-api/lib/sidestr-spend-key');

const K_ID = '11'.repeat(32);
const K_SPEND = '22'.repeat(32);
const CHAIN = 'sidestr:dreamlab';
const GENESIS = '4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0';

// Known answers. The two pubkeys are the BIP-340 x-only keys of the scalars
// 0x11…11 and 0x22…22; the event id is NIP-01's sha256 over the serialised
// binding with created_at 1790971200, recomputed independently below.
const KAT = {
  idPubkey: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
  spendPubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
  bindingId: '2235e3d8c9acb8da72eadb71da3eb0de4b69122a42562cdb6093e25712ee23f9',
};

describe('k_spend binding — known answer', () => {
  test('the two keys differ and derive to the known x-only pubkeys', () => {
    assert.equal(getPublicKey(Buffer.from(K_ID, 'hex')), KAT.idPubkey);
    assert.equal(getPublicKey(Buffer.from(K_SPEND, 'hex')), KAT.spendPubkey);
    assert.notEqual(KAT.idPubkey, KAT.spendPubkey);
  });

  test('the binding event has the known id, verifies, and names the spend key', () => {
    const e = sk.buildBinding({ idSecretHex: K_ID, spendPubkey: KAT.spendPubkey, chainId: CHAIN, createdAt: 1790971200 });
    assert.equal(e.kind, 38420);
    assert.equal(e.pubkey, KAT.idPubkey);
    assert.equal(e.content, KAT.spendPubkey);
    assert.deepEqual(e.tags[0], ['d', `${GENESIS}:${KAT.idPubkey}`]);
    assert.equal(e.id, KAT.bindingId);
    const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
    assert.equal(crypto.createHash('sha256').update(serial).digest('hex'), KAT.bindingId);
    assert.equal(verifyEvent(e), true);
    assert.equal(sk.verifyBinding(e, { chainId: CHAIN, didHex: KAT.idPubkey, spendPubkey: KAT.spendPubkey }), true);
  });

  test('a tampered binding does not verify', () => {
    const e = sk.buildBinding({ idSecretHex: K_ID, spendPubkey: KAT.spendPubkey, chainId: CHAIN, createdAt: 1790971200 });
    const other = { ...e, content: KAT.idPubkey };
    assert.equal(sk.verifyBinding(other, { chainId: CHAIN, didHex: KAT.idPubkey, spendPubkey: KAT.idPubkey }), false);
    const wrongD = { ...e, tags: [['d', `${'0'.repeat(64)}:${KAT.idPubkey}`], ...e.tags.slice(1)] };
    assert.equal(sk.verifyBinding(wrongD, { chainId: CHAIN, didHex: KAT.idPubkey, spendPubkey: KAT.spendPubkey }), false);
  });

  test('binding k_id to itself is refused', () => {
    assert.throws(() => sk.buildBinding({ idSecretHex: K_ID, spendPubkey: KAT.idPubkey, chainId: CHAIN, createdAt: 1 }), /differ/);
  });

  test('an uncompiled chain is refused', () => {
    assert.throws(() => sk.buildBinding({ idSecretHex: K_ID, spendPubkey: KAT.spendPubkey, chainId: 'sidestr:nope', createdAt: 1 }), /compiled/);
  });
});

describe('loadOrMintSpend — at spawn, beside k_id', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-key-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function identity() {
    const keyPath = path.join(dir, 'agent-did-test.key');
    fs.writeFileSync(keyPath, `${K_ID}\n`, { mode: 0o600 });
    return { pubkey: KAT.idPubkey, keyPath };
  }

  test('mints a 0600 spend key that differs from k_id, with a verifying binding', () => {
    const r = sk.loadOrMintSpend({ identity: identity(), chainId: CHAIN });
    assert.equal(r.minted, true);
    assert.equal(r.did, `did:nostr:${KAT.idPubkey}`);
    assert.notEqual(r.spendPubkey, KAT.idPubkey);
    assert.equal(path.dirname(r.spendKeyPath), dir);
    assert.equal(fs.statSync(r.spendKeyPath).mode & 0o777, 0o600);
    assert.equal(sk.verifyBinding(r.binding, { chainId: CHAIN, didHex: KAT.idPubkey, spendPubkey: r.spendPubkey }), true);
    assert.ok(!JSON.stringify(r).includes(fs.readFileSync(r.spendKeyPath, 'utf8').trim()), 'no secret in the result');
  });

  test('a second call loads the same key and binding', () => {
    const id = identity();
    const a = sk.loadOrMintSpend({ identity: id, chainId: CHAIN });
    const b = sk.loadOrMintSpend({ identity: id, chainId: CHAIN });
    assert.equal(b.minted, false);
    assert.equal(b.spendPubkey, a.spendPubkey);
    assert.equal(b.binding.id, a.binding.id);
    assert.deepEqual(sk.findSpendKey({ didHex: KAT.idPubkey, chainId: CHAIN, identityDir: dir }).spendPubkey, a.spendPubkey);
  });

  test('an identity whose key file does not match is refused', () => {
    const id = identity();
    assert.throws(() => sk.loadOrMintSpend({ identity: { ...id, pubkey: KAT.spendPubkey }, chainId: CHAIN }), /does not match/);
  });

  test('findSpendKey returns null when no key was minted', () => {
    assert.equal(sk.findSpendKey({ didHex: KAT.idPubkey, chainId: CHAIN, identityDir: dir }), null);
  });
});

describe('publishBinding — fail-open, counts NIP-01 OK true only', () => {
  const { EventEmitter } = require('events');
  function fakeWs(behaviour) {
    return class extends EventEmitter {
      constructor(url) {
        super();
        this.url = url;
        setImmediate(() => (behaviour[url] === 'error' ? this.emit('error', new Error('refused')) : this.emit('open')));
      }
      send(msg) {
        const [, ev] = JSON.parse(msg);
        const b = behaviour[this.url];
        if (b === 'ok') setImmediate(() => this.emit('message', JSON.stringify(['OK', ev.id, true, ''])));
        if (b === 'rejected') setImmediate(() => this.emit('message', JSON.stringify(['OK', ev.id, false, 'blocked'])));
      }
      terminate() { this.emit('close'); }
      close() { this.emit('close'); }
    };
  }

  test('one accepting, one rejecting, one failing, one silent relay → 1 of 4', async () => {
    const e = sk.buildBinding({ idSecretHex: K_ID, spendPubkey: KAT.spendPubkey, chainId: CHAIN, createdAt: 1790971200 });
    const relays = ['wss://a', 'wss://b', 'wss://c', 'wss://d'];
    const WebSocket = fakeWs({ 'wss://a': 'ok', 'wss://b': 'rejected', 'wss://c': 'error', 'wss://d': 'silent' });
    assert.deepEqual(await sk.publishBinding(e, relays, { WebSocket, timeoutMs: 50 }), { ok: 1, relays: 4 });
  });

  test('no relays → nothing attempted', async () => {
    assert.deepEqual(await sk.publishBinding({}, []), { ok: 0, relays: 0 });
  });
});

describe('the captured 402 (tests/contract/pay402/fixtures/sidestr-dreamlab.json)', () => {
  test("its payee binding verifies with nostr-tools and names the offer's spend key", () => {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contract', 'pay402', 'fixtures', 'sidestr-dreamlab.json'), 'utf8'));
    const e = f.body.accepts[0];
    const didHex = e.pay_to.slice('did:nostr:'.length);
    assert.equal(sk.verifyBinding(e.binding, { chainId: e.chain_id, didHex, spendPubkey: e.pubkey }), true);
    assert.notEqual(e.pubkey, didHex, 'the payee is paid at its spend key, not its identity key');
    const { classify } = require('../../management-api/lib/pay402');
    const r = classify({ status: f.status, headers: f.headers, body: f.body }, { rails: { sidestr: { enabled: true, chain_id: CHAIN } }, verifyEvent: sk.verifyEventFresh });
    assert.equal(r.payable, true);
    assert.equal(r.offer.payee_did, e.pay_to);
  });
});
