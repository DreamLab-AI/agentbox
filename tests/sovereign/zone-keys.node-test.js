'use strict';

/**
 * zone-keys + JunkieJarvis encrypted-zone handling (forum kit ADR-2016).
 *
 * Runner: node:test (`node --test tests/sovereign/zone-keys.node-test.js`,
 * wired into management-api `npm run test:node`) — nostr-tools pulls ESM-only
 * @noble packages that the jest runtime cannot require, and these tests use the
 * real primitives. Real nostr-tools crypto throughout (no mocks). Keys are
 * fixed test scalars, never real key material. Cross-implementation checks
 * read the fixtures in services/dream-engine/tests/fixtures/, produced by the
 * Rust side (nostr-bbs-core) — a Rust ciphertext and a kit-format grant wrap
 * built with core's `wrap_seal` — and the JS ciphertext the Rust test decrypts.
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPublicKey, finalizeEvent, nip44, generateSecretKey } = require('../../management-api/node_modules/nostr-tools');

const zk = require('../../management-api/lib/zone-keys');
const {
  JunkieJarvisAgent,
  unwrapDmRumor,
  signerFromHex,
} = require('../../management-api/lib/junkiejarvis-agent');

const FIXTURES = path.join(__dirname, '../../services/dream-engine/tests/fixtures');
const hexKey = (n) => n.toString(16).padStart(64, '0');
const bytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

const AUTHOR_SK = hexKey(1);
const ZONE_SK = hexKey(2);
const ADMIN_SK = hexKey(3);
const MEMBER_SK = hexKey(4); // the grant fixture's recipient
const GRANT_ZONE_SK = hexKey(5);

const pk = (skHex) => getPublicKey(bytes(skHex));

const ZONES = [
  { id: 'zone1', visibility: 'public', required_cohorts: [], encrypted: true },
  { id: 'zone3', visibility: 'locked', required_cohorts: ['family'], encrypted: true },
  { id: 'zone4', visibility: 'locked', required_cohorts: ['dreamlab'], encrypted: true, agent_keys: true },
  { id: 'zone2', visibility: 'locked', required_cohorts: ['m'] },
];

function zoneKey(epoch = 1, skHex = ZONE_SK, zone = 'zone4') {
  return { zone, epoch, secret: skHex, pubkey: pk(skHex), granted_by: pk(ADMIN_SK), received_at: 0 };
}

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmpStore(owner) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zone-keys-'));
  tmpDirs.push(dir);
  return new zk.ZoneKeyStore({ owner, file: path.join(dir, 'zone-keys.json') });
}

/** A kit-format grant wrap (rumor 21453 → seal 13 by `sealerSk` → wrap 1059). */
function grantWrap({ sealerSk, recipientPk, payload, rumorAuthor }) {
  const rumor = {
    pubkey: rumorAuthor || pk(sealerSk),
    created_at: 1_790_000_000,
    kind: zk.KIND_ZONE_KEY_GRANT,
    tags: [['p', recipientPk]],
    content: JSON.stringify(payload),
  };
  const seal = finalizeEvent({
    kind: 13,
    created_at: 1_790_000_000,
    tags: [],
    content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(bytes(sealerSk), recipientPk)),
  }, bytes(sealerSk));
  const eph = generateSecretKey();
  return finalizeEvent({
    kind: 1059,
    created_at: 1_790_000_000,
    tags: [['p', recipientPk]],
    content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(eph, recipientPk)),
  }, eph);
}

function grantPayload(skHex = GRANT_ZONE_SK, over = {}) {
  return { zone: 'zone4', epoch: 1, secret: skHex, pubkey: pk(skHex), created_at: 1_790_000_000, ...over };
}

// ── settings ────────────────────────────────────────────────────────────────

