'use strict';

/**
 * L1 reference-vector tests — agentbox substrate
 *
 * Per ADR-082 D5, agentbox consumes fixtures synced from VisionClaw monorepo's
 * docs/specs/fixtures/ directory. Substrate-side `scripts/sync-fixtures.sh`
 * copies them into tests/contract/upstream_vectors/fixtures/.
 *
 * Until that sync runs, this loader resolves fixtures via env var
 * VISIONCLAW_FIXTURE_ROOT if set; otherwise via tests/contract/upstream_vectors/fixtures/.
 *
 * Each test loads its fixture and asserts the metadata block matches.
 * Substrate-side validators (nostr-tools.verifySignature for NIP-01,
 * nostr-tools.verifyDelegation for NIP-26, etc.) are wired in as Phase 2.
 */

const fs = require('fs');
const path = require('path');

const fixtureRoot = () => {
  if (process.env.VISIONCLAW_FIXTURE_ROOT) return process.env.VISIONCLAW_FIXTURE_ROOT;
  return path.join(__dirname, 'fixtures');
};

const tryLoadFixture = (name) => {
  const p = path.join(fixtureRoot(), name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const assertMetaBlock = (fixture, expectedSpecSubstring) => {
  expect(fixture._meta).toBeDefined();
  expect(typeof fixture._meta.spec).toBe('string');
  expect(fixture._meta.spec).toEqual(expect.stringContaining(expectedSpecSubstring));
  expect(typeof fixture._meta.commit).toBe('string');
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
  FIXTURE_TABLE.forEach(({ file, spec, minVectors, label }) => {
    test(`${label} (${file})`, () => {
      const f = tryLoadFixture(file);
      if (!f) {
        // Fixture missing — emit a console warning but don't fail. CI gate
        // (per ADR-082 D4 Option β) will catch missing fixtures via checksum.
        // eslint-disable-next-line no-console
        console.warn(`fixture ${file} not found; skipping (run scripts/sync-fixtures.sh first)`);
        return;
      }
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
      expect(vectorCount).toBeGreaterThanOrEqual(minVectors);
    });
  });

  test.skip('PHASE-2: NIP-01 substrate validator rejects negative vectors', () => {
    // Wires into agentbox/mcp/nostr-bridge/relay-consumer.js::_processEvent
    // once nostr-tools.validateEvent is integrated.
  });

  test.skip('PHASE-2: NIP-26 substrate verifier passes canonical sig', () => {
    // Wires into agentbox/mcp/nostr-bridge/relay-consumer.js::_processEvent
    // alongside the Rust port at nostr-core/src/nip26.rs.
  });
});
