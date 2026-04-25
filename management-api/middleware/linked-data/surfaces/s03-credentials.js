'use strict';

/**
 * S3 — Verifiable Credentials (W3C VC Data Model 2.0).
 *
 * Direction: emit. Form: Compacted. Vocabulary: VC v2 + agbx.
 * Manifest gate: [linked_data].credentials. Canonicalisation: JCS.
 *
 * Used to wrap bead-claim work receipts, agent-identity attestations,
 * and consultant-tier per-call receipts as Verifiable Credentials. The
 * proof block is constructed elsewhere (the signer is the AgentIdentity
 * aggregate from DDD-003); this surface produces the unsigned credential
 * body that the signer canonicalises with JCS and signs.
 */

const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S3',
  slot: 'pods',                          // VCs land in pods/<npub>/credentials/
  gateKey: 'credentials',
  prerequisiteAdapter: 'adapters.pods',
  form: 'compacted',
  direction: 'emit',
  operations: ['issue'],
  canonicalisation: 'jcs',
  vocabularyBinding: ['vc:', 'agbx:'],
  contextIri: VC_CONTEXT,

  async encode(payload, { agentDid }) {
    if (!payload) throw new Error('S3 encode: payload required');
    if (!payload.credentialSubject && !payload.subject) {
      throw new Error('S3 encode: payload.credentialSubject (or .subject) required');
    }

    // Stable + content-addressed: same credentialSubject yields the
    // same URI on every emit, which is critical for round-trip and JCS
    // signing (PRD-006 §8.1, §8.2).
    const id = uris.isCanonical(payload.id)
      ? payload.id
      : uris.mint({
          kind: 'credential',
          npub: payload.issuer || agentDid,
          payload: payload.credentialSubject || payload.subject,
        });

    const doc = {
      '@context': [
        VC_CONTEXT,
        AGBX_CONTEXT,
      ],
      id,
      type: ['VerifiableCredential'].concat(payload.type || []),
      issuer: payload.issuer || agentDid || null,
      validFrom: payload.validFrom || new Date().toISOString(),
      credentialSubject: payload.credentialSubject || payload.subject,
    };

    if (payload.validUntil) doc.validUntil = payload.validUntil;
    if (payload.evidence) doc.evidence = payload.evidence;
    if (payload.termsOfUse) doc.termsOfUse = payload.termsOfUse;
    if (payload.refreshService) doc.refreshService = payload.refreshService;
    if (payload.credentialStatus) doc.credentialStatus = payload.credentialStatus;
    if (payload.credentialSchema) doc.credentialSchema = payload.credentialSchema;

    if (!doc.issuer) {
      throw new Error('S3 encode: cannot issue VC without an issuer DID');
    }

    return { document: doc, contextIri: VC_CONTEXT };
  },
};