describe('settings', () => {
  const fakeFs = (text) => ({ readFileSync: () => text });

  test('gate is on only for the exact string "true"', () => {
    assert.equal(zk.gateEnabled({ ENCRYPTION_ENABLED: 'true' }, fakeFs('')), true);
    for (const v of ['TRUE', '1', 'yes', 'false', ' true']) {
      assert.equal(zk.gateEnabled({ ENCRYPTION_ENABLED: v }, fakeFs('')), false);
    }
  });

  test('falls back to the agentbox .env file, quotes stripped', () => {
    const text = 'X=1\nENCRYPTION_ENABLED="true"\nZONE_CONFIG=\'[{"id":"zone4","encrypted":true}]\'\n';
    assert.equal(zk.gateEnabled({}, fakeFs(text)), true);
    assert.deepEqual(zk.loadZones({}, fakeFs(text)), [{ id: 'zone4', encrypted: true }]);
    assert.deepEqual(zk.loadZones({}, fakeFs('ZONE_CONFIG=not json')), []);
    assert.equal(zk.gateEnabled({}, { readFileSync: () => { throw new Error('ENOENT'); } }), false);
  });

  test('section → zone mirrors the kit resolver; public zones are never encrypted', () => {
    assert.equal(zk.sectionToZone('zone4-chat-with-agents', ZONES), 'zone4');
    assert.equal(zk.sectionToZone('ZONE3', ZONES), 'zone3');
    assert.equal(zk.sectionToZone('music', ZONES), 'zone1');
    assert.equal(zk.zoneIsEncrypted('zone4', { gate: true, zones: ZONES }), true);
    assert.equal(zk.zoneIsEncrypted('zone4', { gate: false, zones: ZONES }), false);
    assert.equal(zk.zoneIsEncrypted('zone1', { gate: true, zones: ZONES }), false);
    assert.equal(zk.zoneIsEncrypted('zone2', { gate: true, zones: ZONES }), false);
  });
});

// ── messages ────────────────────────────────────────────────────────────────

describe('zone messages', () => {
  test('author encrypts, zone key holder decrypts; zk tag is the relay shape', () => {
    const key = zoneKey(1);
    const out = zk.applyWritePlan(
      { kind: 42, content: 'hello', tags: [['e', 'c'.repeat(64), '', 'root']] },
      { type: 'encrypt', key },
      bytes(AUTHOR_SK),
    );
    assert.notEqual(out.content, 'hello');
    assert.equal(out.tags[0][0], 'e');
    assert.deepEqual(out.tags[1], ['zk', 'zone4', '1', key.pubkey]);
    assert.deepEqual(zk.parseZk(out.tags), { zone: 'zone4', epoch: 1, pubkey: key.pubkey });
    const raw = Buffer.from(out.content, 'base64');
    assert.equal(raw[0], 2);
    assert.ok(out.content.length >= 132);
    const ev = { ...out, pubkey: pk(AUTHOR_SK) };
    assert.deepEqual(zk.readOutcome(ev, () => key), { type: 'decrypted', text: 'hello' });
    assert.equal(zk.readOutcome(ev, () => null).type, 'missing-key');
    assert.equal(zk.readOutcome(ev, () => zoneKey(1, hexKey(9))).type, 'failed');
    assert.deepEqual(zk.readOutcome({ kind: 42, content: 'plain', tags: [] }, () => null),
      { type: 'plain', text: 'plain' });
  });

  test('cross-implementation: JS decrypts the Rust vector, and the JS vector is ours', () => {
    const key = zoneKey(1);
    const author = pk(AUTHOR_SK);
    const rustCt = fs.readFileSync(path.join(FIXTURES, 'zone-rust-ciphertext.txt'), 'utf8').trim();
    assert.equal(zk.decryptWith({ pubkey: author, content: rustCt }, key), 'cross-check from rust');
    const jsCt = fs.readFileSync(path.join(FIXTURES, 'zone-js-ciphertext.txt'), 'utf8').trim();
    assert.equal(zk.decryptWith({ pubkey: author, content: jsCt }, key), 'cross-check from js');
  });

  test('write plan: gate off is plaintext, encrypted zone without a key refuses', () => {
    const store = tmpStore('me');
    const plain = zk.writePlan('zone4', { gate: false, zones: ZONES, store });
    assert.deepEqual(plain, { type: 'plain' });
    const msg = { kind: 42, content: 'hi', tags: [] };
    assert.equal(zk.applyWritePlan(msg, plain, bytes(AUTHOR_SK)), msg);
    const refused = zk.writePlan('zone4', { gate: true, zones: ZONES, store });
    assert.equal(refused.type, 'refuse');
    assert.throws(() => zk.applyWritePlan(msg, refused, bytes(AUTHOR_SK)));
    store.upsert(zoneKey(1));
    store.upsert(zoneKey(2, hexKey(7)));
    assert.equal(zk.writePlan('zone4', { gate: true, zones: ZONES, store }).key.epoch, 2);
  });
});

