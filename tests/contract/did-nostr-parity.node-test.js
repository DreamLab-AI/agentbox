// The did:nostr grammar shared by the JS URI mint and the Rust nostr-receipt crate.
// Both run crates/nostr-receipt/fixtures/did-nostr.json and must agree on every entry.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { isDidNostr } = require('../../management-api/lib/uris.js');
const fixtures = require(path.join(__dirname, '../../crates/nostr-receipt/fixtures/did-nostr.json'));

test('accepts every valid did:nostr fixture', () => {
  for (const s of fixtures.valid) assert.strictEqual(isDidNostr(s), true, s);
});

test('rejects every invalid did:nostr fixture', () => {
  for (const s of fixtures.invalid) assert.strictEqual(isDidNostr(s), false, JSON.stringify(s));
});
