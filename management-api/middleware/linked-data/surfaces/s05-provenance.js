'use strict';

/**
 * S5 — Provenance receipts (W3C PROV-O).
 *
 * Direction: emit. Form: Compacted. Vocabulary: PROV-O + agbx.
 * Manifest gate: [linked_data].provenance.
 *
 * For every adapter dispatch the agent makes (claim a bead, write a
 * memory entry, fetch a context, dispatch a consultant), this surface
 * emits a parallel PROV-O receipt that an external integrator can
 * subscribe to via the events adapter slot. The plain-JSON event sink
 * (DDD-003 `events` adapter) keeps its existing shape for internal
 * consumers — S5 is additive.
 */

const PROV_CONTEXT = 'http://www.w3.org/ns/prov-o#';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S5',
  slot: 'events',
  gateKey: 'provenance',
  prerequisiteAdapter: 'adapters.events',
  form: 'compacted',
  direction: 'emit',
  operations: ['emit', 'append'],
  canonicalisation: 'none',
  vocabularyBinding: ['prov:', 'agbx:'],
  contextIri: PROV_CONTEXT,

  async encode(payload, { agentDid }) {
    const id = uris.isCanonical(payload?.id)
      ? payload.id
      : uris.mint({
          kind: 'activity',
          npub: agentDid || payload?.actor,
          payload: {
            action: payload?.action || null,
            slot: payload?.slot || null,
            operation: payload?.operation || null,
            startedAt: payload?.startedAt || payload?.timestamp || null,
            input: payload?.input || null,
            output: payload?.output || null,
          },
        });
    const startedAt = payload?.startedAt || payload?.timestamp || new Date().toISOString();
    const endedAt = payload?.endedAt || startedAt;

    const doc = {
      '@context': [PROV_CONTEXT, AGBX_CONTEXT],
      '@id': id,
      '@type': 'prov:Activity',
      'prov:startedAtTime': startedAt,
      'prov:endedAtTime': endedAt,
    };

    if (agentDid) doc['prov:wasAssociatedWith'] = { '@id': agentDid };
    if (payload?.actor) doc['prov:wasAssociatedWith'] = { '@id': payload.actor };
    if (payload?.input) {
      doc['prov:used'] = _coerceEntities(payload.input);
    }
    if (payload?.output) {
      doc['prov:generated'] = _coerceEntities(payload.output);
    }
    if (payload?.label) doc['rdfs:label'] = payload.label;
    if (payload?.action) doc['agbx:action'] = payload.action;
    if (payload?.slot) doc['agbx:slot'] = payload.slot;
    if (payload?.operation) doc['agbx:operation'] = payload.operation;

    if (payload?.redacted === true) doc.redacted = true;

    return { document: doc, contextIri: PROV_CONTEXT };
  },
};

function _coerceEntities(input) {
  if (Array.isArray(input)) return input.map(_coerceOne);
  return _coerceOne(input);
}

function _coerceOne(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string') return { '@id': x, '@type': 'prov:Entity' };
  if (typeof x === 'object') {
    return Object.assign({ '@type': 'prov:Entity' }, x);
  }
  return { '@type': 'prov:Entity', 'agbx:value': String(x) };
}

