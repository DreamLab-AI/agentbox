'use strict';

/**
 * S11 — `/v1/meta` and `/v1/agent-events` HTTP responses.
 *
 * Direction: emit. Form: Compacted. Vocabulary: Schema.org + PROV-O +
 * agbx. Manifest gate: [linked_data].http_meta.
 *
 * When the client sends `Accept: application/ld+json`, the management-api
 * routes /v1/meta and /v1/agent-events through this surface to produce a
 * Linked-Data-friendly response. The plain-JSON shape is preserved for
 * `Accept: application/json` callers.
 */

const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';

module.exports = {
  id: 'S11',
  slot: null,                            // routed manually from server.js
  gateKey: 'http_meta',
  prerequisiteAdapter: null,
  form: 'compacted',
  direction: 'emit',
  operations: ['serve-meta', 'serve-events'],
  canonicalisation: 'none',
  vocabularyBinding: ['schema:', 'prov:', 'agbx:'],
  contextIri: AGBX_CONTEXT,

  async encode(payload, { agentDid, operation }) {
    if (!payload) throw new Error('S11 encode: payload required');
    if (operation === 'serve-meta' || payload.kind === 'meta') {
      return _encodeMeta(payload, agentDid);
    }
    if (operation === 'serve-events' || payload.kind === 'agent-events') {
      return _encodeAgentEvents(payload, agentDid);
    }
    return _encodeMeta(payload, agentDid);
  },
};

function _encodeMeta(payload, agentDid) {
  const doc = {
    '@context': [AGBX_CONTEXT, 'http://schema.org/', 'http://www.w3.org/ns/prov-o#'],
    '@type': ['schema:SoftwareApplication', 'RuntimeContract'],
    'schema:name': payload.imageRef || 'agentbox',
    'schema:softwareVersion': payload.version || 'unknown',
    'schema:applicationCategory': 'AgentRuntime',
    id: payload.id || 'urn:agentbox:meta',
  };
  if (agentDid) doc.wasAttributedTo = agentDid;
  if (payload.adapters) doc['agbx:adapters'] = payload.adapters;
  if (payload.observability) doc['agbx:observability'] = payload.observability;
  if (payload.bootstrapCompleted !== undefined) doc['agbx:bootstrapCompleted'] = !!payload.bootstrapCompleted;
  if (payload.readiness) doc['agbx:readiness'] = payload.readiness;
  return { document: doc, contextIri: AGBX_CONTEXT };
}

function _encodeAgentEvents(payload, agentDid) {
  const events = Array.isArray(payload.events) ? payload.events : [payload];
  const doc = {
    '@context': [AGBX_CONTEXT, 'http://www.w3.org/ns/prov-o#'],
    '@type': 'agbx:AgentEventStream',
    'dcterms:publisher': agentDid || null,
    'agbx:events': events.map((e) => ({
      '@type': 'prov:Activity',
      '@id': e.id || `urn:agentbox:event:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      'prov:startedAtTime': e.timestamp || new Date().toISOString(),
      'agbx:action': e.action || e.type || 'unknown',
      'agbx:slot': e.slot || null,
      'agbx:payload': e.payload || null,
    })),
  };
  return { document: doc, contextIri: AGBX_CONTEXT };
}
