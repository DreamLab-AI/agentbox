'use strict';

/**
 * ADR-2098 (amended 2026-10-02, sidestr SPEC 0.0.5) — /v1/chain/info returns the
 * produced chain's hash and alias separately, and `chain` URNs resolve to it.
 *
 * Runner: node:test (`node --test tests/sovereign/chain-info.node-test.js`,
 * wired into management-api `npm run test:node`): nostr-tools pulls ESM-only
 * @noble packages the jest runtime cannot require. The chain event is signed
 * with nostr-tools (never a hand-rolled signature) by a fixed test scalar, over
 * a copy of the sealed dreamlab document whose signer is swapped for that key.
 * No event is written anywhere but a temporary directory, and none is published.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');
const { finalizeEvent, getPublicKey } = require('../../management-api/node_modules/nostr-tools');
const chainRoutes = require('../../management-api/routes/chain');
const uriResolverRoutes = require('../../management-api/routes/uri-resolver');
const uris = require('../../management-api/lib/uris');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const SEALED = path.join(__dirname, '..', '..', 'config', 'sidechain', 'dreamlab', 'chain.json');
const SK = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));
const PK = getPublicKey(SK);

function signedChainEvent(doc) {
  const content = { ...doc };
  delete content.signer;
  return finalizeEvent({
    kind: 3500, created_at: 1790900000,
    tags: [['n', doc.id], ['t', 'sidestr'], ['alt', `sidestr chain document ${doc.id}`]],
    content: JSON.stringify(content),
  }, SK);
}

async function build({ enabled = true, docPath, eventPath } = {}) {
  const app = Fastify();
  await app.register(chainRoutes, { logger, manifest: { sidechain: { enabled } }, docPath, eventPath });
  await app.register(uriResolverRoutes, { logger, manifest: {} });
  await app.ready();
  return app;
}

describe('/v1/chain/info', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-info-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('before the chain event exists: alias and genesis, hash null, legacy', async () => {
    const sealed = JSON.parse(fs.readFileSync(SEALED, 'utf8'));
    const app = await build({ docPath: SEALED, eventPath: path.join(dir, 'chain-event.json') });
    const res = await app.inject({ method: 'GET', url: '/v1/chain/info' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      alias: 'sidestr:dreamlab', hash: null, display: null, urn: null,
      genesisHash: sealed.genesisHash, signer: sealed.signer, parent: 'tbtc4',
      legacy: true, chainEvent: 'absent',
    });
    await app.close();
  });

  test('with a verified chain event: keyed by its id, alias and genesis beside it', async () => {
    const doc = { ...JSON.parse(fs.readFileSync(SEALED, 'utf8')), signer: PK };
    const docPath = path.join(dir, 'chain.json');
    fs.writeFileSync(docPath, JSON.stringify(doc));
    const ev = signedChainEvent(doc);
    fs.writeFileSync(path.join(dir, 'chain-event.json'), JSON.stringify(ev, null, 2));
    const app = await build({ docPath });
    const res = await app.inject({ method: 'GET', url: '/v1/chain/info' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      alias: 'sidestr:dreamlab', hash: ev.id, display: `sha256-12-${ev.id.slice(0, 12)}`,
      urn: `urn:agentbox:chain:${ev.id}`, genesisHash: doc.genesisHash, signer: PK, parent: 'tbtc4',
      legacy: false, chainEvent: 'present',
    });
    assert.equal((await app.inject({ method: 'GET', url: `/v1/chain/info?hash=${ev.id}` })).statusCode, 200);
    // Another hash is never answered with this chain.
    const other = await app.inject({ method: 'GET', url: `/v1/chain/info?hash=${'0'.repeat(64)}` });
    assert.equal(other.statusCode, 404);
    assert.equal(other.json().error, 'unknown-chain');
    // A chain URN resolves to exactly its own hash.
    const urn = uris.mint({ kind: 'chain', localId: ev.id });
    const r = await app.inject({ method: 'GET', url: `/v1/uri/${encodeURIComponent(urn)}` });
    assert.equal(r.statusCode, 307);
    assert.equal(r.headers.location, `/v1/chain/info?hash=${ev.id}`);
    await app.close();
  });

  test('a tampered or foreign chain event is an error, not a legacy fallback', async () => {
    const doc = { ...JSON.parse(fs.readFileSync(SEALED, 'utf8')), signer: PK };
    const docPath = path.join(dir, 'chain.json');
    fs.writeFileSync(docPath, JSON.stringify(doc));
    const ev = signedChainEvent(doc);
    fs.writeFileSync(path.join(dir, 'chain-event.json'), JSON.stringify({ ...ev, content: ev.content.replace('tbtc4', 'btc') }));
    let app = await build({ docPath });
    let res = await app.inject({ method: 'GET', url: '/v1/chain/info' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error, 'chain-event-invalid');
    await app.close();

    // Validly signed, but by a key the sealed document does not name.
    fs.writeFileSync(path.join(dir, 'chain-event.json'), JSON.stringify(ev));
    app = await build({ docPath: SEALED, eventPath: path.join(dir, 'chain-event.json') });
    res = await app.inject({ method: 'GET', url: '/v1/chain/info' });
    assert.equal(res.statusCode, 500);
    assert.match(res.json().message, /not the document's signer/);
    await app.close();
  });

  test('self-gates 503 when [sidechain] is off', async () => {
    const app = await build({ enabled: false, docPath: SEALED });
    const res = await app.inject({ method: 'GET', url: '/v1/chain/info' });
    assert.equal(res.statusCode, 503);
    await app.close();
  });

  test('an alias-shaped chain URN is malformed at /v1/uri', async () => {
    const app = await build({ docPath: SEALED });
    const res = await app.inject({ method: 'GET', url: `/v1/uri/${encodeURIComponent('urn:agentbox:chain:sidestr:dreamlab')}` });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});
