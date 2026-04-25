'use strict';

/**
 * S1 — Solid pod resource representations.
 *
 * Direction: bidirectional. Form: Compacted. Vocabulary: ActivityStreams
 * 2.0 + Schema.org + LDP + agbx. Manifest gate: [linked_data].pods.
 * Prerequisite adapter: adapters.pods ∈ {local-solid-rs, external}.
 *
 * The encoder takes pod-bound payloads (briefs, debriefs, agent
 * artefacts, NIP-17 sealed-DM receipts produced by the pod-bridge) and
 * emits a Compacted JSON-LD document carrying the agbx context plus
 * upstream vocabularies. The output is what solid-pod-rs serves as
 * `application/ld+json` content-negotiated representations.
 */

const CONTEXT_IRI = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S1',
  slot: 'pods',
  gateKey: 'pods',
  prerequisiteAdapter: 'adapters.pods',
  form: 'compacted',
  direction: 'both',
  operations: ['write', 'read', 'patch'],
  canonicalisation: 'none',
  vocabularyBinding: ['as:', 'schema:', 'ldp:', 'agbx:'],
  contextIri: CONTEXT_IRI,

  async encode(payload, { agentDid, operation }) {
    // Pass-through if the payload already declares its own @context — the
    // pod write may already have been encoded upstream.
    if (payload && typeof payload === 'object' && payload['@context']) {
      return { document: payload, contextIri: payload['@context'] };
    }

    const doc = {
      '@context': [
        CONTEXT_IRI,
        'https://www.w3.org/ns/activitystreams',
        'http://schema.org/',
      ],
    };

    // Identity is canonical when the agent is known: caller-supplied
    // ids are honoured if already canonical, otherwise minted.
    const callerId = payload && (payload.id || payload['@id']);
    if (uris.isCanonical(callerId)) {
      doc['@id'] = callerId;
    } else if (agentDid) {
      doc['@id'] = uris.mint({ kind: 'pod', pubkey: agentDid, payload });
    } else if (callerId) {
      doc['@id'] = callerId;       // anonymous pod write — pass through
    }

    if (payload && payload.type) doc['@type'] = payload.type;
    if (payload && payload['@type']) doc['@type'] = payload['@type'];

    if (agentDid) {
      doc.wasAttributedTo = agentDid;
    }

    if (payload && payload.name) doc.name = payload.name;
    if (payload && payload.description) doc.description = payload.description;
    if (payload && payload.content) {
      doc['as:content'] = payload.content;
    }
    if (payload && payload.attachments) {
      doc['as:attachment'] = payload.attachments;
    }

    // Carry through any other claim-bearing properties the upstream
    // surface may have set; they will be expanded against the catalogue
    // context, so unknown bare strings will be rejected at round-trip.
    for (const [k, v] of Object.entries(payload || {})) {
      if (k.startsWith('@')) continue;
      if (['id', 'type', 'name', 'description', 'content', 'attachments'].includes(k)) continue;
      doc[k] = v;
    }

    if (operation && !doc.operation) {
      doc.operation = operation;
    }

    return { document: doc, contextIri: CONTEXT_IRI };
  },
};