// ── grants ──────────────────────────────────────────────────────────────────

describe('zone-key grants', () => {
  const member = pk(MEMBER_SK);

  test('opens the Rust (nostr-bbs-core wrap_seal) grant fixture and accepts it', async () => {
    const wrap = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'zone-grant-wrap.json'), 'utf8'));
    const opened = zk.unwrapAny(wrap, bytes(MEMBER_SK));
    assert.equal(opened.sealer, pk(ADMIN_SK));
    const store = tmpStore(member);
    const res = await zk.acceptGrant(opened, { store, isAdmin: async (p) => p === pk(ADMIN_SK) });
    assert.equal(res.status, 'granted');
    assert.equal(store.get('zone4', 1).pubkey, pk(GRANT_ZONE_SK));
    const mode = fs.statSync(store.file).mode & 0o777;
    assert.equal(mode, 0o600);
    // Re-delivery is idempotent and does not re-query the admin check.
    const again = await zk.acceptGrant(opened, { store, isAdmin: async () => { throw new Error('not called'); } });
    assert.equal(again.status, 'known');
  });

  test('non-admin sealer is refused', async () => {
    const wrap = grantWrap({ sealerSk: hexKey(8), recipientPk: member, payload: grantPayload() });
    const opened = zk.unwrapAny(wrap, bytes(MEMBER_SK));
    const store = tmpStore(member);
    const res = await zk.acceptGrant(opened, { store, isAdmin: async () => false });
    assert.equal(res.status, 'rejected');
    assert.match(res.error, /not sealed by an admin/);
    assert.equal(store.keys().length, 0);
  });

  test('secret that does not derive to the stated pubkey is refused', async () => {
    const payload = grantPayload(GRANT_ZONE_SK, { pubkey: pk(hexKey(6)) });
    const opened = zk.unwrapAny(grantWrap({ sealerSk: ADMIN_SK, recipientPk: member, payload }), bytes(MEMBER_SK));
    const res = await zk.acceptGrant(opened, { store: tmpStore(member), isAdmin: async () => true });
    assert.deepEqual(res, { status: 'rejected', error: 'grant secret does not derive to its stated pubkey' });
  });

  test('a rumor claiming another author than the seal is refused', () => {
    const wrap = grantWrap({
      sealerSk: hexKey(8), recipientPk: member, payload: grantPayload(), rumorAuthor: pk(ADMIN_SK),
    });
    assert.throws(() => zk.unwrapAny(wrap, bytes(MEMBER_SK)), /does not match/);
  });

  test('a third party cannot open a grant', () => {
    const wrap = grantWrap({ sealerSk: ADMIN_SK, recipientPk: member, payload: grantPayload() });
    assert.throws(() => zk.unwrapAny(wrap, bytes(hexKey(11))));
  });

  test('a key file owned by another identity is ignored', () => {
    const store = tmpStore('owner-a');
    store.upsert(zoneKey(1));
    const other = new zk.ZoneKeyStore({ owner: 'owner-b', file: store.file });
    assert.equal(other.keys().length, 0);
    const same = new zk.ZoneKeyStore({ owner: 'owner-a', file: store.file });
    assert.equal(same.keys().length, 1);
  });

  test('unwrapDmRumor never returns a grant as a DM', () => {
    const wrap = grantWrap({ sealerSk: ADMIN_SK, recipientPk: member, payload: grantPayload() });
    assert.equal(unwrapDmRumor(wrap, bytes(MEMBER_SK)), null);
  });
});

// ── JunkieJarvis agent ──────────────────────────────────────────────────────

