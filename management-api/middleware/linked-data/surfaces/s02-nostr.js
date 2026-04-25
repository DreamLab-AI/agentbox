'use strict';

/**
 * S2 — Nostr envelope payloads (NIP-17 sealed-DM `content`).
 *
 * Direction: bidirectional. Form: Compacted. Vocabulary: ActivityStreams
 * 2.0 + agbx. Manifest gate: [linked_data].events. Prerequisite:
 * [sovereign_mesh.relay].enabled = true.
 *
 * Encodes an internal action (RequestBriefing, HandoffClaim,
 * DeliverArtefact, AS Note/Question/Activity) as a Compacted JSON-LD
 * Activity. The encoded document is the cleartext body of an NIP-17
 * sealed DM; the seal+wrap is done in DDD-003 NostrBridge.
 */

const CONTEXT_IRI = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S2',
  slot: 'events',                       // attached to the events slot for dispatch
  gateKey: 'events',
  prerequisiteAdapter: 'sovereign_mesh.relay',
  form: 'compacted',
  direction: 'both',
  operations: ['publish', 'receive'],
  canonicalisation: 'none',
  vocabularyBinding: ['as:', 'agbx:'],
  contextIri: CONTEXT_IRI,

  async encode(payload, { agentDid }) {
    const doc = {
      '@context': [
        CONTEXT_IRI,
        'https://www.w3.org/ns/activitystreams',
      ],
    };

    // Map the internal verb to an AS or agbx type.
    const verbToType = {
      'request-briefing': 'RequestBriefing',
      'handoff-claim': 'HandoffClaim',
      'deliver-artefact': 'DeliverArtefact',
      'note': 'as:Note',
      'question': 'as:Question',
      'activity': 'as:Activity',
    };
    const verb = (payload && payload.verb) || (payload && payload.type) || 'note';
    doc['@type'] = verbToType[verb] || 'as:Activity';

    if (uris.isCanonical(payload && payload.id)) doc['@id'] = payload.id;
    else if (agentDid) doc['@id'] = uris.mint({ kind: 'envelope', pubkey: agentDid, payload });
    if (agentDid) doc['as:actor'] = agentDid;

    if (payload && payload.recipient) {
      doc['as:to'] = Array.isArray(payload.recipient) ? payload.recipient : [payload.recipient];
    }
    if (payload && payload.content) doc['as:content'] = payload.content;
    if (payload && payload.summary) doc['as:summary'] = payload.summary;
    if (payload && payload.published) doc['as:published'] = payload.published;
    if (payload && payload.inReplyTo) doc['as:inReplyTo'] = payload.inReplyTo;
    if (payload && payload.attachments) doc['as:attachment'] = payload.attachments;

    if (payload && payload.target) doc['as:target'] = payload.target;
    if (payload && payload.context) doc['as:context'] = payload.context;

    // Round-trip carries flag intact.
    if (payload && payload.redacted === true) doc.redacted = true;

    return { document: doc, contextIri: CONTEXT_IRI };
  },

  /**
   * Inverse path: parse an inbound JSON-LD body back into the agentbox
   * internal verb shape so the orchestrator and bead store can route it
   * without speaking JSON-LD.
   */
  decode(jsonldDoc) {
    if (!jsonldDoc || typeof jsonldDoc !== 'object') return null;
    const t = jsonldDoc['@type'] || jsonldDoc.type;
    const map = {
      'RequestBriefing': 'request-briefing',
      'HandoffClaim': 'handoff-claim',
      'DeliverArtefact': 'deliver-artefact',
      'as:Note': 'note',
      'as:Question': 'question',
      'as:Activity': 'activity',
    };
    return {
      verb: map[t] || 'activity',
      id: jsonldDoc['@id'] || null,
      actor: jsonldDoc['as:actor'] || null,
      recipient: jsonldDoc['as:to'] || null,
      content: jsonldDoc['as:content'] || null,
      summary: jsonldDoc['as:summary'] || null,
      published: jsonldDoc['as:published'] || null,
      inReplyTo: jsonldDoc['as:inReplyTo'] || null,
      target: jsonldDoc['as:target'] || null,
    };
  },
};
