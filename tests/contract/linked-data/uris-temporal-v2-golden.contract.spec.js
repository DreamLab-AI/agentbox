'use strict';

/**
 * Cross-language pin for the estate-temporal-v2 assertion-version and closure
 * ids. VisionClaw's `crates/visionclaw-adapters/src/provenance_writer.rs`
 * (tests `entity_urn_matches_uris_js_golden`, `closure_urns_match_uris_js_golden`)
 * asserts the same literals, computed from this file's `uris.js`. If either side
 * changes its payload keys or canonical form, both tests must change together.
 */

const uris = require('../../../management-api/lib/uris');

const A = 'a'.repeat(64);
const SUBJECT = 'urn:visionclaw:concept:ai:agent';
const PREDICATE = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const OBJECT = 'urn:visionclaw:concept:ai:system';
const mint = (payload) => uris.mint({ kind: 'event', pubkey: A, payload });
const urn = (hash) => `urn:agentbox:event:${A}:sha256-12-${hash}`;

describe('estate-temporal-v2 — version and closure id goldens', () => {
  test('version id hashes {subject,predicate,object,validFrom,generatedAt}', () => {
    expect(mint({
      subject: SUBJECT, predicate: PREDICATE, object: OBJECT,
      validFrom: '2026-08-07T00:00:00Z', generatedAt: '2026-08-07T00:00:00Z',
    })).toBe(urn('780226eb577e'));
  });

  test('a later recorded time is a different version', () => {
    expect(mint({
      subject: SUBJECT, predicate: PREDICATE, object: OBJECT,
      validFrom: '2026-08-07T00:00:00Z', generatedAt: '2026-08-09T12:30:00Z',
    })).toBe(urn('3573bd19c54a'));
  });

  test('the v1 payload (no recorded time) is the retired 8c3913fd05a9', () => {
    expect(mint({
      subject: SUBJECT, predicate: PREDICATE, object: OBJECT,
      validFrom: '2026-08-07T00:00:00Z',
    })).toBe(urn('8c3913fd05a9'));
  });

  test('closure ids hash {version, clocks (alphabetical), recordedAt, validUntil?}', () => {
    const version = urn('8c3913fd05a9');
    expect(mint({
      version, clocks: ['valid'],
      recordedAt: '2026-09-01T00:00:00Z', validUntil: '2026-09-01T00:00:00Z',
    })).toBe(urn('b999491bd647'));
    expect(mint({
      version, clocks: ['recorded'], recordedAt: '2026-09-02T00:00:00Z',
    })).toBe(urn('98f594ab78f7'));
    expect(mint({
      version, clocks: ['recorded', 'valid'],
      recordedAt: '2026-09-03T00:00:00Z', validUntil: '2026-09-01T00:00:00Z',
    })).toBe(urn('42138e4aae82'));
  });
});
