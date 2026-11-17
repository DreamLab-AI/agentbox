'use strict';
// Run: node --test tests/sovereign/relay-consumer-allowlist.test.cjs
// W3-01: an empty or unset ingress allowlist must fail closed (admit nobody).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { RelayConsumer } = require(path.resolve(__dirname, '../../mcp/nostr-bridge/relay-consumer.js'));

const AUTHOR_HEX = 'a'.repeat(64);

function build(opts = {}) {
  const warnings = [];
  const consumer = new RelayConsumer({
    npubs: ['npub1local'],
    relayUrls: ['ws://127.0.0.1:1'],
    logger: { info() {}, debug() {}, error() {}, warn(...a) { warnings.push(a); } },
    ...opts,
  });
  return { consumer, warnings };
}

const event = { id: 'e'.repeat(64), pubkey: AUTHOR_HEX, kind: 1, sig: 'f'.repeat(128), tags: [], content: '' };

test('empty allowlist admits no author under the default policy', () => {
  const { consumer } = build({ allowedPubkeys: [] });
  assert.equal(consumer._passesIngressPolicy(event), false);
});

test('unset allowlist admits no author under the default policy', () => {
  const { consumer } = build();
  assert.equal(consumer._passesIngressPolicy(event), false);
});

test('an empty allowlist logs exactly one clear warning at construction', () => {
  const { warnings } = build({ allowedPubkeys: [] });
  const hits = warnings.filter((a) => a.some((x) => typeof x === 'string' && x.includes('relay-ingress-allowlist-empty')));
  assert.equal(hits.length, 1);
});

test('a populated allowlist admits listed authors only and logs no empty warning', () => {
  const { consumer, warnings } = build({ allowedPubkeys: [AUTHOR_HEX] });
  assert.equal(consumer._passesIngressPolicy(event), true);
  assert.equal(consumer._passesIngressPolicy({ ...event, pubkey: 'b'.repeat(64) }), false);
  assert.equal(warnings.length, 0);
});

test('explicit open and signed-only policies are unchanged by an empty allowlist', () => {
  assert.equal(build({ ingressPolicy: 'open' }).consumer._passesIngressPolicy(event), true);
  assert.equal(build({ ingressPolicy: 'signed-only' }).consumer._passesIngressPolicy(event), true);
});