describe('JunkieJarvis in encrypted zones', () => {
  const jjSigner = signerFromHex(MEMBER_SK);
  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  const channelId = 'c'.repeat(64);
  const askerSk = hexKey(12);

  function makeBridge(kind40Section) {
    const published = [];
    return {
      published,
      subscribe() { return 'sub'; },
      unsubscribe() {},
      async publish(unsigned, signer) {
        const signed = signer && typeof signer.sign === 'function' ? signer.sign(unsigned) : unsigned;
        published.push(signed);
        return signed;
      },
      kind40Section,
    };
  }

  function agentWith({ gate = true, keys = [], section = 'zone4-chat-with-agents', llmSeen = [] } = {}) {
    const bridge = makeBridge(section);
    const store = tmpStore(jjSigner.pubkey);
    for (const k of keys) store.upsert(k);
    const zoneCrypto = {
      gate,
      zones: ZONES,
      store,
      isAdmin: async (p) => p === pk(ADMIN_SK),
      query: async () => [{ id: channelId, kind: 40, tags: [['section', section]], content: '{}' }],
    };
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: jjSigner,
      logger: silent,
      zoneCrypto,
      llm: async (text) => { llmSeen.push(text); return 'sure thing'; },
    });
    return { agent, bridge, store, llmSeen };
  }

  function mention(content, tags = []) {
    return finalizeEvent({
      kind: 42,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', channelId, '', 'root'], ['p', jjSigner.pubkey], ...tags],
      content,
    }, bytes(askerSk));
  }

  function encryptedMention(text, key) {
    const out = zk.applyWritePlan(
      { kind: 42, content: text, tags: [['e', channelId, '', 'root'], ['p', jjSigner.pubkey]] },
      { type: 'encrypt', key },
      bytes(askerSk),
    );
    return finalizeEvent({ ...out, created_at: Math.floor(Date.now() / 1000) }, bytes(askerSk));
  }

  test('decrypts an encrypted mention and replies encrypted to the zone key', async () => {
    const key = zoneKey(1);
    const { agent, bridge, llmSeen } = agentWith({ keys: [key] });
    await agent._handleChannel(encryptedMention('@junkiejarvis what is on tonight', key));
    assert.deepEqual(llmSeen, ['what is on tonight']);
    assert.equal(bridge.published.length, 1);
    const reply = bridge.published[0];
    assert.deepEqual(zk.parseZk(reply.tags), { zone: 'zone4', epoch: 1, pubkey: key.pubkey });
    assert.doesNotMatch(reply.content, /sure thing/);
    assert.equal(zk.decryptWith(reply, key), 'sure thing');
  });

  test('an encrypted mention it cannot decrypt never reaches the LLM', async () => {
    const { agent, bridge, llmSeen } = agentWith({ keys: [] });
    await agent._handleChannel(encryptedMention('@junkiejarvis secret plans', zoneKey(1)));
    assert.equal(llmSeen.length, 0);
    assert.equal(bridge.published.length, 0);
  });

  test('without a key it stays silent rather than reply in plaintext', async () => {
    const { agent, bridge, llmSeen } = agentWith({ keys: [] });
    await agent._handleChannel(mention('@junkiejarvis hello'));
    assert.equal(llmSeen.length, 1); // plaintext legacy message is read as before
    assert.equal(bridge.published.length, 0);
  });

  test('gate off: plaintext reply, unchanged behaviour', async () => {
    const { agent, bridge } = agentWith({ gate: false, keys: [] });
    await agent._handleChannel(mention('@junkiejarvis hello'));
    assert.equal(bridge.published.length, 1);
    assert.equal(bridge.published[0].content, 'sure thing');
    assert.equal(zk.hasZkTag(bridge.published[0].tags), false);
  });

  test('a channel in an unencrypted zone gets a plaintext reply with encryption on', async () => {
    const { agent, bridge } = agentWith({ keys: [zoneKey(1)], section: 'zone2-rants' });
    await agent._handleChannel(mention('@junkiejarvis hello'));
    assert.equal(bridge.published[0].content, 'sure thing');
  });

  test('a grant arriving as a gift wrap is stored and never answered', async () => {
    const { agent, bridge, store, llmSeen } = agentWith({ keys: [] });
    const wrap = grantWrap({ sealerSk: ADMIN_SK, recipientPk: jjSigner.pubkey, payload: grantPayload() });
    await agent._handleDm(wrap);
    assert.equal(store.get('zone4', 1).pubkey, pk(GRANT_ZONE_SK));
    assert.equal(llmSeen.length, 0);
    assert.equal(bridge.published.length, 0);
  });

  test('a grant from a non-admin is not stored', async () => {
    const { agent, store } = agentWith({ keys: [] });
    const wrap = grantWrap({ sealerSk: hexKey(8), recipientPk: jjSigner.pubkey, payload: grantPayload() });
    await agent._handleDm(wrap);
    assert.equal(store.keys().length, 0);
  });
});
