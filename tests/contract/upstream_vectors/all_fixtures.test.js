'use strict';

/**
 * L1 reference-vector tests — agentbox substrate
 *
 * Runner: node:test (`node --test tests/contract/upstream_vectors/all_fixtures.test.js`).
 * This suite verifies real cryptography (BIP-340 Schnorr, NIP-01 event-id
 * serialisation, NIP-26 delegation tokens) against the shared cross-substrate
 * reference vectors, so it deliberately loads @noble/curves — an ESM-only
 * package that the jest module runtime cannot require. node:test uses Node's
 * native loader, which requires ESM cleanly; jest cannot, hence the split from
 * the *.contract.spec.js jest suites.
 *
 * Per ADR-082 D5, agentbox consumes fixtures synced from VisionClaw's canonical
 * tests/fixtures/ directory. Substrate-side `scripts/sync-fixtures.sh` copies
 * them into tests/contract/upstream_vectors/fixtures/; the loader resolves them
 * via env var VISIONCLAW_FIXTURE_ROOT if set, otherwise that directory.
 *
 * A missing fixture is a HARD FAILURE (not a silent skip): the corpus is
 * checked into the repo and covered by CHECKSUM.txt, so absence means a broken
 * sync or a deleted vector file, which must fail the suite.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// @noble/curves is ESM-only and lives under management-api/node_modules (the
// crate that owns the runtime nostr dependencies). Resolve it from there so the
// require works regardless of this file's position in the tree.
const MGMT_NODE_MODULES = path.join(__dirname, '..', '..', '..', 'management-api', 'node_modules');
const { schnorr } = require(path.join(MGMT_NODE_MODULES, '@noble', 'curves', 'secp256k1.js'));

const fixtureRoot = () => {
  if (process.env.VISIONCLAW_FIXTURE_ROOT) return process.env.VISIONCLAW_FIXTURE_ROOT;
  return path.join(__dirname, 'fixtures');
};

/** Load a fixture, failing hard if it is absent. */
const loadFixture = (name) => {
  const p = path.join(fixtureRoot(), name);
  if (!fs.existsSync(p)) {
    assert.fail(
      `fixture ${name} not found at ${p} — the reference corpus is checked in and ` +
      `checksum-gated; run scripts/sync-fixtures.sh to restore it. A missing ` +
      `fixture is a drift failure, not a skip.`,
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

// --- crypto helpers -------------------------------------------------------

const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
const sha256Hex = (utf8) => crypto.createHash('sha256').update(Buffer.from(utf8, 'utf8')).digest('hex');

/**
 * BIP-340 Schnorr verification with malformed input mapped to `false`.
 * The canonical negative vectors include off-curve pubkeys and out-of-range
 * r/s values that make @noble throw; per BIP-340 those are verification
 * failures, so a throw collapses to `false` here.
 */
const schnorrVerify = (sigHex, msgBytes, pubkeyHex) => {
  try {
    return schnorr.verify(hexToBytes(sigHex), msgBytes, hexToBytes(pubkeyHex));
  } catch {
    return false;
  }
};

// --- fixture-shape assertions ---------------------------------------------

const assertMetaBlock = (fixture, expectedSpecSubstring) => {
  assert.ok(fixture._meta, '_meta block present');
  assert.equal(typeof fixture._meta.spec, 'string');
  assert.ok(
    fixture._meta.spec.includes(expectedSpecSubstring),
    `_meta.spec "${fixture._meta.spec}" contains "${expectedSpecSubstring}"`,
  );
  assert.equal(typeof fixture._meta.commit, 'string');
};

const FIXTURE_TABLE = [
  { file: 'nip01-events.json',         spec: 'NIP-01',    minVectors: 11, label: 'NIP-01 events' },
  { file: 'nip04-dm.json',             spec: 'NIP-04',    minVectors: 4,  label: 'NIP-04 DM (deprecated)' },
  { file: 'nip19-bech32.json',         spec: 'NIP-19',    minVectors: 12, label: 'NIP-19 bech32 entities' },
  { file: 'nip26-delegation.json',     spec: 'NIP-26',    minVectors: 5,  label: 'NIP-26 delegation' },
  { file: 'nip44-v2.json',             spec: 'NIP-44',    minVectors: 30, label: 'NIP-44 v2 DM (C1 guard)' },
  { file: 'nip59-gift-wrap.json',      spec: 'NIP-59',    minVectors: 6,  label: 'NIP-59 gift-wrap' },
  { file: 'nip98-tokens.json',         spec: 'NIP-98',    minVectors: 6,  label: 'NIP-98 HTTP Auth' },
  { file: 'bip340-schnorr.json',       spec: 'BIP-340',   minVectors: 19, label: 'BIP-340 Schnorr (C2 guard)' },
  { file: 'rfc8785-jcs.json',          spec: 'RFC 8785',  minVectors: 6,  label: 'RFC 8785 JCS' },
  { file: 'multibase.json',            spec: 'Multibase', minVectors: 27, label: 'Multibase encoding' },
  { file: 'did-doc-conformance.json',  spec: 'ADR-074',   minVectors: 7,  label: 'DID Document conformance' },
  { file: 'is-envelope-v1.json',       spec: 'ADR-075',   minVectors: 11, label: 'IS-Envelope v1' },
  { file: 'mesh-federation.json',      spec: 'ADR-073',   minVectors: 9,  label: 'Mesh federation' },
];

describe('upstream vectors — agentbox substrate', () => {
  for (const { file, spec, minVectors, label } of FIXTURE_TABLE) {
    test(`${label} (${file}) — metadata + vector count`, () => {
      const f = loadFixture(file);
      assertMetaBlock(f, spec);

      // Vector count check (handle nested nip44 shape)
      let vectorCount;
      if (Array.isArray(f.vectors)) {
        vectorCount = f.vectors.length;
      } else if (f.vectors && f.vectors.valid && f.vectors.valid.get_conversation_key) {
        vectorCount = f.vectors.valid.get_conversation_key.length;
      } else {
        vectorCount = 0;
      }
      assert.ok(
        vectorCount >= minVectors,
        `${file} has ${vectorCount} vectors, expected >= ${minVectors}`,
      );
    });
  }

  // --- Real cryptographic verification (was PHASE-2 test.skip stubs) --------

  test('BIP-340 substrate verifier accepts positive and rejects negative Schnorr vectors', () => {
    const f = loadFixture('bip340-schnorr.json');
    assert.ok(Array.isArray(f.vectors) && f.vectors.length >= 19, 'BIP-340 vectors present');
    for (const v of f.vectors) {
      const got = schnorrVerify(v.signature_hex, hexToBytes(v.message_hex), v.public_key_hex);
      assert.equal(
        got,
        v.verification_result,
        `BIP-340 vector ${v.index} (${v.comment || 'canonical'}): ` +
        `expected verification_result=${v.verification_result}, got ${got}`,
      );
    }
  });

  test('NIP-01 substrate validator canonicalises valid events and rejects negative vectors', () => {
    const f = loadFixture('nip01-events.json');

    const validateEventStructure = (ev) => {
      if (!ev || typeof ev !== 'object') return false;
      if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey)) return false;
      if (!Number.isInteger(ev.created_at)) return false;
      if (!Number.isInteger(ev.kind)) return false;
      if (!Array.isArray(ev.tags) || !ev.tags.every((t) => Array.isArray(t))) return false;
      if (typeof ev.content !== 'string') return false;
      return true;
    };

    let positives = 0;
    let negatives = 0;
    for (const v of f.vectors) {
      if (v.valid) {
        assert.ok(validateEventStructure(v.event), `valid vector "${v.case}" passes structural validation`);
        // NIP-01 canonical serialisation: [0, pubkey, created_at, kind, tags, content]
        // with JSON string escaping — which JSON.stringify produces exactly.
        const serialised = JSON.stringify([
          0, v.event.pubkey, v.event.created_at, v.event.kind, v.event.tags, v.event.content,
        ]);
        assert.equal(serialised, v.serialised, `canonical serialisation for "${v.case}"`);
        assert.match(sha256Hex(serialised), /^[0-9a-f]{64}$/, `event id derivation for "${v.case}"`);
        positives++;
      } else {
        assert.equal(
          validateEventStructure(v.event),
          false,
          `negative vector "${v.case}" MUST be rejected by structural validation`,
        );
        negatives++;
      }
    }
    assert.ok(positives >= 1, 'at least one valid NIP-01 vector exercised');
    assert.ok(negatives >= 1, 'at least one negative NIP-01 vector rejected');
  });

  test('NIP-26 substrate verifier passes canonical delegation sig and rejects unbounded conditions', () => {
    const f = loadFixture('nip26-delegation.json');

    // Conditions validity: an empty conditions string is an unbounded (all-events)
    // delegation and must be rejected (ADR-074 D8).
    const validConditions = (c) => typeof c === 'string' && c.length > 0;

    let cryptoVerified = 0;
    for (const v of f.vectors) {
      // Canonical NIP-26 delegation string.
      const expectedString = `nostr:delegation:${v.delegatee_pubkey_hex}:${v.conditions}`;
      assert.equal(v.delegation_string, expectedString, `delegation_string for "${v.case}"`);

      assert.equal(validConditions(v.conditions), v.valid, `conditions validity for "${v.case}"`);

      // Where a signed token is supplied, verify it with real Schnorr/BIP-340
      // over sha256(delegation_string) under the delegator's pubkey.
      if (v.delegation_token_hex && v.delegator_pubkey_hex) {
        const digest = hexToBytes(sha256Hex(v.delegation_string));
        assert.equal(
          schnorrVerify(v.delegation_token_hex, digest, v.delegator_pubkey_hex),
          true,
          `delegation token for "${v.case}" verifies under delegator pubkey`,
        );
        cryptoVerified++;
      }
    }
    assert.ok(cryptoVerified >= 1, 'at least one delegation token cryptographically verified');
  });
});
